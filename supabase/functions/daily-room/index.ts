import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleGuestJoinedMeeting,
  notifyMeetingStarted,
  notifyMeetingEnded,
} from "../_shared/onGuestJoinedMeeting.ts";
import { recordMeetingParticipant } from "../_shared/meetingParticipants.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_API_BASE = "https://api.daily.co/v1";

// Runtime de edge da Supabase (waitUntil para tarefas em background)
const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;

// Fonte unica de verdade para as propriedades da sala Daily.
// IMPORTANTE: enable_pip_ui precisa estar na CONFIG DA SALA (REST API),
// nao no createFrame() do Daily JS. E so com a sala configurada assim
// que o Daily Prebuilt mostra o botao nativo de Picture-in-Picture.
//
// IMPORTANTE 2: `exp` precisa ser renovado em TODO `token` / `guest-token`.
// Salas sao criadas com exp = now + 24h. Se uma reuniao for agendada com
// mais de 24h de antecedencia (caso comum), na hora da call o exp ja
// venceu e o Daily expulsa TODOS os participantes simultaneamente
// (sintoma: "a sala fechou para ambos"). Por isso o handler sempre faz
// PATCH /rooms/<name> com buildRoomProperties() antes de emitir o token.
const DAILY_ROOM_PROPERTIES = {
  enable_screenshare: true,
  enable_chat: true,
  enable_recording: "cloud" as const,
  enable_transcription_storage: true,
  enable_knocking: true,
  enable_pip_ui: true,
  lang: "pt-BR",
  start_video_off: false,
  start_audio_off: false,
} as const;

function buildRoomProperties(extra: Record<string, unknown> = {}) {
  return {
    ...DAILY_ROOM_PROPERTIES,
    exp: Math.floor(Date.now() / 1000) + 86400,
    ...extra,
  };
}


// AES-GCM decryption (mirrors src/lib/crypto.ts)
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
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
  const { data: workspace, error: wsError } = await supabaseAdmin
    .from("workspaces")
    .select("company_id")
    .eq("id", workspaceId)
    .single();
  if (wsError || !workspace) throw new Error("Workspace not found");

  const { data: company, error: compError } = await supabaseAdmin
    .from("companies")
    .select("id, daily_api_key")
    .eq("id", workspace.company_id)
    .single();
  if (compError || !company) throw new Error("Company not found");
  if (!company.daily_api_key) throw new Error("Daily.co API key not configured for this company");

  return await decryptToken(company.daily_api_key, company.id);
}

async function dailyFetch(apiKey: string, path: string, options: RequestInit = {}) {
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
    throw new Error(`Daily API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function ensureDailyWebhook(apiKey: string, supabaseUrl: string) {
  const DESIRED_EVENTS = [
    "recording.ready-to-download",
    "transcript.ready-to-download",
    "participant.joined",
    "meeting.ended",
  ];
  try {
    const webhookUrl = `${supabaseUrl}/functions/v1/daily-webhook`;
    const existing = await dailyFetch(apiKey, "/webhooks");
    const webhooks = Array.isArray(existing) ? existing : (existing?.data || []);

    const desiredEvents = [...DESIRED_EVENTS].sort().join(",");

    // Find a webhook pointing at our URL with the correct events AND healthy state.
    // Daily returns state in uppercase ("FAILED", "ACTIVE") — compare case-insensitively
    // so we recreate webhooks tripped by the circuit breaker.
    const matching = webhooks.find((w: { url?: string; eventTypes?: string[]; state?: string }) => {
      if (w.url !== webhookUrl) return false;
      const evs = (w.eventTypes || []).slice().sort().join(",");
      const state = (w.state || "").toLowerCase();
      return evs === desiredEvents && state !== "failed";
    });
    if (matching) {
      return { failed: false };
    }

    // Delete ALL existing webhooks on the domain (Daily allows only 1) to
    // make room for ours with the correct event set.
    for (const w of webhooks) {
      console.log("[daily-room] Deleting existing webhook:", w.uuid, "url=", w.url, "events=", w.eventTypes);
      try {
        await dailyFetch(apiKey, `/webhooks/${w.uuid}`, { method: "DELETE" });
      } catch (delErr) {
        console.warn("[daily-room] Failed to delete webhook", w.uuid, delErr);
      }
    }

    console.log("[daily-room] Registering webhook:", webhookUrl, "events=", DESIRED_EVENTS);
    await dailyFetch(apiKey, "/webhooks", {
      method: "POST",
      body: JSON.stringify({ url: webhookUrl, eventTypes: DESIRED_EVENTS }),
    });
    console.log("[daily-room] Webhook registered successfully");

  } catch (err) {
    console.error("[daily-room] Failed to register webhook (non-blocking):", err);
    return { failed: true, error: String(err) };
  }
  return { failed: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    switch (action) {
      case "create": {
        const { workspace_id, appointment_id } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);

        const roomName = `nexus-${appointment_id.replace(/-/g, "").slice(0, 16)}`;
        const room = await dailyFetch(apiKey, "/rooms", {
          method: "POST",
          body: JSON.stringify({
            name: roomName,
            privacy: "private",
            properties: buildRoomProperties(),
          }),
        });

        await supabaseAdmin
          .from("crm_appointments")
          .update({
            daily_room_name: room.name,
            daily_room_url: room.url,
            meeting_type: "daily",
          })
          .eq("id", appointment_id);

        // Non-blocking webhook registration to avoid CPU limit
        EdgeRuntime.waitUntil(ensureDailyWebhook(apiKey, supabaseUrl));

        return new Response(
          JSON.stringify({ room_name: room.name, room_url: room.url }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "token": {
        const { workspace_id, appointment_id, is_owner, user_name } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);

        const { data: appt } = await supabaseAdmin
          .from("crm_appointments")
          .select("daily_room_name")
          .eq("id", appointment_id)
          .single();
        if (!appt?.daily_room_name) throw new Error("No Daily room found for this appointment");

        // Renova exp + flags da sala (ver comentario em buildRoomProperties).
        try {
          await dailyFetch(apiKey, `/rooms/${appt.daily_room_name}`, {
            method: "POST",
            body: JSON.stringify({ properties: buildRoomProperties() }),
          });
          console.log(
            `[daily-room] exp refreshed for ${appt.daily_room_name} until ${new Date(
              (Math.floor(Date.now() / 1000) + 86400) * 1000,
            ).toISOString()} (token/host)`,
          );
        } catch (patchErr) {
          console.error(
            "[daily-room][meeting-close-risk] token: failed to refresh room exp",
            { room: appt.daily_room_name, workspace_id, err: String(patchErr) },
          );
        }

        const tokenPayload: Record<string, unknown> = {
          properties: {
            room_name: appt.daily_room_name,
            is_owner: !!is_owner,
            user_name: user_name || "Participante",
            lang: "pt-BR",
            enable_screenshare: true,
            start_video_off: !is_owner,
            start_audio_off: !is_owner,
            exp: Math.floor(Date.now() / 1000) + 86400,
          },
        };

        const tokenData = await dailyFetch(apiKey, "/meeting-tokens", {
          method: "POST",
          body: JSON.stringify(tokenPayload),
        });

        return new Response(
          JSON.stringify({ token: tokenData.token }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      case "delete": {
        const { workspace_id, room_name } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);

        await dailyFetch(apiKey, `/rooms/${room_name}`, { method: "DELETE" });

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "validate-guest": {
        // Fallback contra falhas do webhook: registra a entrada do convidado já
        // a partir do lobby (antes de obter o token). Marca contact_joined no
        // appointment e dispara a movimentação do lead para SQL.
        const { room_name, email, name } = body;
        console.log("[daily-room] validate-guest: room=", room_name, "email=", email);

        const { data: apptRow, error: apptError } = await supabaseAdmin
          .from("crm_appointments")
          .select("id, workspace_id, contact_id, title, daily_room_name, start_time, meeting_started_at, contact_joined_at, meeting_ended_at")
          .eq("daily_room_name", room_name)
          .maybeSingle();
        const appt = apptRow ? { ...apptRow, scheduled_at: apptRow.start_time } : null;


        if (apptError || !appt) {
          console.warn("[daily-room] validate-guest: appointment not found", apptError);
          return new Response(
            JSON.stringify({ ok: false, match: false, reason: "appointment_not_found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verifica match com o contato esperado (não-bloqueante)
        let match = false;
        let contactName: string | null = null;
        if (appt.contact_id) {
          const { data: contact } = await supabaseAdmin
            .from("crm_contacts")
            .select("name, email")
            .eq("id", appt.contact_id)
            .maybeSingle();
          contactName = contact?.name ?? null;
          if (contact?.email && email && contact.email.toLowerCase() === String(email).toLowerCase()) {
            match = true;
          }
        }

        // Registro assertivo do acesso: o lobby é determinístico, mesmo quando
        // o webhook do Daily não entrega o participant.joined.
        await recordMeetingParticipant(supabaseAdmin, {
          appointmentId: appt.id,
          source: "gate",
          identity: (email as string | undefined) || (name as string | undefined) || contactName,
          userName: (name as string | undefined) || contactName,
          isOwner: false,
        });


        // DEFENSIVE: só dispara side-effects (handoff/move SQL) se o host já
        // iniciou a reunião. Caso contrário, ainda registramos a passagem pelo
        // lobby mas sem mover o card.
        if (!appt.contact_joined_at) {
          await supabaseAdmin
            .from("crm_appointments")
            .update({
              contact_joined: true,
              contact_joined_at: new Date().toISOString(),
            })
            .eq("id", appt.id);
          if (appt.meeting_started_at) {
            edgeRuntime?.waitUntil?.(handleGuestJoinedMeeting(supabaseAdmin, appt));
            console.log("[daily-room] validate-guest: contact_joined recorded + side-effects for", appt.id, "match=", match);
          } else {
            console.log("[daily-room] validate-guest: contact_joined recorded WITHOUT side-effects (host not started yet) for", appt.id);
          }
        } else {
          console.log("[daily-room] validate-guest: already joined, skipping side-effects");
        }

        return new Response(
          JSON.stringify({ ok: true, match, name: contactName }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "lookup-contact": {
        const { room_name, email } = body;

        const { data: appt } = await supabaseAdmin
          .from("crm_appointments")
          .select("contact_id")
          .eq("daily_room_name", room_name)
          .maybeSingle();

        if (!appt?.contact_id) {
          return new Response(
            JSON.stringify({ match: false }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: contact } = await supabaseAdmin
          .from("crm_contacts")
          .select("name, email")
          .eq("id", appt.contact_id)
          .single();

        if (contact && contact.email && contact.email.toLowerCase() === email.toLowerCase()) {
          return new Response(
            JSON.stringify({ match: true, name: contact.name }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ match: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "start-transcription": {
        const { workspace_id, room_name: trRoomName } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);

        console.log("[daily-room] start-transcription: starting for room", trRoomName);

        try {
          await dailyFetch(apiKey, `/rooms/${trRoomName}/transcription/start`, {
            method: "POST",
            body: JSON.stringify({
              language: "pt",
              model: "nova-2",
              profanity_filter: false,
              endpointing: true,
              punctuate: true,
            }),
          });
          console.log("[daily-room] start-transcription: started successfully");
        } catch (trErr: unknown) {
          const msg = trErr instanceof Error ? trErr.message : String(trErr);
          if (msg.includes("409") || msg.includes("already") || msg.toLowerCase().includes("active stream")) {
            console.log("[daily-room] start-transcription: already running, ignoring");
          } else if (msg.includes("404")) {
            console.warn("[daily-room] start-transcription: room not active yet (404), client should retry");
            return new Response(
              JSON.stringify({ error: "room_not_active", retryable: true }),
              { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else if (/\b5\d{2}\b/.test(msg) || msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network")) {
            console.warn("[daily-room] start-transcription: transient error, client should retry:", msg);
            return new Response(
              JSON.stringify({ error: msg, retryable: true }),
              { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            console.error("[daily-room] start-transcription: error:", msg);
            return new Response(
              JSON.stringify({ error: msg }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "start-recording": {
        const { workspace_id, room_name: recRoomName } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);

        console.log("[daily-room] start-recording: starting for room", recRoomName);

        try {
          await dailyFetch(apiKey, `/rooms/${recRoomName}/recordings/start`, {
            method: "POST",
            body: JSON.stringify({ type: "cloud" }),
          });
          console.log("[daily-room] start-recording: started successfully");
        } catch (recErr: unknown) {
          const msg = recErr instanceof Error ? recErr.message : String(recErr);
          if (msg.includes("409") || msg.includes("already") || msg.toLowerCase().includes("active stream")) {
            console.log("[daily-room] start-recording: already running, ignoring");
          } else if (msg.includes("404")) {
            console.warn("[daily-room] start-recording: room not active yet (404), client should retry");
            return new Response(
              JSON.stringify({ error: "room_not_active", retryable: true }),
              { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else if (/\b5\d{2}\b/.test(msg) || msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network")) {
            console.warn("[daily-room] start-recording: transient error, client should retry:", msg);
            return new Response(
              JSON.stringify({ error: msg, retryable: true }),
              { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            console.error("[daily-room] start-recording: error:", msg);
            return new Response(
              JSON.stringify({ error: msg }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update-status": {
        const { room_name, event_type } = body;
        console.log("[daily-room] update-status: room_name=", room_name, "event_type=", event_type);

        const lookupAppointment = async () => {
          const res = await supabaseAdmin
            .from("crm_appointments")
            .select("id, workspace_id, contact_id, title, daily_room_name, start_time, meeting_started_at, contact_joined_at, meeting_ended_at")
            .eq("daily_room_name", room_name)
            .maybeSingle();
          if (res.data) {
            const row = res.data as { start_time?: string | null; scheduled_at?: string | null };
            row.scheduled_at = row.start_time;
          }
          return res;
        };


        const first = await lookupAppointment();
        let appt = first.data;
        const apptError = first.error;
        if (apptError) {
          console.error("[daily-room] update-status: lookup error:", apptError);
        }
        if (!appt) {
          // Retry once after a short delay (read-replica lag safety net).
          await new Promise((r) => setTimeout(r, 500));
          const retry = await lookupAppointment();
          appt = retry.data;
          if (retry.error) {
            console.error("[daily-room] update-status: retry lookup error:", retry.error);
          }
        }

        if (!appt) {
          console.warn("[daily-room] update-status: appointment not found for room_name=", room_name);
          return new Response(
            JSON.stringify({ ok: false, reason: "appointment_not_found", room_name }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Presença sempre registrada, mesmo quando o estado do appointment já
        // estava preenchido (entradas repetidas / segundo participante).
        if (event_type === "host-joined" || event_type === "guest-joined") {
          const isHostEvent = event_type === "host-joined";
          await recordMeetingParticipant(supabaseAdmin, {
            appointmentId: appt.id,
            source: "status",
            identity: (body.user_name as string | undefined) || (isHostEvent ? "host" : "convidado"),
            userName: (body.user_name as string | undefined) ?? null,
            isOwner: isHostEvent,
          });
        }

        if (event_type === "host-joined") {

          if (!appt.meeting_started_at) {
            await supabaseAdmin
              .from("crm_appointments")
              .update({ meeting_started_at: new Date().toISOString() })
              .eq("id", appt.id);
            edgeRuntime?.waitUntil?.(notifyMeetingStarted(supabaseAdmin, appt));
            console.log("[daily-room] update-status: host-joined recorded for", appt.id);
            // Convidado entrou ANTES do host: a passagem pelo gate já gravou
            // contact_joined_at sem side-effects (guarda do host). Dispara agora,
            // retroativamente, para a ordem de entrada não importar.
            if (appt.contact_joined_at) {
              edgeRuntime?.waitUntil?.(handleGuestJoinedMeeting(supabaseAdmin, appt));
              console.log("[daily-room] update-status: retroactive guest side-effects for", appt.id);
            }
          }
        } else if (event_type === "guest-joined") {
          // DEFENSIVE: ignorar guest se o host ainda não entrou.
          if (!appt.meeting_started_at) {
            console.log("[daily-room] update-status: guest-joined ignored (host not started) for", appt.id);
          } else if (!appt.contact_joined_at) {
            await supabaseAdmin
              .from("crm_appointments")
              .update({
                contact_joined: true,
                contact_joined_at: new Date().toISOString(),
              })
              .eq("id", appt.id);
            edgeRuntime?.waitUntil?.(handleGuestJoinedMeeting(supabaseAdmin, appt));
            console.log("[daily-room] update-status: guest-joined recorded for", appt.id);
          }
        } else if (event_type === "meeting-ended") {
          if (!appt.meeting_ended_at) {
            const updates: Record<string, unknown> = {
              meeting_ended_at: new Date().toISOString(),
            };
            let durationSeconds: number | null = null;
            if (appt.meeting_started_at) {
              const started = new Date(appt.meeting_started_at).getTime();
              durationSeconds = Math.round((Date.now() - started) / 1000);
              updates.actual_duration_seconds = durationSeconds;
            }
            await supabaseAdmin
              .from("crm_appointments")
              .update(updates)
              .eq("id", appt.id);
            edgeRuntime?.waitUntil?.(notifyMeetingEnded(supabaseAdmin, appt, durationSeconds));
            console.log("[daily-room] update-status: meeting-ended recorded for", appt.id);
          }
        }

        return new Response(
          JSON.stringify({ ok: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      case "guest-token": {
        const { room_name, user_name, is_owner: guestIsOwner } = body;

        console.log("[daily-room] guest-token: room_name=", room_name, "user_name=", user_name, "is_owner=", guestIsOwner);

        const { data: appt, error: apptError } = await supabaseAdmin
          .from("crm_appointments")
          .select("workspace_id, daily_room_name, daily_room_url, id")
          .eq("daily_room_name", room_name)
          .maybeSingle();

        console.log("[daily-room] guest-token: appt=", appt, "apptError=", apptError);

        if (!appt) {
          console.error("[daily-room] guest-token: Meeting not found for room_name=", room_name);
          return new Response(
            JSON.stringify({ error: "meeting_not_found", message: "Reunião não encontrada ou expirada" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SECURITY: only allow is_owner=true when the requester is an authenticated
        // member of the appointment's workspace. Anyone else is downgraded to guest.
        let effectiveIsOwner = !!guestIsOwner;
        if (effectiveIsOwner) {
          const authHeader = req.headers.get("Authorization");
          let isMember = false;
          if (authHeader?.startsWith("Bearer ")) {
            try {
              const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
              const userClient = createClient(supabaseUrl, anonKey, {
                global: { headers: { Authorization: authHeader } },
              });
              const { data: claims } = await userClient.auth.getUser();
              const userId = claims?.user?.id;
              if (userId) {
                const { data: memberCheck } = await supabaseAdmin
                  .rpc("is_workspace_member", {
                    _user_id: userId,
                    _workspace_id: appt.workspace_id,
                  });
                isMember = memberCheck === true;
              }
            } catch (authErr) {
              console.warn("[daily-room] guest-token: owner-check auth error:", authErr);
            }
          }
          if (!isMember) {
            console.warn(
              "[daily-room] guest-token: is_owner requested but caller is NOT a workspace member — downgrading to guest. room=",
              room_name,
            );
            effectiveIsOwner = false;
          }
        }

        // Chokepoint universal: host e convidado só entram na sala depois de
        // pedir o token aqui. Garante o registro mesmo sem webhook do Daily.
        await recordMeetingParticipant(supabaseAdmin, {
          appointmentId: appt.id,
          source: "token",
          identity: (user_name as string | undefined) || (effectiveIsOwner ? "host" : "convidado"),
          userName: (user_name as string | undefined) ?? null,
          isOwner: effectiveIsOwner,
        });


        const apiKey = await getDailyApiKey(supabaseAdmin, appt.workspace_id);

        try {
          await dailyFetch(apiKey, `/rooms/${room_name}`);
          // Sempre renova exp + flags (PiP/knocking/chat) para evitar que a
          // sala expire durante reunioes agendadas com >24h de antecedencia.
          try {
            await dailyFetch(apiKey, `/rooms/${room_name}`, {
              method: "POST",
              body: JSON.stringify({ properties: buildRoomProperties() }),
            });
            console.log(
              `[daily-room] exp refreshed for ${room_name} until ${new Date(
                (Math.floor(Date.now() / 1000) + 86400) * 1000,
              ).toISOString()} (guest-token, is_owner=${effectiveIsOwner})`,
            );
          } catch (patchErr) {
            console.error(
              "[daily-room][meeting-close-risk] guest-token: failed to refresh room exp",
              { room: room_name, workspace_id: appt.workspace_id, err: String(patchErr) },
            );
          }
        } catch (roomCheckErr: unknown) {
          const errMsg = roomCheckErr instanceof Error ? roomCheckErr.message : String(roomCheckErr);
          if (errMsg.includes("404")) {
            console.log("[daily-room] guest-token: Room expired/missing, re-creating:", room_name);
            try {
              await dailyFetch(apiKey, "/rooms", {
                method: "POST",
                body: JSON.stringify({
                  name: room_name,
                  privacy: "private",
                  properties: buildRoomProperties(),
                }),
              });
            } catch (createErr) {
              console.error(
                "[daily-room][meeting-close-risk] guest-token: failed to re-create expired room",
                { room: room_name, workspace_id: appt.workspace_id, err: String(createErr) },
              );
              throw createErr;
            }
          } else {
            console.error(
              "[daily-room][meeting-close-risk] guest-token: room check failed",
              { room: room_name, workspace_id: appt.workspace_id, err: errMsg },
            );
            throw roomCheckErr;
          }
        }


        const tokenData = await dailyFetch(apiKey, "/meeting-tokens", {
          method: "POST",
          body: JSON.stringify({
            properties: {
              room_name: room_name,
              is_owner: effectiveIsOwner,
              user_name: user_name || (effectiveIsOwner ? "Host" : "Convidado"),
              lang: "pt-BR",
              enable_screenshare: true,
              start_video_off: !effectiveIsOwner,
              start_audio_off: !effectiveIsOwner,
              exp: Math.floor(Date.now() / 1000) + 86400,
            },
          }),
        });

        // Auto-start transcription + recording in background when the host
        // (workspace member) joins. Daily requires the room to be "active"
        // (>=1 participant), so we retry up to 5x with delays. Idempotent:
        // 409 (already running) is treated as success.
        if (effectiveIsOwner) {
          const wsId = appt.workspace_id;
          const roomN = room_name;
          const autoStart = async () => {
            const attemptOnce = async (path: string, payload: Record<string, unknown>, label: string) => {
              const delays = [4000, 6000, 8000, 10000, 12000];
              for (let i = 0; i < delays.length; i++) {
                await new Promise((r) => setTimeout(r, delays[i]));
                try {
                  await dailyFetch(apiKey, path, { method: "POST", body: JSON.stringify(payload) });
                  console.log(`[daily-room] auto-${label}: started on attempt ${i + 1} for room ${roomN}`);
                  return;
                } catch (e: unknown) {
                  const m = e instanceof Error ? e.message : String(e);
                  if (m.includes("409") || m.includes("already")) {
                    console.log(`[daily-room] auto-${label}: already running (room=${roomN})`);
                    return;
                  }
                  console.warn(`[daily-room] auto-${label} attempt ${i + 1} failed (room=${roomN}):`, m);
                }
              }
              console.error(`[daily-room] auto-${label}: gave up after retries (room=${roomN}, ws=${wsId})`);
            };
            await Promise.allSettled([
              attemptOnce(`/rooms/${roomN}/transcription/start`, {
                language: "pt",
                model: "nova-2",
                profanity_filter: false,
                endpointing: true,
                punctuate: true,
              }, "transcription"),
              attemptOnce(`/rooms/${roomN}/recordings/start`, { type: "cloud" }, "recording"),
            ]);
          };
          if (edgeRuntime?.waitUntil) {
            edgeRuntime.waitUntil(autoStart());
          } else {
            // Fallback: fire-and-forget (still completes before runtime exit for short tasks)
            autoStart().catch((e) => console.error("[daily-room] autoStart failed:", e));
          }
        }

        return new Response(
          JSON.stringify({
            token: tokenData.token,
            room_url: appt.daily_room_url || `https://app.daily.co/${room_name}`,
            workspace_id: appt.workspace_id,
            is_owner: effectiveIsOwner,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      }

      // ============================================================
      // ASYNC: enqueue a recovery job instead of doing heavy work
      // ============================================================
      case "fetch-recordings": {
        const { appointment_id, recovery_type } = body;
        const validRecoveryType = ["transcription", "recording", "all"].includes(recovery_type) ? recovery_type : "all";

        // Validate appointment exists
        const { data: appt } = await supabaseAdmin
          .from("crm_appointments")
          .select("id, workspace_id, daily_room_name")
          .eq("id", appointment_id)
          .single();
        if (!appt?.daily_room_name) throw new Error("No Daily room found for this appointment");

        // Get requesting user from auth header
        const authHeader = req.headers.get("Authorization");
        let userId: string | null = null;
        if (authHeader?.startsWith("Bearer ")) {
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
          });
          const { data: claimsData } = await userClient.auth.getUser();
          userId = claimsData?.user?.id || null;
        }

        // Check for existing pending/processing job for this appointment
        const { data: existingJob } = await supabaseAdmin
          .from("daily_recording_recovery_jobs")
          .select("id, status, started_at, attempts")
          .eq("appointment_id", appointment_id)
          .eq("recovery_type", validRecoveryType)
          .in("status", ["pending", "processing"])
          .maybeSingle();

        if (existingJob) {
          // If stuck in processing for >5 min, reset to pending
          if (existingJob.status === "processing" && existingJob.started_at) {
            const stuckThreshold = Date.now() - 5 * 60 * 1000;
            const startedAt = new Date(existingJob.started_at).getTime();
            if (startedAt < stuckThreshold) {
              console.log("[daily-room] fetch-recordings: resetting stuck job:", existingJob.id);
              if ((existingJob.attempts || 0) >= 3) {
                await supabaseAdmin.from("daily_recording_recovery_jobs").update({
                  status: "failed",
                  error: "Job travou em processing e excedeu tentativas",
                  completed_at: new Date().toISOString(),
                }).eq("id", existingJob.id);
                // Fall through to create a new job
              } else {
                await supabaseAdmin.from("daily_recording_recovery_jobs").update({
                  status: "pending",
                  started_at: null,
                }).eq("id", existingJob.id);
                return new Response(
                  JSON.stringify({ job_id: existingJob.id, status: "pending" }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
            } else {
              // Still within threshold, return current status
              return new Response(
                JSON.stringify({ job_id: existingJob.id, status: existingJob.status }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          } else {
            console.log("[daily-room] fetch-recordings: existing job found:", existingJob.id, existingJob.status);
            return new Response(
              JSON.stringify({ job_id: existingJob.id, status: existingJob.status }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Create new job
        const { data: job, error: jobError } = await supabaseAdmin
          .from("daily_recording_recovery_jobs")
          .insert({
            workspace_id: appt.workspace_id,
            appointment_id: appointment_id,
            requested_by: userId || "00000000-0000-0000-0000-000000000000",
            status: "pending",
            recovery_type: validRecoveryType,
          })
          .select("id")
          .single();

        if (jobError) throw new Error(`Failed to create recovery job: ${jobError.message}`);

        console.log("[daily-room] fetch-recordings: job enqueued:", job.id);

        return new Response(
          JSON.stringify({ job_id: job.id, status: "queued" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================================
      // Poll job status
      // ============================================================
      case "fetch-recordings-status": {
        const { job_id } = body;

        const { data: job, error: jobError } = await supabaseAdmin
          .from("daily_recording_recovery_jobs")
          .select("id, status, result, error, completed_at")
          .eq("id", job_id)
          .single();

        if (jobError || !job) {
          return new Response(
            JSON.stringify({ error: "Job not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify(job),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "debug-recordings": {
        const { appointment_id: dbgApptId } = body;
        const { data: dbgAppt } = await supabaseAdmin
          .from("crm_appointments")
          .select("id, workspace_id, daily_room_name")
          .eq("id", dbgApptId)
          .single();

        if (!dbgAppt?.daily_room_name) {
          return new Response(JSON.stringify({ error: "no_room", appointment_id: dbgApptId }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const out: Record<string, unknown> = {
          appointment_id: dbgAppt.id,
          workspace_id: dbgAppt.workspace_id,
          room_name: dbgAppt.daily_room_name,
        };

        let apiKey: string;
        try {
          apiKey = await getDailyApiKey(supabaseAdmin, dbgAppt.workspace_id);
          out.api_key_present = true;
          out.api_key_len = apiKey.length;
        } catch (keyErr) {
          out.api_key_present = false;
          out.api_key_error = keyErr instanceof Error ? keyErr.message : String(keyErr);
          return new Response(JSON.stringify(out), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const roomInfo = await dailyFetch(apiKey, `/rooms/${dbgAppt.daily_room_name}`);
          out.room_exists = true;
          out.room_id = roomInfo?.id;
        } catch (roomErr) {
          out.room_exists = false;
          out.room_lookup_error = roomErr instanceof Error ? roomErr.message : String(roomErr);
        }

        try {
          const recData = await dailyFetch(apiKey, `/recordings?room_name=${dbgAppt.daily_room_name}`);
          const recs = recData?.data || (Array.isArray(recData) ? recData : []);
          out.recordings_for_room = recs.map((r: Record<string, unknown>) => ({
            id: r.id, room_name: r.room_name, status: r.status, start_ts: r.start_ts,
            duration: r.duration, mtgSessionId: r.mtgSessionId,
          }));
        } catch (e) {
          out.recordings_for_room_error = e instanceof Error ? e.message : String(e);
        }

        try {
          const recentData = await dailyFetch(apiKey, `/recordings?limit=10`);
          const recent = recentData?.data || (Array.isArray(recentData) ? recentData : []);
          out.recent_recordings_in_account = recent.map((r: Record<string, unknown>) => ({
            id: r.id, room_name: r.room_name, start_ts: r.start_ts, status: r.status,
          }));
        } catch (e) {
          out.recent_recordings_error = e instanceof Error ? e.message : String(e);
        }

        try {
          const roomId = out.room_id as string | undefined;
          let trData: { data?: Array<Record<string, unknown>> } = {};
          if (roomId) {
            trData = await dailyFetch(apiKey, `/transcript?roomId=${roomId}`);
          } else {
            const recs = (out.recordings_for_room as Array<Record<string, unknown>>) || [];
            const mtg = recs[0]?.mtgSessionId as string | undefined;
            if (mtg) {
              trData = await dailyFetch(apiKey, `/transcript?mtgSessionId=${mtg}`);
              out.transcript_lookup_via = `mtgSessionId=${mtg}`;
            } else {
              out.transcript_lookup_via = "none (no roomId, no mtgSessionId)";
            }
          }
          const transcripts = trData?.data || (Array.isArray(trData) ? trData : []);
          out.transcripts = transcripts.map((t: Record<string, unknown>) => ({
            id: t.id || t.transcriptId, status: t.status, duration: t.duration,
          }));
        } catch (e) {
          out.transcripts_error = e instanceof Error ? e.message : String(e);
        }

        return new Response(JSON.stringify(out, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "debug-transcripts": {
        const { workspace_id: dbgWsId, room_name: dbgRoom } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, dbgWsId);
        try {
          const roomInfo = await dailyFetch(apiKey, `/rooms/${dbgRoom}`);
          const roomId = roomInfo?.id;
          const result = roomId
            ? await dailyFetch(apiKey, `/transcript?roomId=${roomId}`)
            : { data: [], note: "no roomId found" };
          return new Response(JSON.stringify({ roomId, transcripts: result }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: unknown) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      case "get-access-link": {
        const { appointment_id: alApptId, workspace_id: alWsId } = body;

        // Get the Daily recording ID from crm_appointments.recording_id (set by the worker)
        const { data: alAppt } = await supabaseAdmin
          .from("crm_appointments")
          .select("recording_id")
          .eq("id", alApptId)
          .single();

        if (!alAppt?.recording_id) {
          // Fallback: try to find recording via Daily API using room name
          const { data: alApptFull } = await supabaseAdmin
            .from("crm_appointments")
            .select("daily_room_name")
            .eq("id", alApptId)
            .single();

          if (!alApptFull?.daily_room_name) {
            return new Response(
              JSON.stringify({ error: "no_recording", message: "Nenhuma gravação encontrada" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const apiKeyFb = await getDailyApiKey(supabaseAdmin, alWsId);
          const recListData = await dailyFetch(apiKeyFb, `/recordings?room_name=${alApptFull.daily_room_name}`);
          const recList = recListData?.data || (Array.isArray(recListData) ? recListData : []);

          if (recList.length === 0) {
            return new Response(
              JSON.stringify({ error: "no_recording", message: "Nenhuma gravação encontrada" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const firstRec = recList[0];
          const fbAccessData = await dailyFetch(apiKeyFb, `/recordings/${firstRec.id}/access-link`);
          const fbUrl = fbAccessData?.download_link || fbAccessData?.link;

          if (fbUrl) {
            // Save recording_id for future lookups
            await supabaseAdmin.from("crm_appointments")
              .update({ recording_id: firstRec.id as string })
              .eq("id", alApptId);

            // Update daily_recordings URL
            await supabaseAdmin.from("daily_recordings")
              .update({ recording_url: fbUrl })
              .eq("appointment_id", alApptId);

            return new Response(
              JSON.stringify({ url: fbUrl }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({ error: "no_access_link", message: "Não foi possível obter link de acesso" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const apiKey = await getDailyApiKey(supabaseAdmin, alWsId);

        const accessData = await dailyFetch(apiKey, `/recordings/${alAppt.recording_id}/access-link`);
        const freshUrl = accessData?.download_link || accessData?.link;

        if (!freshUrl) {
          return new Response(
            JSON.stringify({ error: "no_access_link", message: "Não foi possível obter link de acesso" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Update DB with fresh URL
        await supabaseAdmin
          .from("daily_recordings")
          .update({ recording_url: freshUrl })
          .eq("appointment_id", alApptId);

        return new Response(
          JSON.stringify({ url: freshUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "debug-webhooks": {
        const { workspace_id, ensure } = body;
        const apiKey = await getDailyApiKey(supabaseAdmin, workspace_id);
        const existing = await dailyFetch(apiKey, "/webhooks");
        if (ensure) {
          const ensureResult = await ensureDailyWebhook(apiKey, supabaseUrl);
          const after = await dailyFetch(apiKey, "/webhooks");
          return new Response(
            JSON.stringify({ before: existing, ensureResult, after }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ webhooks: existing }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "debug-room-config": {
        // Diagnostico: retorna campos seguros da configuracao da sala
        // para validar se enable_pip_ui (e demais flags) estao ativos.
        // Body: { workspace_id?, appointment_id?, room_name?, patch? }
        // - Se patch=true, aplica buildRoomProperties() antes de retornar.
        const { workspace_id, appointment_id, room_name, patch } = body;

        let resolvedWorkspaceId = workspace_id as string | undefined;
        let resolvedRoomName = room_name as string | undefined;

        if (!resolvedRoomName && appointment_id) {
          const { data: appt } = await supabaseAdmin
            .from("crm_appointments")
            .select("workspace_id, daily_room_name")
            .eq("id", appointment_id)
            .maybeSingle();
          if (appt) {
            resolvedWorkspaceId = resolvedWorkspaceId || (appt as { workspace_id?: string }).workspace_id;
            resolvedRoomName = (appt as { daily_room_name?: string }).daily_room_name || undefined;
          }
        }

        if (!resolvedRoomName) {
          return new Response(
            JSON.stringify({ error: "room_name or appointment_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!resolvedWorkspaceId) {
          return new Response(
            JSON.stringify({ error: "workspace_id required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const apiKey = await getDailyApiKey(supabaseAdmin, resolvedWorkspaceId);

        const readRoom = async () => {
          try {
            const r = await dailyFetch(apiKey, `/rooms/${resolvedRoomName}`);
            const cfg = (r as { config?: Record<string, unknown> })?.config || {};
            return {
              exists: true,
              room_name: resolvedRoomName,
              enable_pip_ui: cfg.enable_pip_ui ?? null,
              enable_chat: cfg.enable_chat ?? null,
              enable_knocking: cfg.enable_knocking ?? null,
              enable_screenshare: cfg.enable_screenshare ?? null,
              enable_recording: cfg.enable_recording ?? null,
              lang: cfg.lang ?? null,
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { exists: false, room_name: resolvedRoomName, error: msg };
          }
        };

        const before = await readRoom();
        let patched: unknown = null;
        if (patch && before.exists) {
          try {
            await dailyFetch(apiKey, `/rooms/${resolvedRoomName}`, {
              method: "POST",
              body: JSON.stringify({ properties: buildRoomProperties() }),
            });
            patched = await readRoom();
          } catch (e) {
            patched = { error: e instanceof Error ? e.message : String(e) };
          }
        }

        return new Response(
          JSON.stringify({ before, patched }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[daily-room] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
