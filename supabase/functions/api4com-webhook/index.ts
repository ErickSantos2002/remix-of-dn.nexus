import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-company-id",
};

function mapHangupToStatus(cause: string | null | undefined, duration: number): string {
  if (!cause) return duration > 0 ? "completed" : "failed";
  const c = cause.toUpperCase();
  if (c === "NORMAL_CLEARING") return duration > 5 ? "completed" : "no_answer";
  if (c === "USER_BUSY") return "busy";
  if (c.includes("NO_ANSWER") || c === "NO_USER_RESPONSE" || c === "NORMAL_TEMPORARY_FAILURE") return "no_answer";
  if (c === "ORIGINATOR_CANCEL" || c === "CANCEL") return "cancelled";
  return "failed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    console.log("[api4com-webhook] payload:", JSON.stringify(body).slice(0, 500));

    // api4com may send under various shapes; try to be tolerant
    const eventType = body.eventType || body.event || body.type;
    const data = body.data || body.payload || body;
    const metadata = data.metadata || body.metadata || {};

    if (eventType !== "channel-hangup") {
      console.log("[api4com-webhook] ignored event:", eventType);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callId: string | null = metadata.call_id || null;
    const companyIdMeta: string | null = metadata.company_id || null;
    const gatewayMeta: string | null = metadata.gateway || null;
    const webhookSecretMeta: string | null = metadata.webhook_secret || req.headers.get("x-webhook-secret");

    if (!callId || !companyIdMeta) {
      console.error("[api4com-webhook] missing call_id or company_id in metadata");
      return new Response(JSON.stringify({ error: "Missing metadata.call_id or metadata.company_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Validate company secret + gateway
    const { data: company } = await admin.from("companies")
      .select("api4com_webhook_secret, api4com_webhook_gateway_id")
      .eq("id", companyIdMeta).single();

    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (company.api4com_webhook_secret && webhookSecretMeta !== company.api4com_webhook_secret) {
      console.warn("[api4com-webhook] invalid webhook secret");
      return new Response(JSON.stringify({ error: "Invalid webhook secret" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (company.api4com_webhook_gateway_id && gatewayMeta && gatewayMeta !== company.api4com_webhook_gateway_id) {
      console.warn("[api4com-webhook] gateway mismatch");
      return new Response(JSON.stringify({ error: "Gateway mismatch" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Extract fields
    const duration = Number(data.duration || data.billsec || data.callDuration || 0);
    const hangupCause = data.hangupCause || data.hangup_cause || data.cause || null;
    const hangupCauseCode = data.hangupCauseCode || data.causeCode || null;
    const recordUrl = data.recordUrl || data.recordingUrl || data.record_url || data.recording_url || null;
    const api4comCallId = data.callId || data.call_id || data.uuid || null;
    const answeredAt = data.answeredAt || data.answer_time || null;
    const startedAt = data.startedAt || data.start_time || null;
    const endedAt = data.endedAt || data.end_time || new Date().toISOString();

    const newStatus = mapHangupToStatus(hangupCause, duration);

    // Update call
    const { data: updatedCall, error: updErr } = await admin.from("calls").update({
      status: newStatus,
      duration_seconds: duration,
      hangup_cause: hangupCause,
      hangup_cause_code: hangupCauseCode,
      record_url: recordUrl,
      api4com_call_id: api4comCallId,
      answered_at: answeredAt,
      ended_at: endedAt,
      ...(startedAt ? { started_at: startedAt } : {}),
      transcription_status: recordUrl ? "pending" : "skipped",
    }).eq("id", callId).select("id, activity_id, workspace_id, company_id").single();

    if (updErr || !updatedCall) {
      console.error("[api4com-webhook] update error:", updErr);
      return new Response(JSON.stringify({ error: "Failed to update call" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mark activity completed if successful call > 5s
    if (updatedCall.activity_id && newStatus === "completed") {
      await admin.from("crm_lead_activities").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        duration_minutes: Math.max(1, Math.round(duration / 60)),
      }).eq("id", updatedCall.activity_id);
    }

    // Trigger transcription async (fire and forget)
    if (recordUrl) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/api4com-transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ call_id: callId }),
      }).catch((e) => console.error("[api4com-webhook] transcribe enqueue error:", e));
    }

    return new Response(JSON.stringify({ ok: true, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api4com-webhook] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
