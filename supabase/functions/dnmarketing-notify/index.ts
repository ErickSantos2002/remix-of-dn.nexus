import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyDnMarketing, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contact_id, event_type, title, description, metadata, occurred_at } = await req.json();

    if (!contact_id || !event_type || !title) {
      return new Response(
        JSON.stringify({ error: "contact_id, event_type and title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: contact, error } = await supabase
      .from("crm_contacts")
      .select("id, name, dnia_id, workspace_id, phone, email")
      .eq("id", contact_id)
      .single();

    if (error || !contact) {
      console.warn("[dnmarketing-notify] Contact not found:", contact_id);
      return new Response(
        JSON.stringify({ skipped: true, reason: "contact_not_found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!contact.dnia_id) {
      console.log("[dnmarketing-notify] Contact has no dnia_id, skipping:", contact_id);
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_dnia_id" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });
    const result = await notifyDnMarketing(supabase, companyId, {
      dnia_id: contact.dnia_id,
      event_type,
      title,
      description,
      metadata,
      occurred_at,
    });

    if (!result) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_active_config" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Nota: a conversão de agendamento (mql_reuniao_agendada) é registrada via
    // trigger trg_notify_dnmarketing_stage_conversion quando o lead entra na
    // etapa "MQL - Reunião agendada". Não enviamos mais "schedule" aqui para
    // evitar duplicidade de conversão na dn.marketing.

    return new Response(
      JSON.stringify({ success: result.ok, status: result.status, result: result.data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[dnmarketing-notify] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
