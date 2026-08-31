import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://deno.land/x/openai@v4.24.0/mod.ts";
import { getOpenAIKey, OpenAIError } from "../_shared/openaiCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Optimized for OpenAI Embeddings API
const BATCH_SIZE = 10; // Process 10 chunks in parallel
const DELAY_BETWEEN_BATCHES_MS = 100; // 100ms delay between batches
const MAX_RETRIES = 3;
const MAX_EXECUTION_TIME_MS = 50000; // 50 seconds (safety margin for 60s timeout)

// Generate embedding using OpenAI's text-embedding-3-small model
async function generateEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  // Truncate to ~8000 chars (model supports 8191 tokens)
  const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;
  
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: truncatedText,
    encoding_format: "float",
  });
  
  // Returns 1536-dimensional embedding natively
  return response.data[0].embedding;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Process embeddings for a job in background
async function processEmbeddingsForJob(
  supabase: any,
  jobId: string,
  openai: OpenAI,
  startTime: number
): Promise<{ completed: boolean; processed: number }> {
  console.log(`[EMBEDDINGS] Starting for job: ${jobId}`);
  
  // Update status to processing
  await supabase
    .from("document_processing_jobs")
    .update({ embedding_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  // Get chunks without embeddings for this job
  const { data: chunks, error: fetchError } = await supabase
    .from("documents")
    .select("id, content, metadata")
    .eq("metadata->>job_id", jobId)
    .is("embedding", null)
    .order("id", { ascending: true });

  if (fetchError) {
    console.error("[EMBEDDINGS] Fetch error:", fetchError);
    await supabase
      .from("document_processing_jobs")
      .update({ 
        embedding_status: "failed", 
        error_message: `Erro ao buscar chunks: ${fetchError.message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", jobId);
    return { completed: false, processed: 0 };
  }

  if (!chunks || chunks.length === 0) {
    console.log("[EMBEDDINGS] No chunks to process - marking as completed");
    await supabase
      .from("document_processing_jobs")
      .update({ 
        embedding_status: "completed",
        updated_at: new Date().toISOString()
      })
      .eq("id", jobId);
    return { completed: true, processed: 0 };
  }

  console.log(`[EMBEDDINGS] Processing ${chunks.length} chunks`);

  // Update total count
  await supabase
    .from("document_processing_jobs")
    .update({ 
      embeddings_total: chunks.length,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId);

  let successCount = 0;
  let failCount = 0;

  // Process in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    // Check if we're running out of time
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_EXECUTION_TIME_MS) {
      console.log(`[EMBEDDINGS] Timeout approaching (${elapsed}ms). Processed ${successCount}/${chunks.length}. Marking as incomplete.`);
      
      await supabase
        .from("document_processing_jobs")
        .update({ 
          embedding_status: "incomplete",
          embeddings_generated: successCount,
          error_message: `Timeout: ${successCount}/${chunks.length} processados. Continuando...`,
          updated_at: new Date().toISOString()
        })
        .eq("id", jobId);
      
      return { completed: false, processed: successCount };
    }

    const batch = chunks.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (chunk: any) => {
        let retries = 0;
        while (retries < MAX_RETRIES) {
          try {
            const embedding = await generateEmbedding(openai, chunk.content);
            
            const { error: updateError } = await supabase
              .from("documents")
              .update({ embedding: JSON.stringify(embedding) })
              .eq("id", chunk.id);

            if (updateError) {
              console.error(`[EMBEDDING] Update error for ${chunk.id}:`, updateError);
              return false;
            }
            return true;
          } catch (error) {
            retries++;
            console.error(`[EMBEDDING] Error for chunk ${chunk.id} (attempt ${retries}):`, error);
            
            if (retries < MAX_RETRIES) {
              await sleep(1000 * retries); // Exponential backoff
            }
          }
        }
        return false;
      })
    );

    results.forEach(success => {
      if (success) successCount++;
      else failCount++;
    });

    // Update progress
    await supabase
      .from("document_processing_jobs")
      .update({ 
        embeddings_generated: successCount,
        updated_at: new Date().toISOString()
      })
      .eq("id", jobId);

    console.log(`[EMBEDDINGS] Progress: ${successCount}/${chunks.length} (batch ${Math.floor(i / BATCH_SIZE) + 1})`);

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Final status
  const finalStatus = successCount > 0 ? "completed" : "failed";

  await supabase
    .from("document_processing_jobs")
    .update({
      embedding_status: finalStatus,
      embeddings_generated: successCount,
      error_message: failCount > 0 ? `${failCount} chunks falharam` : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId);

  console.log(`[EMBEDDINGS] DONE: ${successCount}/${chunks.length} (${failCount} failed)`);
  return { completed: true, processed: successCount };
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { job_id } = await req.json();

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "No job_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[EMBEDDINGS] Request for job: ${job_id}`);

    const { data: job, error: jobError } = await supabase
      .from("document_processing_jobs")
      .select("id, status, embedding_status, knowledge_base_id")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (job.status !== "completed") {
      return new Response(
        JSON.stringify({ error: "Job text processing not complete" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip if already completed
    if (job.embedding_status === "completed") {
      return new Response(
        JSON.stringify({ message: "Embeddings already generated" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve workspace_id from knowledge_base and get per-company OpenAI key
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("workspace_id")
      .eq("id", job.knowledge_base_id)
      .maybeSingle();

    if (!kb?.workspace_id) {
      await supabase
        .from("document_processing_jobs")
        .update({
          embedding_status: "failed",
          error_message: "Base de conhecimento sem workspace associado.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Knowledge base sem workspace associado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let openai: OpenAI;
    try {
      const creds = await getOpenAIKey(kb.workspace_id);
      openai = new OpenAI({ apiKey: creds.apiKey });
    } catch (err) {
      const userMessage = err instanceof OpenAIError
        ? err.userMessage
        : (err instanceof Error ? err.message : "Erro ao obter credenciais da OpenAI.");
      const code = err instanceof OpenAIError ? err.code : undefined;
      console.error(`[EMBEDDINGS] OpenAI indisponivel para workspace ${kb.workspace_id}: ${userMessage}`);
      await supabase
        .from("document_processing_jobs")
        .update({
          embedding_status: "failed",
          error_message: userMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: userMessage, code }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Allow re-processing of failed, incomplete, or pending embeddings
    if (job.embedding_status === "processing") {
      // Check if it's been stuck for more than 5 minutes
      const { data: currentJob } = await supabase
        .from("document_processing_jobs")
        .select("updated_at")
        .eq("id", job_id)
        .single();
      
      if (currentJob?.updated_at) {
        const lastUpdate = new Date(currentJob.updated_at).getTime();
        const stuckThreshold = 5 * 60 * 1000; // 5 minutes
        
        if (Date.now() - lastUpdate < stuckThreshold) {
          return new Response(
            JSON.stringify({ message: "Embeddings already being processed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log(`[EMBEDDINGS] Job was stuck, restarting...`);
      }
    }

    // Use EdgeRuntime.waitUntil for background processing
    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        processEmbeddingsForJob(supabase, job_id, openai, startTime)
          .then(async (result) => {
            // If incomplete due to timeout, trigger continuation
            if (!result.completed && result.processed > 0) {
              console.log("[EMBEDDINGS] Triggering continuation...");
              // The frontend will detect 'incomplete' status and re-trigger
            }
          })
          .catch(async (error) => {
            console.error("[EMBEDDINGS] Background error:", error);
            await supabase
              .from("document_processing_jobs")
              .update({ 
                embedding_status: "failed",
                error_message: error instanceof Error ? error.message : "Erro desconhecido",
                updated_at: new Date().toISOString()
              })
              .eq("id", job_id);
          })
      );
      
      return new Response(
        JSON.stringify({ success: true, message: "Started with OpenAI embeddings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Fallback: process synchronously
      await processEmbeddingsForJob(supabase, job_id, openai, startTime);
      
      return new Response(
        JSON.stringify({ success: true, message: "Completed with OpenAI embeddings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[EMBEDDINGS] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
