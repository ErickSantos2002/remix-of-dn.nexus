// Escritor ÚNICO da atribuição de chat (spec §5.1). Handoff e worker chamam
// isto; nada mais escreve lead_queues/lead_assignments/last_activity_at.
const PRIORITY_VALUE: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export interface AssignChatLeadParams {
  workspaceId: string;
  leadId: string;
  leadPhone: string;
  leadName: string | null;
  agentId: string | null;   // agente de IA que originou o handoff (pode não haver)
  categoryId: string | null;
  priority: string;         // low | normal | high | urgent
  priorityValue?: number;   // worker repassa o valor já gravado na fila
  reason: string;
  userId: string;           // atendente escolhido
}

export async function assignChatLead(supabase: any, p: AssignChatLeadParams): Promise<void> {
  const now = new Date().toISOString();

  // UNIQUE (workspace_id, lead_id): upsert atualiza a própria linha waiting
  // quando existe, em vez de inserir outra (spec §5.1; recon 2).
  const { error: qErr } = await supabase.from("lead_queues").upsert({
    workspace_id: p.workspaceId,
    lead_id: p.leadId,
    lead_phone: p.leadPhone,
    lead_name: p.leadName,
    agent_id: p.agentId,
    category_id: p.categoryId,
    assigned_to_user_id: p.userId,
    status: "assigned",
    priority: p.priorityValue ?? PRIORITY_VALUE[p.priority] ?? 1,
    assigned_at: now,
    completed_at: null,
    updated_at: now,
  }, { onConflict: "workspace_id,lead_id" });
  if (qErr) console.error("[ROUTING] assignChatLead lead_queues:", qErr.message);

  const { error: aErr } = await supabase.from("lead_assignments").insert({
    workspace_id: p.workspaceId,
    lead_id: p.leadId,
    category_id: p.categoryId,
    assigned_to_user_id: p.userId,
    assigned_by_agent_id: p.agentId,
    reason: p.reason,
    priority: p.priority,
    assigned_at: now,
  });
  if (aErr) console.error("[ROUTING] assignChatLead lead_assignments:", aErr.message);

  await supabase.from("leads")
    .update({ assigned_to_user_id: p.userId, assigned_at: now })
    .eq("id", p.leadId);

  // Único escritor de last_activity_at (spec §4.3) — é o cursor do round_robin.
  await supabase.from("agent_availability").upsert({
    workspace_id: p.workspaceId,
    user_id: p.userId,
    last_activity_at: now,
    updated_at: now,
  }, { onConflict: "workspace_id,user_id" });

  // Notificação via tabela central (padrão do CLAUDE.md — NotificationBell reage por realtime).
  await supabase.from("user_notifications").insert({
    user_id: p.userId,
    workspace_id: p.workspaceId,
    type: "lead_assigned",
    title: "Novo atendimento",
    message: `Lead ${p.leadName || p.leadPhone} precisa de atendimento humano: ${p.reason}`,
    action_url: `/?lead=${p.leadId}`,
    related_lead_id: p.leadId,
    is_read: false,
  });
}
