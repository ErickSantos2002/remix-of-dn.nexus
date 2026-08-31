import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_API_BASE = "https://api.daily.co/v1";
const MAX_ATTEMPTS = 3;
// Jobs por execucao. Cada um faz de 3 a 5 chamadas seriais a API do Daily
// (~7s), e a edge function tem tempo de parede limitado — 8 deixa margem
// confortavel dentro do minuto entre execucoes do cron.
const BATCH_SIZE = 8;
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
}

async function decryptToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function getDailyApiKey(supabaseAdmin: ReturnType<typeof createClient>, workspaceId: string): Promise<string> {
  const { data: workspace } = await supabaseAdmin
    .from("workspaces").select("company_id").eq("id", workspaceId).single();
  if (!workspace) throw new Error("Workspace not found");
  const { data: company } = await supabaseAdmin
    .from("companies").select("id, daily_api_key").eq("id", workspace.company_id).single();
  if (!company?.daily_api_key) throw new Error("Daily.co API key not configured");
  return await decryptToken(company.daily_api_key, company.id);
}

async function dailyFetch(apiKey: string, path: string, options: RequestInit = {}) {
  const method = options.method || "GET";
  console.log(`[worker] dailyFetch -> ${method} ${path}`);
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[worker] dailyFetch <- ${method} ${path} status=${res.status} body=${text.slice(0, 500)}`);
    throw new Error(`Daily API error ${res.status}: ${text}`);
  }
  console.log(`[worker] dailyFetch <- ${method} ${path} status=${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function recoverStuckJobs(supabaseAdmin: ReturnType<typeof createClient>) {
  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  const { data: stuckJobs } = await supabaseAdmin
    .from("daily_recording_recovery_jobs")
    .select("id, attempts")
    .eq("status", "processing")
    .lt("started_at", fiveMinutesAgo);

  if (!stuckJobs?.length) return 0;

  console.log("[worker] Found", stuckJobs.length, "stuck jobs to recover");

  for (const job of stuckJobs) {
    if (job.attempts >= MAX_ATTEMPTS) {
      await supabaseAdmin.from("daily_recording_recovery_jobs").update({
        status: "failed",
        error: "Job travou em processing e excedeu tentativas",
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      await supabaseAdmin.from("daily_recording_recovery_jobs").update({
        status: "pending",
        started_at: null,
      }).eq("id", job.id);
    }
  }

  return stuckJobs.length;
}

async function processJob(
  supabaseAdmin: ReturnType<typeof createClient>,
  job: { id: string; workspace_id: string; appointment_id: string; attempts: number; recovery_type?: string }
) {
  const recoveryType = job.recovery_type || "all";
  console.log("[worker] Processing job:", job.id, "attempt:", job.attempts + 1, "recovery_type:", recoveryType, "appointment_id:", job.appointment_id, "workspace_id:", job.workspace_id);

  await supabaseAdmin.from("daily_recording_recovery_jobs").update({
    status: "processing",
    started_at: new Date().toISOString(),
    attempts: job.attempts + 1,
  }).eq("id", job.id);

  try {
    const { data: appt } = await supabaseAdmin
      .from("crm_appointments")
      .select("id, workspace_id, daily_room_name")
      .eq("id", job.appointment_id)
      .single();

    if (!appt?.daily_room_name) throw new Error("No Daily room found");

    console.log("[worker] Appointment loaded. room_name=", appt.daily_room_name);

    let apiKey: string;
    try {
      apiKey = await getDailyApiKey(supabaseAdmin, appt.workspace_id);
      console.log("[worker] Daily API key loaded (len=" + apiKey.length + ") for workspace", appt.workspace_id);
    } catch (keyErr) {
      console.error("[worker] Failed to load Daily API key:", keyErr);
      throw keyErr;
    }

    // ─── Gather recording URL (skip if transcription-only) ────────
    let recordingPayload: { download_url: string; recording_id: string; duration?: number } | null = null;

    if (recoveryType !== "transcription") {
      let recordings: Array<Record<string, unknown>> = [];
      try {
        const recData = await dailyFetch(apiKey, `/recordings?room_name=${appt.daily_room_name}`);
        recordings = recData?.data || (Array.isArray(recData) ? recData : []);
      } catch (e) {
        console.error("[worker] Failed to list recordings:", e);
      }

      console.log("[worker] Found", recordings.length, "recordings for room_name=", appt.daily_room_name);
      if (recordings.length > 0) {
        const summary = recordings.slice(0, 5).map((r) => ({
          id: r.id,
          room_name: r.room_name,
          status: r.status,
          start_ts: r.start_ts,
          duration: r.duration,
          mtgSessionId: r.mtgSessionId,
        }));
        console.log("[worker] Recording summary:", JSON.stringify(summary));
      } else {
        // Diagnostic fallback: list 10 most recent recordings in the account
        try {
          const recentData = await dailyFetch(apiKey, `/recordings?limit=10`);
          const recent = recentData?.data || (Array.isArray(recentData) ? recentData : []);
          const recentSummary = recent.map((r: Record<string, unknown>) => ({
            id: r.id,
            room_name: r.room_name,
            start_ts: r.start_ts,
            status: r.status,
          }));
          console.log("[worker] DIAGNOSTIC: 10 most recent recordings in account:", JSON.stringify(recentSummary));
        } catch (diagErr) {
          console.error("[worker] DIAGNOSTIC: failed to list recent recordings:", diagErr);
        }
      }

      for (const rec of recordings) {
        const recordingId = rec.id as string;
        const duration = rec.duration as number | undefined;

        let accessUrl = (rec.download_url || rec.download_link) as string | undefined;
        if (!accessUrl) {
          try {
            const accessData = await dailyFetch(apiKey, `/recordings/${recordingId}/access-link`);
            accessUrl = accessData?.download_link as string | undefined;
          } catch (accessErr) {
            console.error("[worker] Failed to get access-link:", accessErr);
          }
        }

        if (accessUrl) {
          recordingPayload = { download_url: accessUrl, recording_id: recordingId, duration };
          break;
        }
      }
    }

    // ─── Gather transcription URL (skip if recording-only) ────────
    let transcriptionPayload: { download_url: string; transcription_id: string } | null = null;
    // Todas as partes da conversa; transcriptionPayload guarda a primeira apenas
    // por compatibilidade com quem ainda le o campo singular.
    const transcriptionParts: Array<{ download_url: string; transcription_id: string }> = [];

    if (recoveryType !== "recording") {
      // Strategy 1: Try via room endpoint (works if room still exists)
      let roomId: string | null = null;
      try {
        const roomInfo = await dailyFetch(apiKey, `/rooms/${appt.daily_room_name}`);
        roomId = roomInfo?.id || null;
      } catch {
        console.log("[worker] Room not found (expired/deleted), trying fallback via recordings API");
      }

      // Strategy 2: mtgSessionId a partir das gravacoes.
      //
      // Buscado SEMPRE, nao so quando a sala sumiu: os logs mostram salas vivas
      // (GET /rooms = 200) cuja consulta por roomId devolve 0 transcricoes,
      // enquanto a mesma reuniao retorna 1 quando consultada por mtgSessionId.
      // Como so tentavamos roomId nesse caso, a transcricao existia e era dada
      // como inexistente.
      let mtgSessionId: string | null = null;
      try {
        const recData = await dailyFetch(apiKey, `/recordings?room_name=${appt.daily_room_name}`);
        const recs = recData?.data || (Array.isArray(recData) ? recData : []);
        if (recs.length > 0) {
          mtgSessionId = (recs[0].mtgSessionId || recs[0].session_id) as string | undefined || null;
          console.log("[worker] Found mtgSessionId from recordings:", mtgSessionId);
        }
      } catch (recErr) {
        console.error("[worker] Failed to list recordings for session lookup:", recErr);
      }

      // Fetch transcripts: tenta roomId e, se nao achar nada, mtgSessionId
      try {
        let transcripts: Array<Record<string, unknown>> = [];

        const readTranscripts = (payload: unknown): Array<Record<string, unknown>> => {
          const data = (payload as { data?: Array<Record<string, unknown>> })?.data;
          return data || (Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : []);
        };

        if (roomId) {
          transcripts = readTranscripts(await dailyFetch(apiKey, `/transcript?roomId=${roomId}`));
          console.log("[worker] Found", transcripts.length, "transcripts by roomId");
        }

        if (transcripts.length === 0 && mtgSessionId) {
          transcripts = readTranscripts(
            await dailyFetch(apiKey, `/transcript?mtgSessionId=${mtgSessionId}`),
          );
          console.log("[worker] Found", transcripts.length, "transcripts by mtgSessionId");
        }

        if (!roomId && !mtgSessionId) {
          console.log("[worker] No roomId or mtgSessionId available for transcript lookup");
        }

        console.log("[worker] Found", transcripts.length, "transcripts");

        // TODAS as transcricoes da sala, em ordem cronologica.
        //
        // A mesma sala pode ter varias: se o cliente cai e a reuniao e retomada,
        // o Daily inicia uma nova transcricao. Antes pegavamos so a mais longa
        // (sort por duration + [0]), o que descartava silenciosamente os demais
        // trechos da mesma conversa.
        const ordered = [...transcripts]
          .filter((t: { transcriptId?: string; id?: string }) => t.transcriptId || t.id)
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
            const at = String(a.startTs ?? a.start_ts ?? a.createdAt ?? a.created_at ?? "");
            const bt = String(b.startTs ?? b.start_ts ?? b.createdAt ?? b.created_at ?? "");
            return at.localeCompare(bt);
          });

        for (const item of ordered) {
          const transcriptId = (item.transcriptId || item.id) as string;
          try {
            const content = await dailyFetch(apiKey, `/transcript/${transcriptId}/access-link`);
            if (content?.link) {
              transcriptionParts.push({ download_url: content.link, transcription_id: transcriptId });
            }
          } catch (trContentErr) {
            // Uma parte inacessivel nao pode inviabilizar as outras
            console.error("[worker] Failed to fetch transcript access-link:", transcriptId, trContentErr);
          }
        }

        if (transcriptionParts.length > 0) {
          console.log("[worker] Transcript parts to process:", transcriptionParts.length);
          transcriptionPayload = transcriptionParts[0];
        }
      } catch (trErr) {
        console.error("[worker] Failed to fetch transcripts:", trErr);
      }
    }

    // ─── Forward to shared processing function ──────────────────────
    if (!recordingPayload && !transcriptionPayload) {
      throw new Error(
        `No recording or transcription found to process (room_name=${appt.daily_room_name}, recovery_type=${recoveryType}). ` +
        `Verifique nos logs acima a chamada GET /recordings?room_name=... e o DIAGNOSTIC com as 10 gravações mais recentes.`,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const processPayload: Record<string, unknown> = {
      appointment_id: appt.id,
      workspace_id: appt.workspace_id,
    };
    if (recordingPayload) processPayload.recording = recordingPayload;
    if (transcriptionPayload) processPayload.transcription = transcriptionPayload;
    if (transcriptionParts.length > 0) processPayload.transcriptions = transcriptionParts;

    console.log("[worker] Forwarding to process-daily-recording");
    const processResponse = await fetch(
      `${supabaseUrl}/functions/v1/process-daily-recording`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify(processPayload),
      }
    );

    const processResult = await processResponse.json();
    console.log("[worker] Processing result:", JSON.stringify(processResult));

    // Mark job completed
    await supabaseAdmin.from("daily_recording_recovery_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result: processResult,
    }).eq("id", job.id);

    console.log("[worker] Job completed:", job.id);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[worker] Job failed:", job.id, errorMsg);

    // "Nao ha o que processar" nao e falha transitoria: a API do Daily respondeu
    // bem e simplesmente nao tem o arquivo. Repetir consome tres ciclos da fila
    // por job sem nenhuma chance de resultado diferente.
    const isDefinitive = errorMsg.includes("No recording or transcription found");
    const newStatus = isDefinitive || (job.attempts + 1) >= MAX_ATTEMPTS ? "failed" : "pending";

    if (isDefinitive) {
      console.log("[worker] Falha definitiva, sem retentativa:", job.id);
    }

    await supabaseAdmin.from("daily_recording_recovery_jobs").update({
      status: newStatus,
      error: errorMsg,
      completed_at: newStatus === "failed" ? new Date().toISOString() : null,
    }).eq("id", job.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Recover stuck jobs
    const recovered = await recoverStuckJobs(supabaseAdmin);
    if (recovered > 0) {
      console.log("[worker] Recovered", recovered, "stuck jobs");
    }

    // Step 2: Fetch pending jobs (max 3 per run)
    const { data: jobs, error } = await supabaseAdmin
      .from("daily_recording_recovery_jobs")
      .select("id, workspace_id, appointment_id, attempts, recovery_type")
      .eq("status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;

    console.log("[worker] Found", jobs?.length || 0, "pending jobs");

    for (const job of (jobs || [])) {
      await processJob(supabaseAdmin, job);
    }

    return new Response(
      JSON.stringify({ processed: jobs?.length || 0, recovered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[worker] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
