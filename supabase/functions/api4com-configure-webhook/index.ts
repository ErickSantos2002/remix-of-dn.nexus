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

function generateSecret(len = 48): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: company } = await admin
      .from("companies")
      .select("api4com_token_encrypted, api4com_webhook_secret, api4com_webhook_gateway_id")
      .eq("id", company_id)
      .single();

    if (!company?.api4com_token_encrypted) {
      return new Response(JSON.stringify({ error: "Token nao configurado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = await decryptToken(company.api4com_token_encrypted, company_id);
    const webhookSecret = company.api4com_webhook_secret || generateSecret();
    // Gateway: prefixo curto + 12 chars do hex do company_id (sem hífens).
    // Testes mostram que `nexus-<UUID-completo>` causa 500 na api4com (provavelmente regex/length).
    const gatewayId = company.api4com_webhook_gateway_id || `nexus${company_id.replace(/-/g, "").slice(0, 12)}`;
    const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/api4com-webhook`;

    const headers = {
      Authorization: token,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // 1) GET existing integrations — api4com requires the existing `id` on update.
    // Sending no id (or id:0) when the integration exists returns 422
    // "User integration already exists, please send ID to update".
    let existingId: number | null = null;
    try {
      const listRes = await fetch("https://api.api4com.com/api/v1/integrations", {
        method: "GET",
        headers,
      });
      if (listRes.ok) {
        const listJson = await listRes.json();
        const arr: unknown[] = Array.isArray(listJson)
          ? listJson
          : Array.isArray((listJson as { integrations?: unknown[] })?.integrations)
            ? (listJson as { integrations: unknown[] }).integrations
            : Array.isArray((listJson as { data?: unknown[] })?.data)
              ? (listJson as { data: unknown[] }).data
              : [];
        // Try matching by gateway first; fallback to first item (account scoped).
        const match = arr.find((it) => {
          const g = (it as { gateway?: string })?.gateway;
          return typeof g === "string" && g === gatewayId;
        }) || arr[0];
        const idVal = (match as { id?: number | string } | undefined)?.id;
        if (idVal !== undefined && idVal !== null) {
          const n = typeof idVal === "string" ? parseInt(idVal, 10) : idVal;
          if (Number.isFinite(n) && n > 0) existingId = n as number;
        }
      } else {
        console.warn("[api4com-configure-webhook] GET /integrations status", listRes.status);
      }
    } catch (e) {
      console.warn("[api4com-configure-webhook] GET /integrations failed:", e);
    }

    const integrationsBody: Record<string, unknown> = {
      ...(existingId !== null ? { id: existingId } : {}),
      gateway: gatewayId,
      webhook: true,
      webhookConstraint: { gateway: gatewayId },
      metadata: {
        webhookUrl,
        webhookVersion: "1.8",
        webhookTypes: ["channel-answer", "channel-hangup"],
      },
    };

    // PATCH /integrations (update when id present, create when absent)
    const res = await fetch("https://api.api4com.com/api/v1/integrations", {
      method: "PATCH",
      headers,
      body: JSON.stringify(integrationsBody),
    });
    const respText = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(respText); } catch { /* ignore */ }

    if (!res.ok) {
      console.error("[api4com-configure-webhook] PATCH /integrations failed:", res.status, respText);
      return new Response(JSON.stringify({
        success: false,
        status: res.status,
        error: parsed || respText,
        request: integrationsBody,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("companies").update({
      api4com_webhook_secret: webhookSecret,
      api4com_webhook_gateway_id: gatewayId,
      api4com_webhook_configured_at: new Date().toISOString(),
      api4com_is_active: true,
    }).eq("id", company_id);

    return new Response(JSON.stringify({ success: true, gateway_id: gatewayId, webhook_url: webhookUrl, integration: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api4com-configure-webhook] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
