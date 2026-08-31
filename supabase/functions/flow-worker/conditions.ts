// supabase/functions/flow-worker/conditions.ts
// Avaliador do nó branch (spec §4.2). Regra sem dado avalia FALSO, nunca erro.
import type { ClaimedRun } from "./executor.ts";

export interface BranchRule { field: string; operator: string; value?: unknown }
export interface BranchConfig { logic: "and" | "or"; rules: BranchRule[] }

interface LeadBundle {
  lead: any; contact: any; psych: any;
  painIds: string[]; objectionIds: string[]; tags: string[];
}

async function loadBundle(supabase: any, run: ClaimedRun): Promise<LeadBundle> {
  const { data: lead } = await supabase.from("crm_leads")
    .select("*, contact:crm_contacts(id, name, phone, email, company, source, tags, opted_out, job_title, revenue, employee_count)")
    .eq("id", run.lead_id).maybeSingle();
  const { data: psych } = await supabase.from("crm_lead_psychology")
    .select("propensity_score, risk_score, opportunity_score")
    .eq("lead_id", run.lead_id).maybeSingle();
  const [{ data: pains }, { data: objections }] = await Promise.all([
    supabase.from("crm_lead_pains").select("pain_id").eq("lead_id", run.lead_id),
    supabase.from("crm_lead_objections").select("objection_id").eq("lead_id", run.lead_id),
  ]);
  const contact = lead?.contact ?? null;
  let tags: string[] = [];
  try {
    const raw = contact?.tags;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    tags = arr.map((t: any) => String(t?.name ?? t).toLowerCase());
  } catch { /* tags malformadas contam como vazias */ }
  return {
    lead, contact, psych,
    painIds: (pains ?? []).map((p: any) => p.pain_id),
    objectionIds: (objections ?? []).map((o: any) => o.objection_id),
    tags,
  };
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function cmp(op: string, left: unknown, right: unknown): boolean {
  if (op === "empty") return left === null || left === undefined || left === "";
  if (op === "not_empty") return !(left === null || left === undefined || left === "");
  if (left === null || left === undefined) return false; // sem dado → falso (spec §4.2)
  switch (op) {
    case "eq": return String(left).toLowerCase() === String(right).toLowerCase();
    case "neq": return String(left).toLowerCase() !== String(right).toLowerCase();
    case "gt": return Number(left) > Number(right);
    case "lt": return Number(left) < Number(right);
    case "contains": return String(left).toLowerCase().includes(String(right).toLowerCase());
    case "not_contains": return !String(left).toLowerCase().includes(String(right).toLowerCase());
    default: return false;
  }
}

async function repliedSinceEntry(supabase: any, run: ClaimedRun, bundle: LeadBundle): Promise<boolean> {
  // Última mensagem inbound (sender_type='lead') dos leads do inbox vinculados
  // ao contato/telefone, posterior à entrada no fluxo.
  const inboxIds: string[] = [];
  if (bundle.contact?.id) {
    const { data } = await supabase.from("leads").select("id")
      .eq("workspace_id", run.workspace_id).eq("contact_id", bundle.contact.id);
    for (const l of data ?? []) inboxIds.push(l.id);
  }
  if (inboxIds.length === 0 && bundle.contact?.phone) {
    let phone = String(bundle.contact.phone).replace(/\D/g, "");
    if (phone.length >= 10 && phone.length <= 11 && !phone.startsWith("55")) phone = "55" + phone;
    const { data } = await supabase.from("leads").select("id")
      .eq("workspace_id", run.workspace_id).eq("phone", phone);
    for (const l of data ?? []) inboxIds.push(l.id);
  }
  if (inboxIds.length === 0) return false;
  const { count } = await supabase.from("messages")
    .select("id", { count: "exact", head: true })
    .in("lead_id", inboxIds).eq("sender_type", "lead").gt("created_at", run.entered_at);
  return (count ?? 0) > 0;
}

/**
 * Última atividade do card do tipo escolhido (maior scheduled_at — a mesma
 * ordenação da aba Atividades). value = { type, status? }; status vazio
 * significa "qualquer status". Sem atividade do tipo → falso.
 */
async function lastActivityMatches(supabase: any, run: ClaimedRun, value: unknown): Promise<boolean> {
  const v = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const type = typeof v.type === "string" ? v.type : "";
  const status = typeof v.status === "string" && v.status ? v.status : null;
  if (!type) return false; // regra incompleta → falso, nunca erro
  const { data } = await supabase.from("crm_lead_activities")
    .select("status")
    .eq("lead_id", run.lead_id)
    .eq("type", type)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  if (!status) return true;
  // status nulo no banco = 'pending' (default da coluna)
  return String(data.status ?? "pending").toLowerCase() === status.toLowerCase();
}

async function evalRule(supabase: any, run: ClaimedRun, b: LeadBundle, r: BranchRule): Promise<boolean> {
  switch (r.field) {
    case "value": return cmp(r.operator, b.lead?.value, r.value);
    case "product_id": return cmp(r.operator, b.lead?.product_id, r.value);
    case "segment_id": return cmp(r.operator, b.lead?.segment_id, r.value);
    case "assigned_to": return cmp(r.operator, b.lead?.assigned_to, r.value);
    case "status": return cmp(r.operator, b.lead?.status, r.value);
    case "days_in_stage": return cmp(r.operator, daysSince(b.lead?.moved_at), r.value);
    case "lead_age_days": return cmp(r.operator, daysSince(b.lead?.created_at), r.value);
    case "utm_source": return cmp(r.operator, b.lead?.utm_source, r.value);
    case "utm_campaign": return cmp(r.operator, b.lead?.utm_campaign, r.value);
    case "utm_medium": return cmp(r.operator, b.lead?.utm_medium, r.value);
    case "utm_content": return cmp(r.operator, b.lead?.utm_content, r.value);
    case "utm_term": return cmp(r.operator, b.lead?.utm_term, r.value);
    case "contact_source": return cmp(r.operator, b.contact?.source, r.value);
    case "contact_company": return cmp(r.operator, b.contact?.company, r.value);
    case "is_icp": return cmp(r.operator, b.lead?.is_icp, r.value);
    case "contact_job_title": return cmp(r.operator, b.contact?.job_title, r.value);
    case "contact_revenue": return cmp(r.operator, b.contact?.revenue, r.value);
    case "contact_employee_count": return cmp(r.operator, b.contact?.employee_count, r.value);
    case "has_phone": return cmp(r.operator === "eq" ? "not_empty" : r.operator === "neq" ? "empty" : r.operator, b.contact?.phone, null);
    case "has_email": return cmp(r.operator === "eq" ? "not_empty" : r.operator === "neq" ? "empty" : r.operator, b.contact?.email, null);
    case "tags": {
      const target = String(r.value ?? "").toLowerCase();
      const has = b.tags.includes(target);
      return r.operator === "not_contains" ? !has : has;
    }
    case "propensity_score": return cmp(r.operator, b.psych?.propensity_score, r.value);
    case "risk_score": return cmp(r.operator, b.psych?.risk_score, r.value);
    case "opportunity_score": return cmp(r.operator, b.psych?.opportunity_score, r.value);
    case "pain": {
      const has = b.painIds.includes(String(r.value));
      return r.operator === "not_contains" ? !has : has;
    }
    case "objection": {
      const has = b.objectionIds.includes(String(r.value));
      return r.operator === "not_contains" ? !has : has;
    }
    case "last_activity": {
      const matches = await lastActivityMatches(supabase, run, r.value);
      return r.operator === "not_has" ? !matches : matches;
    }
    case "replied_since_entry": {
      const replied = await repliedSinceEntry(supabase, run, b);
      return r.operator === "eq" && String(r.value) === "false" ? !replied : replied;
    }
    default: return false; // campo desconhecido → falso, nunca erro
  }
}

export async function evaluateBranch(supabase: any, run: ClaimedRun, config: BranchConfig): Promise<boolean> {
  const bundle = await loadBundle(supabase, run);
  const rules = config.rules ?? [];
  if (rules.length === 0) return false;
  if (config.logic === "or") {
    for (const r of rules) if (await evalRule(supabase, run, bundle, r)) return true;
    return false;
  }
  for (const r of rules) if (!(await evalRule(supabase, run, bundle, r))) return false;
  return true;
}
