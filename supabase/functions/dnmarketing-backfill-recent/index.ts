// Backfill correto: leads dos últimos N dias em Lead Qualificado / MQL - Reunião agendada
// - status=open  → /register-conversion com converted_at = moved_at
// - status=won   → /receive-contact-event (deal_won) com occurred_at = closed_at|moved_at
// - status=lost  → ignora
import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STAGE_TO_CONVERSION: Record<string, string> = {
  "Lead Qualificado": "lead_qualificado",
  "MQL - Reunião agendada": "mql_reuniao_agendada",
};

const TARGET_STAGES = Object.keys(STAGE_TO_CONVERSION);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RunOpts {
  days: number;
  dry_run: boolean;
}

async function run({ days, dry_run }: RunOpts) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // 1) Estágios-alvo
  const { data: stages, error: stagesErr } = await supabase
    .from("crm_pipeline_stages")
    .select("id, name, workspace_id")
    .in("name", TARGET_STAGES);

  if (stagesErr) return { error: "stages_fetch_failed", details: stagesErr.message };
  if (!stages?.length) return { processed: 0, message: "no_target_stages" };

  const stageMap = new Map(stages.map((s) => [s.id, s.name]));
  const stageIds = stages.map((s) => s.id);

  // 2) Leads candidatos
  const { data: leads, error: leadsErr } = await supabase
    .from("crm_leads")
    .select("id, contact_id, workspace_id, stage_id, status, moved_at, closed_at, deleted_at")
    .in("stage_id", stageIds)
    .in("status", ["open", "won"])
    .is("deleted_at", null)
    .gte("moved_at", since)
    .order("moved_at", { ascending: true });

  if (leadsErr) return { error: "leads_fetch_failed", details: leadsErr.message };
  if (!leads?.length) return { processed: 0, message: "no_candidates", since };

  const results = {
    since,
    days,
    dry_run,
    total_candidates: leads.length,
    sent_conversion: 0,
    sent_event: 0,
    skipped: 0,
    errors: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  for (const lead of leads) {
    const stageName = stageMap.get(lead.stage_id) ?? "";
    const conversionType = STAGE_TO_CONVERSION[stageName];
    if (!conversionType || !lead.contact_id) {
      results.skipped++;
      continue;
    }

    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email, dnia_id, workspace_id, job_title, company, revenue, employee_count")
      .eq("id", lead.contact_id)
      .maybeSingle();

    if (!contact || (!contact.phone && !contact.email)) {
      results.skipped++;
      results.items.push({ lead_id: lead.id, action: "skip", reason: "no_contact_or_identifiers" });
      continue;
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });
    if (!companyId) {
      results.skipped++;
      results.items.push({ lead_id: lead.id, action: "skip", reason: "no_company" });
      continue;
    }

    if (dry_run) {
      results.items.push({
        lead_id: lead.id,
        contact_id: contact.id,
        dnia_id: contact.dnia_id,
        stage: stageName,
        status: lead.status,
        action: lead.status === "won" ? "would_send_event_deal_won" : "would_send_conversion",
        occurred_at: lead.status === "won"
          ? (lead.closed_at ?? lead.moved_at)
          : lead.moved_at,
      });
      continue;
    }

    try {
      if (lead.status === "open") {
        // identity-upsert para garantir presença / atualizar dados
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

        const upsertRes = await dnFetch(supabase, companyId, {
          method: "POST",
          path: "/identity-upsert",
          body: upsertBody,
        });

        // Persiste dnia_id se vier novo
        const upsertData = upsertRes?.data as { dnia_id?: string } | null;
        const dniaId = upsertData?.dnia_id ?? contact.dnia_id ?? null;
        if (dniaId && dniaId !== contact.dnia_id) {
          await supabase.from("crm_contacts").update({ dnia_id: dniaId }).eq("id", contact.id);
        }

        const convertedAt = lead.moved_at ?? new Date().toISOString();

        const convRes = await dnFetch(supabase, companyId, {
          method: "POST",
          path: "/register-conversion",
          body: {
            email: contact.email || undefined,
            phone: contact.phone || undefined,
            dnia_id: dniaId || undefined,
            tipo: conversionType,
            page_slug: stageName,
            session_id: lead.id,
            converted_at: convertedAt,
            apply_tag: true,
          },
        });

        results.sent_conversion++;
        results.items.push({
          lead_id: lead.id,
          dnia_id: dniaId,
          stage: stageName,
          status: lead.status,
          action: "conversion_sent",
          converted_at: convertedAt,
          conversion_status: convRes?.status,
        });
      } else if (lead.status === "won") {
        const occurredAt = lead.closed_at ?? lead.moved_at ?? new Date().toISOString();

        const evtRes = await dnFetch(supabase, companyId, {
          method: "POST",
          path: "/receive-contact-event",
          body: {
            source_app: "nexus",
            event_type: "deal_won",
            title: `Negócio fechado (${stageName})`,
            phone: contact.phone || undefined,
            email: contact.email || undefined,
            dnia_id: contact.dnia_id || undefined,
            occurred_at: occurredAt,
            metadata: { crm_lead_id: lead.id, stage: stageName },
          },
        });

        results.sent_event++;
        results.items.push({
          lead_id: lead.id,
          dnia_id: contact.dnia_id,
          stage: stageName,
          status: lead.status,
          action: "event_deal_won_sent",
          occurred_at: occurredAt,
          event_status: evtRes?.status,
        });
      }
    } catch (err) {
      results.errors++;
      results.items.push({
        lead_id: lead.id,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const days = Number(body.days ?? 10);
    const dry_run = body.dry_run === true;

    const result = await run({ days, dry_run });
    return json(result);
  } catch (err) {
    console.error("[dnmarketing-backfill-recent] error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
