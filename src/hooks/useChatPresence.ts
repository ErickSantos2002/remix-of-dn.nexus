// Presença derivada dos membros do workspace para as telas de roteamento
// (spec §10.1). Só leitura e rótulo — a decisão é do backend.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CALENDAR, type AgentCalendar } from "@/lib/routing/workhours";
import { computePresence, type PresenceState } from "@/lib/routing/presence";

export interface MemberPresence {
  state: PresenceState;
  load: number;
  maxConcurrentLeads: number;
  isAcceptingLeads: boolean;
  /** Janela exibida ao lado de "Fora do horário", ex.: "09:00–18:00". */
  workWindow: string;
}

export function useChatPresence(workspaceId: string | undefined) {
  const query = useQuery({
    queryKey: ["chat-presence", workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const wsId = workspaceId!;
      const [{ data: ws }, { data: members }] = await Promise.all([
        supabase.from("workspaces").select("owner_id").eq("id", wsId).single(),
        supabase.from("workspace_members").select("user_id").eq("workspace_id", wsId).eq("status", "active"),
      ]);
      const ids = new Set<string>();
      if (ws?.owner_id) ids.add(ws.owner_id);
      for (const m of members || []) ids.add(m.user_id);
      const userIds = [...ids];
      if (userIds.length === 0) return new Map<string, MemberPresence>();

      const [calRes, avRes, holRes, loadRes] = await Promise.all([
        supabase.from("crm_agent_calendars")
          .select("agent_id, work_days, work_start_time, work_end_time, timezone")
          .eq("workspace_id", wsId),
        supabase.from("agent_availability")
          .select("user_id, is_accepting_leads, max_concurrent_leads")
          .eq("workspace_id", wsId),
        supabase.from("crm_holidays").select("date").eq("workspace_id", wsId),
        // RPC ainda fora do types.ts gerado — padrão do projeto (useFlows.ts)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)("chat_load_by_user", { p_workspace_id: wsId, p_user_ids: userIds }),
      ]);

      const calMap = new Map<string, Partial<AgentCalendar> & { agent_id: string }>(
        ((calRes.data || []) as Array<Partial<AgentCalendar> & { agent_id: string }>).map((c) => [c.agent_id, c]),
      );
      const avMap = new Map<string, { user_id: string; is_accepting_leads: boolean; max_concurrent_leads: number }>(
        ((avRes.data || []) as Array<{ user_id: string; is_accepting_leads: boolean; max_concurrent_leads: number }>).map(
          (a) => [a.user_id, a],
        ),
      );
      const holidays = new Set<string>(((holRes.data || []) as Array<{ date: string }>).map((h) => h.date));
      const loads = new Map<string, number>(
        ((loadRes.data || []) as Array<{ user_id: string; load: number }>).map((r) => [r.user_id, Number(r.load) || 0]),
      );

      const result = new Map<string, MemberPresence>();
      for (const uid of userIds) {
        const cal = calMap.get(uid) ?? null;
        const av = avMap.get(uid);
        const load = loads.get(uid) ?? 0;
        const maxConcurrentLeads = av?.max_concurrent_leads ?? 10;
        const isAcceptingLeads = av?.is_accepting_leads ?? true;
        result.set(uid, {
          state: computePresence({ calendar: cal, holidays, isAcceptingLeads, load, maxConcurrentLeads }),
          load,
          maxConcurrentLeads,
          isAcceptingLeads,
          // work_start_time/work_end_time vêm como "HH:MM:SS" (coluna `time` do Postgres via PostgREST) — cortar para "HH:MM".
          workWindow: `${(cal?.work_start_time || DEFAULT_CALENDAR.work_start_time).slice(0, 5)}–${(cal?.work_end_time || DEFAULT_CALENDAR.work_end_time).slice(0, 5)}`,
        });
      }
      return result;
    },
  });
  return { presence: query.data ?? new Map<string, MemberPresence>(), isLoading: query.isLoading };
}
