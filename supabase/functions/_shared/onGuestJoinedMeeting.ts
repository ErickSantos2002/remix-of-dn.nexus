// Shared helper: side-effects when a guest joins a Daily meeting.
// 1) Notify dn.marketing with `guest_joined_meeting`
// 2) Apply the workspace's `guest_joined_meeting` auto-move rules
//    (crm_automove_rules, configurable at /crm/settings/automove).
//    No active rule => no move.
//
// Idempotent: callers MUST only invoke this on the NULL->value transition of
// crm_appointments.contact_joined_at (i.e. the first time the guest joins).

import { notifyDnMarketing, resolveCompanyId } from "./dnmarketing.ts";

type SupabaseAdmin = {
  // Shim do client sem generics: o retorno precisa ser `any` para permitir o
  // encadeamento do query builder (.select().eq()...) vindo de callers distintos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export interface AppointmentForGuestJoined {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  title?: string | null;
  daily_room_name?: string | null;
  scheduled_at?: string | null;
}

const SYSTEM_MOVED_BY = "auto-guest-joined-meeting";

interface GuestJoinedAutomoveRule {
  id: string;
  name: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
}

async function applyGuestJoinedAutomoveRules(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
): Promise<void> {
  if (!appointment.contact_id) {
    console.log("[daily-stage-move] appointment has no contact_id, skipping");
    return;
  }

  // 1) Find active open lead for this contact in this workspace
  const { data: lead, error: leadError } = await supabaseAdmin
    .from("crm_leads")
    .select("id, stage_id")
    .eq("contact_id", appointment.contact_id)
    .eq("workspace_id", appointment.workspace_id)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle();

  if (leadError) {
    console.warn("[daily-stage-move] lead lookup failed:", leadError);
    return;
  }
  if (!lead) {
    console.log("[daily-stage-move] no active lead found for contact", appointment.contact_id);
    return;
  }

  // 2) Fetch the workspace's event rules (configurable at /crm/settings/automove).
  //    No active rule => nothing moves.
  const { data: rules, error: rulesError } = await supabaseAdmin
    .from("crm_automove_rules")
    .select("id, name, from_stage_id, to_stage_id")
    .eq("workspace_id", appointment.workspace_id)
    .eq("condition_type", "guest_joined_meeting")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (rulesError) {
    console.warn("[daily-stage-move] rules lookup failed:", rulesError);
    return;
  }

  // 3) First applicable rule: from_stage NULL means "any stage".
  const rule = ((rules || []) as GuestJoinedAutomoveRule[]).find(
    (r) => r.to_stage_id && (!r.from_stage_id || r.from_stage_id === lead.stage_id),
  );
  if (!rule) {
    console.log(
      "[daily-stage-move] no active guest_joined_meeting rule matches lead stage",
      lead.stage_id || "<none>",
      "in workspace",
      appointment.workspace_id,
      "- skipping",
    );
    return;
  }

  // 4) Idempotency: already on the target stage
  if (lead.stage_id === rule.to_stage_id) {
    console.log("[daily-stage-move] lead already on target stage, skipping");
    return;
  }

  const fromStageId = lead.stage_id;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("crm_leads")
    .update({ stage_id: rule.to_stage_id, moved_at: nowIso, updated_at: nowIso })
    .eq("id", lead.id);

  if (updateError) {
    console.error("[daily-stage-move] failed to update lead stage:", updateError);
    return;
  }

  // Automove log (shows up in the History tab of /crm/settings/automove)
  const { error: automoveLogError } = await supabaseAdmin
    .from("crm_automove_log")
    .insert({
      lead_id: lead.id,
      workspace_id: appointment.workspace_id,
      rule_id: rule.id,
      from_stage_id: fromStageId,
      to_stage_id: rule.to_stage_id,
      reason: `Regra "${rule.name}": convidado entrou na reunião`,
    });

  if (automoveLogError) {
    console.warn("[daily-stage-move] automove log insert failed (non-fatal):", automoveLogError);
  }

  const { error: historyError } = await supabaseAdmin
    .from("crm_lead_history")
    .insert({
      lead_id: lead.id,
      from_stage_id: fromStageId,
      to_stage_id: rule.to_stage_id,
      moved_by: SYSTEM_MOVED_BY,
      action: "stage_entry",
      reason: "Convidado entrou na reunião — movido automaticamente para SQL",
    });

  if (historyError) {
    console.warn("[daily-stage-move] history insert failed (non-fatal):", historyError);
  }

  console.log(
    "[daily-stage-move] lead",
    lead.id,
    "moved to stage",
    rule.to_stage_id,
    "by rule",
    rule.id,
  );
}

async function notifyGuestJoinedDn(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
): Promise<void> {
  if (!appointment.contact_id) {
    console.log("[daily-dn] appointment has no contact_id, skipping dn.marketing notify");
    return;
  }
  const { data: contact, error } = await supabaseAdmin
    .from("crm_contacts")
    .select("dnia_id")
    .eq("id", appointment.contact_id)
    .maybeSingle();

  if (error) {
    console.warn("[daily-dn] contact lookup error:", error);
    return;
  }
  if (!contact?.dnia_id) {
    console.warn(
      "[daily-dn] contact has no dnia_id, skipping dn.marketing notify (contact_id=",
      appointment.contact_id,
      ")",
    );
    return;
  }

  const companyId = await resolveCompanyId(supabaseAdmin, { workspaceId: appointment.workspace_id });
  await notifyDnMarketing(supabaseAdmin, companyId, {
    dnia_id: contact.dnia_id,
    event_type: "guest_joined_meeting",
    title: `Convidado entrou na reunião: ${appointment.title || "(sem título)"}`,
    metadata: {
      appointment_id: appointment.id,
      room_name: appointment.daily_room_name,
      scheduled_at: appointment.scheduled_at,
    },
  });
}

async function completeAppointmentActivity(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("crm_lead_activities")
    .update({ status: "completed", completed_at: nowIso, updated_at: nowIso })
    .eq("appointment_id", appointment.id)
    .eq("status", "pending");
  if (error) {
    console.warn("[daily-activity-complete] failed to mark activity as completed:", error);
    return;
  }
  console.log("[daily-activity-complete] activities for appointment", appointment.id, "marked as completed");
}

export async function handleGuestJoinedMeeting(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
): Promise<void> {
  console.log(
    "[daily-guest-joined] handling appointment",
    appointment.id,
    "contact",
    appointment.contact_id,
  );
  // Run side-effects independently so one failure doesn't block the others.
  await Promise.allSettled([
    notifyGuestJoinedDn(supabaseAdmin, appointment),
    applyGuestJoinedAutomoveRules(supabaseAdmin, appointment),
    completeAppointmentActivity(supabaseAdmin, appointment),
  ]);
}


export async function notifyMeetingStarted(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
): Promise<void> {
  if (!appointment.contact_id) return;
  const { data: contact } = await supabaseAdmin
    .from("crm_contacts")
    .select("dnia_id")
    .eq("id", appointment.contact_id)
    .maybeSingle();
  if (!contact?.dnia_id) return;
  const companyId = await resolveCompanyId(supabaseAdmin, { workspaceId: appointment.workspace_id });
  await notifyDnMarketing(supabaseAdmin, companyId, {
    dnia_id: contact.dnia_id,
    event_type: "meeting_started",
    title: `Reunião iniciada: ${appointment.title || "(sem título)"}`,
    metadata: {
      appointment_id: appointment.id,
      room_name: appointment.daily_room_name,
      scheduled_at: appointment.scheduled_at,
    },
  });
}

export async function notifyMeetingEnded(
  supabaseAdmin: SupabaseAdmin,
  appointment: AppointmentForGuestJoined,
  durationSeconds?: number | null,
): Promise<void> {
  if (!appointment.contact_id) return;
  const { data: contact } = await supabaseAdmin
    .from("crm_contacts")
    .select("dnia_id")
    .eq("id", appointment.contact_id)
    .maybeSingle();
  if (!contact?.dnia_id) return;
  const companyId = await resolveCompanyId(supabaseAdmin, { workspaceId: appointment.workspace_id });
  await notifyDnMarketing(supabaseAdmin, companyId, {
    dnia_id: contact.dnia_id,
    event_type: "meeting_ended",
    title: `Reunião encerrada: ${appointment.title || "(sem título)"}`,
    metadata: {
      appointment_id: appointment.id,
      room_name: appointment.daily_room_name,
      scheduled_at: appointment.scheduled_at,
      duration_seconds: durationSeconds ?? null,
    },
  });
}
