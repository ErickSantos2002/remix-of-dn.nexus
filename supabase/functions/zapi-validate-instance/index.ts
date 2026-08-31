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

async function configureWebhooks(
  instanceId: string,
  apiToken: string,
  clientToken: string,
  supabaseUrl: string
): Promise<{ success: boolean; errors: string[]; configured: number }> {
  const webhookUrl = `${supabaseUrl}/functions/v1/zapi-webhook`;
  const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${apiToken}`;

  const webhookEndpoints = [
    "update-webhook-received",
    "update-webhook-delivery",
    "update-webhook-message-status",
    "update-webhook-chat-presence",
    "update-webhook-disconnected",
    "update-webhook-connected",
  ];

  const errors: string[] = [];
  let configured = 0;

  console.log("[ZAPI-VALIDATE-INSTANCE] Configuring webhooks to:", webhookUrl);

  for (const endpoint of webhookEndpoints) {
    try {
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Client-Token": clientToken,
        },
        body: JSON.stringify({ value: webhookUrl }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ZAPI-VALIDATE-INSTANCE] Webhook ${endpoint} failed:`, errorText);
        errors.push(`${endpoint}: ${errorText}`);
      } else {
        configured++;
        console.log(`[ZAPI-VALIDATE-INSTANCE] Webhook ${endpoint} configured successfully`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[ZAPI-VALIDATE-INSTANCE] Webhook ${endpoint} error:`, errorMsg);
      errors.push(`${endpoint}: ${errorMsg}`);
    }
  }

  return { success: errors.length === 0, errors, configured };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { instance_id, api_token, company_id, connection_id } = await req.json();

    console.log("[ZAPI-VALIDATE-INSTANCE] Request:", { instance_id, company_id, connection_id: connection_id ? "provided" : "not provided" });

    // Modo de revalidacao: connection_id fornecido
    if (connection_id && company_id) {
      console.log("[ZAPI-VALIDATE-INSTANCE] Revalidation mode for connection:", connection_id);

      // Buscar conexao existente
      const { data: connection, error: connectionError } = await supabase
        .from("zapi_connections")
        .select("id, instance_id, api_token, workspace_id")
        .eq("id", connection_id)
        .single();

      if (connectionError || !connection) {
        console.error("[ZAPI-VALIDATE-INSTANCE] Connection not found:", connectionError);
        return new Response(
          JSON.stringify({ valid: false, error: "Conexao nao encontrada" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Buscar company e descriptografar zapi_account_token
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("zapi_account_token")
        .eq("id", company_id)
        .single();

      if (companyError || !company) {
        console.error("[ZAPI-VALIDATE-INSTANCE] Company not found:", companyError);
        return new Response(
          JSON.stringify({ valid: false, error: "Empresa nao encontrada" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!company.zapi_account_token) {
        return new Response(
          JSON.stringify({ valid: false, error: "Configure o Token de Seguranca da Conta Z-API primeiro em Configuracoes da Empresa" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Helper to check if a string looks like encrypted data (base64 with salt+iv prefix)
      const looksEncrypted = (str: string): boolean => {
        try {
          const decoded = atob(str);
          // Minimum size: 16 (salt) + 12 (iv) + 16 (min ciphertext) = 44 bytes
          return decoded.length >= 44;
        } catch {
          return false;
        }
      };

      // Descriptografar tokens
      // instance_id e armazenado em texto plano (necessario para busca do webhook)
      // api_token e criptografado (with legacy plain text fallback)
      let clientToken: string;
      let decryptedInstanceId: string;
      let decryptedApiToken: string;

      try {
        clientToken = await decryptTokenDeno(company.zapi_account_token, company_id);

        if (looksEncrypted(connection.instance_id)) {
          decryptedInstanceId = await decryptTokenDeno(connection.instance_id, company_id);
          console.log("[ZAPI-VALIDATE-INSTANCE] Decrypted instance_id");
        } else {
          decryptedInstanceId = connection.instance_id;
          console.log("[ZAPI-VALIDATE-INSTANCE] Using plain text instance_id (legacy)");
        }

        if (looksEncrypted(connection.api_token)) {
          decryptedApiToken = await decryptTokenDeno(connection.api_token, company_id);
          console.log("[ZAPI-VALIDATE-INSTANCE] Decrypted api_token");
        } else {
          decryptedApiToken = connection.api_token;
          console.log("[ZAPI-VALIDATE-INSTANCE] Using plain text api_token (legacy)");
        }
      } catch (decryptError) {
        console.error("[ZAPI-VALIDATE-INSTANCE] Decrypt error:", decryptError);
        return new Response(
          JSON.stringify({ valid: false, error: "Erro ao descriptografar tokens. Reconfigure a conexao." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Chamar /me da Z-API
      const zapiUrl = `https://api.z-api.io/instances/${decryptedInstanceId}/token/${decryptedApiToken}/me`;
      console.log("[ZAPI-VALIDATE-INSTANCE] Calling Z-API for revalidation");

      const response = await fetch(zapiUrl, {
        method: "GET",
        headers: { "Client-Token": clientToken },
      });

      const responseText = await response.text();
      console.log("[ZAPI-VALIDATE-INSTANCE] Z-API response:", response.status);

      if (!response.ok) {
        let errorMessage = "Credenciais invalidas";
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {}

        return new Response(
          JSON.stringify({ valid: false, error: errorMessage }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const zapiData = JSON.parse(responseText);

      // Atualizar conexao no banco com dados atualizados
      const { error: updateError } = await supabase
        .from("zapi_connections")
        .update({
          zapi_instance_name: zapiData.name,
          zapi_due: zapiData.due ? new Date(zapiData.due).toISOString() : null,
          zapi_connected: zapiData.connected,
          zapi_payment_status: zapiData.paymentStatus,
          zapi_validated_at: new Date().toISOString(),
        })
        .eq("id", connection_id);

      if (updateError) {
        console.error("[ZAPI-VALIDATE-INSTANCE] Update error:", updateError);
        return new Response(
          JSON.stringify({ valid: false, error: "Erro ao atualizar conexao" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Configurar webhooks automaticamente
      const webhookResult = await configureWebhooks(
        decryptedInstanceId,
        decryptedApiToken,
        clientToken,
        supabaseUrl
      );

      if (!webhookResult.success) {
        console.warn("[ZAPI-VALIDATE-INSTANCE] Some webhooks failed:", webhookResult.errors);
      }

      return new Response(
        JSON.stringify({
          valid: true,
          data: {
            id: zapiData.id,
            name: zapiData.name,
            due: zapiData.due,
            connected: zapiData.connected,
            paymentStatus: zapiData.paymentStatus,
            created: zapiData.created,
          },
          connection: {
            zapi_instance_name: zapiData.name,
            zapi_due: zapiData.due ? new Date(zapiData.due).toISOString() : null,
            zapi_connected: zapiData.connected,
            zapi_payment_status: zapiData.paymentStatus,
            zapi_validated_at: new Date().toISOString(),
          },
          webhooks: {
            configured: webhookResult.configured,
            total: 6,
            success: webhookResult.success,
            errors: webhookResult.errors,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Modo de validacao inicial: instance_id e api_token fornecidos
    if (!instance_id || !api_token || !company_id) {
      return new Response(
        JSON.stringify({ valid: false, error: "Parametros obrigatorios: instance_id, api_token, company_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ZAPI-VALIDATE-INSTANCE] Initial validation mode for instance:", instance_id);

    // Buscar company e descriptografar zapi_account_token
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("zapi_account_token")
      .eq("id", company_id)
      .single();

    if (companyError || !company) {
      console.error("[ZAPI-VALIDATE-INSTANCE] Company not found:", companyError);
      return new Response(
        JSON.stringify({ valid: false, error: "Empresa nao encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!company.zapi_account_token) {
      return new Response(
        JSON.stringify({ valid: false, error: "Configure o Token de Seguranca da Conta Z-API primeiro em Configuracoes da Empresa" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Descriptografar o token da conta
    let clientToken: string;
    try {
      clientToken = await decryptTokenDeno(company.zapi_account_token, company_id);
    } catch (decryptError) {
      console.error("[ZAPI-VALIDATE-INSTANCE] Decrypt error:", decryptError);
      return new Response(
        JSON.stringify({ valid: false, error: "Erro ao descriptografar token da conta. Reconfigure o token em Configuracoes da Empresa." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Chamar /me da Z-API
    const zapiUrl = `https://api.z-api.io/instances/${instance_id}/token/${api_token}/me`;
    console.log("[ZAPI-VALIDATE-INSTANCE] Calling Z-API:", zapiUrl);

    const response = await fetch(zapiUrl, {
      method: "GET",
      headers: {
        "Client-Token": clientToken,
      },
    });

    const responseText = await response.text();
    console.log("[ZAPI-VALIDATE-INSTANCE] Z-API response:", response.status, responseText);

    if (!response.ok) {
      let errorMessage = "Credenciais invalidas";
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error) errorMessage = errorData.error;
      } catch {}

      return new Response(
        JSON.stringify({ valid: false, error: errorMessage }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = JSON.parse(responseText);

    return new Response(
      JSON.stringify({
        valid: true,
        data: {
          id: data.id,
          name: data.name,
          due: data.due,
          connected: data.connected,
          paymentStatus: data.paymentStatus,
          created: data.created,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ZAPI-VALIDATE-INSTANCE] Error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
