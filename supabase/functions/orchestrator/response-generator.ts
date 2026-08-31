// Response generation module - builds prompts and generates AI responses

import { fetchWithTimeout, IntentCategory, getBrazilDateTime, getRelativeDateLabel, BRAZIL_TIMEZONE } from "./utils.ts";

// Get current date/time context in Portuguese - NOW USES BRAZIL TIMEZONE
function getCurrentDateTimeContext(): string {
  const br = getBrazilDateTime();
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  
  return `
---
DATA E HORA ATUAL: ${br.weekday}, ${br.day} de ${months[br.month - 1]} de ${br.year}, ${br.timeString} (horário de Brasília)
Use esta informação para referências como "hoje" e "amanhã".
REGRA CRÍTICA: NUNCA mencione o dia da semana (segunda, terça, etc.) para datas que não sejam HOJE ou AMANHÃ. Para outras datas, use apenas "dia X de [mês]" sem o dia da semana. Você NÃO sabe calcular dias da semana corretamente para datas futuras ou passadas.
---`;
}

// POINT 1: Build appointment context for agent memory
export function buildAppointmentContext(appointments: any[]): string {
  if (!appointments || appointments.length === 0) return "";
  
  const formatAppointmentDate = (dateStr: string) => {
    const date = new Date(dateStr);
    // Get date in Brazil timezone as YYYY-MM-DD
    const dateOnlyStr = date.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE });
    
    // Check if it's today or tomorrow in Brazil timezone
    const relativeLabel = getRelativeDateLabel(dateOnlyStr);
    if (relativeLabel) {
      return relativeLabel;
    }
    
    // Return absolute date formatted in Brazil timezone
    return date.toLocaleDateString("pt-BR", { 
      timeZone: BRAZIL_TIMEZONE,
      weekday: 'long', 
      day: 'numeric', 
      month: 'long' 
    });
  };
  
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("pt-BR", { 
      timeZone: BRAZIL_TIMEZONE,
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };
  
  const appointmentsList = appointments.map(apt => {
    const dateFormatted = formatAppointmentDate(apt.start_time);
    const timeFormatted = formatTime(apt.start_time);
    return `- ${apt.title}: ${dateFormatted} às ${timeFormatted} (${apt.status})${apt.meeting_link ? ` - Link: ${apt.meeting_link}` : ""}`;
  }).join("\n");
  
  return `
---
AGENDAMENTOS ATIVOS DO CLIENTE:
${appointmentsList}

IMPORTANTE: O cliente já tem agendamento(s) marcado(s). Se ele mencionar cancelar ou remarcar, use a ferramenta com action="cancel" ou action="reschedule".
---`;
}

// Build the augmented prompt with context
// LLM-FIRST APPROACH: Always include history, add time context for LLM to decide
export function buildAugmentedPrompt(
  personaPrompt: string,
  relevantContext: string[],
  conversationHistory: { role: string; content: string }[],
  userQuestion: string,
  transferContext?: { fromAgentName: string | null; fromIntent: string | null; toIntent: string },
  isNewSession: boolean = false,
  limitHistory: boolean = false,
  appointmentContext: string = "",
  hoursSinceLastMessage: number = 0,
  ragWasSkipped: boolean = false,
  specialInstruction?: string,
  leadName?: string
): string {
  // LLM-FIRST: Only ignore history if truly first message
  const shouldIgnoreHistory = isNewSession && conversationHistory.length === 0;
  const shouldIgnoreRAG = isNewSession && conversationHistory.length === 0;
  
  console.log(`[PROMPT] Building: isNewSession=${isNewSession}, historyLength=${conversationHistory.length}, hoursSince=${hoursSinceLastMessage.toFixed(2)}`);
  
  const hasRelevantContext = !shouldIgnoreRAG && relevantContext.length > 0;
  const contextSection = hasRelevantContext ? relevantContext.join("\n\n") : "";

  // LLM-FIRST: Always include recent history (last 20 messages max)
  let previousMessages: { role: string; content: string }[] = [];
  
  if (!shouldIgnoreHistory) {
    // Get last 20 messages (excluding current), for LLM context
    previousMessages = conversationHistory.slice(-21, -1);
    console.log(`[PROMPT] Including ${previousMessages.length} messages of history`);
  }
  
  const hasHistory = previousMessages.length > 0;
  const historySection = hasHistory
    ? previousMessages.map((msg) => `${msg.role === "user" ? "Lead" : "Assistente"}: ${msg.content}`).join("\n")
    : "";

  // Transfer briefing
  let transferBriefing = "";
  if (transferContext && transferContext.fromAgentName) {
    transferBriefing = `
---
CONTEXTO DE TRANSFERÊNCIA:
Este lead foi transferido do agente "${transferContext.fromAgentName}" (departamento: ${transferContext.fromIntent || 'Geral'}).
NÃO assuma que você sabe do que o lead precisa - pergunte como pode ajudar.
---
`;
  }

  // LLM-FIRST: Add time context so LLM can naturally decide on continuity
  let timeContextSection = "";
  if (hoursSinceLastMessage > 0 && hasHistory) {
    if (hoursSinceLastMessage >= 1) {
      timeContextSection = `
---
CONTEXTO TEMPORAL:
Passaram ${hoursSinceLastMessage.toFixed(1)} horas desde a última mensagem.
- Se a mensagem atual parecer continuação do assunto anterior (ex: "isso mesmo", "pode ser", "sim", "ok"), continue naturalmente.
- Se parecer uma nova demanda ou saudação isolada (ex: "oi", "olá", "bom dia" sem mais nada), cumprimente e pergunte como pode ajudar.
- Use seu julgamento natural para interpretar a intenção do lead.
---
`;
    } else if (hoursSinceLastMessage >= 0.05) { // More than 3 minutes
      timeContextSection = `
---
CONTEXTO TEMPORAL: Passaram ${(hoursSinceLastMessage * 60).toFixed(0)} minutos desde a última mensagem. Continue a conversa naturalmente.
---
`;
    }
  }

// Rules for natural conversation
  const conversationRules = `
ESTILO DE COMUNICAÇÃO:
- Fale de forma natural, como um consultor experiente conversando com um cliente.
- Use português brasileiro fluente e correto.
- Seja direto, mas amigável. Evite ser robótico ou formal demais.
- NÃO repita o nome do lead/cliente a cada mensagem. Use o nome apenas no primeiro contato ou quando for natural no contexto. Repetir o nome constantemente soa artificial e robótico.
- Mantenha a continuidade da conversa - se o usuário perguntar "e mais?" ou "quais outras?", continue no mesmo assunto.

FORMATO DAS RESPOSTAS - MUITO IMPORTANTE:
- Escreva em PARÁGRAFOS CURTOS (máximo 2-3 frases por parágrafo).
- Separe cada parágrafo com UMA LINHA EM BRANCO.
- Cada parágrafo deve ter uma ideia completa.
- NÃO use listas longas - prefira explicar de forma conversacional.
- Respostas devem parecer mensagens de WhatsApp, não e-mails formais.
- Exemplo de formato bom:
  "Olá! Que bom falar com você.
  
  Sobre sua pergunta, temos algumas opções interessantes.
  
  A primeira é X, que funciona assim..."

REGRAS DE CONTEÚDO:
1. Baseie suas respostas no CONTEXTO RELEVANTE fornecido abaixo.
2. Se o contexto tiver a informação, use-a naturalmente sem citar fontes.
3. Se NÃO tiver informação no contexto: diga algo como "Não tenho essa informação específica, mas posso ajudar de outra forma?"
4. NUNCA invente dados, estatísticas, nomes ou acrônimos que não estejam no contexto.
5. NUNCA use placeholders como [Nome], [Empresa], etc.

REGRAS DE TRANSFERÊNCIA PARA HUMANO:
- Você TEM a capacidade de solicitar transferência para um atendente humano. O sistema detecta automaticamente quando o lead quer falar com humano e executa o handoff.
- Se você avaliar que o lead precisa de atendimento humano (frustração, questão complexa, pedido explícito), PERGUNTE se ele deseja ser transferido. Exemplo: "Gostaria que eu te conectasse com um dos nossos atendentes?"
- Se o lead confirmar que quer falar com humano, responda algo como: "Certo, estou solicitando o atendimento humano para você. Aguarde um momento." O sistema detectará a intenção e executará o handoff automaticamente.
- NÃO diga "vou transferir" por conta própria sem que o lead tenha concordado ou solicitado. Sempre pergunte antes.
- Enquanto o atendente humano não assumir a conversa, continue auxiliando o lead normalmente.

MARCADOR DE CAMPO ESPECIALIZADO (OBRIGATÓRIO):
- Se sua resposta PEDIR o telefone, WhatsApp, celular ou número de contato do lead, termine a mensagem com <!--input:phone-->
- Se sua resposta PEDIR o email/e-mail do lead, termine a mensagem com <!--input:email-->
- Em qualquer outro caso, NÃO inclua nenhum marcador
- O marcador deve ser a ÚLTIMA coisa na mensagem, após todo o texto
- NUNCA mencione o marcador no texto visível — ele é invisível para o lead

FLUIDEZ E CONTINUIDADE:
- Quando o usuário fizer perguntas curtas como "e mais?", "quais outras?", "pode explicar?", entenda que ele quer mais sobre o ÚLTIMO TÓPICO discutido.
- Respostas como "isso mesmo", "sim", "ok", "pode ser" são CONFIRMAÇÕES - continue no contexto anterior.
- Não peça esclarecimentos desnecessários - interprete o contexto da conversa.
- Quando sua mensagem anterior contiver uma LISTA NUMERADA e o usuário responder com apenas um NÚMERO (ex: "3", "2", "5"), interprete como a SELEÇÃO do item correspondente na lista. Responda referenciando o CONTEÚDO do item selecionado de forma natural, sem criar nova numeração. Exemplo: se a lista tinha "3. 6 a 10" e o usuário respondeu "3", entenda que ele escolheu "6 a 10" e continue a conversa com base nisso.
- Quando sua mensagem anterior fizer uma PERGUNTA DIRETA de coleta de dados (ex: "Qual o nome da sua empresa?", "Qual seu email?", "Qual seu telefone?", "Qual seu nome?", "Qual seu cargo?"), a próxima resposta do usuário DEVE ser tratada como a RESPOSTA da pergunta sempre que houver texto não vazio e não for apenas saudação/interjeição.
- Para nome de empresa, aceite nomes incomuns sem julgar "se faz sentido". Exemplos válidos: "buscando id", "fazendo acontecer", "alpha 7", "grupo xyz", "eu mesmo".
- Se houver dúvida sobre o valor informado, NÃO repita a pergunta original imediatamente. Faça uma confirmação objetiva em uma frase, por exemplo: "Perfeito, só confirmando: sua empresa se chama \"[valor]\", certo?".
- Após a confirmação (ou ausência de correção do usuário), considere o dado coletado e avance o fluxo. NÃO fique repetindo a mesma pergunta.
- Quando o usuário incluir uma saudação junto com a resposta (ex: "ola alex", "oi maria", "bom dia João"), extraia o dado relevante e continue normalmente. Não trate saudações como mensagens vazias quando acompanhadas de informação.
- EXCEÇÃO IMPORTANTE: se a resposta vier SOMENTE com saudação/interjeição sem dado solicitado (ex: "oi", "olá", "bom dia", "prazer"), NÃO considere a pergunta respondida. Repita a pergunta de forma objetiva para coletar o dado faltante.
- Quando sua mensagem anterior CONFIRMAR DADOS DO CADASTRO do lead (email, empresa, telefone) e o usuario responder com NEGACAO (nao, mudou, nao e mais, outro email, outra empresa), PERGUNTE os dados atualizados de forma natural. Exemplo: "Sem problema! Qual seu email atualizado?" ou "Sem problema! Qual sua empresa atual e seu email atualizado?". Voce TEM permissao total para coletar e atualizar dados do lead. NAO diga que nao tem autorizacao ou que nao pode alterar dados.
`;

  // Add current date/time context to prompt
  const dateTimeContext = getCurrentDateTimeContext();

  // Build lead name section
  const genericNames = ['visitante', 'visitante widget', 'anônimo', 'lead', 'contato', ''];
  const isGenericName = !leadName || genericNames.includes(leadName.toLowerCase().trim());
  const leadNameSection = isGenericName ? "" : `
---
DADOS DO CLIENTE:
Nome: ${leadName}
REGRA: Use APENAS este nome para se referir ao cliente. NUNCA invente ou use outro nome como "Julia" ou qualquer outro. Se não souber o nome, trate por "você".
---`;

  let prompt = `${personaPrompt || "Você é um assistente profissional e amigável."}
${dateTimeContext}
${leadNameSection}
${conversationRules}
${transferBriefing}
${timeContextSection}
${appointmentContext}`;

  // Only treat as truly new session if no history exists
  if (isNewSession && conversationHistory.length === 0) {
    prompt += `
---
INSTRUÇÃO ESPECIAL - PRIMEIRA MENSAGEM:
Este é o PRIMEIRO contato com este lead.
- Responda de forma natural e amigável.
- Simplesmente cumprimente e pergunte "Como posso ajudá-lo hoje?"
- Resposta CURTA (1-2 frases no máximo).
---

Mensagem do usuário: "${userQuestion}"

Responda de forma breve e acolhedora:`;
  } else {
    // Normal conversation with context and history
    if (hasRelevantContext) {
      prompt += `
---
CONTEXTO RELEVANTE:
${contextSection}
---
`;
    } else if (!ragWasSkipped) {
      // Only show "no context" warning when RAG was actually attempted but found nothing
      prompt += `
---
ATENÇÃO MÁXIMA - SEM CONTEXTO:
Nenhum documento relevante foi encontrado na base de conhecimento para esta pergunta.
VOCÊ NÃO TEM INFORMAÇÕES SOBRE O QUE O USUÁRIO ESTÁ PERGUNTANDO.
Responda EXATAMENTE: "Não encontrei informações específicas sobre isso na minha base de conhecimento. Você poderia me dar mais detalhes ou reformular a pergunta?"
NÃO INVENTE NADA. NÃO CRIE DEFINIÇÕES. NÃO EXPLIQUE CONCEITOS QUE VOCÊ NÃO TEM NO CONTEXTO.
---
`;
    }

    if (hasHistory) {
      prompt += `
HISTÓRICO DA CONVERSA:
${historySection}

`;
    }

    if (specialInstruction) {
      prompt += `\n${specialInstruction}\n\n`;
    }

    prompt += `MENSAGEM ATUAL DO LEAD:
"${userQuestion}"

Responda de forma profissional e útil, usando o contexto disponível:`;
  }

  return prompt;
}

// Generate AI response (delegated to agent)
export async function generateAIResponse(
  augmentedPrompt: string,
  apiKey: string,
  agentName?: string
): Promise<{ content: string | null; error: string | null; status?: number }> {
  console.log(`[RESPONSE] Agent "${agentName || 'default'}" generating response...`);
  const startTime = Date.now();
  
  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: augmentedPrompt }],
          max_tokens: 2048,
        }),
      },
      20000
    );

    console.log(`[RESPONSE] API call completed in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      if (response.status === 429) {
        return { content: null, error: "Rate limit exceeded", status: 429 };
      }
      if (response.status === 402) {
        return { content: null, error: "Payment required", status: 402 };
      }
      return { content: null, error: `AI gateway error: ${response.status}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { content: null, error: "No content in AI response" };
    }

    return { content, error: null };
  } catch (error) {
    console.error("[RESPONSE] Error:", error);
    return { content: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Generate enriched briefing for handoff
export async function generateEnrichedBriefing(
  insights: any,
  conversationHistory: { role: string; content: string }[],
  apiKey: string
): Promise<string> {
  console.log("[BRIEFING] Generating enriched briefing...");
  
  const historyText = conversationHistory.slice(-10).map(m => 
    `${m.role === "user" ? "Lead" : "IA"}: ${m.content}`
  ).join("\n");

  const briefingPrompt = `Com base nos insights e histórico abaixo, gere um briefing para o agente humano.

INSIGHTS:
- Sentimento: ${insights.sentiment_score}/10 (${insights.sentiment_label})
- Intenção de Compra: ${insights.purchase_intent}%
- Urgência: ${insights.urgency_level}
- Resumo: ${insights.conversation_summary}

OBJEÇÕES:
${insights.objections?.length > 0 
  ? insights.objections.map((o: any) => `- ${o.type.toUpperCase()}: ${o.description}`).join('\n')
  : 'Nenhuma objeção detectada'}

ÚLTIMAS MENSAGENS:
${historyText}

Gere um briefing estruturado com:
1. RESUMO DA SITUAÇÃO (2-3 linhas)
2. OBJEÇÕES E COMO QUEBRAR (se houver)
3. PRÓXIMOS PASSOS RECOMENDADOS

Seja direto e prático.`;

  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{ role: "user", content: briefingPrompt }],
          max_tokens: 500,
        }),
      },
      15000
    );

    if (!response.ok) {
      return insights.conversation_summary;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || insights.conversation_summary;
  } catch (error) {
    console.error("[BRIEFING] Error:", error);
    return insights.conversation_summary;
  }
}
