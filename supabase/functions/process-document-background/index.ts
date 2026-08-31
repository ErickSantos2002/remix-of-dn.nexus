import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Threshold for using AI extraction (2MB)
const AI_EXTRACTION_THRESHOLD = 2 * 1024 * 1024;

// Check if extracted text is meaningful (not binary garbage or XML metadata)
function isTextMeaningful(text: string): boolean {
  if (!text || text.length < 50) return false;
  
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  
  if (cleanedText.includes('<?xpacket') || 
      cleanedText.includes('<x:xmpmeta') || 
      cleanedText.includes('xmlns:') ||
      cleanedText.includes('<rdf:RDF')) {
    console.log("[TEXT QUALITY] Detected XML/XMP metadata - not meaningful text");
    return false;
  }
  
  const wordPattern = /[a-zA-ZáéíóúàèìòùâêîôûãõäëïöüçñÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇÑ]{3,}/g;
  const words = cleanedText.match(wordPattern) || [];
  const hasRepetitivePattern = /(.{1,4})\1{10,}/.test(cleanedText);
  const commonWords = ['que', 'para', 'com', 'uma', 'the', 'and', 'for', 'are', 'como', 'você', 'seu', 'sua', 'esse', 'esta', 'isso'];
  const hasCommonWords = commonWords.some(word => cleanedText.toLowerCase().includes(word));
  const alphabeticChars = (cleanedText.match(/[a-zA-ZáéíóúàèìòùâêîôûãõäëïöüçñÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇÑ]/g) || []).length;
  const alphaRatio = alphabeticChars / cleanedText.length;
  
  console.log(`[TEXT QUALITY] Words: ${words.length}, Repetitive: ${hasRepetitivePattern}, Common words: ${hasCommonWords}, Alpha ratio: ${alphaRatio.toFixed(2)}`);
  
  return words.length >= 30 && !hasRepetitivePattern && (hasCommonWords || alphaRatio > 0.5);
}

// Validate content before saving
function isValidDocumentContent(text: string): boolean {
  if (!text || text.length < 20) return false;
  
  if (text.includes('<?xpacket') || 
      text.includes('<x:xmpmeta') || 
      text.includes('xmlns:') ||
      text.includes('<rdf:RDF') ||
      text.includes('<?xml')) {
    return false;
  }
  
  // Only detect actual control characters, NOT accented Latin chars (0x80-0xFF)
  const binaryChars = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g) || []).length;
  if (binaryChars / text.length > 0.1) {
    return false;
  }
  
  return true;
}

// Check if PDF is image-based
function isImageBasedPdf(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder("latin1");
  const content = decoder.decode(bytes.slice(0, Math.min(bytes.length, 50000)));
  
  const hasImages = content.includes("/Image") || 
                    content.includes("/XObject") ||
                    content.includes("JFIF") ||
                    content.includes("DCTDecode");
  
  const hasTextContent = content.includes("/Font") && 
                         (content.includes("Tj") || content.includes("TJ"));
  
  return hasImages && !hasTextContent;
}

// =====================================================
// AI-POWERED EXTRACTION using Lovable AI Gateway with base64 file
// =====================================================

// Helper to convert Uint8Array to base64 in chunks (memory efficient)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 32768; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

// Get MIME type for file
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'ppt': 'application/vnd.ms-powerpoint',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'md': 'text/markdown',
    'json': 'application/json',
    'html': 'text/html',
    'htm': 'text/html',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Maximum file size for AI extraction (4MB to avoid memory issues with base64)
const MAX_AI_FILE_SIZE = 4 * 1024 * 1024;

async function extractTextWithAI(
  supabase: any,
  storagePath: string,
  filename: string,
  fileSize: number
): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  
  if (!apiKey) {
    console.error("[AI EXTRACT] LOVABLE_API_KEY not configured");
    throw new Error("AI extraction not available - API key not configured");
  }

  if (fileSize > MAX_AI_FILE_SIZE) {
    throw new Error(`Arquivo muito grande para IA (${(fileSize / 1024 / 1024).toFixed(1)}MB). Limite: 4MB`);
  }

  console.log(`[AI EXTRACT] Processing ${filename} (${(fileSize / 1024 / 1024).toFixed(2)}MB) with Gemini`);

  console.log(`[AI EXTRACT] Downloading file for base64 conversion`);
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("knowledge-documents")
    .download(storagePath);

  if (downloadError || !fileData) {
    console.error("[AI EXTRACT] Download error:", downloadError);
    throw new Error("Failed to download document for AI extraction");
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  console.log(`[AI EXTRACT] Converting to base64...`);
  const base64Data = uint8ArrayToBase64(bytes);
  const mimeType = getMimeType(filename);
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  
  console.log(`[AI EXTRACT] Sending to Gemini`);

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
              text: `Extraia TODO o texto deste documento "${filename}". Retorne APENAS o texto extraído, mantendo a estrutura de parágrafos.`
            },
            {
              type: "image_url",
              image_url: { url: dataUrl }
            }
          ]
        }
      ],
      max_tokens: 100000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AI EXTRACT] API error: ${response.status} - ${errorText}`);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    if (response.status === 402) {
      throw new Error("Limite de uso atingido");
    }
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const extractedText = data.choices?.[0]?.message?.content || "";
  
  console.log(`[AI EXTRACT] Extracted ${extractedText.length} characters`);
  return extractedText;
}

// Local DOCX extraction using Central Directory (handles data descriptors correctly)
async function extractTextFromDocxBytes(bytes: Uint8Array): Promise<string> {
  console.log(`[DOCX LOCAL] Starting extraction, file size: ${bytes.length} bytes`);
  const textParts: string[] = [];
  
  try {
    // Find End of Central Directory record (from the end of file)
    let eocdPos = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && 
          bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        eocdPos = i;
        break;
      }
    }
    
    if (eocdPos === -1) {
      console.log("[DOCX LOCAL] End of Central Directory not found");
      return "";
    }
    
    // Read Central Directory offset and size from EOCD
    const cdOffset = bytes[eocdPos + 16] | (bytes[eocdPos + 17] << 8) | 
                     (bytes[eocdPos + 18] << 16) | (bytes[eocdPos + 19] << 24);
    const cdSize = bytes[eocdPos + 12] | (bytes[eocdPos + 13] << 8) | 
                   (bytes[eocdPos + 14] << 16) | (bytes[eocdPos + 15] << 24);
    
    console.log(`[DOCX LOCAL] Central Directory at offset ${cdOffset}, size ${cdSize}`);
    
    // Parse Central Directory entries to find document.xml
    let pos = cdOffset;
    let entriesFound = 0;
    let documentEntry: { offset: number; compSize: number; uncompSize: number; method: number } | null = null;
    
    while (pos < cdOffset + cdSize && pos < bytes.length - 46) {
      // Check for Central Directory File Header signature (PK\x01\x02)
      if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4B || 
          bytes[pos + 2] !== 0x01 || bytes[pos + 3] !== 0x02) {
        break;
      }
      
      entriesFound++;
      
      const compressionMethod = bytes[pos + 10] | (bytes[pos + 11] << 8);
      const compressedSize = bytes[pos + 20] | (bytes[pos + 21] << 8) | 
                            (bytes[pos + 22] << 16) | (bytes[pos + 23] << 24);
      const uncompressedSize = bytes[pos + 24] | (bytes[pos + 25] << 8) | 
                               (bytes[pos + 26] << 16) | (bytes[pos + 27] << 24);
      const fileNameLength = bytes[pos + 28] | (bytes[pos + 29] << 8);
      const extraFieldLength = bytes[pos + 30] | (bytes[pos + 31] << 8);
      const commentLength = bytes[pos + 32] | (bytes[pos + 33] << 8);
      const localHeaderOffset = bytes[pos + 42] | (bytes[pos + 43] << 8) | 
                                (bytes[pos + 44] << 16) | (bytes[pos + 45] << 24);
      
      const fileNameBytes = bytes.slice(pos + 46, pos + 46 + fileNameLength);
      const fileName = new TextDecoder().decode(fileNameBytes);
      
      if (fileName === "word/document.xml") {
        documentEntry = { 
          offset: localHeaderOffset, 
          compSize: compressedSize, 
          uncompSize: uncompressedSize,
          method: compressionMethod 
        };
        console.log(`[DOCX LOCAL] Found document.xml: offset=${localHeaderOffset}, compSize=${compressedSize}, uncompSize=${uncompressedSize}, method=${compressionMethod}`);
      }
      
      pos += 46 + fileNameLength + extraFieldLength + commentLength;
    }
    
    console.log(`[DOCX LOCAL] Parsed ${entriesFound} Central Directory entries`);
    
    if (!documentEntry) {
      console.log("[DOCX LOCAL] document.xml not found in Central Directory");
      return "";
    }
    
    // Now read the actual data using the correct offset and size
    const localPos = documentEntry.offset;
    const localFileNameLength = bytes[localPos + 26] | (bytes[localPos + 27] << 8);
    const localExtraFieldLength = bytes[localPos + 28] | (bytes[localPos + 29] << 8);
    const dataStart = localPos + 30 + localFileNameLength + localExtraFieldLength;
    
    console.log(`[DOCX LOCAL] Reading data from offset ${dataStart}, size ${documentEntry.compSize}`);
    
    const compressedData = bytes.slice(dataStart, dataStart + documentEntry.compSize);
    
    let xmlContent = "";
    if (documentEntry.method === 0) {
      xmlContent = new TextDecoder("utf-8").decode(compressedData);
    } else if (documentEntry.method === 8) {
      try {
        const decompressed = await decompressDeflate(compressedData);
        if (decompressed.length > 0) {
          xmlContent = new TextDecoder("utf-8").decode(decompressed);
          console.log(`[DOCX LOCAL] Decompressed ${decompressed.length} bytes`);
        }
      } catch (e) {
        console.error("[DOCX LOCAL] Decompression failed:", e);
      }
    }
    
    if (xmlContent) {
      console.log(`[DOCX LOCAL] XML content length: ${xmlContent.length}`);
      
      // Extract text from <w:t> tags (Word text elements)
      const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let match;
      while ((match = regex.exec(xmlContent)) !== null) {
        const text = match[1];
        if (text) {
          textParts.push(text);
        }
      }
      
      console.log(`[DOCX LOCAL] Extracted ${textParts.length} text segments`);
    }
    
  } catch (error) {
    console.error("[DOCX LOCAL] Error:", error);
  }
  
  const result = textParts.join(' ').replace(/\s+/g, ' ').trim();
  console.log(`[DOCX LOCAL] Final result: ${result.length} characters`);
  return result;
}

// =====================================================

// =====================================================
// LOCAL EXTRACTION (for small files as fallback)
// =====================================================

// Decompress deflate data
async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve) => {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      
      const chunks: Uint8Array[] = [];
      
      // Create a copy with a proper ArrayBuffer
      const buffer = new ArrayBuffer(data.length);
      const view = new Uint8Array(buffer);
      view.set(data);
      
      writer.write(view).catch(() => {});
      writer.close().catch(() => {});
      
      const readChunks = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(result);
        } catch {
          resolve(new Uint8Array());
        }
      };
      
      readChunks();
    } catch {
      resolve(new Uint8Array());
    }
  });
}

// Simple PDF text extraction (for small, text-based PDFs)
async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const decoder = new TextDecoder("latin1");
  const content = decoder.decode(bytes);
  
  const textParts: string[] = [];
  
  // Extract from uncompressed text blocks (BT...ET)
  const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  
  while ((match = btEtRegex.exec(content)) !== null) {
    const textBlock = match[1];
    
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
      const extracted = tjMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      textParts.push(extracted);
    }
    
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/gi;
    let tjArrayMatch;
    while ((tjArrayMatch = tjArrayRegex.exec(textBlock)) !== null) {
      const arrayContent = tjArrayMatch[1];
      const stringRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
        const extracted = strMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        textParts.push(extracted);
      }
    }
  }
  
  let result = textParts.join(' ');
  result = result
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  return result || "";
}

// Extract text from HTML
function extractHtmlText(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  return text;
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

// Split into chunks
function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  
  if (text.length <= chunkSize) {
    return [text];
  }
  
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    if (currentChunk.length + para.length <= chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      if (para.length > chunkSize) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        currentChunk = "";
        
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length <= chunkSize) {
            currentChunk += (currentChunk ? " " : "") + sentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
            }
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = para;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks.filter(chunk => chunk.trim().length > 0);
}

// =====================================================
// OPTIMIZED: Process chunks WITHOUT embedding generation
// =====================================================
const BATCH_SIZE = 100;
const PROGRESS_UPDATE_INTERVAL = 50;

async function processChunksOptimized(
  supabase: any,
  job: { id: string; knowledge_base_id: string; filename: string },
  chunks: string[]
) {
  let chunksCreated = 0;
  let skippedChunks = 0;

  try {
    console.log(`[FAST PROCESS] Starting optimized processing for ${chunks.length} chunks`);
    
    await supabase
      .from("document_processing_jobs")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        error_message: `Processando: 0% (0/${chunks.length} chunks)`,
      })
      .eq("id", job.id);

    const validChunks: { chunk: string; originalIndex: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (isValidDocumentContent(chunks[i])) {
        validChunks.push({ chunk: chunks[i], originalIndex: i });
      } else {
        skippedChunks++;
      }
    }

    console.log(`[FAST PROCESS] ${validChunks.length} valid chunks, ${skippedChunks} skipped`);

    for (let batchStart = 0; batchStart < validChunks.length; batchStart += BATCH_SIZE) {
      const batch = validChunks.slice(batchStart, batchStart + BATCH_SIZE);
      
      const docsToInsert = batch.map(({ chunk, originalIndex }) => ({
        knowledge_base_id: job.knowledge_base_id,
        content: chunk,
        embedding: null,
        metadata: {
          filename: job.filename,
          chunk_index: originalIndex,
          total_chunks: chunks.length,
          job_id: job.id,
        },
      }));

      const { error: insertError } = await supabase
        .from("documents")
        .insert(docsToInsert);

      if (!insertError) {
        chunksCreated += docsToInsert.length;
      } else {
        console.error("[FAST PROCESS] Batch insert error:", insertError);
        for (const doc of docsToInsert) {
          const { error } = await supabase.from("documents").insert(doc);
          if (!error) chunksCreated++;
        }
      }

      const processed = batchStart + batch.length;
      if (processed % PROGRESS_UPDATE_INTERVAL < BATCH_SIZE || processed >= validChunks.length) {
        const progress = Math.round((chunksCreated / chunks.length) * 100);
        await supabase
          .from("document_processing_jobs")
          .update({
            chunks_created: chunksCreated,
            embeddings_generated: 0,
            error_message: `Processando: ${progress}% (${chunksCreated}/${chunks.length} chunks)`,
          })
          .eq("id", job.id);
        
        console.log(`[FAST PROCESS] Progress: ${chunksCreated}/${chunks.length} chunks (${progress}%)`);
      }
    }

    const completionMessage = skippedChunks > 0
      ? `${skippedChunks} chunks ignorados (conteudo invalido)`
      : null;

    await supabase
      .from("document_processing_jobs")
      .update({
        status: "completed",
        chunks_created: chunksCreated,
        embeddings_generated: 0,
        embedding_status: "pending",
        embeddings_total: chunksCreated,
        error_message: completionMessage,
      })
      .eq("id", job.id);

    console.log(`[FAST PROCESS] Text processing COMPLETED: ${chunksCreated} chunks created, ${skippedChunks} skipped`);

    // Trigger background embedding generation
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log(`[FAST PROCESS] Triggering embedding generation for job: ${job.id}`);
    
    try {
      const embeddingResponse = await fetch(
        `${supabaseUrl}/functions/v1/generate-embeddings-background`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ job_id: job.id }),
        }
      );

      if (embeddingResponse.ok) {
        console.log(`[FAST PROCESS] Embedding generation triggered successfully`);
      } else {
        const errorText = await embeddingResponse.text();
        console.error(`[FAST PROCESS] Failed to trigger embedding generation: ${errorText}`);
        await supabase
          .from("document_processing_jobs")
          .update({ embedding_status: "failed" })
          .eq("id", job.id);
      }
    } catch (embeddingError) {
      console.error("[FAST PROCESS] Error triggering embedding generation:", embeddingError);
      await supabase
        .from("document_processing_jobs")
        .update({ embedding_status: "failed" })
        .eq("id", job.id);
    }
  } catch (error) {
    console.error("[FAST PROCESS] Error:", error);
    await supabase
      .from("document_processing_jobs")
      .update({
        status: "failed",
        error_message: `Erro: ${error instanceof Error ? error.message : "Erro desconhecido"} (${chunksCreated}/${chunks.length} processados)`,
        chunks_created: chunksCreated,
        embedding_status: "failed",
      })
      .eq("id", job.id);
  }
}

// Handle shutdown gracefully
addEventListener('beforeunload', (ev: Event) => {
  const detail = (ev as CustomEvent).detail;
  console.log('Function shutdown due to:', detail?.reason || 'unknown');
});

serve(async (req) => {
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

    console.log(`[START] Processing job: ${job_id}`);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("document_processing_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      console.error("Job not found:", jobError);
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check file size limit (15MB for AI, smaller for local)
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    
    if (job.file_size > MAX_FILE_SIZE) {
      const sizeMB = (job.file_size / (1024 * 1024)).toFixed(1);
      const errorMessage = `Arquivo muito grande (${sizeMB}MB). O limite maximo e 15MB.`;
      
      console.log(`[FILE] File too large: ${sizeMB}MB`);
      await supabase
        .from("document_processing_jobs")
        .update({ status: "failed", error_message: errorMessage })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to processing
    await supabase
      .from("document_processing_jobs")
      .update({ 
        status: "processing",
        started_at: new Date().toISOString(),
        error_message: "Processando documento...",
      })
      .eq("id", job_id);

    const fileName = job.filename.toLowerCase();
    let extractedText = "";

    // Decide extraction method based on file size and type
    const isOfficeDocument = fileName.endsWith(".docx") || 
                            fileName.endsWith(".pptx") || 
                            fileName.endsWith(".xlsx") ||
                            fileName.endsWith(".doc") ||
                            fileName.endsWith(".ppt") ||
                            fileName.endsWith(".xls");
    const canUseAI = job.file_size <= MAX_AI_FILE_SIZE;
    const shouldUseAI = (job.file_size > AI_EXTRACTION_THRESHOLD || isOfficeDocument) && canUseAI;
    
    console.log(`[EXTRACT] File: ${job.filename}, Size: ${(job.file_size / 1024 / 1024).toFixed(2)}MB, UseAI: ${shouldUseAI}, Office: ${isOfficeDocument}, CanUseAI: ${canUseAI}`);

    // For files within AI size limit (4MB), use AI extraction
    if (shouldUseAI) {
      await supabase
        .from("document_processing_jobs")
        .update({ error_message: "Extraindo texto com IA..." })
        .eq("id", job_id);

      try {
        extractedText = await extractTextWithAI(supabase, job.storage_path, job.filename, job.file_size);
        console.log(`[AI EXTRACT] Success: ${extractedText.length} characters`);
      } catch (aiError) {
        console.error("[AI EXTRACT] Failed:", aiError);
        
        // If AI failed and it's a PDF, redirect to OCR
        if (fileName.endsWith(".pdf")) {
          console.log("[EXTRACT] Redirecting to OCR processor");
          
          const response = await fetch(
            `${supabaseUrl}/functions/v1/process-pdf-pages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                job_id: job_id,
                batch_start: 0,
                batch_size: 5,
                force_ocr: true,
              }),
            }
          );

          if (response.ok) {
            return new Response(
              JSON.stringify({ success: true, message: "Redirected to OCR processor" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        
        // For DOCX, try local extraction
        if (fileName.endsWith(".docx")) {
          console.log("[EXTRACT] AI failed for DOCX, trying local extraction");
        } else if (!extractedText || extractedText.length < 50) {
          const errorMsg = aiError instanceof Error ? aiError.message : "Falha na extracao";
          await supabase
            .from("document_processing_jobs")
            .update({ status: "failed", error_message: `Nao foi possivel extrair texto: ${errorMsg}` })
            .eq("id", job_id);
          return new Response(
            JSON.stringify({ error: errorMsg }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }
    
    // For large Office files or if AI failed, use local extraction
    if (!extractedText || extractedText.length < 50) {
      // Small files: download and use local extraction
      await supabase
        .from("document_processing_jobs")
        .update({ error_message: "Baixando arquivo..." })
        .eq("id", job_id);

      console.log(`[DOWNLOAD] File: ${job.storage_path}`);
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("knowledge-documents")
        .download(job.storage_path);

      if (downloadError || !fileData) {
        console.error("Download error:", downloadError);
        await supabase
          .from("document_processing_jobs")
          .update({ 
            status: "failed", 
            error_message: "Erro ao baixar o arquivo. Por favor, faca o upload novamente." 
          })
          .eq("id", job_id);
        return new Response(
          JSON.stringify({ error: "Erro ao baixar o arquivo" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      await supabase
        .from("document_processing_jobs")
        .update({ error_message: "Extraindo texto..." })
        .eq("id", job_id);

      if (fileName.endsWith(".pdf")) {
        const isImageBased = isImageBasedPdf(bytes);
        
        if (isImageBased) {
          console.log("[PDF] Image-based, redirecting to OCR");
          const response = await fetch(
            `${supabaseUrl}/functions/v1/process-pdf-pages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                job_id: job_id,
                batch_start: 0,
                batch_size: 5,
                force_ocr: true,
              }),
            }
          );

          if (response.ok) {
            return new Response(
              JSON.stringify({ success: true, message: "Redirected to OCR" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        
        extractedText = await extractTextFromPdfBytes(bytes);
        
        if (!extractedText || extractedText.length < 100 || !isTextMeaningful(extractedText)) {
          console.log("[PDF] Local extraction insufficient, trying AI");
          try {
            extractedText = await extractTextWithAI(supabase, job.storage_path, job.filename, job.file_size);
          } catch {
            // Continue with whatever we have
          }
        }
      } else if (fileName.endsWith(".docx")) {
        console.log("[DOCX] Using local extraction for large DOCX");
        extractedText = await extractTextFromDocxBytes(bytes);
      } else if (fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".csv")) {
        const textDecoder = new TextDecoder("utf-8");
        extractedText = textDecoder.decode(bytes);
      } else if (fileName.endsWith(".json")) {
        const textDecoder = new TextDecoder("utf-8");
        const fileText = textDecoder.decode(bytes);
        try {
          extractedText = JSON.stringify(JSON.parse(fileText), null, 2);
        } catch {
          extractedText = fileText;
        }
      } else if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
        const textDecoder = new TextDecoder("utf-8");
        extractedText = extractHtmlText(textDecoder.decode(bytes));
      } else {
        const textDecoder = new TextDecoder("utf-8");
        extractedText = textDecoder.decode(bytes);
      }
    }

    extractedText = cleanText(extractedText);
    console.log(`[EXTRACT] Final: ${extractedText.length} characters from ${fileName}`);

    if (extractedText.length < 10) {
      let errorMessage = "Nao foi possivel extrair texto do documento.";
      
      if (fileName.endsWith(".pdf")) {
        errorMessage = "Nao foi possivel extrair texto do PDF. O arquivo pode conter apenas imagens ou estar protegido.";
      } else if (fileName.endsWith(".docx")) {
        errorMessage = "Nao foi possivel extrair texto do documento Word.";
      } else if (fileName.endsWith(".pptx")) {
        errorMessage = "Nao foi possivel extrair texto da apresentacao PowerPoint.";
      }
      
      await supabase
        .from("document_processing_jobs")
        .update({ status: "failed", error_message: errorMessage })
        .eq("id", job_id);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Split into chunks
    const CHUNK_SIZE = 2500;
    const chunks = splitIntoChunks(extractedText, CHUNK_SIZE);
    console.log(`[CHUNKS] Created ${chunks.length} chunks (size: ${CHUNK_SIZE})`);

    // Process chunks in background
    const jobData = { id: job_id, knowledge_base_id: job.knowledge_base_id, filename: job.filename };
    
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(processChunksOptimized(supabase, jobData, chunks));
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Processing started",
          chunks_to_process: chunks.length,
          extraction_method: shouldUseAI || isOfficeDocument ? "ai" : "local",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      await processChunksOptimized(supabase, jobData, chunks);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Processing completed",
          chunks_processed: chunks.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[ERROR] Processing failed:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to process document" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
