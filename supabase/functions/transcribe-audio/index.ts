import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getDataUrlFromRemote(url: string): Promise<string> {
  console.log("[TRANSCRIBE-AUDIO] Downloading audio from:", url);

  const audioResponse = await fetch(url);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`);
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  console.log("[TRANSCRIBE-AUDIO] Audio downloaded, size:", audioBuffer.byteLength);

  // Convert to base64
  const bytes = new Uint8Array(audioBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Audio = btoa(binary);

  // Default to ogg for Z-API audio
  return `data:audio/ogg;base64,${base64Audio}`;
}

async function transcribeAudio(audioDataUrl: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  // Extrair dados do data URL
  const matches = audioDataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid audio data URL format");
  }

  const base64Data = matches[2];
  const dataUrl = `data:audio/ogg;base64,${base64Data}`;

  const audioSizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
  console.log("[TRANSCRIBE-AUDIO] Sending to Gemini, size:", audioSizeKB, "KB");

  // Usar Gemini multimodal (mesmo formato do zapi-webhook)
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
    console.error("[TRANSCRIBE-AUDIO] Gemini API error:", response.status, errorText);
    return "[Audio - transcrição falhou]";
  }

  const result = await response.json();
  const transcription = result.choices?.[0]?.message?.content?.trim() || "";

  console.log("[TRANSCRIBE-AUDIO] Gemini result:", transcription.substring(0, 100));

  if (!transcription || transcription === "AUDIO_VAZIO") {
    return "[Audio vazio ou em silêncio]";
  }

  return transcription;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audio_base64, message_id } = await req.json();

    // Case 1: Direct transcription with base64 data
    if (audio_base64) {
      console.log("[TRANSCRIBE-AUDIO] Direct transcription, length:", audio_base64.length);

      const transcription = await transcribeAudio(audio_base64);

      return new Response(
        JSON.stringify({ success: true, transcription }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Case 2: Re-transcription by message_id
    if (message_id) {
      console.log("[TRANSCRIBE-AUDIO] Re-transcription for message:", message_id);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Fetch message
      const { data: message, error: msgError } = await supabase
        .from("messages")
        .select("id, media_url, media_type, content")
        .eq("id", message_id)
        .single();

      if (msgError || !message) {
        console.error("[TRANSCRIBE-AUDIO] Message not found:", msgError);
        return new Response(
          JSON.stringify({ error: "Message not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (message.media_type !== "audio" || !message.media_url) {
        console.error("[TRANSCRIBE-AUDIO] Message is not an audio message");
        return new Response(
          JSON.stringify({ error: "Message is not an audio message" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get data URL (either already base64 or download from remote)
      let audioDataUrl: string;
      if (message.media_url.startsWith("data:")) {
        audioDataUrl = message.media_url;
      } else {
        audioDataUrl = await getDataUrlFromRemote(message.media_url);
      }

      // Transcribe
      const transcription = await transcribeAudio(audioDataUrl);
      const newContent = `[Audio transcrito]: ${transcription}`;

      console.log("[TRANSCRIBE-AUDIO] New transcription:", newContent.substring(0, 100));

      // Update message
      const { error: updateError } = await supabase
        .from("messages")
        .update({ content: newContent })
        .eq("id", message_id);

      if (updateError) {
        console.error("[TRANSCRIBE-AUDIO] Error updating message:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update message" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Also update zapi_messages if exists
      const { data: zapiMsg } = await supabase
        .from("zapi_messages")
        .select("id")
        .eq("media_url", message.media_url)
        .maybeSingle();

      if (zapiMsg) {
        await supabase
          .from("zapi_messages")
          .update({ content: newContent })
          .eq("id", zapiMsg.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          content: newContent,
          transcription: transcription
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No valid input provided
    return new Response(
      JSON.stringify({ error: "audio_base64 or message_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[TRANSCRIBE-AUDIO] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        transcription: "[Audio nao transcrito]"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
