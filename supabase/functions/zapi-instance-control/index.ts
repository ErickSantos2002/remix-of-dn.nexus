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

const looksEncrypted = (str: string): boolean => {
  try {
    const decoded = atob(str);
    return decoded.length >= 44;
  } catch {
    return false;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { connection_id, company_id, action, profile_name, profile_description, profile_picture_url, call_reject_auto, call_reject_message, instance_name } = await req.json();

    console.log("[ZAPI-INSTANCE-CONTROL] Request:", { connection_id, company_id, action });

    if (!connection_id || !company_id || !action) {
      return new Response(
        JSON.stringify({ success: false, error: "Parametros obrigatorios: connection_id, company_id, action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validActions = ["disconnect", "qrcode", "status", "get-profile", "update-profile-name", "update-profile-description", "update-profile-picture", "update-call-reject-auto", "update-call-reject-message", "rename-instance"];
    if (!validActions.includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: `Acao invalida. Use: ${validActions.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar conexao
    const { data: connection, error: connectionError } = await supabase
      .from("zapi_connections")
      .select("id, instance_id, api_token, workspace_id")
      .eq("id", connection_id)
      .single();

    if (connectionError || !connection) {
      console.error("[ZAPI-INSTANCE-CONTROL] Connection not found:", connectionError);
      return new Response(
        JSON.stringify({ success: false, error: "Conexao nao encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar company e token
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("zapi_account_token")
      .eq("id", company_id)
      .single();

    if (companyError || !company) {
      console.error("[ZAPI-INSTANCE-CONTROL] Company not found:", companyError);
      return new Response(
        JSON.stringify({ success: false, error: "Empresa nao encontrada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!company.zapi_account_token) {
      return new Response(
        JSON.stringify({ success: false, error: "Configure o Token de Seguranca da Conta Z-API primeiro" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Descriptografar tokens
    // instance_id e armazenado em texto plano (necessario para busca do webhook)
    // api_token e criptografado
    let clientToken: string;
    let decryptedInstanceId: string;
    let decryptedApiToken: string;

    try {
      clientToken = await decryptTokenDeno(company.zapi_account_token, company_id);

      // instance_id is stored in plain text (needed for webhook lookup)
      decryptedInstanceId = connection.instance_id;

      if (looksEncrypted(connection.api_token)) {
        decryptedApiToken = await decryptTokenDeno(connection.api_token, company_id);
      } else {
        decryptedApiToken = connection.api_token;
      }
    } catch (decryptError) {
      console.error("[ZAPI-INSTANCE-CONTROL] Decrypt error:", decryptError);
      return new Response(
        JSON.stringify({ success: false, error: "Erro ao descriptografar tokens" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = `https://api.z-api.io/instances/${decryptedInstanceId}/token/${decryptedApiToken}`;
    const headers = {
      "Content-Type": "application/json",
      "Client-Token": clientToken,
    };

    // Executar acao
    if (action === "disconnect") {
      console.log("[ZAPI-INSTANCE-CONTROL] Disconnecting instance");

      const response = await fetch(`${baseUrl}/disconnect`, {
        method: "GET",
        headers,
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Disconnect response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao desconectar instancia" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualizar status no banco
      await supabase
        .from("zapi_connections")
        .update({ zapi_connected: false })
        .eq("id", connection_id);

      return new Response(
        JSON.stringify({ success: true, message: "Instancia desconectada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "qrcode") {
      console.log("[ZAPI-INSTANCE-CONTROL] Getting QR code");

      const response = await fetch(`${baseUrl}/qr-code/image`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[ZAPI-INSTANCE-CONTROL] QR code error:", response.status, errorText);

        // Se ja estiver conectado, retornar mensagem apropriada
        if (errorText.includes("already connected") || errorText.includes("ja conectado")) {
          return new Response(
            JSON.stringify({ success: false, error: "Instancia ja esta conectada", alreadyConnected: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ success: false, error: "Erro ao gerar QR code" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      console.log("[ZAPI-INSTANCE-CONTROL] QR code response data:", JSON.stringify(data));

      // Extrair o QR code - Z-API pode retornar em diferentes campos
      const qrcodeValue = data.value || data.qrcode || data.base64 ||
        (typeof data === 'string' ? data : null);

      if (!qrcodeValue || typeof qrcodeValue !== 'string') {
        console.error("[ZAPI-INSTANCE-CONTROL] QR code data is not a string:", typeof qrcodeValue, JSON.stringify(data));
        return new Response(
          JSON.stringify({ success: false, error: "Formato de QR Code inesperado" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, qrcode: qrcodeValue }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
      console.log("[ZAPI-INSTANCE-CONTROL] Getting instance status");

      const response = await fetch(`${baseUrl}/status`, {
        method: "GET",
        headers,
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Status response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao obter status da instancia" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = JSON.parse(responseText);

      // Atualizar status no banco se mudou
      if (data.connected !== undefined) {
        await supabase
          .from("zapi_connections")
          .update({ zapi_connected: data.connected })
          .eq("id", connection_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          connected: data.connected,
          smartphoneConnected: data.smartphoneConnected,
          error: data.error,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar dados do perfil
    if (action === "get-profile") {
      console.log("[ZAPI-INSTANCE-CONTROL] Getting profile data");

      // Buscar dados do dispositivo/perfil
      const deviceResponse = await fetch(`${baseUrl}/device`, {
        method: "GET",
        headers,
      });

      let deviceData = null;
      if (deviceResponse.ok) {
        const deviceText = await deviceResponse.text();
        try {
          deviceData = JSON.parse(deviceText);
          console.log("[ZAPI-INSTANCE-CONTROL] Device data:", deviceData);
        } catch {
          console.log("[ZAPI-INSTANCE-CONTROL] Could not parse device data");
        }
      }

      // Buscar dados da instancia
      const meResponse = await fetch(`${baseUrl}/me`, {
        method: "GET",
        headers,
      });

      let meData = null;
      if (meResponse.ok) {
        const meText = await meResponse.text();
        try {
          meData = JSON.parse(meText);
          console.log("[ZAPI-INSTANCE-CONTROL] Instance data:", meData);
        } catch {
          console.log("[ZAPI-INSTANCE-CONTROL] Could not parse instance data");
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          profile: {
            name: deviceData?.name || meData?.name || null,
            description: deviceData?.description || deviceData?.status || null,
            phone: deviceData?.phone || null,
            imgUrl: deviceData?.imgUrl || deviceData?.profilePicture || null,
          },
          device: deviceData,
          instance: meData,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar nome do perfil
    if (action === "update-profile-name") {
      if (!profile_name) {
        return new Response(
          JSON.stringify({ success: false, error: "Parametro profile_name obrigatorio" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Updating profile name:", profile_name);

      const response = await fetch(`${baseUrl}/profile-name`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: profile_name }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Profile name response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao atualizar nome do perfil" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Nome do perfil atualizado com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar descricao do perfil
    if (action === "update-profile-description") {
      if (profile_description === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: "Parametro profile_description obrigatorio" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Updating profile description");

      const response = await fetch(`${baseUrl}/profile-description`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: profile_description }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Profile description response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao atualizar descrição do perfil" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Descrição do perfil atualizada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar foto do perfil
    if (action === "update-profile-picture") {
      if (!profile_picture_url) {
        return new Response(
          JSON.stringify({ success: false, error: "Parametro profile_picture_url obrigatorio" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Updating profile picture");

      const response = await fetch(`${baseUrl}/profile-picture`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: profile_picture_url }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Profile picture response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao atualizar foto do perfil" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Foto do perfil atualizada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar rejeição automática de chamadas
    if (action === "update-call-reject-auto") {
      if (call_reject_auto === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: "Parâmetro call_reject_auto obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Updating call reject auto:", call_reject_auto);

      const response = await fetch(`${baseUrl}/update-call-reject-auto`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: call_reject_auto }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Call reject auto response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao atualizar rejeição de chamadas" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualizar no banco de dados
      await supabase
        .from("zapi_connections")
        .update({ call_reject_auto: call_reject_auto })
        .eq("id", connection_id);

      return new Response(
        JSON.stringify({ success: true, message: "Rejeição de chamadas atualizada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atualizar mensagem de rejeição de chamadas
    if (action === "update-call-reject-message") {
      if (call_reject_message === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: "Parâmetro call_reject_message obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Updating call reject message");

      const response = await fetch(`${baseUrl}/update-call-reject-message`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: call_reject_message }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Call reject message response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao atualizar mensagem de rejeição" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualizar no banco de dados
      await supabase
        .from("zapi_connections")
        .update({ call_reject_message: call_reject_message })
        .eq("id", connection_id);

      return new Response(
        JSON.stringify({ success: true, message: "Mensagem de rejeição atualizada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Renomear instância
    if (action === "rename-instance") {
      if (!instance_name) {
        return new Response(
          JSON.stringify({ success: false, error: "Parâmetro instance_name obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[ZAPI-INSTANCE-CONTROL] Renaming instance:", instance_name);

      const response = await fetch(`${baseUrl}/update-name`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: instance_name }),
      });

      const responseText = await response.text();
      console.log("[ZAPI-INSTANCE-CONTROL] Rename instance response:", response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ success: false, error: "Erro ao renomear instância" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atualizar no banco de dados
      await supabase
        .from("zapi_connections")
        .update({
          zapi_instance_name: instance_name
        })
        .eq("id", connection_id);

      return new Response(
        JSON.stringify({ success: true, message: "Instância renomeada com sucesso" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Ação não implementada" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ZAPI-INSTANCE-CONTROL] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
