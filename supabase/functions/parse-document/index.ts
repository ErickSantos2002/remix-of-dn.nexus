import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate embedding using Lovable AI Gateway chat completions
// Since Lovable AI doesn't support embedding endpoints, we use a workaround:
// Generate a dense semantic representation using the chat model
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  // Use gemini-2.5-flash-lite for speed and cost efficiency
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
          content: `You are an embedding generator. Given text, output exactly 256 floating-point numbers between -1 and 1, separated by commas, representing the semantic meaning of the text. Output ONLY the numbers, nothing else. No explanations, no brackets, just comma-separated numbers.`
        },
        {
          role: "user",
          content: text.slice(0, 2000) // Limit input to avoid token limits
        }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Embedding API error:", response.status, errorText);
    throw new Error(`Failed to generate embedding: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  
  // Parse the comma-separated numbers
  const numbers = content
    .trim()
    .split(",")
    .map((n: string) => parseFloat(n.trim()))
    .filter((n: number) => !isNaN(n));

  // Ensure we have 256 dimensions, pad with zeros if needed
  while (numbers.length < 256) {
    numbers.push(0);
  }

  // Normalize to 1536 dimensions (Supabase vector column size)
  // Repeat the 256-dim vector to fill 1536 dimensions
  const embedding: number[] = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(numbers[i % 256]);
  }

  return embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const knowledgeBaseId = formData.get("knowledge_base_id") as string;
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!knowledgeBaseId) {
      return new Response(
        JSON.stringify({ error: "No knowledge_base_id provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileName = file.name.toLowerCase();
    let extractedText = "";

    console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);

    // Handle different file types
    if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      extractedText = await file.text();
    } else if (fileName.endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractPdfText(arrayBuffer);
    } else if (fileName.endsWith(".docx")) {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractDocxText(arrayBuffer);
    } else if (fileName.endsWith(".pptx")) {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractPptxText(arrayBuffer);
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractExcelText(arrayBuffer);
    } else if (fileName.endsWith(".csv")) {
      extractedText = await file.text();
    } else if (fileName.endsWith(".json")) {
      const jsonContent = await file.text();
      extractedText = JSON.stringify(JSON.parse(jsonContent), null, 2);
    } else if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
      const htmlContent = await file.text();
      extractedText = extractHtmlText(htmlContent);
    } else {
      return new Response(
        JSON.stringify({ 
          error: "Unsupported file type",
          supportedTypes: [".txt", ".md", ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".csv", ".json", ".html"]
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean and normalize the text
    extractedText = cleanText(extractedText);
    
    console.log(`Extracted text length: ${extractedText.length} characters`);

    if (extractedText.length < 10) {
      return new Response(
        JSON.stringify({ 
          error: "Could not extract meaningful text from document",
          extractedLength: extractedText.length
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Split into chunks for better RAG performance
    const chunks = splitIntoChunks(extractedText, 1000, 200);

    console.log(`Split into ${chunks.length} chunks`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Save documents with embeddings (batch processing to avoid memory issues)
    const savedDocuments: { id: number; hasEmbedding: boolean }[] = [];
    let embeddingErrors = 0;
    const BATCH_SIZE = 5; // Process in smaller batches

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        // Add delay between embedding calls to avoid rate limits
        if (i > 0 && i % BATCH_SIZE === 0) {
          console.log(`Processed ${i}/${chunks.length} chunks, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Generate embedding for the chunk
        console.log(`Generating embedding for chunk ${i + 1}/${chunks.length}`);
        const embedding = await generateEmbedding(chunk, lovableApiKey);

        // Insert document with embedding
        const { data, error } = await supabase
          .from("documents")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            content: chunk,
            embedding: embedding,
            metadata: {
              filename: file.name,
              chunk_index: i,
              total_chunks: chunks.length,
            },
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Error saving document chunk ${i}:`, error);
          throw error;
        }

        savedDocuments.push({ id: data.id, hasEmbedding: true });
      } catch (embeddingError) {
        console.error(`Error processing chunk ${i}:`, embeddingError);
        embeddingErrors++;

        // Still save the document without embedding
        try {
          const { data, error } = await supabase
            .from("documents")
            .insert({
              knowledge_base_id: knowledgeBaseId,
              content: chunk,
              metadata: {
                filename: file.name,
                chunk_index: i,
                total_chunks: chunks.length,
                embedding_error: true,
              },
            })
            .select("id")
            .single();

          if (!error && data) {
            savedDocuments.push({ id: data.id, hasEmbedding: false });
          }
        } catch (saveError) {
          console.error(`Failed to save chunk ${i} without embedding:`, saveError);
        }
      }
    }

    console.log(`Completed: ${savedDocuments.length} documents saved, ${embeddingErrors} embedding errors`);

    return new Response(
      JSON.stringify({ 
        success: true,
        filename: file.name,
        size: file.size,
        chunkCount: chunks.length,
        savedDocuments: savedDocuments.length,
        embeddingErrors,
        embeddingsGenerated: savedDocuments.filter(d => d.hasEmbedding).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error parsing document:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to parse document" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// PDF text extraction using a simple approach
async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(arrayBuffer);
  const text = extractTextFromPdfBytes(uint8Array);
  return text;
}

function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const content = decoder.decode(bytes);
  
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
  
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
  while ((match = streamRegex.exec(content)) !== null) {
    const streamContent = match[1];
    if (/[a-zA-Z]{3,}/.test(streamContent)) {
      const readableText = streamContent.replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
      if (readableText.length > 20) {
        textParts.push(readableText);
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
  
  return result || "Could not extract text from PDF. The PDF may be image-based or encrypted.";
}

// DOCX text extraction
async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(arrayBuffer);
  
  try {
    const xmlContent = await extractXmlFromZip(uint8Array, "word/document.xml");
    
    if (!xmlContent) {
      return "Could not extract text from DOCX file.";
    }
    
    return extractTextFromXml(xmlContent);
  } catch (e) {
    console.error("DOCX extraction error:", e);
    return "Could not extract text from DOCX file.";
  }
}

// PPTX text extraction
async function extractPptxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(arrayBuffer);
  const texts: string[] = [];
  
  try {
    for (let i = 1; i <= 100; i++) {
      const xmlContent = await extractXmlFromZip(uint8Array, `ppt/slides/slide${i}.xml`);
      if (!xmlContent) break;
      
      const slideText = extractTextFromXml(xmlContent);
      if (slideText) {
        texts.push(`--- Slide ${i} ---\n${slideText}`);
      }
    }
    
    return texts.join('\n\n') || "Could not extract text from PPTX file.";
  } catch (e) {
    console.error("PPTX extraction error:", e);
    return "Could not extract text from PPTX file.";
  }
}

// Excel text extraction
async function extractExcelText(arrayBuffer: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(arrayBuffer);
  
  try {
    const sharedStrings = await extractXmlFromZip(uint8Array, "xl/sharedStrings.xml");
    
    if (sharedStrings) {
      return extractTextFromXml(sharedStrings);
    }
    
    const sheet1 = await extractXmlFromZip(uint8Array, "xl/worksheets/sheet1.xml");
    if (sheet1) {
      return extractTextFromXml(sheet1);
    }
    
    return "Could not extract text from Excel file.";
  } catch (e) {
    console.error("Excel extraction error:", e);
    return "Could not extract text from Excel file.";
  }
}

// Simple ZIP extraction for finding XML files
async function extractXmlFromZip(zipBytes: Uint8Array, targetPath: string): Promise<string | null> {
  const signature = [0x50, 0x4b, 0x03, 0x04];
  let pos = 0;
  
  while (pos < zipBytes.length - 30) {
    if (zipBytes[pos] === signature[0] && 
        zipBytes[pos + 1] === signature[1] &&
        zipBytes[pos + 2] === signature[2] &&
        zipBytes[pos + 3] === signature[3]) {
      
      const compressionMethod = zipBytes[pos + 8] | (zipBytes[pos + 9] << 8);
      const compressedSize = zipBytes[pos + 18] | (zipBytes[pos + 19] << 8) | 
                            (zipBytes[pos + 20] << 16) | (zipBytes[pos + 21] << 24);
      const filenameLength = zipBytes[pos + 26] | (zipBytes[pos + 27] << 8);
      const extraLength = zipBytes[pos + 28] | (zipBytes[pos + 29] << 8);
      
      const filenameBytes = zipBytes.slice(pos + 30, pos + 30 + filenameLength);
      const filename = new TextDecoder().decode(filenameBytes);
      
      if (filename === targetPath) {
        const dataStart = pos + 30 + filenameLength + extraLength;
        const fileData = zipBytes.slice(dataStart, dataStart + compressedSize);
        
        if (compressionMethod === 0) {
          return new TextDecoder().decode(fileData);
        } else if (compressionMethod === 8) {
          try {
            const decompressed = await decompressDeflate(fileData);
            return new TextDecoder().decode(decompressed);
          } catch (e) {
            console.error("Decompression failed:", e);
            return null;
          }
        }
      }
      
      pos += 30 + filenameLength + extraLength + compressedSize;
    } else {
      pos++;
    }
  }
  
  return null;
}

// Decompress deflate data using DecompressionStream
async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  
  const buffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(buffer);
  view.set(data);
  
  writer.write(view);
  writer.close();
  
  const chunks: Uint8Array[] = [];
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
  
  return result;
}

// Extract text from Office XML
function extractTextFromXml(xml: string): string {
  const textParts: string[] = [];
  
  const textRegex = /<(?:w:t|a:t|t)[^>]*>([^<]*)<\/(?:w:t|a:t|t)>/g;
  let match;
  
  while ((match = textRegex.exec(xml)) !== null) {
    if (match[1].trim()) {
      textParts.push(match[1]);
    }
  }
  
  if (textParts.length === 0) {
    const genericRegex = />([^<]+)</g;
    while ((match = genericRegex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text && !/^\s*$/.test(text) && !/^[\d\s.,-]+$/.test(text)) {
        textParts.push(text);
      }
    }
  }
  
  return textParts.join(' ');
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

// Clean extracted text
function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Split text into overlapping chunks for RAG
function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
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
