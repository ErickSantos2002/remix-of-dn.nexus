import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import type { PeriodFilter, CustomDateRange } from "./useAnalyticsData";
import type { ActivityAnalysisResult, SellerCoachingBrief, SellerRankingRow } from "@/types/analysis";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TeamPerformanceSummary {
  ranking: SellerRankingRow[];
  companyAverage: number | null;
  totalAnalyses: number;
  /** Média por análise cadastrada, para comparar tipos de atendimento. */
  byPlaybook: Array<{ playbook_id: string; name: string; avg_score: number; count: number }>;
  scoreSeries: Array<{ date: string; score: number; count: number }>;
}

function rangeFor(period: PeriodFilter, customRange?: CustomDateRange) {
  const end = period === "custom" && customRange?.to ? new Date(customRange.to) : new Date();
  end.setHours(23, 59, 59, 999);

  let start: Date;
  if (period === "custom" && customRange?.from) {
    start = new Date(customRange.from);
  } else {
    const days = period === "today" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30;
    start = new Date();
    start.setDate(start.getDate() - days);
  }
  start.setHours(0, 0, 0, 0);

  return { start: start.toISOString(), end: end.toISOString() };
}

/** Média da segunda metade menos a da primeira, em pontos de score. */
function trendOf(results: ActivityAnalysisResult[]): number {
  const scored = results
    .filter((r) => r.score !== null && r.score !== undefined)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (scored.length < 2) return 0;

  const middle = Math.floor(scored.length / 2);
  const average = (items: ActivityAnalysisResult[]) =>
    items.reduce((sum, item) => sum + (item.score ?? 0), 0) / items.length;
  return Math.round(average(scored.slice(middle)) - average(scored.slice(0, middle)));
}

/** Visão agregada da empresa: ranking de vendedores, média geral e séries. */
export function useTeamPerformance(
  period: PeriodFilter,
  customRange?: CustomDateRange,
  playbookId?: string | null,
) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const range = useMemo(
    () => rangeFor(period, customRange),
    // Depende das datas em string, nao do objeto: um novo customRange a cada
    // render recalcularia o range e reexecutaria a query em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, customRange?.from, customRange?.to],
  );

  return useQuery({
    queryKey: ["team-performance", companyId, playbookId ?? "all", range.start, range.end],
    enabled: !!companyId,
    queryFn: async (): Promise<TeamPerformanceSummary> => {
      let query = (supabase.from("activity_analysis_results") as any)
        .select("*")
        .eq("company_id", companyId!)
        .eq("status", "done")
        // Data do atendimento, não do processamento (ver usePerformanceData)
        .gte("occurred_at", range.start)
        .lte("occurred_at", range.end)
        .order("occurred_at", { ascending: false });
      if (playbookId) query = query.eq("playbook_id", playbookId);

      const { data, error } = await query;
      if (error) throw error;
      // Avaliações desconsideradas nunca entram em média, tendência ou ranking
      const results = ((data ?? []) as ActivityAnalysisResult[]).filter((r) => !r.disregarded_at);

      const sellerIds = [...new Set(results.map((r) => r.seller_id).filter(Boolean))] as string[];

      const [{ data: profiles }, { data: points }, { data: playbooks }] = await Promise.all([
        sellerIds.length > 0
          ? supabase.from("profiles").select("id, name, email").in("id", sellerIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null }> }),
        // Recorrências do período, não do histórico: o ranking compara o
        // desempenho da janela escolhida, e uma falha de três meses atrás
        // penalizaria o vendedor numa coluna que ele já não pode mudar
        (supabase.from("seller_development_points") as any)
          .select("seller_id, status")
          .eq("company_id", companyId!)
          .eq("status", "recurrent")
          .gte("last_seen_at", range.start)
          .lte("last_seen_at", range.end),
        (supabase.from("analysis_playbooks") as any).select("id, name").eq("company_id", companyId!),
      ]);

      const nameById = new Map(
        ((profiles ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map((p) => [
          p.id,
          p.name || p.email || "Sem nome",
        ]),
      );
      const playbookNameById = new Map(
        ((playbooks ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
      );

      const recurrentBySeller = new Map<string, number>();
      for (const point of (points ?? []) as Array<{ seller_id: string }>) {
        recurrentBySeller.set(point.seller_id, (recurrentBySeller.get(point.seller_id) ?? 0) + 1);
      }

      const ranking: SellerRankingRow[] = sellerIds
        .map((sellerId) => {
          const sellerResults = results.filter((r) => r.seller_id === sellerId);
          // Snapshot gravado na avaliação vem primeiro: ler profiles depende de
          // RLS que só libera colegas de empresa, e nem todo vendedor está lá.
          const snapshotName = sellerResults.find((r) => r.seller_name)?.seller_name;
          const scored = sellerResults.filter((r) => r.score !== null && r.score !== undefined);
          return {
            seller_id: sellerId,
            seller_name: snapshotName ?? nameById.get(sellerId) ?? "Sem nome",
            avg_score:
              scored.length > 0
                ? Math.round(scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length)
                : 0,
            analyses_count: sellerResults.length,
            trend: trendOf(sellerResults),
            recurrent_points: recurrentBySeller.get(sellerId) ?? 0,
          };
        })
        .sort((a, b) => b.avg_score - a.avg_score || b.analyses_count - a.analyses_count);

      const scored = results.filter((r) => r.score !== null && r.score !== undefined);
      const companyAverage =
        scored.length > 0
          ? Math.round(scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length)
          : null;

      const byPlaybookMap = new Map<string, { total: number; count: number }>();
      for (const result of scored) {
        if (!result.playbook_id) continue;
        const current = byPlaybookMap.get(result.playbook_id) ?? { total: 0, count: 0 };
        current.total += result.score ?? 0;
        current.count += 1;
        byPlaybookMap.set(result.playbook_id, current);
      }

      const byDay = new Map<string, { total: number; count: number }>();
      for (const result of scored) {
        const day = result.occurred_at.slice(0, 10);
        const current = byDay.get(day) ?? { total: 0, count: 0 };
        current.total += result.score ?? 0;
        current.count += 1;
        byDay.set(day, current);
      }

      return {
        ranking,
        companyAverage,
        totalAnalyses: results.length,
        byPlaybook: [...byPlaybookMap.entries()]
          .map(([id, { total, count }]) => ({
            playbook_id: id,
            name: playbookNameById.get(id) ?? "Análise removida",
            avg_score: Math.round(total / count),
            count,
          }))
          .sort((a, b) => b.count - a.count),
        scoreSeries: [...byDay.entries()]
          .map(([date, { total, count }]) => ({ date, score: Math.round(total / count), count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
    staleTime: 30_000,
  });
}

/** Brief de coaching cacheado por vendedor, com ação de regerar sob demanda. */
export function useCoachingBrief(sellerId: string | null) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["coaching-brief", companyId, sellerId],
    enabled: !!companyId && !!sellerId,
    queryFn: async (): Promise<SellerCoachingBrief | null> => {
      const { data, error } = await (supabase.from("seller_coaching_briefs") as any)
        .select("*")
        .eq("company_id", companyId!)
        .eq("seller_id", sellerId!)
        .maybeSingle();
      if (error) throw error;
      return (data as SellerCoachingBrief) ?? null;
    },
    staleTime: 60_000,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("analyze-transcript-playbook", {
        body: {
          action: "coaching-brief",
          company_id: companyId,
          seller_id: sellerId,
          requested_by: userData.user?.id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coaching-brief", companyId, sellerId] });
    },
  });

  return { ...query, generate };
}
