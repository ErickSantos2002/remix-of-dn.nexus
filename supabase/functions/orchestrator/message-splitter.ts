// Message splitting and sequential sending module
// Humanizes AI responses by breaking into smaller chunks with delays

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Configuration — Humanized delays (Feature 4: Anti-ban)
const MIN_DELAY_MS = 1500;  // 1.5 second minimum
const MAX_DELAY_MS = 3500;  // 3.5 seconds maximum
const MIN_CHUNK_LENGTH = 50;   // Don't split very short messages
const BASE_MAX_CHUNK_LENGTH = 300;  // Base max, randomized per split call

interface MessageChunk {
  content: string;
  index: number;
}

// Split message into natural chunks with randomized max length (Feature 4: Anti-ban)
export function splitMessage(content: string): MessageChunk[] {
  const trimmed = content.trim();

  // Randomize max chunk length per call: 220-380 chars (instead of fixed 300)
  const maxChunkLength = 220 + Math.floor(Math.random() * 161);

  // If message is short enough, don't split
  if (trimmed.length <= maxChunkLength) {
    return [{ content: trimmed, index: 0 }];
  }

  const chunks: MessageChunk[] = [];

  // First, split by double newlines (paragraphs)
  const paragraphs = trimmed.split(/\n\n+/).filter(p => p.trim());

  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const para = paragraph.trim();

    // If paragraph itself is too long, split by sentences
    if (para.length > maxChunkLength) {
      // Save current chunk first
      if (currentChunk.trim()) {
        chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });
        currentChunk = "";
      }

      // Split long paragraph by sentences
      const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
      let sentenceChunk = "";

      for (const sentence of sentences) {
        if ((sentenceChunk + sentence).length <= maxChunkLength) {
          sentenceChunk += sentence;
        } else {
          if (sentenceChunk.trim()) {
            chunks.push({ content: sentenceChunk.trim(), index: chunkIndex++ });
          }
          sentenceChunk = sentence;
        }
      }

      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
    } else {
      // Normal paragraph - try to combine with current chunk
      if ((currentChunk + "\n\n" + para).length <= maxChunkLength) {
        currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
      } else {
        if (currentChunk.trim()) {
          chunks.push({ content: currentChunk.trim(), index: chunkIndex++ });
        }
        currentChunk = para;
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), index: chunkIndex });
  }

  console.log(`[SPLITTER] Split message into ${chunks.length} chunks (maxChunkLength=${maxChunkLength})`);
  return chunks;
}

// Calculate humanized delay based on chunk length (Feature 4: Anti-ban)
// Variable delays with random jitter + night factor to avoid detection
function calculateDelay(chunkLength: number): number {
  // Simulate ~45 chars/second typing speed (slower than before)
  const baseDelay = (chunkLength / 45) * 1000;
  // Random jitter: -500ms to +1500ms
  const randomJitter = Math.random() * 2000 - 500;
  let delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, baseDelay + randomJitter));

  // Night factor (22h-7h Brazil time UTC-3): delays 50% longer
  const utcHour = new Date().getUTCHours();
  const brazilHour = (utcHour - 3 + 24) % 24;
  if (brazilHour < 7 || brazilHour >= 22) {
    delay *= 1.5;
  }

  return Math.round(delay);
}

// Check if lead sent any message while we were processing
async function checkForLeadInterruption(
  supabase: SupabaseClient,
  leadId: string,
  afterTimestamp: string
): Promise<{ interrupted: boolean; newMessage?: string }> {
  const { data: newMessages } = await supabase
    .from("messages")
    .select("content, created_at")
    .eq("lead_id", leadId)
    .eq("sender_type", "lead")
    .gt("created_at", afterTimestamp)
    .order("created_at", { ascending: false })
    .limit(1);

  if (newMessages && newMessages.length > 0) {
    const msg = newMessages[0] as { content: string; created_at: string };
    console.log(`[SPLITTER] Lead interrupted with: "${msg.content}"`);
    return { interrupted: true, newMessage: msg.content };
  }
  
  return { interrupted: false };
}

// Evaluate if interruption affects remaining message
async function evaluateInterruption(
  newMessage: string,
  remainingContent: string,
  apiKey: string
): Promise<{ shouldContinue: boolean; adaptedResponse?: string }> {
  console.log(`[SPLITTER] Evaluating if interruption affects response...`);
  
  const prompt = `Você está no meio de enviar uma resposta para um cliente, e ele interrompeu.

MENSAGEM DO CLIENTE:
"${newMessage}"

O QUE VOCÊ AINDA IA ENVIAR:
"${remainingContent}"

Analise:
1. A mensagem do cliente é apenas uma confirmação simples (ok, beleza, entendi, etc)?
2. A mensagem do cliente torna o resto da sua resposta irrelevante ou inadequada?

Responda em JSON:
{
  "shouldContinue": true/false,
  "reason": "explicação curta"
}

- shouldContinue=true: se a interrupção é só uma confirmação ou não afeta o resto
- shouldContinue=false: se a mensagem muda o assunto ou torna a resposta obsoleta`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      // If AI fails, default to NOT continuing (safer)
      return { shouldContinue: false };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[SPLITTER] Evaluation: shouldContinue=${parsed.shouldContinue}, reason=${parsed.reason}`);
      return { shouldContinue: parsed.shouldContinue === true };
    }
    
    return { shouldContinue: false };
  } catch (error) {
    console.error("[SPLITTER] Evaluation error:", error);
    return { shouldContinue: false };
  }
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function: send message chunks with delays and interruption handling
export async function sendMessageChunks(
  supabase: SupabaseClient,
  leadId: string,
  workspaceId: string,
  agentId: string,
  fullContent: string,
  apiKey: string,
  startTimestamp: string
): Promise<{ 
  sentChunks: number; 
  interrupted: boolean; 
  interruptingMessage?: string;
}> {
  const chunks = splitMessage(fullContent);
  
  // If only one chunk, just save it normally (no splitting needed)
  if (chunks.length === 1) {
    await supabase.from("messages").insert({
      lead_id: leadId,
      workspace_id: workspaceId,
      content: chunks[0].content,
      sender_type: "ai",
      agent_id: agentId,
      responding_agent_id: agentId,
    });
    return { sentChunks: 1, interrupted: false };
  }
  
  console.log(`[SPLITTER] Sending ${chunks.length} message chunks...`);
  let sentCount = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Check for interruption BEFORE sending each chunk (except the first)
    if (i > 0) {
      const interruptionCheck = await checkForLeadInterruption(supabase, leadId, startTimestamp);
      
      if (interruptionCheck.interrupted) {
        // Evaluate if we should continue
        const remainingContent = chunks.slice(i).map(c => c.content).join("\n\n");
        const evaluation = await evaluateInterruption(
          interruptionCheck.newMessage!,
          remainingContent,
          apiKey
        );
        
        if (!evaluation.shouldContinue) {
          console.log(`[SPLITTER] Stopping after ${sentCount} chunks due to interruption`);
          return { 
            sentChunks: sentCount, 
            interrupted: true, 
            interruptingMessage: interruptionCheck.newMessage 
          };
        }
        
        console.log(`[SPLITTER] Continuing despite interruption (confirmed as non-blocking)`);
      }
    }
    
    // Save this chunk
    await supabase.from("messages").insert({
      lead_id: leadId,
      workspace_id: workspaceId,
      content: chunk.content,
      sender_type: "ai",
      agent_id: agentId,
      responding_agent_id: agentId,
    });
    
    sentCount++;
    console.log(`[SPLITTER] Sent chunk ${i + 1}/${chunks.length}`);
    
    // Add delay before next chunk (except after last)
    if (i < chunks.length - 1) {
      const delay = calculateDelay(chunk.content.length);
      console.log(`[SPLITTER] Waiting ${delay}ms before next chunk...`);
      await sleep(delay);
    }
  }
  
  return { sentChunks: sentCount, interrupted: false };
}
