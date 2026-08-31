import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mapeamento estágio -> tipo de conversão na dn.marketing
const STAGE_TO_CONVERSION: Record<string, string> = {
  "Lead Qualificado": "lead_qualificado",
  "MQL - Reunião agendada": "mql_reuniao_agendada",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function run(crm_lead_id: string, converted_at_override?: string) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Busca lead + contato + stage
  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, contact_id, workspace_id, stage_id, deleted_at, status, moved_at, utm_source, utm_medium, utm_campaign, utm_term, utm_content")
    .eq("id", crm_lead_id)
    .maybeSingle();

  if (leadErr || !lead) {
    console.warn("[dnmarketing-stage-conversion] lead not found", crm_lead_id, leadErr);
    return { skipped: true, reason: "lead_not_found" };
  }
  if (lead.deleted_at) return { skipped: true, reason: "lead_deleted" };
  if (lead.status === "lost" || lead.status === "won") {
    return { skipped: true, reason: `lead_${lead.status}` };
  }
  if (!lead.contact_id || !lead.stage_id) return { skipped: true, reason: "missing_contact_or_stage" };

  const { data: stage } = await supabase
    .from("crm_pipeline_stages")
    .select("id, name")
    .eq("id", lead.stage_id)
    .maybeSingle();

  const stageName = stage?.name?.trim() ?? "";
  const conversionType = STAGE_TO_CONVERSION[stageName];
  if (!conversionType) {
    return { skipped: true, reason: "stage_not_target", stage: stageName };
  }

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id, name, phone, email, dnia_id, workspace_id, job_title, company, revenue, employee_count, source")
    .eq("id", lead.contact_id)
    .maybeSingle();

  if (!contact) return { skipped: true, reason: "contact_not_found" };
  if (!contact.phone && !contact.email) return { skipped: true, reason: "no_identifiers" };

  const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });
  if (!companyId) return { skipped: true, reason: "no_company" };

  // Passo A: identity-upsert com stage=lead (garante que vire lead na dn.marketing)
  const upsertBody: Record<string, unknown> = {
    source_app: "nexus",
    local_id: contact.id,
    stage: "lead",
  };
  if (contact.phone) upsertBody.phone = contact.phone;
  if (contact.email) upsertBody.email = contact.email;
  if (contact.name) upsertBody.nome = contact.name;
  if (contact.job_title) upsertBody.job_title = contact.job_title;
  if (contact.company) upsertBody.company = contact.company;
  if (contact.revenue) upsertBody.revenue = contact.revenue;
  if (contact.employee_count) upsertBody.employee_count = contact.employee_count;
  if (contact.source) upsertBody.source = contact.source;
  if (lead.utm_source) upsertBody.utm_source = lead.utm_source;
  if (lead.utm_medium) upsertBody.utm_medium = lead.utm_medium;
  if (lead.utm_campaign) upsertBody.utm_campaign = lead.utm_campaign;
  if (lead.utm_term) upsertBody.utm_term = lead.utm_term;
  if (lead.utm_content) upsertBody.utm_content = lead.utm_content;

  const upsertRes = await dnFetch(supabase, companyId, {
    method: "POST",
    path: "/identity-upsert",
    body: upsertBody,
  });

  if (!upsertRes) return { skipped: true, reason: "no_active_config" };

  // Passo B: persiste dnia_id se vier novo
  const upsertData = upsertRes.data as { dnia_id?: string } | null;
  const dniaId = upsertData?.dnia_id ?? contact.dnia_id ?? null;
  if (dniaId && dniaId !== contact.dnia_id) {
    await supabase.from("crm_contacts").update({ dnia_id: dniaId }).eq("id", contact.id);
  }

  // Passo C: register-conversion (idempotente por session_id = crm_lead_id)
  const convertedAt = converted_at_override
    ?? (lead.moved_at ? new Date(lead.moved_at).toISOString() : new Date().toISOString());

  const conversionBody = {
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    tipo: conversionType,
    page_slug: stageName,
    session_id: lead.id,
    converted_at: convertedAt,
    apply_tag: true,
  };

  let convRes = await dnFetch(supabase, companyId, {
    method: "POST",
    path: "/register-conversion",
    body: conversionBody,
  });

  // Fallback: se a dn.marketing não encontrou o lead vinculado à identidade,
  // tenta re-upsert SEM local_id (forçando lookup/criação por email/telefone)
  // e re-tenta a conversão.
  const needsFallback =
    convRes &&
    !convRes.ok &&
    convRes.status === 404 &&
    typeof convRes.raw === "string" &&
    /lead vinculado|não possui lead|nao possui lead/i.test(convRes.raw);

  if (needsFallback && (contact.email || contact.phone)) {
    console.log(`[dnmarketing-stage-conversion] fallback lead=${lead.id} (re-upsert sem local_id)`);
    const fallbackUpsert: Record<string, unknown> = {
      source_app: "nexus",
      stage: "lead",
    };
    if (contact.phone) fallbackUpsert.phone = contact.phone;
    if (contact.email) fallbackUpsert.email = contact.email;
    if (contact.name) fallbackUpsert.nome = contact.name;
    if (contact.job_title) fallbackUpsert.job_title = contact.job_title;
    if (contact.company) fallbackUpsert.company = contact.company;
    if (contact.revenue) fallbackUpsert.revenue = contact.revenue;
    if (contact.employee_count) fallbackUpsert.employee_count = contact.employee_count;
    if (contact.source) fallbackUpsert.source = contact.source;
    if (lead.utm_source) fallbackUpsert.utm_source = lead.utm_source;
    if (lead.utm_medium) fallbackUpsert.utm_medium = lead.utm_medium;
    if (lead.utm_campaign) fallbackUpsert.utm_campaign = lead.utm_campaign;
    if (lead.utm_term) fallbackUpsert.utm_term = lead.utm_term;
    if (lead.utm_content) fallbackUpsert.utm_content = lead.utm_content;

    const fbUpsertRes = await dnFetch(supabase, companyId, {
      method: "POST",
      path: "/identity-upsert",
      body: fallbackUpsert,
    });

    const fbData = fbUpsertRes?.data as { dnia_id?: string } | null;
    const fbDniaId = fbData?.dnia_id ?? null;
    if (fbDniaId && fbDniaId !== contact.dnia_id) {
      await supabase.from("crm_contacts").update({ dnia_id: fbDniaId }).eq("id", contact.id);
    }

    convRes = await dnFetch(supabase, companyId, {
      method: "POST",
      path: "/register-conversion",
      body: conversionBody,
    });

    console.log(
      `[dnmarketing-stage-conversion] fallback result lead=${lead.id} upsert=${fbUpsertRes?.status ?? "n/a"} conversion=${convRes?.status ?? "n/a"}`,
    );
  }

  console.log(
    `[dnmarketing-stage-conversion] lead=${lead.id} stage="${stageName}" type=${conversionType} converted_at=${convertedAt} upsert=${upsertRes.status} conversion=${convRes?.status ?? "n/a"}`,
  );


  return {
    success: true,
    stage: stageName,
    conversion_type: conversionType,
    upsert: { status: upsertRes.status, ok: upsertRes.ok },
    conversion: convRes ? { status: convRes.status, ok: convRes.ok, result: convRes.data } : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { crm_lead_id, converted_at } = await req.json();
    if (!crm_lead_id) return json({ error: "crm_lead_id required" }, 400);

    // Processa em background para não derrubar o processo
    const work = run(crm_lead_id, converted_at).catch((e) => {
      console.error("[dnmarketing-stage-conversion] background error:", e);
    });
    // @ts-ignore EdgeRuntime global
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

    return json({ accepted: true, crm_lead_id });
  } catch (err) {
    console.error("[dnmarketing-stage-conversion] error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
