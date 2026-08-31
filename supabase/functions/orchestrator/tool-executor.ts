// Tool executor module - handles AI tool calling for scheduling and other tools
import { fetchWithTimeout, BRAZIL_TIMEZONE } from "./utils.ts";
import { getAgentTools, buildToolsArray, ToolDefinition } from "./tool-catalog.ts";
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data: any;
  message: string;
}

// Check if message content indicates scheduling intent (now includes cancel/reschedule)
export function hasSchedulingIntent(content: string): boolean {
  const schedulingKeywords = [
    // Scheduling
    "agendar", "agendamento", "marcar", "reunião", "reuniao",
    "horário", "horario", "disponibilidade", "disponível", "disponivel",
    "quando pode", "quando você pode", "quando vc pode",
    "podemos conversar", "posso falar", "vamos marcar",
    "agenda", "calendário", "calendario",
    "amanhã", "amanha", "segunda", "terça", "quarta", "quinta", "sexta",
    "às", "as", "horas", "h", ":00", ":30",
    // Cancellation
    "cancelar", "cancela", "desmarcar", "desmarca", "não vou poder", "nao vou poder",
    "não posso mais", "nao posso mais", "preciso cancelar", "quero cancelar",
    // Rescheduling
    "remarcar", "reagendar", "mudar horário", "mudar horario", "trocar data",
    "alterar data", "alterar horário", "adiar", "antecipar",
    // Add attendee (fallback - main logic is via hasActiveAppointment)
    "adicione", "adicionar", "inclua", "incluir", "convide", "convidar",
    "participante", "convidado"
  ];
  
  const lowerContent = content.toLowerCase();
  return schedulingKeywords.some(keyword => lowerContent.includes(keyword));
}

// Check if the AI's last message proposed a scheduling time (conversation context)
export function hasPendingSchedulingContext(conversationHistory: Array<{ role: string; content: string }>): boolean {
  // Find the last assistant message
  const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === "assistant" || m.role === "model");
  if (!lastAssistantMsg) return false;

  const lower = lastAssistantMsg.content.toLowerCase();

  // Scheduling proposal patterns in the AI's last message
  const proposalPatterns = [
    /agendar\s+para/i,
    /marcar\s+para/i,
    /podemos\s+marcar/i,
    /podemos\s+agendar/i,
    /vamos\s+marcar/i,
    /vamos\s+agendar/i,
    /que\s+tal\s+(dia|às|as|\d)/i,
    /reuni[aã]o\s+(para|no\s+dia|às|as)/i,
    /dia\s+\d{1,2}[\s,]*(de\s+\w+)?\s*(às|as|,)?\s*\d{1,2}[h:]/i,
    /\d{1,2}[h:]\d{0,2}\s*(seria|funciona|pode\s+ser|está\s+bom|tudo\s+bem)/i,
    /horário.*\d{1,2}[h:]/i,
    /\d{1,2}[h:]\d{0,2}/,  // Any time pattern like 13h, 14:00
  ];

  const hasProposal = proposalPatterns.some(p => p.test(lower));
  console.log("[TOOL-EXECUTOR] hasPendingSchedulingContext:", hasProposal, "- last assistant msg snippet:", lower.substring(0, 100));
  return hasProposal;
}

// Check if the user's message is a simple confirmation
export function isSchedulingConfirmation(content: string): boolean {
  const lower = content.toLowerCase().trim();
  
  const confirmationPhrases = [
    "sim", "pode ser", "ok", "confirmo", "fechado", "combinado",
    "bora", "vamos", "aceito", "perfeito", "tudo bem", "beleza",
    "claro", "certo", "pode", "vamos la", "vamos lá", "por favor",
    "isso", "isso mesmo", "exato", "correto", "concordo",
    "ta bom", "tá bom", "ta bem", "tá bem", "ta otimo", "tá ótimo",
    "com certeza", "sem duvida", "sem dúvida", "pode sim",
    "sim pode ser", "sim por favor", "sim pode", "bora la", "bora lá",
    "quero sim", "quero", "confirma", "confirmar", "marca", "agenda"
  ];

  const isConfirmation = confirmationPhrases.some(phrase => lower.includes(phrase));
  console.log("[TOOL-EXECUTOR] isSchedulingConfirmation:", isConfirmation, "- content:", lower);
  return isConfirmation;
}

// ========== CONFIRMATION GATE FOR DESTRUCTIVE ACTIONS (cancel/reschedule) ==========

export const PENDING_ACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface PendingSchedulingAction {
  action: "cancel" | "reschedule";
  args: Record<string, any>;
  requested_at: string;
}

// Parse and validate the pending_scheduling_action stored on the lead (null if absent/expired/invalid)
export function parsePendingSchedulingAction(raw: unknown): PendingSchedulingAction | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, any>;
  if (p.action !== "cancel" && p.action !== "reschedule") return null;
  if (!p.requested_at) return null;
  const age = Date.now() - new Date(p.requested_at).getTime();
  if (isNaN(age) || age > PENDING_ACTION_TTL_MS) return null;
  return { action: p.action, args: p.args || {}, requested_at: p.requested_at };
}

// STRICT confirmation matcher for the deterministic gate.
// Much tighter than isSchedulingConfirmation: short message, no digits (a message
// like "pode deixar ok para amanhã às 16h" is a NEW instruction, not a confirmation).
export function isStrictConfirmation(content: string): boolean {
  const lower = content.toLowerCase().trim();
  if (lower.length > 60) return false;
  if (/\d/.test(lower)) return false;
  const confirmPhrases = [
    "sim", "pode ser", "confirmo", "confirma", "confirmar", "fechado", "combinado",
    "isso", "isso mesmo", "exato", "correto", "concordo", "pode sim", "pode cancelar",
    "pode remarcar", "quero sim", "quero", "por favor", "claro", "com certeza",
    "ok", "beleza", "perfeito", "vamos", "bora"
  ];
  const isConfirm = confirmPhrases.some(p => lower === p || lower.startsWith(p + " ") || lower.startsWith(p + ",") || lower.includes(" " + p));
  console.log("[TOOL-EXECUTOR] isStrictConfirmation:", isConfirm, "- content:", lower);
  return isConfirm;
}

// Format an appointment start_time for client-facing confirmation questions
function formatAppointmentForClient(startTime: string): { date: string; time: string } {
  const d = new Date(startTime);
  return {
    date: d.toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIMEZONE, day: "2-digit", month: "long" }),
    time: d.toLocaleTimeString("pt-BR", { timeZone: BRAZIL_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false })
  };
}

// Find the lead's active appointment (inbox lead -> contact -> crm_appointments)
async function findActiveAppointment(
  supabase: any,
  leadId: string,
  workspaceId: string
): Promise<{ id: string; start_time: string; title: string } | null> {
  const { data: inboxLead } = await supabase
    .from("leads")
    .select("contact_id")
    .eq("id", leadId)
    .maybeSingle();

  if (inboxLead?.contact_id) {
    const { data: appt } = await supabase
      .from("crm_appointments")
      .select("id, start_time, title")
      .eq("contact_id", inboxLead.contact_id)
      .eq("workspace_id", workspaceId)
      .in("status", ["scheduled", "confirmed"])
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (appt) return appt;
  }

  // Fallback: leadId may be a crm_leads id (crm_appointments.lead_id)
  const { data: apptByLead } = await supabase
    .from("crm_appointments")
    .select("id, start_time, title")
    .eq("lead_id", leadId)
    .eq("workspace_id", workspaceId)
    .in("status", ["scheduled", "confirmed"])
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();
  return apptByLead || null;
}

// Clear the pending action on the lead
export async function clearPendingSchedulingAction(supabase: any, leadId: string): Promise<void> {
  await supabase.from("leads").update({ pending_scheduling_action: null }).eq("id", leadId);
}

// Detect specific action from message content
export function detectSchedulingAction(content: string): "schedule" | "cancel" | "reschedule" | "check" | "info" | "list" {
  const lowerContent = content.toLowerCase();
  
  // List keywords (list ALL appointments) - check before info
  const listKeywords = [
    "quantos eu tenho", "quantas eu tenho", "quantos agendamentos", "quantas reunioes",
    "minhas reunioes", "meus agendamentos", "listar", "lista",
    "ver todos", "ver minhas", "todas as reunioes", "todos os agendamentos",
    "quantas vezes", "quantas marcadas", "quantos marcados"
  ];
  if (listKeywords.some(k => lowerContent.includes(k))) {
    return "list";
  }
  
  // Info keywords (check existing appointment)
  const infoKeywords = [
    "qual e a data", "qual a data", "quando e minha reuniao", "quando e minha reuniao",
    "tenho reuniao marcada", "tenho reuniao marcada", "estou agendada", "estou agendado",
    "meu agendamento", "minha reuniao", "minha reuniao", "data da reuniao", "data da reuniao",
    "horario da reuniao", "horario da reuniao", "qual meu horario", "qual meu horario",
    "quando e a reuniao", "quando e a reuniao", "quando esta marcado", "quando esta marcado",
    "confirmar meu agendamento", "confirmar agendamento", "informacoes da reuniao",
    "detalhes da reuniao", "detalhes do agendamento", "ver meu agendamento"
  ];
  if (infoKeywords.some(k => lowerContent.includes(k))) {
    return "info";
  }
  
  // Cancel keywords
  const cancelKeywords = ["cancelar", "cancela", "desmarcar", "desmarca", "nao vou poder", "nao vou poder", "nao posso mais", "nao posso mais"];
  if (cancelKeywords.some(k => lowerContent.includes(k))) {
    return "cancel";
  }
  
  // Reschedule keywords
  const rescheduleKeywords = ["remarcar", "reagendar", "mudar horario", "mudar horario", "trocar data", "alterar data", "alterar horario", "adiar", "antecipar"];
  if (rescheduleKeywords.some(k => lowerContent.includes(k))) {
    return "reschedule";
  }
  
  // Check availability keywords
  const checkKeywords = ["disponibilidade", "horarios disponiveis", "horarios disponiveis", "quando tem", "quais horarios", "quais horarios"];
  if (checkKeywords.some(k => lowerContent.includes(k))) {
    return "check";
  }
  
  return "schedule";
}

// Check if agent has scheduling tool enabled (now uses catalog)
export async function isSchedulingToolEnabled(
  supabase: any,
  workspaceId: string,
  agentId: string
): Promise<{ enabled: boolean; config: Record<string, any> }> {
  const agentTools = await getAgentTools(supabase, workspaceId, agentId);
  const schedulingTool = agentTools.find(t => t.tool.name === "schedule_appointment");
  
  return {
    enabled: schedulingTool !== undefined,
    config: schedulingTool?.config ?? {}
  };
}

// Get all enabled tools for an agent (uses catalog)
export async function getEnabledToolsForAgent(
  supabase: any,
  workspaceId: string,
  agentId: string
): Promise<{ tools: ToolDefinition[]; configs: Map<string, Record<string, any>> }> {
  const agentTools = await getAgentTools(supabase, workspaceId, agentId);
  const tools = agentTools.map(t => t.tool);
  const configs = new Map(agentTools.map(t => [t.tool.name, t.config]));
  
  return { tools, configs };
}

// Generate response with tool calling enabled
// IMPROVED: Separate user message from system prompt for better parameter extraction
export async function generateResponseWithTools(
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  leadId: string,
  workspaceId: string,
  agentId: string,
  assignedTo?: string,
  enabledTools?: ToolDefinition[]
): Promise<{ content: string | null; toolCalls: ToolCall[] | null; error: string | null }> {
  console.log("[TOOL-EXECUTOR] Generating response with tools enabled...");
  console.log("[TOOL-EXECUTOR] User message:", userMessage);
  
  // Build tools array from catalog definitions
  const toolsArray = enabledTools ? buildToolsArray(enabledTools) : [];
  
  // Build messages array - separate system and user messages
  // ANTI-HALLUCINATION: Reinforce tool usage for scheduling in system message
  const schedulingGuard = enabledTools?.some(t => t.name === "schedule_appointment")
    ? "\n\nIMPORTANTE: Para qualquer assunto relacionado a agendamento, datas ou horarios, voce DEVE usar a ferramenta schedule_appointment. NUNCA invente datas ou horarios. NUNCA liste horarios por conta propria. SEMPRE use a ferramenta.\n\nSEGURANCA: Cancelar ou remarcar exige confirmacao explicita do cliente — a ferramenta fara a pergunta de confirmacao; repasse-a ao cliente. NUNCA afirme que uma reuniao esta confirmada, mantida ou cancelada com base apenas no historico da conversa: se voce nao tem o resultado da ferramenta NESTE turno, use action=\"info\" para verificar o estado atual antes de afirmar qualquer coisa."
    : "";
  const messages = [
    { role: "system", content: systemPrompt + schedulingGuard },
    { role: "user", content: userMessage }
  ];
  
  if (toolsArray.length === 0) {
    console.log("[TOOL-EXECUTOR] No tools enabled, generating regular response");
    try {
      const response = await fetchWithTimeout(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages,
          }),
        },
        25000
      );
      
      if (!response.ok) {
        return { content: null, toolCalls: null, error: `AI gateway error: ${response.status}` };
      }
      
      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content, toolCalls: null, error: null };
    } catch (error) {
      return { content: null, toolCalls: null, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
  
  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: toolsArray,
          tool_choice: "auto"
        }),
      },
      25000
    );
    
    if (!response.ok) {
      if (response.status === 429) {
        return { content: null, toolCalls: null, error: "Rate limit exceeded" };
      }
      if (response.status === 402) {
        return { content: null, toolCalls: null, error: "Payment required" };
      }
      return { content: null, toolCalls: null, error: `AI gateway error: ${response.status}` };
    }
    
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    
    if (!message) {
      return { content: null, toolCalls: null, error: "No message in response" };
    }
    
    // Check if there are tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }));
      
      console.log("[TOOL-EXECUTOR] Tool calls detected:", toolCalls);
      return { content: null, toolCalls, error: null };
    }
    
    // Regular response without tool calls
    return { content: message.content, toolCalls: null, error: null };
    
  } catch (error) {
    console.error("[TOOL-EXECUTOR] Error:", error);
    return { content: null, toolCalls: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Execute a tool and get the result
export async function executeTool(
  toolCall: ToolCall,
  leadId: string,
  workspaceId: string,
  agentId: string,
  assignedTo?: string,
  originalMessage?: string,
  confirmed: boolean = false
): Promise<ToolResult> {
  console.log(`[TOOL-EXECUTOR] Executing tool: ${toolCall.name} (confirmed=${confirmed})`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  switch (toolCall.name) {
    case "schedule_appointment":
      return await executeScheduleAppointment(
        supabaseUrl,
        supabaseKey,
        leadId,
        workspaceId,
        agentId,
        toolCall.arguments,
        assignedTo,
        originalMessage,
        confirmed
      );
    
    default:
      return {
        success: false,
        data: null,
        message: `Tool "${toolCall.name}" not implemented`
      };
  }
}

// Extract date and time from user message as fallback
function extractDateTimeFromMessage(message: string): { date: string | null; time: string | null } {
  const lowerMsg = message.toLowerCase();
  
  // Extract time patterns: "14h", "14:00", "às 14h", "as 14:00", "14 horas"
  let time: string | null = null;
  const timePatterns = [
    /(\d{1,2})[h:](\d{2})?/i,                    // 14h, 14:00, 14h30
    /[àa]s?\s*(\d{1,2})(?:[h:](\d{2}))?/i,       // às 14h, as 14:00
    /(\d{1,2})\s*horas?/i                        // 14 horas
  ];
  
  for (const pattern of timePatterns) {
    const match = lowerMsg.match(pattern);
    if (match) {
      const hour = match[1].padStart(2, '0');
      const minutes = match[2] || '00';
      time = `${hour}:${minutes}`;
      break;
    }
  }
  
  // Extract date patterns
  let date: string | null = null;
  const dateKeywords: Record<string, string> = {
    'hoje': 'hoje',
    'amanha': 'amanha', 'amanhã': 'amanha',
    'segunda': 'segunda', 'segunda-feira': 'segunda',
    'terca': 'terca', 'terça': 'terca', 'terça-feira': 'terca',
    'quarta': 'quarta', 'quarta-feira': 'quarta',
    'quinta': 'quinta', 'quinta-feira': 'quinta',
    'sexta': 'sexta', 'sexta-feira': 'sexta',
    'sabado': 'sabado', 'sábado': 'sabado',
    'domingo': 'domingo'
  };
  
  for (const [keyword, value] of Object.entries(dateKeywords)) {
    if (lowerMsg.includes(keyword)) {
      date = value;
      break;
    }
  }
  
  console.log("[TOOL-EXECUTOR] Extracted from message - date:", date, "time:", time);
  return { date, time };
}

// Execute the schedule_appointment tool
async function executeScheduleAppointment(
  supabaseUrl: string,
  supabaseKey: string,
  leadId: string,
  workspaceId: string,
  agentId: string,
  args: Record<string, any>,
  assignedTo?: string,
  originalMessage?: string,
  confirmed: boolean = false
): Promise<ToolResult> {
  console.log("[TOOL-EXECUTOR] Executing schedule_appointment with args:", args);
  console.log("[TOOL-EXECUTOR] Full params:", { leadId, workspaceId, agentId, assignedTo });
  
  try {
    // Check scheduling_blocked flag on the contact linked to this lead
    try {
      const supabaseCheck = createSupabaseClient(supabaseUrl, supabaseKey);
      const { data: contactRow } = await supabaseCheck
        .from("crm_contacts")
        .select("id, scheduling_blocked")
        .eq("workspace_id", workspaceId)
        .eq("lead_id", leadId)
        .limit(1)
        .maybeSingle();
      if (contactRow?.scheduling_blocked === true) {
        console.log("[TOOL-EXECUTOR] scheduling_blocked=true on contact", contactRow.id);
        return { success: false, data: null, message: "No momento não encontramos horários disponíveis para agendamento." };
      }
    } catch (blockErr) {
      console.error("[TOOL-EXECUTOR] scheduling_blocked check failed (continuing):", blockErr);
    }


    // Get action from args (NEW: support for cancel/reschedule/check/list)
    const action = args.action || "schedule";
    
    // Map parameters - accept both 'date'/'time' (from LLM) and 'preferred_date'/'preferred_time' formats
    let preferredDate = args.date || args.preferred_date;
    let preferredTime = args.time || args.preferred_time;
    
    console.log("[TOOL-EXECUTOR] Action:", action, "- date:", preferredDate, "time:", preferredTime);
    
    // FALLBACK: If LLM didn't extract date/time from reschedule, try extracting from original message
    if ((action === "reschedule" || action === "schedule") && (!preferredDate || !preferredTime) && originalMessage) {
      console.log("[TOOL-EXECUTOR] Missing date/time, trying fallback extraction from:", originalMessage);
      const extracted = extractDateTimeFromMessage(originalMessage);
      preferredDate = preferredDate || extracted.date;
      preferredTime = preferredTime || extracted.time;
      console.log("[TOOL-EXECUTOR] After fallback - date:", preferredDate, "time:", preferredTime);
    }
    
    // Parse relative dates like "amanhã", "segunda", etc.
    if (preferredDate) {
      preferredDate = parseRelativeDate(preferredDate);
      console.log("[TOOL-EXECUTOR] Parsed date:", preferredDate);
    }

    // CONFIRMATION GATE: cancel/reschedule are destructive and require the lead's
    // explicit confirmation before executing. First call stores the pending action
    // on the lead and returns a confirmation question; the orchestrator executes it
    // (confirmed=true) only when the next message is a strict confirmation.
    if ((action === "cancel" || action === "reschedule") && !confirmed) {
      const supabaseGate = createSupabaseClient(supabaseUrl, supabaseKey);
      const appointment = await findActiveAppointment(supabaseGate, leadId, workspaceId);

      if (appointment) {
        const pending: PendingSchedulingAction = {
          action,
          args: {
            action,
            date: preferredDate || null,
            time: preferredTime || null,
            title: args.title || null,
            reason: args.reason || null,
            duration_minutes: args.duration_minutes || null
          },
          requested_at: new Date().toISOString()
        };
        await supabaseGate
          .from("leads")
          .update({ pending_scheduling_action: pending })
          .eq("id", leadId);

        const { date: apptDate, time: apptTime } = formatAppointmentForClient(appointment.start_time);
        let question: string;
        if (action === "cancel") {
          question = `Só para confirmar: você quer mesmo cancelar sua reunião de ${apptDate} às ${apptTime}? Responda "sim" para confirmar o cancelamento.`;
        } else if (preferredDate && preferredTime) {
          question = `Só para confirmar: você quer remarcar sua reunião de ${apptDate} às ${apptTime} para ${preferredDate} às ${preferredTime}? Responda "sim" para confirmar. Enquanto você não confirmar, o horário atual continua reservado.`;
        } else {
          question = `Só para confirmar: você quer remarcar sua reunião de ${apptDate} às ${apptTime}? Se sim, me diga a nova data e horário. Enquanto isso, o horário atual continua reservado.`;
        }

        console.log(`[TOOL-EXECUTOR] GATE: pending ${action} stored for lead ${leadId}, awaiting confirmation`);
        return {
          success: true,
          data: { needs_confirmation: true, action, appointment_id: appointment.id },
          message: question
        };
      }
      // No active appointment: fall through — the backend answers naturally
      // ("Você não tem nenhum agendamento ativo...") without destroying anything.
      console.log(`[TOOL-EXECUTOR] GATE: no active appointment found, letting backend respond`);
    }

    // Extract additional attendees (emails to add to the meeting invite)
    const additionalAttendees = args.additional_attendees || [];
    
    // Call the schedule-appointment edge function with action parameter
    const requestBody = {
      action,
      lead_id: leadId,
      workspace_id: workspaceId,
      agent_id: agentId,
      assigned_to: assignedTo,
      title: args.title || "Reunião",
      description: args.description,
      preferred_date: preferredDate,
      preferred_time: preferredTime,
      duration_minutes: args.duration_minutes || 30,
      reason: args.reason,
      additional_attendees: additionalAttendees
    };
    
    console.log("[TOOL-EXECUTOR] Sending to schedule-appointment:", JSON.stringify(requestBody));
    
    const response = await fetch(`${supabaseUrl}/functions/v1/schedule-appointment`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    
    return {
      success: result.success,
      data: result,
      message: result.message
    };
    
  } catch (error) {
    console.error("[TOOL-EXECUTOR] Error executing schedule_appointment:", error);
    return {
      success: false,
      data: null,
      message: "Erro ao processar agendamento. Por favor, tente novamente."
    };
  }
}


// Get current date in Brazil timezone using Intl API (handles DST correctly)
function getBrazilNow(): Date {
  const now = new Date();
  
  // Get Brazil date components using Intl (handles DST correctly)
  const brDateStr = now.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE }); // YYYY-MM-DD
  const brTimeStr = now.toLocaleTimeString('en-US', { 
    timeZone: BRAZIL_TIMEZONE, 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Parse components
  const [year, month, day] = brDateStr.split('-').map(Number);
  const [hours, minutes] = brTimeStr.split(':').map(Number);
  
  // Create a Date object with Brazil's current date/time (as local time)
  const brNow = new Date(year, month - 1, day, hours, minutes);
  
  const weekdayNames = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  console.log("[TOOL-EXECUTOR] Timezone debug - UTC now:", now.toISOString(), 
    "Brazil date:", brDateStr, "Brazil time:", brTimeStr,
    "Brazil weekday:", weekdayNames[brNow.getDay()]);
  
  return brNow;
}

// Parse relative date references to YYYY-MM-DD format
// FIXED: Now uses Brazil timezone (America/Sao_Paulo) for correct weekday calculation
function parseRelativeDate(input: string): string {
  const today = getBrazilNow();
  let lowerInput = input.toLowerCase().trim();
  
  console.log("[TOOL-EXECUTOR] parseRelativeDate input:", input, "- Brazil date:", today.toISOString().split("T")[0]);
  
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  
  // Extract date keywords from compound phrases like "amanhã às 14h" or "segunda às 10:00"
  const dateKeywords = [
    // Portuguese
    { pattern: /hoje/, keyword: "hoje" },
    { pattern: /amanh[ãa]/, keyword: "amanhã" },
    { pattern: /depois de amanh[ãa]/, keyword: "depois de amanhã" },
    { pattern: /domingo/, keyword: "domingo" },
    { pattern: /segunda/, keyword: "segunda" },
    { pattern: /ter[çc]a/, keyword: "terça" },
    { pattern: /quarta/, keyword: "quarta" },
    { pattern: /quinta/, keyword: "quinta" },
    { pattern: /sexta/, keyword: "sexta" },
    { pattern: /s[aá]bado/, keyword: "sábado" },
    // English
    { pattern: /today/, keyword: "hoje" },
    { pattern: /tomorrow/, keyword: "amanhã" },
    { pattern: /day after tomorrow/, keyword: "depois de amanhã" },
    { pattern: /sunday/, keyword: "domingo" },
    { pattern: /monday/, keyword: "segunda" },
    { pattern: /tuesday/, keyword: "terça" },
    { pattern: /wednesday/, keyword: "quarta" },
    { pattern: /thursday/, keyword: "quinta" },
    { pattern: /friday/, keyword: "sexta" },
    { pattern: /saturday/, keyword: "sábado" }
  ];
  
  // Find matching date keyword in compound phrase
  for (const { pattern, keyword } of dateKeywords) {
    if (pattern.test(lowerInput)) {
      lowerInput = keyword;
      break;
    }
  }
  
  // Today
  if (lowerInput === "hoje") {
    const result = today.toISOString().split("T")[0];
    console.log("[TOOL-EXECUTOR] Parsed 'hoje' as:", result);
    return result;
  }
  
  // Tomorrow
  if (lowerInput === "amanhã" || lowerInput === "amanha") {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = tomorrow.toISOString().split("T")[0];
    console.log("[TOOL-EXECUTOR] Parsed 'amanha' as:", result);
    return result;
  }
  
  // Day after tomorrow
  if (lowerInput.includes("depois de amanhã") || lowerInput.includes("depois de amanha")) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const result = dayAfter.toISOString().split("T")[0];
    console.log("[TOOL-EXECUTOR] Parsed 'depois de amanha' as:", result);
    return result;
  }
  
  // Weekday names
  const weekdays: Record<string, number> = {
    "domingo": 0, "segunda": 1, "terça": 2, "terca": 2, 
    "quarta": 3, "quinta": 4, "sexta": 5, "sábado": 6, "sabado": 6
  };
  
  const weekdayNames = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  
  for (const [dayName, dayNum] of Object.entries(weekdays)) {
    if (lowerInput.includes(dayName)) {
      const result = new Date(today);
      const currentDay = result.getDay();
      let daysToAdd = dayNum - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next week
      result.setDate(result.getDate() + daysToAdd);
      
      const resultStr = result.toISOString().split("T")[0];
      const resultWeekday = weekdayNames[result.getDay()];
      
      console.log(`[TOOL-EXECUTOR] Parsed '${dayName}' as: ${resultStr} (${resultWeekday})`);
      console.log(`[TOOL-EXECUTOR] Current day: ${currentDay} (${weekdayNames[currentDay]}), target: ${dayNum}, daysToAdd: ${daysToAdd}`);
      
      return resultStr;
    }
  }
  
  // Month names in Portuguese
  const monthNames: Record<string, number> = {
    'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3,
    'maio': 4, 'junho': 5, 'julho': 6, 'agosto': 7,
    'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
  };

  // Pattern: "13 de janeiro de 2026" or "13 de janeiro"
  const ptDateMatch = lowerInput.match(/(\d{1,2})\s*de\s*([a-záêçã]+)(?:\s*de\s*(\d{4}))?/i);
  if (ptDateMatch) {
    const day = parseInt(ptDateMatch[1]);
    const monthStr = ptDateMatch[2].toLowerCase();
    const year = ptDateMatch[3] ? parseInt(ptDateMatch[3]) : today.getFullYear();
    
    const month = monthNames[monthStr];
    if (month !== undefined) {
      const result = new Date(year, month, day);
      const resultStr = result.toISOString().split("T")[0];
      console.log(`[TOOL-EXECUTOR] Parsed Portuguese date '${input}' as: ${resultStr}`);
      return resultStr;
    }
  }

  // Pattern: "dia 15" -> next occurrence of day 15
  // GUARD: Only use "dia X" pattern if NO weekday was already matched above
  // This prevents "segunda dia 15h" from being interpreted as "day 15 of month"
  const dayOnlyMatch = lowerInput.match(/dia\s*(\d{1,2})/i);
  if (dayOnlyMatch) {
    const targetDay = parseInt(dayOnlyMatch[1]);
    // If targetDay looks like a time (>= 24 or input has "h" after the number), skip
    const hasTimeIndicator = new RegExp(`dia\\s*${targetDay}\\s*h`, 'i').test(input);
    if (targetDay <= 31 && !hasTimeIndicator) {
      const result = new Date(today);
      result.setDate(targetDay);
      if (result <= today) {
        result.setMonth(result.getMonth() + 1);
      }
      const resultStr = result.toISOString().split("T")[0];
      console.log(`[TOOL-EXECUTOR] Parsed 'dia ${targetDay}' as: ${resultStr}`);
      return resultStr;
    } else {
      console.log(`[TOOL-EXECUTOR] Skipping 'dia ${targetDay}' - looks like a time reference (${targetDay}h)`);
    }
  }

  // Try parsing as a date
  try {
    // Handle DD/MM format
    const ddmmMatch = lowerInput.match(/(\d{1,2})\/(\d{1,2})/);
    if (ddmmMatch) {
      const day = parseInt(ddmmMatch[1]);
      const month = parseInt(ddmmMatch[2]) - 1;
      const result = new Date(today.getFullYear(), month, day);
      if (result < today) result.setFullYear(result.getFullYear() + 1);
      const resultStr = result.toISOString().split("T")[0];
      console.log("[TOOL-EXECUTOR] Parsed DD/MM format as:", resultStr);
      return resultStr;
    }
  } catch {
    // Ignore parsing errors
  }
  
  // Return as-is if we can't parse it
  console.log("[TOOL-EXECUTOR] Could not parse date from:", input);
  return input;
}

// Build a prompt that includes tool-calling context
export function buildToolAwarePrompt(
  basePrompt: string,
  enabledTools: ToolDefinition[]
): string {
  if (enabledTools.length === 0) {
    return basePrompt;
  }
  
  const toolNames = enabledTools.map(t => t.name).join(", ");
  const hasScheduling = enabledTools.some(t => t.name === "schedule_appointment");
  
  let toolInstructions = `
---
FERRAMENTAS DISPONÍVEIS: ${toolNames}

`;

  if (hasScheduling) {
    toolInstructions += `
FERRAMENTA: schedule_appointment
Esta ferramenta gerencia TODOS os aspectos de agendamento:

REGRA ABSOLUTA - NUNCA RESPONDA SOBRE DATAS/HORARIOS SEM USAR A FERRAMENTA:
- Voce NAO sabe quais horarios estao disponiveis
- Voce NAO deve inventar datas ou horarios
- SEMPRE use action="check" quando o cliente perguntar sobre disponibilidade
- SEMPRE use action="schedule" quando o cliente quiser agendar
- Se voce nao tem certeza do horario, use action="check" primeiro
- NUNCA liste horarios por conta propria - use a ferramenta
- Se o cliente perguntar "quais horarios tem?", use action="check", NAO invente horarios

REGRA DE EXTRACAO DE DATA:
- Se o cliente mencionar um DIA DA SEMANA (segunda, terca, etc.), use o dia da semana como date
- Ignore numeros que parecem horas (15h, 14h) ao extrair a data
- Exemplo: "quero segunda dia 15 as 14h" -> date: "segunda", time: "14:00"
- Exemplo: "segunda as 14h" -> date: "segunda", time: "14:00"
- Exemplo: "quero na quinta as 10h" -> date: "quinta", time: "10:00"

ACOES DISPONIVEIS (parametro "action"):
- "schedule": Agendar nova reuniao (padrao)
- "cancel": Cancelar reuniao existente
- "reschedule": Remarcar reuniao (cancela atual e agenda nova)
- "check": Verificar disponibilidade de horarios
- "info": Consultar detalhes de agendamento existente
- "list": Listar TODOS os agendamentos ativos do lead

QUANDO USAR CADA ACAO:
- Cliente quer AGENDAR: action="schedule" + date + time
- Cliente quer CANCELAR: action="cancel"
- Cliente quer REMARCAR: action="reschedule" + nova date + time
- Cliente pergunta DISPONIBILIDADE: action="check"
- Cliente pergunta SOBRE AGENDAMENTO EXISTENTE: action="info"
- Cliente pergunta QUANTOS agendamentos tem: action="list"

**REGRA CRITICA - SELECAO DE HORARIO:**
Quando voce ofereceu horarios de um dia especifico (ex: "Segunda-feira as 09h00 / 10h00 / 11h00") e o cliente responde APENAS com o horario (ex: "11h", "10h", "as 14h"):
-> DEVE chamar action="schedule" com a DATA que voce mencionou + o horario escolhido
-> NAO pergunte a data novamente - voce ja informou o dia!
-> Use o contexto da conversa para determinar a data

EXEMPLOS:
- Voce disse "Segunda-feira as 09h/10h/11h", cliente responde "11h" -> action: "schedule", date: "segunda", time: "11:00"
- "Quero agendar uma reuniao amanha as 14h" -> action: "schedule", date: "amanha", time: "14:00"
- "Preciso cancelar minha reuniao" -> action: "cancel"
- "Quero remarcar para terca as 10h" -> action: "reschedule", date: "terca", time: "10:00"
- "Quais horarios tem disponivel?" -> action: "check"
- "Qual e a data e horario que estou agendada?" -> action: "info"
- "Tenho alguma reuniao marcada?" -> action: "info"
- "Quando e minha reuniao?" -> action: "info"
- "Quantas reunioes eu tenho?" -> action: "list"
- "Quantos agendamentos eu tenho?" -> action: "list"
- "Minhas reunioes" -> action: "list"

IMPORTANTE:
- ANALISE O HISTORICO DA CONVERSA para extrair a data quando o cliente so informar o horario
- Se o horario solicitado nao estiver disponivel, a ferramenta retornara 2 alternativas proximas
- Sempre confirme o agendamento apos a ferramenta retornar sucesso
- Para cancelamento, info e list, voce NAO precisa de data/hora - a ferramenta encontra os agendamentos ativos

REGRA DE SEGURANCA - ACOES DESTRUTIVAS (cancel e reschedule):
- Cancelar ou remarcar uma reuniao existente exige CONFIRMACAO EXPLICITA do cliente antes de executar.
- A ferramenta aplica essa protecao sozinha: na primeira chamada de cancel/reschedule ela NAO executa - ela devolve uma pergunta de confirmacao. Repasse essa pergunta ao cliente de forma natural.
- Uma PERGUNTA do cliente ("sera que conseguimos antecipar?", "da pra mudar o horario?", "consigo cancelar?") NAO e uma ordem. Pode chamar a ferramenta normalmente - a confirmacao sera pedida antes de qualquer mudanca.
- NUNCA afirme que uma reuniao esta "confirmada", "mantida" ou "cancelada" com base apenas no historico da conversa. Se voce nao executou a ferramenta NESTE turno, use action="info" para verificar o estado real antes de afirmar.
- Enquanto o cliente nao confirmar a troca, o agendamento atual continua valendo - deixe isso claro para ele.

REGRA CRITICA - SEM HORARIOS DISPONIVEIS:
Quando a ferramenta retornar que nao ha horarios disponiveis para o dia solicitado, sugira outros horarios e dias mais proximos do solicitado. Use action="check" com outra data para buscar alternativas automaticamente.
NUNCA prometa "gerar um link", "enviar link de agendamento", "compartilhar um link" ou qualquer acao fora das ferramentas listadas acima. Voce NAO tem capacidade de gerar links.

`;
  }
  
  // Add instructions for add_attendee action within schedule_appointment
  if (hasScheduling) {
    toolInstructions += `
### Acao Especial: add_attendee (dentro de schedule_appointment)
Use action="add_attendee" para ADICIONAR PARTICIPANTES a uma reuniao JA AGENDADA.

PARAMETROS:
- action: "add_attendee" (obrigatorio)
- additional_attendees: ["email@empresa.com"] (lista de emails a adicionar)

QUANDO USAR:
- Cliente pede para adicionar outra pessoa a reuniao existente
- Cliente quer que mais alguem receba o convite
- Cliente menciona "adicione tambem", "inclua o email", "mande para", etc.

EXEMPLOS:
- "Adicione o rodrigo@empresa.com na reuniao" -> action: "add_attendee", additional_attendees: ["rodrigo@empresa.com"]
- "Inclua tambem meu colega joao@empresa.com" -> action: "add_attendee", additional_attendees: ["joao@empresa.com"]
- "Mande o convite para maria@empresa.com tambem" -> action: "add_attendee", additional_attendees: ["maria@empresa.com"]

REGRA CRITICA:
- Voce SO PODE dizer que adicionou alguem se usou esta acao!
- NUNCA diga que adicionou um participante sem chamar action="add_attendee"
- Se a ferramenta retornar erro, informe ao cliente o problema

`;
  }
  
  toolInstructions += `---

`;
  
  return toolInstructions + basePrompt;
}

// ========== COMPOSE REPLY FROM TOOL RESULT ==========

/**
 * Feed the tool result back to the model so the agent replies knowing what
 * actually happened (instead of parroting the raw tool message and later
 * asserting a state that no longer exists).
 * FALLBACK: returns null on any error — caller uses the raw tool message.
 */
export async function composeToolResponse(
  systemPrompt: string,
  userMessage: string,
  toolCall: ToolCall,
  toolResult: ToolResult,
  apiKey: string
): Promise<string | null> {
  const factSheet = `Voce acabou de executar a ferramenta "${toolCall.name}" com os argumentos ${JSON.stringify(toolCall.arguments)}.
Resultado real da ferramenta: success=${toolResult.success}, mensagem="${toolResult.message}"

REGRAS PARA SUA RESPOSTA:
- Responda ao cliente baseando-se EXCLUSIVAMENTE nesse resultado.
- NAO altere datas, horarios, links ou valores retornados pela ferramenta.
- NAO acrescente informacoes que nao estejam no resultado.
- Se o resultado for uma pergunta de confirmacao, repasse a pergunta ao cliente de forma natural, sem executar nada.
- Se success=false, informe o problema com honestidade e ofereca o proximo passo.
- Mantenha o tom e persona definidos acima. Seja breve.`;

  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt + "\n\n---\n" + factSheet },
            { role: "user", content: userMessage }
          ],
        }),
      },
      15000
    );

    if (!response.ok) {
      console.error("[TOOL-EXECUTOR] composeToolResponse gateway error:", response.status);
      return null;
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (error) {
    console.error("[TOOL-EXECUTOR] composeToolResponse failed:", error);
    return null;
  }
}

// ========== LLM-BASED TOOL INTENT DETECTION ==========

export interface ToolIntentDecision {
  shouldUseTools: boolean;
  action: string;
  reason: string;
}

/**
 * Use LLM (gemini-2.5-flash-lite) to decide if the user's message requires tool usage.
 * Replaces keyword-based detection (hasSchedulingIntent, isSchedulingConfirmation, hasPendingSchedulingContext).
 * 
 * FALLBACK: If the LLM call fails for any reason, returns { shouldUseTools: false } 
 * so the message follows the normal (safe) flow without tools.
 */
export async function detectToolIntentWithLLM(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  enabledToolNames: string[],
  apiKey: string
): Promise<ToolIntentDecision> {
  const defaultResult: ToolIntentDecision = { shouldUseTools: false, action: "none", reason: "fallback" };
  
  // If no tools are enabled, skip LLM call entirely
  if (!enabledToolNames || enabledToolNames.length === 0) {
    console.log("[TOOL-INTENT-LLM] No tools enabled, skipping");
    return defaultResult;
  }

  // Get last assistant message for context
  const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === "assistant" || m.role === "model");
  const contextLine = lastAssistantMsg 
    ? `Ultima mensagem do assistente: "${lastAssistantMsg.content.substring(0, 200)}"`
    : "Nenhuma mensagem anterior do assistente.";

  const prompt = `Voce e um classificador de intencao. Analise se a mensagem do usuario requer o uso de alguma ferramenta.

Ferramentas disponiveis: [${enabledToolNames.join(", ")}]

${enabledToolNames.includes("schedule_appointment") ? `A ferramenta "schedule_appointment" deve ser ativada quando o usuario quer:
- Agendar, marcar ou reservar horario/reuniao/consulta
- Cancelar, desmarcar um agendamento existente
- Remarcar, reagendar, mudar horario de um agendamento
- Confirmar um horario proposto pelo assistente (ex: "pode ser", "sim", "fechado", "ok")
- Consultar informacoes sobre agendamentos existentes
- Verificar disponibilidade de horarios
- Adicionar participantes a uma reuniao
- Listar seus agendamentos

NAO ative a ferramenta para:
- Saudacoes (oi, ola, bom dia)
- Perguntas sobre produtos, servicos ou informacoes gerais
- Conversas normais sem relacao com agendamento
- Nomes de pessoas (ex: "meu nome e thiago")
- Reclamacoes ou pedidos de suporte` : ""}

${contextLine}
Mensagem do usuario: "${userMessage}"

Retorne APENAS um JSON valido (sem markdown): {"should_use_tools": true/false, "action": "schedule|cancel|reschedule|check|list|info|add_attendee|none", "reason": "explicacao curta"}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("[TOOL-INTENT-LLM] API error:", response.status);
      return defaultResult;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    
    if (!raw) {
      console.error("[TOOL-INTENT-LLM] Empty response");
      return defaultResult;
    }

    // Clean markdown wrapping if present
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const decision: ToolIntentDecision = {
      shouldUseTools: parsed.should_use_tools === true,
      action: parsed.action || "none",
      reason: parsed.reason || "no reason",
    };

    console.log(`[TOOL-INTENT-LLM] Decision: shouldUseTools=${decision.shouldUseTools}, action=${decision.action}, reason=${decision.reason}`);
    return decision;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[TOOL-INTENT-LLM] Fallback triggered:", errMsg);
    return defaultResult;
  }
}
