import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function transcribeAudioFromUrl(url: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download audio (${resp.status})`);

  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const base64 = btoa(bin);
  const dataUrl = `data:audio/mpeg;base64,${base64}`;

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Transcreva o audio a seguir, que e uma chamada telefonica em Portugues Brasileiro. Identifique falantes como [Atendente] e [Cliente] quando possivel. Retorne APENAS a transcricao." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
      max_tokens: 8192,
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    throw new Error(`Gemini error ${aiRes.status}: ${errText}`);
  }

  const j = await aiRes.json();
  return j.choices?.[0]?.message?.content?.trim() || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { call_id } = await req.json();
    if (!call_id) {
      return new Response(JSON.stringify({ error: "call_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: call, error: getErr } = await admin.from("calls")
      .select("id, record_url, workspace_id, activity_id")
      .eq("id", call_id).single();

    if (getErr || !call?.record_url) {
      return new Response(JSON.stringify({ error: "Call or record_url not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("calls").update({ transcription_status: "processing" }).eq("id", call_id);

    let transcription = "";
    try {
      transcription = await transcribeAudioFromUrl(call.record_url);
    } catch (e) {
      console.error("[api4com-transcribe] failed:", e);
      await admin.from("calls").update({
        transcription_status: "failed",
        metadata: { transcription_error: e instanceof Error ? e.message : "Unknown" },
      }).eq("id", call_id);
      return new Response(JSON.stringify({ error: "Transcription failed", detail: e instanceof Error ? e.message : "Unknown" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("calls").update({
      transcription_status: "completed",
      transcription_text: transcription,
      transcription_provider: "lovable-ai",
      transcription_model: "google/gemini-2.5-flash",
      transcribed_at: new Date().toISOString(),
    }).eq("id", call_id);

    // Auto-trigger AI analysis.
    // Com analise de atendimento vinculada a atividade da ligacao, a avaliacao
    // contra playbook substitui a analise generica (ela ja gera o resumo).
    let analysisPlaybookId: string | null = null;
    if (call.activity_id) {
      const { data: activity } = await admin
        .from("crm_lead_activities")
        .select("analysis_playbook_id")
        .eq("id", call.activity_id)
        .maybeSingle();
      analysisPlaybookId = (activity?.analysis_playbook_id as string) ?? null;
    }

    const genericAnalysis = () =>
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/api4com-analyze-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ call_id, workspace_id: call.workspace_id }),
      }).catch((e) => console.error("[api4com-transcribe] analyze enqueue error:", e));

    if (analysisPlaybookId) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-transcript-playbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "evaluate", source_type: "call", source_id: call_id, workspace_id: call.workspace_id }),
      })
        .then(async (resp) => {
          const result = await resp.json().catch(() => null);
          // Avaliacao nao aplicavel (sem rubrica ativa, por exemplo): usa o fluxo generico
          if (!resp.ok || result?.skipped) {
            console.warn("[api4com-transcribe] playbook analysis unavailable, falling back:", result?.reason ?? resp.status);
            await genericAnalysis();
          }
        })
        .catch(async (e) => {
          console.error("[api4com-transcribe] playbook analysis error:", e);
          await genericAnalysis();
        });
    } else {
      genericAnalysis();
    }

    return new Response(JSON.stringify({ success: true, transcription }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api4com-transcribe] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
