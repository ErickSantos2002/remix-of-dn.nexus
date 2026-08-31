// Helper compartilhado para integração dn.marketing por empresa.
// Lê token + URL base de `companies.dnmarketing_*` (configurados em /settings/company).
// Quando a empresa não tem configuração ativa, retorna null silenciosamente — não há mais fallback global.

// AES-GCM + PBKDF2 — mesmo padrão de src/lib/crypto.ts e dnmarketing-test-connection.
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decryptToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

// Cache simples em memória por instância da edge function.
type Config = { token: string; baseUrl: string };
const configCache = new Map<string, { value: Config | null; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

// deno-lint-ignore no-explicit-any
type SB = any;

export async function resolveCompanyId(
  supabase: SB,
  ref: { contactId?: string | null; leadId?: string | null; workspaceId?: string | null; appointmentId?: string | null },
): Promise<string | null> {
  let workspaceId = ref.workspaceId ?? null;

  if (!workspaceId && ref.contactId) {
    const { data } = await supabase.from("crm_contacts").select("workspace_id").eq("id", ref.contactId).maybeSingle();
    workspaceId = data?.workspace_id ?? null;
  }
  if (!workspaceId && ref.leadId) {
    const { data } = await supabase.from("crm_leads").select("workspace_id").eq("id", ref.leadId).maybeSingle();
    workspaceId = data?.workspace_id ?? null;
  }
  if (!workspaceId && ref.appointmentId) {
    const { data: appt } = await supabase.from("crm_appointments").select("workspace_id, lead_id").eq("id", ref.appointmentId).maybeSingle();
    workspaceId = appt?.workspace_id ?? null;
    if (!workspaceId && appt?.lead_id) {
      const { data: lead } = await supabase.from("crm_leads").select("workspace_id").eq("id", appt.lead_id).maybeSingle();
      workspaceId = lead?.workspace_id ?? null;
    }
  }
  if (!workspaceId) return null;

  const { data: ws } = await supabase.from("workspaces").select("company_id").eq("id", workspaceId).maybeSingle();
  return ws?.company_id ?? null;
}

export async function getDnMarketingConfig(supabase: SB, companyId: string | null): Promise<Config | null> {
  if (!companyId) return null;
  const cached = configCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { data: company, error } = await supabase
    .from("companies")
    .select("dnmarketing_token_encrypted, dnmarketing_base_url, dnmarketing_is_active")
    .eq("id", companyId)
    .maybeSingle();

  if (error || !company || !company.dnmarketing_is_active || !company.dnmarketing_token_encrypted || !company.dnmarketing_base_url) {
    configCache.set(companyId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  try {
    const token = await decryptToken(company.dnmarketing_token_encrypted, companyId);
    const baseUrl = normalizeBaseUrl(company.dnmarketing_base_url);
    const value: Config = { token, baseUrl };
    configCache.set(companyId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (e) {
    console.error("[dnMarketing] failed to decrypt token for company", companyId, e);
    configCache.set(companyId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }
}

export interface DnFetchOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

export interface DnFetchResult {
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  data: any;
  raw: string;
}

/**
 * Faz uma requisição autenticada à API dn.marketing da empresa.
 * Retorna null se a empresa não tiver configuração ativa (skip silencioso).
 */
export async function dnFetch(
  supabase: SB,
  companyId: string | null,
  opts: DnFetchOptions,
): Promise<DnFetchResult | null> {
  const cfg = await getDnMarketingConfig(supabase, companyId);
  if (!cfg) {
    console.log(`[dnMarketing] skip company=${companyId ?? "null"} path=${opts.path} (sem config ativa)`);
    return null;
  }

  let url = `${cfg.baseUrl}${opts.path.startsWith("/") ? "" : "/"}${opts.path}`;
  if (opts.query) {
    const qs = new URLSearchParams(opts.query).toString();
    url += (url.includes("?") ? "&" : "?") + qs;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
  };
  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined && opts.method !== "GET") {
    headers["Content-Type"] = "application/json";
    bodyInit = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method, headers, body: bodyInit });
  } catch (e) {
    console.error(`[dnMarketing] network error company=${companyId} path=${opts.path}:`, e);
    return { ok: false, status: 0, data: null, raw: e instanceof Error ? e.message : String(e) };
  }

  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // mantém raw
  }

  if (!res.ok) {
    console.error(`[dnMarketing] HTTP ${res.status} company=${companyId} path=${opts.path}:`, raw.substring(0, 300));
  }

  return { ok: res.ok, status: res.status, data, raw };
}

/**
 * Wrapper para POST /receive-contact-event.
 * Retorna o resultado ou null se a config estiver inativa.
 */
export async function notifyDnMarketing(
  supabase: SB,
  companyId: string | null,
  payload: {
    dnia_id: string;
    event_type: string;
    title: string;
    description?: string;
    metadata?: Record<string, unknown>;
    occurred_at?: string;
  },
): Promise<DnFetchResult | null> {
  // Enriquecimento: busca campos informativos do contato pelo dnia_id e adiciona à raiz.
  // Garante que toda chamada a /receive-contact-event leve cargo/empresa/faturamento/funcionarios/desafios
  // quando preenchidos no Nexus. Envia tanto na raiz (compatibilidade) quanto em contact_fields
  // (padrão atual aceito pela dn.marketing).
  const enrichment: Record<string, unknown> = {};
  const contactFields: Record<string, unknown> = {};
  const abMeta: Record<string, unknown> = {};
  try {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("job_title, company, revenue, employee_count, tags, source, ab_vid, ab_test, ab_var")
      .eq("dnia_id", payload.dnia_id)
      .maybeSingle();
    if (contact) {
      if (contact.job_title) { enrichment.cargo = contact.job_title; contactFields.cargo = contact.job_title; }
      if (contact.company) { enrichment.empresa = contact.company; contactFields.empresa = contact.company; }
      if (contact.revenue) { enrichment.faturamento = contact.revenue; contactFields.faturamento = contact.revenue; }
      if (contact.employee_count) { enrichment.funcionarios = contact.employee_count; contactFields.funcionarios = contact.employee_count; }

      // Origem: primeira tag do contato; fallback para o campo source.
      let origem: string | null = null;
      const tags = contact.tags as Array<{ name?: string }> | null | undefined;
      if (Array.isArray(tags) && tags.length > 0) {
        const firstTag = tags.find((t) => t && typeof t.name === "string" && t.name.trim() !== "");
        if (firstTag?.name) origem = firstTag.name.trim();
      }
      if (!origem && contact.source && contact.source.trim() !== "") {
        origem = contact.source.trim();
      }
      if (origem) enrichment.origem = origem;

      // A/B testing → metadata do evento
      const c = contact as { ab_vid?: string | null; ab_test?: string | null; ab_var?: string | null };
      if (c.ab_vid) abMeta.ab_vid = c.ab_vid;
      if (c.ab_test) abMeta.ab_test = c.ab_test;
      if (c.ab_var) abMeta.ab_var = c.ab_var;
    }
  } catch (e) {
    console.warn("[dnMarketing] enrichment lookup failed for dnia_id", payload.dnia_id, e);
  }

  const mergedMetadata: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    ...abMeta,
  };

  return await dnFetch(supabase, companyId, {
    method: "POST",
    path: "/receive-contact-event",
    body: {
      ...payload,
      ...enrichment,
      ...(Object.keys(contactFields).length > 0 ? { contact_fields: contactFields } : {}),
      ...(Object.keys(mergedMetadata).length > 0 ? { metadata: mergedMetadata } : {}),
      source_app: "nexus",
      occurred_at: payload.occurred_at || new Date().toISOString(),
    },
  });
}

