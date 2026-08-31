// Shared utilities and types for the orchestrator

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Intent categories for agent selection (includes OBJECAO for objection handling)
export type IntentCategory = "VENDAS" | "SUPORTE" | "RH" | "MARKETING" | "GERAL" | "HUMANO" | "OBJECAO";

// Session gap threshold in hours - if more time has passed, treat as new session
export const SESSION_GAP_HOURS = 4;

// API timeout configuration - OPTIMIZED: reduced from 15s to 10s for faster responses
export const API_TIMEOUT_MS = 10000; // 10 seconds timeout for API calls
export const HISTORY_LIMIT = 15; // Limit conversation history to 15 messages

// Conversation insights structure
export interface Objection {
  type: string;
  description: string;
  suggested_response: string;
  severity: number;
}

export interface ConversationInsights {
  sentiment_score: number;
  sentiment_label: string;
  objections: Objection[];
  purchase_intent: number;
  urgency_level: string;
  suggested_specialist: string | null;
  suggested_action: string;
  conversation_summary: string;
}

export interface SessionInfo {
  isNewSession: boolean;
  reason: string;
  hoursSinceLastMessage: number;
  limitHistory: boolean;
}

// Fetch with timeout wrapper
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[TIMEOUT] Request to ${url} timed out after ${timeoutMs}ms`);
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[TIMEOUT] Request aborted after ${timeoutMs}ms`);
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Get default insights for error cases
export function getDefaultInsights(): ConversationInsights {
  console.log("[INSIGHTS] Using default insights values");
  return {
    sentiment_score: 5,
    sentiment_label: "neutro",
    objections: [],
    purchase_intent: 50,
    urgency_level: "media",
    suggested_specialist: null,
    suggested_action: "Continuar atendimento normal",
    conversation_summary: "Conversa em andamento.",
  };
}

// Convert priority string to number
export function getPriorityValue(priority: string): number {
  const priorityMap: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
  return priorityMap[priority] || 1;
}

// Brazil timezone constant
export const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

// Get current date/time in Brazil timezone (America/Sao_Paulo)
export function getBrazilDateTime(): { 
  dateString: string; 
  timeString: string; 
  weekday: string;
  day: number;
  month: number;
  year: number;
} {
  const now = new Date();
  
  // Format in Brazil timezone - YYYY-MM-DD
  const brDateStr = now.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE });
  
  // Format time HH:MM
  const brTimeStr = now.toLocaleTimeString('pt-BR', { 
    timeZone: BRAZIL_TIMEZONE, 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  // Get weekday in Portuguese
  const brWeekday = now.toLocaleDateString('pt-BR', { 
    timeZone: BRAZIL_TIMEZONE, 
    weekday: 'long' 
  });
  
  // Parse date components
  const [year, month, day] = brDateStr.split('-').map(Number);
  
  console.log("[UTILS] Brazil DateTime - date:", brDateStr, "time:", brTimeStr, "weekday:", brWeekday);
  
  return {
    dateString: brDateStr,
    timeString: brTimeStr,
    weekday: brWeekday,
    day,
    month,
    year
  };
}

// Check if a date string (YYYY-MM-DD) is today, tomorrow, or other in Brazil timezone
export function getRelativeDateLabel(dateStr: string): 'hoje' | 'amanhã' | null {
  const br = getBrazilDateTime();
  const todayStr = br.dateString;
  
  // Calculate tomorrow in Brazil timezone
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE });
  
  console.log("[UTILS] Relative date check - input:", dateStr, "today:", todayStr, "tomorrow:", tomorrowStr);
  
  if (dateStr === todayStr) return 'hoje';
  if (dateStr === tomorrowStr) return 'amanhã';
  return null;
}

