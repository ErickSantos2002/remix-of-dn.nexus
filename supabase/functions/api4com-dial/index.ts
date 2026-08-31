import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
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

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    digits = "55" + digits;
  }
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub;

    const { workspace_id, lead_id, contact_id, activity_id, phone } = await req.json();

    if (!workspace_id || !lead_id || !phone) {
      return new Response(JSON.stringify({ error: "workspace_id, lead_id and phone are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get workspace -> company
    const { data: workspace } = await admin.from("workspaces").select("company_id").eq("id", workspace_id).single();
    if (!workspace?.company_id) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const companyId = workspace.company_id;

    // Get company config
    const { data: company } = await admin.from("companies")
      .select("api4com_token_encrypted, api4com_webhook_secret, api4com_webhook_gateway_id, api4com_is_active")
      .eq("id", companyId).single();

    if (!company?.api4com_token_encrypted || !company.api4com_is_active) {
      return new Response(JSON.stringify({ error: "Integracao api4com nao configurada para esta empresa" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get user extension
    const { data: profile } = await admin.from("profiles").select("api4com_extension, name").eq("id", userId).single();
    if (!profile?.api4com_extension) {
      return new Response(JSON.stringify({ success: false, error: "Ramal nao configurado para o usuario. Configure em Time > Editar Membro.", code: "EXTENSION_NOT_CONFIGURED" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await decryptToken(company.api4com_token_encrypted, companyId);
    const phoneCalled = normalizePhone(phone);

    // Insert call record (initiated)
    const { data: call, error: callErr } = await admin.from("calls").insert({
      company_id: companyId,
      workspace_id,
      activity_id: activity_id || null,
      lead_id,
      contact_id: contact_id || null,
      user_id: userId,
      extension: profile.api4com_extension,
      phone_called: phoneCalled,
      status: "initiated",
      started_at: new Date().toISOString(),
      metadata: {},
    }).select("id").single();

    if (callErr || !call) {
      console.error("[api4com-dial] failed to insert call:", callErr);
      return new Response(JSON.stringify({ error: "Falha ao registrar chamada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST /dialer
    const dialerBody = {
      extension: profile.api4com_extension,
      phone: `+${phoneCalled}`,
      metadata: {
        gateway: company.api4com_webhook_gateway_id,
        company_id: companyId,
        call_id: call.id,
        webhook_secret: company.api4com_webhook_secret,
      },
    };

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10000);
    let dialRes: Response;
    let dialText = "";
    try {
      dialRes = await fetch("https://api.api4com.com/api/v1/dialer", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(dialerBody),
        signal: ctrl.signal,
      });
      dialText = await dialRes.text();
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const isAbort = (fetchErr as Error)?.name === "AbortError";
      const errMsg = isAbort ? "Tempo esgotado ao contactar api4com (15s)" : ((fetchErr as Error)?.message || "Falha de rede ao contactar api4com");
      console.error("[api4com-dial] fetch failed:", errMsg);
      await admin.from("calls").update({
        status: "failed",
        ended_at: new Date().toISOString(),
        metadata: { dialer_error: errMsg },
      }).eq("id", call.id);
      return new Response(JSON.stringify({ success: false, error: errMsg, call_id: call.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    clearTimeout(timeoutId);
    let dialParsed: unknown = null;
    try { dialParsed = JSON.parse(dialText); } catch { /* ignore */ }

    if (!dialRes.ok) {
      console.error("[api4com-dial] api4com error", {
        status: dialRes.status,
        body: dialText,
        sent: dialerBody,
      });
      await admin.from("calls").update({
        status: "failed",
        ended_at: new Date().toISOString(),
        metadata: { dialer_error: dialParsed || dialText, status: dialRes.status, sent: dialerBody },
      }).eq("id", call.id);

      return new Response(JSON.stringify({ success: false, status: dialRes.status, error: dialParsed || dialText, call_id: call.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dialResponseId = (dialParsed as { id?: string; uuid?: string; call_id?: string })?.id
      || (dialParsed as { uuid?: string })?.uuid
      || (dialParsed as { call_id?: string })?.call_id
      || null;

    await admin.from("calls").update({
      dialer_response_id: dialResponseId,
      status: "ringing",
      metadata: { dialer_response: dialParsed },
    }).eq("id", call.id);

    // Update activity last_call_id
    if (activity_id) {
      await admin.from("crm_lead_activities").update({ last_call_id: call.id }).eq("id", activity_id);
    }

    return new Response(JSON.stringify({ success: true, call_id: call.id, dialer_response: dialParsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api4com-dial] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
