import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PROMPTS: Record<string, string> = {
  meeting:
    "Analise esta transcrição de reunião e forneça:\n1) Resumo executivo\n2) Principais decisões tomadas\n3) Ações acordadas e responsáveis\n4) Pontos de atenção\n5) Próximos passos recomendados",
  demo:
    "Analise esta transcrição de demonstração comercial e forneça:\n1) Resumo da demo\n2) Funcionalidades que mais interessaram o prospect\n3) Objeções levantadas\n4) Nível de interesse percebido (alto/médio/baixo)\n5) Recomendações para follow-up",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id, workspace_id } = await req.json();
    if (!recording_id || !workspace_id) {
      return new Response(JSON.stringify({ error: "recording_id and workspace_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch recording with transcription
    const { data: recording, error: recErr } = await supabase
      .from("daily_recordings")
      .select("id, transcription_text, appointment_id")
      .eq("id", recording_id)
      .single();

    if (recErr || !recording) {
      return new Response(JSON.stringify({ error: "Recording not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!recording.transcription_text) {
      return new Response(JSON.stringify({ error: "No transcription available for this recording" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Resolve activity type via appointment -> crm_lead_activities
    let activityType = "meeting"; // default
    if (recording.appointment_id) {
      const { data: appointment } = await supabase
        .from("crm_appointments")
        .select("lead_id, start_time, title")
        .eq("id", recording.appointment_id)
        .single();

      if (appointment) {
        const { data: activity } = await supabase
          .from("crm_lead_activities")
          .select("type")
          .eq("lead_id", appointment.lead_id)
          .eq("scheduled_at", appointment.start_time)
          .maybeSingle();

        if (activity?.type === "demo") {
          activityType = "demo";
        }
      }
    }

    // 3. Find company_id via workspace
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspace_id)
      .single();

    if (!workspace) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Get custom prompt or use default
    const { data: customPrompt } = await supabase
      .from("meeting_analysis_prompts")
      .select("prompt_text")
      .eq("company_id", workspace.company_id)
      .eq("activity_type", activityType)
      .maybeSingle();

    const promptText = customPrompt?.prompt_text || DEFAULT_PROMPTS[activityType] || DEFAULT_PROMPTS.meeting;

    // 5. Call Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Você é um assistente especializado em análise de reuniões e demonstrações comerciais. Analise a transcrição fornecida e responda em Português Brasileiro. Seja objetivo e estruturado na resposta. Use markdown para formatar.`,
          },
          {
            role: "user",
            content: `${promptText}\n\n--- TRANSCRIÇÃO ---\n\n${recording.transcription_text}`,
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errText);

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos na sua conta." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Erro ao processar análise com IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const analysis = aiData.choices?.[0]?.message?.content || "";

    // 6. Save analysis to daily_recordings
    const { error: updateErr } = await supabase
      .from("daily_recordings")
      .update({ ai_analysis: analysis })
      .eq("id", recording_id);

    if (updateErr) {
      console.error("Error saving analysis:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to save analysis" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, analysis, activity_type: activityType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analyze-meeting error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
