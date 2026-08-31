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
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function looksEncrypted(str: string): boolean {
  try {
    const decoded = atob(str);
    return decoded.length >= 44;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[ZAPI-HEALTH] Starting health check");

    // Buscar todas as conexoes ativas
    const { data: connections, error: connError } = await supabase
      .from("zapi_connections")
      .select("id, instance_id, api_token, workspace_id, zapi_connected")
      .eq("is_active", true);

    if (connError) {
      console.error("[ZAPI-HEALTH] Error fetching connections:", connError);
      throw new Error("Failed to fetch connections");
    }

    if (!connections || connections.length === 0) {
      console.log("[ZAPI-HEALTH] No active connections to check");
      return new Response(
        JSON.stringify({ success: true, checked: 0, message: "No active connections" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ZAPI-HEALTH] Checking ${connections.length} active connection(s)`);

    const results = { checked: 0, connected: 0, disconnected: 0, errors: 0, changed: 0 };

    // Cache de company_id e tokens por workspace para evitar queries repetidas
    const companyCache: Record<string, { companyId: string; accountToken: string }> = {};

    for (const conn of connections) {
      try {
        // Buscar company_id via workspace (com cache)
        let cached = companyCache[conn.workspace_id];
        if (!cached) {
          const { data: workspace } = await supabase
            .from("workspaces")
            .select("company_id")
            .eq("id", conn.workspace_id)
            .single();

          if (!workspace?.company_id) {
            console.warn(`[ZAPI-HEALTH] No company found for workspace ${conn.workspace_id}`);
            results.errors++;
            continue;
          }

          const { data: company } = await supabase
            .from("companies")
            .select("id, zapi_account_token")
            .eq("id", workspace.company_id)
            .single();

          if (!company?.zapi_account_token) {
            console.warn(`[ZAPI-HEALTH] No account token for company ${workspace.company_id}`);
            results.errors++;
            continue;
          }

          const accountToken = await decryptTokenDeno(company.zapi_account_token, company.id);
          cached = { companyId: company.id, accountToken };
          companyCache[conn.workspace_id] = cached;
        }

        // Decriptar instance_id e api_token
        const instanceId = looksEncrypted(conn.instance_id)
          ? await decryptTokenDeno(conn.instance_id, cached.companyId)
          : conn.instance_id;

        const apiToken = looksEncrypted(conn.api_token)
          ? await decryptTokenDeno(conn.api_token, cached.companyId)
          : conn.api_token;

        // Chamar Z-API /me
        const response = await fetch(
          `https://api.z-api.io/instances/${instanceId}/token/${apiToken}/me`,
          {
            method: "GET",
            headers: { "Client-Token": cached.accountToken },
          }
        );

        if (!response.ok) {
          console.warn(`[ZAPI-HEALTH] Z-API returned ${response.status} for connection ${conn.id}`);
          // Se Z-API retornou erro, marcar como desconectada
          await supabase.from("zapi_connections").update({
            zapi_connected: false,
            zapi_validated_at: new Date().toISOString(),
          }).eq("id", conn.id);

          results.checked++;
          results.disconnected++;
          if (conn.zapi_connected !== false) results.changed++;
          continue;
        }

        const data = await response.json();
        const isConnected = data.connected ?? false;
        const previousStatus = conn.zapi_connected;

        // Atualizar status
        await supabase.from("zapi_connections").update({
          zapi_connected: isConnected,
          zapi_payment_status: data.paymentStatus || null,
          zapi_due: data.due ? new Date(data.due).toISOString() : null,
          zapi_validated_at: new Date().toISOString(),
        }).eq("id", conn.id);

        results.checked++;
        if (isConnected) {
          results.connected++;
        } else {
          results.disconnected++;
        }

        // Detectar mudanca de status
        if (previousStatus !== isConnected) {
          results.changed++;
          console.log(`[ZAPI-HEALTH] Connection ${conn.id} status changed: ${previousStatus} -> ${isConnected}`);
        }
      } catch (err) {
        console.error(`[ZAPI-HEALTH] Error checking connection ${conn.id}:`, err instanceof Error ? err.message : err);
        results.errors++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[ZAPI-HEALTH] Done in ${elapsed}ms:`, results);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        processing_time_ms: elapsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ZAPI-HEALTH] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
