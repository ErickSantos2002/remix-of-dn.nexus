import { supabase } from "@/integrations/supabase/client";

const MIN_FREE_SLOT_MS = 30 * 60 * 1000; // 30 minutos
const ELIGIBLE_TYPES = new Set(["meeting", "demo", "phone_call"]);

export interface FreeSlotResult {
  freed: boolean;
  reason?: "type_not_eligible" | "too_close_to_start" | "no_appointment" | "appointment_not_found";
  googleDeleteFailed?: boolean;
  googleEventExisted?: boolean;
}

export interface FreeSlotInput {
  appointmentId?: string | null;
  scheduledAt?: string | null;
  type?: string | null;
}

/**
 * Quando um meeting/demo/phone_call é marcado como no_show com 30+ min de
 * antecedência do horário inicial, libera o slot:
 *  - Remove o evento do Google Calendar (best-effort)
 *  - Desvincula a atividade (preserva métricas de no-show)
 *  - Exclui o registro de crm_appointments
 *
 * Retorna `{ freed: false, reason }` se a regra não se aplica.
 */
export async function freeSlotForNoShow({
  appointmentId,
  scheduledAt,
  type,
}: FreeSlotInput): Promise<FreeSlotResult> {
  if (!appointmentId) {
    return { freed: false, reason: "no_appointment" };
  }
  if (!type || !ELIGIBLE_TYPES.has(type)) {
    return { freed: false, reason: "type_not_eligible" };
  }
  if (!scheduledAt) {
    return { freed: false, reason: "too_close_to_start" };
  }
  const msUntilStart = new Date(scheduledAt).getTime() - Date.now();
  if (msUntilStart < MIN_FREE_SLOT_MS) {
    return { freed: false, reason: "too_close_to_start" };
  }

  const { data: apt } = await supabase
    .from("crm_appointments")
    .select("id, workspace_id, assigned_to, google_event_id, is_synced_to_google")
    .eq("id", appointmentId)
    .maybeSingle();

  if (!apt) {
    return { freed: false, reason: "appointment_not_found" };
  }

  const a = apt as {
    id: string;
    workspace_id: string;
    assigned_to: string | null;
    google_event_id: string | null;
    is_synced_to_google: boolean | null;
  };

  let googleDeleteFailed = false;
  const googleEventExisted = !!(a.google_event_id && a.is_synced_to_google);
  if (googleEventExisted) {
    try {
      const { data: gData, error: gErr } = await supabase.functions.invoke(
        "google-calendar-delete-event",
        {
          body: {
            workspace_id: a.workspace_id,
            appointment_id: a.id,
            google_event_id: a.google_event_id,
            calendar_owner_id: a.assigned_to ?? undefined,
          },
        }
      );
      if (gErr || (gData && gData.success === false)) {
        googleDeleteFailed = true;
        console.error("[freeSlotForNoShow] Google Calendar delete failed:", gErr || gData?.error);
      }
    } catch (e) {
      googleDeleteFailed = true;
      console.error("[freeSlotForNoShow] Exception calling google-calendar-delete-event:", e);
    }
  }

  // Desvincula a atividade ANTES de deletar o appointment para preservar a
  // atividade (FK CASCADE removeria a atividade junto).
  const { error: unlinkErr } = await supabase
    .from("crm_lead_activities")
    .update({ appointment_id: null })
    .eq("appointment_id", a.id);
  if (unlinkErr) {
    console.error("[freeSlotForNoShow] Failed to unlink activity:", unlinkErr);
    throw unlinkErr;
  }

  const { error: delErr } = await supabase
    .from("crm_appointments")
    .delete()
    .eq("id", a.id);
  if (delErr) {
    console.error("[freeSlotForNoShow] Failed to delete appointment:", delErr);
    throw delErr;
  }

  return { freed: true, googleDeleteFailed, googleEventExisted };
}
