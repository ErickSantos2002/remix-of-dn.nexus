import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProcessPayload {
  appointment_id: string;
  workspace_id: string;
  recording?: {
    download_url: string;
    recording_id: string;
    duration?: number;
  };
  /** Uma parte — formato do webhook do Daily, um evento por transcricao. */
  transcription?: {
    download_url: string;
    transcription_id: string;
  };
  /** Todas as partes da sala — formato do worker de recuperacao. */
  transcriptions?: Array<{
    download_url: string;
    transcription_id: string;
  }>;
}

interface ProcessResult {
  recording_processed: boolean;
  transcription_processed: boolean;
  ai_analysis_triggered: boolean;
  errors: string[];
}

// ─── Transcription Parser ───────────────────────────────────────────

/** Chave de comparacao de nomes: sem acento, sem caixa, espacos colapsados. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSpeakerLabel(
  rawId: string | undefined,
  nameMap: Record<string, string>,
): string {
  if (!rawId) return "Participante";
  if (nameMap[rawId]) return nameMap[rawId];

  // A transcricao do Daily as vezes identifica o falante pelo NOME, nao pelo
  // participant_id. Sem esta busca o rotulo de papel (Atendente/Cliente) se
  // perdia e a IA ficava sem saber quem e o vendedor.
  const byName = nameMap[`name:${normalizeName(rawId)}`];
  if (byName) return byName;
  // Deepgram may emit numeric speaker indexes when no participantId is set.
  // If we only have 2 known participants, map 0 -> host, 1 -> guest as fallback.
  if (/^\d+$/.test(rawId)) {
    const entries = Object.entries(nameMap)
      .filter(([key]) => !key.startsWith("name:"))
      .map(([, label]) => label);
    if (entries.length > 0) {
      const idx = parseInt(rawId, 10);
      if (entries[idx]) return entries[idx];
    }
  }
  return rawId;
}

function parseTranscriptionToText(
  rawJson: string,
  nameMap: Record<string, string> = {},
): string {
  try {
    const data = JSON.parse(rawJson);

    // Daily.co: array de segmentos, ou objeto com array em results
    type RawSegment = { speaker?: string; participantId?: string; text?: string; timestamp?: number; s?: number };
    const rawSegments: RawSegment[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : [];

    if (rawSegments.length > 0) {
      // Segmentos consecutivos do mesmo falante viram um turno so: o transcritor
      // corta a fala a cada poucos segundos, e repetir "[m:ss] Nome:" no meio de
      // cada frase quebrava a leitura da IA e a conferencia de citacoes.
      const turns: Array<{ speaker: string; ts: number | null; texts: string[] }> = [];
      for (const segment of rawSegments) {
        const text = (segment.text || "").trim();
        if (!text) continue;
        const rawId = segment.participantId || segment.speaker;
        const speaker = resolveSpeakerLabel(rawId, nameMap);
        const ts = segment.timestamp ?? segment.s ?? null;

        const current = turns[turns.length - 1];
        if (current && current.speaker === speaker) {
          current.texts.push(text);
        } else {
          turns.push({ speaker, ts, texts: [text] });
        }
      }

      return turns
        .map((turn) => {
          const timeStr =
            turn.ts != null
              ? `[${Math.floor(turn.ts / 60)}:${String(Math.floor(turn.ts % 60)).padStart(2, "0")}] `
              : "";
          return `${timeStr}${turn.speaker}: ${turn.texts.join(" ")}`;
        })
        .join("\n");
    }

    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    // Nao e JSON — fallback WebVTT.
    //
    // Alem do cabecalho, notas e linhas de tempo, e preciso descartar os
    // identificadores de cue ("transcript:357") e extrair o falante da tag de
    // voz (<v>Nome:</v>texto). Sem isso o texto salvo intercala numeros e
    // marcacao no meio de cada frase, o que quebra a leitura da IA e a
    // conferencia literal das citacoes.
    const turns: Array<{ speaker: string | null; texts: string[] }> = [];

    for (const line of rawJson.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "WEBVTT") continue;
      if (trimmed.startsWith("NOTE")) continue;
      if (/-->/.test(trimmed)) continue;
      if (/^\d+$/.test(trimmed)) continue;
      if (/^[A-Za-z_][A-Za-z0-9_-]*:\d+$/.test(trimmed)) continue;

      const voice = trimmed.match(/^<v(?:\s[^>]*)?>\s*([^<]*?)\s*:?\s*<\/v>\s*(.*)$/i);
      const speaker = voice ? voice[1] || null : null;
      const text = (voice ? voice[2] : trimmed).replace(/<\/?[^>]+>/g, "").trim();
      if (!text) continue;

      const current = turns[turns.length - 1];
      if (current && current.speaker === speaker) current.texts.push(text);
      else turns.push({ speaker, texts: [text] });
    }

    const vttText = turns
      .map((turn) => (turn.speaker ? `${turn.speaker}: ${turn.texts.join(" ")}` : turn.texts.join(" ")))
      .join("\n");

    return vttText || rawJson;
  }
}

async function buildParticipantNameMap(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  // Load recorded participants from webhook
  const { data: participants } = await supabase
    .from("daily_meeting_participants")
    .select("participant_id, user_name, is_owner")
    .eq("appointment_id", appointmentId);

  // Fallback names from appointment (host = assigned_to profile, guest = contact)
  let hostName: string | null = null;
  let guestName: string | null = null;
  const { data: appt } = await supabase
    .from("crm_appointments")
    .select("assigned_to, contact_id")
    .eq("id", appointmentId)
    .single();

  if (appt?.assigned_to) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", appt.assigned_to)
      .single();
    if (prof?.name) hostName = prof.name;
  }
  if (appt?.contact_id) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("name")
      .eq("id", appt.contact_id)
      .single();
    if (contact?.name) guestName = contact.name;
  }

  for (const p of (participants ?? []) as Array<{ participant_id: string; user_name: string | null; is_owner: boolean }>) {
    const fallback = p.is_owner ? hostName : guestName;
    // O Daily grava user_name percent-encoded ("Maria%20Silva")
    let decoded = p.user_name ?? "";
    try {
      decoded = decodeURIComponent(decoded);
    } catch { /* nao estava encodado */ }

    const baseName = decoded || fallback || (p.is_owner ? "Atendente" : "Cliente");
    const role = p.is_owner ? "Atendente" : "Cliente";
    const label = `${baseName} (${role})`;

    map[p.participant_id] = label;
    // Indice paralelo por nome: cobre transcricoes que identificam o falante
    // pelo nome em vez do participant_id
    if (baseName) map[`name:${normalizeName(baseName)}`] = label;
    if (fallback) map[`name:${normalizeName(fallback)}`] = label;
  }

  return map;
}



// ─── DB Helpers ─────────────────────────────────────────────────────

async function upsertRecording(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  workspaceId: string,
  data: { recording_url: string; status: string; duration_seconds: number | null }
) {
  const { data: existing } = await supabase
    .from("daily_recordings")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (existing) {
    await supabase.from("daily_recordings").update({
      recording_url: data.recording_url,
      status: data.status,
      duration_seconds: data.duration_seconds,
    }).eq("id", existing.id);
  } else {
    await supabase.from("daily_recordings").insert({
      appointment_id: appointmentId,
      workspace_id: workspaceId,
      recording_url: data.recording_url,
      status: data.status,
      duration_seconds: data.duration_seconds,
    });
  }
}

async function updateTranscription(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  workspaceId: string,
  transcriptionUrl: string,
  status: string,
  transcriptionText: string | null
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("daily_recordings")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (existing) {
    await supabase.from("daily_recordings").update({
      transcription_url: transcriptionUrl,
      transcription_text: transcriptionText,
      status: status === "ready" ? "ready" : status,
    }).eq("id", existing.id);
    return existing.id;
  } else {
    const { data: inserted } = await supabase.from("daily_recordings").insert({
      appointment_id: appointmentId,
      workspace_id: workspaceId,
      recording_url: "",
      transcription_url: transcriptionUrl,
      transcription_text: transcriptionText,
      status: "transcription_" + status,
    }).select("id").single();
    return inserted?.id || null;
  }
}

// ─── Recording Handler ─────────────────────────────────────────────

const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB

async function handleRecording(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  workspaceId: string,
  recording: { download_url: string; recording_id: string; duration?: number }
): Promise<boolean> {
  const { download_url, recording_id, duration } = recording;

  console.log("[process-recording] Checking file size via HEAD:", recording_id);

  // Check file size before downloading
  let fileSize: number | null = null;
  try {
    const headResponse = await fetch(download_url, { method: "HEAD" });
    if (headResponse.ok) {
      const contentLength = headResponse.headers.get("content-length");
      fileSize = contentLength ? parseInt(contentLength, 10) : null;
      console.log("[process-recording] File size from HEAD:", fileSize ? `${Math.round(fileSize / 1024 / 1024)}MB` : "unknown");
    }
  } catch (headErr) {
    console.warn("[process-recording] HEAD request failed:", headErr);
  }

  // If file is too large OR size unknown (can't risk OOM), save external link
  if (fileSize === null || fileSize > MAX_DOWNLOAD_SIZE) {
    console.log("[process-recording] File too large for download, saving as external_link");
    await upsertRecording(supabase, appointmentId, workspaceId, {
      recording_url: download_url,
      status: "external_link",
      duration_seconds: duration || null,
    });
    await supabase.from("crm_appointments")
      .update({ recording_id })
      .eq("id", appointmentId);
    console.log("[process-recording] Large recording saved as external_link");
    return true;
  }

  console.log("[process-recording] Downloading recording:", recording_id);

  const response = await fetch(download_url);
  if (!response.ok) {
    console.error("[process-recording] Failed to download recording:", response.status);
    await upsertRecording(supabase, appointmentId, workspaceId, {
      recording_url: download_url,
      status: "download_failed",
      duration_seconds: duration || null,
    });
    return false;
  }

  const fileBuffer = await response.arrayBuffer();
  const fileSizeKB = Math.round(fileBuffer.byteLength / 1024);
  console.log("[process-recording] Recording downloaded, size:", fileSizeKB, "KB");

  // Upload to Storage
  const storagePath = `${workspaceId}/${appointmentId}/recording-${recording_id}.mp4`;
  const { error: uploadError } = await supabase.storage
    .from("recordings")
    .upload(storagePath, fileBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (uploadError) {
    console.error("[process-recording] Storage upload error:", uploadError);
    await upsertRecording(supabase, appointmentId, workspaceId, {
      recording_url: download_url,
      status: "upload_failed",
      duration_seconds: duration || null,
    });
    return false;
  }

  console.log("[process-recording] Recording saved to storage:", storagePath);

  await upsertRecording(supabase, appointmentId, workspaceId, {
    recording_url: storagePath,
    status: "ready",
    duration_seconds: duration || null,
  });

  // Update appointment with recording_id
  await supabase.from("crm_appointments")
    .update({ recording_id })
    .eq("id", appointmentId);

  console.log("[process-recording] Recording processed successfully");
  return true;
}

// ─── Transcription Handler ──────────────────────────────────────────

/**
 * Processa TODAS as partes da transcricao de uma reuniao.
 *
 * A mesma sala pode ter mais de uma transcricao: se o cliente cai e a reuniao e
 * retomada, o Daily inicia outra. Cada parte e baixada e convertida
 * separadamente — o mapa de participantes vale para todas — e o texto final e a
 * concatenacao na ordem em que vieram, que o worker ja entrega cronologica.
 */
async function handleTranscription(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
  workspaceId: string,
  parts: Array<{ download_url: string; transcription_id: string }>
): Promise<{ processed: boolean; recordingId: string | null }> {
  if (parts.length === 0) return { processed: false, recordingId: null };

  const nameMap = await buildParticipantNameMap(supabase, appointmentId);
  console.log("[process-recording] Participant name map:", nameMap);

  const segments: string[] = [];
  const rawByPart: Array<{ id: string; raw: string }> = [];

  for (const part of parts) {
    console.log("[process-recording] Downloading transcription:", part.transcription_id);
    const response = await fetch(part.download_url);
    if (!response.ok) {
      // Uma parte indisponivel nao descarta as demais
      console.error("[process-recording] Failed to download part:", part.transcription_id, response.status);
      continue;
    }

    const rawText = await response.text();
    const parsed = parseTranscriptionToText(rawText, nameMap);
    if (parsed.trim()) {
      segments.push(parsed);
      rawByPart.push({ id: part.transcription_id, raw: rawText });
    }
  }

  if (segments.length === 0) {
    console.error("[process-recording] No transcription part could be downloaded");
    await updateTranscription(supabase, appointmentId, workspaceId, parts[0].download_url, "download_failed", null);
    return { processed: false, recordingId: null };
  }

  // Separador explicito: sem ele, a retomada da reuniao pareceria continuacao
  // direta da fala anterior
  const parsedText =
    segments.length > 1
      ? segments.join("\n\n--- continuacao da reuniao ---\n\n")
      : segments[0];

  console.log(
    `[process-recording] Parsed ${segments.length} part(s), total length: ${parsedText.length}`,
  );

  let lastStoragePath: string | null = null;
  for (const part of rawByPart) {
    const storagePath = `${workspaceId}/${appointmentId}/transcription-${part.id}.json`;
    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(storagePath, part.raw, { contentType: "application/json", upsert: true });

    if (uploadError) {
      console.error("[process-recording] Storage upload error:", uploadError);
    } else {
      lastStoragePath = storagePath;
    }
  }

  if (!lastStoragePath) {
    const recordingId = await updateTranscription(supabase, appointmentId, workspaceId, parts[0].download_url, "upload_failed", parsedText);
    return { processed: false, recordingId };
  }

  console.log("[process-recording] Transcription saved to storage:", lastStoragePath);
  const recordingId = await updateTranscription(supabase, appointmentId, workspaceId, lastStoragePath, "ready", parsedText);
  console.log("[process-recording] Transcription processed successfully");
  return { processed: true, recordingId };
}

// ─── AI Analysis Trigger ────────────────────────────────────────────

/**
 * Resolve a analise de atendimento vinculada a esta reuniao.
 * Prioriza a atividade (vinculo canonico) e cai para o appointment, que e o
 * unico vinculo existente quando a reuniao foi criada sem atividade.
 */
async function resolveAnalysisPlaybookId(
  supabase: ReturnType<typeof createClient>,
  appointmentId: string,
): Promise<string | null> {
  try {
    const { data: activity } = await supabase
      .from("crm_lead_activities")
      .select("analysis_playbook_id")
      .eq("appointment_id", appointmentId)
      .not("analysis_playbook_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (activity?.analysis_playbook_id) return activity.analysis_playbook_id as string;

    const { data: appointment } = await supabase
      .from("crm_appointments")
      .select("analysis_playbook_id")
      .eq("id", appointmentId)
      .maybeSingle();
    return (appointment?.analysis_playbook_id as string) ?? null;
  } catch (error) {
    console.error("[process-recording] Error resolving analysis playbook:", error);
    return null;
  }
}

/** Avaliacao contra playbook: substitui a analise generica quando ha analise vinculada. */
async function triggerPlaybookAnalysis(workspaceId: string, recordingId: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log("[process-recording] Triggering playbook analysis for recording:", recordingId);

    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-transcript-playbook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        action: "evaluate",
        source_type: "daily_recording",
        source_id: recordingId,
        workspace_id: workspaceId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[process-recording] Playbook analysis failed:", response.status, errText);
      return false;
    }

    const result = await response.json();
    if (result?.skipped) {
      console.log("[process-recording] Playbook analysis skipped:", result.reason);
      return false;
    }
    console.log("[process-recording] Playbook analysis completed, score:", result?.score);
    return true;
  } catch (error) {
    console.error("[process-recording] Error triggering playbook analysis:", error);
    return false;
  }
}

async function triggerAIAnalysis(workspaceId: string, recordingId: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    console.log("[process-recording] Auto-triggering AI analysis for recording:", recordingId);

    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-meeting`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ recording_id: recordingId, workspace_id: workspaceId }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[process-recording] AI analysis trigger failed:", response.status, errText);
      return false;
    }

    const result = await response.json();
    console.log("[process-recording] AI analysis completed:", result.activity_type);
    return true;
  } catch (error) {
    console.error("[process-recording] Error triggering AI analysis:", error);
    return false;
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: ProcessPayload = await req.json();
    const { appointment_id, workspace_id, recording, transcription, transcriptions } = payload;

    if (!appointment_id || !workspace_id) {
      return new Response(
        JSON.stringify({ error: "appointment_id and workspace_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!recording && !transcription) {
      return new Response(
        JSON.stringify({ error: "At least one of recording or transcription must be provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[process-recording] Processing for appointment:", appointment_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const result: ProcessResult = {
      recording_processed: false,
      transcription_processed: false,
      ai_analysis_triggered: false,
      errors: [],
    };

    // Process transcription FIRST (lightweight, essential for AI analysis)
    let recordingId: string | null = null;
    // O webhook do Daily entrega uma transcricao por evento; o worker de
    // recuperacao entrega todas as partes da sala de uma vez.
    const transcriptionParts: Array<{ download_url: string; transcription_id: string }> =
      Array.isArray(transcriptions) && transcriptions.length > 0
        ? transcriptions
        : transcription?.download_url
          ? [transcription]
          : [];

    if (transcriptionParts.length > 0) {
      try {
        const trResult = await handleTranscription(supabase, appointment_id, workspace_id, transcriptionParts);
        result.transcription_processed = trResult.processed;
        recordingId = trResult.recordingId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[process-recording] Transcription error:", msg);
        result.errors.push(`transcription: ${msg}`);
      }
    }

    // Auto-trigger AI analysis right after transcription (before video).
    // Com analise de atendimento vinculada, a avaliacao contra playbook substitui
    // a analise generica (ela ja produz o resumo que ocupa ai_analysis).
    if (recordingId && result.transcription_processed) {
      const analysisPlaybookId = await resolveAnalysisPlaybookId(supabase, appointment_id);
      result.ai_analysis_triggered = analysisPlaybookId
        ? await triggerPlaybookAnalysis(workspace_id, recordingId)
        : await triggerAIAnalysis(workspace_id, recordingId);

      // Se a avaliacao por playbook nao produziu resultado, cai no fluxo generico
      if (analysisPlaybookId && !result.ai_analysis_triggered) {
        result.ai_analysis_triggered = await triggerAIAnalysis(workspace_id, recordingId);
      }
    }

    // Process recording LAST (can be large and fail without affecting transcription/AI)
    if (recording?.download_url) {
      try {
        result.recording_processed = await handleRecording(supabase, appointment_id, workspace_id, recording);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[process-recording] Recording error:", msg);
        result.errors.push(`recording: ${msg}`);
      }
    }

    console.log("[process-recording] Done:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[process-recording] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
