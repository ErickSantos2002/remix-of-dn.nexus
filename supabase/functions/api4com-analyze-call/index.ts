import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PROMPT_PHONE_CALL =
  "Analise esta transcricao de chamada telefonica e forneca:\n1) Resumo da conversa\n2) Objetivo do cliente / motivo do contato\n3) Objecoes ou duvidas levantadas\n4) Nivel de interesse percebido (alto/medio/baixo)\n5) Compromissos ou proximos passos acordados\n6) Recomendacoes para follow-up";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { call_id, workspace_id } = await req.json();
    if (!call_id || !workspace_id) {
      return new Response(JSON.stringify({ error: "call_id and workspace_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: call, error: cErr } = await admin.from("calls")
      .select("id, transcription_text, company_id")
      .eq("id", call_id).single();

    if (cErr || !call) {
      return new Response(JSON.stringify({ error: "Call not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!call.transcription_text) {
      return new Response(JSON.stringify({ error: "No transcription available" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: customPrompt } = await admin.from("meeting_analysis_prompts")
      .select("prompt_text").eq("company_id", call.company_id).eq("activity_type", "phone_call").maybeSingle();

    const promptText = customPrompt?.prompt_text || DEFAULT_PROMPT_PHONE_CALL;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Voce e um assistente especialista em analise de chamadas telefonicas comerciais. Responda em Portugues Brasileiro. Use markdown. Seja objetivo e estruturado." },
          { role: "user", content: `${promptText}\n\n--- TRANSCRICAO DA CHAMADA ---\n\n${call.transcription_text}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("[api4com-analyze-call] AI error:", aiRes.status, errText);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisicoes excedido. Tente novamente em alguns minutos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "Creditos insuficientes." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Erro ao analisar chamada" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const j = await aiRes.json();
    const analysis = j.choices?.[0]?.message?.content || "";

    await admin.from("calls").update({
      ai_analysis: { text: analysis, model: "google/gemini-2.5-flash", generated_at: new Date().toISOString() },
      ai_analyzed_at: new Date().toISOString(),
    }).eq("id", call_id);

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api4com-analyze-call] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
