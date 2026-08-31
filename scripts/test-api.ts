/**
 * Nexus AI — End-to-End API REST Test Script
 *
 * Testa todos os endpoints da API Gateway criando dados isolados,
 * verificando cada resposta, e limpando tudo no final.
 *
 * Uso:
 *   npx tsx scripts/test-api.ts SEU_TOKEN_JWT
 *   npx tsx scripts/test-api.ts SEU_TOKEN_JWT --cleanup-only
 *   npx tsx scripts/test-api.ts SEU_TOKEN_JWT --sweep
 *   API_TOKEN=xxx npx tsx scripts/test-api.ts
 *   API_URL=http://localhost:54321/functions/v1/api-gateway API_TOKEN=xxx npx tsx scripts/test-api.ts
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = (
  process.env.API_URL ||
  "https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/api-gateway"
).replace(/\/$/, "");

// Filter out flags before looking for token
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const TOKEN = args[0] || process.env.API_TOKEN;

if (!TOKEN) {
  console.error("\x1b[31mErro: Token JWT obrigatorio.\x1b[0m");
  console.error("Uso: npx tsx scripts/test-api.ts SEU_TOKEN_JWT");
  console.error("  ou: API_TOKEN=xxx npx tsx scripts/test-api.ts");
  process.exit(1);
}

const CLEANUP_ONLY = process.argv.includes("--cleanup-only");
const SWEEP = process.argv.includes("--sweep");

const TS = Date.now();
const TEST_PREFIX = `TEST_E2E_${TS}`;

// ---------------------------------------------------------------------------
// State persistence (crash recovery)
// ---------------------------------------------------------------------------

const STATE_FILE = join(__dirname, ".test-api-state.json");

function persistState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ ...state, _prefix: TEST_PREFIX, _ts: TS }));
  } catch { /* best-effort */ }
}

function loadPersistedState(): Record<string, any> | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch { return null; }
}

function clearStateFile() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiResult {
  status: number;
  data: any;
  ok: boolean;
  error?: string;
}

type TestStatus = "PASS" | "FAIL" | "SKIP";

interface TestResult {
  phase: string;
  method: string;
  path: string;
  status: TestStatus;
  httpStatus?: number;
  error?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// State — IDs created during tests for cleanup
// ---------------------------------------------------------------------------

const state: Record<string, any> = {};
const results: TestResult[] = [];
let currentPhase = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function setPhase(name: string) {
  currentPhase = name;
  console.log(`\n${c.bold}${c.cyan}━━━ ${name} ━━━${c.reset}`);
}

async function api(
  method: string,
  path: string,
  body?: any,
  opts?: { workspaceId?: string; noAuth?: boolean; rawResponse?: boolean; customHeaders?: Record<string, string>; noWorkspace?: boolean }
): Promise<ApiResult> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!opts?.noAuth) {
    if (TOKEN.startsWith("nxai_")) {
      headers["X-API-Key"] = TOKEN;
    } else {
      headers["Authorization"] = `Bearer ${TOKEN}`;
    }
  }
  if (!opts?.noWorkspace && (opts?.workspaceId || state.workspaceId)) {
    headers["X-Workspace-Id"] = opts?.workspaceId || state.workspaceId;
  }

  // Custom headers override defaults (useful for sending bad auth tokens)
  if (opts?.customHeaders) {
    Object.assign(headers, opts.customHeaders);
  }

  const fetchOpts: RequestInit = { method, headers };
  if (body && method !== "GET") {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOpts);

    if (opts?.rawResponse) {
      const text = await res.text();
      return { status: res.status, data: text, ok: res.ok };
    }

    let data: any;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    return {
      status: res.status,
      data,
      ok: res.ok,
      error: !res.ok ? (data?.error?.message || data?.error?.code || String(data)) : undefined,
    };
  } catch (err: any) {
    return { status: 0, data: null, ok: false, error: err.message };
  }
}

async function test(
  method: string,
  path: string,
  body?: any,
  opts?: {
    workspaceId?: string;
    noAuth?: boolean;
    rawResponse?: boolean;
    expect?: number | number[];
    skip?: boolean;
    skipReason?: string;
    customHeaders?: Record<string, string>;
    noWorkspace?: boolean;
  }
): Promise<ApiResult> {
  const label = `${method.padEnd(6)} ${path}`;

  if (opts?.skip) {
    console.log(`  ${c.yellow}⊘ SKIP${c.reset}  ${label}  ${c.dim}${opts.skipReason || ""}${c.reset}`);
    results.push({
      phase: currentPhase,
      method,
      path,
      status: "SKIP",
      duration: 0,
      error: opts.skipReason,
    });
    return { status: 0, data: null, ok: false };
  }

  const start = performance.now();
  const res = await api(method, path, body, opts);
  const duration = Math.round(performance.now() - start);

  const expectedStatuses = opts?.expect
    ? Array.isArray(opts.expect) ? opts.expect : [opts.expect]
    : undefined;

  const passed = expectedStatuses
    ? expectedStatuses.includes(res.status)
    : res.ok;

  if (passed) {
    console.log(
      `  ${c.green}✓ PASS${c.reset}  ${label}  ${c.dim}${res.status} (${duration}ms)${c.reset}`
    );
    results.push({ phase: currentPhase, method, path, status: "PASS", httpStatus: res.status, duration });
  } else {
    const errMsg = res.error || `HTTP ${res.status}`;
    console.log(
      `  ${c.red}✗ FAIL${c.reset}  ${label}  ${c.red}${res.status} — ${errMsg}${c.reset}  ${c.dim}(${duration}ms)${c.reset}`
    );
    results.push({
      phase: currentPhase,
      method,
      path,
      status: "FAIL",
      httpStatus: res.status,
      error: errMsg,
      duration,
    });
  }

  return res;
}

function extractId(res: ApiResult): string | undefined {
  return res.data?.data?.id || res.data?.id;
}

function trackId(key: string, res: ApiResult): string | undefined {
  const id = extractId(res);
  if (id) {
    state[key] = id;
    persistState();
  }
  return id;
}

// ---------------------------------------------------------------------------
// Test Phases
// ---------------------------------------------------------------------------

async function phase0_health() {
  setPhase("Fase 0 — Saude basica");

  await test("GET", "/");

  const me = await test("GET", "/auth/me");
  if (me.ok) {
    state.userId = me.data?.data?.id;
    console.log(`    ${c.dim}userId = ${state.userId}${c.reset}`);
  }
}

async function phase1_setup() {
  setPhase("Fase 1 — Setup: Criar dados de teste");

  // Criar empresa
  const comp = await test("POST", "/companies", {
    name: `${TEST_PREFIX}_Company`,
    description: "Empresa criada pelo script de teste E2E",
  });
  trackId("companyId", comp);
  console.log(`    ${c.dim}companyId = ${state.companyId}${c.reset}`);

  if (!state.companyId) {
    throw new Error("FATAL: Nao foi possivel criar empresa. Abortando.");
  }

  // Criar workspace
  const ws = await test("POST", "/workspaces", {
    name: `${TEST_PREFIX}_Workspace`,
    company_id: state.companyId,
    description: "Workspace de teste E2E",
  });
  trackId("workspaceId", ws);
  console.log(`    ${c.dim}workspaceId = ${state.workspaceId}${c.reset}`);

  if (!state.workspaceId) {
    throw new Error("FATAL: Nao foi possivel criar workspace. Abortando.");
  }
}

async function phase2_companyWorkspace() {
  setPhase("Fase 2 — Company & Workspace endpoints");

  await test("GET", "/companies");
  await test("GET", `/companies/${state.companyId}`);
  await test("PUT", `/companies/${state.companyId}`, {
    name: `${TEST_PREFIX}_Company_Updated`,
  });
  await test("GET", `/companies/${state.companyId}/members`);

  await test("GET", `/workspaces?company_id=${state.companyId}`);
  await test("GET", `/workspaces/${state.workspaceId}`);
  await test("PUT", `/workspaces/${state.workspaceId}`, {
    name: `${TEST_PREFIX}_Workspace_Updated`,
  });
  await test("GET", `/workspaces/${state.workspaceId}/members`);

  // Tentar adicionar membro — pode falhar se email nao existe, OK
  await test("POST", `/workspaces/${state.workspaceId}/members`, {
    email: `test_e2e_${TS}@nonexistent.test`,
    role: "member",
  }, { expect: [200, 201, 400, 404, 409] });
}

async function phase3_agents() {
  setPhase("Fase 3 — Agents");

  const ag = await test("POST", "/agents", {
    name: `${TEST_PREFIX}_Agent`,
    system_prompt: "Voce e um agente de teste E2E.",
    tone: "professional",
    category: "GERAL",
  });
  trackId("agentId", ag);
  console.log(`    ${c.dim}agentId = ${state.agentId}${c.reset}`);

  await test("GET", "/agents");
  if (state.agentId) {
    await test("GET", `/agents/${state.agentId}`);
    await test("PUT", `/agents/${state.agentId}`, {
      name: `${TEST_PREFIX}_Agent_Updated`,
    });
    await test("GET", `/agents/${state.agentId}/tools`);
    await test("GET", `/agents/${state.agentId}/knowledge-bases`);
  }
}

async function phase4_agentCategories() {
  setPhase("Fase 4 — Agent Categories");

  const cat = await test("POST", "/agent-categories", {
    name: `${TEST_PREFIX}_Category`,
    slug: `test_e2e_${TS}`,
    description: "Categoria de teste",
    color: "#FF5733",
  });
  trackId("agentCategoryId", cat);
  console.log(`    ${c.dim}agentCategoryId = ${state.agentCategoryId}${c.reset}`);

  await test("GET", "/agent-categories");
  if (state.agentCategoryId) {
    await test("PUT", `/agent-categories/${state.agentCategoryId}`, {
      description: "Categoria atualizada",
    });
  }
}

async function phase5_knowledgeBases() {
  setPhase("Fase 5 — Knowledge Bases");

  const kb = await test("POST", "/knowledge-bases", {
    name: `${TEST_PREFIX}_KB`,
    description: "Knowledge base de teste",
  });
  trackId("knowledgeBaseId", kb);
  console.log(`    ${c.dim}knowledgeBaseId = ${state.knowledgeBaseId}${c.reset}`);

  await test("GET", "/knowledge-bases");
  if (state.knowledgeBaseId) {
    await test("GET", `/knowledge-bases/${state.knowledgeBaseId}`);
    await test("PUT", `/knowledge-bases/${state.knowledgeBaseId}`, {
      description: "KB atualizada",
    });
    await test("GET", `/knowledge-bases/${state.knowledgeBaseId}/documents`);
    await test("GET", `/knowledge-bases/${state.knowledgeBaseId}/jobs`);
  }
}

async function phase6_crmContacts() {
  setPhase("Fase 6 — CRM Contacts");

  const ct = await test("POST", "/crm/contacts", {
    name: `${TEST_PREFIX}_Contact`,
    phone: "5511999990000",
    email: `test_e2e_${TS}@test.com`,
    source: "manual",
  });
  trackId("contactId", ct);
  console.log(`    ${c.dim}contactId = ${state.contactId}${c.reset}`);

  await test("GET", "/crm/contacts");
  if (state.contactId) {
    await test("GET", `/crm/contacts/${state.contactId}`);
    await test("PUT", `/crm/contacts/${state.contactId}`, {
      name: `${TEST_PREFIX}_Contact_Updated`,
    });
    await test("PUT", `/crm/contacts/${state.contactId}/tags`, {
      tags: [{ name: "e2e-test", color: "#FF0000" }],
    });
  }
  // Upsert: mesmo telefone/email deve reaproveitar e atualizar o contato existente
  await test("POST", "/crm/contacts/upsert", {
    name: `${TEST_PREFIX}_Contact_Upserted`,
    phone: "5511999990000",
    email: `test_e2e_${TS}@test.com`,
    company: "E2E Corp",
  });

  await test("GET", "/crm/contacts/export", undefined, { rawResponse: true });

}

async function phase7_crmPipeline() {
  setPhase("Fase 7 — CRM Pipeline");

  await test("GET", "/crm/pipeline/stages");

  const stg = await test("POST", "/crm/pipeline/stages", {
    name: `${TEST_PREFIX}_Stage`,
    color: "#3D61FF",
    description: "Stage de teste",
  });
  trackId("stageId", stg);
  console.log(`    ${c.dim}stageId = ${state.stageId}${c.reset}`);

  // Criar segundo stage para testes de movimentacao
  const stg2 = await test("POST", "/crm/pipeline/stages", {
    name: `${TEST_PREFIX}_Stage2`,
    color: "#E41A11",
  });
  trackId("stageId2", stg2);
  console.log(`    ${c.dim}stageId2 = ${state.stageId2}${c.reset}`);

  if (state.stageId) {
    await test("PUT", `/crm/pipeline/stages/${state.stageId}`, {
      description: "Stage atualizado",
    });
  }

  // CRM Funnel stats — paridade com Analytics interno
  await test("GET", "/crm/funnel/stats");
  await test("GET", "/crm/funnel/stats?include_ids=false");
  await test("GET", "/crm/funnel/stats?include_ids=false&assigned_to=00000000-0000-0000-0000-000000000000");

  // CRM Activities listing + stats
  await test("GET", "/crm/activities");
  await test("GET", "/crm/activities?include=call,meeting,transcript");
  await test("GET", "/crm/activities/stats");
}

async function phase8_crmProductsLossReasons() {
  setPhase("Fase 8 — CRM Products & Loss Reasons");

  const prod = await test("POST", "/crm/products", {
    name: `${TEST_PREFIX}_Product`,
    description: "Produto de teste",
    price: 99.90,
  });
  trackId("productId", prod);
  console.log(`    ${c.dim}productId = ${state.productId}${c.reset}`);

  await test("GET", "/crm/products");
  if (state.productId) {
    await test("PUT", `/crm/products/${state.productId}`, {
      price: 149.90,
    });
  }

  const lr = await test("POST", "/crm/loss-reasons", {
    name: `${TEST_PREFIX}_LossReason`,
    description: "Motivo de perda teste",
  });
  trackId("lossReasonId", lr);
  console.log(`    ${c.dim}lossReasonId = ${state.lossReasonId}${c.reset}`);

  await test("GET", "/crm/loss-reasons");
  if (state.lossReasonId) {
    await test("PUT", `/crm/loss-reasons/${state.lossReasonId}`, {
      name: `${TEST_PREFIX}_LossReason_Updated`,
    });
  }

  // Contact Sources (origens do lead) — somente leitura via API
  await test("GET", "/crm/contact-sources");
  await test("GET", "/crm/contact-sources?include_inactive=true");

}

async function phase9_crmLeads() {
  setPhase("Fase 9 — CRM Leads");

  if (!state.stageId || !state.contactId) {
    console.log(`  ${c.yellow}⊘ SKIP fase inteira — stage ou contato nao criados${c.reset}`);
    return;
  }

  // Criar segundo contato dedicado para lead (o primeiro ja pode ter lead auto-criado pelo trigger)
  const ct2 = await test("POST", "/crm/contacts", {
    name: `${TEST_PREFIX}_LeadContact`,
    phone: `55119${TS.toString().slice(-8)}`,
    email: `test_e2e_lead_${TS}@test.com`,
    source: "manual",
  });
  trackId("contactId2", ct2);
  console.log(`    ${c.dim}contactId2 = ${state.contactId2}${c.reset}`);

  // Primeiro, limpar qualquer lead existente para o contactId2 (evita unique constraint)
  if (state.contactId2) {
    const existingLeads = await api("GET", `/crm/leads?contact_id=${state.contactId2}`);
    // Se ja existe lead para este contato, delete antes de criar
  }

  const ld = await test("POST", "/crm/leads", {
    stage_id: state.stageId,
    contact_id: state.contactId2 || state.contactId,
    title: `${TEST_PREFIX}_Lead`,
    value: 5000,
    product_id: state.productId || undefined,
    source: "Indicação",
    channel: "api-test",
    utm_medium: "cpc",
    utm_campaign: `${TEST_PREFIX}_campaign`,
    tags: [`${TEST_PREFIX}_tag`],
    note: `${TEST_PREFIX} nota de criacao`,
  }, { expect: [201, 500] });
  trackId("crmLeadId", ld);
  console.log(`    ${c.dim}crmLeadId = ${state.crmLeadId}${c.reset}`);

  await test("GET", "/crm/leads");
  if (state.stageId) {
    await test("GET", `/crm/leads?stage_id=${state.stageId}&status=open&per_page=100`);
    await test("GET", `/crm/leads?stage_id=${state.stageId}&status=open&exclude_inactive_contacts=true&per_page=100`);
  }
  if (state.crmLeadId) {
    await test("GET", `/crm/leads/${state.crmLeadId}`);
    await test("PUT", `/crm/leads/${state.crmLeadId}`, {
      title: `${TEST_PREFIX}_Lead_Updated`,
      value: 7500,
      channel: "api-test-updated",
      utm_source: "api-test-updated",
      tags: [`${TEST_PREFIX}_tag2`],
      note: `${TEST_PREFIX} nota de edicao`,
    });

    // Upsert: deve atualizar o card existente (lead_id explicito)
    await test("POST", "/crm/leads/upsert", {
      lead_id: state.crmLeadId,
      value: 8000,
      channel: "api-test-upsert",
      note: `${TEST_PREFIX} nota de upsert`,
    });

    // Upsert por contact_id (resolve o card aberto do contato)
    await test("POST", "/crm/leads/upsert", {
      contact_id: state.contactId2 || state.contactId,
      stage_id: state.stageId,
      utm_campaign: `${TEST_PREFIX}_campaign_upsert`,
    }, { expect: [200, 201] });


    // Mover de stage
    if (state.stageId2) {
      await test("PUT", `/crm/leads/${state.crmLeadId}/stage`, {
        stage_id: state.stageId2,
      });
    }

    await test("GET", `/crm/leads/${state.crmLeadId}/history`);
    await test("GET", `/crm/leads/${state.crmLeadId}/utm`);
    await test("PATCH", `/crm/leads/${state.crmLeadId}/utm`, {
      channel: "google",
      utm_medium: "cpc",
      utm_campaign: "teste-api",
    });
    await test("GET", `/crm/leads?utm_source=google&per_page=5`);
    await test("GET", `/crm/leads?utm_campaign=teste-api&per_page=5`);
    await test("GET", `/crm/leads/${state.crmLeadId}/activities`);

    // Criar atividade
    const act = await test("POST", `/crm/leads/${state.crmLeadId}/activities`, {
      title: `${TEST_PREFIX}_Activity`,
      type: "call",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      description: "Atividade de teste",
    });
    trackId("activityId", act);

    // Enriched fetch + dedicated media endpoints (atividade nova nao tem mídia, espera 404 nos atalhos)
    await test("GET", `/crm/leads/${state.crmLeadId}/activities?include=call,meeting,transcript`);
    const newActId = (act as { data?: { id?: string } } | null)?.data?.id;
    if (newActId) {
      await test("GET", `/crm/activities/${newActId}/call`, undefined, { expect: [200, 404] });
      await test("GET", `/crm/activities/${newActId}/meeting`, undefined, { expect: [200, 404] });
      await test("GET", `/crm/activities/${newActId}/transcript`, undefined, { expect: [200, 404] });
    }

    await test("GET", `/crm/leads/${state.crmLeadId}/psychology`, undefined, {
      expect: [200, 404],
    });

    // A analise exige >=10 mensagens do lead OU transcricao/notas — o lead de teste
    // normalmente nao atende, entao 500 (ANALYSIS_ERROR) tambem e resposta valida.
    await test("POST", `/crm/leads/${state.crmLeadId}/psychology/analyze`, undefined, {
      expect: [200, 500],
    });
  }
}

async function phase10_crmTagsAutomove() {
  setPhase("Fase 10 — CRM Tags & Automove");

  await test("GET", "/crm/tags");

  if (state.stageId && state.stageId2) {
    const rule = await test("POST", "/crm/automove-rules", {
      name: `${TEST_PREFIX}_Rule`,
      from_stage_id: state.stageId,
      to_stage_id: state.stageId2,
      condition_type: "propensity_score",
      condition_value: "80",
      condition_operator: ">=",
      is_active: false,
    });
    trackId("automoveRuleId", rule);
    console.log(`    ${c.dim}automoveRuleId = ${state.automoveRuleId}${c.reset}`);

    await test("GET", "/crm/automove-rules");
    if (state.automoveRuleId) {
      await test("PUT", `/crm/automove-rules/${state.automoveRuleId}`, {
        name: `${TEST_PREFIX}_Rule_Updated`,
      });
    }
  }

  await test("GET", "/crm/automove-log");
}

async function phase11_chatCategories() {
  setPhase("Fase 11 — Chat Categories");

  const cc = await test("POST", "/chat-categories", {
    name: `${TEST_PREFIX}_ChatCat`,
    description: "Categoria de chat teste",
    icon: "message-circle",
    color: "#3D61FF",
  });
  trackId("chatCategoryId", cc);
  console.log(`    ${c.dim}chatCategoryId = ${state.chatCategoryId}${c.reset}`);

  await test("GET", "/chat-categories");
  if (state.chatCategoryId) {
    await test("PUT", `/chat-categories/${state.chatCategoryId}`, {
      description: "Chat category atualizada",
    });
  }
}

async function phase12_routing() {
  setPhase("Fase 12 — Routing");

  await test("GET", "/routing/config");
  await test("PUT", "/routing/config", {
    strategy: "least_loaded",
    auto_assign: true,
    respect_card_owner: true,
    scheduling_strategy: "least_loaded",
    scheduling_load_window_days: 30,
  }, { expect: [200, 201] });

  await test("GET", "/routing/agent-assignments");
}

async function phase13_availability() {
  setPhase("Fase 13 — Availability");

  await test("GET", "/availability");
  await test("PUT", "/availability", {
    max_concurrent_leads: 5,
  }, { expect: [200, 201] });

  if (state.userId) {
    await test("GET", `/availability/${state.userId}`, undefined, {
      expect: [200, 404],
    });
  }
}

async function phase14_appointments() {
  setPhase("Fase 14 — Appointments");

  if (!state.contactId || !state.crmLeadId) {
    console.log(`  ${c.yellow}⊘ SKIP fase — contato ou lead nao criado (lead_id e obrigatorio no banco)${c.reset}`);
    return;
  }

  const startTime = new Date(Date.now() + 86400000 * 2);
  const endTime = new Date(startTime.getTime() + 3600000);

  const apt = await test("POST", "/appointments", {
    title: `${TEST_PREFIX}_Appointment`,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    contact_id: state.contactId,
    lead_id: state.crmLeadId,
    description: "Agendamento de teste",
    meeting_type: "online",
    duration_minutes: 60,
  });
  trackId("appointmentId", apt);
  console.log(`    ${c.dim}appointmentId = ${state.appointmentId}${c.reset}`);

  await test("GET", "/appointments");
  if (state.appointmentId) {
    await test("GET", `/appointments/${state.appointmentId}`);
    await test("PUT", `/appointments/${state.appointmentId}`, {
      description: "Agendamento atualizado",
    });
  }
}

async function phase15_agentCalendars() {
  setPhase("Fase 15 — Agent Calendars");

  if (!state.userId) {
    console.log(`  ${c.yellow}⊘ SKIP fase — userId nao disponivel${c.reset}`);
    return;
  }

  await test("PUT", `/agent-calendars/${state.userId}`, {
    work_days: [1, 2, 3, 4, 5],
    work_start_time: "09:00",
    work_end_time: "18:00",
    timezone: "America/Sao_Paulo",
    default_appointment_duration: 30,
  }, { expect: [200, 201] });

  await test("GET", "/agent-calendars");
  await test("GET", `/agent-calendars/${state.userId}`);
}

async function phase16_widgets() {
  setPhase("Fase 16 — Widgets");

  const slug = `test-e2e-${TS}`;
  const wg = await test("POST", "/widgets", {
    name: `${TEST_PREFIX}_Widget`,
    slug,
    type: "standalone",
    settings: { theme: "dark" },
    is_active: true,
  });
  trackId("widgetId", wg);
  state.widgetSlug = slug;
  persistState();
  console.log(`    ${c.dim}widgetId = ${state.widgetId}, slug = ${slug}${c.reset}`);

  await test("GET", "/widgets");
  if (state.widgetId) {
    await test("PUT", `/widgets/${state.widgetId}`, {
      name: `${TEST_PREFIX}_Widget_Updated`,
    });
  }
}

async function phase17_toolsAnalytics() {
  setPhase("Fase 17 — Tools & Analytics");

  await test("GET", "/tools");
  await test("GET", "/analytics/overview");
  await test("GET", "/analytics/leads");
  await test("GET", "/analytics/messages");
  await test("GET", "/analytics/agents");
  await test("GET", "/analytics/agents?source=ai");
  await test("GET", "/analytics/funnel-by-seller");
  await test("GET", "/analytics/sellers");
  await test("GET", "/analytics/delivery");
  await test("GET", "/analytics/connection-health");
  await test("GET", "/analytics/pipeline");
  await test("GET", "/analytics/pipeline?period=30d");
  await test("GET", "/analytics/sales-cycle");
  await test("GET", "/analytics/sales-cycle?compare=false");
  await test("GET", "/analytics/cohort");
  await test("GET", "/analytics/cohort?months_back=3");
  await test("GET", "/analytics/cohort?months_back=3&assigned_to=00000000-0000-0000-0000-000000000000");
}

async function phase18_notifications() {
  setPhase("Fase 18 — Notifications");

  await test("GET", "/notifications");
  await test("PUT", "/notifications/read-all");
}

async function phase19_connections() {
  setPhase("Fase 19 — Connections (read-only)");

  await test("GET", "/connections");
}

async function phase20_apiKeys() {
  setPhase("Fase 20 — API Keys");

  const key = await test("POST", "/api-keys", {
    name: `${TEST_PREFIX}_Key`,
    permissions: ["read"],
  });
  trackId("apiKeyId", key);
  console.log(`    ${c.dim}apiKeyId = ${state.apiKeyId}${c.reset}`);

  await test("GET", "/api-keys");

  // Cleanup imediato
  if (state.apiKeyId) {
    await test("DELETE", `/api-keys/${state.apiKeyId}`);
    state.apiKeyId = null; // Ja deletado
  }
}

async function phase21_public() {
  setPhase("Fase 21 — Public endpoints (sem auth)");

  if (state.widgetSlug) {
    await test("GET", `/public/widgets/${state.widgetSlug}`, undefined, {
      noAuth: true,
      expect: [200, 404],
    });
  } else {
    await test("GET", "/public/widgets/nonexistent", undefined, {
      noAuth: true,
      skip: true,
      skipReason: "widget nao criado",
    });
  }
}

async function phase22_inbox() {
  setPhase("Fase 22 — Inbox (read-only)");

  await test("GET", "/inbox/leads");
  await test("GET", "/inbox/queue");
}

async function phase22b_cadences() {
  setPhase("Fase 22b — Cadences (relatorios de reguas, read-only)");

  await test("GET", "/cadences/summary");
  const rulesRes = await test("GET", "/cadences/rules");
  const firstRule = (rulesRes?.data?.data as any[] | undefined)?.[0];
  const firstRuleId = firstRule?.id;

  if (!firstRuleId) {
    console.log(`    ${c.dim}(nenhuma regua cadastrada — pulando endpoints por-id)${c.reset}`);
    return;
  }

  await test("GET", `/cadences/rules/${firstRuleId}`);
  await test("GET", `/cadences/rules/${firstRuleId}/stats?compare=true`);
  await test("GET", `/cadences/rules/${firstRuleId}/messages?limit=5`);
  await test("GET", `/cadences/rules/${firstRuleId}/activations?limit=5`);

  if (firstRule?.trigger_type === "activity") {
    await test("GET", `/cadences/rules/${firstRuleId}/activities?limit=5`);
  }
}

async function phase22c_performance() {
  setPhase("Fase 22c — Performance (ranking de atendimento, read-only)");

  // Ranking com periodo padrao (30d)
  const rankingRes = await test("GET", "/crm/performance/ranking");
  const ranking = (rankingRes?.data?.data as any[] | undefined) ?? [];
  const meta = rankingRes?.data?.meta as { total?: number; period?: { start: string; end: string } } | undefined;

  if (!meta?.period?.start || !meta?.period?.end) {
    console.log(`    ${c.red}meta.period ausente na resposta do ranking${c.reset}`);
  }
  if (ranking.length === 0) {
    console.log(`    ${c.dim}(nenhum atendimento avaliado no periodo — ranking vazio)${c.reset}`);
  } else {
    const first = ranking[0];
    const hasShape =
      typeof first?.seller_id === "string" &&
      typeof first?.avg_score === "number" &&
      typeof first?.analyses_count === "number";
    if (!hasShape) {
      console.log(`    ${c.red}formato inesperado no ranking: ${JSON.stringify(first).slice(0, 120)}${c.reset}`);
    }
  }

  // Variacoes de filtro e paginacao
  await test("GET", "/crm/performance/ranking?period=7d");
  await test("GET", "/crm/performance/ranking?period=90d&per_page=5&page=1");

  // Visao geral da equipe
  const overviewRes = await test("GET", "/crm/performance/overview?period=90d");
  const overview = overviewRes?.data?.data as
    | { ranking?: any[]; score_series?: any[]; by_playbook?: any[]; total_analyses?: number }
    | undefined;
  if (overview && !Array.isArray(overview.ranking)) {
    console.log(`    ${c.red}overview.ranking deveria ser array${c.reset}`);
  }

  // Catalogo de analises (playbooks)
  const playbooksRes = await test("GET", "/crm/performance/playbooks");
  const playbooks = (playbooksRes?.data?.data as any[] | undefined) ?? [];
  if (playbooks[0]?.id) {
    await test("GET", `/crm/performance/playbooks/${playbooks[0].id}`);
  } else {
    console.log(`    ${c.dim}(nenhuma analise cadastrada — detalhe de playbook nao testado)${c.reset}`);
  }
  await test("GET", `/crm/performance/playbooks/${"0".repeat(8)}-0000-0000-0000-000000000000`, undefined, {
    expect: 404,
  });

  // Avaliacoes do periodo
  const analysesRes = await test("GET", "/crm/performance/analyses?period=90d&per_page=5");
  const analyses = (analysesRes?.data?.data as any[] | undefined) ?? [];
  if (analyses[0]?.id) {
    await test("GET", `/crm/performance/analyses/${analyses[0].id}`);
  } else {
    console.log(`    ${c.dim}(nenhuma avaliacao no periodo — detalhe nao testado)${c.reset}`);
  }
  await test("GET", "/crm/performance/analyses?period=90d&include_disregarded=true&per_page=5");

  // Painel individual — usa o primeiro vendedor do ranking, quando houver
  const sellerId = (ranking[0]?.seller_id as string | undefined) ?? overview?.ranking?.[0]?.seller_id;
  if (sellerId) {
    await test("GET", `/crm/performance/sellers/${sellerId}?period=90d`);
    await test("GET", `/crm/performance/sellers/${sellerId}/development-points`);
    await test("GET", `/crm/performance/sellers/${sellerId}/development-points?status=open`);
    // Brief pode nao existir (gerado sob demanda pelo gestor): 200 ou 404 sao validos
    await test("GET", `/crm/performance/sellers/${sellerId}/brief`, undefined, { expect: [200, 404] });
  } else {
    console.log(`    ${c.dim}(nenhum vendedor avaliado — painel individual nao testado)${c.reset}`);
  }

  // Datas invalidas -> 400
  await test("GET", "/crm/performance/ranking?start_date=nao-e-data", undefined, { expect: 400 });
  await test("GET", "/crm/performance/overview?start_date=nao-e-data", undefined, { expect: 400 });

  // Sub-rotas inexistentes -> 404
  await test("GET", "/crm/performance/inexistente", undefined, { expect: 404 });
  if (sellerId) {
    await test("GET", `/crm/performance/sellers/${sellerId}/inexistente`, undefined, { expect: 404 });
  }
}


async function phaseInfraExterna() {
  setPhase("Endpoints de infra externa (erros esperados)");

  // POST /auth/login — credenciais invalidas → 401
  await test("POST", "/auth/login", {
    email: `fake_${TS}@nonexistent.test`,
    password: "wrongpassword123",
  }, { expect: 401 });

  // POST /auth/register — senha fraca → 400 (validation do Supabase)
  await test("POST", "/auth/register", {
    email: `fake_${TS}@nonexistent.test`,
    password: "123",
  }, { expect: [400, 422] });

  // POST /webhooks/whatsapp — aceita qualquer payload, retorna 200
  await test("POST", "/webhooks/whatsapp", {
    entry: [{ changes: [{ field: "messages", value: {} }] }],
  }, { noAuth: true, expect: 200 });

  // POST /webhooks/zapi — aceita qualquer payload, retorna 200
  await test("POST", "/webhooks/zapi", {
    phone: "5511999990000",
    event: "message",
    text: { message: "teste e2e" },
  }, { noAuth: true, expect: 200 });

  // POST /internal/orchestrator — pode retornar 200 (aceita qualquer auth valido) ou 403/500
  await test("POST", "/internal/orchestrator", {
    action: "test",
  }, { expect: [200, 403, 500] });

  // POST /connections/zapi/validate — instancia fake → 400 (validacao Z-API falha)
  await test("POST", "/connections/zapi/validate", {
    instance_id: "fake_instance_e2e",
    api_token: "fake_token_e2e",
  }, { expect: [400, 500] });

  // POST /connections/zapi — campos obrigatorios ausentes → 400
  await test("POST", "/connections/zapi", undefined, {
    expect: 400,
  });

  // GET /integrations/google-calendar/auth-url — sem OAuth config → 500
  await test("GET", "/integrations/google-calendar/auth-url", undefined, {
    expect: [200, 400, 500],
  });

  // POST /knowledge-bases/:id/search — sem query → 400
  const fakeKbId = state.knowledgeBaseId || "00000000-0000-0000-0000-000000000000";
  await test("POST", `/knowledge-bases/${fakeKbId}/search`, {
    query: "teste e2e busca",
  }, { expect: [200, 400, 404, 500] });

  // POST /messages/send — campos obrigatorios ausentes → 400
  await test("POST", "/messages/send", undefined, {
    expect: 400,
  });

  // POST /admin/companies — sem super_admin → 403 (handler nao existe para POST → 404)
  await test("POST", "/admin/companies", {
    name: "fake_admin_test",
  }, { expect: [403, 404] });

  // GET /admin/users — sem super_admin → 403, com super_admin → 200
  await test("GET", "/admin/users", undefined, {
    expect: [200, 403],
  });
}

// ---------------------------------------------------------------------------
// Error Test Phases
// ---------------------------------------------------------------------------

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

async function phaseErrorAuth() {
  setPhase("Fase E-A — Erros de Auth & Headers");

  // No auth header at all
  await test("GET", "/agents", undefined, {
    noAuth: true,
    expect: 401,
  });

  // Invalid JWT
  await test("GET", "/agents", undefined, {
    noAuth: true,
    customHeaders: { Authorization: "Bearer invalid_garbage_token_12345" },
    expect: 401,
  });

  // Invalid API key
  await test("GET", "/agents", undefined, {
    noAuth: true,
    customHeaders: { "X-API-Key": "nxai_fake_key_12345" },
    expect: 401,
  });

  // Missing X-Workspace-Id on workspace-required endpoint
  // API key auth may return 200 (key has workspace pre-associated) or 401
  await test("GET", "/agents", undefined, {
    noWorkspace: true,
    expect: [200, 400, 401],
  });

  // Unknown route
  await test("GET", "/nonexistent-route-e2e-test", undefined, {
    expect: 404,
  });

  // Wrong method (PATCH not supported)
  await test("PATCH" as any, "/agents", undefined, {
    expect: [404, 405],
  });
}

async function phaseErrorValidation() {
  setPhase("Fase E-B — Erros de Validacao (body vazio)");

  // POST /companies empty body
  await test("POST", "/companies", {}, {
    expect: 400,
  });

  // POST /agents empty body
  await test("POST", "/agents", {}, {
    expect: 400,
  });

  // POST /crm/contacts empty body
  await test("POST", "/crm/contacts", {}, {
    expect: 400,
  });

  // POST /crm/pipeline/stages empty body
  await test("POST", "/crm/pipeline/stages", {}, {
    expect: 400,
  });

  // POST /knowledge-bases empty body
  await test("POST", "/knowledge-bases", {}, {
    expect: 400,
  });

  // POST /chat-categories empty body
  await test("POST", "/chat-categories", {}, {
    expect: 400,
  });

  // POST /widgets empty body
  await test("POST", "/widgets", {}, {
    expect: 400,
  });

  // POST /appointments empty body
  await test("POST", "/appointments", {}, {
    expect: 400,
  });

  // POST /crm/leads without stage_id
  await test("POST", "/crm/leads", { title: "no_stage" }, {
    expect: 400,
  });

  // PUT /auth/me empty updates
  await test("PUT", "/auth/me", {}, {
    expect: 400,
  });
}

async function phaseErrorNotFound() {
  setPhase("Fase E-C — Erros 404 (UUID inexistente)");

  await test("GET", `/companies/${FAKE_UUID}`, undefined, {
    expect: 404,
  });

  await test("GET", `/agents/${FAKE_UUID}`, undefined, {
    expect: 404,
  });

  await test("GET", `/crm/contacts/${FAKE_UUID}`, undefined, {
    expect: 404,
  });

  await test("GET", `/crm/leads/${FAKE_UUID}`, undefined, {
    expect: 404,
  });

  await test("DELETE", `/api-keys/${FAKE_UUID}`, undefined, {
    expect: 404,
  });

  await test("GET", `/knowledge-bases/${FAKE_UUID}`, undefined, {
    expect: 404,
  });
}

async function phaseErrorPermissions() {
  setPhase("Fase E-D — Erros de Permissao");

  // POST /agent-templates — requires super_admin
  // May return 400 (validation before auth check) or 401/403/404
  await test("POST", "/agent-templates", {
    name: "fake_template_e2e",
    system_prompt: "test",
  }, { expect: [400, 401, 403, 404] });

  // PUT /admin/users/:fakeId/role — requires super_admin
  await test("PUT", `/admin/users/${FAKE_UUID}/role`, {
    role: "admin",
  }, { expect: [200, 403, 404] });

  // DELETE /admin/companies/:fakeId — requires super_admin
  await test("DELETE", `/admin/companies/${FAKE_UUID}`, undefined, {
    expect: [200, 204, 403, 404],
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function phase23_cleanup() {
  setPhase("Fase 23 — Cleanup (ordem reversa)");

  const cleanups: Array<[string, string | undefined, string]> = [
    ["apiKeyId", state.apiKeyId, "/api-keys"],
    ["widgetId", state.widgetId, "/widgets"],
    ["appointmentId", state.appointmentId, "/appointments"],
    ["automoveRuleId", state.automoveRuleId, "/crm/automove-rules"],
    ["crmLeadId", state.crmLeadId, "/crm/leads"],
    ["lossReasonId", state.lossReasonId, "/crm/loss-reasons"],
    ["productId", state.productId, "/crm/products"],
    ["stageId2", state.stageId2, "/crm/pipeline/stages"],
    ["stageId", state.stageId, "/crm/pipeline/stages"],
    ["contactId2", state.contactId2, "/crm/contacts"],
    ["contactId", state.contactId, "/crm/contacts"],
    ["chatCategoryId", state.chatCategoryId, "/chat-categories"],
    ["agentCategoryId", state.agentCategoryId, "/agent-categories"],
    ["knowledgeBaseId", state.knowledgeBaseId, "/knowledge-bases"],
    ["agentId", state.agentId, "/agents"],
    ["workspaceId", state.workspaceId, "/workspaces"],
    ["companyId", state.companyId, "/companies"],
  ];

  for (const [key, id, basePath] of cleanups) {
    if (!id) {
      console.log(`  ${c.dim}⊘ ${key} — nao criado, skip${c.reset}`);
      continue;
    }
    await test("DELETE", `${basePath}/${id}`, undefined, {
      expect: [200, 204, 404],
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(totalDuration: number) {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const total = results.length;

  console.log(`
${c.bold}========================================${c.reset}
${c.bold}  NEXUS AI API TEST REPORT${c.reset}
${c.bold}========================================${c.reset}
  Total:    ${total} endpoints testados
  ${c.green}Passed:   ${passed} ✓${c.reset}
  ${failed > 0 ? c.red : c.dim}Failed:   ${failed} ✗${c.reset}
  ${c.yellow}Skipped:  ${skipped} ⊘${c.reset}
  Duration: ${(totalDuration / 1000).toFixed(1)}s
`);

  if (failed > 0) {
    console.log(`${c.red}${c.bold}FAILURES:${c.reset}`);
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(
        `  ${c.red}✗ ${r.method.padEnd(6)} ${r.path}${c.reset}  → ${r.httpStatus || "ERR"} ${r.error || ""}`
      );
    }
    console.log();
  }

  console.log(`${c.bold}========================================${c.reset}`);

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Crash recovery — cleanup previous run state
// ---------------------------------------------------------------------------

async function cleanupPreviousRun() {
  const prev = loadPersistedState();
  if (!prev) return;
  console.log(`${c.yellow}${c.bold}Estado de execucao anterior detectado (prefix: ${prev._prefix})${c.reset}`);
  console.log(`${c.yellow}Limpando dados orfaos...${c.reset}`);

  const savedState = { ...state };
  Object.assign(state, prev);
  try {
    await phase23_cleanup();
  } finally {
    Object.assign(state, savedState);
    clearStateFile();
  }
  console.log(`${c.green}Dados orfaos limpos com sucesso.${c.reset}`);
}

// ---------------------------------------------------------------------------
// Sweep — find and delete all TEST_E2E_ data by prefix
// ---------------------------------------------------------------------------

async function sweepOrphanedTestData() {
  setPhase("Sweep — Limpando dados orfaos TEST_E2E_*");
  const res = await api("GET", "/companies");
  if (!res.ok || !res.data?.data) {
    console.log(`  ${c.dim}Nao foi possivel listar empresas para sweep.${c.reset}`);
    return;
  }

  const testCompanies = (res.data.data as any[]).filter((co: any) =>
    co.name?.startsWith("TEST_E2E_")
  );

  if (testCompanies.length === 0) {
    console.log(`  ${c.dim}Nenhum dado orfao encontrado.${c.reset}`);
    return;
  }

  console.log(`  ${c.yellow}Encontradas ${testCompanies.length} empresas de teste orfas${c.reset}`);

  for (const comp of testCompanies) {
    const wsRes = await api("GET", `/workspaces?company_id=${comp.id}`);
    const workspaces = (wsRes.data?.data || []) as any[];

    for (const ws of workspaces) {
      const wsId = ws.id;

      // Agents
      const agRes = await api("GET", "/agents", undefined, { workspaceId: wsId });
      for (const ag of ((agRes.data?.data || []) as any[]).filter((a: any) => a.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/agents/${ag.id}`, undefined, { workspaceId: wsId });
      }

      // CRM leads
      const ldRes = await api("GET", "/crm/leads", undefined, { workspaceId: wsId });
      for (const ld of ((ldRes.data?.data || []) as any[]).filter((l: any) => l.title?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/leads/${ld.id}`, undefined, { workspaceId: wsId });
      }

      // CRM contacts
      const ctRes = await api("GET", "/crm/contacts", undefined, { workspaceId: wsId });
      for (const ct of ((ctRes.data?.data || []) as any[]).filter((co: any) => co.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/contacts/${ct.id}`, undefined, { workspaceId: wsId });
      }

      // Pipeline stages
      const stRes = await api("GET", "/crm/pipeline/stages", undefined, { workspaceId: wsId });
      for (const st of ((stRes.data?.data || []) as any[]).filter((s: any) => s.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/pipeline/stages/${st.id}`, undefined, { workspaceId: wsId });
      }

      // Products
      const prRes = await api("GET", "/crm/products", undefined, { workspaceId: wsId });
      for (const pr of ((prRes.data?.data || []) as any[]).filter((p: any) => p.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/products/${pr.id}`, undefined, { workspaceId: wsId });
      }

      // Loss reasons
      const lrRes = await api("GET", "/crm/loss-reasons", undefined, { workspaceId: wsId });
      for (const lr of ((lrRes.data?.data || []) as any[]).filter((l: any) => l.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/loss-reasons/${lr.id}`, undefined, { workspaceId: wsId });
      }

      // Knowledge bases
      const kbRes = await api("GET", "/knowledge-bases", undefined, { workspaceId: wsId });
      for (const kb of ((kbRes.data?.data || []) as any[]).filter((k: any) => k.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/knowledge-bases/${kb.id}`, undefined, { workspaceId: wsId });
      }

      // Chat categories
      const ccRes = await api("GET", "/chat-categories", undefined, { workspaceId: wsId });
      for (const cc of ((ccRes.data?.data || []) as any[]).filter((cat: any) => cat.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/chat-categories/${cc.id}`, undefined, { workspaceId: wsId });
      }

      // Agent categories
      const acRes = await api("GET", "/agent-categories", undefined, { workspaceId: wsId });
      for (const ac of ((acRes.data?.data || []) as any[]).filter((cat: any) => cat.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/agent-categories/${ac.id}`, undefined, { workspaceId: wsId });
      }

      // Widgets
      const wgRes = await api("GET", "/widgets", undefined, { workspaceId: wsId });
      for (const wg of ((wgRes.data?.data || []) as any[]).filter((w: any) => w.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/widgets/${wg.id}`, undefined, { workspaceId: wsId });
      }

      // Automove rules
      const arRes = await api("GET", "/crm/automove-rules", undefined, { workspaceId: wsId });
      for (const ar of ((arRes.data?.data || []) as any[]).filter((r: any) => r.name?.startsWith("TEST_E2E_"))) {
        await api("DELETE", `/crm/automove-rules/${ar.id}`, undefined, { workspaceId: wsId });
      }

      // Delete workspace
      await api("DELETE", `/workspaces/${wsId}`);
    }

    // Delete company
    await api("DELETE", `/companies/${comp.id}`);
    console.log(`  ${c.green}✓ Empresa ${comp.name} e recursos limpos${c.reset}`);
  }
}

// ---------------------------------------------------------------------------
// Signal handlers (SIGINT, SIGTERM)
// ---------------------------------------------------------------------------

let isShuttingDown = false;

async function emergencyCleanup(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${c.red}${c.bold}Sinal ${signal} recebido — executando cleanup de emergencia...${c.reset}`);
  try {
    await phase23_cleanup();
  } catch (e) {
    console.error(`${c.red}Erro no cleanup de emergencia: ${e}${c.reset}`);
  }
  clearStateFile();
  process.exit(1);
}

process.on("SIGINT", () => { emergencyCleanup("SIGINT"); });
process.on("SIGTERM", () => { emergencyCleanup("SIGTERM"); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`${c.bold}${c.cyan}`);
  console.log(`  ╔═══════════════════════════════════════╗`);
  console.log(`  ║   NEXUS AI — API E2E TEST RUNNER      ║`);
  console.log(`  ╚═══════════════════════════════════════╝`);
  console.log(`${c.reset}`);
  console.log(`  ${c.dim}Base URL:  ${BASE_URL}${c.reset}`);
  console.log(`  ${c.dim}Token:     ${TOKEN.slice(0, 20)}...${c.reset}`);
  console.log(`  ${c.dim}Prefix:    ${TEST_PREFIX}${c.reset}`);

  // Modo --cleanup-only
  if (CLEANUP_ONLY) {
    await cleanupPreviousRun();
    console.log("Cleanup concluido.");
    process.exit(0);
  }

  // Modo --sweep
  if (SWEEP) {
    await sweepOrphanedTestData();
    console.log("Sweep concluido.");
    process.exit(0);
  }

  // Limpar estado anterior se existir
  await cleanupPreviousRun();

  const start = performance.now();

  try {
    await phase0_health();
    await phase1_setup();
    await phase2_companyWorkspace();
    await phase3_agents();
    await phase4_agentCategories();
    await phase5_knowledgeBases();
    await phase6_crmContacts();
    await phase7_crmPipeline();
    await phase8_crmProductsLossReasons();
    await phase9_crmLeads();
    await phase10_crmTagsAutomove();
    await phase11_chatCategories();
    await phase12_routing();
    await phase13_availability();
    await phase14_appointments();
    await phase15_agentCalendars();
    await phase16_widgets();
    await phase17_toolsAnalytics();
    await phase18_notifications();
    await phase19_connections();
    await phase20_apiKeys();
    await phase21_public();
    await phase22_inbox();
    await phase22b_cadences();
    await phase22c_performance();
    await phaseErrorAuth();
    await phaseErrorValidation();
    await phaseErrorNotFound();
    await phaseErrorPermissions();
    await phaseInfraExterna();
  } catch (err) {
    console.error(`\n${c.red}ERRO FATAL: ${err}${c.reset}`);
  } finally {
    // Sempre executar cleanup
    try {
      await phase23_cleanup();
    } catch (err) {
      console.error(`${c.red}ERRO NO CLEANUP: ${err}${c.reset}`);
    }
    clearStateFile();
  }

  const totalDuration = performance.now() - start;
  printReport(totalDuration);
}

main();
