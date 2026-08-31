// Intent analysis module - classifies user message intent

import { fetchWithTimeout, API_TIMEOUT_MS, IntentCategory, ConversationInsights, HISTORY_LIMIT, getDefaultInsights } from "./utils.ts";
import { buildTenantGuard, sanitizeExtractedContactData } from "../_shared/contactDataGuard.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Fetch dynamic categories from database
export async function fetchDynamicCategories(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("agent_categories")
      .select("slug")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);
    
    if (error) {
      console.error("[CATEGORIES] Error fetching dynamic categories:", error);
      return [];
    }
    
    return (data || []).map((c: { slug: string }) => c.slug);
  } catch (error) {
    console.error("[CATEGORIES] Error:", error);
    return [];
  }
}

// Analyze intent using Gemini with dynamic categories support
export async function analyzeIntent(
  content: string, 
  apiKey: string,
  dynamicCategories: string[] = [],
  lastAssistantMessage: string = ""
): Promise<IntentCategory> {
  console.log("[INTENT] Analyzing intent for message:", content.substring(0, 100));
  
  // Check for explicit transfer requests first
  const explicitTransfer = detectExplicitTransferRequest(content);
  if (explicitTransfer) {
    console.log("[INTENT] Detected explicit transfer request to:", explicitTransfer);
    return explicitTransfer as IntentCategory;
  }
  
  // Merge default categories with dynamic ones
  const defaultCategories = ["VENDAS", "SUPORTE", "RH", "MARKETING", "GERAL", "OBJECAO", "HUMANO"];
  const allCategories = [...new Set([...defaultCategories, ...dynamicCategories])];
  const categoryList = allCategories.join(", ");
  
  const intentPrompt = `Analise a seguinte mensagem e classifique a intenção em UMA das categorias:
${allCategories.map(cat => {
  switch(cat) {
    case "VENDAS": return "- VENDAS: Pergunta sobre produtos, preços, compra, orçamento, pagamento";
    case "SUPORTE": return "- SUPORTE: Problema técnico, bug, não funciona, erro, ajuda técnica";
    case "RH": return "- RH: Pergunta sobre recrutamento, vagas, entrevista, trabalho, emprego, OU pedido de transferência para RH";
    case "MARKETING": return "- MARKETING: Campanhas, promoções, divulgação, parcerias";
    case "OBJECAO": return "- OBJECAO: Cliente com dúvidas, hesitação, objeções de valor ou tempo";
    case "GERAL": return "- GERAL: Outra pergunta geral, saudação, informações básicas";
    case "HUMANO": return "- HUMANO: Cliente EXPLICITAMENTE pedindo para falar com humano genérico (não departamento específico)";
    case "EVENTOS": return "- EVENTOS: Perguntas sobre eventos, ingressos, palestras, conferências";
    case "JURIDICO": return "- JURIDICO: Questões legais, contratos, termos de uso";
    case "FINANCEIRO": return "- FINANCEIRO: Faturamento, notas fiscais, cobranças, pagamentos";
    case "TECNICO": return "- TECNICO: Dúvidas técnicas, integrações, API, desenvolvimento";
    case "PARCERIAS": return "- PARCERIAS: Propostas de parceria, afiliados, revendedores";
    default: return `- ${cat}: Categoria específica do negócio`;
  }
}).join("\n")}

IMPORTANTE: 
- REGRA CRÍTICA DE CONTEXTO: Se a ÚLTIMA MENSAGEM DO ASSISTENTE fez uma PERGUNTA DIRETA pedindo informações do cliente (nome, empresa, email, telefone, cargo, CNPJ, endereço, número de funcionários, faturamento, etc), a resposta do cliente é uma RESPOSTA À PERGUNTA e NÃO indica mudança de intenção. Nesse caso, classifique como GERAL.
  Exemplo: Assistente perguntou "Qual o nome da sua empresa?" → Cliente respondeu "Primeira classe assistência técnica" → Isso é o NOME DA EMPRESA, NÃO um pedido de suporte. Classifique como GERAL.
  Exemplo: Assistente perguntou "Qual seu email?" → Cliente respondeu "joao@suporte.com" → Isso é o EMAIL, NÃO suporte. Classifique como GERAL.
  Exemplo: Assistente perguntou "Quantos funcionários?" → Cliente respondeu "10 no suporte técnico" → Isso é a QUANTIDADE DE FUNCIONÁRIOS, NÃO suporte. Classifique como GERAL.
- Se o cliente PEDE TRANSFERÊNCIA para um departamento específico (ex: "transferir para RH", "pode me passar para vendas"), classifique como esse departamento
- Se o cliente expressa DÚVIDA ou HESITAÇÃO sobre o produto/serviço, classifique como OBJECAO (não HUMANO)
- Só use HUMANO se o cliente PEDIR EXPLICITAMENTE por um humano genérico ou estiver MUITO agressivo
- Se a ÚLTIMA MENSAGEM DO ASSISTENTE ofereceu transferência para humano/atendente (ex: "Gostaria que eu te conectasse com um atendente?", "Posso transferir para um humano?") e o cliente CONFIRMOU (ex: "sim", "pode ser", "quero", "por favor", "ok", "pode transferir"), classifique como HUMANO

${lastAssistantMessage ? `ÚLTIMA MENSAGEM DO ASSISTENTE (para contexto de confirmação):
"${lastAssistantMessage.substring(0, 300)}"` : ""}

Mensagem do cliente: ${content}

Responda APENAS com a categoria (ex: VENDAS). Nada mais.`;

  try {
    console.log("[INTENT] Starting intent API call...");
    const startTime = Date.now();
    
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
          messages: [{ role: "user", content: intentPrompt }],
          max_tokens: 15,
        }),
      },
      10000
    );

    console.log(`[INTENT] Intent API call completed in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      console.error("[INTENT] API error:", response.status);
      return "GERAL";
    }

    const data = await response.json();
    const intentText = data.choices?.[0]?.message?.content?.trim().toUpperCase() || "GERAL";
    
    // Check against all available categories
    const detectedIntent = allCategories.find(i => intentText.includes(i)) || "GERAL";
    
    console.log("[INTENT] Detected intent:", detectedIntent);
    return detectedIntent as IntentCategory;
  } catch (error) {
    console.error("[INTENT] Error analyzing intent:", error);
    return "GERAL";
  }
}

// Detect explicit transfer requests like "transferir para RH", "passar para vendas"
function detectExplicitTransferRequest(content: string): string | null {
  const lowerContent = content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Patterns for transfer requests
  const transferPatterns = [
    /transferir?\s*(para|pro|pra)\s+(\w+)/i,
    /passar?\s*(para|pro|pra)\s+(\w+)/i,
    /falar?\s+com\s+(o\s+)?(\w+)/i,
    /encaminhar?\s*(para|pro|pra)\s+(\w+)/i,
    /direcionar?\s*(para|pro|pra)\s+(\w+)/i,
    /me\s+(passa|transfere|encaminha)\s+(para|pro|pra)\s+(\w+)/i
  ];
  
  // Department mappings
  const departmentMap: Record<string, string> = {
    "rh": "RH",
    "recursos humanos": "RH",
    "hr": "RH",
    "vendas": "VENDAS",
    "comercial": "VENDAS",
    "sales": "VENDAS",
    "suporte": "SUPORTE",
    "support": "SUPORTE",
    "atendimento": "SUPORTE",
    "marketing": "MARKETING",
    "mkt": "MARKETING",
    "eventos": "EVENTOS",
    "evento": "EVENTOS",
    "juridico": "JURIDICO",
    "legal": "JURIDICO",
    "financeiro": "FINANCEIRO",
    "financas": "FINANCEIRO",
    "finance": "FINANCEIRO",
    "tecnico": "TECNICO",
    "ti": "TECNICO",
    "tech": "TECNICO",
    "parcerias": "PARCERIAS",
    "parceria": "PARCERIAS",
    "humano": "HUMANO",
    "pessoa": "HUMANO",
    "atendente": "HUMANO"
  };
  
  for (const pattern of transferPatterns) {
    const match = lowerContent.match(pattern);
    if (match) {
      // Get the last captured group which should be the department
      const department = match[match.length - 1]?.toLowerCase();
      if (department && departmentMap[department]) {
        return departmentMap[department];
      }
    }
  }
  
  // Check for simple mentions
  for (const [keyword, category] of Object.entries(departmentMap)) {
    if (lowerContent.includes(`para ${keyword}`) || 
        lowerContent.includes(`pro ${keyword}`) ||
        lowerContent.includes(`pra ${keyword}`)) {
      return category;
    }
  }
  
  return null;
}

// Analyze current message sentiment only (for new sessions)
export async function analyzeCurrentMessageSentiment(
  currentMessage: string,
  apiKey: string
): Promise<number> {
  console.log("[SENTIMENT] Analyzing current message sentiment...");
  
  const sentimentPrompt = `Analise APENAS esta mensagem e retorne um score de sentimento de 1 a 10.
1 = muito frustrado/irritado
5 = neutro
10 = muito satisfeito/feliz

Mensagem: "${currentMessage}"

Responda APENAS com um número de 1 a 10. Nada mais.`;

  try {
    const startTime = Date.now();
    
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
          messages: [{ role: "user", content: sentimentPrompt }],
          max_tokens: 10,
        }),
      },
      10000
    );

    console.log(`[SENTIMENT] API call completed in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      return 5;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "5";
    const score = parseInt(content, 10);
    
    if (isNaN(score) || score < 1 || score > 10) {
      return 5;
    }
    
    console.log(`[SENTIMENT] Score: ${score}/10`);
    return score;
  } catch (error) {
    console.error("[SENTIMENT] Error:", error);
    return 5;
  }
}

// Analyze full conversation insights
export async function analyzeConversationInsights(
  conversationHistory: { role: string; content: string }[],
  currentMessage: string,
  apiKey: string,
  dynamicCategories: string[] = []
): Promise<ConversationInsights> {
  console.log("[INSIGHTS] Analyzing conversation insights...");
  
  const limitedHistory = conversationHistory.slice(-HISTORY_LIMIT);
  console.log(`[INSIGHTS] Using ${limitedHistory.length}/${conversationHistory.length} messages`);
  
  const historyText = limitedHistory.map(m => 
    `${m.role === "user" ? "Lead" : "Assistente"}: ${m.content}`
  ).join("\n");

  // Include dynamic categories in specialist options
  const defaultCategories = ["VENDAS", "SUPORTE", "RH", "MARKETING"];
  const allSpecialists = [...new Set([...defaultCategories, ...dynamicCategories.filter(c => c !== "GERAL" && c !== "HUMANO" && c !== "OBJECAO")])];

  const insightsPrompt = `Analise esta conversa e a mensagem mais recente do lead para gerar insights estruturados.

HISTÓRICO DA CONVERSA (últimas ${limitedHistory.length} mensagens):
${historyText}

MENSAGEM ATUAL DO LEAD:
${currentMessage}

Especialistas disponíveis: ${allSpecialists.join(", ")}

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com esta estrutura exata:
{
  "sentiment_score": <número de 1-10, onde 1=muito frustrado e 10=muito satisfeito>,
  "sentiment_label": "<frustrado|neutro|satisfeito|entusiasmado>",
  "objections": [
    {
      "type": "<preco|tempo|confianca|concorrencia|funcionalidade|outro>",
      "description": "<descrição curta da objeção>",
      "suggested_response": "<sugestão de como quebrar esta objeção>",
      "severity": <número de 1-5>
    }
  ],
  "purchase_intent": <número de 0-100 representando % de chance de conversão>,
  "urgency_level": "<baixa|media|alta|critica>",
  "suggested_specialist": "<${allSpecialists.join("|")}|null se não precisa>",
  "suggested_action": "<próxima ação recomendada em uma frase>",
  "conversation_summary": "<resumo da conversa em 2-3 frases>"
}

Se não houver objeções, retorne array vazio. Seja preciso e objetivo.`;

  try {
    const startTime = Date.now();
    
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
          messages: [{ role: "user", content: insightsPrompt }],
          max_tokens: 600,
        }),
      },
      API_TIMEOUT_MS
    );

    console.log(`[INSIGHTS] API call completed in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      return getDefaultInsights();
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    
    try {
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const insights = JSON.parse(cleanedContent) as ConversationInsights;
      console.log("[INSIGHTS] Parsed successfully");
      return insights;
    } catch (parseError) {
      console.error("[INSIGHTS] JSON parse error:", parseError);
      return getDefaultInsights();
    }
  } catch (error) {
    console.error("[INSIGHTS] Error:", error);
    return getDefaultInsights();
  }
}

// Employee count dropdown options
const EMPLOYEE_COUNT_OPTIONS = [
  "Eu S.A.",
  "1-10 funcionarios",
  "11-50 funcionarios", 
  "51-200 funcionarios",
  "+200 funcionarios"
];

// Revenue dropdown options
const REVENUE_OPTIONS = [
  "Ate 100k/mes",
  "Entre 100k e 500k/mes",
  "Entre 500k e 1MM/mes",
  "Entre 1MM e 3MM/mes",
  "Entre 3MM e 5MM/mes",
  "Acima de 5MM/mes"
];

// Map extracted employee count to dropdown option
function mapEmployeeCount(extracted: string | null): string | null {
  if (!extracted) return null;
  
  const normalized = extracted.toLowerCase().replace(/\s+/g, '');
  
  // Check for solo/1 person
  if (normalized.includes('solo') || normalized.includes('eus.a') || normalized === '1' || normalized.includes('sozinho')) {
    return "Eu S.A.";
  }
  
  // Extract numbers
  const numbers = extracted.match(/\d+/g)?.map(Number) || [];
  const maxNum = Math.max(...numbers, 0);
  
  if (maxNum === 0 && numbers.length === 0) {
    // Try text-based matching
    if (normalized.includes('pequen') || normalized.includes('micro')) return "1-10 funcionarios";
    if (normalized.includes('medi')) return "51-200 funcionarios";
    if (normalized.includes('grand')) return "+200 funcionarios";
    return null;
  }
  
  if (maxNum <= 1) return "Eu S.A.";
  if (maxNum <= 10) return "1-10 funcionarios";
  if (maxNum <= 50) return "11-50 funcionarios";
  if (maxNum <= 200) return "51-200 funcionarios";
  return "+200 funcionarios";
}

// Map extracted revenue to dropdown option
function mapRevenue(extracted: string | null): string | null {
  if (!extracted) return null;
  
  const normalized = extracted.toLowerCase().replace(/\s+/g, '');
  
  // Try to extract monetary value
  let monthlyValue = 0;
  
  // Check for millions (MM, M, milhao, milhoes)
  const millionMatch = extracted.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|m(?:ilh[oõ](?:es|ao)?)?)/i);
  if (millionMatch) {
    const value = parseFloat(millionMatch[1].replace(',', '.'));
    // Check if it's annual (ano/anual) and convert to monthly
    if (normalized.includes('ano') || normalized.includes('anual') || normalized.includes('a.a')) {
      monthlyValue = (value * 1000000) / 12;
    } else {
      monthlyValue = value * 1000000;
    }
  }
  
  // Check for thousands (k, mil)
  if (monthlyValue === 0) {
    const thousandMatch = extracted.match(/(\d+(?:[.,]\d+)?)\s*(?:k|mil)/i);
    if (thousandMatch) {
      const value = parseFloat(thousandMatch[1].replace(',', '.'));
      if (normalized.includes('ano') || normalized.includes('anual') || normalized.includes('a.a')) {
        monthlyValue = (value * 1000) / 12;
      } else {
        monthlyValue = value * 1000;
      }
    }
  }
  
  // Check for plain numbers with R$
  if (monthlyValue === 0) {
    const plainMatch = extracted.match(/r?\$?\s*(\d+(?:[.,]\d+)?)/i);
    if (plainMatch) {
      const value = parseFloat(plainMatch[1].replace(',', '.'));
      // Assume large numbers are annual if > 1M without monthly indicator
      if (value >= 1000000 && !normalized.includes('mes') && !normalized.includes('mensal')) {
        monthlyValue = value / 12;
      } else {
        monthlyValue = value;
      }
    }
  }
  
  if (monthlyValue === 0) return null;
  
  // Map to dropdown options (values are monthly)
  if (monthlyValue < 100000) return "Ate 100k/mes";
  if (monthlyValue < 500000) return "Entre 100k e 500k/mes";
  if (monthlyValue < 1000000) return "Entre 500k e 1MM/mes";
  if (monthlyValue < 3000000) return "Entre 1MM e 3MM/mes";
  if (monthlyValue < 5000000) return "Entre 3MM e 5MM/mes";
  return "Acima de 5MM/mes";
}

// Extract contact data from conversation (company, employees, revenue, phone)
export async function extractContactData(
  conversationHistory: { role: string; content: string }[],
  currentMessage: string,
  apiKey: string,
  opts?: { tenantNames?: string[] }
): Promise<{ company?: string; employee_count?: string; revenue?: string; email?: string; name?: string; phone?: string }> {
  console.log("[CONTACT-EXTRACT] Extracting contact data from conversation...");

  const limitedHistory = conversationHistory.slice(-HISTORY_LIMIT);

  // As linhas do atendente sao marcadas de forma inequivoca: e delas que vinha a
  // contaminacao (o agente se apresenta com o nome da empresa que atende, e os
  // lembretes de reuniao carregam o link do proprio produto).
  const historyText = limitedHistory.map(m =>
    m.role === "user"
      ? `[LEAD] ${m.content}`
      : `[ATENDENTE - NAO EXTRAIA DADOS DESTA LINHA] ${m.content}`
  ).join("\n");

  const tenantNames = (opts?.tenantNames || []).filter(n => n && n.trim());
  const blockedList = tenantNames.length > 0
    ? tenantNames.map(n => `"${n}"`).join(", ")
    : "(nenhum nome adicional)";

  const extractPrompt = `Analise esta conversa e extraia informações de contato/empresa mencionadas.

HISTÓRICO DA CONVERSA:
${historyText}

MENSAGEM ATUAL DO LEAD:
${currentMessage}

REGRA CRÍTICA DE ORIGEM:
- Extraia SOMENTE dados ditos pelo próprio LEAD (linhas [LEAD] e a mensagem atual).
- As linhas [ATENDENTE] são da empresa que PRESTA o atendimento. NUNCA extraia nome, empresa, email, telefone ou links delas.
- "company" é a empresa ONDE O LEAD TRABALHA, nunca a empresa que o está atendendo.
- Se a empresa aparecer apenas em linha [ATENDENTE], em um link, em assinatura ou em saudação ("aqui é a Ana da X"), retorne null em "company".
- NUNCA extraia como dado do lead: ${blockedList}, "Nexus", "dn.ia", "dnia.ai", "nexus.dnia.ai".

Extraia APENAS informações que foram EXPLICITAMENTE mencionadas na conversa.
Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com esta estrutura:
{
  "name": "<nome do lead se mencionado, ou null>",
  "email": "<email se mencionado, ou null>",
  "phone": "<telefone se mencionado em qualquer formato, ou null>",
  "company": "<nome da empresa se mencionado, ou null>",
  "employee_count": "<número aproximado de funcionários se mencionado (ex: '1', '15', '150', '500'), ou null>",
  "revenue": "<faturamento se mencionado com indicação se é mensal ou anual (ex: 'R$ 1M/mes', 'R$ 10M/ano', '500k mensal'), ou null>"
}

IMPORTANTE: 
- Retorne null para campos NÃO mencionados. Não invente dados.
- Para phone, extraia qualquer formato de telefone mencionado (ex: "31 99999-9999", "(11) 98765-4321").
- Para employee_count, extraia o número aproximado mencionado.
- Para revenue, mantenha a indicação de período (mes/ano) se mencionada.`;

  try {
    const startTime = Date.now();
    
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
          messages: [{ role: "user", content: extractPrompt }],
          max_tokens: 200,
        }),
      },
      10000
    );

    console.log(`[CONTACT-EXTRACT] API call completed in ${Date.now() - startTime}ms`);

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    
    try {
      const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const extracted = JSON.parse(cleanedContent);
      
      // Map extracted values to dropdown options
      const mappedEmployeeCount = mapEmployeeCount(extracted.employee_count);
      const mappedRevenue = mapRevenue(extracted.revenue);
      
      // Filter out null values and use mapped values
      const result: Record<string, string> = {};
      if (extracted.name) result.name = extracted.name;
      if (extracted.email) result.email = extracted.email;
      if (extracted.phone) result.phone = extracted.phone;
      if (extracted.company) result.company = extracted.company;
      if (mappedEmployeeCount) result.employee_count = mappedEmployeeCount;
      if (mappedRevenue) result.revenue = mappedRevenue;
      
      console.log("[CONTACT-EXTRACT] Raw extracted:", extracted);

      // Guarda deterministica. O prompt acima e mitigacao -- gemini-2.5-flash-lite
      // e fraco demais para ser a unica linha de defesa. Aqui nada passa sem ter
      // saido de uma fala do lead e sem escapar da blocklist do tenant.
      // Usa o MESMO limitedHistory que foi ao prompt: ampliar a janela so
      // aumentaria falso-positivo.
      const guard = buildTenantGuard(tenantNames);
      const { clean, rejected } = sanitizeExtractedContactData({
        extracted: result,
        history: limitedHistory,
        currentMessage,
        guard,
      });

      for (const r of rejected) {
        console.warn(`[CONTACT-EXTRACT] REJEITADO field=${r.field} value="${r.value}" reason=${r.reason}`);
      }

      console.log("[CONTACT-EXTRACT] Mapped result:", clean);
      return clean;
    } catch (parseError) {
      console.error("[CONTACT-EXTRACT] JSON parse error:", parseError);
      return {};
    }
  } catch (error) {
    console.error("[CONTACT-EXTRACT] Error:", error);
    return {};
  }
}
