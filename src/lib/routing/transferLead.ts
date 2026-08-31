import { supabase } from '@/integrations/supabase/client';

interface TransferOptions {
  leadId: string;
  fromUserId: string;
  toUserId: string;
  categoryId?: string;
  reason: string;
  workspaceId: string;
  agentId: string;
}

interface TransferResult {
  success: boolean;
  error?: string;
}

export async function transferLead(options: TransferOptions): Promise<TransferResult> {
  try {
    const { leadId, fromUserId, toUserId, categoryId, reason, workspaceId, agentId } = options;

    // 1. Atualizar fila (re-ancora no novo atendente)
    await supabase
      .from('lead_queues')
      .update({
        assigned_to_user_id: toUserId,
        category_id: categoryId,
        status: 'assigned',
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('lead_id', leadId)
      .eq('workspace_id', workspaceId)
      .in('status', ['waiting', 'assigned', 'in_progress']);

    // 2. Marcar atribuição anterior como transferida
    await supabase
      .from('lead_assignments')
      .update({
        result: 'unresolved',
        notes: `Transferido para outro agente: ${reason}`,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('lead_id', leadId)
      .eq('assigned_to_user_id', fromUserId)
      .is('completed_at', null);

    // 3. Criar novo registro de atribuição
    await supabase
      .from('lead_assignments')
      .insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        category_id: categoryId,
        assigned_to_user_id: toUserId,
        assigned_by_agent_id: agentId,
        reason: `Transferência: ${reason}`,
        priority: 'high',
        assigned_at: new Date().toISOString()
      });

    // 4. Notificar novo agente
    await supabase
      .from('user_notifications')
      .insert({
        user_id: toUserId,
        workspace_id: workspaceId,
        type: 'lead_assigned',
        title: 'Atendimento transferido',
        message: `Atendimento transferido para você: ${reason}`,
        action_url: `/?lead=${leadId}`,
        related_lead_id: leadId,
        related_user_id: fromUserId,
        is_read: false,
        created_at: new Date().toISOString()
      });

    // 5. Notificar agente anterior
    await supabase
      .from('user_notifications')
      .insert({
        user_id: fromUserId,
        workspace_id: workspaceId,
        type: 'system',
        title: 'Atendimento transferido',
        message: `Atendimento transferido com sucesso: ${reason}`,
        action_url: `/?lead=${leadId}`,
        related_lead_id: leadId,
        is_read: false,
        created_at: new Date().toISOString()
      });

    return { success: true };
  } catch (error) {
    console.error('Transfer error:', error);
    return { success: false, error: String(error) };
  }
}

