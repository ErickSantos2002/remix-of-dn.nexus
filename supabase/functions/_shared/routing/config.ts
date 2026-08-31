// Fonte única de configuração: workspace_routing_config (spec §4.1).
import { RoutingConfig } from "./types.ts";

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  strategy: "least_loaded",
  fallback_strategy: "queue",
  auto_assign: true,
  category_matching: true,
  max_leads_per_agent: 10,
  respect_card_owner: true,
  scheduling_strategy: "least_loaded",
  scheduling_load_window_days: 30,
};

const IMPLEMENTED = new Set(["least_loaded", "round_robin"]);
const FALLBACKS = new Set(["least_loaded", "round_robin", "queue"]);

/** Sem linha = defaults. Estratégia não implementada cai em least_loaded COM LOG (defeito 7). */
export async function loadRoutingConfig(supabase: any, workspaceId: string): Promise<RoutingConfig> {
  const { data, error } = await supabase
    .from("workspace_routing_config")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) console.error("[ROUTING] loadRoutingConfig:", error.message);
  if (!data) return { ...DEFAULT_ROUTING_CONFIG };

  let strategy = data.strategy ?? DEFAULT_ROUTING_CONFIG.strategy;
  if (!IMPLEMENTED.has(strategy)) {
    console.warn(`[ROUTING] strategy "${strategy}" não implementada; usando least_loaded (workspace ${workspaceId})`);
    strategy = "least_loaded";
  }
  const fallback = FALLBACKS.has(data.fallback_strategy) ? data.fallback_strategy : DEFAULT_ROUTING_CONFIG.fallback_strategy;
  const schedStrategy = IMPLEMENTED.has(data.scheduling_strategy) ? data.scheduling_strategy : "least_loaded";

  return {
    strategy: strategy as RoutingConfig["strategy"],
    fallback_strategy: fallback as RoutingConfig["fallback_strategy"],
    auto_assign: data.auto_assign ?? true,
    category_matching: data.category_matching ?? true,
    max_leads_per_agent: data.max_leads_per_agent ?? 10,
    respect_card_owner: data.respect_card_owner ?? true,
    scheduling_strategy: schedStrategy as RoutingConfig["scheduling_strategy"],
    scheduling_load_window_days: data.scheduling_load_window_days ?? 30,
  };
}
