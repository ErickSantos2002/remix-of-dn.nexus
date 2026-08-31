// Session detection module - simplified LLM-first approach
// Always returns history context, lets LLM decide on continuity

import { SESSION_GAP_HOURS, SessionInfo } from "./utils.ts";

// Main session detection function - simplified
// Now only returns isNewSession=true for first_message
// Always passes hoursSinceLastMessage as context for the LLM
export async function detectNewSession(
  messages: { content: string; sender_type: string; created_at: string }[],
  currentMessage: string,
  apiKey: string
): Promise<SessionInfo> {
  // If no previous messages, it's definitely a new session
  if (!messages || messages.length === 0) {
    console.log("[SESSION] First message - new session");
    return { 
      isNewSession: true, 
      reason: "first_message", 
      hoursSinceLastMessage: 0, 
      limitHistory: false 
    };
  }

  // Get the last message timestamp
  const lastMessage = messages[messages.length - 1];
  const lastMessageTime = new Date(lastMessage.created_at);
  const now = new Date();
  const hoursDiff = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

  console.log(`[SESSION] Time since last message: ${hoursDiff.toFixed(2)} hours (${(hoursDiff * 60).toFixed(1)} minutes)`);
  console.log(`[SESSION] Last message timestamp: ${lastMessage.created_at}`);
  console.log(`[SESSION] Current time: ${now.toISOString()}`);

  // LLM-FIRST APPROACH: Never force isNewSession based on time gap
  // The LLM will receive the history and hoursSinceLastMessage context
  // and will naturally decide how to continue the conversation
  
  // Only flag large gaps for logging/context, but don't reset session
  if (hoursDiff >= SESSION_GAP_HOURS) {
    console.log(`[SESSION] Large time gap detected (${hoursDiff.toFixed(1)}h) - but continuing session for LLM to decide`);
  }

  // Always return isNewSession=false for existing conversations
  // The LLM will receive the full history and can decide how to respond
  return { 
    isNewSession: false, 
    reason: "continuation", 
    hoursSinceLastMessage: hoursDiff,
    limitHistory: false 
  };
}
