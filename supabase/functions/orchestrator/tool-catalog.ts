// Tool catalog module - fetches tool definitions from database
import { createClient } from "npm:@supabase/supabase-js@2";

export interface ToolDefinition {
  id: string;
  name: string;
  label: string;
  description: string | null;
  function_schema: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
  default_config: Record<string, any>;
  requires_setup: string[];
}

// Cache for tool definitions (avoid repeated DB calls)
const toolCache: Map<string, ToolDefinition> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all active tools from the catalog
 */
export async function fetchToolCatalog(supabase: any): Promise<ToolDefinition[]> {
  // Check cache
  const now = Date.now();
  if (toolCache.size > 0 && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log("[TOOL-CATALOG] Using cached tool definitions");
    return Array.from(toolCache.values());
  }

  console.log("[TOOL-CATALOG] Fetching tool definitions from database");
  
  const { data, error } = await supabase
    .from("tool_catalog")
    .select("id, name, label, description, function_schema, default_config, requires_setup")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[TOOL-CATALOG] Error fetching tools:", error);
    return [];
  }

  // Update cache
  toolCache.clear();
  for (const tool of data || []) {
    toolCache.set(tool.name, tool);
  }
  cacheTimestamp = now;

  return data || [];
}

/**
 * Get a specific tool definition by name
 */
export async function getToolDefinition(
  supabase: any,
  toolName: string
): Promise<ToolDefinition | null> {
  // Check cache first
  if (toolCache.has(toolName)) {
    return toolCache.get(toolName)!;
  }

  // Fetch from DB
  const { data, error } = await supabase
    .from("tool_catalog")
    .select("id, name, label, description, function_schema, default_config, requires_setup")
    .eq("name", toolName)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    console.error(`[TOOL-CATALOG] Tool "${toolName}" not found:`, error);
    return null;
  }

  // Add to cache
  toolCache.set(toolName, data);
  return data;
}

/**
 * Get tools enabled for a specific agent
 */
export async function getAgentTools(
  supabase: any,
  workspaceId: string,
  agentId: string
): Promise<Array<{ tool: ToolDefinition; config: Record<string, any> }>> {
  console.log(`[TOOL-CATALOG] Fetching tools for agent ${agentId}`);

  // First get agent_tools configurations
  const { data: agentTools, error: agentError } = await supabase
    .from("agent_tools")
    .select(`
      tool_name,
      tool_id,
      is_enabled,
      config
    `)
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("is_enabled", true);

  if (agentError) {
    console.error("[TOOL-CATALOG] Error fetching agent tools:", agentError);
    return [];
  }

  if (!agentTools || agentTools.length === 0) {
    return [];
  }

  // Fetch catalog definitions for enabled tools
  const results: Array<{ tool: ToolDefinition; config: Record<string, any> }> = [];
  
  for (const at of agentTools) {
    // Try to get by tool_id first, fallback to tool_name
    let toolDef: ToolDefinition | null = null;
    
    if (at.tool_id) {
      const { data } = await supabase
        .from("tool_catalog")
        .select("id, name, label, description, function_schema, default_config, requires_setup")
        .eq("id", at.tool_id)
        .eq("is_active", true)
        .maybeSingle();
      toolDef = data;
    }
    
    if (!toolDef && at.tool_name) {
      toolDef = await getToolDefinition(supabase, at.tool_name);
    }

    if (toolDef) {
      results.push({
        tool: toolDef,
        config: { ...toolDef.default_config, ...(at.config || {}) }
      });
    }
  }

  console.log(`[TOOL-CATALOG] Found ${results.length} enabled tools for agent`);
  return results;
}

/**
 * Build OpenAI-compatible tools array from catalog definitions
 */
export function buildToolsArray(tools: ToolDefinition[]): any[] {
  return tools.map(tool => ({
    type: "function",
    function: tool.function_schema
  }));
}

/**
 * Check if message content indicates intent for any available tool
 */
export function detectToolIntent(content: string, tools: ToolDefinition[]): string | null {
  const lowerContent = content.toLowerCase();
  
  // Scheduling keywords
  const schedulingKeywords = [
    "agendar", "agendamento", "marcar", "reunião", "reuniao",
    "horário", "horario", "disponibilidade", "disponível", "disponivel",
    "quando pode", "quando você pode", "quando vc pode",
    "podemos conversar", "posso falar", "vamos marcar",
    "agenda", "calendário", "calendario",
    "amanhã", "amanha", "segunda", "terça", "quarta", "quinta", "sexta",
    "às", "as", "horas"
  ];
  
  // Check for scheduling intent
  if (tools.some(t => t.name === "schedule_appointment")) {
    if (schedulingKeywords.some(kw => lowerContent.includes(kw))) {
      return "schedule_appointment";
    }
  }
  
  // Add more tool intent detection here as new tools are added
  
  return null;
}
