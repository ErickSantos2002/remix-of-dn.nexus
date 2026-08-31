// Contrato do grafo de Fluxos de CRM v2. ESPELHA o que validate_crm_flow_graph
// (migration 20260813120500) aceita e o que o flow-worker sabe executar.
// Campos/operadores da condição espelham conditions.ts do flow-worker.

export type FlowStatus = "draft" | "active" | "paused" | "archived";
export type FlowNodeType = "delay" | "branch" | "send_whatsapp" | "send_email" | "close_lead";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  config: Record<string, unknown>;
  next: string | null;
  next_false: string | null;
}

export interface Flow {
  id: string;
  workspace_id: string;
  company_id: string;
  stage_id: string;
  name: string;
  status: FlowStatus;
  exit_on_stage_change: boolean;
  reentry: "once" | "allowed";
  reentry_cooldown_hours: number;
  entry_node_id: string | null;
  nodes: FlowNode[];
  created_at: string;
  updated_at: string;
}

export const NODE_LABELS: Record<FlowNodeType, string> = {
  delay: "Espera",
  branch: "Condição",
  send_whatsapp: "Mensagem WhatsApp",
  send_email: "E-mail",
  close_lead: "Fechar lead",
};

export const STATUS_LABELS: Record<FlowStatus, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  archived: "Arquivado",
};

export const WHATSAPP_VARS_HINT =
  "Variáveis: {nome_lead}, {primeiro_nome}, {empresa}, {atendente}";

export function newNodeId(): string {
  return `n${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  const t = Math.max(0, Math.floor(total || 0));
  return { days: Math.floor(t / 1440), hours: Math.floor((t % 1440) / 60), minutes: t % 60 };
}

export function joinMinutes(days: number, hours: number, minutes: number): number {
  return Math.max(1, (days || 0) * 1440 + (hours || 0) * 60 + (minutes || 0));
}

export function minutesToLabel(m: number): string {
  const { days, hours, minutes } = splitMinutes(m);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}min`);
  return parts.join(" ") || "0min";
}

// ---------------------------------------------------------------------------
// Condição (branch): catálogo de campos — espelha o evalRule do flow-worker.
// valueKind decide o controle de valor na UI; catalog aponta a fonte da lista.
// ---------------------------------------------------------------------------
export type BranchValueKind = "number" | "text" | "boolean" | "none" | "catalog" | "activity";
export type BranchCatalog =
  | "products" | "segments" | "pains" | "objections" | "members" | "sources" | "lead_status" | "tags"
  | "job_titles" | "revenues" | "employee_counts";

export interface BranchFieldDef {
  key: string;
  label: string;
  group: string;
  valueKind: BranchValueKind;
  catalog?: BranchCatalog;
  operators: string[];
}

export interface BranchRule {
  field: string;
  operator: string;
  value?: unknown;
}

/** Valor das regras com valueKind "activity": tipo obrigatório, status opcional. */
export interface ActivityRuleValue {
  type: string;
  status?: string;
}

export function asActivityValue(value: unknown): ActivityRuleValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return {
      type: typeof v.type === "string" ? v.type : "",
      status: typeof v.status === "string" && v.status ? v.status : undefined,
    };
  }
  return { type: "" };
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: "é",
  neq: "não é",
  gt: "maior que",
  lt: "menor que",
  contains: "contém",
  not_contains: "não contém",
  empty: "está vazio",
  not_empty: "está preenchido",
  has: "tem",
  not_has: "não tem",
};

export const BRANCH_FIELDS: BranchFieldDef[] = [
  { key: "value", label: "Valor do card", group: "Card", valueKind: "number", operators: ["gt", "lt", "eq", "neq", "empty", "not_empty"] },
  { key: "product_id", label: "Produto", group: "Card", valueKind: "catalog", catalog: "products", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "segment_id", label: "Segmento", group: "Card", valueKind: "catalog", catalog: "segments", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "assigned_to", label: "Atendente", group: "Card", valueKind: "catalog", catalog: "members", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "status", label: "Status do card", group: "Card", valueKind: "catalog", catalog: "lead_status", operators: ["eq", "neq"] },
  { key: "days_in_stage", label: "Tempo na etapa (dias)", group: "Card", valueKind: "number", operators: ["gt", "lt"] },
  { key: "lead_age_days", label: "Idade do lead (dias)", group: "Card", valueKind: "number", operators: ["gt", "lt"] },
  { key: "utm_source", label: "Canal (utm_source)", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_campaign", label: "Campanha", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_medium", label: "Medium", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_content", label: "Content", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_term", label: "Term", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "contact_source", label: "Origem do contato", group: "Contato", valueKind: "catalog", catalog: "sources", operators: ["eq", "neq"] },
  { key: "is_icp", label: "ICP", group: "Card", valueKind: "boolean", operators: ["eq", "empty", "not_empty"] },
  { key: "contact_company", label: "Empresa do contato", group: "Contato", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "contact_job_title", label: "Cargo", group: "Contato", valueKind: "catalog", catalog: "job_titles", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "contact_revenue", label: "Faturamento", group: "Contato", valueKind: "catalog", catalog: "revenues", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "contact_employee_count", label: "Tamanho da empresa", group: "Contato", valueKind: "catalog", catalog: "employee_counts", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "has_phone", label: "Telefone", group: "Contato", valueKind: "none", operators: ["not_empty", "empty"] },
  { key: "has_email", label: "E-mail", group: "Contato", valueKind: "none", operators: ["not_empty", "empty"] },
  { key: "tags", label: "Tag do contato", group: "Contato", valueKind: "catalog", catalog: "tags", operators: ["contains", "not_contains"] },
  { key: "propensity_score", label: "Propensão (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "risk_score", label: "Risco (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "opportunity_score", label: "Oportunidade (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "pain", label: "Dor", group: "Catálogos", valueKind: "catalog", catalog: "pains", operators: ["contains", "not_contains"] },
  { key: "objection", label: "Objeção", group: "Catálogos", valueKind: "catalog", catalog: "objections", operators: ["contains", "not_contains"] },
  { key: "replied_since_entry", label: "Respondeu desde a entrada no fluxo", group: "Engajamento", valueKind: "boolean", operators: ["eq"] },
  // Olha a ÚLTIMA atividade do card do tipo escolhido (maior scheduled_at, a
  // mesma ordenação da aba Atividades). Status vazio = qualquer status.
  { key: "last_activity", label: "Atividade", group: "Atividades", valueKind: "activity", operators: ["has", "not_has"] },
];

export const LEAD_STATUS_OPTIONS = [
  { id: "open", name: "Aberto" },
  { id: "won", name: "Ganho" },
  { id: "lost", name: "Perdido" },
];

export function branchFieldDef(key: string): BranchFieldDef | undefined {
  return BRANCH_FIELDS.find((f) => f.key === key);
}

/** Ids inalcançáveis a partir da entrada — usados no aviso de exclusão em cascata. */
export function computePruned(nodes: FlowNode[], entryId: string | null): string[] {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue: (string | null | undefined)[] = [entryId];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || seen.has(cur) || !map.has(cur)) continue;
    seen.add(cur);
    const n = map.get(cur)!;
    queue.push(n.next, n.next_false);
  }
  return nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
}
