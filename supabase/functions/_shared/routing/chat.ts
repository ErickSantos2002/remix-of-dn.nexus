// Pool + decisão do chat (spec §6). Consumido pelo orchestrator e pelo
// routing-queue-worker — nunca reimplementar este funil em outro lugar.
import { RoutingConfig, ChatCandidate, ChatResolution } from "./types.ts";
import { isWithinWorkingHours } from "./workhours.ts";
import { getChatLoad, loadHolidays } from "./load.ts";
import { getCardOwner } from "./owner.ts";
import { selectAssignee } from "./select.ts";

interface MemberRow { user_id: string; name: string | null; email: string | null }

/** Owner + workspace_members ativos, com perfil (spec §6 passo 1). */
async function listWorkspaceMembers(supabase: any, workspaceId: string): Promise<MemberRow[]> {
  const [{ data: ws }, { data: members }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).single(),
    supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active"),
  ]);
  const ids = new Set<string>();
  if (ws?.owner_id) ids.add(ws.owner_id);
  for (const m of members || []) ids.add(m.user_id);
  if (ids.size === 0) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", [...ids]);
  return [...ids].map((id) => {
    const p = (profiles || []).find((x: any) => x.id === id);
    return { user_id: id, name: p?.name ?? null, email: p?.email ?? null };
  });
}

export interface ChatPoolOptions {
  categoryId?: string | null;
  contactId?: string | null;
  /** true no fallback least_loaded/round_robin: ignora jornada e pausa,
   *  mantém o teto de capacidade (spec §6 passo 5). */
  ignoreSchedule?: boolean;
}

export async function resolveChatAssignee(
  supabase: any, workspaceId: string, config: RoutingConfig, opts: ChatPoolOptions = {},
): Promise<ChatResolution> {
  const members = await listWorkspaceMembers(supabase, workspaceId);
  if (members.length === 0) return { userId: null, userName: null, viaFallback: false, pool: [] };
  const ids = members.map((m) => m.user_id);

  const [calRes, avRes, holidays, loads] = await Promise.all([
    supabase.from("crm_agent_calendars")
      .select("agent_id, work_days, work_start_time, work_end_time, timezone")
      .eq("workspace_id", workspaceId),
    supabase.from("agent_availability")
      .select("user_id, is_accepting_leads, max_concurrent_leads, last_activity_at")
      .eq("workspace_id", workspaceId),
    loadHolidays(supabase, workspaceId),
    getChatLoad(supabase, workspaceId, ids),
  ]);
  const calMap = new Map((calRes.data || []).map((c: any) => [c.agent_id, c]));
  const avMap = new Map((avRes.data || []).map((a: any) => [a.user_id, a]));

  // Ausência de linha em agent_availability = aceitando, teto padrão (spec §4.3).
  const candidates: ChatCandidate[] = members.map((m) => {
    const av = avMap.get(m.user_id) as any;
    return {
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      is_accepting_leads: av?.is_accepting_leads ?? true,
      max_concurrent_leads: av?.max_concurrent_leads ?? config.max_leads_per_agent,
      last_activity_at: av?.last_activity_at ?? null,
      load: loads.get(m.user_id) ?? 0,
    };
  });

  let pool = candidates.filter((c) =>
    c.load < c.max_concurrent_leads &&
    (opts.ignoreSchedule ||
      (c.is_accepting_leads && isWithinWorkingHours(calMap.get(c.user_id) ?? null, holidays)))
  );

  // Categoria é pré-filtro; se zerar o pool, é ignorado — melhor alguém fora
  // da categoria que ninguém (spec §6 passo 2). Aplica-se nas DUAS passadas:
  // o fallback (ignoreSchedule) só ignora jornada e pausa, não categoria (spec §6 passo 5).
  if (config.category_matching && opts.categoryId && pool.length > 0) {
    const { data: catRows } = await supabase
      .from("category_agent_assignments")
      .select("agent_id")
      .eq("workspace_id", workspaceId)
      .eq("category_id", opts.categoryId);
    const catIds = new Set((catRows || []).map((r: any) => r.agent_id));
    if (catIds.size > 0) {
      const filtered = pool.filter((c) => catIds.has(c.user_id));
      if (filtered.length > 0) pool = filtered;
    }
  }

  if (pool.length === 0) return { userId: null, userName: null, viaFallback: false, pool: [] };

  const ownerId = config.respect_card_owner
    ? await getCardOwner(supabase, workspaceId, opts.contactId)
    : null;

  const chosen = selectAssignee(pool.map((c) => c.user_id), {
    strategy: config.strategy,
    loads: new Map(pool.map((c) => [c.user_id, c.load])),
    ownerId,
    lastActivity: new Map(pool.map((c) => [c.user_id, c.last_activity_at])),
  });
  const cand = pool.find((c) => c.user_id === chosen) ?? null;
  return {
    userId: chosen,
    userName: cand?.name || cand?.email || null,
    viaFallback: !!opts.ignoreSchedule,
    pool,
  };
}
