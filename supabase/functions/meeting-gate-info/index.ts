// Public endpoint: returns safe appointment info for the meeting gate page.
// Given an appointment_id, returns the fields a public landing page needs to
// decide host vs guest and pre-fill the form (room_name, title, start_time,
// contact name/email, workspace_id). Does NOT return any sensitive token.
//
// Public on purpose (no JWT verify): a meeting URL is by definition shareable
// — same threat model as the existing /meeting/:roomName page.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const appointmentId = String(body?.appointment_id || "").trim();

    if (!appointmentId || !UUID_RE.test(appointmentId)) {
      return new Response(JSON.stringify({ error: "invalid_appointment_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: appt, error } = await supabaseAdmin
      .from("crm_appointments")
      .select(
        "id, workspace_id, title, start_time, daily_room_name, daily_room_url, meeting_type, contact_id, meeting_started_at, meeting_ended_at",
      )
      .eq("id", appointmentId)
      .maybeSingle();

    if (error || !appt) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!appt.daily_room_name) {
      return new Response(JSON.stringify({ error: "no_daily_room" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let contact: { name: string | null; email: string | null } | null = null;
    if (appt.contact_id) {
      const { data: c } = await supabaseAdmin
        .from("crm_contacts")
        .select("name, email")
        .eq("id", appt.contact_id)
        .maybeSingle();
      contact = c ? { name: c.name ?? null, email: c.email ?? null } : null;
    }

    return new Response(
      JSON.stringify({
        appointment: {
          id: appt.id,
          workspace_id: appt.workspace_id,
          title: appt.title,
          start_time: appt.start_time,
          room_name: appt.daily_room_name,
          meeting_type: appt.meeting_type,
          meeting_started_at: appt.meeting_started_at,
          meeting_ended_at: appt.meeting_ended_at,
        },
        contact,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[meeting-gate-info] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
