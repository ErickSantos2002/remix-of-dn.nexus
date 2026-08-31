import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PeriodFilter, CustomDateRange } from "./useAnalyticsData";

export type CatalogKind = "pains" | "objections";
export type LeadStatusFilter = "all" | "open" | "won" | "lost";

export interface PainObjectionRow {
  id: string;
  leadId: string;
  company: string;
  leadName: string;
  itemId: string;
  itemName: string;
  assigneeId: string | null;
  assigneeName: string;
  stageId: string | null;
  stageName: string;
  stageColor: string;
  status: "open" | "won" | "lost";
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface PainsObjectionsFilters {
  stages: string[];
  status: LeadStatusFilter;
  assignees: string[];
}

const CONFIG = {
  pains: { linkTable: "crm_lead_pains", catalogTable: "crm_pains", fk: "pain_id" },
  objections: { linkTable: "crm_lead_objections", catalogTable: "crm_objections", fk: "objection_id" },
} as const;

type LooseRow = Record<string, any>;

async function fetchAllRows<T>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (buildQuery(from, from + PAGE - 1) as any);
    if (error) {
      console.error("fetchAllRows error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function getStartDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) return customRange.from;
  const now = new Date();
  const start = new Date();
  if (period === "today") start.setHours(0, 0, 0, 0);
  else if (period === "7d") start.setDate(now.getDate() - 7);
  else if (period === "30d") start.setDate(now.getDate() - 30);
  else if (period === "90d") start.setDate(now.getDate() - 90);
  return start;
}

function getEndDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) {
    const end = new Date(customRange.to);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  return new Date();
}

export function usePainsObjectionsReport(
  kind: CatalogKind,
  period: PeriodFilter,
  customRange?: CustomDateRange,
) {
  const { workspaceId } = useWorkspace();
  const [isLoading, setIsLoading] = useState(true);
  const [rows, setRows] = useState<PainObjectionRow[]>([]);

  const fromKey = customRange?.from ? customRange.from.toISOString() : "";
  const toKey = customRange?.to ? customRange.to.toISOString() : "";

  // Memoizado para evitar recalcular "agora" a cada render (loop infinito no efeito)
  const { startIso, endIso } = useMemo(
    () => ({
      startIso: getStartDate(period, customRange).toISOString(),
      endIso: getEndDate(period, customRange).toISOString(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, fromKey, toKey],
  );

  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      setRows([]);
      return;
    }
    if (period === "custom" && !customRange) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const cfg = CONFIG[kind];
        const db = supabase as any;

        // 1. Leads do workspace no periodo
        const leads = await fetchAllRows<LooseRow>((from, to) =>
          db
            .from("crm_leads")
            .select("id, title, status, stage_id, assigned_to, contact_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("id", { ascending: true })
            .range(from, to),
        );

        if (leads.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }

        const leadIds = leads.map((l) => l.id as string);

        // 2. Vinculos lead <-> catalogo (em lotes para nao estourar o filtro IN)
        const links: LooseRow[] = [];
        for (let i = 0; i < leadIds.length; i += 300) {
          const chunk = leadIds.slice(i, i + 300);
          const res = await db
            .from(cfg.linkTable)
            .select(`id, lead_id, ${cfg.fk}`)
            .in("lead_id", chunk);
          if (res.error) throw res.error;
          links.push(...((res.data ?? []) as LooseRow[]));
        }

        if (links.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }

        // 3. Catalogo, contatos, etapas e responsaveis
        const contactIds = [...new Set(leads.map((l) => l.contact_id).filter(Boolean))] as string[];
        const assigneeIds = [...new Set(leads.map((l) => l.assigned_to).filter(Boolean))] as string[];

        const [catalogRes, stagesRes] = await Promise.all([
          db.from(cfg.catalogTable).select("id, name").eq("workspace_id", workspaceId),
          db.from("crm_pipeline_stages").select("id, name, color").eq("workspace_id", workspaceId),
        ]);

        const contacts: LooseRow[] = [];
        for (let i = 0; i < contactIds.length; i += 300) {
          const res = await db
            .from("crm_contacts")
            .select("id, name, company")
            .in("id", contactIds.slice(i, i + 300));
          contacts.push(...((res.data ?? []) as LooseRow[]));
        }

        let profiles: LooseRow[] = [];
        if (assigneeIds.length > 0) {
          const res = await db.from("profiles").select("id, name, email").in("id", assigneeIds);
          profiles = (res.data ?? []) as LooseRow[];
        }

        const catalogMap = new Map<string, string>(
          ((catalogRes.data ?? []) as LooseRow[]).map((c) => [c.id as string, c.name as string]),
        );
        const stageMap = new Map<string, LooseRow>(
          ((stagesRes.data ?? []) as LooseRow[]).map((s) => [s.id as string, s]),
        );
        const contactMap = new Map<string, LooseRow>(contacts.map((c) => [c.id as string, c]));
        const profileMap = new Map<string, LooseRow>(profiles.map((p) => [p.id as string, p]));
        const leadMap = new Map<string, LooseRow>(leads.map((l) => [l.id as string, l]));

        const result: PainObjectionRow[] = links
          .map((link) => {
            const lead = leadMap.get(link.lead_id as string);
            if (!lead) return null;
            const contact = lead.contact_id ? contactMap.get(lead.contact_id as string) : undefined;
            const stage = lead.stage_id ? stageMap.get(lead.stage_id as string) : undefined;
            const profile = lead.assigned_to ? profileMap.get(lead.assigned_to as string) : undefined;
            const itemId = link[cfg.fk] as string;
            const status = (lead.status as string) === "won"
              ? "won"
              : (lead.status as string) === "lost"
                ? "lost"
                : "open";

            return {
              id: link.id as string,
              leadId: lead.id as string,
              company: (contact?.company as string) || "—",
              leadName: (contact?.name as string) || (lead.title as string) || "Sem nome",
              itemId,
              itemName: catalogMap.get(itemId) || "Removido",
              assigneeId: (lead.assigned_to as string) || null,
              assigneeName: (profile?.name as string) || (profile?.email as string) || "Sem responsável",
              stageId: (lead.stage_id as string) || null,
              stageName: (stage?.name as string) || "Sem etapa",
              stageColor: (stage?.color as string) || "#3b82f6",
              status,
            } as PainObjectionRow;
          })
          .filter(Boolean) as PainObjectionRow[];

        if (!cancelled) setRows(result);
      } catch (err) {
        console.error("usePainsObjectionsReport error:", err);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, kind, period, startIso, endIso]);

  const availableFilters = useMemo(() => {
    const stages = new Map<string, FilterOption>();
    const assignees = new Map<string, FilterOption>();
    rows.forEach((r) => {
      const stageKey = r.stageId || "__none__";
      const s = stages.get(stageKey);
      if (s) s.count++;
      else stages.set(stageKey, { value: stageKey, label: r.stageName, count: 1 });

      const assigneeKey = r.assigneeId || "__none__";
      const a = assignees.get(assigneeKey);
      if (a) a.count++;
      else assignees.set(assigneeKey, { value: assigneeKey, label: r.assigneeName, count: 1 });
    });
    return {
      stages: [...stages.values()].sort((a, b) => b.count - a.count),
      assignees: [...assignees.values()].sort((a, b) => b.count - a.count),
    };
  }, [rows]);

  return { rows, isLoading, availableFilters };
}

export function applyPainsObjectionsFilters(
  rows: PainObjectionRow[],
  filters: PainsObjectionsFilters,
): PainObjectionRow[] {
  return rows.filter((r) => {
    if (filters.stages.length > 0 && !filters.stages.includes(r.stageId || "__none__")) return false;
    if (filters.status !== "all" && r.status !== filters.status) return false;
    if (filters.assignees.length > 0 && !filters.assignees.includes(r.assigneeId || "__none__")) return false;
    return true;
  });
}
