// Main orchestrator - refactored to use modular components
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders, getDefaultInsights, IntentCategory } from "./utils.ts";
import { detectNewSession } from "./session-detector.ts";
import { analyzeIntent, analyzeCurrentMessageSentiment, analyzeConversationInsights, extractContactData } from "./intent-analyzer.ts";
import { selectAgentByCategory, getAgentName, getAgentById, logAgentTransfer, sendTransferNotification, shouldSuggestSpecialist } from "./agent-selector.ts";
import { retrieveRelevantDocuments } from "./rag-retriever.ts";
import { buildAugmentedPrompt, generateAIResponse, buildAppointmentContext } from "./response-generator.ts";
import { handleHandoff, updateLeadInsights, sendSpecialistSuggestion } from "./routing-handler.ts";
import { sendMessageChunks } from "./message-splitter.ts";
import {
  isSchedulingToolEnabled,
  generateResponseWithTools,
  executeTool,
  buildToolAwarePrompt,
  detectToolIntentWithLLM,
  parsePendingSchedulingAction,
  isStrictConfirmation,
  clearPendingSchedulingAction,
  composeToolResponse
} from "./tool-executor.ts";
import { getAgentTools, buildToolsArray } from "./tool-catalog.ts";
import { squash } from "../_shared/contactDataGuard.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Nomes que a IA nunca deve gravar como dado do lead: a empresa dona da conta,
 * o workspace e os agentes. Alimenta tanto o prompt quanto a blocklist
 * deterministica de contactDataGuard.
 *
 * Cache de modulo porque o valor quase nao muda e a chamada acontece a cada
 * mensagem recebida. 5 min de defasagem em nome de agente e irrelevante.
 */
const tenantNamesCache = new Map<string, { names: string[]; ts: number }>();
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

async function getTenantNames(supabase: SupabaseClient, workspaceId: string): Promise<string[]> {
  const hit = tenantNamesCache.get(workspaceId);
  if (hit && Date.now() - hit.ts < TENANT_CACHE_TTL_MS) return hit.names;

  const names: string[] = [];
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("name, company_id")
      .eq("id", workspaceId)
      .maybeSingle();
    if (ws?.name) names.push(ws.name);

    if (ws?.company_id) {
      const { data: comp } = await supabase
        .from("companies")
        .select("name")
        .eq("id", ws.company_id)
        .maybeSingle();
      if (comp?.name) names.push(comp.name);
    }

    // Dual agent tables: agents (legado) + agent_instances
    const [inst, legacy] = await Promise.all([
      supabase.from("agent_instances").select("name").eq("workspace_id", workspaceId),
      supabase.from("agents").select("name").eq("workspace_id", workspaceId),
    ]);
    for (const row of [...(inst.data || []), ...(legacy.data || [])]) {
      if (row?.name) names.push(row.name);
    }
  } catch (e) {
    console.error("[TENANT-GUARD] Erro ao montar blocklist:", e);
  }

  const unique = Array.from(new Set(names));
  tenantNamesCache.set(workspaceId, { names: unique, ts: Date.now() });
  return unique;
}

serve(async (req) => {
  const requestStartTime = Date.now();
  console.log("[ORCHESTRATOR] ====== REQUEST STARTED ======");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const record = payload.record;
    
    if (!record) {
      return new Response(JSON.stringify({ message: "No record in payload" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { lead_id, workspace_id, sender_type } = record;
    let content: string = record.content;

    if (sender_type !== "lead") {
      return new Response(JSON.stringify({ message: "Skipped: not a lead message" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // === INIT GREETING DETECTION ===
    // Check if this is an initialization greeting trigger from widget-chat
    const isInitGreeting = content === "__INIT_GREETING__";
    
    if (isInitGreeting) {
      console.log(`[ORCHESTRATOR] Detected init greeting for lead: ${lead_id}`);
      
      // Initialize Supabase client for init greeting
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { global: { headers: { "x-nexus-source": "orchestrator" } } }
      );
      
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
      
      // Fetch lead to get assigned agent
      const { data: lead } = await supabase
        .from("leads")
        .select("assigned_agent_id, name, workspace_id")
        .eq("id", lead_id)
        .single();
      
      if (!lead?.assigned_agent_id) {
        console.log("[ORCHESTRATOR] No agent assigned, skipping greeting");
        return new Response(JSON.stringify({ message: "No agent for greeting" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      // Get agent data using existing function
      const agent = await getAgentById(supabase, lead.assigned_agent_id);
      
      if (!agent) {
        console.log("[ORCHESTRATOR] Agent not found, skipping greeting");
        return new Response(JSON.stringify({ message: "Agent not found" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      // Generate greeting using agent's persona
      const greetingPrompt = `${agent.persona_prompt || "Voce e um assistente virtual prestativo."}

INSTRUCAO ESPECIAL: O usuario acabou de iniciar uma conversa. Faca um cumprimento breve e cordial, apresente-se rapidamente (se houver instrucoes no seu prompt sobre apresentacao) e pergunte como pode ajudar.

REGRAS:
- Seja breve (1-3 frases no maximo)
- Use um tom amigavel e acolhedor
- NAO mencione termos tecnicos ou que voce e uma IA
- Se voce tem um nome definido no seu prompt, use-o para se apresentar
- Termine com uma pergunta aberta para engajar o usuario

Responda APENAS com o cumprimento, sem explicacoes adicionais.`;
      
      try {
        const greetingResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [{ role: "user", content: greetingPrompt }],
            max_tokens: 200,
            temperature: 0.7,
          }),
        });
        
        if (!greetingResponse.ok) {
          throw new Error(`Greeting API error: ${greetingResponse.status}`);
        }
        
        const greetingData = await greetingResponse.json();
        const greetingContent = greetingData.choices?.[0]?.message?.content?.trim();
        
        if (greetingContent) {
          // Save greeting as AI message
          await supabase.from("messages").insert({
            lead_id,
            workspace_id,
            content: greetingContent,
            sender_type: "ai",
            agent_id: agent.id,
            responding_agent_id: agent.id,
          });
          
          console.log(`[ORCHESTRATOR] Agent greeting sent: "${greetingContent.substring(0, 50)}..."`);
        }
      } catch (greetingError) {
        console.error("[ORCHESTRATOR] Error generating greeting:", greetingError);
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        type: "init_greeting",
        agent: agent.name 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    // === END INIT GREETING DETECTION ===

    console.log(`[ORCHESTRATOR] Processing message from lead: ${lead_id}`);

    // Initialize clients
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { "x-nexus-source": "orchestrator" } } }
    );
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // STEP 1: Fetch lead with contact_id
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*, assigned_agent_id, contact_id")
      .eq("id", lead_id)
      .single();

    if (leadError) throw new Error(`Failed to fetch lead: ${leadError.message}`);

    // CRITICAL: Skip AI processing if human is handling this lead
    if (lead.status === "human_talking" || lead.status === "needs_human" || lead.assigned_to_user_id) {
      console.log(`[ORCHESTRATOR] Skipped: lead ${lead_id} is being handled by human (status=${lead.status}, assigned_to_user_id=${lead.assigned_to_user_id})`);
      return new Response(JSON.stringify({
        message: "Skipped: human is handling this lead",
        lead_id,
        status: lead.status,
        assigned_to_user_id: lead.assigned_to_user_id
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const previousAgentId = lead.assigned_agent_id;
    const previousAgentName = previousAgentId ? await getAgentName(supabase, previousAgentId) : null;

    // ─── MESSAGE DEBOUNCE: agrupa mensagens em rajada do lead ───────────
    // Espera N segundos; se chegar nova mensagem do lead, esta execução aborta
    // e a invocação mais recente trata tudo de uma vez (com timer renovado).
    try {
      const triggerMessageId: string | undefined = record.id;
      const triggerCreatedAt: string | undefined = record.created_at;

      let debounceSeconds = 5;
      if (previousAgentId) {
        const [instRes, legRes] = await Promise.all([
          supabase.from("agent_instances").select("message_debounce_seconds").eq("id", previousAgentId).maybeSingle(),
          supabase.from("agents").select("message_debounce_seconds").eq("id", previousAgentId).maybeSingle(),
        ]);
        const v = (instRes.data as { message_debounce_seconds?: number } | null)?.message_debounce_seconds ?? (legRes.data as { message_debounce_seconds?: number } | null)?.message_debounce_seconds;
        if (typeof v === "number") debounceSeconds = v;
      }

      if (debounceSeconds > 0 && triggerCreatedAt) {
        console.log(`[DEBOUNCE] waiting ${debounceSeconds}s for follow-up messages (lead ${lead_id})`);
        await new Promise((r) => setTimeout(r, debounceSeconds * 1000));

        const { data: laterMsgs } = await supabase
          .from("messages")
          .select("id, content, created_at")
          .eq("lead_id", lead_id)
          .eq("sender_type", "lead")
          .gt("created_at", triggerCreatedAt)
          .order("created_at", { ascending: true });

        if (laterMsgs && laterMsgs.length > 0) {
          console.log(`[DEBOUNCE] aborting: ${laterMsgs.length} newer lead message(s) arrived; latest invocation will handle`);
          return new Response(JSON.stringify({
            success: true,
            debounced: true,
            aborted: true,
            newer_messages: laterMsgs.length,
            trigger_message_id: triggerMessageId,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Janela cumprida: agregar mensagens de lead consecutivas sem resposta da IA
        const { data: recentMsgs } = await supabase
          .from("messages")
          .select("content, sender_type, created_at")
          .eq("lead_id", lead_id)
          .order("created_at", { ascending: false })
          .limit(20);

        if (recentMsgs && recentMsgs.length > 0) {
          const trailing: string[] = [];
          for (const m of recentMsgs) {
            if (m.sender_type === "lead") {
              trailing.unshift(m.content);
            } else {
              break;
            }
          }
          const cleaned = trailing.filter((c) => c && c !== "__INIT_GREETING__");
          if (cleaned.length > 1) {
            content = cleaned.join("\n");
            console.log(`[DEBOUNCE] aggregated ${cleaned.length} lead messages into single context`);
          }
        }
      }
    } catch (debounceErr) {
      console.error("[DEBOUNCE] error (continuing without debounce):", debounceErr);
    }
    // ─── END DEBOUNCE ───────────────────────────────────────────────────


    // STEP 2: Fetch messages (DESC to get most recent, then reverse for chronological order)
    const { data: messagesDesc } = await supabase
      .from("messages")
      .select("content, sender_type, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(50);
    
    const messages = messagesDesc?.reverse() || [];

    console.log(`[ORCHESTRATOR] Found ${messages?.length || 0} messages`);

    // STEP 3: Detect session
    const sessionInfo = await detectNewSession(messages || [], content, LOVABLE_API_KEY);
    console.log(`[ORCHESTRATOR] Session: isNewSession=${sessionInfo.isNewSession}, reason=${sessionInfo.reason}`);

    // Filter out __INIT_GREETING__ messages from history
    const conversationHistory = (messages || [])
      .filter((msg: { content: string }) => msg.content !== "__INIT_GREETING__")
      .map((msg: { sender_type: string; content: string }) => ({
        role: msg.sender_type === "lead" ? "user" : "assistant",
        content: msg.content,
      }));

    // STEP 4: OPTIMIZED - Intent + sentiment + tool decision all in parallel
    // Insights and contact extraction are deferred to background (fire-and-forget)
    let intent: IntentCategory;
    let currentMsgSentiment: number;
    let insights = getDefaultInsights(); // Start with defaults, update in background
    let contactData: Record<string, string> = {};
    
    // PRE-STEP 4: Quick DB check for scheduling tool (~50ms) - needed for tool decision
    const schedulingCheck = await isSchedulingToolEnabled(supabase, workspace_id, lead.assigned_agent_id || "");
    const enabledToolNames: string[] = [];
    if (schedulingCheck.enabled) enabledToolNames.push("schedule_appointment");
    
    // Tool decision result - will be populated in parallel
    let toolDecision = { shouldUseTools: false, action: "none", reason: "fallback" };
    
    try {
      // Extract last assistant message for transfer confirmation detection
      const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === "assistant")?.content || "";
      
      // FAST PATH: Intent + sentiment + tool decision ALL in parallel
      const [intentResult, sentimentResult, toolResult] = await Promise.all([
        analyzeIntent(content, LOVABLE_API_KEY, [], lastAssistantMsg),
        analyzeCurrentMessageSentiment(content, LOVABLE_API_KEY),
        enabledToolNames.length > 0 
          ? detectToolIntentWithLLM(content, conversationHistory, enabledToolNames, LOVABLE_API_KEY)
          : Promise.resolve({ shouldUseTools: false, action: "none", reason: "no tools enabled" }),
      ]);
      intent = intentResult;
      currentMsgSentiment = sentimentResult;
      toolDecision = toolResult;
      console.log(`[ORCHESTRATOR] Fast analysis complete: intent=${intent}, sentiment=${currentMsgSentiment}, toolIntent=${toolDecision.shouldUseTools}`);
    } catch {
      intent = "GERAL";
      currentMsgSentiment = 5;
    }
    
    // DEFERRED: Start insights + contact extraction in background (non-blocking)
    // A blocklist do tenant entra aqui dentro para nao pesar no caminho critico.
    const deferredAnalysisPromise = getTenantNames(supabase, workspace_id).then(tenantNames =>
      Promise.all([
        analyzeConversationInsights(conversationHistory, content, LOVABLE_API_KEY),
        extractContactData(conversationHistory, content, LOVABLE_API_KEY, { tenantNames })
      ])
    ).then(async ([deferredInsights, deferredContactData]) => {
      insights = deferredInsights;
      contactData = deferredContactData;
      console.log("[ORCHESTRATOR] Deferred analysis complete");
      return { insights: deferredInsights, contactData: deferredContactData };
    }).catch(err => {
      console.error("[ORCHESTRATOR] Deferred analysis error:", err);
      return { insights: getDefaultInsights(), contactData: {} };
    });

    // STEP 4.1: CRM contact update will be handled in background after response
    // (See STEP FINAL after sending the message - deferred processing)

    // STEP 4.2: Check if CRM lead needs reactivation (was lost, now re-engaging)
    if (lead.contact_id) {
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select("id, status, stage_id, pipeline_id")
        .eq("contact_id", lead.contact_id)
        .maybeSingle();
      
      // If lead is lost and intent indicates engagement (not objection or support complaint), reactivate
      const qualifyingIntents: IntentCategory[] = ["VENDAS", "MARKETING", "GERAL"];
      if (crmLead && crmLead.status === "lost" && qualifyingIntents.includes(intent)) {
        console.log(`[ORCHESTRATOR] Reactivating lost CRM lead ${crmLead.id} due to intent: ${intent}`);
        
        // Get first stage of the pipeline
        const { data: firstStage } = await supabase
          .from("crm_pipeline_stages")
          .select("id")
          .eq("pipeline_id", crmLead.pipeline_id)
          .order("order", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (firstStage) {
          // Reactivate lead
          await supabase
            .from("crm_leads")
            .update({
              status: "open",
              closed_at: null,
              loss_reason_id: null,
              stage_id: firstStage.id,
              moved_at: new Date().toISOString()
            })
            .eq("id", crmLead.id);
          
          // Register in history
          await supabase.from("crm_lead_history").insert({
            lead_id: crmLead.id,
            from_stage_id: crmLead.stage_id,
            to_stage_id: firstStage.id,
            moved_by: "auto-reactivation",
            action: "reopened",
            reason: `Lead reativado automaticamente - retomou contato via chat (intent: ${intent})`
          });
          
          console.log(`[ORCHESTRATOR] CRM lead ${crmLead.id} reactivated and moved to stage ${firstStage.id}`);
        }
      }
    }

    // STEP 5: Check for handoff
    const effectiveSentiment = sessionInfo.isNewSession ? currentMsgSentiment : insights.sentiment_score;
    
    const isExplicitHumanRequest = intent === "HUMANO";
    const isVeryLowSentimentNoObjection = effectiveSentiment <= 2 && currentMsgSentiment <= 3 && 
      !sessionInfo.isNewSession && intent !== "OBJECAO";
    
    const shouldHandoff = isExplicitHumanRequest || isVeryLowSentimentNoObjection;

    console.log(`[ORCHESTRATOR] Handoff check: intent=${intent}, sentiment=${effectiveSentiment}, shouldHandoff=${shouldHandoff}`);

    if (shouldHandoff) {
      const reason = isExplicitHumanRequest 
        ? "Cliente solicitou explicitamente falar com humano" 
        : `Sentimento muito baixo (${effectiveSentiment}/10) após tentativas`;
      const routingAgent = lead.assigned_agent_id || (await selectAgentByCategory(supabase, workspace_id, intent, null))?.id;
      
      const handoffResult = await handleHandoff(
        supabase, lead_id, workspace_id, reason, insights, conversationHistory,
        LOVABLE_API_KEY, lead.phone, lead.name, routingAgent, intent
      );
      
      return new Response(JSON.stringify({ 
        success: true, handoff: true, routed: handoffResult.routed,
        processingTimeMs: Date.now() - requestStartTime
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // STEP 6: Smart agent selection with early conversation protection
    const messageCount = messages?.length || 0;
    const MIN_MESSAGES_BEFORE_TRANSFER = 4;
    const isEarlyConversation = messageCount <= MIN_MESSAGES_BEFORE_TRANSFER;
    const isGenericIntent = intent === "GERAL";
    
    // Get current agent if assigned
    const currentAgent = previousAgentId ? await getAgentById(supabase, previousAgentId) : null;
    
    // Determine if we should keep the current agent
    // Keep current agent if: early conversation OR generic intent (and agent exists)
    const shouldKeepCurrentAgent = previousAgentId && currentAgent && (isEarlyConversation || isGenericIntent);
    
    let selectedAgent;
    if (shouldKeepCurrentAgent) {
      // Keep current agent - they can handle any intent during early conversation
      selectedAgent = currentAgent;
      console.log(`[ORCHESTRATOR] Keeping current agent ${currentAgent.name} (messageCount=${messageCount}, isEarly=${isEarlyConversation}, isGeneric=${isGenericIntent})`);
    } else {
      // Select agent based on intent
      selectedAgent = await selectAgentByCategory(supabase, workspace_id, intent, lead.assigned_agent_id);
    }
    
    if (!selectedAgent) {
      return new Response(JSON.stringify({ message: "No active agents" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Only transfer if:
    // 1. There was a previous agent
    // 2. Selected agent is different
    // 3. NOT early conversation
    // 4. NOT generic intent (specific intent detected)
    const isAgentTransfer = previousAgentId && 
      previousAgentId !== selectedAgent.id && 
      !isEarlyConversation && 
      !isGenericIntent;

    // STEP 7: Handle agent transfer or initial assignment
    if (isAgentTransfer || !previousAgentId) {
      await supabase.from("leads").update({ assigned_agent_id: selectedAgent.id, status: "ai_talking" }).eq("id", lead_id);
      
      if (isAgentTransfer) {
        console.log(`[ORCHESTRATOR] Transferring from ${previousAgentName} to ${selectedAgent.name} (intent=${intent}, messages=${messageCount})`);
        await logAgentTransfer(supabase, lead_id, workspace_id, previousAgentId, selectedAgent.id, null, intent, "Intent changed after conversation");
        await sendTransferNotification(supabase, lead_id, workspace_id, previousAgentName, selectedAgent.name, intent);
        
        // Transfer notification already sent — don't generate a response from new agent
        // The new agent will respond naturally on the lead's next message
        await updateLeadInsights(supabase, lead_id, insights);
        return new Response(JSON.stringify({ 
          success: true, 
          transfer: true, 
          from: previousAgentName, 
          to: selectedAgent.name 
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    await updateLeadInsights(supabase, lead_id, insights);

    // STEP 8: RAG retrieval - OPTIMIZED: Skip for greetings and short messages
    let relevantContext: string[] = [];
    const trimmedContent = content.trim();
    const isGreeting = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|hey|hi|hello|e a[ií]|fala|salve)$/i.test(trimmedContent);
    const isShortMessage = trimmedContent.length < 20;
    const shouldSkipRAG = sessionInfo.isNewSession || isGreeting || isShortMessage;
    
    if (shouldSkipRAG) {
      console.log(`[ORCHESTRATOR] Skipping RAG: newSession=${sessionInfo.isNewSession}, greeting=${isGreeting}, short=${isShortMessage}`);
    } else {
      const { data: agentKbs } = await supabase.from("agent_knowledge_bases").select("knowledge_base_id").eq("agent_id", selectedAgent.id);
      const kbIds = (agentKbs || []).map((akb: { knowledge_base_id: string }) => akb.knowledge_base_id);
      if (kbIds.length > 0) {
        relevantContext = await retrieveRelevantDocuments(supabase, content, kbIds, conversationHistory, workspace_id);
      }
    }

    // STEP 8.1: POINT 1 - Fetch existing appointments for agent memory
    let appointmentContext = "";
    if (lead.contact_id) {
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("contact_id", lead.contact_id)
        .maybeSingle();
      
      if (crmLead) {
        const { data: existingAppointments } = await supabase
          .from("crm_appointments")
          .select("title, start_time, end_time, status, meeting_link")
          .eq("lead_id", crmLead.id)
          .in("status", ["scheduled", "confirmed"])
          .order("start_time", { ascending: true })
          .limit(5);
        
        if (existingAppointments && existingAppointments.length > 0) {
          appointmentContext = buildAppointmentContext(existingAppointments);
          console.log("[ORCHESTRATOR] Found existing appointments:", existingAppointments.length);
        }
      }
    }

    // STEP 9: Check for tool-enabled response
    console.log(`[ORCHESTRATOR] Delegating response to agent: ${selectedAgent.name} (${selectedAgent.id})`);
    console.log(`[ORCHESTRATOR] RAG context found: ${relevantContext.length} documents`);
    
    // STEP 9: Tool decision already computed in STEP 4 (parallel)
    // hasActiveAppointment only forces the tool path when the LLM classifier errored
    // (reason === "fallback") — when it confidently said "none", respect it. This stops
    // every message ("[Imagem]", "Só tem eu na sala") from entering the tool path.
    const hasActiveAppointment = appointmentContext !== "";
    const classifierFailed = toolDecision.reason === "fallback";
    const shouldUseTools = schedulingCheck.enabled && (toolDecision.shouldUseTools || (hasActiveAppointment && classifierFailed));
    
    console.log(`[ORCHESTRATOR] Tool check: schedulingEnabled=${schedulingCheck.enabled}, llmDecision=${toolDecision.shouldUseTools}, llmAction=${toolDecision.action}, llmReason=${toolDecision.reason}, activeAppointment=${hasActiveAppointment}, shouldUseTools=${shouldUseTools}`);
    
    // Check if lead came from widget with welcome_message for agent context
    let welcomeMessageContext = "";
    {
      const { data: widgetSession } = await supabase
        .from("widget_sessions")
        .select("widget_config_id")
        .eq("lead_id", lead_id)
        .maybeSingle();
      
      if (widgetSession?.widget_config_id) {
        const { data: widgetConfig } = await supabase
          .from("widget_configs")
          .select("settings")
          .eq("id", widgetSession.widget_config_id)
          .single();
        
        const wSettings = widgetConfig?.settings as Record<string, unknown> | null;
        const wEnabled = wSettings?.welcome_message_enabled === true || 
          (wSettings?.welcome_message_enabled === undefined && wSettings?.welcome_message && typeof wSettings.welcome_message === "string" && (wSettings.welcome_message as string).trim() !== "");
        
        if (wEnabled && wSettings?.welcome_message && typeof wSettings.welcome_message === "string") {
          welcomeMessageContext = `\n\nIMPORTANTE: Voce ja enviou esta mensagem de boas-vindas ao usuario: "${wSettings.welcome_message}". NAO repita a saudacao nem se apresente novamente. Responda diretamente ao que o usuario disser.`;
          console.log("[ORCHESTRATOR] Added welcome message context to agent prompt");
        }
      }
    }

    // ── PRE-RESPONSE MERGE: Extract phone via regex and merge BEFORE AI response ──
    let emailConfirmationContext = "";
    let mergeAlreadyDone = false;
    let effectiveLeadId = lead_id; // May change if merge happens
    
    const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/;
    const phoneMatch = content.match(phoneRegex);
    
    if (phoneMatch && !lead.phone) {
      let digits = phoneMatch[0].replace(/\D/g, '');
      // Normalize: add 55 prefix if missing (Brazilian numbers)
      if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
        digits = '55' + digits;
      }
      // Convert old 8-digit mobile to 9-digit format
      if (digits.length === 12 && digits.startsWith('55')) {
        const numberPart = digits.slice(4);
        if (/^[6-9]/.test(numberPart)) {
          digits = digits.slice(0, 4) + '9' + numberPart;
        }
      }
      
      if (digits.length >= 12) {
        console.log(`[ORCHESTRATOR] PRE-MERGE: Phone detected in message: ${digits}`);
        
        // Search for existing lead with this phone
        let existingLead = null as { id: string; name: string | null; phone: string | null; workspace_id: string; contact_id: string | null; source: string | null } | null;
        
        const { data: leadByPhone } = await supabase
          .from("leads")
          .select("id, name, phone, workspace_id, contact_id, source")
          .eq("phone", digits)
          .eq("workspace_id", workspace_id)
          .neq("id", lead_id)
          .maybeSingle();
        
        existingLead = leadByPhone;
        
        // Strategy 2: check crm_contacts
        if (!existingLead) {
          const { data: existingContact } = await supabase
            .from("crm_contacts")
            .select("id, lead_id, email, name, company")
            .eq("phone", digits)
            .eq("workspace_id", workspace_id)
            .maybeSingle();
          
          if (existingContact && existingContact.lead_id && existingContact.lead_id !== lead_id) {
            const { data: contactLead } = await supabase
              .from("leads")
              .select("id, name, phone, workspace_id, contact_id, source")
              .eq("id", existingContact.lead_id)
              .single();
            existingLead = contactLead;
            console.log(`[ORCHESTRATOR] PRE-MERGE: Found existing lead via crm_contacts: ${existingContact.lead_id}`);
          } else if (existingContact && (!existingContact.lead_id || existingContact.lead_id === lead_id)) {
            // Orphan contact - link and check email
            console.log(`[ORCHESTRATOR] PRE-MERGE: Found orphan contact ${existingContact.id} with phone ${digits}. Linking.`);
            await supabase.from("crm_contacts").update({ lead_id: lead_id }).eq("id", existingContact.id);
            await supabase.from("leads").update({ contact_id: existingContact.id, phone: digits }).eq("id", lead_id);
            if (lead.contact_id && lead.contact_id !== existingContact.id) {
              await supabase.from("crm_contacts").delete().eq("id", lead.contact_id).is("phone", null);
            }
            if (existingContact.email) {
              const companyPart = existingContact.company ? `da empresa "${existingContact.company}" e ` : "";
              const exampleCompanyPart = existingContact.company ? `Voce ainda e da empresa ${existingContact.company} e seu` : "Seu";
              emailConfirmationContext = `\n\nINSTRUCAO ESPECIAL (PRIORIDADE MAXIMA): Identificamos que este cliente ja tem cadastro conosco. Confirme de forma natural se os dados dele continuam corretos. ${existingContact.company ? `Empresa: "${existingContact.company}". ` : ""}Email: "${existingContact.email}". Exemplo: "Encontrei seu cadastro! ${exampleCompanyPart} email ainda e ${existingContact.email}?"\nSe o usuario CONFIRMAR (sim, isso, correto, isso mesmo), continue o atendimento normalmente.\nSe o usuario NEGAR (nao, mudou, outro email, outra empresa, nao e mais), pergunte os dados atualizados de forma natural. ${existingContact.company && existingContact.email ? 'Exemplo: "Sem problema! Qual sua empresa atual e seu email atualizado?"' : 'Exemplo: "Sem problema! Qual seu email atualizado?"'}\nVoce TEM permissao total para coletar e atualizar dados do lead. NAO diga que nao tem autorizacao.`;
              console.log(`[ORCHESTRATOR] PRE-MERGE: Email/company confirmation for orphan contact: ${existingContact.email}, company: ${existingContact.company}`);
            }
            mergeAlreadyDone = true;
          }
        }
        
        if (existingLead) {
          console.log(`[ORCHESTRATOR] PRE-MERGE: Merging widget lead ${lead_id} into existing lead ${existingLead.id}`);
          mergeAlreadyDone = true;
          
          // 1. Get widget session start time
          const { data: firstWidgetMsg } = await supabase
            .from("messages")
            .select("created_at")
            .eq("lead_id", lead_id)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          
          const widgetStartTime = firstWidgetMsg?.created_at
            ? new Date(firstWidgetMsg.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          
          // 2. Insert system message
          await supabase.from("messages").insert({
            lead_id: existingLead.id,
            workspace_id,
            content: `__SYSTEM__:Canal alterado de WhatsApp para Widget (conversa iniciada em ${widgetStartTime})`,
            sender_type: "ai",
          });
          
          // 3. Migrate messages
          await supabase.from("messages").update({ lead_id: existingLead.id }).eq("lead_id", lead_id);
          
          // 4. Update widget_sessions
          await supabase.from("widget_sessions").update({ lead_id: existingLead.id }).eq("lead_id", lead_id);
          
          // 5. Check email for confirmation context
          if (existingLead.contact_id) {
            const { data: existingContact } = await supabase
              .from("crm_contacts")
              .select("email, company")
              .eq("id", existingLead.contact_id)
              .single();
            
            if (existingContact?.email) {
              const companyPart = existingContact.company ? `da empresa "${existingContact.company}" e ` : "";
              const exampleCompanyPart = existingContact.company ? `Voce ainda e da empresa ${existingContact.company} e seu` : "Seu";
              emailConfirmationContext = `\n\nINSTRUCAO ESPECIAL (PRIORIDADE MAXIMA): Identificamos que este cliente ja tem cadastro conosco. Confirme de forma natural se os dados dele continuam corretos. ${existingContact.company ? `Empresa: "${existingContact.company}". ` : ""}Email: "${existingContact.email}". Exemplo: "Encontrei seu cadastro! ${exampleCompanyPart} email ainda e ${existingContact.email}?"\nSe o usuario CONFIRMAR (sim, isso, correto, isso mesmo), continue o atendimento normalmente.\nSe o usuario NEGAR (nao, mudou, outro email, outra empresa, nao e mais), pergunte os dados atualizados de forma natural. ${existingContact.company && existingContact.email ? 'Exemplo: "Sem problema! Qual sua empresa atual e seu email atualizado?"' : 'Exemplo: "Sem problema! Qual seu email atualizado?"'}\nVoce TEM permissao total para coletar e atualizar dados do lead. NAO diga que nao tem autorizacao.`;
              console.log(`[ORCHESTRATOR] PRE-MERGE: Email/company confirmation for ${existingContact.email}, company: ${existingContact.company}`);
            }
          }
          
          // 6. Delete orphan contacts
          if (lead.contact_id) {
            await supabase.from("crm_contacts").delete().eq("id", lead.contact_id).is("phone", null);
          }
          await supabase.from("crm_contacts").delete().eq("lead_id", lead_id).is("phone", null);
          
          // 7. Delete crm_leads linked to widget contact
          if (lead.contact_id) {
            await supabase.from("crm_leads").delete().eq("contact_id", lead.contact_id);
          }
          
          // 8. Mark widget lead as merged
          await supabase.from("leads").update({
            merged_into_lead_id: existingLead.id,
            status: "closed",
          }).eq("id", lead_id);
          
          // Update effective lead_id so response is saved to correct lead
          effectiveLeadId = existingLead.id;
          
          // Reactivate contact linked to existing lead
          if (existingLead.contact_id) {
            await supabase.from("crm_contacts").update({ is_active: true }).eq("id", existingLead.contact_id);
          }
          
          // Also update agent assignment and last_message_at on existing lead
          const widgetSource = lead.source || 'Widget';
          await supabase.from("leads").update({ 
            assigned_agent_id: selectedAgent.id, 
            status: "ai_talking",
            source: widgetSource,
            last_message_at: new Date().toISOString(),
          }).eq("id", existingLead.id);
          
          console.log(`[ORCHESTRATOR] PRE-MERGE: Complete. Response will be saved to lead ${effectiveLeadId}`);
        } else if (!mergeAlreadyDone) {
          // No existing lead found - just update phone on current lead
          await supabase.from("leads").update({ phone: digits }).eq("id", lead_id);
          console.log(`[ORCHESTRATOR] PRE-MERGE: No existing lead found. Updated phone on current lead.`);
          mergeAlreadyDone = true; // Skip phone processing in STEP FINAL
        }
      }
    }
    
    // Also check for existing pending_email_confirmation (from previous merge)
    if (!emailConfirmationContext && lead.pending_email_confirmation) {
      // Try to get company from contact for richer confirmation
      let pendingCompany: string | null = null;
      if (lead.contact_id) {
        const { data: pendingContact } = await supabase
          .from("crm_contacts")
          .select("company")
          .eq("id", lead.contact_id)
          .single();
        pendingCompany = pendingContact?.company || null;
      }
      const companyPart = pendingCompany ? `da empresa "${pendingCompany}" e ` : "";
      const exampleCompanyPart = pendingCompany ? `Voce ainda e da empresa ${pendingCompany} e seu` : "Seu";
      emailConfirmationContext = `\n\nINSTRUCAO ESPECIAL (PRIORIDADE MAXIMA): Identificamos que este cliente ja tem cadastro conosco. Confirme de forma natural se os dados dele continuam corretos. ${pendingCompany ? `Empresa: "${pendingCompany}". ` : ""}Email: "${lead.pending_email_confirmation}". Exemplo: "Encontrei seu cadastro! ${exampleCompanyPart} email ainda e ${lead.pending_email_confirmation}?"\nSe o usuario CONFIRMAR (sim, isso, correto, isso mesmo), continue o atendimento normalmente.\nSe o usuario NEGAR (nao, mudou, outro email, outra empresa, nao e mais), pergunte os dados atualizados de forma natural. ${pendingCompany && lead.pending_email_confirmation ? 'Exemplo: "Sem problema! Qual sua empresa atual e seu email atualizado?"' : 'Exemplo: "Sem problema! Qual seu email atualizado?"'}\nVoce TEM permissao total para coletar e atualizar dados do lead. NAO diga que nao tem autorizacao.`;
      console.log("[ORCHESTRATOR] Added email/company confirmation context for merged lead");
      await supabase.from("leads").update({ pending_email_confirmation: null }).eq("id", lead_id);
    }

    // Build tool restrictions when scheduling is disabled
    let toolRestrictions = "";
    if (!schedulingCheck.enabled) {
      toolRestrictions = "\n\nRESTRICAO ABSOLUTA: Voce NAO tem capacidade de agendar reunioes, compromissos ou verificar disponibilidade de horarios. NUNCA sugira agendar uma reuniao. NUNCA diga que vai marcar, agendar ou verificar horarios. Se o usuario pedir para agendar algo, responda que voce nao possui essa funcionalidade no momento e sugira que ele entre em contato por outro canal.";
    }

    // Build augmented prompt with appointment context and time context
    let augmentedPrompt = buildAugmentedPrompt(
      (selectedAgent.persona_prompt || "") + welcomeMessageContext + toolRestrictions, relevantContext, conversationHistory, content,
      isAgentTransfer ? { fromAgentName: previousAgentName, fromIntent: null, toIntent: intent } : undefined,
      sessionInfo.isNewSession, sessionInfo.limitHistory,
      appointmentContext,
      sessionInfo.hoursSinceLastMessage,
      shouldSkipRAG,
      emailConfirmationContext || undefined,
      lead.name || undefined
    );
    
    let aiContent: string | null = null;

    // CONFIRMATION GATE (deterministic): if a destructive action (cancel/reschedule)
    // is pending on this lead, only a strict confirmation executes it. Anything else
    // clears the pending action — a stale pending must never authorize a later call.
    const pendingAction = parsePendingSchedulingAction(lead.pending_scheduling_action);
    if (pendingAction) {
      if (isStrictConfirmation(content)) {
        console.log(`[ORCHESTRATOR] GATE: lead confirmed pending ${pendingAction.action} — executing`);
        await clearPendingSchedulingAction(supabase, lead_id);
        const gateToolCall = { name: "schedule_appointment", arguments: pendingAction.args };
        const execResult = await executeTool(
          gateToolCall,
          lead_id,
          workspace_id,
          selectedAgent.id,
          lead.assigned_to_user_id,
          content,
          true // confirmed — bypasses the gate in the executor
        );
        console.log(`[ORCHESTRATOR] GATE: confirmed ${pendingAction.action} result:`, execResult.success);
        const composed = await composeToolResponse(augmentedPrompt, content, gateToolCall, execResult, LOVABLE_API_KEY);
        aiContent = composed || execResult.message;
      } else {
        console.log(`[ORCHESTRATOR] GATE: message is not a strict confirmation — clearing pending ${pendingAction.action}`);
        await clearPendingSchedulingAction(supabase, lead_id);
      }
    } else if (lead.pending_scheduling_action) {
      // Present but expired/invalid — clean up
      await clearPendingSchedulingAction(supabase, lead_id);
    }

    if (!aiContent && shouldUseTools && !sessionInfo.isNewSession) {
      const agentToolsData = await getAgentTools(supabase, workspace_id, selectedAgent.id);
      const enabledTools = agentToolsData.map(t => t.tool);
      
      augmentedPrompt = buildToolAwarePrompt(augmentedPrompt, enabledTools);
      
      // IMPROVED: Retry logic for tool calling with intelligent fallback
      let toolResult = await generateResponseWithTools(
        augmentedPrompt,
        content,
        LOVABLE_API_KEY,
        lead_id,
        workspace_id,
        selectedAgent.id,
        lead.assigned_to_user_id,
        enabledTools
      );
      
      // Retry once if there's a transient error (503, timeout, etc.)
      if (toolResult.error && (toolResult.error.includes("503") || toolResult.error.includes("timeout"))) {
        console.log("[ORCHESTRATOR] Tool call failed, retrying after 1s...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        toolResult = await generateResponseWithTools(
          augmentedPrompt,
          content,
          LOVABLE_API_KEY,
          lead_id,
          workspace_id,
          selectedAgent.id,
          lead.assigned_to_user_id,
          enabledTools
        );
      }
      
      if (toolResult.error) {
        console.error("[ORCHESTRATOR] Tool response error after retry:", toolResult.error);
        // CRITICAL: If tool calling failed and there's scheduling intent, 
        // DO NOT fall back to regular response - inform user of technical issue
        aiContent = "Desculpe, estou com dificuldades técnicas para processar seu agendamento no momento. Pode tentar novamente em alguns instantes?";
      } else if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
        console.log(`[ORCHESTRATOR] Executing ${toolResult.toolCalls.length} tool call(s)`);
        
        for (const toolCall of toolResult.toolCalls) {
          const execResult = await executeTool(
            toolCall,
            lead_id,
            workspace_id,
            selectedAgent.id,
            lead.assigned_to_user_id,
            content
          );

          console.log(`[ORCHESTRATOR] Tool ${toolCall.name} result:`, execResult.success);
          // Feed the actual result back to the model so the reply reflects what
          // really happened. Fallback: raw tool message (client-ready).
          const composed = await composeToolResponse(augmentedPrompt, content, toolCall, execResult, LOVABLE_API_KEY);
          aiContent = composed || execResult.message;
        }
      } else if (toolResult.content) {
        aiContent = toolResult.content;
      }
    }
    
    // Fallback to regular response
    if (!aiContent) {
      const aiResult = await generateAIResponse(augmentedPrompt, LOVABLE_API_KEY, selectedAgent.name);
      
      if (aiResult.error) {
        return new Response(JSON.stringify({ error: aiResult.error }), {
          status: aiResult.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      aiContent = aiResult.content;
    }

    // STEP 10: Send agent's response
    // ─── Reading delay (Feature 4: Anti-ban humanization) ───────────────
    // Simulate "reading" the user's message before responding (500-1500ms)
    const readingDelay = 500 + Math.floor(Math.random() * 1001);
    console.log(`[ORCHESTRATOR] Humanization: reading delay ${readingDelay}ms`);
    await new Promise(resolve => setTimeout(resolve, readingDelay));

    const messageStartTime = new Date().toISOString();
    const shouldSplitMessages = selectedAgent.split_messages !== false;

    let sendResult;
    if (shouldSplitMessages) {
      sendResult = await sendMessageChunks(
        supabase,
        effectiveLeadId,
        workspace_id,
        selectedAgent.id,
        aiContent!,
        LOVABLE_API_KEY,
        messageStartTime
      );
    } else {
      await supabase.from("messages").insert({
        lead_id: effectiveLeadId,
        workspace_id,
        content: aiContent!,
        sender_type: "ai",
        agent_id: selectedAgent.id,
        responding_agent_id: selectedAgent.id,
      });
      sendResult = { sentChunks: 1, interrupted: false };
    }

    console.log(`[ORCHESTRATOR] Agent ${selectedAgent.name} sent ${sendResult.sentChunks} message(s). Interrupted: ${sendResult.interrupted}. Split: ${shouldSplitMessages}. Total time: ${Date.now() - requestStartTime}ms`);

    // STEP FINAL: Await deferred analysis and save results BEFORE returning
    // Previously this was fire-and-forget (.then after return), causing data loss
    try {
      const { insights: deferredInsights, contactData: deferredContactData } = await deferredAnalysisPromise;
      
      // Update lead insights with full analysis
      await updateLeadInsights(supabase, effectiveLeadId, deferredInsights);
      
      // Cast to proper type for accessing properties
      const cd = deferredContactData as Record<string, string>;
      
      // Process contact data if any was extracted
      if (Object.keys(cd).length > 0) {
        console.log("[ORCHESTRATOR] Processing contact data:", cd);
        
        let crmContact = null;
        if (lead.contact_id) {
          const { data } = await supabase
            .from("crm_contacts")
            .select("id, name, email, phone, company, employee_count, revenue")
            .eq("id", lead.contact_id)
            .single();
          crmContact = data;
        }
        
        if (!crmContact) {
          const { data } = await supabase
            .from("crm_contacts")
            .select("id, name, email, phone, company, employee_count, revenue")
            .eq("lead_id", lead_id)
            .maybeSingle();
          crmContact = data;
        }
        
        if (crmContact) {
          const genericNames = ["visitante widget", "visitante", "lead", "anonimo", "anonymous", "contato"];
          const isGenericContactName = !crmContact.name || genericNames.includes(crmContact.name.toLowerCase().trim());
          const updates: Record<string, string> = {};
          if (cd.name && isGenericContactName) updates.name = cd.name;
          if (cd.email) updates.email = cd.email;
          // company so preenche quando esta vazio, igual a employee_count/revenue.
          // Antes sobrescrevia incondicionalmente, o que fazia o card do pipeline
          // ser renomeado pelo trigger trg_sync_contact_title_to_lead.
          if (cd.company && !crmContact.company) updates.company = cd.company;
          if (cd.employee_count && !crmContact.employee_count) updates.employee_count = cd.employee_count;
          if (cd.revenue && !crmContact.revenue) updates.revenue = cd.revenue;

          if (Object.keys(updates).length > 0) {
            await supabase.from("crm_contacts").update(updates).eq("id", crmContact.id);
            console.log("[ORCHESTRATOR] CRM contact updated:", updates);
          }

          // O agente pergunta "voce ainda e da empresa X?" (emailConfirmationContext).
          // Como a escrita automatica de company foi restringida, a resposta do lead
          // vira uma nota na timeline do card em vez de se perder em silencio --
          // quem decide trocar a empresa e o vendedor.
          if (cd.company && crmContact.company && squash(cd.company) !== squash(crmContact.company)) {
            try {
              const { data: openLead } = await supabase
                .from("crm_leads")
                .select("id, workspace_id")
                .eq("contact_id", crmContact.id)
                .eq("status", "open")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (openLead?.id) {
                await supabase.from("crm_lead_history").insert({
                  lead_id: openLead.id,
                  action: "note",
                  moved_by: "orchestrator",
                  notes: `Lead informou empresa diferente da cadastrada: "${cd.company}" (atual: "${crmContact.company}"). Confirmar e atualizar manualmente.`,
                });
                console.log(`[ORCHESTRATOR] Divergencia de empresa registrada no card ${openLead.id}`);
              }
            } catch (e) {
              console.error("[ORCHESTRATOR] Falha ao registrar divergencia de empresa:", e);
            }
          }
          
          // --- META CAPI: Send Lead/CompleteRegistration events ---
          // Moved OUTSIDE updates block so events fire even when contact data already exists
          try {
            const updatedContact = { ...crmContact, ...updates };
            const contactPhone = updatedContact.phone || cd.phone || lead.phone;
            const contactName = updatedContact.name;
            const contactEmail = updatedContact.email;
            
            // Only fire if contact has at least name or email or phone
            if (contactName || contactEmail || contactPhone) {
              const { data: wsData } = await supabase
                .from("workspaces")
                .select("company_id")
                .eq("id", workspace_id)
                .single();
              
              if (wsData?.company_id) {
                const { data: company } = await supabase
                  .from("companies")
                  .select("meta_pixel_id, meta_access_token")
                  .eq("id", wsData.company_id)
                  .single();
                
                if (company?.meta_pixel_id && company?.meta_access_token) {
                  // Determine event type
                  const genericNames = ["visitante widget", "visitante", "lead", "anonimo", "anonymous", "contato"];
                  const hasRealName = contactName && !genericNames.includes(contactName.toLowerCase().trim());
                  const hasAllFields = hasRealName && contactEmail && contactPhone;
                  const eventName = hasAllFields ? "CompleteRegistration" : "Lead";
                  
                  // Deduplication: check if this event was already sent for this contact
                  const { data: existingEvent } = await supabase
                    .from("meta_capi_events")
                    .select("id")
                    .eq("contact_id", crmContact.id)
                    .eq("event_name", eventName)
                    .limit(1)
                    .maybeSingle();
                  
                  if (!existingEvent) {
                    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
                    const capiResp = await fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${supabaseAnonKey}`,
                      },
                      body: JSON.stringify({
                        event_name: eventName,
                        lead_id,
                        contact_id: crmContact.id,
                        workspace_id,
                        company_id: wsData.company_id,
                        pixel_id: company.meta_pixel_id,
                        custom_data: {
                          content_name: "lead_enrichment",
                          content_category: intent,
                          fields_present: [
                            ...(hasRealName ? ["name"] : []),
                            ...(contactEmail ? ["email"] : []),
                            ...(contactPhone ? ["phone"] : []),
                          ],
                        },
                      }),
                    });
                    console.log(`[ORCHESTRATOR] META CAPI ${eventName}: ${capiResp.status}`);
                    
                    // If we sent Lead and contact has all fields, also send CompleteRegistration
                    if (eventName === "Lead" && hasAllFields) {
                      // This case won't happen due to logic above, but kept as safety
                    }
                  } else {
                    console.log(`[ORCHESTRATOR] META CAPI ${eventName} already sent for contact ${crmContact.id}, skipping`);
                  }
                }
              }
            }
          } catch (capiErr) {
            console.error("[ORCHESTRATOR] META CAPI dispatch error:", capiErr);
          }
        }
        
        // Update lead name if generic
        const genericNames = ["visitante widget", "visitante", "lead", "anonimo", "anonymous"];
        const isGenericName = !lead.name || genericNames.includes(lead.name.toLowerCase().trim());
        let leadUpdates: Record<string, string> = {};
        
        if (cd.name && isGenericName) {
          leadUpdates.name = cd.name;
        }
        if (cd.phone && !lead.phone && !mergeAlreadyDone) {
          let digits = cd.phone.replace(/\D/g, '');
          // Normalize: add 55 prefix if missing (Brazilian numbers)
          if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
            digits = '55' + digits;
          }
          if (digits.length >= 12) {
            // ── MERGE LOGIC: Check if another lead or contact already has this phone ──
            // NOTE: This only runs if PRE-MERGE didn't already handle it
            // Strategy 1: Find another lead with same phone
            let existingLead = null as { id: string; name: string | null; phone: string | null; workspace_id: string; contact_id: string | null; source: string | null } | null;
            
            const { data: leadByPhone } = await supabase
              .from("leads")
              .select("id, name, phone, workspace_id, contact_id, source")
              .eq("phone", digits)
              .eq("workspace_id", workspace_id)
              .neq("id", lead_id)
              .maybeSingle();
            
            existingLead = leadByPhone;

            // Strategy 2: If no lead found, check crm_contacts for existing contact with this phone
            if (!existingLead) {
              const { data: existingContact } = await supabase
                .from("crm_contacts")
                .select("id, lead_id, email, name")
                .eq("phone", digits)
                .eq("workspace_id", workspace_id)
                .maybeSingle();

              if (existingContact && existingContact.lead_id && existingContact.lead_id !== lead_id) {
                // Found a contact with this phone linked to a different lead
                const { data: contactLead } = await supabase
                  .from("leads")
                  .select("id, name, phone, workspace_id, contact_id, source")
                  .eq("id", existingContact.lead_id)
                  .single();
                existingLead = contactLead;
                console.log(`[ORCHESTRATOR] MERGE: Found existing lead via crm_contacts: ${existingContact.lead_id}`);
              } else if (existingContact && (!existingContact.lead_id || existingContact.lead_id === lead_id)) {
                // Contact exists but no other lead linked - just link this lead to existing contact
                console.log(`[ORCHESTRATOR] MERGE: Found orphan contact ${existingContact.id} with phone ${digits}. Linking to current lead.`);
                await supabase.from("crm_contacts").update({ lead_id: lead_id }).eq("id", existingContact.id);
                await supabase.from("leads").update({ contact_id: existingContact.id }).eq("id", lead_id);
                // Delete orphan widget contact if different
                if (lead.contact_id && lead.contact_id !== existingContact.id) {
                  await supabase.from("crm_contacts").delete().eq("id", lead.contact_id).is("phone", null);
                }
                // Check for email confirmation
                if (existingContact.email) {
                  await supabase.from("leads").update({ pending_email_confirmation: existingContact.email }).eq("id", lead_id);
                  console.log(`[ORCHESTRATOR] MERGE: Email confirmation pending for ${existingContact.email}`);
                }
              }
            }

            if (existingLead) {
              console.log(`[ORCHESTRATOR] MERGE: Found existing lead ${existingLead.id} with phone ${digits}. Merging widget lead ${lead_id} into it.`);

              // 1. Get widget session start time for system message
              const { data: firstWidgetMsg } = await supabase
                .from("messages")
                .select("created_at")
                .eq("lead_id", lead_id)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();

              const widgetStartTime = firstWidgetMsg?.created_at
                ? new Date(firstWidgetMsg.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

              // 2. Insert system message on existing lead marking where widget conversation starts
              await supabase.from("messages").insert({
                lead_id: existingLead.id,
                workspace_id,
                content: `__SYSTEM__:Conversa via Widget iniciada em ${widgetStartTime}`,
                sender_type: "ai",
              });

              // 3. Migrate all messages from widget lead to existing lead
              await supabase
                .from("messages")
                .update({ lead_id: existingLead.id })
                .eq("lead_id", lead_id);
              console.log("[ORCHESTRATOR] MERGE: Messages migrated");

              // 4. Update widget_sessions to point to existing lead
              await supabase
                .from("widget_sessions")
                .update({ lead_id: existingLead.id })
                .eq("lead_id", lead_id);

              // 5. Check existing contact for email confirmation
              if (existingLead.contact_id) {
                const { data: existingContact } = await supabase
                  .from("crm_contacts")
                  .select("email")
                  .eq("id", existingLead.contact_id)
                  .single();

                if (existingContact?.email) {
                  // Store flag on existing lead so next response confirms email
                  await supabase.from("leads").update({
                    pending_email_confirmation: existingContact.email,
                  }).eq("id", existingLead.id);
                  console.log(`[ORCHESTRATOR] MERGE: Email confirmation pending for ${existingContact.email}`);
                }
              }

              // 6. Delete orphan crm_contact (widget contact without phone)
              if (lead.contact_id) {
                await supabase
                  .from("crm_contacts")
                  .delete()
                  .eq("id", lead.contact_id)
                  .is("phone", null);
              }
              // Also clean up any crm_contacts linked to widget lead
              await supabase
                .from("crm_contacts")
                .delete()
                .eq("lead_id", lead_id)
                .is("phone", null);

              // 7. Delete any crm_leads linked to the widget contact
              if (lead.contact_id) {
                await supabase
                  .from("crm_leads")
                  .delete()
                  .eq("contact_id", lead.contact_id);
              }

              // 8. Mark widget lead as merged
              await supabase.from("leads").update({
                merged_into_lead_id: existingLead.id,
                status: "closed",
              }).eq("id", lead_id);
              console.log(`[ORCHESTRATOR] MERGE: Widget lead ${lead_id} merged into ${existingLead.id}`);

              // Reactivate contact linked to existing lead
              if (existingLead.contact_id) {
                await supabase.from("crm_contacts").update({ is_active: true }).eq("id", existingLead.contact_id);
              }

              // Update existing lead: name, source, last_message_at
              const widgetSource = lead.source || 'Widget';
              const existingLeadUpdates: Record<string, unknown> = {
                source: widgetSource,
                last_message_at: new Date().toISOString(),
              };
              if (cd.name) {
                const existingGenericNames = ["visitante widget", "visitante", "lead", "anonimo", "anonymous"];
                const isExistingGeneric = !existingLead.name || existingGenericNames.includes(existingLead.name.toLowerCase().trim());
                if (isExistingGeneric) {
                  existingLeadUpdates.name = cd.name;
                }
              }
              await supabase.from("leads").update(existingLeadUpdates).eq("id", existingLead.id);

              // Skip normal lead updates since we merged
              // The leadUpdates object should NOT be applied to the old lead
              leadUpdates = {};
            } else {
              // No existing lead found - normal flow
              leadUpdates.phone = digits;
            }
          }
        }
        
        if (Object.keys(leadUpdates).length > 0) {
          await supabase.from("leads").update(leadUpdates).eq("id", lead_id);
          console.log("[ORCHESTRATOR] Lead updated:", leadUpdates);
        }
      }
      
      console.log("[ORCHESTRATOR] Deferred analysis processing complete");
    } catch (err) {
      console.error("[ORCHESTRATOR] Deferred analysis error:", err);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      aiResponse: aiContent, 
      intent,
      respondingAgent: selectedAgent.name,
      agent_id: selectedAgent.id,
      messagesSent: sendResult.sentChunks,
      wasInterrupted: sendResult.interrupted,
      usedTools: shouldUseTools,
      processingTimeMs: Date.now() - requestStartTime
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("[ORCHESTRATOR] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
