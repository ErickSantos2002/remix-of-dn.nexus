import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// Circuit breaker constants
const CIRCUIT_OPEN_DURATION_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Warm-Up: Progressive hourly limits for new connections (Feature 6) ─────
function getHourlyLimit(connectionCreatedAt: string): number {
  const daysSinceCreation = (Date.now() - new Date(connectionCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation < 2) return 5;     // Day 1-2
  if (daysSinceCreation < 4) return 15;    // Day 3-4
  if (daysSinceCreation < 6) return 30;    // Day 5-6
  return 1200;                              // Day 7+: normal (20/min * 60min)
}

// ─── Rate limit check for warm-up ──────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function checkWarmUpLimit(
  supabase: any,
  connectionId: string,
  connectionCreatedAt: string
): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
  const limit = getHourlyLimit(connectionCreatedAt);
  if (limit >= 1200) return { allowed: true, currentCount: 0, limit };

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from('whatsapp_send_log')
    .select('*', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .gte('sent_at', oneHourAgo);

  const currentCount = count ?? 0;
  if (currentCount >= limit) {
    console.log(`[WARM-UP] Connection ${connectionId}: hourly limit ${limit} reached (sent: ${currentCount})`);
    return { allowed: false, currentCount, limit };
  }

  return { allowed: true, currentCount, limit };
}

// ─── Circuit Breaker: update state after request ────────────────────────────
// deno-lint-ignore no-explicit-any
async function updateCircuitState(
  supabase: any,
  connectionId: string,
  success: boolean,
  currentState: string,
  currentFailureCount: number
): Promise<void> {
  if (success) {
    if (currentState !== 'closed') {
      await supabase.from('zapi_connections').update({
        circuit_state: 'closed',
        circuit_failure_count: 0,
        circuit_opened_at: null,
      }).eq('id', connectionId);
      console.log(`[CIRCUIT-BREAKER] Connection ${connectionId}: closed (recovered)`);
    } else if (currentFailureCount > 0) {
      // Reset failure count on success
      await supabase.from('zapi_connections').update({
        circuit_failure_count: 0,
      }).eq('id', connectionId);
    }
  } else {
    const newCount = (currentFailureCount || 0) + 1;
    if (newCount >= CIRCUIT_FAILURE_THRESHOLD) {
      await supabase.from('zapi_connections').update({
        circuit_state: 'open',
        circuit_opened_at: new Date().toISOString(),
        circuit_failure_count: newCount,
      }).eq('id', connectionId);
      console.log(`[CIRCUIT-BREAKER] Connection ${connectionId}: OPENED (${newCount} failures)`);
    } else {
      await supabase.from('zapi_connections').update({
        circuit_failure_count: newCount,
      }).eq('id', connectionId);
      console.log(`[CIRCUIT-BREAKER] Connection ${connectionId}: failure count ${newCount}/${CIRCUIT_FAILURE_THRESHOLD}`);
    }
  }
}

// ─── Fetch with retry and backoff ───────────────────────────────────────────
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || ![429, 503].includes(response.status)) {
        return response;
      }
      lastResponse = response;
      if (attempt < retries) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        console.log(`[ZAPI-SEND] Retry ${attempt + 1}/${retries} after ${backoff}ms (status: ${response.status})`);
        await sleep(backoff);
      }
    } catch (err) {
      lastResponse = null;
      if (attempt < retries) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt);
        console.log(`[ZAPI-SEND] Retry ${attempt + 1}/${retries} after ${backoff}ms (network error)`);
        await sleep(backoff);
      } else {
        throw err;
      }
    }
  }

  return lastResponse!;
}

// ─── Send typing indicator via Z-API (Feature 4 - chat state) ──────────────
async function sendTypingIndicator(zapiBaseUrl: string, headers: Record<string, string>, phone: string): Promise<void> {
  try {
    await fetch(`${zapiBaseUrl}/chat-state`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, state: "composing" }),
    });
  } catch {
    // Fire-and-forget: don't block if this fails
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { connection_id, conversation_id, phone, message, media_url, media_type, file_name, reply_to_message_id, waveform, viewOnce, audio_duration } = await req.json();

    console.log("[ZAPI-SEND] Sending message:", { connection_id, conversation_id, phone, reply_to_message_id });
    console.log("[ZAPI-SEND] Full request details:", {
      connection_id: connection_id || null,
      conversation_id: conversation_id || null,
      phone: phone ? `${String(phone).substring(0, 6)}***` : null,
      has_message: !!message,
      message_length: message?.length,
      media_type: media_type || "text",
      has_reply: !!reply_to_message_id,
    });

    // Get connection details and phone number
    let connection: Record<string, unknown> | null = null;
    let targetPhone = phone;

    if (connection_id) {
      const { data, error } = await supabase
        .from("zapi_connections")
        .select("*")
        .eq("id", connection_id)
        .single();

      if (error) throw new Error("Connection not found");
      connection = data;
    } else if (conversation_id) {
      const { data: conv, error: convError } = await supabase
        .from("zapi_conversations")
        .select("*, zapi_connections(*)")
        .eq("id", conversation_id)
        .single();

      if (convError) throw new Error("Conversation not found");
      connection = conv.zapi_connections;
      // Extract phone_number from conversation if not provided
      if (!targetPhone && conv.phone_number) {
        targetPhone = conv.phone_number;
        console.log("[ZAPI-SEND] Got phone from conversation:", targetPhone);
      }
    }

    if (!connection) {
      throw new Error("No connection found");
    }

    if (!targetPhone) {
      throw new Error("No phone number provided or found in conversation");
    }

    // ─── Circuit Breaker Check (Feature 5) ──────────────────────────────
    const circuitState = (connection.circuit_state as string) || 'closed';
    const circuitOpenedAt = connection.circuit_opened_at as string | null;
    const circuitFailureCount = (connection.circuit_failure_count as number) || 0;

    if (circuitState === 'open') {
      const elapsed = Date.now() - new Date(circuitOpenedAt!).getTime();
      if (elapsed < CIRCUIT_OPEN_DURATION_MS) {
        console.log(`[ZAPI-SEND] Circuit breaker OPEN for connection ${connection.id}. Retry after ${CIRCUIT_OPEN_DURATION_MS - elapsed}ms`);
        return new Response(
          JSON.stringify({ error: 'Circuit breaker open', retry_after_ms: CIRCUIT_OPEN_DURATION_MS - elapsed }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Transition to half_open
      await supabase.from('zapi_connections').update({ circuit_state: 'half_open' }).eq('id', connection.id);
      console.log(`[ZAPI-SEND] Circuit breaker transitioning to HALF_OPEN for ${connection.id}`);
    }

    // ─── Warm-Up Rate Limit (Feature 6) ─────────────────────────────────
    const warmUpCheck = await checkWarmUpLimit(
      supabase,
      connection.id as string,
      connection.created_at as string
    );
    if (!warmUpCheck.allowed) {
      console.log(`[ZAPI-SEND] Warm-up limit reached: ${warmUpCheck.currentCount}/${warmUpCheck.limit}/hour`);
      return new Response(
        JSON.stringify({
          error: 'Warm-up hourly limit reached',
          current_count: warmUpCheck.currentCount,
          limit: warmUpCheck.limit,
          warm_up: true,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { instance_id, api_token } = connection as { instance_id: string; api_token: string };

    console.log("[ZAPI-SEND] Connection details:", {
      has_instance_id: !!instance_id,
      has_api_token: !!api_token
    });

    // Lookup company-level account token via workspace -> company
    let companyAccountToken: string | null = null;
    let companyId: string | null = null;

    try {
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("company_id")
        .eq("id", connection.workspace_id)
        .single();

      if (workspace?.company_id) {
        companyId = workspace.company_id;

        const { data: company } = await supabase
          .from("companies")
          .select("id, zapi_account_token")
          .eq("id", workspace.company_id)
          .single();

        if (company?.zapi_account_token) {
          companyAccountToken = await decryptTokenDeno(
            company.zapi_account_token,
            company.id
          );
          console.log("[ZAPI-SEND] Decrypted company account token");
        }
      }
    } catch (err) {
      console.error("[ZAPI-SEND] Error fetching company account token:", err);
    }

    if (!companyId) {
      throw new Error("Company not found for this connection");
    }

    // Decrypt instance_id and api_token (they are stored encrypted in the database)
    let decryptedInstanceId: string;
    let decryptedApiToken: string;

    const looksEncrypted = (str: string): boolean => {
      try {
        const decoded = atob(str);
        return decoded.length >= 44;
      } catch {
        return false;
      }
    };

    try {
      if (looksEncrypted(instance_id)) {
        decryptedInstanceId = await decryptTokenDeno(instance_id, companyId);
        console.log("[ZAPI-SEND] Decrypted instance_id successfully");
      } else {
        decryptedInstanceId = instance_id;
        console.log("[ZAPI-SEND] Using plain text instance_id (legacy connection)");
      }

      if (looksEncrypted(api_token)) {
        decryptedApiToken = await decryptTokenDeno(api_token, companyId);
        console.log("[ZAPI-SEND] Decrypted api_token successfully");
      } else {
        decryptedApiToken = api_token;
        console.log("[ZAPI-SEND] Using plain text api_token (legacy connection)");
      }
    } catch (decryptError) {
      console.error("[ZAPI-SEND] Failed to decrypt credentials:", decryptError);
      decryptedInstanceId = instance_id;
      decryptedApiToken = api_token;
      console.log("[ZAPI-SEND] Fallback: using tokens as plain text");
    }

    // Format phone number for Z-API
    let formattedPhone = targetPhone.replace(/\D/g, "");
    if (formattedPhone.length >= 10 && formattedPhone.length <= 11) {
      formattedPhone = "55" + formattedPhone;
    }
    console.log("[ZAPI-SEND] Formatted phone:", formattedPhone);

    const zapiBaseUrl = `https://api.z-api.io/instances/${decryptedInstanceId}/token/${decryptedApiToken}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (!companyAccountToken) {
      console.error("[ZAPI-SEND] No company Client-Token available");
      throw new Error("Token de Seguranca da Conta Z-API nao configurado. Configure em Configuracoes da Empresa.");
    }
    headers["Client-Token"] = companyAccountToken;
    console.log("[ZAPI-SEND] Using company account Client-Token");

    // ─── Send typing indicator before message (Feature 4) ───────────────
    await sendTypingIndicator(zapiBaseUrl, headers, formattedPhone);

    let zapiResponse: Response;

    if (media_url && media_type) {
      // Send media message
      let endpoint = "";
      let body: Record<string, unknown> = { phone: formattedPhone };

      switch (media_type) {
        case "image":
          endpoint = "/send-image";
          body = { ...body, image: media_url };
          if (message) body.caption = message;
          break;
        case "audio": {
          endpoint = "/send-audio";
          const audioMimeMatch = media_url?.match(/^data:([^;]+);/);
          const audioMimeType = audioMimeMatch ? audioMimeMatch[1] : "unknown";

          body = {
            ...body,
            audio: media_url,
            waveform: waveform ?? true,
            viewOnce: viewOnce ?? false,
            async: false,
            ...(audio_duration && { delayTyping: Math.min(Math.ceil(audio_duration), 15) }),
          };

          console.log("[ZAPI-SEND] Audio details:", {
            mimeType: audioMimeType,
            waveform: body.waveform,
            viewOnce: body.viewOnce,
            delayTyping: body.delayTyping,
            audioLength: media_url?.length,
            audio_duration,
          });
          break;
        }
        case "video":
          endpoint = "/send-video";
          body = { ...body, video: media_url };
          if (message) body.caption = message;
          break;
        case "document": {
          const fileExt = file_name?.split(".").pop()?.toLowerCase() || "pdf";
          const fileNameWithoutExt = file_name?.replace(/\.[^/.]+$/, "") || "documento";
          endpoint = `/send-document/${fileExt}`;
          body = { ...body, document: media_url, fileName: fileNameWithoutExt };
          console.log("[ZAPI-SEND] Document details:", {
            phone: formattedPhone,
            fileName: fileNameWithoutExt,
            fileExt,
            endpoint,
            documentLength: media_url?.length
          });
          break;
        }
        default:
          endpoint = "/send-text";
          body = { ...body, message };
      }

      zapiResponse = await fetchWithRetry(`${zapiBaseUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } else {
      // Send text message
      zapiResponse = await fetchWithRetry(`${zapiBaseUrl}/send-text`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          phone: formattedPhone,
          message,
          ...(reply_to_message_id && { messageId: reply_to_message_id }),
        }),
      });
    }

    const zapiResult = await zapiResponse.json();
    console.log("[ZAPI-SEND] Z-API response status:", zapiResponse.status);
    console.log("[ZAPI-SEND] Z-API response body:", JSON.stringify(zapiResult));

    // ─── Update Circuit Breaker State (Feature 5) ───────────────────────
    const isRetryableFailure = [429, 503].includes(zapiResponse.status);
    await updateCircuitState(
      supabase,
      connection.id as string,
      zapiResponse.ok,
      circuitState === 'open' ? 'half_open' : circuitState, // if was open, we transitioned to half_open above
      circuitFailureCount
    );

    if (!zapiResponse.ok) {
      throw new Error(zapiResult.error || `Failed to send message via Z-API (status: ${zapiResponse.status})`);
    }

    // Find or create conversation if not provided
    let targetConversationId = conversation_id;
    if (!targetConversationId) {
      const { data: existingConv } = await supabase
        .from("zapi_conversations")
        .select("id")
        .eq("connection_id", connection.id)
        .eq("phone_number", formattedPhone)
        .single();

      if (existingConv) {
        targetConversationId = existingConv.id;
      } else {
        const { data: newConv, error: newConvError } = await supabase
          .from("zapi_conversations")
          .insert({
            workspace_id: connection.workspace_id,
            connection_id: connection.id,
            phone_number: formattedPhone,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (newConvError) throw newConvError;
        targetConversationId = newConv.id;
      }
    }

    // Save message to zapi_messages
    const { data: savedMessage, error: msgError } = await supabase
      .from("zapi_messages")
      .insert({
        conversation_id: targetConversationId,
        zapi_message_id: zapiResult.messageId || zapiResult.zapiMessageId,
        content: message || (media_type ? `[${media_type}]` : ""),
        sender_type: "agent",
        media_url: media_url || null,
        media_type: media_type || null,
      })
      .select()
      .single();

    if (msgError) {
      console.error("[ZAPI-SEND] Error saving message:", msgError);
    }

    // Update conversation last message timestamp
    await supabase
      .from("zapi_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", targetConversationId);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: savedMessage?.id,
        zapiMessageId: zapiResult.messageId || zapiResult.zapiMessageId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[ZAPI-SEND] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
