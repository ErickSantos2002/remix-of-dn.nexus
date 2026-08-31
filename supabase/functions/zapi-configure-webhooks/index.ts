import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function decryptTokenDeno(encrypted: string, passphrase: string): Promise<string> {
  const raw = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = raw.slice(0, SALT_LENGTH);
  const iv = raw.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = raw.slice(SALT_LENGTH + IV_LENGTH);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

const WEBHOOK_ENDPOINTS = [
  { key: "received", path: "update-webhook-received", label: "Mensagem recebida" },
  { key: "delivery", path: "update-webhook-delivery", label: "Mensagem enviada" },
  { key: "message-status", path: "update-webhook-message-status", label: "Status (entregue/lido)" },
  { key: "chat-presence", path: "update-webhook-chat-presence", label: "Presença" },
  { key: "connected", path: "update-webhook-connected", label: "Conectado" },
  { key: "disconnected", path: "update-webhook-disconnected", label: "Desconectado" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const connection_id: string | undefined = body?.connection_id;
    const only: string[] | undefined = Array.isArray(body?.only) ? body.only : undefined;

    if (!connection_id) {
      return new Response(
        JSON.stringify({ success: false, error: "connection_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Buscar conexão
    const { data: conn, error: connErr } = await supabase
      .from("zapi_connections")
      .select("id, instance_id, api_token, workspace_id")
      .eq("id", connection_id)
      .single();

    if (connErr || !conn) {
      return new Response(
        JSON.stringify({ success: false, error: "Conexão não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolver company_id via workspace
    const { data: ws } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", conn.workspace_id)
      .single();

    if (!ws?.company_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Empresa da conexão não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Buscar account token da empresa
    const { data: company } = await supabase
      .from("companies")
      .select("zapi_account_token")
      .eq("id", ws.company_id)
      .single();

    if (!company?.zapi_account_token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Empresa não tem Account Security Token configurado",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Descriptografar credenciais (com fallback para conexões legadas em texto puro)
    const looksEncrypted = (str: string): boolean => {
      try {
        return atob(str).length >= 44;
      } catch {
        return false;
      }
    };
    const tryDecrypt = async (value: string, passphrase: string): Promise<string> => {
      if (!looksEncrypted(value)) return value;
      try {
        return await decryptTokenDeno(value, passphrase);
      } catch (e) {
        console.warn("[ZAPI-CONFIGURE-WEBHOOKS] decrypt failed, using raw value:", e);
        return value;
      }
    };

    const instanceId = await tryDecrypt(conn.instance_id, ws.company_id);
    const apiToken = await tryDecrypt(conn.api_token, ws.company_id);
    const clientToken = await tryDecrypt(company.zapi_account_token, ws.company_id);


    const webhookUrl = `${supabaseUrl}/functions/v1/zapi-webhook`;
    const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${apiToken}`;

    const targets = only
      ? WEBHOOK_ENDPOINTS.filter((w) => only.includes(w.key))
      : WEBHOOK_ENDPOINTS;

    const results: Array<{ key: string; label: string; ok: boolean; error?: string }> = [];

    for (const wh of targets) {
      try {
        const resp = await fetch(`${baseUrl}/${wh.path}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Client-Token": clientToken,
          },
          body: JSON.stringify({ value: webhookUrl }),
        });

        if (!resp.ok) {
          const txt = await resp.text();
          console.error(`[ZAPI-CONFIGURE-WEBHOOKS] ${wh.key} failed:`, resp.status, txt);
          results.push({ key: wh.key, label: wh.label, ok: false, error: `HTTP ${resp.status}: ${txt}` });
        } else {
          results.push({ key: wh.key, label: wh.label, ok: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        console.error(`[ZAPI-CONFIGURE-WEBHOOKS] ${wh.key} error:`, msg);
        results.push({ key: wh.key, label: wh.label, ok: false, error: msg });
      }
    }

    const configured = results.filter((r) => r.ok).length;
    const failed = results.length - configured;

    return new Response(
      JSON.stringify({
        success: failed === 0,
        webhook_url: webhookUrl,
        configured,
        failed,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[ZAPI-CONFIGURE-WEBHOOKS] fatal:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
