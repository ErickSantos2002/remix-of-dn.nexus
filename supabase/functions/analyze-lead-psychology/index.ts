import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

/**
 * Executa a analise completa. Separada do handler HTTP para poder rodar em
 * background: com transcricoes inteiras a chamada ao Gemini passa facilmente
 * dos 5s de timeout padrao do pg_net, e a desconexao do cliente pode derrubar
 * a invocacao no meio.
 */
async function runAnalysis(leadId: string, workspaceId: string): Promise<Response> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get lead info
    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .select(`
        *,
        contact:crm_contacts(*)
      `)
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      throw new Error("Lead not found");
    }

    // Get conversation history from leads table (messages table)
    const MESSAGE_LIMIT = 100;
    let conversationHistory: { role: string; content: string }[] = [];
    // Fontes efetivamente lidas nesta analise (persistidas em sources_used)
    const sourcesUsed: {
      chat: {
        message_count: number;
        lead_message_count: number;
        first_at: string | null;
        last_at: string | null;
        capped: boolean;
      };
      meetings: Record<string, unknown>[];
      calls: Record<string, unknown>[];
      notes: { present: boolean; chars: number };
    } = {
      chat: { message_count: 0, lead_message_count: 0, first_at: null, last_at: null, capped: false },
      meetings: [],
      calls: [],
      notes: { present: false, chars: 0 },
    };

    if (lead.contact?.lead_id) {
      const { data: messages } = await supabase
        .from("messages")
        .select("content, sender_type, created_at")
        .eq("lead_id", lead.contact.lead_id)
        .order("created_at", { ascending: true })
        .limit(MESSAGE_LIMIT);

      if (messages && messages.length > 0) {
        conversationHistory = messages.map((m) => ({
          role: m.sender_type === "lead" ? "user" : "assistant",
          content: m.content?.replace(/^\[Audio transcrito\]:\s*/i, "") || m.content,
        }));

        sourcesUsed.chat = {
          message_count: messages.length,
          lead_message_count: messages.filter((m) => m.sender_type === "lead").length,
          first_at: messages[0].created_at ?? null,
          last_at: messages[messages.length - 1].created_at ?? null,
          capped: messages.length >= MESSAGE_LIMIT,
        };
      }
    }

    // Fetch activities + transcripts (meetings/calls) linked to the CRM lead
    // (carregado ANTES da validação para permitir exceção quando há transcrição)
    let activitiesSection = "Sem atividades registradas";
    let hasTranscript = false;
    try {
      const { data: activities } = await supabase
        .from("crm_lead_activities")
        .select("id, type, title, description, scheduled_at, status, last_call_id, appointment_id")
        .eq("lead_id", leadId)
        .order("scheduled_at", { ascending: true });

      if (activities && activities.length > 0) {
        const callIds = activities.map(a => a.last_call_id).filter(Boolean) as string[];
        const apptIds = activities.map(a => a.appointment_id).filter(Boolean) as string[];

        interface CallRow { id: string; transcription_text: string | null; ai_analysis: unknown }
        interface RecordingRow { appointment_id: string; transcription_text: string | null; ai_analysis: unknown; chat_messages: unknown }
        interface AppointmentRow { id: string; daily_room_name: string | null }

        const [callsRes, recsRes, apptsRes] = await Promise.all([
          callIds.length
            ? supabase.from("calls").select("id, transcription_text, ai_analysis").in("id", callIds)
            : Promise.resolve({ data: [] as CallRow[] }),
          apptIds.length
            ? supabase.from("daily_recordings").select("appointment_id, transcription_text, ai_analysis, chat_messages").in("appointment_id", apptIds)
            : Promise.resolve({ data: [] as RecordingRow[] }),
          apptIds.length
            ? supabase.from("crm_appointments").select("id, daily_room_name").in("id", apptIds)
            : Promise.resolve({ data: [] as AppointmentRow[] }),
        ]);

        const callMap = new Map((callsRes.data || []).map((c: CallRow) => [c.id, c]));
        const recMap = new Map((recsRes.data || []).map((r: RecordingRow) => [r.appointment_id, r]));

        // Transcricao ao vivo: gravada em meeting_transcript_chunks com
        // meeting_id = crm_appointments.daily_room_name (nao o appointment_id).
        // Consultamos as duas chaves para cobrir dados legados.
        const chunkKeyToAppt = new Map<string, string>();
        for (const apt of (apptsRes.data || []) as AppointmentRow[]) {
          const rec = recMap.get(apt.id);
          if (rec?.transcription_text && String(rec.transcription_text).trim().length > 0) continue;
          if (apt.daily_room_name) chunkKeyToAppt.set(apt.daily_room_name, apt.id);
          chunkKeyToAppt.set(apt.id, apt.id);
        }

        const chunkTextByAppt = new Map<string, string>();
        if (chunkKeyToAppt.size > 0) {
          const { data: chunks } = await supabase
            .from("meeting_transcript_chunks")
            .select("meeting_id, chunk_index, start_ts, speakers, content")
            .in("meeting_id", [...chunkKeyToAppt.keys()])
            .order("chunk_index", { ascending: true });

          interface ChunkRow { meeting_id: string; chunk_index: number; speakers: string[] | null; content: string }
          const grouped = new Map<string, string[]>();
          for (const c of (chunks || []) as ChunkRow[]) {
            const apptId = chunkKeyToAppt.get(c.meeting_id);
            if (!apptId) continue;
            const spk = c.speakers?.length ? `${c.speakers.join(", ")}: ` : "";
            if (!grouped.has(apptId)) grouped.set(apptId, []);
            grouped.get(apptId)!.push(`${spk}${c.content}`);
          }
          for (const [apptId, lines] of grouped.entries()) {
            chunkTextByAppt.set(apptId, lines.join("\n"));
          }
        }

        const chatTextOf = (rec: RecordingRow | null | undefined): string => {
          const msgs = rec?.chat_messages;
          if (!Array.isArray(msgs) || msgs.length === 0) return "";
          return msgs
            .map((m: { fromName?: string; text?: string } | null) => `${m?.fromName || "Participante"}: ${m?.text || ""}`.trim())
            .filter((l: string) => l.length > 2)
            .join("\n");
        };

        /**
         * Conteudo da reuniao/ligacao em cascata:
         * transcricao pos-reuniao -> transcricao ao vivo (chunks) -> chat da sala.
         */
        const transcriptOf = (a: { last_call_id?: string | null; appointment_id?: string | null }): { text: string; source: string } => {
          const call = a.last_call_id ? callMap.get(a.last_call_id) : null;
          if (call?.transcription_text && String(call.transcription_text).trim()) {
            return { text: String(call.transcription_text), source: "call_transcription" };
          }

          const rec = a.appointment_id ? recMap.get(a.appointment_id) : null;
          if (rec?.transcription_text && String(rec.transcription_text).trim()) {
            return { text: String(rec.transcription_text), source: "recording_transcription" };
          }

          const live = (a.appointment_id ? chunkTextByAppt.get(a.appointment_id) : null) || "";
          const chat = chatTextOf(rec);

          // Chunks e chat sao a MESMA transcricao por caminhos diferentes: os chunks
          // trazem os locutores identificados, o chat perde a atribuicao. Ate 2026-07-31
          // a indexacao de chunks parava no turno 200 (MeetingRoom.tsx), entao em
          // reunioes longas o chat guarda o trecho que faltou nos chunks. Quando o chat
          // for substancialmente maior, os dois entram: chunks primeiro, pela atribuicao.
          if (live.trim() && chat && chat.length > live.length * 1.5) {
            return {
              text: `${live}\n\n[Continuacao, sem identificacao de locutor]\n${chat}`,
              source: "live_transcription+meeting_chat",
            };
          }

          if (live.trim()) return { text: live, source: "live_transcription" };
          if (chat) return { text: chat, source: "meeting_chat" };

          return { text: "", source: "none" };
        };

        const rawTranscriptOf = (a: { last_call_id?: string | null; appointment_id?: string | null }): string => transcriptOf(a).text;

        // Transcricoes entram INTEIRAS (sem truncagem individual). O unico limite e um
        // teto global de seguranca: as atividades mais RECENTES entram primeiro e as
        // antigas ficam de fora quando o orcamento estoura.
        const TRANSCRIPT_BUDGET = 400_000;
        const includedTranscripts = new Set<string>();
        let budgetLeft = TRANSCRIPT_BUDGET;
        let omittedTranscripts = 0;

        const byMostRecent = [...activities].sort((a, b) => {
          const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
          const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
          return tb - ta;
        });

        for (const a of byMostRecent) {
          const raw = rawTranscriptOf(a);
          if (!raw) continue;
          hasTranscript = true;
          if (raw.length <= budgetLeft) {
            includedTranscripts.add(a.id);
            budgetLeft -= raw.length;
          } else {
            omittedTranscripts++;
          }
        }

        const blocks: string[] = [];
        for (const a of activities) {
          const dateStr = a.scheduled_at
            ? new Date(a.scheduled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
            : "sem data";
          const call = a.last_call_id ? callMap.get(a.last_call_id) : null;
          const rec = a.appointment_id ? recMap.get(a.appointment_id) : null;
          const { text: rawTranscript, source: transcriptSource } = transcriptOf(a);
          const omitted = !!rawTranscript && !includedTranscripts.has(a.id);
          const transcript = omitted ? "" : rawTranscript;
          const aiAnalysis = call?.ai_analysis || rec?.ai_analysis;

          if (a.last_call_id || a.appointment_id) {
            const entry = {
              activity_id: a.id,
              title: a.title || null,
              date: a.scheduled_at || null,
              status: a.status || null,
              has_transcript: !!rawTranscript,
              transcript_source: transcriptSource,
              has_ai_analysis: !!aiAnalysis,
              has_notes: !!a.description,
              transcript_chars: rawTranscript.length,
              omitted,
            };
            if (a.last_call_id) sourcesUsed.calls.push(entry);
            else sourcesUsed.meetings.push(entry);
          }

          // Skip activities with no useful content beyond title/date
          if (!transcript && !a.description && !aiAnalysis && !omitted) continue;

          // O rotulo importa: o modelo trata fala transcrita e chat digitado de formas diferentes
          const transcriptLabel = transcriptSource === "live_transcription"
            ? "Transcricao (ao vivo, durante a reuniao)"
            : transcriptSource === "meeting_chat"
            ? "Chat da reuniao (mensagens trocadas na sala)"
            : "Transcricao";

          const parts = [
            `### Atividade: ${a.title || "(sem titulo)"} [${a.type} - ${a.status} - ${dateStr}]`,
          ];
          if (a.description) parts.push(`Notas: ${a.description}`);
          if (transcript) parts.push(`${transcriptLabel}:\n${transcript}`);
          if (omitted) parts.push("Transcricao: [omitida por limite de contexto]");
          if (aiAnalysis) {
            const aiStr = typeof aiAnalysis === "string" ? aiAnalysis : JSON.stringify(aiAnalysis);
            parts.push(`Resumo IA: ${aiStr}`);
          }
          blocks.push(parts.join("\n"));
        }

        if (omittedTranscripts > 0) {
          blocks.push(
            `### Aviso: ${omittedTranscripts} transcricao(oes) mais antiga(s) foram omitidas por limite de contexto. Considere apenas o material acima.`
          );
        }

        if (blocks.length > 0) activitiesSection = blocks.join("\n\n");
      }
    } catch (actErr) {
      console.error("[analyze-lead-psychology] Failed to load activities:", actErr);
    }

    const leadNotes = (lead.notes || "").toString().trim();
    const hasRichContent = hasTranscript || leadNotes.length > 0;
    sourcesUsed.notes = { present: leadNotes.length > 0, chars: leadNotes.length };

    // VALIDATION: Block analysis without sufficient material
    const MIN_LEAD_MESSAGES = 10;
    const leadMessages = conversationHistory.filter(m => m.role === "user");
    if (leadMessages.length < MIN_LEAD_MESSAGES && !hasRichContent) {
      console.log(`Blocking analysis for lead ${leadId}: only ${leadMessages.length} lead messages and no transcript/notes`);
      return new Response(
        JSON.stringify({
          error: "Conteudo insuficiente para analise",
          message: `E necessario ter pelo menos ${MIN_LEAD_MESSAGES} mensagens do lead OU pelo menos uma atividade com transcricao ou notas no card para realizar a analise psicologica.`,
          min_messages_required: MIN_LEAD_MESSAGES,
          current_lead_messages: leadMessages.length,
          has_transcript: hasTranscript,
          has_notes: leadNotes.length > 0,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    // Build analysis prompt
    const analysisPrompt = `
Você é um especialista em análise psicológica de leads para vendas B2B.

Analise a seguinte conversa e dados do lead para extrair insights psicológicos profundos.

Analise ESPECIFICAMENTE o lead "${lead.contact?.name || 'não informado'}".
Se houver menções a outras pessoas, foque apenas nas informações e comportamentos DESTE lead.

DADOS DO LEAD:
- Nome: ${lead.contact?.name || "Não informado"}
- Empresa: ${lead.contact?.company || "Não informada"}
- Cargo: ${lead.contact?.position || "Não informado"}
- Número de funcionários: ${lead.contact?.employee_count || "Não informado"}
- Faturamento: ${lead.contact?.revenue || "Não informado"}

HISTÓRICO DE CONVERSA:
${conversationHistory.length > 0 
  ? conversationHistory.map(m => `${m.role === "user" ? "LEAD" : "AGENTE"}: ${m.content}`).join("\n")
  : "Sem histórico de conversa disponível"
}

HISTÓRICO DE ATIVIDADES (REUNIÕES E LIGAÇÕES):
${activitiesSection}

NOTAS DO CARD (CRM):
${leadNotes ? leadNotes : "Sem notas registradas"}


IMPORTANTE SOBRE O HISTÓRICO:
- Parte das mensagens do lead foram originalmente enviadas como ÁUDIO DE VOZ e transcritas para texto.
- Essas mensagens contêm informações cruciais (nome, empresa, necessidades, objeções) ditas verbalmente pelo lead.
- Trate TODAS as mensagens do LEAD com o mesmo peso e importância, independente de terem sido texto ou áudio.
- As TRANSCRIÇÕES das reuniões e ligações da seção "HISTÓRICO DE ATIVIDADES" representam falas REAIS do lead e devem ser tratadas com o mesmo peso (ou maior) das mensagens de chat. Use-as para extrair dores, desejos, objeções, padrões de decisão e nível de engajamento.
- Extraia TODAS as informações mencionadas pelo lead, incluindo dados pessoais, empresariais e necessidades.

Analise e retorne um JSON com a seguinte estrutura:

{
  "dimensions": {
    "inteligencia": <1-5, baseado em familiaridade com IA, termos técnicos, experiência>,
    "investimento": <1-5, baseado em tamanho da empresa, cargo, linguagem sobre orçamento>,
    "intencao": <1-5, baseado em urgência, timeline, pressão para resolver>,
    "engajamento": <1-5, baseado em frequência de mensagens, qualidade das perguntas>,
    "potencial": <1-5, baseado em valor potencial, possibilidade de upsell>,
    "decisao": <1-5, baseado em velocidade de decisão, tipo racional vs emocional>
  },
  "emotional_keywords": ["lista", "de", "palavras", "chave", "emocionais"],
  "top_pains": [
    {"pain": "descrição da dor", "intensity": <1-10>}
  ],
  "top_desires": [
    {"desire": "descrição do desejo", "motivation": <1-10>}
  ],
  "decision_process": {
    "type_emotional": <0-100, porcentagem emocional>,
    "type_rational": <0-100, porcentagem racional>,
    "speed": "Rápida (1-3 dias) | Média (1-2 semanas) | Lenta (1+ mês)",
    "validation": "descrição de como valida decisões"
  },
  "self_sabotage_patterns": ["lista", "de", "padrões", "de", "autossabotagem"],
  "ai_insights": "Resumo em 2-3 parágrafos com insights estratégicos para abordagem de vendas",
  "sales_strategy": {
    "approach": "Como iniciar a conversa - tom, estilo, primeira frase recomendada",
    "key_arguments": ["Argumento 1 que ressoa com este lead", "Argumento 2", "Argumento 3"],
    "pain_leverage": "Como usar as dores identificadas na argumentação de vendas",
    "desire_fulfillment": "Como conectar a solução aos desejos específicos deste lead",
    "objection_handling": [
      {"objection": "Objeção provável 1", "response": "Resposta sugerida"},
      {"objection": "Objeção provável 2", "response": "Resposta sugerida"}
    ],
    "closing_technique": "Técnica de fechamento recomendada para este perfil específico",
    "timing": "Melhor momento/urgência para fechar - quando e como pressionar",
    "red_flags": ["Sinal de alerta 1 a evitar", "Sinal de alerta 2"]
  },
  "selling_playbook": {
    "quick_brief": "2-3 frases resumindo quem é este lead, seu momento e motivação principal. Seja específico e direto.",
    "approach": {
      "tone": "assertivo | consultivo | empático | direto - escolha o tom ideal para este perfil",
      "opening_line": "Sugestão de primeira frase para iniciar conversa, personalizada para este lead"
    },
    "key_arguments": [
      "Argumento 1 - máximo 3 argumentos que vão ressoar com este perfil específico",
      "Argumento 2 baseado nas dores identificadas",
      "Argumento 3 conectado aos desejos do lead"
    ],
    "objection_handling": [
      {
        "objection": "Objeção provável 1 - a mais comum para este perfil",
        "response": "Resposta curta e direta em 1-2 frases"
      },
      {
        "objection": "Objeção provável 2",
        "response": "Resposta curta e direta em 1-2 frases"
      }
    ],
    "closing_technique": {
      "name": "Nome da técnica (ex: Fechamento por Escassez, Alternativa Limitada, Resumo de Benefícios)",
      "script": "Frase ou abordagem específica para fechar com este lead"
    },
    "caution": "1 alerta importante sobre o que NÃO fazer com este lead - seja específico"
  }
}

IMPORTANTE: 
- Se não houver informações suficientes para avaliar uma dimensão, use 3 como valor neutro
- Seja específico nas dores e desejos identificados
- Foque em padrões comportamentais observáveis
- A estratégia de vendas deve ser ULTRA ESPECÍFICA para este lead, não genérica
- Use as dores, desejos e padrões identificados para construir argumentos de venda personalizados
- Retorne APENAS o JSON, sem texto adicional
`;

    // Call AI to analyze using Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um analista psicológico especializado em vendas B2B. Responda sempre em JSON válido." },
          { role: "user", content: analysisPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      throw new Error("Failed to get AI analysis");
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response
    let analysis;
    try {
      // Remove markdown code blocks if present (handle various formats)
      let cleanedText = analysisText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      
      // Try to find JSON object if still wrapped in other content
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
      
      // Fix invalid escape sequences that AI sometimes generates
      // Replace invalid \X escapes (where X is not a valid escape char) with just X
      cleanedText = cleanedText.replace(/\\([^"\\/bfnrtu])/g, '$1');
      
      analysis = JSON.parse(cleanedText);
    } catch (e) {
      console.error("Failed to parse AI response:", analysisText);
      console.error("Parse error:", e);
      throw new Error("Invalid AI response format");
    }

    // Calculate scores based on dimensions
    const dims = analysis.dimensions;
    const propensityScore = Math.round(
      ((dims.intencao + dims.inteligencia + dims.investimento + dims.engajamento + dims.potencial) / 5) * 20
    );
    const riskScore = Math.round(
      ((5 - dims.engajamento) * 20) + ((5 - dims.intencao) * 10)
    );
    const opportunityScore = Math.round(
      ((dims.investimento + dims.potencial + dims.decisao) / 3) * 20
    );

    // Calculate temperature
    let temperatura = "frio";
    if ((dims.intencao >= 4 && dims.engajamento >= 4) || propensityScore >= 80) {
      temperatura = "muito_quente";
    } else if ((dims.intencao >= 4 && dims.engajamento >= 3) || (propensityScore >= 70 && propensityScore < 80)) {
      temperatura = "quente";
    } else if ((dims.intencao >= 3 && dims.engajamento >= 2) || (propensityScore >= 40 && propensityScore < 70)) {
      temperatura = "morno";
    }

    // Generate DNA Code
    const dnaCode = `I${dims.inteligencia} | I${dims.investimento} | I${dims.intencao} | E${dims.engajamento} | P${dims.potencial} | D${dims.decisao}`;

    // Upsert psychology data
    const psychologyData = {
      lead_id: leadId,
      workspace_id: workspaceId,
      dimension_inteligencia: dims.inteligencia,
      dimension_investimento: dims.investimento,
      dimension_intencao: dims.intencao,
      dimension_engajamento: dims.engajamento,
      dimension_potencial: dims.potencial,
      dimension_decisao: dims.decisao,
      dna_code: dnaCode,
      propensity_score: Math.max(0, Math.min(100, propensityScore)),
      risk_score: Math.max(0, Math.min(100, riskScore)),
      opportunity_score: Math.max(0, Math.min(100, opportunityScore)),
      temperatura,
      emotional_keywords: analysis.emotional_keywords || [],
      top_pains: analysis.top_pains || [],
      top_desires: analysis.top_desires || [],
      decision_process: analysis.decision_process || {},
      self_sabotage_patterns: analysis.self_sabotage_patterns || [],
      ai_insights: analysis.ai_insights || null,
      sales_strategy: analysis.sales_strategy || {},
      selling_playbook: analysis.selling_playbook || null,
      sources_used: sourcesUsed,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("crm_lead_psychology")
      .upsert(psychologyData, { onConflict: "lead_id" });

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      throw upsertError;
    }

    // Score agregado das 6 dimensoes, usado pelas regras de auto-move
    const leadScore = (dims.inteligencia || 0) + (dims.investimento || 0) + (dims.intencao || 0) +
                      (dims.engajamento || 0) + (dims.potencial || 0) + (dims.decisao || 0);
    
    // A regra de MQL por score (soma das 6 dimensoes >= 22) foi removida:
    // ela marcava pending:MQL em widget_sessions e disparava um evento Lead para a
    // Meta Conversions API a cada analise, sem guarda de idempotencia e com event_id
    // aleatorio - o que reenviava a mesma conversao a cada re-analise do lead.
    // leadScore continua calculado porque as regras de auto-move usam condition_type = lead_score.

    // Check automove rules
    const { data: rules } = await supabase
      .from("crm_automove_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (rules && rules.length > 0) {
      for (const rule of rules) {
        // Regras por evento (ex.: convidado entrou na reunião Daily) não são
        // avaliáveis por score — são aplicadas em onGuestJoinedMeeting.ts.
        if (rule.condition_type === "guest_joined_meeting") continue;

        let conditionMet = false;
        const value = rule.condition_type === "temperatura" 
          ? temperatura 
          : rule.condition_type === "lead_score"
          ? leadScore
          : psychologyData[rule.condition_type as keyof typeof psychologyData];

        if (rule.condition_type === "temperatura") {
          conditionMet = evaluateCondition(String(value), rule.condition_operator, rule.condition_value);
        } else {
          conditionMet = evaluateCondition(Number(value), rule.condition_operator, Number(rule.condition_value));
        }

        if (conditionMet) {
          // Check if lead is in the from_stage (or any stage if from_stage is null)
          if (!rule.from_stage_id || lead.stage_id === rule.from_stage_id) {
            // Move lead
            const { error: moveError } = await supabase
              .from("crm_leads")
              .update({ stage_id: rule.to_stage_id, moved_at: new Date().toISOString() })
              .eq("id", leadId);

            if (!moveError) {
              // Log the automove
              await supabase.from("crm_automove_log").insert({
                lead_id: leadId,
                workspace_id: workspaceId,
                rule_id: rule.id,
                from_stage_id: lead.stage_id,
                to_stage_id: rule.to_stage_id,
                reason: `Regra "${rule.name}": ${rule.condition_type} ${rule.condition_operator} ${rule.condition_value}`,
                psychology_snapshot: psychologyData,
              });

              // Log in history
              await supabase.from("crm_lead_history").insert({
                lead_id: leadId,
                from_stage_id: lead.stage_id,
                to_stage_id: rule.to_stage_id,
                moved_by: "auto-move",
                action: "stage_change",
                reason: `Auto-move: ${rule.name}`,
              });
            }

            // Only apply first matching rule
            break;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, data: psychologyData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in analyze-lead-psychology:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: { leadId?: string; workspaceId?: string; async?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { leadId, workspaceId, async: runInBackground } = body;

  if (!leadId || !workspaceId) {
    return new Response(
      JSON.stringify({ error: "leadId and workspaceId are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Modo background: usado por triggers de banco e backfills, onde ninguem espera
  // a resposta. Responde na hora e segue processando via waitUntil, para que o
  // timeout do pg_net nao interrompa a analise.
  if (runInBackground) {
    const task = runAnalysis(leadId, workspaceId)
      .then((res) => {
        console.log(`[analyze-lead-psychology] background lead=${leadId} status=${res.status}`);
      })
      .catch((err) => {
        console.error(`[analyze-lead-psychology] background lead=${leadId} failed:`, err);
      });

    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) {
      runtime.waitUntil(task);
    } else {
      // Ambiente sem waitUntil (dev local): degrada para execucao sincrona
      await task;
    }

    return new Response(
      JSON.stringify({ accepted: true, lead_id: leadId }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return await runAnalysis(leadId, workspaceId);
});

function evaluateCondition(value: string | number, operator: string, target: string | number): boolean {
  if (typeof value === "string" && typeof target === "string") {
    switch (operator) {
      case "=": return value === target;
      case "!=": return value !== target;
      default: return false;
    }
  }
  
  const numValue = Number(value);
  const numTarget = Number(target);
  
  switch (operator) {
    case ">": return numValue > numTarget;
    case "<": return numValue < numTarget;
    case ">=": return numValue >= numTarget;
    case "<=": return numValue <= numTarget;
    case "=": return numValue === numTarget;
    case "!=": return numValue !== numTarget;
    default: return false;
  }
}
