// RAG retrieval module - semantic and keyword search for relevant documents
// Using native fetch for embeddings with timeout for better performance
import { getOpenAIKey, OpenAIError } from "../_shared/openaiCredentials.ts";

// Patterns that indicate the user wants more info about something mentioned before
const CONTINUATION_PATTERNS = [
  // Very short messages (under 40 chars) often need context
  /^.{1,40}$/,
  // Affirmations and short confirmations
  /^(por favor|sim|quero|gostaria|ok|claro|certo|beleza|blz|show|top|vai|manda|bora|continua|pode|prossiga)/i,
  // Requests for more info
  /^(me (explique|fale|conte|diz|diga|fala)|quero (saber|entender)|pode (detalhar|explicar)|explique|detalhe|aprofunde)/i,
  // Questions about "others", "more", etc
  /\b(outr[oa]s?|mais|demais|algum|alguns?|alguma?s?)\b/i,
  // References like "me refiro a", "sobre isso", "a respeito"
  /\b(refiro|sobre (isso|esse|essa|aqui)|a respeito|em relação|quanto a|nisso|disso|desse|dessa)\b/i,
  // Comparative/continuation words
  /\b(também|além|adicionalmente|inclusive|ainda|similar|parecid[oa]|mesm[oa])\b/i
];

// Words that should be STRIPPED from queries (they don't carry topic meaning)
const NOISE_WORDS = new Set([
  'me', 'eu', 'você', 'voce', 'refiro', 'favor', 'por', 'pode', 'poderia',
  'quais', 'qual', 'outras', 'outros', 'outra', 'outro', 'mais', 'algumas', 'alguns',
  'isso', 'esse', 'essa', 'este', 'esta', 'aqui', 'la', 'lá',
  'sobre', 'explique', 'explica', 'fale', 'fala', 'diga', 'diz', 'conte', 'conta',
  'quero', 'gostaria', 'saber', 'entender', 'conhecer', 'aprender',
  'sim', 'nao', 'não', 'ok', 'certo', 'claro', 'beleza', 'show', 'top',
  'também', 'tambem', 'ainda', 'já', 'ja'
]);

// Extract the main topic from a message (stripping noise words)
function extractMainTopic(message: string): string {
  const words = message.toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !NOISE_WORDS.has(w));
  
  return words.join(' ');
}

// Check if current message is a continuation/follow-up
function isContinuationQuestion(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return CONTINUATION_PATTERNS.some(p => p.test(trimmed));
}

// Build enhanced query using conversation context - extracts REAL TOPIC
export function buildEnhancedQuery(
  currentMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  const trimmed = currentMessage.trim();
  
  // Check if this looks like a continuation question
  const needsContext = isContinuationQuestion(trimmed);
  
  if (!needsContext) {
    console.log(`[RAG] Query is self-contained, using as-is`);
    return currentMessage;
  }
  
  if (conversationHistory.length === 0) {
    console.log(`[RAG] No history available for context`);
    return currentMessage;
  }
  
  console.log(`[RAG] Detected continuation question, looking for topic in history...`);
  
  // Get ONLY USER messages to find the topic
  const userMessages = conversationHistory
    .filter(msg => msg.role === "user")
    .slice(-6);  // Last 6 user messages
  
  // Find the last SUBSTANTIVE user question (not another short follow-up)
  let topicMessage = "";
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    const content = msg.content.trim();
    
    // Skip the current message itself
    if (content.toLowerCase() === trimmed.toLowerCase()) {
      continue;
    }
    
    // Skip short follow-ups (likely other continuations)
    if (content.length < 25 && isContinuationQuestion(content)) {
      continue;
    }
    
    // This looks like a real topic message
    topicMessage = content;
    break;
  }
  
  if (!topicMessage) {
    console.log(`[RAG] No substantive topic found in history`);
    return currentMessage;
  }
  
  // Extract the core topic from the found message
  const topic = extractMainTopic(topicMessage);
  const currentTopic = extractMainTopic(trimmed);
  
  // Combine: topic from history + any new terms from current message
  let enhancedQuery = topic;
  if (currentTopic && currentTopic !== topic) {
    enhancedQuery = `${topic} ${currentTopic}`;
  }
  
  console.log(`[RAG] Topic extracted from: "${topicMessage.substring(0, 50)}..."`);
  console.log(`[RAG] Enhanced query: "${enhancedQuery}"`);
  
  return enhancedQuery;
}

// Extract important keywords from query for exact matching
function extractKeywords(query: string): string[] {
  // Extended Portuguese stopwords
  const stopWords = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
    'que', 'e', 'em', 'na', 'no', 'nas', 'nos', 'para', 'pra', 'com', 'por', 'pela', 'pelo',
    'como', 'muito', 'muita', 'pouco', 'toda', 'todo', 'ser', 'estar', 'ter', 'haver',
    'foi', 'era', 'será', 'seria', 'tem', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa',
    'bem', 'bom', 'boa', 'melhor', 'pior', 'menos',
    // Already in NOISE_WORDS but keep here for safety
    ...NOISE_WORDS
  ]);
  
  // Clean and split query
  const cleanQuery = query.toLowerCase().replace(/[?!.,;:'"()[\]{}]/g, '');
  const words = cleanQuery.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  
  // Look for potential acronyms (uppercase sequences in original query)
  const acronyms = query.match(/\b[A-Z]{2,}\.?[A-Z]*\.?\b/g) || [];
  const cleanAcronyms = acronyms.map(a => a.toLowerCase().replace(/\./g, ''));
  
  // Prioritize: acronyms first, then longer words (more specific terms)
  const sortedWords = words.sort((a, b) => b.length - a.length);
  const allKeywords = [...new Set([...cleanAcronyms, ...sortedWords])];
  
  console.log(`[RAG] Keywords: ${allKeywords.slice(0, 8).join(', ')}`);
  
  return allKeywords.slice(0, 8); // Limit to 8 keywords max
}

// Retrieve relevant documents - combines semantic + keyword for better results
export async function retrieveRelevantDocuments(
  supabase: any,
  query: string,
  knowledgeBaseIds: string[],
  conversationHistory: Array<{ role: string; content: string }> = [],
  workspaceId: string
): Promise<string[]> {
  console.log("[RAG] === HYBRID RETRIEVAL ===");
  console.log("[RAG] Original query:", query);
  
  // Enhance query with conversation context if needed
  const searchQuery = buildEnhancedQuery(query, conversationHistory);
  
  console.log("[RAG] Search query:", searchQuery.substring(0, 120) + (searchQuery.length > 120 ? "..." : ""));
  console.log("[RAG] Knowledge bases:", knowledgeBaseIds.length);
  
  if (knowledgeBaseIds.length === 0) {
    console.log("[RAG] No knowledge bases, skipping RAG");
    return [];
  }

  // Extract keywords from the enhanced/topic query
  const keywords = extractKeywords(searchQuery);

  // OPTIMIZATION: For short queries (<50 chars), use keyword-only search (faster)
  if (searchQuery.length < 50) {
    console.log("[RAG] Short query - using keyword-only search for speed");
    const keywordResults = await performKeywordSearch(supabase, keywords, knowledgeBaseIds);
    return keywordResults.map((doc: any) => doc.content).slice(0, 5);
  }

  // Run BOTH searches in parallel for speed
  const [semanticResults, keywordResults] = await Promise.all([
    performSemanticSearch(supabase, searchQuery, knowledgeBaseIds, workspaceId),
    performKeywordSearch(supabase, keywords, knowledgeBaseIds)
  ]);

  // Combine and deduplicate results, prioritizing keyword matches
  const combinedResults = combineResults(keywordResults, semanticResults);
  
  console.log(`[RAG] Combined: ${combinedResults.length} docs (kw: ${keywordResults.length}, sem: ${semanticResults.length})`);
  
  return combinedResults.slice(0, 5);
}

// Perform semantic search
async function performSemanticSearch(
  supabase: any,
  query: string,
  knowledgeBaseIds: string[],
  workspaceId: string
): Promise<Array<{ id: number; content: string; similarity: number }>> {
  const queryEmbedding = await generateQueryEmbedding(query, workspaceId);
  
  if (!queryEmbedding) {
    return [];
  }

  try {
    const { data: semanticResults, error: semanticError } = await supabase.rpc(
      'match_documents',
      {
        query_embedding: JSON.stringify(queryEmbedding),
        filter_knowledge_base_ids: knowledgeBaseIds,
        match_count: 5,
        match_threshold: 0.25,
      }
    );

    if (semanticError) {
      console.error("[RAG] Semantic error:", semanticError);
      return [];
    }

    const validResults = (semanticResults || []).filter((doc: any) => {
      const similarity = typeof doc.similarity === 'number' ? doc.similarity : parseFloat(doc.similarity || '0');
      return !isNaN(similarity) && similarity > 0 && doc.content;
    });
    
    console.log(`[RAG] Semantic: ${validResults.length} matches`);
    
    return validResults;
  } catch (error) {
    console.error("[RAG] Semantic exception:", error);
    return [];
  }
}

// Perform keyword-based search for exact term matches
async function performKeywordSearch(
  supabase: any,
  keywords: string[],
  knowledgeBaseIds: string[]
): Promise<Array<{ id: number; content: string; similarity: number }>> {
  if (keywords.length === 0) {
    return [];
  }

  try {
    const { data: allDocs, error } = await supabase
      .from("documents")
      .select("id, content")
      .in("knowledge_base_id", knowledgeBaseIds);

    if (error || !allDocs) {
      console.error("[RAG] Keyword error:", error);
      return [];
    }

    // Score documents based on keyword matches
    const primaryKeyword = keywords[0];
    const scoredDocs = allDocs
      .map((doc: any) => {
        const contentLower = (doc.content || "").toLowerCase();
        let score = 0;
        const matchedKeywords: string[] = [];
        
        // Check all keywords
        for (const keyword of keywords) {
          if (contentLower.includes(keyword)) {
            score += keyword === primaryKeyword ? 10 : 2;
            matchedKeywords.push(keyword);
            
            // Bonus for word boundary match
            const wordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
            if (wordPattern.test(doc.content)) {
              score += 3;
            }
          }
        }
        
        return { ...doc, score, matchedKeywords, similarity: score / 15 };
      })
      .filter((doc: any) => doc.score > 5) // Must have meaningful matches
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5);

    console.log(`[RAG] Keyword: ${scoredDocs.length} matches for "${primaryKeyword}"`);

    return scoredDocs;
  } catch (error) {
    console.error("[RAG] Keyword exception:", error);
    return [];
  }
}

// Combine results prioritizing keyword matches
function combineResults(
  keywordResults: Array<{ id: number; content: string; similarity: number }>,
  semanticResults: Array<{ id: number; content: string; similarity: number }>
): string[] {
  const seen = new Set<number>();
  const combined: string[] = [];

  // Add keyword matches first (exact term matches)
  for (const doc of keywordResults) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      combined.push(doc.content);
    }
  }

  // Then add semantic matches
  for (const doc of semanticResults) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      combined.push(doc.content);
    }
  }

  return combined;
}

// Generate embedding for query using OpenAI with Promise.race + AbortController for GUARANTEED timeout
async function generateQueryEmbedding(text: string, workspaceId: string): Promise<number[] | null> {
  let openaiApiKey: string;
  try {
    const creds = await getOpenAIKey(workspaceId);
    openaiApiKey = creds.apiKey;
  } catch (err) {
    if (err instanceof OpenAIError) {
      console.warn(`[RAG] OpenAI indisponivel: ${err.userMessage} (code=${err.code}) - fallback para keyword search`);
    } else {
      console.error("[RAG] Erro ao obter chave da OpenAI:", err);
    }
    return null;
  }
  
  // Truncate to 500 chars for faster embedding
  const truncatedText = text.length > 500 ? text.substring(0, 500) : text;
  
  const startTime = Date.now();
  // OPTIMIZATION: Reduced from 5000ms to 2000ms - faster fallback to keyword search
  const TIMEOUT_MS = 2000;
  
  // AbortController para cancelar o fetch
  const controller = new AbortController();
  
  // Promise de timeout que TAMBÉM aborta - garantia de 2s max
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => {
      controller.abort(); // Cancela o fetch
      const elapsed = Date.now() - startTime;
      console.log(`[RAG] Embedding TIMEOUT after ${elapsed}ms - fallback to keyword search`);
      resolve(null);
    }, TIMEOUT_MS);
  });
  
  // Promise do fetch
  const fetchPromise = (async (): Promise<number[] | null> => {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: truncatedText,
          encoding_format: "float",
        }),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        console.error("[RAG] OpenAI embedding error:", response.status);
        return null;
      }
      
      const data = await response.json();
      const embedding = data.data?.[0]?.embedding;
      
      console.log(`[RAG] Embedding via OpenAI: ${Date.now() - startTime}ms`);
      return embedding;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Timeout já logou, só retorna null
        return null;
      }
      console.error("[RAG] Embedding fetch error:", error);
      return null;
    }
  })();
  
  // Promise.race: quem resolver primeiro ganha!
  return Promise.race([fetchPromise, timeoutPromise]);
}
