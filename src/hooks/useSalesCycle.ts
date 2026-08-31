import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { PeriodFilter, CustomDateRange } from "./useAnalyticsData";

export interface SalesCycleBreakdownItem {
  key: string;
  label: string;
  count: number;
  avgDays: number;
  medianDays: number;
}

export interface SalesCycleMonthPoint {
  month: string; // YYYY-MM
  label: string; // mmm/aa
  count: number;
  avgDays: number | null;
  medianDays: number | null;
}

export interface SalesCycleData {
  wonCount: number;
  avgDays: number | null;
  medianDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  p90Days: number | null;
  previous: {
    wonCount: number;
    avgDays: number | null;
    medianDays: number | null;
  };
  bySource: SalesCycleBreakdownItem[];
  byChannel: SalesCycleBreakdownItem[];
  distribution: Array<{ bucket: string; count: number }>;
  monthly: SalesCycleMonthPoint[];
  fortnightly: SalesCycleMonthPoint[];
}

function periodRange(period: PeriodFilter, customRange?: CustomDateRange) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (period === "custom" && customRange) {
    const from = new Date(customRange.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(customRange.to);
    to.setHours(23, 59, 59, 999);
    return { start: from, end: to };
  }
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "30d") start.setDate(start.getDate() - 29);
  if (period === "90d") start.setDate(start.getDate() - 89);
  return { start, end };
}

function diffDays(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

function buildBreakdown(
  rows: Array<{ days: number; key: string; label: string }>,
): SalesCycleBreakdownItem[] {
  const map = new Map<string, { label: string; days: number[] }>();
  rows.forEach((r) => {
    const entry = map.get(r.key) || { label: r.label, days: [] };
    entry.days.push(r.days);
    map.set(r.key, entry);
  });
  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      count: v.days.length,
      avgDays: Math.round((v.days.reduce((a, b) => a + b, 0) / v.days.length) * 10) / 10,
      medianDays: Math.round((median(v.days) || 0) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

const BUCKETS: Array<{ label: string; test: (d: number) => boolean }> = [
  { label: "0-1 dia", test: (d) => d <= 1 },
  { label: "2-7 dias", test: (d) => d > 1 && d <= 7 },
  { label: "8-15 dias", test: (d) => d > 7 && d <= 15 },
  { label: "16-30 dias", test: (d) => d > 15 && d <= 30 },
  { label: "31-60 dias", test: (d) => d > 30 && d <= 60 },
  { label: "60+ dias", test: (d) => d > 60 },
];

/** Agrupa os cards ganhos por mês do fechamento (horário de Brasília, UTC-3). */
function buildMonthly(rows: Array<{ created_at: string; closed_at: string }>): SalesCycleMonthPoint[] {
  const map = new Map<string, number[]>();

  // últimos 12 meses sempre presentes, mesmo sem vendas
  const cursor = new Date();
  cursor.setMonth(cursor.getMonth() - 11, 1);
  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, []);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  rows.forEach((l) => {
    const d = new Date(new Date(l.closed_at).getTime() - 3 * 3600000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(diffDays(l.created_at, l.closed_at));
  });

  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, days]) => {
      const [y, m] = month.split("-");
      return {
        month,
        label: `${MONTHS[Number(m) - 1]}/${y.slice(2)}`,
        count: days.length,
        avgDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
        medianDays: round1(median(days)),
      };
    });
}

const MONTHS_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Agrupa os cards ganhos em quinzenas (dias 1-15 e 16-fim do mês), horário de
 * Brasília, cobrindo os últimos 6 meses.
 */
function buildFortnightly(rows: Array<{ created_at: string; closed_at: string }>): SalesCycleMonthPoint[] {
  const map = new Map<string, number[]>();

  const cursor = new Date();
  cursor.setMonth(cursor.getMonth() - 5, 1);
  for (let i = 0; i < 6; i++) {
    const base = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    map.set(`${base}-Q1`, []);
    map.set(`${base}-Q2`, []);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  rows.forEach((l) => {
    const d = new Date(new Date(l.closed_at).getTime() - 3 * 3600000);
    const base = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${base}-${d.getUTCDate() <= 15 ? "Q1" : "Q2"}`;
    if (!map.has(key)) return; // fora da janela de 6 meses
    map.get(key)!.push(diffDays(l.created_at, l.closed_at));
  });

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, days]) => {
      const [y, m, q] = key.split("-");
      const monthLabel = MONTHS_ABBR[Number(m) - 1];
      return {
        month: key,
        label: q === "Q1" ? `1-15 ${monthLabel}` : `16-fim ${monthLabel}`,
        count: days.length,
        avgDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
        medianDays: round1(median(days)),
      };
    });
}

export function useSalesCycle(period: PeriodFilter, customRange?: CustomDateRange) {
  const { workspaceId } = useWorkspace();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<SalesCycleData | null>(null);

  const { start, end } = useMemo(() => periodRange(period, customRange), [period, customRange?.from, customRange?.to]);

  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      const spanMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - spanMs);

      const fetchWon = async (from: Date, to: Date) => {
        const all: any[] = [];
        let offset = 0;
        while (true) {
          const { data: rows, error } = await supabase
            .from("crm_leads")
            .select("id, created_at, closed_at, utm_source, contact:crm_contacts(source)")
            .eq("workspace_id", workspaceId)
            .eq("status", "won")
            .not("closed_at", "is", null)
            .gte("closed_at", from.toISOString())
            .lte("closed_at", to.toISOString())
            .order("closed_at", { ascending: true })
            .range(offset, offset + 999);
          if (error) throw error;
          all.push(...(rows || []));
          if (!rows || rows.length < 1000) break;
          offset += 1000;
        }
        return all;
      };

      // Evolução mês a mês: sempre últimos 12 meses (independe do período do filtro)
      const monthsStart = new Date();
      monthsStart.setMonth(monthsStart.getMonth() - 11, 1);
      monthsStart.setHours(0, 0, 0, 0);

      try {
        const [current, previous, lastYear] = await Promise.all([
          fetchWon(start, end),
          fetchWon(prevStart, prevEnd),
          fetchWon(monthsStart, new Date()),
        ]);
        if (cancelled) return;

        const currentDays = current.map((l) => diffDays(l.created_at, l.closed_at));
        const prevDays = previous.map((l) => diffDays(l.created_at, l.closed_at));

        const sourceRows = current.map((l, i) => ({
          days: currentDays[i],
          key: (l.contact?.source || "nao_identificado") as string,
          label: (l.contact?.source || "Não identificado") as string,
        }));
        const channelRows = current.map((l, i) => ({
          days: currentDays[i],
          key: (l.utm_source || "sem_canal") as string,
          label: (l.utm_source || "Sem canal") as string,
        }));

        setData({
          wonCount: current.length,
          avgDays: currentDays.length ? round1(currentDays.reduce((a, b) => a + b, 0) / currentDays.length) : null,
          medianDays: round1(median(currentDays)),
          minDays: currentDays.length ? round1(Math.min(...currentDays)) : null,
          maxDays: currentDays.length ? round1(Math.max(...currentDays)) : null,
          p90Days: round1(percentile(currentDays, 90)),
          previous: {
            wonCount: previous.length,
            avgDays: prevDays.length ? round1(prevDays.reduce((a, b) => a + b, 0) / prevDays.length) : null,
            medianDays: round1(median(prevDays)),
          },
          bySource: buildBreakdown(sourceRows),
          byChannel: buildBreakdown(channelRows),
          distribution: BUCKETS.map((b) => ({
            bucket: b.label,
            count: currentDays.filter(b.test).length,
          })),
          monthly: buildMonthly(lastYear),
          fortnightly: buildFortnightly(lastYear),
        });
      } catch (e) {
        console.error("useSalesCycle", e);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, start.getTime(), end.getTime()]);

  return { data, isLoading };
}
