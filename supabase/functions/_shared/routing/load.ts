// Carga derivada — sempre via RPC, nunca contador persistido (spec §6.1, §7.1)
// nem select + contagem no cliente (teto silencioso de 1000 linhas do PostgREST).

async function loadByRpc(
  supabase: any, fn: string, params: Record<string, unknown>, userIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of userIds) map.set(id, 0);
  if (userIds.length === 0) return map;
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    // Falha de carga não pode derrubar o roteamento: segue com carga 0
    // (ninguém excluído por capacidade; o rodízio ainda distribui).
    console.error(`[ROUTING] ${fn}:`, error.message);
    return map;
  }
  for (const row of data || []) map.set(row.user_id, Number(row.load) || 0);
  return map;
}

/** Leads de chat abertos (lead_queues assigned/in_progress), por atendente. */
export function getChatLoad(supabase: any, workspaceId: string, userIds: string[]): Promise<Map<string, number>> {
  return loadByRpc(supabase, "chat_load_by_user", { p_workspace_id: workspaceId, p_user_ids: userIds }, userIds);
}

/** Reuniões na janela (inclui completed/no_show — reunião distribuída é carga). */
export function getSchedulingLoad(
  supabase: any, workspaceId: string, userIds: string[], windowDays: number,
): Promise<Map<string, number>> {
  return loadByRpc(
    supabase,
    "scheduling_load_by_user",
    { p_workspace_id: workspaceId, p_user_ids: userIds, p_window_days: windowDays },
    userIds,
  );
}

/** Datas "YYYY-MM-DD" de crm_holidays do workspace (spec §4.4). */
export async function loadHolidays(supabase: any, workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("crm_holidays").select("date").eq("workspace_id", workspaceId);
  if (error) console.error("[ROUTING] loadHolidays:", error.message);
  return new Set(((data || []) as Array<{ date: string }>).map((h) => h.date));
}
