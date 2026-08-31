// Edge function: meeting-insights
// Recebe transcrição parcial da reunião e devolve insight + sugestão de fala
// usando o agente configurado no workspace via Lovable AI Gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TranscriptEntry {
  role: "host" | "guest";
  name: string;
  text: string;
  ts?: string;
}

interface RequestBody {
  workspace_id: string;
  meeting_id?: string;
  transcript: TranscriptEntry[];
  trigger?: "auto" | "manual";
  override_agent_id?: string;
  override_agent_source?: "agents" | "agent_instances";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const body = (await req.json()) as RequestBody;
    if (!body?.workspace_id || !Array.isArray(body?.transcript)) {
      return json({ error: "invalid_payload" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Carrega config
    const { data: settings, error: settingsErr } = await admin
      .from("workspace_meeting_settings")
      .select("enabled, agent_id, agent_source, ai_model")
      .eq("workspace_id", body.workspace_id)
      .maybeSingle();

    if (settingsErr) {
      console.error("[meeting-insights] settings error", settingsErr);
      return json({ error: "settings_unavailable" }, 500);
    }
    if (!settings?.enabled || !settings?.agent_id) {
      return json({ error: "disabled" }, 409);
    }

    // 2. Resolve agente (system prompt) — permite override via payload
    const overrideAgentId = body.override_agent_id;
    const overrideSource = body.override_agent_source;
    const isInstances = overrideAgentId
      ? overrideSource === "agent_instances"
      : settings.agent_source === "agent_instances";
    const agentId = overrideAgentId || settings.agent_id;
    const table = isInstances ? "agent_instances" : "agents";
    const promptCol = isInstances ? "system_prompt" : "persona_prompt";
    const { data: agent, error: agentErr } = await admin
      .from(table)
      .select(`id, name, ${promptCol}`)
      .eq("id", agentId)
      .maybeSingle();

    if (agentErr || !agent) {
      console.error("[meeting-insights] agent not found", agentErr);
      return json({ error: "agent_not_found" }, 404);
    }
    const agentPrompt = (agent as Record<string, unknown>)[promptCol] as
      | string
      | null;

    // 3. Monta prompt
    const recent = body.transcript.slice(-40);
    const transcriptText = recent
      .map((t) => `[${t.role.toUpperCase()}] ${t.name}: ${t.text}`)
      .join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "ai_not_configured" }, 500);
    }

    // 3.1 RAG: recupera trechos relevantes de momentos anteriores da reunião
    let contextBlock = "";
    if (body.meeting_id && recent.length > 0) {
      try {
        const queryText = recent
          .slice(-8)
          .map((t) => `${t.name}: ${t.text}`)
          .join("\n");

        const earliestRecentTs = recent[0]?.ts;

        const embResp = await fetch(
          "https://ai.gateway.lovable.dev/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-embedding-001",
              input: queryText.slice(0, 4000),
            }),
          },
        );

        if (embResp.ok) {
          const embData = await embResp.json();
          const queryEmbedding = embData?.data?.[0]?.embedding;
          if (Array.isArray(queryEmbedding)) {
            const { data: matches, error: matchErr } = await admin.rpc(
              "match_meeting_chunks",
              {
                p_meeting_id: body.meeting_id,
                p_query_embedding: queryEmbedding as unknown as string,
                p_exclude_after: earliestRecentTs ?? null,
                p_match_count: 6,
              },
            );

            if (matchErr) {
              console.error("[meeting-insights] rag match error", matchErr);
            } else if (Array.isArray(matches) && matches.length > 0) {
              contextBlock = matches
                .map((m: Record<string, unknown>) => {
                  const ts = m.start_ts
                    ? new Date(m.start_ts as string).toLocaleTimeString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";
                  const sp = Array.isArray(m.speakers)
                    ? (m.speakers as string[]).join(", ")
                    : "";
                  return `[${ts} • ${sp}]\n${m.content}`;
                })
                .join("\n\n");
              console.log(
                "[meeting-insights] rag matches",
                matches.length,
                "chunks recuperados",
              );
            }
          }
        }
      } catch (ragErr) {
        console.error("[meeting-insights] rag fatal", ragErr);
      }
    }

    const systemPrompt =
      (agentPrompt || "Você é um assistente de vendas.") +
      `

---

CONTEXTO DE OPERAÇÃO:
Você está OUVINDO uma reunião ao vivo em pt-BR entre:
- HOST (vendedor/representante da empresa)
- GUEST (cliente/lead)

Sua tarefa é ajudar o HOST a conduzir a conversa.

Gere SEMPRE em português do Brasil:
1) insight: análise estratégica curta (1 frase) do momento atual — sinais de objeção, interesse, intenção, próximo passo recomendado.
2) suggested_reply: fala pronta e natural (1-3 frases curtas) que o HOST pode usar AGORA para responder ao GUEST.
3) detected: lista curta de tags detectadas (ex: "objecao_preco", "interesse_alto", "pedido_demo", "duvida_tecnica").

Seja específico e contextual. Nunca invente fatos, preços ou datas que não apareceram na transcrição.
Quando "Contexto relevante de momentos anteriores" estiver presente, USE-O para ancorar a resposta em fatos já discutidos na própria reunião.`;

    const userPrompt = `${
      contextBlock
        ? `## Contexto relevante de momentos anteriores desta reunião\n\n${contextBlock}\n\n`
        : ""
    }## Trecho atual da reunião\n\n${transcriptText}\n\nGere o insight e a sugestão de fala para o HOST.`;

    const model = settings.ai_model || "google/gemini-3-flash-preview";

    console.log("[meeting-insights] →", {
      workspace_id: body.workspace_id,
      meeting_id: body.meeting_id,
      model,
      agent: agent.name,
      transcript_size: body.transcript.length,
      trigger: body.trigger,
    });

    // 4. Chama AI Gateway com tool calling para forçar JSON estruturado
    const aiResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "emit_meeting_insight",
                description: "Emite insight estratégico e sugestão de fala.",
                parameters: {
                  type: "object",
                  properties: {
                    insight: { type: "string" },
                    suggested_reply: { type: "string" },
                    detected: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["insight", "suggested_reply", "detected"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "emit_meeting_insight" },
          },
        }),
      },
    );

    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("[meeting-insights] gateway error", aiResp.status, text);
      if (aiResp.status === 429) {
        return json(
          { error: "rate_limited", message: "Muitas requisições, aguarde." },
          429,
        );
      }
      if (aiResp.status === 402) {
        return json(
          { error: "no_credits", message: "Créditos de IA esgotados." },
          402,
        );
      }
      return json({ error: "gateway_error" }, 500);
    }

    const aiData = await aiResp.json();
    const call = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed = { insight: "", suggested_reply: "", detected: [] as string[] };
    try {
      parsed = JSON.parse(call?.function?.arguments || "{}");
    } catch (e) {
      console.error("[meeting-insights] parse error", e);
    }

    const latency_ms = Date.now() - startedAt;
    console.log("[meeting-insights] ←", { latency_ms, ...parsed });

    return json({ ...parsed, latency_ms, model, agent_name: agent.name });
  } catch (err) {
    console.error("[meeting-insights] fatal", err);
    return json(
      { error: "internal_error", message: (err as Error).message },
      500,
    );
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
