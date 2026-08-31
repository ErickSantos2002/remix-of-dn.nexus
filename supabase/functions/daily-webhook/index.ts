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
};

// Supabase edge runtime (waitUntil for background tasks)
const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const eventType = body.type;

    console.log("[DAILY-WEBHOOK] Received event:", eventType);
    console.log("[DAILY-WEBHOOK] Payload:", JSON.stringify(body).substring(0, 800));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Helper: registra saúde do webhook por workspace (reset do contador
    // de falhas consecutivas usado pelo monitor de auto-recriação).
    const markWebhookHealthy = async (workspaceId: string | null | undefined) => {
      if (!workspaceId) return;
      try {
        await supabaseAdmin
          .from("daily_webhook_health")
          .upsert({
            workspace_id: workspaceId,
            consecutive_failures: 0,
            last_success_at: new Date().toISOString(),
            last_state: "ACTIVE",
          }, { onConflict: "workspace_id" });
      } catch (e) {
        console.warn("[DAILY-WEBHOOK] markWebhookHealthy failed:", e);
      }
    };

    // ============================================================
    // Recording / Transcript events → forward to processing function
    // ============================================================
    if (
      eventType === "recording.ready-to-download" ||
      eventType === "transcript.ready-to-download"
    ) {
      const roomName = body.room_name;
      if (!roomName) {
        console.error("[DAILY-WEBHOOK] No room_name in payload");
        return new Response(JSON.stringify({ error: "Missing room_name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: appointment, error: apptError } = await supabaseAdmin
        .from("crm_appointments")
        .select("id, workspace_id, daily_room_name")
        .eq("daily_room_name", roomName)
        .maybeSingle();

      if (apptError || !appointment) {
        console.error("[DAILY-WEBHOOK] Appointment not found for room:", roomName, apptError);
        return new Response(JSON.stringify({ error: "Appointment not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("[DAILY-WEBHOOK] Found appointment:", appointment.id);

      const processPayload: Record<string, unknown> = {
        appointment_id: appointment.id,
        workspace_id: appointment.workspace_id,
      };

      if (eventType === "recording.ready-to-download") {
        processPayload.recording = {
          download_url: body.download_url,
          recording_id: body.recording_id,
          duration: body.duration,
        };
      } else {
        processPayload.transcription = {
          download_url: body.download_url,
          transcription_id: body.transcription_id,
        };
      }

      console.log("[DAILY-WEBHOOK] Forwarding to process-daily-recording");
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
      console.log("[DAILY-WEBHOOK] Processing result:", JSON.stringify(processResult));

      await markWebhookHealthy(appointment.workspace_id);

      return new Response(JSON.stringify({ ok: true, ...processResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // Participant / meeting lifecycle events
    // Daily payload shape (v1):
    //   { type, room: "<name>", payload: { participant: {...}, joined_at, ... } }
    // Older shape uses room_name / participants at the top level.
    // ============================================================
    if (eventType === "participant.joined" || eventType === "meeting.ended") {
      const roomName: string | undefined =
        body.room || body.room_name || body.payload?.room || body.payload?.room_name;

      if (!roomName) {
        console.warn("[DAILY-WEBHOOK] No room/room_name in payload, ignoring");
        return new Response(JSON.stringify({ ok: true, skipped: "no_room" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: apptRow } = await supabaseAdmin
        .from("crm_appointments")
        .select(
          "id, workspace_id, contact_id, title, daily_room_name, start_time, meeting_started_at, contact_joined_at, meeting_ended_at",
        )
        .eq("daily_room_name", roomName)
        .maybeSingle();

      if (!apptRow) {
        console.warn("[DAILY-WEBHOOK] Appointment not found for room:", roomName);
        return new Response(JSON.stringify({ ok: true, skipped: "no_appointment" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const appointment = { ...apptRow, scheduled_at: apptRow.start_time };


      if (eventType === "participant.joined") {
        const participant = body.payload?.participant ||
          body.participant ||
          body.payload ||
          {};
        const isOwner = participant.owner === true ||
          participant.is_owner === true ||
          participant.permissions?.canAdmin === true;

        // Record participant for transcript name-mapping
        const participantId = participant.id || participant.user_id || participant.session_id;
        const userName = participant.user_name || participant.userName || participant.name || null;
        if (participantId) {
          await recordMeetingParticipant(supabaseAdmin, {
            appointmentId: appointment.id,
            source: "daily",
            participantId: String(participantId),
            userName,
            isOwner: !!isOwner,
          });
        }




        if (isOwner) {
          // Host joined
          if (!appointment.meeting_started_at) {
            await supabaseAdmin
              .from("crm_appointments")
              .update({ meeting_started_at: new Date().toISOString() })
              .eq("id", appointment.id);
            edgeRuntime?.waitUntil?.(
              notifyMeetingStarted(supabaseAdmin, appointment),
            );
            console.log("[DAILY-WEBHOOK] host-joined recorded for appointment", appointment.id);
            // Guest arrived BEFORE the host: the gate already recorded
            // contact_joined_at without side-effects (host guard). Fire them
            // retroactively now so join order does not matter.
            if (appointment.contact_joined_at) {
              edgeRuntime?.waitUntil?.(
                handleGuestJoinedMeeting(supabaseAdmin, appointment),
              );
              console.log(
                "[DAILY-WEBHOOK] retroactive guest side-effects for appointment",
                appointment.id,
              );
            }
          } else {
            console.log("[DAILY-WEBHOOK] host-joined already recorded, skipping");
          }
        } else {
          // Guest joined — DEFENSIVE: ignore if host hasn't started the meeting yet.
          // Prevents misclassified host (no owner token) from triggering MQL→SQL move.
          if (!appointment.meeting_started_at) {
            console.log(
              "[DAILY-WEBHOOK] guest-joined ignored: host has not started the meeting yet (appointment=",
              appointment.id,
              ")",
            );
          } else if (!appointment.contact_joined_at) {
            await supabaseAdmin
              .from("crm_appointments")
              .update({
                contact_joined: true,
                contact_joined_at: new Date().toISOString(),
              })
              .eq("id", appointment.id);
            edgeRuntime?.waitUntil?.(
              handleGuestJoinedMeeting(supabaseAdmin, appointment),
            );
            console.log("[DAILY-WEBHOOK] guest-joined recorded for appointment", appointment.id);
          } else {
            console.log("[DAILY-WEBHOOK] guest-joined already recorded, skipping");
          }
        }
      } else if (eventType === "meeting.ended") {
        // Log completo do payload para diagnosticar fechamentos inesperados
        const closePayload = {
          room: roomName,
          appointment_id: appointment.id,
          workspace_id: appointment.workspace_id,
          duration: body.payload?.duration ?? body.duration,
          ejection_reason: body.payload?.ejection_reason ?? body.ejection_reason,
          error: body.payload?.error ?? body.error,
          participants: body.payload?.participants ?? body.participants,
        };
        if (closePayload.ejection_reason || closePayload.error) {
          console.error("[daily-webhook][meeting-ended] unexpected close:", closePayload);
        } else {
          console.log("[daily-webhook][meeting-ended] normal close:", closePayload);
        }

        // REGRA: o encerramento da sala (meeting_ended_at) só deve ser gravado
        // quando a room realmente expirou no Daily. Eventos de "meeting.ended"
        // disparados porque o último participante saiu não devem bloquear
        // a reentrada de convidados/host enquanto a room ainda estiver ativa.
        let roomExpired = false;
        try {
          const dailyApiKey = Deno.env.get("DAILY_API_KEY");
          if (dailyApiKey) {
            const roomResp = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
              headers: { Authorization: `Bearer ${dailyApiKey}` },
            });
            if (roomResp.status === 404) {
              // Room foi removida → considerar expirada
              roomExpired = true;
              console.log("[daily-webhook][meeting-ended] room not found (deleted/expired)");
            } else if (roomResp.ok) {
              const roomJson = await roomResp.json();
              const exp = roomJson?.config?.exp;
              if (typeof exp === "number" && exp * 1000 <= Date.now()) {
                roomExpired = true;
              }
              console.log("[daily-webhook][meeting-ended] room exp check:", { exp, roomExpired });
            } else {
              console.warn("[daily-webhook][meeting-ended] failed to fetch room:", roomResp.status);
            }
          } else {
            console.warn("[daily-webhook][meeting-ended] DAILY_API_KEY missing; cannot verify expiration");
          }
        } catch (e) {
          console.warn("[daily-webhook][meeting-ended] room exp check error:", e);
        }

        let durationSeconds: number | null = null;
        if (appointment.meeting_started_at) {
          const started = new Date(appointment.meeting_started_at).getTime();
          durationSeconds = Math.round((Date.now() - started) / 1000);
        }

        if (!roomExpired) {
          console.log(
            "[DAILY-WEBHOOK] meeting.ended ignorado para appointment",
            appointment.id,
            "— room ainda ativa (não expirou). Reentrada permanece permitida.",
          );
        } else if (!appointment.meeting_ended_at) {
          const updates: Record<string, unknown> = {
            meeting_ended_at: new Date().toISOString(),
          };
          if (durationSeconds !== null) {
            updates.actual_duration_seconds = durationSeconds;
          }
          await supabaseAdmin
            .from("crm_appointments")
            .update(updates)
            .eq("id", appointment.id);
          edgeRuntime?.waitUntil?.(
            notifyMeetingEnded(supabaseAdmin, appointment, durationSeconds),
          );
          console.log("[DAILY-WEBHOOK] meeting-ended recorded (room expired) for appointment", appointment.id);
        } else {
          console.log("[DAILY-WEBHOOK] meeting-ended already recorded, skipping");
        }

      }

      await markWebhookHealthy(appointment.workspace_id);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[DAILY-WEBHOOK] Ignoring event:", eventType);
    return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DAILY-WEBHOOK] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
