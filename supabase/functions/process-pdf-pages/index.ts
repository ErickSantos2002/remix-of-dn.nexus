import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Maximum job duration in milliseconds (30 minutes)
const MAX_JOB_DURATION_MS = 30 * 60 * 1000;
// Maximum retries for batch processing
const MAX_RETRIES = 3;
// Retry delay in milliseconds
const RETRY_DELAY_MS = 2000;

// Generate embedding using Lovable AI Gateway
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `You are an embedding generator. Given text, output exactly 256 floating-point numbers between -1 and 1, separated by commas, representing the semantic meaning of the text. Output ONLY the numbers, nothing else.`
        },
        {
          role: "user",
          content: text.slice(0, 2000)
        }
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate embedding: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  
  const numbers = content
    .trim()
    .split(",")
    .map((n: string) => parseFloat(n.trim()))
    .filter((n: number) => !isNaN(n));

  while (numbers.length < 256) {
    numbers.push(0);
  }

  const embedding: number[] = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(numbers[i % 256]);
  }

  return embedding;
}

// Helper function to convert Uint8Array to base64
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Extract text from PDF pages using OCR (Gemini Vision) - processes a batch of pages
async function extractTextWithOCRBatch(bytes: Uint8Array, startPage: number, endPage: number, apiKey: string): Promise<string> {
  console.log(`[OCR] Processing pages ${startPage + 1} to ${endPage} with Gemini Vision...`);
  
  // Convert only what we need to base64
  const base64Pdf = bytesToBase64(bytes);
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract ALL text from pages ${startPage + 1} to ${endPage} of this PDF document.

Instructions:
- Extract every word, number, and character visible on these pages
- Maintain the original structure and formatting
- Include all headers, footers, and visible content  
- Separate pages with "--- Page X ---" markers
- Output ONLY the extracted text, no explanations
- If pages don't exist, respond with "[END_OF_DOCUMENT]"
- Focus on accuracy - extract the actual text content`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64Pdf}`
              }
            }
          ]
        }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[OCR] Gemini Vision API error: ${response.status}`, errorText);
    throw new Error(`OCR failed: ${response.status}`);
  }

  const data = await response.json();
  const extractedText = data.choices?.[0]?.message?.content || "";
  
  console.log(`[OCR] Extracted ${extractedText.length} characters from pages ${startPage + 1}-${endPage}`);
  return extractedText;
}

// Extract text from a portion of PDF bytes (standard extraction)
function extractTextFromPdfSection(bytes: Uint8Array, startOffset: number, endOffset: number): string {
  const decoder = new TextDecoder("latin1");
  const section = bytes.slice(startOffset, endOffset);
  const content = decoder.decode(section);
  
  const textParts: string[] = [];
  
  const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  
  while ((match = btEtRegex.exec(content)) !== null) {
    const textBlock = match[1];
    
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
      textParts.push(tjMatch[1]);
    }
    
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let tjArrayMatch;
    while ((tjArrayMatch = tjArrayRegex.exec(textBlock)) !== null) {
      const arrayContent = tjArrayMatch[1];
      const stringRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
        textParts.push(strMatch[1]);
      }
    }
  }
  
  return textParts.join(' ').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
}

// Find page boundaries in PDF
function findPageBoundaries(bytes: Uint8Array): number[] {
  const decoder = new TextDecoder("latin1");
  const content = decoder.decode(bytes);
  const boundaries: number[] = [0];
  
  const pageRegex = /\/Type\s*\/Page[^s]/g;
  let match;
  while ((match = pageRegex.exec(content)) !== null) {
    boundaries.push(match.index);
  }
  
  boundaries.push(bytes.length);
  return boundaries;
}

// Clean text
function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Check if text is meaningful (not garbage)
function isTextMeaningful(text: string): boolean {
  if (!text || text.length < 50) return false;
  
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  
  // Reject XML/XMP metadata
  if (cleanedText.includes('<?xpacket') || 
      cleanedText.includes('<x:xmpmeta') || 
      cleanedText.includes('xmlns:')) {
    return false;
  }
  
  // Check for real words
  const wordPattern = /[a-zA-ZáéíóúàèìòùâêîôûãõäëïöüçñÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇÑ]{3,}/g;
  const words = cleanedText.match(wordPattern) || [];
  
  return words.length >= 10;
}

// Split into chunks
function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  
  if (text.length <= chunkSize) {
    return text.length > 0 ? [text] : [];
  }
  
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length <= chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (para.length > chunkSize) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        currentChunk = "";
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length <= chunkSize) {
            currentChunk += (currentChunk ? " " : "") + sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = para;
      }
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  return chunks.filter(chunk => chunk.trim().length > 0);
}

// Check if job has exceeded max duration
async function checkJobTimeout(supabase: any, jobId: string, startedAt: string | null): Promise<boolean> {
  if (!startedAt) return false;
  
  const startTime = new Date(startedAt).getTime();
  const currentTime = Date.now();
  
  if (currentTime - startTime > MAX_JOB_DURATION_MS) {
    console.log(`[TIMEOUT] Job ${jobId} exceeded max duration, marking as failed`);
    await supabase
      .from("document_processing_jobs")
      .update({ 
        status: "failed", 
        error_message: "Tempo limite excedido: o processamento demorou mais de 30 minutos. Por favor, divida o PDF em partes menores e tente novamente." 
      })
      .eq("id", jobId);
    return true;
  }
  
  return false;
}

// Process a batch of pages with retry logic
async function processBatch(
  supabase: any,
  bytes: Uint8Array,
  boundaries: number[],
  startPage: number,
  endPage: number,
  jobId: string,
  knowledgeBaseId: string,
  filename: string,
  totalPages: number,
  lovableApiKey: string
): Promise<{ chunksCreated: number; embeddingsGenerated: number }> {
  let chunksCreated = 0;
  let embeddingsGenerated = 0;

  for (let page = startPage; page < endPage && page < boundaries.length - 1; page++) {
    const startOffset = boundaries[page];
    const endOffset = boundaries[page + 1];
    
    const pageText = extractTextFromPdfSection(bytes, startOffset, endOffset);
    const cleanedText = cleanText(pageText);
    
    if (cleanedText.length < 10) continue;
    
    const chunks = splitIntoChunks(cleanedText, 1000);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Retry logic for embedding generation
      let embedding: number[] | null = null;
      let lastError: Error | null = null;
      
      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          embedding = await generateEmbedding(chunk, lovableApiKey);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.log(`[RETRY] Embedding attempt ${retry + 1}/${MAX_RETRIES} failed: ${lastError.message}`);
          if (retry < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)));
          }
        }
      }
      
      if (embedding) {
        const { error } = await supabase
          .from("documents")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            content: chunk,
            embedding: embedding,
            metadata: {
              filename,
              page: page + 1,
              chunk_index: i,
              chunks_in_page: chunks.length,
              total_pages: totalPages,
              job_id: jobId,
            },
          });

        if (!error) {
          chunksCreated++;
          embeddingsGenerated++;
        }
      } else {
        // Save without embedding on error
        const { error: insertError } = await supabase
          .from("documents")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            content: chunk,
            metadata: {
              filename,
              page: page + 1,
              chunk_index: i,
              chunks_in_page: chunks.length,
              total_pages: totalPages,
              job_id: jobId,
              embedding_error: true,
              error_message: lastError?.message,
            },
          });

        if (!insertError) chunksCreated++;
      }
      
      // Rate limiting
      if (i > 0 && i % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  return { chunksCreated, embeddingsGenerated };
}

// Process a batch of pages using OCR
async function processBatchWithOCR(
  supabase: any,
  bytes: Uint8Array,
  startPage: number,
  endPage: number,
  jobId: string,
  knowledgeBaseId: string,
  filename: string,
  totalPages: number,
  lovableApiKey: string
): Promise<{ chunksCreated: number; embeddingsGenerated: number }> {
  let chunksCreated = 0;
  let embeddingsGenerated = 0;

  try {
    // Extract text using OCR for this batch of pages
    const ocrText = await extractTextWithOCRBatch(bytes, startPage, endPage, lovableApiKey);
    
    // Check if we got meaningful text
    if (!ocrText || ocrText.includes("[END_OF_DOCUMENT]") || !isTextMeaningful(ocrText)) {
      console.log(`[OCR] No meaningful text extracted from pages ${startPage + 1}-${endPage}`);
      return { chunksCreated: 0, embeddingsGenerated: 0 };
    }
    
    const cleanedText = cleanText(ocrText);
    
    if (cleanedText.length < 20) {
      console.log(`[OCR] Text too short after cleaning: ${cleanedText.length} chars`);
      return { chunksCreated: 0, embeddingsGenerated: 0 };
    }
    
    const chunks = splitIntoChunks(cleanedText, 1000);
    console.log(`[OCR] Split into ${chunks.length} chunks from pages ${startPage + 1}-${endPage}`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Retry logic for embedding generation
      let embedding: number[] | null = null;
      let lastError: Error | null = null;
      
      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          embedding = await generateEmbedding(chunk, lovableApiKey);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.log(`[RETRY] Embedding attempt ${retry + 1}/${MAX_RETRIES} failed: ${lastError.message}`);
          if (retry < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)));
          }
        }
      }
      
      if (embedding) {
        const { error } = await supabase
          .from("documents")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            content: chunk,
            embedding: embedding,
            metadata: {
              filename,
              pages: `${startPage + 1}-${endPage}`,
              chunk_index: i,
              chunks_in_batch: chunks.length,
              total_pages: totalPages,
              job_id: jobId,
              extraction_method: "ocr",
            },
          });

        if (!error) {
          chunksCreated++;
          embeddingsGenerated++;
        }
      } else {
        // Save without embedding on error
        const { error: insertError } = await supabase
          .from("documents")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            content: chunk,
            metadata: {
              filename,
              pages: `${startPage + 1}-${endPage}`,
              chunk_index: i,
              chunks_in_batch: chunks.length,
              total_pages: totalPages,
              job_id: jobId,
              extraction_method: "ocr",
              embedding_error: true,
              error_message: lastError?.message,
            },
          });

        if (!insertError) chunksCreated++;
      }
      
      // Rate limiting
      if (i > 0 && i % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } catch (ocrError) {
    console.error(`[OCR] Error processing pages ${startPage + 1}-${endPage}:`, ocrError);
  }

  return { chunksCreated, embeddingsGenerated };
}

// Trigger next batch with retry
async function triggerNextBatch(
  supabaseUrl: string,
  supabaseServiceKey: string,
  jobId: string,
  batchStart: number,
  batchSize: number,
  forceOcr: boolean = false
): Promise<boolean> {
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/process-pdf-pages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            job_id: jobId,
            batch_start: batchStart,
            batch_size: batchSize,
            force_ocr: forceOcr,
          }),
        }
      );
      
      if (response.ok) {
        console.log(`[BATCH] Successfully triggered next batch at page ${batchStart}, OCR: ${forceOcr}`);
        return true;
      }
      
      console.log(`[RETRY] Next batch trigger attempt ${retry + 1}/${MAX_RETRIES} failed: ${response.status}`);
    } catch (err) {
      console.error(`[RETRY] Next batch trigger attempt ${retry + 1}/${MAX_RETRIES} error:`, err);
    }
    
    if (retry < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retry + 1)));
    }
  }
  
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { job_id, batch_start, batch_size, force_ocr } = await req.json();
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "No job_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startPage = batch_start || 0;
    const requestedBatchSize = batch_size || 5;
    const useOCR = force_ocr || false;

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("document_processing_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dynamically adjust batch size based on file size and OCR mode
    // Larger files need smaller batches to avoid memory limits
    const fileSizeMB = job.file_size / (1024 * 1024);
    let pagesPerBatch = requestedBatchSize;
    
    // Reduce batch size for large files using OCR
    if (useOCR) {
      if (fileSizeMB > 40) {
        pagesPerBatch = 1; // Very large PDFs (40MB+): 1 page at a time
      } else if (fileSizeMB > 25) {
        pagesPerBatch = 2; // Large PDFs (25-40MB): 2 pages
      } else if (fileSizeMB > 15) {
        pagesPerBatch = 3; // Medium-large PDFs (15-25MB): 3 pages
      } else if (fileSizeMB > 5) {
        pagesPerBatch = 5; // Medium PDFs (5-15MB): 5 pages
      }
    }

    console.log(`[JOB] Processing PDF job ${job_id}, pages ${startPage} to ${startPage + pagesPerBatch}, OCR: ${useOCR}, Size: ${fileSizeMB.toFixed(1)}MB`);

    // Verificar limite de tamanho para OCR - OCR requer carregar PDF inteiro na memoria + codificacao base64
    // Isso triplica o uso de memoria, entao limitamos OCR a 15MB
    const MAX_OCR_SIZE_MB = 15;
    if (useOCR && fileSizeMB > MAX_OCR_SIZE_MB) {
      const errorMessage = `Este PDF contem apenas imagens e e muito grande para processamento OCR (${fileSizeMB.toFixed(1)}MB). O limite para PDFs baseados em imagens e 15MB. Sugestoes: (1) Divida o PDF em partes menores, (2) Converta as imagens para texto usando um software de OCR externo, ou (3) Use um PDF com texto selecionavel.`;
      console.log(`[OCR] Arquivo muito grande para OCR: ${fileSizeMB.toFixed(1)}MB > ${MAX_OCR_SIZE_MB}MB`);
      await supabase
        .from("document_processing_jobs")
        .update({ 
          status: "failed", 
          error_message: errorMessage
        })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if job was cancelled or already failed
    if (job.status === "failed" || job.status === "cancelled") {
      console.log(`[JOB] Job ${job_id} is ${job.status}, stopping processing`);
      return new Response(
        JSON.stringify({ error: `Job is ${job.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for timeout
    if (await checkJobTimeout(supabase, job_id, job.started_at)) {
      return new Response(
        JSON.stringify({ error: "Job timeout" }),
        { status: 408, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("knowledge-documents")
      .download(job.storage_path);

    if (downloadError || !fileData) {
      await supabase
        .from("document_processing_jobs")
        .update({ status: "failed", error_message: "Erro ao baixar o arquivo. Por favor, faca o upload novamente." })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: "Erro ao baixar o arquivo" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Find page boundaries (used for both methods)
    const boundaries = findPageBoundaries(bytes);
    const totalPages = boundaries.length - 1;
    
    // Apply max_pages limit
    const maxPages = job.max_pages || 200;
    const effectiveTotalPages = Math.min(totalPages, maxPages);
    
    console.log(`[JOB] PDF has ${totalPages} pages, processing up to ${effectiveTotalPages} (limit: ${maxPages}), OCR: ${useOCR}`);

    // Update status and set started_at on first batch
    if (startPage === 0) {
      await supabase
        .from("document_processing_jobs")
        .update({ 
          status: "processing",
          started_at: new Date().toISOString(),
          error_message: useOCR ? "Usando OCR para extrair texto..." : null
        })
        .eq("id", job_id);
    }

    // Process batch - different logic for OCR vs standard
    const endPage = Math.min(startPage + pagesPerBatch, effectiveTotalPages);
    let result: { chunksCreated: number; embeddingsGenerated: number };
    
    if (useOCR) {
      // Use OCR for this batch
      result = await processBatchWithOCR(
        supabase,
        bytes,
        startPage,
        endPage,
        job_id,
        job.knowledge_base_id,
        job.filename,
        effectiveTotalPages,
        lovableApiKey
      );
    } else {
      // Use standard extraction
      result = await processBatch(
        supabase,
        bytes,
        boundaries,
        startPage,
        endPage,
        job_id,
        job.knowledge_base_id,
        job.filename,
        effectiveTotalPages,
        lovableApiKey
      );
    }

    // Update progress
    const currentChunks = (job.chunks_created || 0) + result.chunksCreated;
    const currentEmbeddings = (job.embeddings_generated || 0) + result.embeddingsGenerated;

    const hasMorePages = endPage < effectiveTotalPages;

    if (hasMorePages) {
      // Update progress
      await supabase
        .from("document_processing_jobs")
        .update({
          chunks_created: currentChunks,
          embeddings_generated: currentEmbeddings,
          error_message: `Processando: página ${endPage}/${effectiveTotalPages}`,
        })
        .eq("id", job_id);

      // Trigger next batch with retry
      const triggered = await triggerNextBatch(
        supabaseUrl,
        supabaseServiceKey,
        job_id,
        endPage,
        pagesPerBatch,
        useOCR
      );

      if (!triggered) {
        // Failed to trigger next batch after retries - mark as failed
        console.error(`[JOB] Failed to trigger next batch for job ${job_id}`);
        await supabase
          .from("document_processing_jobs")
          .update({
            status: "failed",
            error_message: `Processamento interrompido na pagina ${endPage}/${effectiveTotalPages}. Erro de conexao. Por favor, tente novamente.`,
            chunks_created: currentChunks,
            embeddings_generated: currentEmbeddings,
          })
          .eq("id", job_id);
          
        return new Response(
          JSON.stringify({ error: "Failed to continue processing" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          progress: {
            current_page: endPage,
            total_pages: effectiveTotalPages,
            chunks_created: currentChunks,
            embeddings_generated: currentEmbeddings,
          },
          has_more: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All pages processed - check if we need to retry with OCR
    const wasLimited = totalPages > maxPages;
    
    // Se nenhum chunk foi criado e nao estamos usando OCR, o PDF provavelmente e baseado em imagens
    // Tentar novamente com OCR do inicio
    if (currentChunks === 0 && !useOCR) {
      console.log(`[JOB] Job ${job_id} completou com 0 chunks usando extracao padrao. Tentando com OCR...`);
      
      // Verificar se o arquivo e pequeno o suficiente para OCR
      if (fileSizeMB > MAX_OCR_SIZE_MB) {
        const errorMessage = `Este PDF nao possui texto selecionavel (provavelmente contem apenas imagens) e e muito grande para OCR (${fileSizeMB.toFixed(1)}MB). O limite para PDFs baseados em imagens e 15MB. Por favor, divida o arquivo em partes menores ou converta para um PDF com texto selecionavel.`;
        
        await supabase
          .from("document_processing_jobs")
          .update({
            status: "failed",
            error_message: errorMessage,
          })
          .eq("id", job_id);
          
        return new Response(
          JSON.stringify({ error: errorMessage }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Resetar progresso e iniciar processamento OCR
      await supabase
        .from("document_processing_jobs")
        .update({
          chunks_created: 0,
          embeddings_generated: 0,
          error_message: "PDF sem texto selecionavel detectado. Iniciando reconhecimento de texto (OCR)...",
        })
        .eq("id", job_id);
      
      // Disparar com OCR habilitado
      const triggered = await triggerNextBatch(
        supabaseUrl,
        supabaseServiceKey,
        job_id,
        0, // Comecar do inicio
        5, // Batches menores para OCR
        true // Forcar OCR
      );
      
      if (triggered) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Extracao padrao nao encontrou texto, tentando com OCR",
            retry_ocr: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // Falha ao disparar OCR - marcar como falha
        await supabase
          .from("document_processing_jobs")
          .update({
            status: "failed",
            error_message: "Este PDF nao possui texto selecionavel e nao foi possivel iniciar o reconhecimento de texto (OCR). Por favor, tente novamente.",
          })
          .eq("id", job_id);
          
        return new Response(
          JSON.stringify({ error: "Nao foi possivel extrair texto do PDF" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    const completionMessage = wasLimited 
      ? `Processado com limite de ${maxPages} páginas (total: ${totalPages})`
      : null;

    await supabase
      .from("document_processing_jobs")
      .update({
        status: "completed",
        chunks_created: currentChunks,
        embeddings_generated: currentEmbeddings,
        error_message: completionMessage,
      })
      .eq("id", job_id);

    console.log(`[JOB] Job ${job_id} completed: ${currentChunks} chunks, ${currentEmbeddings} embeddings`);

    return new Response(
      JSON.stringify({
        success: true,
        chunks_created: currentChunks,
        embeddings_generated: currentEmbeddings,
        has_more: false,
        pages_limited: wasLimited,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ERROR] Error processing PDF pages:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to process PDF" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
