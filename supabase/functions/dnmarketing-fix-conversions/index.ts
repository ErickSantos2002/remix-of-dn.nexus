// One-shot: corrige converted_at das conversões enviadas erradas no backfill anterior
// e remove da dn.marketing conversões falsas de "hoje" informadas por CSV/lista.
import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_STAGES = ["Lead Qualificado", "MQL - Reunião agendada"];

type ContactInput = { email?: string | null; phone?: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function normalizePhone(value: string | null | undefined) {
  let digits = onlyDigits(value);
  if (digits && !digits.startsWith("55") && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits || null;
}

function dateInSaoPaulo(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

async function cleanupFalseToday(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  contacts: ContactInput[],
  targetDate: string,
  dryRun: boolean,
) {
  const results = {
    mode: "cleanup_false_today",
    target_date: targetDate,
    dry_run: dryRun,
    total: contacts.length,
    removed: 0,
    kept_today: 0,
    not_found: 0,
    skipped: 0,
    errors: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  for (const input of contacts) {
    const email = input.email?.trim().toLowerCase() || null;
    const phone = normalizePhone(input.phone);

    if (!email && !phone) {
      results.skipped++;
      results.items.push({ action: "skip", reason: "missing_identifiers" });
      continue;
    }

    let query = supabase.from("crm_contacts").select("id, name, email, phone, workspace_id, updated_at");
    if (email && phone) query = query.or(`email.ilike.${email},phone.eq.${phone}`);
    else if (email) query = query.ilike("email", email);
    else query = query.eq("phone", phone);

    const { data: matchedContacts, error: contactErr } = await query.order("updated_at", { ascending: false }).limit(5);
    if (contactErr) {
      results.errors++;
      results.items.push({ email, phone, action: "error", reason: "contact_fetch_failed", details: contactErr.message });
      continue;
    }

    const contact = (matchedContacts ?? []).find((c: Record<string, unknown>) => {
      const cEmail = typeof c.email === "string" ? c.email.toLowerCase() : null;
      const cPhone = normalizePhone(typeof c.phone === "string" ? c.phone : null);
      return (email && cEmail === email) || (phone && cPhone === phone);
    });

    if (!contact) {
      results.not_found++;
      results.items.push({ email, phone, action: "not_found", reason: "contact_not_found" });
      continue;
    }

    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, moved_at, status, stage_id, deleted_at")
      .eq("contact_id", contact.id)
      .is("deleted_at", null)
      .order("moved_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lead?.id || !lead.moved_at) {
      results.skipped++;
      results.items.push({ email, phone, contact_id: contact.id, action: "skip", reason: "lead_or_moved_at_missing" });
      continue;
    }

    const realDate = dateInSaoPaulo(lead.moved_at);
    if (realDate === targetDate) {
      results.kept_today++;
      results.items.push({ email, phone, lead_id: lead.id, action: "keep", real_converted_date: realDate });
      continue;
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });
    if (!companyId) {
      results.skipped++;
      results.items.push({ email, phone, lead_id: lead.id, action: "skip", reason: "no_company" });
      continue;
    }

    if (dryRun) {
      results.items.push({
        email,
        phone,
        lead_id: lead.id,
        contact_id: contact.id,
        action: "would_unregister",
        real_converted_at: lead.moved_at,
        real_converted_date: realDate,
      });
      continue;
    }

    try {
      await new Promise((r) => setTimeout(r, 500));
      const res = await dnFetch(supabase, companyId, {
        method: "DELETE",
        path: "/unregister-conversion",
        body: {
          session_id: lead.id,
          email: contact.email || email || undefined,
          phone: contact.phone || phone || undefined,
        },
      });

      if (!res) {
        results.errors++;
        results.items.push({ email, phone, lead_id: lead.id, action: "error", reason: "no_dn_config" });
      } else if (res.ok || res.status === 404) {
        results.removed++;
        results.items.push({
          email,
          phone,
          lead_id: lead.id,
          action: res.ok ? "unregistered" : "already_absent",
          status: res.status,
          real_converted_at: lead.moved_at,
          real_converted_date: realDate,
        });
      } else {
        results.errors++;
        results.items.push({ email, phone, lead_id: lead.id, action: "error", status: res.status, raw: res.raw?.substring(0, 200) });
      }
    } catch (err) {
      results.errors++;
      results.items.push({ email, phone, lead_id: lead.id, action: "error", error: err instanceof Error ? err.message : String(err) });
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
    const limit = Number(body.limit ?? 15);
    const offset = Number(body.offset ?? 0);
    const mode = String(body.mode ?? "repair_dates");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (mode === "cleanup_false_today") {
      const contacts = Array.isArray(body.contacts) ? body.contacts as ContactInput[] : [];
      const targetDate = String(body.target_date ?? dateInSaoPaulo(new Date().toISOString()));
      return json(await cleanupFalseToday(supabase, contacts, targetDate, dry_run));
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: stages } = await supabase
      .from("crm_pipeline_stages")
      .select("id, name")
      .in("name", TARGET_STAGES);

    const stageIds = (stages ?? []).map((s) => s.id);
    if (!stageIds.length) return json({ error: "no_target_stages" }, 400);

    const statuses = (body.statuses as string[]) ?? ["open", "won", "lost"];
    const { data: leads, error: leadsErr } = await supabase
      .from("crm_leads")
      .select("id, contact_id, workspace_id, moved_at, status, stage_id")
      .in("stage_id", stageIds)
      .in("status", statuses)
      .is("deleted_at", null)
      .gte("moved_at", since)
      .order("moved_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (leadsErr) return json({ error: "leads_fetch_failed", details: leadsErr.message }, 500);

    const results = {
      since,
      days,
      dry_run,
      total: leads?.length ?? 0,
      updated: 0,
      not_found: 0,
      errors: 0,
      items: [] as Array<Record<string, unknown>>,
    };

    for (const lead of leads ?? []) {
      if (!lead.moved_at || !lead.contact_id) continue;

      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("workspace_id")
        .eq("id", lead.contact_id)
        .maybeSingle();

      const wsId = contact?.workspace_id ?? lead.workspace_id;
      const companyId = await resolveCompanyId(supabase, { workspaceId: wsId });
      if (!companyId) {
        results.items.push({ lead_id: lead.id, action: "skip", reason: "no_company" });
        continue;
      }

      if (dry_run) {
        results.items.push({
          lead_id: lead.id,
          action: "would_patch",
          converted_at: lead.moved_at,
        });
        continue;
      }

      try {
        await new Promise((r) => setTimeout(r, 600));
        const res = await dnFetch(supabase, companyId, {
          method: "PATCH",
          path: "/update-conversion",
          body: {
            session_id: lead.id,
            converted_at: lead.moved_at,
          },
        });

        if (!res) {
          results.errors++;
          results.items.push({ lead_id: lead.id, action: "error", reason: "no_dn_config" });
        } else if (res.status === 404) {
          results.not_found++;
          results.items.push({ lead_id: lead.id, action: "not_found" });
        } else if (res.ok) {
          results.updated++;
          results.items.push({
            lead_id: lead.id,
            action: "patched",
            converted_at: lead.moved_at,
            status: res.status,
          });
        } else {
          results.errors++;
          results.items.push({
            lead_id: lead.id,
            action: "error",
            status: res.status,
            raw: typeof res.raw === "string" ? res.raw.substring(0, 200) : res.raw,
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

    return json(results);
  } catch (err) {
    console.error("[dnmarketing-fix-conversions] error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
