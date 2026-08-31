import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contact_id, stage_name } = await req.json();

    if (!contact_id || !stage_name) {
      return new Response(
        JSON.stringify({ error: "contact_id and stage_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const status = String(stage_name).trim();
    if (!status) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "empty_stage_name" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: contact, error } = await supabase
      .from("crm_contacts")
      .select("id, dnia_id, workspace_id, job_title, company, revenue, employee_count, tags, source")
      .eq("id", contact_id)
      .single();

    if (error || !contact) {
      console.warn("[dnmarketing-status] contact not found:", contact_id);
      return new Response(
        JSON.stringify({ skipped: true, reason: "contact_not_found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!contact.dnia_id) {
      console.log("[dnmarketing-status] contact has no dnia_id, skipping:", contact_id);
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_dnia_id" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });

    const statusBody: Record<string, unknown> = { dnia_id: contact.dnia_id, status };
    const contactFields: Record<string, unknown> = {};
    if (contact.job_title) { statusBody.cargo = contact.job_title; contactFields.cargo = contact.job_title; }
    if (contact.company) { statusBody.empresa = contact.company; contactFields.empresa = contact.company; }
    if (contact.revenue) { statusBody.faturamento = contact.revenue; contactFields.faturamento = contact.revenue; }
    if (contact.employee_count) { statusBody.funcionarios = contact.employee_count; contactFields.funcionarios = contact.employee_count; }
    if (Object.keys(contactFields).length > 0) statusBody.contact_fields = contactFields;

    // Origem: primeira tag do contato; fallback para o campo source.
    let origem: string | null = null;
    const tags = (contact as { tags?: Array<{ name?: string }> | null }).tags;
    if (Array.isArray(tags) && tags.length > 0) {
      const firstTag = tags.find((t) => t && typeof t.name === "string" && t.name.trim() !== "");
      if (firstTag?.name) origem = firstTag.name.trim();
    }
    if (!origem && contact.source && contact.source.trim() !== "") {
      origem = contact.source.trim();
    }
    if (origem) statusBody.origem = origem;

    const result = await dnFetch(supabase, companyId, {
      method: "PATCH",
      path: "/contact-status-update",
      body: statusBody,
    });


    if (!result) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_active_config" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: "dnmarketing_error", status: result.status, body: result.data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[dnmarketing-status] success:", contact.dnia_id, "->", status);
    return new Response(
      JSON.stringify({ success: true, dnia_id: contact.dnia_id, status, result: result.data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[dnmarketing-status] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
