// Agent selection module - selects the best agent for a given intent

import { IntentCategory } from "./utils.ts";

export interface SelectedAgent {
  id: string;
  name: string;
  persona_prompt: string;
  category: string;
  split_messages: boolean;
  keywords: string[];
  is_default_for_category: boolean;
}

// Select best agent based on intent, keywords, and category
export async function selectAgentByCategory(
  supabase: any,
  workspaceId: string,
  intent: IntentCategory,
  currentAgentId: string | null,
  userMessage: string = ""
): Promise<SelectedAgent | null> {
  console.log("[AGENT] Selecting agent for intent:", intent, "in workspace:", workspaceId);
  console.log("[AGENT] User message:", userMessage.substring(0, 100));
  
  // Fetch from legacy agents table
  const { data: legacyAgents, error: legacyError } = await supabase
    .from("agents")
    .select("id, name, persona_prompt, tone, category, split_messages, keywords, is_default_for_category, category_id, live_chat_enabled")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("is_archived", false)
    .eq("live_chat_enabled", true);

  // Fetch from agent_instances table
  const { data: instanceAgents, error: instanceError } = await supabase
    .from("agent_instances")
    .select("id, name, system_prompt, tone, category, split_messages, keywords, is_default_for_category, category_id, live_chat_enabled")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("is_archived", false)
    .eq("live_chat_enabled", true);

  // Fetch dynamic categories for this workspace
  const { data: dynamicCategories } = await supabase
    .from("agent_categories")
    .select("id, slug")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  // Build category ID to slug map
  const categoryIdToSlug: Record<string, string> = {};
  (dynamicCategories || []).forEach((cat: any) => {
    categoryIdToSlug[cat.id] = cat.slug;
  });

  if (legacyError) {
    console.error("[AGENT] Error fetching legacy agents:", legacyError);
  }
  if (instanceError) {
    console.error("[AGENT] Error fetching agent instances:", instanceError);
  }

  // Combine and normalize agents from both tables
  const agents = [
    ...(legacyAgents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      persona_prompt: a.persona_prompt || "",
      category: a.category_id ? categoryIdToSlug[a.category_id] : (a.category || "GERAL"),
      split_messages: a.split_messages !== false,
      keywords: a.keywords || [],
      is_default_for_category: a.is_default_for_category || false,
      source: 'agents'
    })),
    ...(instanceAgents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      persona_prompt: a.system_prompt || "",
      category: a.category_id ? categoryIdToSlug[a.category_id] : (a.category || "GERAL"),
      split_messages: a.split_messages !== false,
      keywords: a.keywords || [],
      is_default_for_category: a.is_default_for_category || false,
      source: 'agent_instances'
    }))
  ];

  if (agents.length === 0) {
    console.log("[AGENT] No active agents found in either table");
    return null;
  }

  console.log(`[AGENT] Found ${agents.length} active agents (${legacyAgents?.length || 0} legacy, ${instanceAgents?.length || 0} instances)`);

  // Filter agents by intent/category
  const intentUpper = intent.toUpperCase();
  const categoryAgents = agents.filter(agent => {
    const agentCategory = (agent.category || "GERAL").toUpperCase();
    return agentCategory === intentUpper;
  });

  console.log(`[AGENT] Found ${categoryAgents.length} agents in category ${intentUpper}`);

  // If no agents in specific category, try GERAL as fallback
  const candidateAgents = categoryAgents.length > 0 
    ? categoryAgents 
    : agents.filter(a => (a.category || "GERAL").toUpperCase() === "GERAL");

  if (candidateAgents.length === 0) {
    console.log("[AGENT] No agents found for category or GERAL, returning first available");
    return formatAgentResult(agents[0]);
  }

  // PRIORITY: If current agent is already in the same category, keep it
  // This prevents unnecessary transfers between agents of the same category
  if (currentAgentId) {
    const currentAgentInCategory = candidateAgents.find(a => a.id === currentAgentId);
    if (currentAgentInCategory) {
      console.log(`[AGENT] Keeping current agent ${currentAgentInCategory.name} (already in category ${intentUpper})`);
      return formatAgentResult(currentAgentInCategory);
    }
  }

  // If only one agent in category, return it
  if (candidateAgents.length === 1) {
    console.log(`[AGENT] Only one agent in category, returning: ${candidateAgents[0].name}`);
    return formatAgentResult(candidateAgents[0]);
  }

  // Multiple agents - try keyword matching
  if (userMessage) {
    const messageWords = userMessage.toLowerCase().split(/\s+/);
    
    for (const agent of candidateAgents) {
      const keywords = agent.keywords || [];
      if (keywords.length === 0) continue;

      const hasMatch = keywords.some((kw: string) => {
        const kwLower = kw.toLowerCase();
        // Check if any word in message contains the keyword
        return messageWords.some(word => word.includes(kwLower)) ||
               // Or if the full message contains the keyword phrase
               userMessage.toLowerCase().includes(kwLower);
      });

      if (hasMatch) {
        console.log(`[AGENT] Keyword match found for ${agent.name} (keywords: ${keywords.join(", ")})`);
        return formatAgentResult(agent);
      }
    }
    console.log("[AGENT] No keyword matches found");
  }

  // No keyword match - try default agent for category
  const defaultAgent = candidateAgents.find(a => a.is_default_for_category);
  if (defaultAgent) {
    console.log(`[AGENT] Using default agent for category: ${defaultAgent.name}`);
    return formatAgentResult(defaultAgent);
  }

  // Final fallback - return first agent
  console.log(`[AGENT] Using first agent as fallback: ${candidateAgents[0].name}`);
  return formatAgentResult(candidateAgents[0]);
}

function formatAgentResult(agent: any): SelectedAgent {
  return { 
    id: agent.id, 
    name: agent.name,
    persona_prompt: agent.persona_prompt || "",
    category: agent.category || "GERAL",
    split_messages: agent.split_messages !== false,
    keywords: agent.keywords || [],
    is_default_for_category: agent.is_default_for_category || false
  };
}

// Get agent name by ID
export async function getAgentName(supabase: any, agentId: string): Promise<string | null> {
  // Try legacy agents table first
  const { data: legacyData, error: legacyError } = await supabase
    .from("agents")
    .select("name, category")
    .eq("id", agentId)
    .single();
  
  if (!legacyError && legacyData) {
    return `${legacyData.name} (${legacyData.category || 'GERAL'})`;
  }
  
  // Try agent_instances table
  const { data: instanceData, error: instanceError } = await supabase
    .from("agent_instances")
    .select("name, category")
    .eq("id", agentId)
    .single();
  
  if (!instanceError && instanceData) {
    return `${instanceData.name} (${instanceData.category || 'GERAL'})`;
  }
  
  return null;
}

// Log agent transfer
export async function logAgentTransfer(
  supabase: any,
  leadId: string,
  workspaceId: string,
  fromAgentId: string | null,
  toAgentId: string,
  fromIntent: string | null,
  toIntent: string,
  reason: string
): Promise<void> {
  console.log("[TRANSFER] Logging agent transfer");
  
  const { error } = await supabase.from("agent_transfers").insert({
    lead_id: leadId,
    workspace_id: workspaceId,
    from_agent_id: fromAgentId,
    to_agent_id: toAgentId,
    from_intent: fromIntent,
    to_intent: toIntent,
    reason,
  });

  if (error) {
    console.error("[TRANSFER] Error logging transfer:", error);
  }
}

// Send transfer notification
export async function sendTransferNotification(
  supabase: any,
  leadId: string,
  workspaceId: string,
  fromAgentName: string | null,
  toAgentName: string,
  toIntent: string
): Promise<string | null> {
  // Fetch dynamic category labels
  const { data: categories } = await supabase
    .from("agent_categories")
    .select("slug, name")
    .eq("workspace_id", workspaceId);

  const intentLabels: Record<string, string> = {
    VENDAS: "Vendas",
    SUPORTE: "Suporte Técnico",
    RH: "Recursos Humanos",
    MARKETING: "Marketing",
    GERAL: "Atendimento Geral",
    OBJECAO: "Negociação",
  };
  
  // Add dynamic categories
  (categories || []).forEach((cat: any) => {
    intentLabels[cat.slug] = cat.name;
  });
  
  const departmentLabel = intentLabels[toIntent] || toIntent;
  const notificationMessage = `Vou te transferir para nosso especialista em ${departmentLabel} que poderá te ajudar melhor com isso! Um momento...`;
  
  const { error } = await supabase.from("messages").insert({
    lead_id: leadId,
    workspace_id: workspaceId,
    content: notificationMessage,
    sender_type: "ai",
  });

  if (error) {
    console.error("[TRANSFER] Error saving notification:", error);
    return null;
  }
  
  return notificationMessage;
}

// Check if specialist suggestion should be made
export function shouldSuggestSpecialist(insights: any, currentAgentCategory: string): boolean {
  const hasHighSeverityObjection = insights.objections?.some((o: any) => o.severity >= 4);
  const suggestedDifferent = insights.suggested_specialist && 
    insights.suggested_specialist !== currentAgentCategory &&
    insights.suggested_specialist !== "GERAL";
  
  return hasHighSeverityObjection && suggestedDifferent === true;
}

// Get agent by ID (for keeping current agent)
export async function getAgentById(
  supabase: any,
  agentId: string
): Promise<SelectedAgent | null> {
  console.log("[AGENT] Fetching agent by ID:", agentId);
  
  // Fetch dynamic categories
  const { data: dynamicCategories } = await supabase
    .from("agent_categories")
    .select("id, slug")
    .eq("is_active", true);

  const categoryIdToSlug: Record<string, string> = {};
  (dynamicCategories || []).forEach((cat: any) => {
    categoryIdToSlug[cat.id] = cat.slug;
  });
  
  // Try legacy agents table first
  const { data: legacyData, error: legacyError } = await supabase
    .from("agents")
    .select("id, name, persona_prompt, category, split_messages, keywords, is_default_for_category, category_id, live_chat_enabled")
    .eq("id", agentId)
    .single();
  
  if (!legacyError && legacyData) {
    if (legacyData.live_chat_enabled === false) {
      console.log("[AGENT] Agent disabled for live chat:", agentId);
      return null;
    }
    return {
      id: legacyData.id,
      name: legacyData.name,
      persona_prompt: legacyData.persona_prompt || "",
      category: legacyData.category_id ? categoryIdToSlug[legacyData.category_id] : (legacyData.category || "GERAL"),
      split_messages: legacyData.split_messages !== false,
      keywords: legacyData.keywords || [],
      is_default_for_category: legacyData.is_default_for_category || false
    };
  }
  
  // Try agent_instances table
  const { data: instanceData, error: instanceError } = await supabase
    .from("agent_instances")
    .select("id, name, system_prompt, category, split_messages, keywords, is_default_for_category, category_id, live_chat_enabled")
    .eq("id", agentId)
    .single();
  
  if (!instanceError && instanceData) {
    if (instanceData.live_chat_enabled === false) {
      console.log("[AGENT] Agent disabled for live chat:", agentId);
      return null;
    }
    return {
      id: instanceData.id,
      name: instanceData.name,
      persona_prompt: instanceData.system_prompt || "",
      category: instanceData.category_id ? categoryIdToSlug[instanceData.category_id] : (instanceData.category || "GERAL"),
      split_messages: instanceData.split_messages !== false,
      keywords: instanceData.keywords || [],
      is_default_for_category: instanceData.is_default_for_category || false
    };
  }
  
  console.log("[AGENT] Agent not found:", agentId);
  return null;
}
