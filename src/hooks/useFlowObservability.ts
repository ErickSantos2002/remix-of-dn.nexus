import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Métricas agregadas por nó, a partir de crm_flow_step_log. */
export interface NodeMetrics {
  entered: number;   // passaram pelo nó (entered + branch_* + sent + skipped + failed)
  sent: number;      // envios concluídos / ações aplicadas
  failed: number;
  skipped: number;
  rescheduled: number;
  branchTrue: number;
  branchFalse: number;
}

const EMPTY: NodeMetrics = {
  entered: 0, sent: 0, failed: 0, skipped: 0, rescheduled: 0, branchTrue: 0, branchFalse: 0,
};

/**
 * Agrega o step log do fluxo por nó. Faz paging (o PostgREST corta em 1000)
 * e só roda enquanto o fluxo estiver ativo/pausado — em rascunho não há dados.
 */
export function useFlowMetrics(flowId?: string, enabled = true) {
  return useQuery({
    queryKey: ["crm-flow-metrics", flowId],
    enabled: !!flowId && enabled,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async (): Promise<Record<string, NodeMetrics>> => {
      const PAGE = 1000;
      const rows: { node_id: string; result: string }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("crm_flow_step_log")
          .select("node_id, result")
          .eq("flow_id", flowId!)
          .order("occurred_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) break;
      }

      const out: Record<string, NodeMetrics> = {};
      for (const r of rows) {
        const m = (out[r.node_id] ??= { ...EMPTY });
        m.entered++;
        if (r.result === "sent") m.sent++;
        else if (r.result === "failed") m.failed++;
        else if (r.result === "skipped") m.skipped++;
        else if (r.result === "rescheduled") { m.rescheduled++; m.entered--; } // reagendamento não é passagem nova
        else if (r.result === "branch_true") m.branchTrue++;
        else if (r.result === "branch_false") m.branchFalse++;
      }
      return out;
    },
  });
}

export interface FlowRunRow {
  id: string;
  lead_id: string;
  state: string;
  exit_reason: string | null;
  current_node_id: string | null;
  wakeup_at: string;
  entered_at: string;
  updated_at: string;
  lead_title: string | null;
  contact_id: string | null;
  contact_name: string | null;
}

/** Leads que passaram pelo fluxo (abertos primeiro, depois os mais recentes). */
export function useFlowRuns(flowId?: string, open = false) {
  return useQuery({
    queryKey: ["crm-flow-runs", flowId],
    enabled: !!flowId && open,
    refetchInterval: open ? 60_000 : false,
    queryFn: async (): Promise<FlowRunRow[]> => {
      const { data, error } = await supabase
        .from("crm_flow_runs")
        .select("id, lead_id, state, exit_reason, current_node_id, wakeup_at, entered_at, updated_at")
        .eq("flow_id", flowId!)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const runs = data || [];
      if (runs.length === 0) return [];

      const leadIds = Array.from(new Set(runs.map((r) => r.lead_id)));
      const { data: leads } = await supabase
        .from("crm_leads")
        .select("id, title, contact_id, crm_contacts(name)")
        .in("id", leadIds);
      const info = new Map<string, { title: string | null; contact_id: string | null; contact_name: string | null }>();
      for (const l of leads || []) {
        const contact = l.crm_contacts as { name: string | null } | null;
        info.set(l.id, { title: l.title, contact_id: l.contact_id, contact_name: contact?.name ?? null });
      }

      const openFirst = (s: string) => (s === "active" || s === "waiting" ? 0 : 1);
      return runs
        .map((r) => ({
          ...r,
          lead_title: info.get(r.lead_id)?.title ?? null,
          contact_id: info.get(r.lead_id)?.contact_id ?? null,
          contact_name: info.get(r.lead_id)?.contact_name ?? null,
        }))
        .sort((a, b) => openFirst(a.state) - openFirst(b.state));
    },
  });
}

/** Uma comunicação (ou tentativa) registrada pelo fluxo para um lead. */
export interface RunAuditItem {
  id: string;
  node_id: string;
  node_type: string;
  result: string;          // sent | failed | skipped | rescheduled
  reason: string | null;
  occurred_at: string;
  message_content: string | null;
  media_type: string | null;
  delivery_status: string | null;
}

/**
 * Auditoria de um run: tudo que os nós de envio registraram no step log,
 * com o conteúdo real da mensagem (tabela messages) quando houver.
 */
export function useFlowRunAudit(runId?: string, open = false) {
  return useQuery({
    queryKey: ["crm-flow-run-audit", runId],
    enabled: !!runId && open,
    queryFn: async (): Promise<RunAuditItem[]> => {
      const { data, error } = await supabase
        .from("crm_flow_step_log")
        .select("id, node_id, node_type, result, detail, occurred_at")
        .eq("run_id", runId!)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      // Auditoria: envios (todos os resultados), decisões de condição e fechamento.
      // Esperas ficam de fora (ruído); a decisão da condição explica por que um
      // ramo de envios não rodou.
      const rows = (data || []).filter(
        (r) =>
          r.node_type === "send_whatsapp" ||
          r.node_type === "send_email" ||
          (r.node_type === "branch" && (r.result === "branch_true" || r.result === "branch_false")) ||
          r.node_type === "close_lead",
      );

      const messageIds = Array.from(new Set(
        rows
          .map((r) => (r.detail as { message_id?: number } | null)?.message_id)
          .filter((x): x is number => typeof x === "number"),
      ));
      const msgById = new Map<number, { content: string | null; media_type: string | null; delivery_status: string | null }>();
      if (messageIds.length > 0) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("id, content, media_type, delivery_status")
          .in("id", messageIds);
        for (const m of msgs || []) {
          msgById.set(m.id, { content: m.content, media_type: m.media_type, delivery_status: m.delivery_status });
        }
      }

      return rows.map((r) => {
        const detail = (r.detail as { message_id?: number; reason?: string } | null) || {};
        const msg = typeof detail.message_id === "number" ? msgById.get(detail.message_id) : undefined;
        return {
          id: r.id,
          node_id: r.node_id,
          node_type: r.node_type,
          result: r.result,
          reason: detail.reason ?? null,
          occurred_at: r.occurred_at,
          message_content: msg?.content ?? null,
          media_type: msg?.media_type ?? null,
          delivery_status: msg?.delivery_status ?? null,
        };
      });
    },
  });
}
