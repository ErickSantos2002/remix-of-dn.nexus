import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://deno.land/x/openai@v4.24.0/mod.ts";
import { getOpenAIKey, OpenAIError } from "../_shared/openaiCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Optimized for OpenAI Embeddings API
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 100;
const MAX_EXECUTION_TIME_MS = 50000;

// Generate embedding using OpenAI's text-embedding-3-small model
async function generateEmbedding(openai: OpenAI, text: string): Promise<number[]> {
  const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;
  
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: truncatedText,
    encoding_format: "float",
  });
  
  return response.data[0].embedding;
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body for optional filtering
    let knowledgeBaseId: string | null = null;
    let forceRegenerate = false;

    try {
      const body = await req.json();
      knowledgeBaseId = body.knowledge_base_id || null;
      forceRegenerate = body.force_regenerate || false;
    } catch {
      // No body provided, process all
    }

    console.log(`[REGENERATE] Starting. KB filter: ${knowledgeBaseId}, Force: ${forceRegenerate}`);

    // Build query for documents
    let query = supabase
      .from("documents")
      .select("id, content, knowledge_base_id, embedding")
      .order("id", { ascending: true });

    if (knowledgeBaseId) {
      query = query.eq("knowledge_base_id", knowledgeBaseId);
    }

    if (!forceRegenerate) {
      query = query.is("embedding", null);
    }

    const { data: documents, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch documents: ${fetchError.message}`);
    }

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No documents need embedding generation",
        processed: 0,
        total: 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Filter valid documents (skip binary/short content)
    const validDocs = documents.filter((doc: any) => {
      const content = doc.content || "";
      if (content.includes("JFIF") || content.match(/^[A-Z\s]{50,}$/) || content.length < 50) {
        return false;
      }
      return true;
    });

    console.log(`[REGENERATE] Found ${validDocs.length} valid documents (of ${documents.length} total)`);

    // Resolve OpenAI credentials per knowledge_base (cached by workspace_id)
    const kbIds = Array.from(new Set(validDocs.map((d: any) => d.knowledge_base_id).filter(Boolean)));
    const { data: kbs } = await supabase
      .from("knowledge_bases")
      .select("id, workspace_id")
      .in("id", kbIds);
    const kbToWorkspace = new Map<string, string>((kbs || []).map((k: any) => [k.id, k.workspace_id]));

    const workspaceClients = new Map<string, OpenAI>();
    const workspaceErrors = new Map<string, { error: string; code?: string }>();

    async function getClientForKb(kbId: string): Promise<{ client?: OpenAI; error?: { error: string; code?: string } }> {
      const wsId = kbToWorkspace.get(kbId);
      if (!wsId) return { error: { error: "Knowledge base sem workspace associado." } };
      if (workspaceClients.has(wsId)) return { client: workspaceClients.get(wsId)! };
      if (workspaceErrors.has(wsId)) return { error: workspaceErrors.get(wsId)! };
      try {
        const creds = await getOpenAIKey(wsId);
        const client = new OpenAI({ apiKey: creds.apiKey });
        workspaceClients.set(wsId, client);
        return { client };
      } catch (err) {
        const userMessage = err instanceof OpenAIError
          ? err.userMessage
          : (err instanceof Error ? err.message : "Erro ao obter credenciais da OpenAI.");
        const code = err instanceof OpenAIError ? err.code : undefined;
        const errObj = { error: userMessage, code };
        workspaceErrors.set(wsId, errObj);
        console.warn(`[REGENERATE] OpenAI indisponivel para workspace ${wsId}: ${userMessage}`);
        return { error: errObj };
      }
    }

    // If a specific KB was requested and its credentials fail, return 400 directly
    if (knowledgeBaseId) {
      const probe = await getClientForKb(knowledgeBaseId);
      if (probe.error) {
        return new Response(JSON.stringify({ success: false, ...probe.error }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    let processed = 0;
    let failed = 0;
    let timedOut = false;
    const results: { id: number; status: string }[] = [];
    const skipped: { knowledge_base_id: string; reason: string; code?: string; count: number }[] = [];
    const skippedAcc = new Map<string, number>();

    // Process in batches
    for (let i = 0; i < validDocs.length; i += BATCH_SIZE) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_EXECUTION_TIME_MS) {
        console.log(`[REGENERATE] Timeout at ${processed}/${validDocs.length}`);
        timedOut = true;
        break;
      }

      const batch = validDocs.slice(i, i + BATCH_SIZE);
      console.log(`[REGENERATE] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validDocs.length / BATCH_SIZE)}`);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (doc: any) => {
          const { client, error } = await getClientForKb(doc.knowledge_base_id);
          if (!client) {
            skippedAcc.set(doc.knowledge_base_id, (skippedAcc.get(doc.knowledge_base_id) || 0) + 1);
            return { id: doc.id, status: "skipped" };
          }
          try {
            const embedding = await generateEmbedding(client, doc.content);

            const { error: updateError } = await supabase
              .from("documents")
              .update({ embedding: JSON.stringify(embedding) })
              .eq("id", doc.id);

            if (updateError) {
              console.error(`[REGENERATE] Failed to update doc ${doc.id}:`, updateError);
              return { id: doc.id, status: "update_failed" };
            }
            return { id: doc.id, status: "success" };
          } catch (error) {
            console.error(`[REGENERATE] Error for doc ${doc.id}:`, error);
            return { id: doc.id, status: "error" };
          }
        })
      );

      batchResults.forEach(result => {
        if (result.status === "success") processed++;
        else if (result.status !== "skipped") failed++;
        results.push(result);
      });

      console.log(`[REGENERATE] Progress: ${processed + failed}/${validDocs.length} (${processed} success, ${failed} failed)`);

      // Small delay between batches
      if (i + BATCH_SIZE < validDocs.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    for (const [kbId, count] of skippedAcc.entries()) {
      const wsId = kbToWorkspace.get(kbId);
      const errObj = wsId ? workspaceErrors.get(wsId) : undefined;
      skipped.push({
        knowledge_base_id: kbId,
        reason: errObj?.error || "OpenAI nao configurada para este workspace.",
        code: errObj?.code,
        count,
      });
    }


    console.log(`[REGENERATE] Complete! Processed: ${processed}, Failed: ${failed}${timedOut ? ' (timed out)' : ''}`);

    return new Response(JSON.stringify({
      success: true,
      message: timedOut
        ? `Timeout - processed ${processed}/${validDocs.length}. Run again to continue.`
        : `Embedding regeneration complete`,
      processed,
      failed,
      total: validDocs.length,
      timedOut,
      skipped,
      results: results.slice(0, 50)
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[REGENERATE] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
