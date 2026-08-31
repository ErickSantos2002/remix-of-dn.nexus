import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Normaliza telefone brasileiro: remove @c.us, adiciona 55, converte 8→9 digitos moveis.
 * 553184499268 (12 dig) → 5531984499268 (13 dig)
 */
function normalizeBrazilianPhone(phone: string): string {
  let digits = phone.replace("@c.us", "").replace(/\D/g, "");

  // Sem prefixo 55: adicionar (10-11 digitos = DDD + numero)
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    digits = "55" + digits;
  }

  // 12 digitos com 55: pode ser celular antigo (8 digitos)
  // 55 + DDD(2) + numero(8) = 12
  // Se numero comeca com [6-9], e celular antigo → adicionar "9"
  if (digits.length === 12 && digits.startsWith("55")) {
    const numberPart = digits.slice(4);
    if (/^[6-9]/.test(numberPart)) {
      digits = digits.slice(0, 4) + "9" + numberPart;
    }
  }

  return digits;
}

// Transcribe audio using Gemini (multimodal)
async function transcribeAudio(audioUrl: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    console.error("[TRANSCRIBE] LOVABLE_API_KEY not configured");
    return "[Audio não transcrito]";
  }

  try {
    console.log("[TRANSCRIBE] Downloading audio from:", audioUrl);

    // Download audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      console.error("[TRANSCRIBE] Failed to download audio:", audioResponse.status);
      return "[Audio não disponível]";
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    console.log("[TRANSCRIBE] Audio downloaded, size:", audioBuffer.byteLength);

    // Convert to base64
    const bytes = new Uint8Array(audioBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Audio = btoa(binary);

    // Determine MIME type (Z-API typically sends ogg)
    const mimeType = "audio/ogg";
    const dataUrl = `data:${mimeType};base64,${base64Audio}`;

    console.log("[TRANSCRIBE] Sending to Gemini for transcription");

    // Use Gemini multimodal for transcription
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva o áudio a seguir para texto em português. Retorne APENAS o texto transcrito, sem comentários adicionais. Se o áudio estiver vazio ou inaudível, responda com: AUDIO_VAZIO"
              },
              {
                type: "image_url",
                image_url: { url: dataUrl }
              }
            ]
          }
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TRANSCRIBE] Gemini API error:", response.status, errorText);
      return "[Audio - transcrição falhou]";
    }

    const result = await response.json();
    const transcription = result.choices?.[0]?.message?.content?.trim() || "";

    console.log("[TRANSCRIBE] Transcription result:", transcription);

    if (!transcription || transcription === "AUDIO_VAZIO") {
      return "[Audio vazio ou em silêncio]";
    }

    return transcription;

  } catch (error) {
    console.error("[TRANSCRIBE] Error:", error);
    return "[Audio - erro na transcrição]";
  }
}

// Transcribe video note (PTV) using Gemini (multimodal)
async function transcribeVideo(videoUrl: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    console.error("[TRANSCRIBE-VIDEO] LOVABLE_API_KEY not configured");
    return "[Video não transcrito]";
  }

  try {
    console.log("[TRANSCRIBE-VIDEO] Downloading video from:", videoUrl);

    // Download video file
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      console.error("[TRANSCRIBE-VIDEO] Failed to download video:", videoResponse.status);
      return "[Video não disponível]";
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    console.log("[TRANSCRIBE-VIDEO] Video downloaded, size:", videoBuffer.byteLength);

    // Convert to base64
    const bytes = new Uint8Array(videoBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Video = btoa(binary);

    // Determine MIME type (video notes are typically mp4)
    const mimeType = "video/mp4";
    const dataUrl = `data:${mimeType};base64,${base64Video}`;

    console.log("[TRANSCRIBE-VIDEO] Sending to Gemini for transcription");

    // Use Gemini multimodal for transcription
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcreva o áudio deste vídeo para texto em português. Retorne APENAS o texto transcrito, sem comentários adicionais. Se o vídeo estiver sem áudio ou inaudível, responda com: VIDEO_SEM_AUDIO"
              },
              {
                type: "image_url",
                image_url: { url: dataUrl }
              }
            ]
          }
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TRANSCRIBE-VIDEO] Gemini API error:", response.status, errorText);
      return "[Video - transcrição falhou]";
    }

    const result = await response.json();
    const transcription = result.choices?.[0]?.message?.content?.trim() || "";

    console.log("[TRANSCRIBE-VIDEO] Transcription result:", transcription);

    if (!transcription || transcription === "VIDEO_SEM_AUDIO") {
      return "[Video sem áudio ou em silêncio]";
    }

    return transcription;

  } catch (error) {
    console.error("[TRANSCRIBE-VIDEO] Error:", error);
    return "[Video - erro na transcrição]";
  }
}

// Normalize text for keyword matching (lowercase, remove accents)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Find the best workspace based on message content and keywords
interface LinkedWorkspace {
  workspace_id: string;
  keywords: string[];
  priority: number;
  is_default: boolean;
}

function findBestWorkspace(
  messageContent: string,
  linkedWorkspaces: LinkedWorkspace[],
  fallbackWorkspaceId: string
): string {
  if (!linkedWorkspaces || linkedWorkspaces.length === 0) {
    console.log("[ROUTING] No linked workspaces, using fallback:", fallbackWorkspaceId);
    return fallbackWorkspaceId;
  }

  const normalizedMessage = normalizeText(messageContent);
  console.log("[ROUTING] Analyzing message for routing:", normalizedMessage.substring(0, 100));

  // Sort by priority (higher first)
  const sorted = [...linkedWorkspaces].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Try to match keywords
  for (const ws of sorted) {
    if (ws.keywords && ws.keywords.length > 0) {
      for (const keyword of ws.keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (normalizedMessage.includes(normalizedKeyword)) {
          console.log("[ROUTING] Matched keyword:", keyword, "-> workspace:", ws.workspace_id);
          return ws.workspace_id;
        }
      }
    }
  }

  // No keyword match - use default workspace
  const defaultWs = sorted.find(ws => ws.is_default);
  if (defaultWs) {
    console.log("[ROUTING] No keyword match, using default workspace:", defaultWs.workspace_id);
    return defaultWs.workspace_id;
  }

  // Still no match - use first linked workspace
  if (sorted.length > 0) {
    console.log("[ROUTING] No default, using first linked workspace:", sorted[0].workspace_id);
    return sorted[0].workspace_id;
  }

  console.log("[ROUTING] Using fallback workspace:", fallbackWorkspaceId);
  return fallbackWorkspaceId;
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

    const payload = await req.json();
    console.log("[ZAPI-WEBHOOK] Received payload:", JSON.stringify(payload));

    // Z-API webhook payload structure
    const {
      phone,
      instanceId,
      text,
      messageId,
      fromMe,
      senderName,
      type,
      image,
      audio,
      video,
      ptv, // Video note (circular video like voice note)
      document,
      sticker,
      contact, // VCard contact
      location, // Location message (static)
      liveLocation, // Live location (real-time tracking - not supported)
      status, // for MessageStatusCallback
      ids, // for MessageStatusCallback (array of message ids)
      connected, // for ConnectedCallback/DisconnectedCallback
      momment, // for ChatPresenceCallback (timestamp)
      chatPresence, // for ChatPresenceCallback (composing, available, etc)
      referenceMessageId, // ID da mensagem citada (para replies) - Z-API usa este nome
    } = payload;

    console.log("[ZAPI-WEBHOOK] Callback type:", type);

    // Handle connection status callbacks (ConnectedCallback, DisconnectedCallback)
    if (type === "ConnectedCallback" || type === "DisconnectedCallback") {
      const isConnected = type === "ConnectedCallback";
      console.log(`[ZAPI-WEBHOOK] Instance ${instanceId} ${isConnected ? "connected" : "disconnected"}`);

      // Update connection status in database
      const { error: updateError } = await supabase
        .from("zapi_connections")
        .update({
          zapi_connected: isConnected,
          updated_at: new Date().toISOString()
        })
        .eq("instance_id", instanceId);

      if (updateError) {
        console.error("[ZAPI-WEBHOOK] Error updating connection status:", updateError);
      }

      return new Response(
        JSON.stringify({ success: true, type, connected: isConnected }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle message status callbacks (delivered, read)
    if (type === "MessageStatusCallback") {
      console.log(`[ZAPI-WEBHOOK] Message status update:`, status, "for messages:", ids);

      // Update message status in database if we have message IDs
      if (ids && Array.isArray(ids) && ids.length > 0) {
        // Status order: pending(0) < sent(1) < delivered(2) < read(3)
        // We should only update if the new status is "higher" than the current one
        const statusOrder: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

        let newStatus: string | null = null;
        const updateData: Record<string, unknown> = {};

        // Map Z-API status to our delivery status
        // Z-API sends: SENT, RECEIVED, READ, READ-SELF, PLAYED
        if (status === "RECEIVED" || status === "DELIVERY_ACK") {
          newStatus = "delivered";
          updateData.delivered_at = new Date().toISOString();
        } else if (status === "READ" || status === "READ-SELF" || status === "PLAYED") {
          newStatus = "read";
          updateData.read_at = new Date().toISOString();
        }

        if (newStatus) {
          const newStatusOrder = statusOrder[newStatus];

          // Update zapi_messages - only if status progresses forward
          const { data: zapiMsgs } = await supabase
            .from("zapi_messages")
            .select("id, delivery_status")
            .in("zapi_message_id", ids);

          for (const msg of zapiMsgs || []) {
            const currentOrder = statusOrder[msg.delivery_status as string] || 0;
            if (newStatusOrder > currentOrder) {
              await supabase
                .from("zapi_messages")
                .update({ ...updateData, delivery_status: newStatus })
                .eq("id", msg.id);
            }
          }

          // Update main messages table - only if status progresses forward
          const { data: mainMsgs } = await supabase
            .from("messages")
            .select("id, delivery_status")
            .in("external_message_id", ids);

          for (const msg of mainMsgs || []) {
            const currentOrder = statusOrder[msg.delivery_status as string] || 0;
            if (newStatusOrder > currentOrder) {
              await supabase
                .from("messages")
                .update({ ...updateData, delivery_status: newStatus })
                .eq("id", msg.id);
              console.log(`[ZAPI-WEBHOOK] Updated message ${msg.id} status: ${msg.delivery_status} -> ${newStatus}`);
            } else {
              console.log(`[ZAPI-WEBHOOK] Skipping message ${msg.id}: ${msg.delivery_status} >= ${newStatus}`);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, type, status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle delivery failure callbacks (shadow ban, invalid number, etc.)
    if (type === "DeliveryCallback") {
      const failedMessageId = (payload as any).messageId as string | undefined;
      const errorMessage = (payload as any).error as string | undefined;
      const errorCode = (payload as any).errorCode as string | undefined;
      const fullError = [errorCode, errorMessage].filter(Boolean).join(": ");
      console.log(`[ZAPI-WEBHOOK] DeliveryCallback failure: messageId=${failedMessageId} error=${fullError}`);

      if (failedMessageId) {
        // Mark message as failed (do not regress if already delivered/read)
        const { data: mainMsgs } = await supabase
          .from("messages")
          .select("id, delivery_status")
          .eq("external_message_id", failedMessageId);

        for (const msg of mainMsgs || []) {
          const current = (msg as any).delivery_status as string | null;
          if (current === "delivered" || current === "read") continue;
          await supabase
            .from("messages")
            .update({ delivery_status: "failed", delivery_error: fullError || "Falha na entrega" })
            .eq("id", (msg as any).id);
          console.log(`[ZAPI-WEBHOOK] Marked message ${(msg as any).id} as failed (${fullError})`);
        }

        await supabase
          .from("zapi_messages")
          .update({ delivery_status: "failed" })
          .eq("zapi_message_id", failedMessageId);
      }

      return new Response(
        JSON.stringify({ success: true, type, failed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    // Handle chat presence callbacks (typing indicators)
    if (type === "ChatPresenceCallback") {
      console.log(`[ZAPI-WEBHOOK] Chat presence:`, chatPresence, "from:", phone);
      // Could be used to show "typing..." indicator in the inbox
      // For now, just acknowledge
      return new Response(
        JSON.stringify({ success: true, type, presence: chatPresence }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle sent message callbacks
    if (type === "SentCallback") {
      console.log(`[ZAPI-WEBHOOK] Message sent confirmation:`, messageId);
      return new Response(
        JSON.stringify({ success: true, type, messageId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only process actual received messages from here
    if (type !== "ReceivedCallback") {
      console.log("[ZAPI-WEBHOOK] Ignoring unknown callback type:", type);
      return new Response(JSON.stringify({ success: true, ignored: true, reason: "unknown_type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ignore messages sent by the bot itself
    if (fromMe) {
      console.log("[ZAPI-WEBHOOK] Ignoring self-sent message");
      return new Response(JSON.stringify({ success: true, ignored: true, reason: "from_me" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the connection by instance_id
    const { data: connection, error: connError } = await supabase
      .from("zapi_connections")
      .select("*")
      .eq("instance_id", instanceId)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      console.error("[ZAPI-WEBHOOK] Connection not found for instance:", instanceId);
      return new Response(JSON.stringify({ error: "Connection not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[ZAPI-WEBHOOK] Found connection:", connection.id);

    // Normalize phone number early (needed for placeholder)
    const normalizedPhone = normalizeBrazilianPhone(phone || "");
    console.log("[ZAPI-WEBHOOK] Phone normalized:", { raw: phone, normalized: normalizedPhone });

    // Check for duplicate message using messages table (external_message_id)
    // This prevents processing the same message twice when Z-API retries
    const placeholderMessageId: string | null = null;
    if (messageId) {
      const { data: existingMessage } = await supabase
        .from("messages")
        .select("id")
        .eq("external_message_id", messageId)
        .maybeSingle();

      if (existingMessage) {
        console.log("[ZAPI-WEBHOOK] Duplicate message detected, skipping:", messageId);
        return new Response(JSON.stringify({ success: true, ignored: true, reason: "duplicate" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Note: Placeholder logic removed - we rely on the unique constraint on external_message_id
      // to handle race conditions at insert time
    }

    // ─── Opt-Out Detection (Feature 3) ─────────────────────────────────
    const OPT_OUT_KEYWORDS = ['parar', 'sair', 'stop', 'cancelar', 'nao quero mais', 'me remove', 'descadastrar'];
    const rawTextContent = text?.message || text || "";
    const normalizedForOptOut = normalizeText(rawTextContent);
    const isOptOut = rawTextContent.length > 0 && OPT_OUT_KEYWORDS.some(kw => normalizedForOptOut.includes(kw));

    if (isOptOut) {
      console.log("[ZAPI-WEBHOOK] Opt-out detected from:", normalizedPhone);

      // Find contact by phone across all workspaces linked to this connection
      const { data: contacts } = await supabase
        .from("crm_contacts")
        .select("id, workspace_id")
        .eq("phone", normalizedPhone);

      if (contacts && contacts.length > 0) {
        for (const contact of contacts) {
          // Mark contact as opted out
          await supabase
            .from("crm_contacts")
            .update({ opted_out: true, opted_out_at: new Date().toISOString() })
            .eq("id", contact.id);

          // Close all leads with this phone in this workspace
          await supabase
            .from("leads")
            .update({ status: "closed" })
            .eq("phone", normalizedPhone)
            .eq("workspace_id", contact.workspace_id)
            .neq("status", "closed");
        }
        console.log("[ZAPI-WEBHOOK] Contact opted out, updated", contacts.length, "contact records");
      }

      // Send confirmation message via zapi-send
      try {
        // Get a conversation or find connection workspace for sending
        const { data: existingConvForOptOut } = await supabase
          .from("zapi_conversations")
          .select("id")
          .eq("connection_id", connection.id)
          .eq("phone_number", normalizedPhone)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        const sendPayload: Record<string, unknown> = {
          message: "Voce foi removido da nossa lista. Para voltar a conversar conosco, basta enviar uma nova mensagem a qualquer momento.",
          phone: normalizedPhone,
        };

        if (existingConvForOptOut) {
          sendPayload.conversation_id = existingConvForOptOut.id;
        } else {
          sendPayload.connection_id = connection.id;
        }

        await fetch(
          `${supabaseUrl}/functions/v1/zapi-send`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify(sendPayload),
          }
        );
        console.log("[ZAPI-WEBHOOK] Opt-out confirmation sent");
      } catch (err) {
        console.error("[ZAPI-WEBHOOK] Error sending opt-out confirmation:", err);
      }

      return new Response(
        JSON.stringify({ success: true, opted_out: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Re-Opt-In Detection (Feature 3) ────────────────────────────────
    // If contact was opted out and sends a non-opt-out message, re-activate
    {
      const { data: optedOutContact } = await supabase
        .from("crm_contacts")
        .select("id, opted_out")
        .eq("phone", normalizedPhone)
        .eq("opted_out", true)
        .maybeSingle();

      if (optedOutContact) {
        console.log("[ZAPI-WEBHOOK] Re-opt-in: contact was opted out, reactivating");
        await supabase
          .from("crm_contacts")
          .update({ opted_out: false, opted_out_at: null })
          .eq("id", optedOutContact.id);
      }
    }

    // Determine message content and media first (needed for routing)
    let messageContent = text?.message || text || "";
    let mediaUrl = null;
    let mediaType = null;

    if (image) {
      mediaUrl = image.imageUrl || image.url;
      mediaType = "image";
      const imageCaption = image.caption || "";
      messageContent = imageCaption || "[Imagem]";
    } else if (audio) {
      mediaUrl = audio.audioUrl || audio.url;
      mediaType = audio.mimeType || "audio/ogg";  // Salvar mimeType real do Z-API
      if (mediaUrl) {
        const transcription = await transcribeAudio(mediaUrl);
        messageContent = `[Audio transcrito]: ${transcription}`;
      } else {
        messageContent = "[Audio]";
      }
    } else if (video) {
      mediaUrl = video.videoUrl || video.url;
      mediaType = "video";
      const videoCaption = video.caption || "";
      messageContent = videoCaption || "[Video]";
    } else if (document) {
      mediaUrl = document.documentUrl || document.url;
      mediaType = "document";
      const docCaption = document.caption || "";
      messageContent = docCaption || `[Documento: ${document.fileName || "arquivo"}]`;
    } else if (sticker) {
      mediaUrl = sticker.stickerUrl || sticker.url;
      mediaType = "sticker";
      messageContent = "[Figurinha]";
    } else if (contact) {
      // VCard contact - store JSON data in media_url field (no actual URL)
      const vcardData = JSON.stringify({
        displayName: contact.displayName,
        vCard: contact.vCard,
        phones: contact.phones || [],
      });
      mediaUrl = vcardData; // Store JSON as "URL" since VCard has no media URL
      mediaType = "vcard";
      messageContent = `[Contato: ${contact.displayName || "Sem nome"}]`;
      console.log("[ZAPI-WEBHOOK] VCard contact received:", contact.displayName);
    } else if (ptv) {
      // PTV = Push-to-Talk Video (video note / recado de vídeo circular)
      // Z-API sends ptvUrl, not videoUrl
      mediaUrl = ptv.ptvUrl || ptv.videoUrl || ptv.url || (typeof ptv === "string" ? ptv : null);
      mediaType = "ptv";
      console.log("[ZAPI-WEBHOOK] PTV (video note) received:", JSON.stringify(ptv), "URL:", mediaUrl);
      if (mediaUrl) {
        // Transcribe audio from video note using Gemini
        const transcription = await transcribeVideo(mediaUrl);
        messageContent = `[Recado de vídeo transcrito]: ${transcription}`;
      } else {
        messageContent = "[Recado de vídeo]";
      }
    } else if (location) {
      // Location message - store JSON data in media_url field
      const locationData = JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name || "",
        address: location.address || "",
        url: location.url || "",
      });
      mediaUrl = locationData;
      mediaType = "location";
      const locationLabel = location.name || location.address || "";
      messageContent = locationLabel ? `[Localização: ${locationLabel}]` : "[Localização]";
      console.log("[ZAPI-WEBHOOK] Location received:", location.name, location.latitude, location.longitude);
    } else if (liveLocation) {
      // Live location (real-time tracking) - show initial position only
      const locationData = JSON.stringify({
        latitude: liveLocation.latitude,
        longitude: liveLocation.longitude,
        name: "",
        address: "",
        url: "",
        caption: liveLocation.caption || "",
        isLive: true,
      });
      mediaUrl = locationData;
      mediaType = "location"; // Use same type as static location
      const captionText = liveLocation.caption ? `: ${liveLocation.caption}` : "";
      messageContent = `[Localização em tempo real${captionText}]`;
      console.log("[ZAPI-WEBHOOK] Live location received:", liveLocation.latitude, liveLocation.longitude, "caption:", liveLocation.caption);
    }

    // Find or create conversation
    // Prefer conversations already linked to a lead (avoids orphaned convs
    // created by outbound flows in another workspace stealing inbound msgs).
    const { data: convRows, error: convError } = await supabase
      .from("zapi_conversations")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("phone_number", normalizedPhone)
      .eq("is_active", true)
      .order("last_message_at", { ascending: false });

    if (convError) {
      console.error("[ZAPI-WEBHOOK] Error finding conversation:", convError);
    }

    let conversation =
      (convRows || []).find((c: any) => c.lead_id) ||
      (convRows || [])[0] ||
      null;

    if (conversation) {
      console.log("[ZAPI-WEBHOOK] Found existing conversation:", conversation.id, "lead_id:", conversation.lead_id);
    }

    let leadId: string | null = null;
    let targetWorkspaceId: string = connection.workspace_id;

    if (!conversation) {
      // NEW CONVERSATION - Apply intelligent routing
      console.log("[ZAPI-WEBHOOK] New conversation, applying intelligent routing...");

      // Fetch linked workspaces for this connection
      const { data: linkedWorkspaces, error: lwError } = await supabase
        .from("connection_workspaces")
        .select("workspace_id, keywords, priority, is_default")
        .eq("connection_id", connection.id)
        .eq("connection_type", "zapi")
        .eq("is_active", true);

      if (lwError) {
        console.error("[ZAPI-WEBHOOK] Error fetching linked workspaces:", lwError);
      }

      // Determine target workspace based on message content
      targetWorkspaceId = findBestWorkspace(
        messageContent,
        linkedWorkspaces || [],
        connection.workspace_id
      );

      console.log("[ZAPI-WEBHOOK] Routed to workspace:", targetWorkspaceId);

      // Check if a crm_contact already exists with this phone
      const { data: existingContact } = await supabase
        .from("crm_contacts")
        .select("id, lead_id")
        .eq("phone", normalizedPhone)
        .eq("workspace_id", targetWorkspaceId)
        .maybeSingle();

      // Check if a CRM lead already exists for this contact
      let existingCrmLeadId: string | null = null;
      if (existingContact?.id) {
        const { data: existingCrmLead } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("workspace_id", targetWorkspaceId)
          .eq("contact_id", existingContact.id)
          .maybeSingle();
        
        if (existingCrmLead) {
          existingCrmLeadId = existingCrmLead.id;
          console.log("[ZAPI-WEBHOOK] CRM lead already exists for contact:", existingCrmLeadId);
        }
      }

      // Create a lead
      const { data: lead, error: leadError } = await supabase
        .from("leads")
        .insert({
          workspace_id: targetWorkspaceId,
          name: senderName || normalizedPhone,
          phone: normalizedPhone,
          status: "new",
          contact_id: existingContact?.id || null,
        })
        .select()
        .single();

      if (leadError) {
        console.error("[ZAPI-WEBHOOK] Error creating lead:", leadError);
      } else {
        leadId = lead.id;
        console.log("[ZAPI-WEBHOOK] Created lead:", leadId, "in workspace:", targetWorkspaceId);
      }

      // Create new conversation with lead_id already linked
      const { data: newConv, error: newConvError } = await supabase
        .from("zapi_conversations")
        .insert({
          workspace_id: targetWorkspaceId,
          connection_id: connection.id,
          phone_number: normalizedPhone,
          contact_name: senderName || null,
          last_message_at: new Date().toISOString(),
          lead_id: leadId,
        })
        .select()
        .single();

      if (newConvError) {
        console.error("[ZAPI-WEBHOOK] Error creating conversation:", newConvError);
        throw newConvError;
      }

      conversation = newConv;
      console.log("[ZAPI-WEBHOOK] Created new conversation:", conversation.id);
    } else {
      // EXISTING CONVERSATION - Use its workspace
      leadId = conversation.lead_id;
      targetWorkspaceId = conversation.workspace_id;
      
      // If lead was deleted, create a new one
      if (!leadId) {
        console.log("[ZAPI-WEBHOOK] Conversation exists but lead was deleted, creating new lead");
        
        const { data: existingContact } = await supabase
          .from("crm_contacts")
          .select("id")
          .eq("phone", normalizedPhone)
          .eq("workspace_id", targetWorkspaceId)
          .maybeSingle();
        
        const { data: newLead, error: newLeadError } = await supabase
          .from("leads")
          .insert({
            workspace_id: targetWorkspaceId,
            name: senderName || normalizedPhone,
            phone: normalizedPhone,
            status: "new",
            contact_id: existingContact?.id || null,
          })
          .select()
          .single();

        if (newLeadError) {
          console.error("[ZAPI-WEBHOOK] Error creating new lead:", newLeadError);

          // Fallback: contact already exists elsewhere (duplicate). Try to
          // find an existing active lead for this phone in ANY workspace so
          // the message is routed to the real conversation.
          const { data: existingLead } = await supabase
            .from("leads")
            .select("id, workspace_id")
            .eq("phone", normalizedPhone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingLead) {
            leadId = existingLead.id;
            targetWorkspaceId = existingLead.workspace_id;
            console.log("[ZAPI-WEBHOOK] Recovered existing lead by phone:", leadId, "workspace:", targetWorkspaceId);

            await supabase
              .from("zapi_conversations")
              .update({ lead_id: leadId, workspace_id: targetWorkspaceId })
              .eq("id", conversation.id);
          }
        } else {
          leadId = newLead.id;
          console.log("[ZAPI-WEBHOOK] Created new lead for existing conversation:", leadId);
          
          await supabase
            .from("zapi_conversations")
            .update({ lead_id: leadId })
            .eq("id", conversation.id);
        }
      }
      
      // Update last message timestamp
      await supabase
        .from("zapi_conversations")
        .update({ 
          last_message_at: new Date().toISOString(),
          contact_name: senderName || conversation.contact_name,
        })
        .eq("id", conversation.id);
    }

    // Save message to zapi_messages (update placeholder or insert new)
    let savedMessage;
    let msgError;

    if (placeholderMessageId) {
      // Update the placeholder we created earlier
      const result = await supabase
        .from("zapi_messages")
        .update({
          conversation_id: conversation.id,
          content: messageContent,
          media_url: mediaUrl,
          media_type: mediaType,
        })
        .eq("id", placeholderMessageId)
        .select()
        .single();
      savedMessage = result.data;
      msgError = result.error;
    } else {
      // No placeholder (e.g., message without messageId) - insert directly
      const result = await supabase
        .from("zapi_messages")
        .insert({
          conversation_id: conversation.id,
          zapi_message_id: messageId,
          content: messageContent,
          sender_type: "user",
          media_url: mediaUrl,
          media_type: mediaType,
        })
        .select()
        .single();
      savedMessage = result.data;
      msgError = result.error;
    }

    if (msgError) {
      console.error("[ZAPI-WEBHOOK] Error saving message:", msgError);
      throw msgError;
    }

    console.log("[ZAPI-WEBHOOK] Saved message:", savedMessage.id);

    // Save to main messages table for unified inbox
    if (leadId) {
      // Handle reply/quoted message
      let replyToExternalId: string | null = null;
      let replyToContent: string | null = null;
      let replyToSenderType: string | null = null;

      if (referenceMessageId) {
        replyToExternalId = referenceMessageId;
        console.log("[ZAPI-WEBHOOK] Message is a reply to:", referenceMessageId);

        // Buscar na tabela messages pelo external_message_id
        const { data: originalMsg } = await supabase
          .from("messages")
          .select("content, sender_type")
          .eq("external_message_id", referenceMessageId)
          .single();

        if (originalMsg) {
          replyToContent = originalMsg.content?.substring(0, 200) || null;
          replyToSenderType = originalMsg.sender_type;
          console.log("[ZAPI-WEBHOOK] Found original message in database");
        } else {
          console.log("[ZAPI-WEBHOOK] Original message not found in database");
        }
      }

      const { error: mainMsgError } = await supabase.from("messages").insert({
        lead_id: leadId,
        workspace_id: targetWorkspaceId,
        content: messageContent,
        sender_type: "lead",
        media_url: mediaUrl,
        media_type: mediaType,
        external_message_id: messageId,
        reply_to_external_id: replyToExternalId,
        reply_to_content: replyToContent,
        reply_to_sender_type: replyToSenderType,
      });

      if (mainMsgError) {
        console.error("[ZAPI-WEBHOOK] Error saving to main messages:", mainMsgError);
      } else {
        console.log("[ZAPI-WEBHOOK] Saved to main messages table - orchestrator will be triggered by database");
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: savedMessage.id, workspaceId: targetWorkspaceId }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[ZAPI-WEBHOOK] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
