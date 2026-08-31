// Routing handler module - handles lead routing to human agents

import { getPriorityValue, IntentCategory, ConversationInsights } from "./utils.ts";
import { generateEnrichedBriefing } from "./response-generator.ts";
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { resolveChatAssignee } from "../_shared/routing/chat.ts";
import { assignChatLead } from "../_shared/routing/assign.ts";

// Route lead to available human agent
export async function routeLeadToHumanAgent(
  supabase: any,
  workspaceId: string,
  leadId: string,
  leadPhone: string,
  leadName: string | null,
  agentId: string,
  categoryId: string | null,
  priority: string,
  reason: string
): Promise<{ success: boolean; assignedUserId?: string; assignedUserName?: string; queued?: boolean }> {
  console.log("[ROUTING] Starting intelligent lead routing...");
  try {
    // Fonte única: workspace_routing_config — a tabela routing_config (fantasma,
    // nunca escrita) sai de cena (defeito 1).
    const config = await loadRoutingConfig(supabase, workspaceId);

    const { data: leadRow } = await supabase
      .from("leads").select("contact_id").eq("id", leadId).maybeSingle();
    const contactId = leadRow?.contact_id ?? null;

    // auto_assign desligado: needs_human + notifica o pool, ninguém recebe
    // atribuição — quem pegar no Inbox, pega (spec §6 passo 6).
    if (!config.auto_assign) {
      const res = await resolveChatAssignee(supabase, workspaceId, config, { categoryId, contactId });
      if (res.pool.length > 0) {
        await supabase.from("user_notifications").insert(res.pool.map((c) => ({
          user_id: c.user_id,
          workspace_id: workspaceId,
          type: "lead_needs_human",
          title: "Lead aguardando atendimento",
          message: `Lead ${leadName || leadPhone} precisa de atendimento humano: ${reason}`,
          action_url: `/?lead=${leadId}`,
          related_lead_id: leadId,
          is_read: false,
        })));
      }
      return { success: true, queued: false };
    }

    let res = await resolveChatAssignee(supabase, workspaceId, config, { categoryId, contactId });

    // Pool vazio → fallback (spec §6 passo 5): least_loaded/round_robin refazem
    // o pool ignorando jornada e pausa; queue vai direto para a fila.
    if (!res.userId && config.fallback_strategy !== "queue") {
      res = await resolveChatAssignee(
        supabase, workspaceId,
        { ...config, strategy: config.fallback_strategy },
        { categoryId, contactId, ignoreSchedule: true },
      );
    }

    if (!res.userId) {
      console.log("[ROUTING] No agents available, adding to queue...");
      await supabase.from("lead_queues").upsert({
        workspace_id: workspaceId,
        lead_id: leadId,
        agent_id: agentId,
        category_id: categoryId,
        lead_phone: leadPhone,
        lead_name: leadName,
        status: "waiting",
        priority: getPriorityValue(priority),
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,lead_id" });
      return { success: true, queued: true };
    }

    await assignChatLead(supabase, {
      workspaceId, leadId, leadPhone, leadName,
      agentId, categoryId, priority, reason,
      userId: res.userId,
    });
    console.log(`[ROUTING] Selected agent: ${res.userName}`);
    return { success: true, assignedUserId: res.userId, assignedUserName: res.userName ?? "Agente" };
  } catch (error) {
    console.error("[ROUTING] Error:", error);
    return { success: false };
  }
}

// Map intent to category ID
export async function getCategoryIdFromIntent(
  supabase: any,
  workspaceId: string,
  intent: IntentCategory
): Promise<string | null> {
  const intentToCategoryMap: Record<string, string> = {
    VENDAS: "vendas",
    SUPORTE: "suporte",
    RH: "rh",
    MARKETING: "marketing",
    GERAL: "geral",
  };

  const categoryName = intentToCategoryMap[intent] || "geral";

  const { data: category } = await supabase
    .from("chat_categories")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", `%${categoryName}%`)
    .eq("is_active", true)
    .limit(1)
    .single();

  return category?.id || null;
}

// Handle handoff to human agent
export async function handleHandoff(
  supabase: any,
  leadId: string,
  workspaceId: string,
  reason: string,
  insights: ConversationInsights,
  conversationHistory: { role: string; content: string }[],
  apiKey: string,
  leadPhone?: string,
  leadName?: string,
  agentId?: string,
  intent?: IntentCategory
): Promise<{ routed: boolean; assignedUserName?: string; queued?: boolean }> {
  console.log("[HANDOFF] Triggering handoff for lead:", leadId);
  
  // Generate enriched briefing
  const enrichedBriefing = await generateEnrichedBriefing(insights, conversationHistory, apiKey);
  
  // Update lead status
  await supabase
    .from("leads")
    .update({ 
      status: "needs_human",
      ai_summary: enrichedBriefing,
      insights: insights
    })
    .eq("id", leadId);

  // Route to human
  let routingResult = { success: false, queued: false, assignedUserName: undefined as string | undefined };
  
  if (agentId && leadPhone) {
    const categoryId = intent 
      ? await getCategoryIdFromIntent(supabase, workspaceId, intent)
      : null;
    
    let priority = "normal";
    if (insights.urgency_level === "critica") priority = "urgent";
    else if (insights.urgency_level === "alta") priority = "high";

    const result = await routeLeadToHumanAgent(
      supabase, workspaceId, leadId, leadPhone, leadName || null,
      agentId, categoryId, priority, reason
    );
    
    routingResult = {
      success: result.success,
      queued: result.queued || false,
      assignedUserName: result.assignedUserName
    };
  }

  // Insert handoff message
  let handoffMessage = "";
  if (routingResult.success && routingResult.assignedUserName) {
    handoffMessage = `Entendo sua preocupação. Estou transferindo você para ${routingResult.assignedUserName}, que poderá ajudá-lo(a) da melhor forma possível. Por favor, aguarde um momento.`;
  } else if (routingResult.queued) {
    handoffMessage = "Entendo sua preocupação. Todos os nossos agentes estão ocupados no momento, mas você está na fila de atendimento prioritário. Um agente entrará em contato em breve.";
  } else {
    handoffMessage = "Entendo sua preocupação. Um agente humano entrará em contato em breve para ajudá-lo(a) da melhor forma possível. Por favor, aguarde alguns instantes.";
  }
  
  await supabase.from("messages").insert({
    lead_id: leadId,
    workspace_id: workspaceId,
    content: handoffMessage,
    sender_type: "ai",
  });

  return {
    routed: routingResult.success,
    assignedUserName: routingResult.assignedUserName,
    queued: routingResult.queued
  };
}

// Update lead insights
export async function updateLeadInsights(
  supabase: any,
  leadId: string,
  insights: ConversationInsights
): Promise<void> {
  await supabase
    .from("leads")
    .update({ 
      insights: insights,
      ai_summary: insights.conversation_summary
    })
    .eq("id", leadId);
}

// Send specialist suggestion
export async function sendSpecialistSuggestion(
  supabase: any,
  leadId: string,
  workspaceId: string,
  specialistCategory: string,
  objections: any[]
): Promise<void> {
  const categoryLabels: Record<string, string> = {
    VENDAS: "soluções comerciais",
    SUPORTE: "suporte técnico especializado",
    RH: "recursos humanos",
    MARKETING: "marketing e parcerias",
  };
  
  const specialistLabel = categoryLabels[specialistCategory] || specialistCategory.toLowerCase();
  const mainObjection = objections.find((o: any) => o.severity >= 4);
  
  const suggestionMessage = mainObjection
    ? `Percebi que você tem algumas dúvidas sobre ${mainObjection.type}. Posso chamar nosso especialista em ${specialistLabel} para encontrar a melhor solução para você. Deseja que eu faça a transferência?`
    : `Posso chamar nosso especialista em ${specialistLabel} para ajudá-lo melhor. Deseja que eu faça a transferência?`;
  
  await supabase.from("messages").insert({
    lead_id: leadId,
    workspace_id: workspaceId,
    content: suggestionMessage,
    sender_type: "ai",
  });
}
