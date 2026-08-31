import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGoogleCredentials, GoogleOAuthError } from "../_shared/googleCredentials.ts";
import { dnFetch } from "../_shared/dnmarketing.ts";
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { getSchedulingLoad } from "../_shared/routing/load.ts";
import { selectAssignee } from "../_shared/routing/select.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEBUG_SCHEDULE_WIDGET = Deno.env.get("DEBUG_SCHEDULE_WIDGET") === "true";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = ReturnType<typeof createClient<any, "public", any>>;
type BusySlot = { start: Date; end: Date };
type CalendarBusyResponse = { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
type GoogleCalendarIntegration = { id: string; google_access_token: string; google_refresh_token: string; google_calendar_id?: string | null; token_expires_at: string };
type AgentCalendarSettings = { work_start_time?: string | null; work_end_time?: string | null; work_days?: string[] | null; min_interval_between_appointments?: number | null; timezone?: string | null };
type ScheduleSettings = { work_start_time: string; work_end_time: string; work_days: string[]; min_interval: number; timezone: string };
type AppointmentWindow = { start_time: string; end_time: string };
type WorkspaceRow = { id: string; workspace_id?: string };
type ContactCandidate = { id: string; name?: string | null; email?: string | null; phone?: string | null; lead_id?: string | null; workspace_id: string };

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Carrega origens cadastradas (ativas) da empresa para validar source vindo do widget.
async function loadValidSources(supabase: SupabaseClientLike, companyId: string | null | undefined): Promise<Set<string>> {
  const valid = new Set<string>();
  if (!companyId) return valid;
  try {
    const { data: sources } = await supabase
      .from("crm_contact_sources")
      .select("name")
      .eq("company_id", companyId)
      .eq("is_active", true);
    for (const s of (sources as Array<{ name: string }> | null) ?? []) {
      if (s?.name) valid.add(s.name.trim().toLowerCase());
    }
  } catch (err) {
    console.error("[schedule-widget] loadValidSources error:", err);
  }
  return valid;
}

// Calcula Origem do contato a partir dos params da página:
// 1) source explícito (validado contra origens cadastradas da empresa) → usa literal
// 2) qualquer utm_* presente → "Tráfego Pago"
// 3) caso contrário → "Orgânica"
function computeWidgetSource(
  utm: Record<string, string | undefined> | null | undefined,
  validSources?: Set<string>,
): string {
  const src = utm?.source?.trim();
  if (src && validSources && validSources.has(src.toLowerCase())) return src;
  const hasUtm = !!(utm?.utm_source || utm?.utm_medium || utm?.utm_campaign || utm?.utm_term || utm?.utm_content);
  return hasUtm ? "Tráfego Pago" : "Orgânica";
}

// Busca uma reunião futura ainda em aberto (status='scheduled') para o lead/contato
// e monta a mensagem amigável exibida no widget quando um lead tenta reagendar.
async function findExistingAppointment(
  supabase: SupabaseClientLike,
  workspaceId: string,
  leadId: string | null | undefined,
  contactId: string | null | undefined,
): Promise<{ appointment: Record<string, unknown>; message: string } | null> {
  if (!workspaceId || (!leadId && !contactId)) return null;
  const nowIso = new Date().toISOString();
  const filterParts: string[] = [];
  if (leadId) filterParts.push(`lead_id.eq.${leadId}`);
  if (contactId) filterParts.push(`contact_id.eq.${contactId}`);
  const orFilter = filterParts.join(",");
  const { data: apts, error } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, duration_minutes, meeting_link, daily_room_url, assigned_to, contact_id, lead_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "scheduled")
    .gte("start_time", nowIso)
    .or(orFilter)
    .order("start_time", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[schedule-widget] findExistingAppointment error:", error);
    return null;
  }
  const apt = (apts as Array<Record<string, unknown>> | null)?.[0];
  if (!apt) return null;

  const meetingLink = (apt.meeting_link as string | null) || (apt.daily_room_url as string | null) || null;

  // Nome do consultor
  let assigneeName: string | null = null;
  if (apt.assigned_to) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", apt.assigned_to as string)
      .maybeSingle();
    assigneeName = (profile as { full_name?: string } | null)?.full_name?.trim() || null;
  }

  // Nome do lead (para saudação)
  let leadName: string | null = null;
  if (apt.contact_id) {
    const { data: c } = await supabase
      .from("crm_contacts")
      .select("name")
      .eq("id", apt.contact_id as string)
      .maybeSingle();
    leadName = ((c as { name?: string } | null)?.name || "").split(" ")[0] || null;
  }

  // Formatação de data/hora em America/Sao_Paulo
  const startDate = new Date(apt.start_time as string);
  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo",
  }).format(startDate);
  const timeFmt = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(startDate);

  const greeting = leadName ? `Oi, ${leadName}! ` : "Oi! ";
  const consultantPhrase = assigneeName ? `com ${assigneeName} ` : "com nosso time ";
  const linkPhrase = meetingLink
    ? ` Se precisar acessar a sala, é só usar este link: ${meetingLink}.`
    : "";
  const message =
    `${greeting}Vi aqui que você já tem uma reunião marcada ${consultantPhrase}` +
    `para o dia ${dateFmt} às ${timeFmt}.${linkPhrase} ` +
    `Se precisar remarcar ou cancelar, é só nos avisar por lá. Até já!`;

  return {
    appointment: {
      id: apt.id,
      title: apt.title,
      start_time: apt.start_time,
      duration_minutes: apt.duration_minutes,
      meeting_link: meetingLink,
      assignee_name: assigneeName,
    },
    message,
  };
}


// Enriquecimento não-destrutivo dos campos de A/B testing vindos da URL do widget
// (ab_vid/ab_test/ab_var injetados pelo dn.marketing). Só grava valores atualmente
// nulos/vazios — nunca sobrescreve um ab_* já persistido. Idempotente.
async function applyAbEnrichment(
  supabase: SupabaseClientLike,
  contactId: string | null | undefined,
  ab: { ab_vid?: unknown; ab_test?: unknown; ab_var?: unknown } | null | undefined,
): Promise<void> {
  try {
    if (!contactId || !ab) return;
    const incoming: Record<string, string> = {};
    for (const k of ["ab_vid", "ab_test", "ab_var"] as const) {
      const v = ab[k];
      if (typeof v === "string" && v.trim() !== "") incoming[k] = v.trim();
    }
    if (Object.keys(incoming).length === 0) return;

    const { data: current } = await supabase
      .from("crm_contacts")
      .select("ab_vid, ab_test, ab_var")
      .eq("id", contactId)
      .maybeSingle();
    const cur = (current as Record<string, string | null> | null) ?? {};
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!cur[k] && v) updates[k] = v;
    }
    if (Object.keys(updates).length === 0) return;
    (updates as Record<string, unknown>).updated_at = new Date().toISOString();
    await supabase.from("crm_contacts").update(updates).eq("id", contactId);
    console.log(`[schedule-widget] ab_* enrichment contact=${contactId} fields=${Object.keys(updates).filter((k) => k !== "updated_at").join(",")}`);
  } catch (err) {
    console.error("[schedule-widget] applyAbEnrichment failed:", err);
  }
}


function isWidgetDefaultSource(current: string | null | undefined): boolean {
  if (!current) return true;
  const c = current.trim().toLowerCase();
  return c === "" || c === "agendamento" || c === "chat" || c === "widget" || c.startsWith("widget:");
}


async function validateEmailDeliverability(email: string): Promise<{ ok: boolean; reason?: string }> {
  const trimmed = (email || "").trim();
  if (!EMAIL_REGEX.test(trimmed)) return { ok: false, reason: "Formato de email inválido" };
  const domain = trimmed.split("@")[1]?.toLowerCase();
  if (!domain || domain.length < 3 || !domain.includes(".")) return { ok: false, reason: "Domínio de email inválido" };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mx = await (Deno as any).resolveDns(domain, "MX").catch(() => null);
    if (mx && Array.isArray(mx) && mx.length > 0) return { ok: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await (Deno as any).resolveDns(domain, "A").catch(() => null);
    if (a && Array.isArray(a) && a.length > 0) return { ok: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aaaa = await (Deno as any).resolveDns(domain, "AAAA").catch(() => null);
    if (aaaa && Array.isArray(aaaa) && aaaa.length > 0) return { ok: true };
    return { ok: false, reason: "Este domínio de email não recebe mensagens. Verifique o endereço informado." };
  } catch (err) {
    console.error("[schedule-widget] DNS lookup failed:", err);
    // Em caso de falha de DNS na infra, não bloqueia o usuário
    return { ok: true };
  }
}

/**
 * Reabre um card de lead se estiver perdido (status='lost') ou soft-deletado
 * (deleted_at IS NOT NULL). Também reativa o crm_contacts associado.
 * Idempotente: não faz nada se o lead já estiver aberto.
 */
async function reopenLeadIfClosed(
  supabase: SupabaseClientLike,
  leadId: string,
  reason: string,
): Promise<void> {
  try {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("id, status, deleted_at, stage_id, contact_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return;
    const isLost = lead.status === "lost";
    const isDeleted = !!lead.deleted_at;
    if (!isLost && !isDeleted) return;

    await supabase
      .from("crm_leads")
      .update({
        status: "open",
        closed_at: null,
        loss_reason_id: null,
        deleted_at: null,
        deleted_by: null,
        moved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    await supabase.from("crm_lead_history").insert({
      lead_id: leadId,
      from_stage_id: lead.stage_id,
      to_stage_id: lead.stage_id,
      moved_by: "auto-schedule-widget",
      action: "reopened",
      reason,
    });

    if (lead.contact_id) {
      await supabase
        .from("crm_contacts")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", lead.contact_id)
        .eq("is_active", false);
    }

    console.log("[schedule-widget] Lead reaberto:", leadId, "lost=", isLost, "deleted=", isDeleted);
  } catch (err) {
    console.error("[schedule-widget] reopenLeadIfClosed failed:", err);
  }
}

/**
 * Move o card para `targetStageId` somente se a etapa de destino estiver À FRENTE
 * da etapa atual no pipeline.
 *
 * O widget é público e o próprio contato pode reabrir o link a qualquer momento.
 * Sem esta guarda, refazer a qualificação (etapa 2) ou reagendar puxa de volta um
 * card que já avançou para MQL/SQL/Venda realizada — e ainda o reinscreve na régua
 * da etapa anterior.
 *
 * A ordem visível no pipeline vem de `order` (ver CRMPipeline.tsx); `position` é a
 * coluna espelho mantida pela API e serve de fallback. Se nenhuma das duas permitir
 * ordenar as etapas, o move acontece (comportamento antigo) com um aviso no log —
 * travar a qualificação por dado incompleto seria pior que o rebaixamento.
 *
 * Retorna true se o card foi movido.
 */
async function moveLeadForwardOnly(
  supabase: SupabaseClientLike,
  leadId: string,
  targetStageId: string,
  reason: string,
): Promise<boolean> {
  const { data: currentLead } = await supabase
    .from("crm_leads")
    .select("stage_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!currentLead) return false;

  const currentStageId = (currentLead.stage_id as string | null) ?? null;
  if (currentStageId === targetStageId) return false;

  if (currentStageId) {
    const { data: stages } = await supabase
      .from("crm_pipeline_stages")
      .select("id, name, order, position")
      .in("id", [currentStageId, targetStageId]);

    const rows = (stages as Array<{ id: string; order?: number | null; position?: number | null }> | null) ?? [];
    const rankOf = (stageId: string): number | null => {
      const row = rows.find((r) => r.id === stageId);
      if (!row) return null;
      const raw = row.order ?? row.position;
      return typeof raw === "number" ? raw : null;
    };

    const currentRank = rankOf(currentStageId);
    const targetRank = rankOf(targetStageId);

    if (currentRank === null || targetRank === null) {
      console.warn("[schedule-widget] ordem das etapas indeterminada, movendo sem guarda:", { leadId, currentStageId, targetStageId });
    } else if (targetRank <= currentRank) {
      console.log("[schedule-widget] move ignorado, card já está em etapa igual ou mais avançada:", { leadId, currentStageId, targetStageId, currentRank, targetRank });
      return false;
    }
  }

  await supabase
    .from("crm_leads")
    .update({ stage_id: targetStageId, moved_at: new Date().toISOString() })
    .eq("id", leadId);

  await supabase.from("crm_lead_history").insert({
    lead_id: leadId,
    from_stage_id: currentStageId,
    to_stage_id: targetStageId,
    moved_by: "auto-schedule-widget",
    action: "stage_change",
    reason,
  });

  return true;
}




function getTimezoneOffsetHours(timezone: string): number {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / (1000 * 60 * 60);
}

function localTimeToUTC(date: Date, hour: number, minute: number, timezone: string): Date {
  const offset = getTimezoneOffsetHours(timezone);
  const utcDate = new Date(date);
  utcDate.setUTCHours(hour + offset, minute, 0, 0);
  return utcDate;
}

function formatTimeInTimezone(date: Date, timezone: string): string {
  return date.toLocaleString('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateInTimezone(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

async function refreshGoogleAccessToken(refreshToken: string, workspaceId: string): Promise<{ access_token: string; expires_at: string } | null> {
  try {
    const { clientId, clientSecret } = await getGoogleCredentials(workspaceId);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) return null;
    const tokens = await response.json();
    return { access_token: tokens.access_token, expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString() };
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      console.warn(`[schedule-widget] Google OAuth indisponivel: ${err.code} - ${err.userMessage}`);
    } else {
      console.error('[schedule-widget] Error refreshing token:', err);
    }
    return null;
  }
}

async function getGoogleCalendarBusySlots(supabase: SupabaseClientLike, workspaceId: string, userId: string, startDate: Date, endDate: Date, timezone: string): Promise<BusySlot[]> {
  const { data: integrationData } = await supabase
    .from('crm_google_calendar_integration')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_enabled', true)
    .maybeSingle();
  const integration = integrationData as GoogleCalendarIntegration | null;
  if (!integration) return [];

  let accessToken = integration.google_access_token;
  if (new Date(integration.token_expires_at) <= new Date()) {
    const refreshed = await refreshGoogleAccessToken(integration.google_refresh_token, workspaceId);
    if (!refreshed) return [];
    await supabase.from('crm_google_calendar_integration').update({ google_access_token: refreshed.access_token, token_expires_at: refreshed.expires_at }).eq('id', integration.id);
    accessToken = refreshed.access_token;
  }

  const calendarId = integration.google_calendar_id || 'primary';
  try {
    const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone: timezone,
        items: [{ id: calendarId }],
      }),
    });
    if (!fbRes.ok) {
      console.error('[schedule-widget] freeBusy error:', await fbRes.text());
      return [];
    }
    const data = await fbRes.json() as CalendarBusyResponse;
    const busy: BusySlot[] = Object.values(data.calendars ?? {})
      .flatMap((c) => c.busy ?? [])
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    console.log(`[schedule-widget] freeBusy user=${userId} calendar=${calendarId} busy_count=${busy.length}`);
    return busy;
  } catch (err) {
    console.error('[schedule-widget] freeBusy exception:', err);
    return [];
  }
}

const DEFAULT_SLOT_STEP_MINUTES = 15;

async function getWorkspaceSlotStepMinutes(supabase: SupabaseClientLike, workspaceId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("workspace_meeting_settings")
      .select("slot_step_minutes")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const step = (data as { slot_step_minutes?: number } | null)?.slot_step_minutes;
    return step && step > 0 ? step : DEFAULT_SLOT_STEP_MINUTES;
  } catch (_e) {
    return DEFAULT_SLOT_STEP_MINUTES;
  }
}

function roundUpToStepInTz(date: Date, timezone: string, stepMinutes: number = DEFAULT_SLOT_STEP_MINUTES): Date {
  const step = stepMinutes > 0 ? stepMinutes : DEFAULT_SLOT_STEP_MINUTES;
  const offset = getTimezoneOffsetHours(timezone);
  // Convert to local time
  const localMs = date.getTime() - offset * 60 * 60 * 1000;
  const local = new Date(localMs);
  const minutes = local.getUTCMinutes();
  const remainder = minutes % step;
  if (remainder === 0 && local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0) {
    return date;
  }
  const add = step - remainder;
  local.setUTCMinutes(minutes + add, 0, 0);
  return new Date(local.getTime() + offset * 60 * 60 * 1000);
}

function normalizePhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, '');
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return digits;
}

// DDDs validos no Brasil
const VALID_DDDS = new Set([
  11,12,13,14,15,16,17,18,19,
  21,22,24,27,28,
  31,32,33,34,35,37,38,
  41,42,43,44,45,46,47,48,49,
  51,53,54,55,
  61,62,63,64,65,66,67,68,69,
  71,73,74,75,77,79,
  81,82,83,84,85,86,87,88,89,
  91,92,93,94,95,96,97,98,99,
]);

function isSequentialDigits(s: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/**
 * Valida um celular brasileiro real (11 digitos apos remover o DDI 55).
 * Bloqueia DDD invalido, ausencia do nono digito, digitos repetidos,
 * sequencias e padroes espelhados (ex.: 91234-1234).
 */
function isRealBrazilianMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 11) return false;

  const ddd = parseInt(digits.slice(0, 2), 10);
  if (!VALID_DDDS.has(ddd)) return false;

  const number = digits.slice(2); // 9 digitos
  if (number[0] !== "9") return false;

  // todos os digitos iguais (999999999) ou os 8 finais iguais (911111111)
  if (/^(\d)\1{8}$/.test(number)) return false;
  if (/^9(\d)\1{7}$/.test(number)) return false;

  // sequencias crescentes/decrescentes (912345678 / 987654321)
  if (isSequentialDigits(number.slice(1))) return false;

  // metades identicas: 9 XXXX-XXXX com XXXX == XXXX
  if (number.slice(1, 5) === number.slice(5, 9)) return false;

  return true;
}

interface MemberSlot {
  date: string;
  time: string;
  datetime: string;
  member_id: string;
}

async function getMemberSlots(supabase: SupabaseClientLike, workspaceId: string, memberId: string, durationMinutes: number, month: string, slotStepMinutes: number = DEFAULT_SLOT_STEP_MINUTES): Promise<MemberSlot[]> {
  const { data: agentCalendarData } = await supabase.from("crm_agent_calendars").select("*").eq("workspace_id", workspaceId).eq("agent_id", memberId).maybeSingle();
  const agentCalendar = agentCalendarData as AgentCalendarSettings | null;
  
  const settings: ScheduleSettings = {
    work_start_time: agentCalendar?.work_start_time || "09:00",
    work_end_time: agentCalendar?.work_end_time || "18:00",
    work_days: agentCalendar?.work_days || ["MON", "TUE", "WED", "THU", "FRI"],
    min_interval: agentCalendar?.min_interval_between_appointments || 0,
    timezone: agentCalendar?.timezone || "America/Sao_Paulo"
  };

  const [year, mon] = month.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
  const now = new Date();
  const startDate = now > monthStart ? now : monthStart;
  const endDate = monthEnd;

  if (startDate >= endDate) return [];

  const { data: existingAppointments } = await supabase
    .from("crm_appointments").select("start_time, end_time")
    .eq("workspace_id", workspaceId).eq("assigned_to", memberId)
    .gte("start_time", startDate.toISOString()).lte("start_time", endDate.toISOString())
    .in("status", ["scheduled", "confirmed"]);

  // Load workspace holidays in the range to block entire days
  const { data: holidayRows } = await supabase
    .from("crm_holidays").select("date")
    .eq("workspace_id", workspaceId);
  const holidaySet = new Set(((holidayRows || []) as Array<{ date: string }>).map((h) => h.date));

  const localBusy = ((existingAppointments || []) as AppointmentWindow[]).map((a) => ({ start: new Date(a.start_time), end: new Date(a.end_time) }));
  const googleBusy = await getGoogleCalendarBusySlots(supabase, workspaceId, memberId, startDate, endDate, settings.timezone);
  const allBusy = [...localBusy, ...googleBusy];

  const dayMap: Record<string, number> = { "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6 };
  const workDayNums = settings.work_days.map((d: string) => dayMap[d]);
  const [startHour, startMin] = settings.work_start_time.split(":").map(Number);
  const [endHour, endMin] = settings.work_end_time.split(":").map(Number);
  const tz = settings.timezone;
  const slots: MemberSlot[] = [];

  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const checkDate = new Date(startDate);
    checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);
    checkDate.setUTCHours(12, 0, 0, 0);

    const weekday = checkDate.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }).toUpperCase().slice(0, 3);
    const dayNum = dayMap[weekday] ?? -1;
    if (!workDayNums.includes(dayNum)) continue;

    const dateStr = formatDateInTimezone(checkDate, tz);
    if (holidaySet.has(dateStr)) continue;
    const dayStart = localTimeToUTC(checkDate, startHour, startMin, tz);
    const dayEnd = localTimeToUTC(checkDate, endHour, endMin, tz);
    let current = new Date(dayStart);

    while (current < dayEnd) {
      const slotEnd = new Date(current.getTime() + durationMinutes * 60_000);
      if (slotEnd > dayEnd) break;

      const minTime = new Date(Date.now() + 10 * 60_000);
      if (current <= minTime) {
        let next = roundUpToStepInTz(minTime, tz, slotStepMinutes);
        if (next <= current) next = new Date(current.getTime() + slotStepMinutes * 60_000);
        current = next;
        continue;
      }

      const conflict = allBusy.find((b) => current < b.end && slotEnd > b.start);
      if (DEBUG_SCHEDULE_WIDGET) {
        console.log("[schedule-widget] candidate", {
          date: dateStr,
          start: current.toISOString(),
          end: slotEnd.toISOString(),
          hasConflict: !!conflict,
        });
      }

      if (!conflict) {
        slots.push({ date: dateStr, time: formatTimeInTimezone(current, tz), datetime: current.toISOString(), member_id: memberId });
        current = new Date(current.getTime() + slotStepMinutes * 60_000);
      } else {
        let next = new Date(conflict.end.getTime() + settings.min_interval * 60_000);
        next = roundUpToStepInTz(next, tz, slotStepMinutes);
        if (next <= current) {
          next = new Date(current.getTime() + slotStepMinutes * 60_000);
        }
        current = next;
      }
    }
  }

  return slots;
}

async function getMemberSlotForTime(supabase: SupabaseClientLike, workspaceId: string, memberId: string, durationMinutes: number, date: string, time: string): Promise<MemberSlot | null> {
  const { data: agentCalendarData } = await supabase.from("crm_agent_calendars").select("*").eq("workspace_id", workspaceId).eq("agent_id", memberId).maybeSingle();
  const agentCalendar = agentCalendarData as AgentCalendarSettings | null;
  const settings: ScheduleSettings = {
    work_start_time: agentCalendar?.work_start_time || "09:00",
    work_end_time: agentCalendar?.work_end_time || "18:00",
    work_days: agentCalendar?.work_days || ["MON", "TUE", "WED", "THU", "FRI"],
    min_interval: agentCalendar?.min_interval_between_appointments || 0,
    timezone: agentCalendar?.timezone || "America/Sao_Paulo"
  };

  const [year, month, day] = date.split("-").map(Number);
  const checkDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayMap: Record<string, number> = { "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6 };
  const weekday = checkDate.toLocaleDateString('en-US', { timeZone: settings.timezone, weekday: 'short' }).toUpperCase().slice(0, 3);
  if (!settings.work_days.map((d: string) => dayMap[d]).includes(dayMap[weekday] ?? -1)) return null;

  const [hour, minute] = time.split(":").map(Number);
  const [startHour, startMin] = settings.work_start_time.split(":").map(Number);
  const [endHour, endMin] = settings.work_end_time.split(":").map(Number);
  const start = localTimeToUTC(checkDate, hour, minute, settings.timezone);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  if (start < new Date(Date.now() + 10 * 60_000)) return null;
  if (start < localTimeToUTC(checkDate, startHour, startMin, settings.timezone) || end > localTimeToUTC(checkDate, endHour, endMin, settings.timezone)) return null;

  const { data: existingAppointments } = await supabase
    .from("crm_appointments").select("start_time, end_time")
    .eq("workspace_id", workspaceId).eq("assigned_to", memberId)
    .gte("start_time", new Date(start.getTime() - settings.min_interval * 60_000).toISOString())
    .lte("start_time", end.toISOString())
    .in("status", ["scheduled", "confirmed"]);
  const localBusy = ((existingAppointments || []) as AppointmentWindow[]).map((a) => ({ start: new Date(a.start_time), end: new Date(a.end_time) }));
  const googleBusy = await getGoogleCalendarBusySlots(supabase, workspaceId, memberId, new Date(start.getTime() - settings.min_interval * 60_000), end, settings.timezone);
  const conflict = [...localBusy, ...googleBusy].find((b) => start < new Date(b.end.getTime() + settings.min_interval * 60_000) && end > b.start);
  return conflict ? null : { date, time, datetime: start.toISOString(), member_id: memberId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const widgetId = url.searchParams.get("widget_id");
      const month = url.searchParams.get("month");

      if (!widgetId || !month) {
        return new Response(JSON.stringify({ error: "widget_id and month are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: widget, error: wErr } = await supabase.from("scheduling_widgets").select("*").eq("id", widgetId).eq("is_active", true).single();
      if (wErr || !widget) {
        return new Response(JSON.stringify({ error: "Widget not found or inactive" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Tracking IDs (Meta Pixel, Google Ads, GTM, Clarity) are configured ONLY at company level
      let resolvedPixelId: string | null = null;
      let resolvedClarityId: string | null = null;
      let resolvedGtmId: string | null = null;
      let resolvedGoogleAdsSendTo: string | null = null;
      {
        const { data: ws } = await supabase.from("workspaces").select("company_id").eq("id", widget.workspace_id).single();
        if (ws?.company_id) {
          const { data: company } = await supabase
            .from("companies")
            .select("meta_pixel_id, clarity_project_id, gtm_container_id, google_ads_send_to")
            .eq("id", ws.company_id)
            .single();
          resolvedPixelId = (company?.meta_pixel_id as string | null) || null;
          resolvedClarityId = (company as Record<string, unknown> | null)?.clarity_project_id as string | null || null;
          resolvedGtmId = (company as Record<string, unknown> | null)?.gtm_container_id as string | null || null;
          resolvedGoogleAdsSendTo = (company as Record<string, unknown> | null)?.google_ads_send_to as string | null || null;
        }
      }

      const widgetPayload = {
        id: widget.id,
        name: widget.name,
        title: widget.title ?? null,
        description: widget.description,
        duration_minutes: widget.duration_minutes,
        meta_pixel_id: resolvedPixelId,
        clarity_project_id: resolvedClarityId,
        gtm_container_id: resolvedGtmId,
        booking_window_days: widget.booking_window_days ?? 30,
        style: widget.style ?? null,
        google_ads_send_to: resolvedGoogleAdsSendTo,
        google_ads_conversions: widget.google_ads_conversions ?? null,
      };


      const { data: members } = await supabase.from("scheduling_widget_members").select("user_id").eq("widget_id", widgetId).eq("is_active", true);
      if (!members || members.length === 0) {
        return new Response(JSON.stringify({ widget: widgetPayload, slots: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const slotStepMinutes = await getWorkspaceSlotStepMinutes(supabase, widget.workspace_id);
      const allSlotsArrays = await Promise.all(
        (members as Array<{ user_id: string }>).map((m) => getMemberSlots(supabase, widget.workspace_id, m.user_id, widget.duration_minutes, month, slotStepMinutes))
      );
      const allSlots = allSlotsArrays.flat();

      const slotMap = new Map<string, { date: string; time: string; datetime: string }>();
      for (const s of allSlots) {
        const key = `${s.date}|${s.time}`;
        if (!slotMap.has(key)) slotMap.set(key, { date: s.date, time: s.time, datetime: s.datetime });
      }

      const mergedSlots = Array.from(slotMap.values()).sort((a, b) => a.datetime.localeCompare(b.datetime));

      // Enforce booking window (America/Sao_Paulo): drop slots beyond today + window - 1
      const windowDays = widget.booking_window_days ?? 30;
      const nowSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const maxDate = new Date(nowSP.getFullYear(), nowSP.getMonth(), nowSP.getDate() + windowDays - 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const maxDateStr = `${maxDate.getFullYear()}-${pad(maxDate.getMonth() + 1)}-${pad(maxDate.getDate())}`;
      const todayStr = `${nowSP.getFullYear()}-${pad(nowSP.getMonth() + 1)}-${pad(nowSP.getDate())}`;
      const filteredSlots = mergedSlots.filter((s) => s.date >= todayStr && s.date <= maxDateStr);

      return new Response(JSON.stringify({
        widget: widgetPayload,
        slots: filteredSlots
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      console.log("[schedule-widget] POST received");
      let body: Record<string, string>;
      try {
        body = await req.json() as Record<string, string>;
      } catch (parseErr: unknown) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const parseStack = parseErr instanceof Error ? parseErr.stack : undefined;
        console.error("[schedule-widget] Failed to parse JSON body:", parseMsg, parseStack);
        return new Response(JSON.stringify({ error: "Invalid JSON body: " + parseMsg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.log("[schedule-widget] POST body keys:", Object.keys(body || {}).join(","));
      const action = (body.action as string) || "book";

      // ====================================================================
      // ACTION: validate-email (verifica formato + MX/A do domínio)
      // ====================================================================
      if (action === "validate-email") {
        const { email } = body;
        if (!email) {
          return new Response(JSON.stringify({ valid: false, error: "Email é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const check = await validateEmailDeliverability(String(email));
        return new Response(JSON.stringify({ valid: check.ok, error: check.ok ? null : check.reason }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ====================================================================
      // ACTION: register-lead (etapa 1 do widget — dados básicos)
      // ====================================================================
      if (action === "register-lead") {
        const { widget_id, name, email, whatsapp, tags: incomingTagsRaw, utm: utmRaw } = body;
        if (!widget_id || !name || !email || !whatsapp) {
          return new Response(JSON.stringify({ error: "Campos obrigatórios: widget_id, name, email, whatsapp" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (!isRealBrazilianMobile(whatsapp)) {
          return new Response(JSON.stringify({ error: "Este número parece inválido. Informe seu WhatsApp real." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const incomingTags: string[] = Array.isArray(incomingTagsRaw)
          ? incomingTagsRaw.map((t: unknown) => String(t || "").trim()).filter(Boolean)
          : [];
        const utm = (utmRaw && typeof utmRaw === "object" ? utmRaw : {}) as Record<string, string | undefined>;
        // contactSource calculado abaixo (após resolver companyId para validar source contra origens cadastradas)


        const emailCheck = await validateEmailDeliverability(String(email));
        if (!emailCheck.ok) {
          return new Response(JSON.stringify({ error: emailCheck.reason || "Email inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }





        const { data: widget, error: wErr } = await supabase.from("scheduling_widgets").select("*").eq("id", widget_id).eq("is_active", true).single();
        if (wErr || !widget) {
          return new Response(JSON.stringify({ error: "Widget not found or inactive" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const normalizedPhone = normalizePhone(whatsapp);
        const { data: workspace } = await supabase.from("workspaces").select("company_id").eq("id", widget.workspace_id).single();
        const companyId = workspace?.company_id;
        const validSources = await loadValidSources(supabase, companyId);
        const contactSource = computeWidgetSource(utm, validSources);


        let contactId: string | null = null;
        let leadId: string | null = null;

        // Resolve existing contact across company workspaces by phone/email
        if (companyId) {
          const { data: companyWorkspaces } = await supabase.from("workspaces").select("id").eq("company_id", companyId);
          const wsIds = (companyWorkspaces as WorkspaceRow[] | null)?.map((w) => w.id) || [widget.workspace_id];
          const safeEmail = (email || "").replace(/[,()]/g, "");
          const orFilter = [
            normalizedPhone ? `phone.eq.${normalizedPhone}` : null,
            safeEmail ? `email.ilike.${safeEmail}` : null,
          ].filter(Boolean).join(",");

          if (orFilter) {
            const { data: candidates } = await supabase
              .from("crm_contacts")
              .select("id, name, email, phone, lead_id, workspace_id, scheduling_blocked, is_active")
              .or(orFilter).in("workspace_id", wsIds).limit(10);
            if (candidates && candidates.length > 0) {
              // Prioriza contato ativo no workspace do widget; cai em qualquer match (inclui inativos)
              const list = candidates as (ContactCandidate & { is_active?: boolean })[];
              const existing =
                list.find((c) => c.workspace_id === widget.workspace_id && c.is_active !== false) ||
                list.find((c) => c.workspace_id === widget.workspace_id) ||
                list.find((c) => c.is_active !== false) ||
                list[0];
              contactId = existing.id;
              const updates: Record<string, unknown> = {};
              if (!existing.name && name) updates.name = name;
              if (!existing.email && email) updates.email = email;
              if (!existing.phone && normalizedPhone) updates.phone = normalizedPhone;
              if (existing.is_active === false) {
                updates.is_active = true;
                console.log("[schedule-widget][register-lead] reativando contato inativo:", contactId);
              }
              if (Object.keys(updates).length > 0) {
                updates.updated_at = new Date().toISOString();
                await supabase.from("crm_contacts").update(updates).eq("id", contactId);
              }
            }
          }
        }

        // Create contact if not found
        if (!contactId) {
          const { data: newContact, error: contactErr } = await supabase
            .from("crm_contacts")
            .insert({ workspace_id: widget.workspace_id, name, email, phone: normalizedPhone, source: contactSource })
            .select("id").single();
          if (contactErr || !newContact) {
            console.error("[schedule-widget][register-lead] contact insert failed:", contactErr);
            return new Response(JSON.stringify({ error: "Failed to create contact: " + (contactErr?.message || "unknown") }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          contactId = newContact.id;
          await new Promise((r) => setTimeout(r, 300));
        }

        // Reuse existing open lead, otherwise create new one in first stage ("Lead")
        const { data: existingLeads } = await supabase
          .from("crm_leads").select("id, stage_id")
          .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
          .order("created_at", { ascending: false }).limit(1);
        if (existingLeads && existingLeads.length > 0) {
          leadId = existingLeads[0].id;
          await reopenLeadIfClosed(supabase, leadId, "Lead reativado automaticamente - novo agendamento iniciado via widget de agenda (etapa 1)");
        }

        if (!leadId) {
          // Look up "Lead" stage (exact match, then fallback to first by order)
          let { data: leadStage } = await supabase
            .from("crm_pipeline_stages").select("id")
            .eq("workspace_id", widget.workspace_id).eq("name", "Lead").maybeSingle();
          if (!leadStage) {
            const { data: firstStage } = await supabase
              .from("crm_pipeline_stages").select("id")
              .eq("workspace_id", widget.workspace_id).order("order", { ascending: true }).limit(1).maybeSingle();
            leadStage = firstStage;
          }
          if (!leadStage) {
            return new Response(JSON.stringify({ error: "No pipeline stage configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          const { data: newLead, error: leadErr } = await supabase
            .from("crm_leads")
            .insert({ workspace_id: widget.workspace_id, contact_id: contactId, stage_id: leadStage.id, title: name, status: "open" })
            .select("id").single();
          if (leadErr) {
            console.error("[schedule-widget][register-lead] lead insert failed:", leadErr);
            const { data: rec } = await supabase
              .from("crm_leads").select("id")
              .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (rec) leadId = rec.id;
          } else if (newLead) {
            leadId = newLead.id;
          }
        }

        // Propagar UTMs ao crm_leads e source ao crm_contacts (só preenche o que estiver vazio)
        try {
          const utmUpdate: Record<string, string> = {};
          if (utm.utm_source) utmUpdate.utm_source = String(utm.utm_source);
          if (utm.utm_medium) utmUpdate.utm_medium = String(utm.utm_medium);
          if (utm.utm_campaign) utmUpdate.utm_campaign = String(utm.utm_campaign);
          if (utm.utm_term) utmUpdate.utm_term = String(utm.utm_term);
          if (utm.utm_content) utmUpdate.utm_content = String(utm.utm_content);

          if (leadId && Object.keys(utmUpdate).length > 0) {
            const { data: currentLead } = await supabase
              .from("crm_leads")
              .select("utm_source, utm_medium, utm_campaign, utm_term, utm_content")
              .eq("id", leadId).maybeSingle();
            const filtered: Record<string, string> = {};
            for (const [k, v] of Object.entries(utmUpdate)) {
              const cur = (currentLead as Record<string, string | null> | null)?.[k];
              if (!cur && v) filtered[k] = v;
            }
            if (Object.keys(filtered).length > 0) {
              await supabase.from("crm_leads").update(filtered).eq("id", leadId);
              console.log("[schedule-widget][register-lead] UTMs propagados:", filtered);
            }
          }

          if (contactId) {
            const { data: c } = await supabase
              .from("crm_contacts").select("source").eq("id", contactId).maybeSingle();
            const curSrc = (c as { source?: string | null } | null)?.source;
            const newSource = computeWidgetSource(utm, validSources);
            if (newSource && isWidgetDefaultSource(curSrc)) {
              await supabase.from("crm_contacts")
                .update({ source: newSource, updated_at: new Date().toISOString() })
                .eq("id", contactId);
              console.log("[schedule-widget][register-lead] Source atualizado:", newSource);
            }
          }
        } catch (e) {
          console.error("[schedule-widget][register-lead] UTM/source propagation failed:", e);
        }


        // A/B testing enrichment (não-destrutivo). ab_* vem no root do body.
        await applyAbEnrichment(supabase, contactId, {
          ab_vid: body.ab_vid,
          ab_test: body.ab_test,
          ab_var: body.ab_var,
        });


        // Merge URL-provided tags into contact (non-destructive)
        if (incomingTags.length > 0 && contactId) {
          try {
            const TAG_PALETTE = ["#22C55E","#3B82F6","#8B5CF6","#EC4899","#F59E0B","#14B8A6","#EF4444","#64748B","#A855F7","#6B7280"];
            const tagColor = (n: string) => {
              let h = 0;
              for (let i = 0; i < n.length; i++) { h = ((h << 5) - h) + n.charCodeAt(i); h = h & h; }
              return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
            };
            const { data: cRow } = await supabase.from("crm_contacts").select("tags").eq("id", contactId).maybeSingle();
            const current: Array<{ name: string; color: string }> = Array.isArray(cRow?.tags) ? (cRow!.tags as Array<{ name: string; color: string }>) : [];
            const existingLower = new Set(current.map((t) => String(t?.name || "").toLowerCase()));
            const additions: Array<{ name: string; color: string }> = [];
            for (const raw of incomingTags) {
              const n = raw.trim();
              if (!n) continue;
              const key = n.toLowerCase();
              if (existingLower.has(key)) continue;
              existingLower.add(key);
              additions.push({ name: n, color: tagColor(n) });
            }
            if (additions.length > 0) {
              const merged = [...current, ...additions];
              await supabase.from("crm_contacts").update({ tags: merged, updated_at: new Date().toISOString() }).eq("id", contactId);

              // Sincroniza tags com dn.marketing (não bloqueante)
              try {
                const tagsSyncPromise = fetch(`${supabaseUrl}/functions/v1/dnmarketing-tags-sync`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
                  body: JSON.stringify({ contact_id: contactId }),
                }).then(async (r) => {
                  const txt = await r.text().catch(() => "");
                  console.log(`[schedule-widget][register-lead] dnmarketing-tags-sync status=${r.status} body=${txt.slice(0, 200)}`);
                }).catch((err) => console.error("[schedule-widget][register-lead] dnmarketing-tags-sync fetch error:", err));
                if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
                  EdgeRuntime.waitUntil(tagsSyncPromise);
                }
              } catch (err) {
                console.error("[schedule-widget][register-lead] dnmarketing-tags-sync trigger error:", err);
              }
            }
          } catch (e) {
            console.error("[schedule-widget][register-lead] tag merge failed:", e);
          }
        }




        // Meta CAPI Lead event (non-blocking)
        try {
          let pixelId: string | null = null;
          if (companyId) {
            const { data: company } = await supabase.from("companies").select("meta_pixel_id, meta_access_token").eq("id", companyId).maybeSingle();
            if (company?.meta_pixel_id && company?.meta_access_token) pixelId = company.meta_pixel_id;
          }
          if (pixelId && companyId && leadId) {
            const capiPromise = fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({
                event_name: "Lead",
                lead_id: leadId,
                contact_id: contactId,
                workspace_id: widget.workspace_id,
                pixel_id: pixelId,
                company_id: companyId,
                custom_data: { widget_id, widget_name: widget.name, currency: "BRL", value: 0 },
                source_url: req.headers.get("referer") || null,
              }),
            }).then(async (r) => {
              const txt = await r.text().catch(() => "");
              console.log(`[schedule-widget][register-lead] META CAPI Lead status=${r.status} body=${txt.slice(0, 200)}`);
            }).catch((err) => console.error("[schedule-widget][register-lead] META CAPI Lead fetch error:", err));
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
              EdgeRuntime.waitUntil(capiPromise);
            }
          }

          // Meta CAPI CompleteRegistration event (final da etapa 1)
          if (pixelId && companyId && leadId) {
            const capiRegPromise = fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({
                event_name: "CompleteRegistration",
                lead_id: leadId,
                contact_id: contactId,
                workspace_id: widget.workspace_id,
                pixel_id: pixelId,
                company_id: companyId,
                custom_data: { widget_id, widget_name: widget.name, currency: "BRL", value: 0, status: true },
                source_url: req.headers.get("referer") || null,
              }),
            }).then(async (r) => {
              const txt = await r.text().catch(() => "");
              console.log(`[schedule-widget][register-lead] META CAPI CompleteRegistration status=${r.status} body=${txt.slice(0, 200)}`);
            }).catch((err) => console.error("[schedule-widget][register-lead] META CAPI CompleteRegistration fetch error:", err));
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
              EdgeRuntime.waitUntil(capiRegPromise);
            }
          }
        } catch (err) {
          console.error("[schedule-widget][register-lead] META CAPI Lead error:", err);
        }


        // dn.marketing sync (não bloqueante) — cadastra/atualiza identidade e registra conversão (etapa 1)
        if (contactId) {
          try {
            const slugify = (s: string) =>
              s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "widget-agendamento";
            const pageSlug = slugify(widget.name || "widget-agendamento");
            const dnPromise = fetch(`${supabaseUrl}/functions/v1/dnmarketing-sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({
                contact_id: contactId,
                register_conversion: true,
                conversion: {
                  tipo: "lead",
                  page_slug: pageSlug,
                  session_id: leadId,
                  apply_tag: true,
                  utm: {
                    utm_source: utm.utm_source,
                    utm_medium: utm.utm_medium,
                    utm_campaign: utm.utm_campaign,
                    utm_term: utm.utm_term,
                    utm_content: utm.utm_content,
                  },
                },
              }),
            }).then(async (r) => {
              const txt = await r.text().catch(() => "");
              console.log(`[schedule-widget][register-lead] dnmarketing-sync status=${r.status} body=${txt.slice(0, 200)}`);
            }).catch((err) => console.error("[schedule-widget][register-lead] dnmarketing-sync error:", err));
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
              EdgeRuntime.waitUntil(dnPromise);
            }
          } catch (err) {
            console.error("[schedule-widget][register-lead] dnmarketing-sync trigger error:", err);
          }
        }


        return new Response(JSON.stringify({ success: true, contact_id: contactId, lead_id: leadId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ====================================================================
      // ACTION: qualify-lead (etapa 2 — campos de qualificação)
      // ====================================================================
      if (action === "qualify-lead") {
        const { lead_id, contact_id, job_title, company, revenue, employee_count } = body;
        const widget_id = body.widget_id as string | undefined;
        if (!lead_id || !contact_id || !job_title || !company || !revenue || !employee_count) {
          return new Response(JSON.stringify({ error: "Campos obrigatórios: lead_id, contact_id, job_title, company, revenue, employee_count" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Fetch current contact + lead to discover workspace + non-destructive update
        const { data: existingContact, error: cErr } = await supabase
          .from("crm_contacts").select("id, workspace_id, job_title, company, revenue, employee_count")
          .eq("id", contact_id).maybeSingle();
        if (cErr || !existingContact) {
          return new Response(JSON.stringify({ error: "Contato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // === ICP gate (per-widget config) ===
        if (widget_id) {
          const { data: widgetCfg } = await supabase
            .from("scheduling_widgets")
            .select("icp_enabled, icp_revenue_ranges, icp_job_titles, icp_employee_counts, icp_block_message")
            .eq("id", widget_id).maybeSingle();
          if (widgetCfg && widgetCfg.icp_enabled) {
            // As 3 dimensões são estritas: a resposta precisa estar entre as opções marcadas.
            // Lista vazia = configuração inválida ⇒ bloqueia (fail-closed).
            const revenueForm = (revenue as string | undefined)?.trim() ?? "";
            const jobTitleForm = (job_title as string | undefined)?.trim() ?? "";
            const employeeForm = (employee_count as string | undefined)?.trim() ?? "";
            const revenueOk = Array.isArray(widgetCfg.icp_revenue_ranges) && widgetCfg.icp_revenue_ranges.includes(revenueForm);
            const titleOk = Array.isArray(widgetCfg.icp_job_titles) && widgetCfg.icp_job_titles.includes(jobTitleForm);
            const employeeOk = Array.isArray(widgetCfg.icp_employee_counts) && widgetCfg.icp_employee_counts.includes(employeeForm);
            if (!revenueOk || !titleOk || !employeeOk) {
              const blockUpdates: Record<string, unknown> = {};
              if (!existingContact.job_title && job_title) blockUpdates.job_title = job_title;
              if (!existingContact.company && company) blockUpdates.company = company;
              if (!existingContact.revenue && revenue) blockUpdates.revenue = revenue;
              if (!existingContact.employee_count && employee_count) blockUpdates.employee_count = employee_count;
              if (Object.keys(blockUpdates).length > 0) {
                blockUpdates.updated_at = new Date().toISOString();
                await supabase.from("crm_contacts").update(blockUpdates).eq("id", contact_id);
              }
              console.log(`[schedule-widget][qualify-lead] ICP block widget=${widget_id} revenue_ok=${revenueOk} title_ok=${titleOk} employee_ok=${employeeOk}`);

              // Registra a tentativa bloqueada (auditável), sem bloquear o fluxo de resposta.
              const failedDimensions: string[] = [];
              if (!revenueOk) failedDimensions.push("revenue");
              if (!titleOk) failedDimensions.push("job_title");
              if (!employeeOk) failedDimensions.push("employee_count");
              try {
                await supabase.from("scheduling_blocked_attempts").insert({
                  widget_id,
                  workspace_id: existingContact.workspace_id,
                  contact_id,
                  lead_id,
                  answers: {
                    job_title: jobTitleForm || null,
                    company: (company as string | undefined)?.trim() ?? null,
                    revenue: revenueForm || null,
                    employee_count: employeeForm || null,
                  },
                  icp_config_snapshot: {
                    revenue_ranges: widgetCfg.icp_revenue_ranges ?? [],
                    job_titles: widgetCfg.icp_job_titles ?? [],
                    employee_counts: widgetCfg.icp_employee_counts ?? [],
                  },
                  failed_dimensions: failedDimensions,
                });
              } catch (err) {
                console.error("[schedule-widget][qualify-lead] blocked-attempt insert error:", err);
              }

              // Marca o resultado do gate no card (atributo ICP; null = nunca avaliado)
              if (lead_id) {
                await supabase.from("crm_leads").update({ is_icp: false }).eq("id", lead_id);
              }

              return new Response(JSON.stringify({
                error: widgetCfg.icp_block_message || "Lead fora do perfil desejado para esta agenda.",
                icp_blocked: true,
              }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            // Gate ICP aprovado: marca o card como ICP
            if (lead_id) {
              await supabase.from("crm_leads").update({ is_icp: true }).eq("id", lead_id);
            }
          }
        }

        const updates: Record<string, unknown> = {};
        if (!existingContact.job_title && job_title) updates.job_title = job_title;
        if (!existingContact.company && company) updates.company = company;
        if (!existingContact.revenue && revenue) updates.revenue = revenue;
        if (!existingContact.employee_count && employee_count) updates.employee_count = employee_count;
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          const { error: upErr } = await supabase.from("crm_contacts").update(updates).eq("id", contact_id);
          if (upErr) console.error("[schedule-widget][qualify-lead] contact update failed:", upErr);
        }

        // A/B testing enrichment (não-destrutivo — fallback caso etapa 1 não tenha capturado)
        await applyAbEnrichment(supabase, contact_id, {
          ab_vid: body.ab_vid,
          ab_test: body.ab_test,
          ab_var: body.ab_var,
        });



        const workspaceId = existingContact.workspace_id as string;

        // === Gate: lead ja tem reuniao futura em aberto? ===
        // Roda ANTES de mexer no card. O widget e publico e o proprio contato
        // reabre o link; se ele ja tem reuniao marcada, avisamos e nao tocamos na
        // etapa nem disparamos conversao de qualificacao de novo. Sem isso, refazer
        // o formulario rebaixava o card (MQL -> Lead Qualificado) e o reinscrevia
        // na regua da etapa anterior.
        const alreadyScheduled = await findExistingAppointment(supabase, workspaceId, lead_id, contact_id);
        if (alreadyScheduled) {
          console.log("[schedule-widget][qualify-lead] lead ja possui reuniao futura, card preservado:", lead_id);
          return new Response(JSON.stringify({
            already_scheduled: true,
            appointment: alreadyScheduled.appointment,
            message: alreadyScheduled.message,
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Move lead to "Lead Qualificado" stage
        let qualStage: { id: string } | null = null;
        const { data: exact } = await supabase
          .from("crm_pipeline_stages").select("id")
          .eq("workspace_id", workspaceId).eq("name", "Lead Qualificado").maybeSingle();
        qualStage = exact;
        if (!qualStage) {
          const { data: mql } = await supabase
            .from("crm_pipeline_stages").select("id")
            .eq("workspace_id", workspaceId).ilike("name", "%qualif%")
            .order("order", { ascending: true }).limit(1).maybeSingle();
          qualStage = mql;
        }

        // Reabre o card se estiver perdido/excluído (independente de troca de estágio)
        await reopenLeadIfClosed(supabase, lead_id, "Lead reativado automaticamente - qualificação via widget de agenda (etapa 2)");

        if (qualStage) {
          await moveLeadForwardOnly(
            supabase,
            lead_id,
            qualStage.id,
            "Lead qualificado via widget de agenda (etapa 2)",
          );
        } else {
          console.warn("[schedule-widget][qualify-lead] estágio 'Lead Qualificado' não encontrado no workspace", workspaceId);
        }

        // Meta CAPI custom event "Leads Qualificados" (não bloqueante)
        try {
          const { data: ws } = await supabase.from("workspaces").select("company_id").eq("id", workspaceId).maybeSingle();
          const companyId = ws?.company_id as string | undefined;
          let pixelId: string | null = null;
          let widgetName: string | null = null;
          if (widget_id) {
            const { data: w } = await supabase.from("scheduling_widgets").select("name").eq("id", widget_id).maybeSingle();
            widgetName = w?.name || null;
          }
          if (companyId) {
            const { data: companyRow } = await supabase.from("companies").select("meta_pixel_id, meta_access_token").eq("id", companyId).maybeSingle();
            if (companyRow?.meta_pixel_id && companyRow?.meta_access_token) pixelId = companyRow.meta_pixel_id;
          }
          if (pixelId && companyId) {
            const capiPromise = fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({
                event_name: "Leads Qualificados",
                lead_id,
                contact_id,
                workspace_id: workspaceId,
                pixel_id: pixelId,
                company_id: companyId,
                custom_data: { widget_id, widget_name: widgetName, job_title, company_name: company, revenue, employee_count, currency: "BRL", value: 0 },
                source_url: req.headers.get("referer") || null,
              }),
            }).then(async (r) => {
              const txt = await r.text().catch(() => "");
              console.log(`[schedule-widget][qualify-lead] META CAPI Leads Qualificados status=${r.status} body=${txt.slice(0, 200)}`);
            }).catch((err) => console.error("[schedule-widget][qualify-lead] META CAPI fetch error:", err));
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
              EdgeRuntime.waitUntil(capiPromise);
            }
          }
        } catch (err) {
          console.error("[schedule-widget][qualify-lead] META CAPI error:", err);
        }

        // dn.marketing sync (não bloqueante) — atualiza identidade após qualificação
        try {
          const dnPromise = fetch(`${supabaseUrl}/functions/v1/dnmarketing-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify({ contact_id }),
          }).then(async (r) => {
            const txt = await r.text().catch(() => "");
            console.log(`[schedule-widget][qualify-lead] dnmarketing-sync status=${r.status} body=${txt.slice(0, 200)}`);
          }).catch((err) => console.error("[schedule-widget][qualify-lead] dnmarketing-sync error:", err));
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            EdgeRuntime.waitUntil(dnPromise);
          }
        } catch (err) {
          console.error("[schedule-widget][qualify-lead] dnmarketing-sync trigger error:", err);
        }

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ====================================================================
      // ACTION: book (padrão — etapa 3, criação do appointment)
      // ====================================================================
      const { widget_id, name, email, whatsapp, date, time, utm: utmRawBook } = body;
      const providedContactId = (body.contact_id as string) || null;
      const providedLeadId = (body.lead_id as string) || null;
      const utm = (utmRawBook && typeof utmRawBook === "object" ? utmRawBook : {}) as Record<string, string | undefined>;
      // contactSource calculado abaixo (após resolver companyId para validar source contra origens cadastradas)

      if (!widget_id || !name || !email || !whatsapp || !date || !time) {
        console.error("[schedule-widget] Missing required fields:", { widget_id: !!widget_id, name: !!name, email: !!email, whatsapp: !!whatsapp, date: !!date, time: !!time });
        return new Response(JSON.stringify({ error: "All fields are required: widget_id, name, email, whatsapp, date, time" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!isRealBrazilianMobile(whatsapp)) {
        return new Response(JSON.stringify({ error: "Este número parece inválido. Informe seu WhatsApp real." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: widget, error: wErr } = await supabase.from("scheduling_widgets").select("*").eq("id", widget_id).eq("is_active", true).single();
      if (wErr || !widget) {
        return new Response(JSON.stringify({ error: "Widget not found or inactive" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // === ICP gate (etapa 3 — defesa em profundidade) ===
      // Usa SOMENTE as respostas do formulário da etapa 2 reenviadas pelo frontend.
      // Não consulta dados existentes do contato — apenas os campos do form.
      if ((widget as { icp_enabled?: boolean }).icp_enabled) {
        const jobTitleForm = (body.job_title as string | undefined)?.trim();
        const companyForm = (body.company as string | undefined)?.trim();
        const revenueForm = (body.revenue as string | undefined)?.trim();
        const employeeCountForm = (body.employee_count as string | undefined)?.trim();

        if (!jobTitleForm || !companyForm || !revenueForm || !employeeCountForm) {
          console.log("[schedule-widget][book] ICP block: missing qualification form fields", {
            has_job_title: !!jobTitleForm, has_company: !!companyForm, has_revenue: !!revenueForm, has_employee_count: !!employeeCountForm,
          });
          return new Response(JSON.stringify({
            error: "Qualificação obrigatória antes de agendar.",
            icp_blocked: true,
          }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const w = widget as { icp_revenue_ranges?: string[] | null; icp_job_titles?: string[] | null; icp_employee_counts?: string[] | null; icp_block_message?: string | null };
        const revenueOk = Array.isArray(w.icp_revenue_ranges) && w.icp_revenue_ranges.includes(revenueForm);
        const titleOk = Array.isArray(w.icp_job_titles) && w.icp_job_titles.includes(jobTitleForm);
        // Estrito: lista vazia de tamanho de empresa ⇒ bloqueia (fail-closed), igual às demais dimensões.
        const employeeOk = Array.isArray(w.icp_employee_counts) && w.icp_employee_counts.includes(employeeCountForm);

        if (!revenueOk || !titleOk || !employeeOk) {
          console.log(`[schedule-widget][book] ICP block widget=${widget_id} revenue_ok=${revenueOk} title_ok=${titleOk} employee_ok=${employeeOk}`);
          // Marca o resultado do gate no card (atributo ICP)
          if (providedLeadId) {
            await supabase.from("crm_leads").update({ is_icp: false }).eq("id", providedLeadId);
          }
          return new Response(JSON.stringify({
            error: w.icp_block_message || "Lead fora do perfil desejado para esta agenda.",
            icp_blocked: true,
          }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Gate ICP aprovado: marca o card como ICP
        if (providedLeadId) {
          await supabase.from("crm_leads").update({ is_icp: true }).eq("id", providedLeadId);
        }
      }

      // === Gate defensivo: lead já tem reunião futura em aberto? ===
      if (providedLeadId || providedContactId) {
        const dupCheck = await findExistingAppointment(supabase, widget.workspace_id, providedLeadId, providedContactId);
        if (dupCheck) {
          return new Response(JSON.stringify({
            already_scheduled: true,
            appointment: dupCheck.appointment,
            message: dupCheck.message,
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }



      // Block scheduling on configured holidays
      const { data: holidayCheck } = await supabase
        .from("crm_holidays")
        .select("name")
        .eq("workspace_id", widget.workspace_id)
        .eq("date", date)
        .maybeSingle();
      if (holidayCheck) {
        return new Response(
          JSON.stringify({ error: `Data indisponível: ${(holidayCheck as { name: string }).name}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }


      const { data: members } = await supabase.from("scheduling_widget_members").select("user_id").eq("widget_id", widget_id).eq("is_active", true);
      if (!members || members.length === 0) {
        return new Response(JSON.stringify({ error: "No members available" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const memberSlots = await Promise.all(
        (members as Array<{ user_id: string }>).map(async (m) => {
          const slot = await getMemberSlotForTime(supabase, widget.workspace_id, m.user_id, widget.duration_minutes, date, time);
          return { user_id: m.user_id, hasSlot: !!slot, slot };
        })
      );

      const availableMembers = memberSlots.filter(m => m.hasSlot);
      if (availableMembers.length === 0) {
        return new Response(JSON.stringify({ error: "Selected time slot is no longer available" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const routingCfg = await loadRoutingConfig(supabase, widget.workspace_id);
      const memberIds = availableMembers.map(m => m.user_id);
      // Carga na janela configurada, incluindo completed/no_show (spec §7.1 —
      // a janela antiga de 30 dias sem completed lia quem atendeu muito como
      // ocioso). Desempate estável por user_id, nunca Math.random().
      const loadMap = await getSchedulingLoad(supabase, widget.workspace_id, memberIds, routingCfg.scheduling_load_window_days);
      // Distribuicao por carga define o padrao para contatos novos. Contato que
      // ja tem card volta para o responsavel dele — resolvido mais abaixo,
      // quando o lead e conhecido.
      let selectedMemberId = selectAssignee(memberIds, { strategy: routingCfg.scheduling_strategy, loads: loadMap })!;

      const matchingSlot = memberSlots.find(m => m.user_id === selectedMemberId)!.slot!;

      // Recalculavel: se o responsavel do card assumir o agendamento, o horario
      // e derivado do calendario DELE — o fuso vem das configuracoes do membro.
      let startTime = new Date(matchingSlot.datetime);
      let endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + widget.duration_minutes);

      const normalizedPhone = normalizePhone(whatsapp);
      const { data: workspace } = await supabase.from("workspaces").select("company_id").eq("id", widget.workspace_id).single();
      const companyId = workspace?.company_id;
      const validSources = await loadValidSources(supabase, companyId);
      const contactSource = computeWidgetSource(utm, validSources);


      let contactId: string | null = providedContactId;
      let leadId: string | null = providedLeadId;

      // If session already provided an identified contact/lead, trust it and
      // skip the form-based phone/email lookup (prevents form data from
      // hijacking an established identity, e.g. test data overwriting a real lead).
      if (providedContactId) {
        const { data: providedContact } = await supabase
          .from("crm_contacts")
          .select("id, name, email, phone, workspace_id, scheduling_blocked, is_active")
          .eq("id", providedContactId)
          .maybeSingle();

        if (providedContact && (providedContact as { scheduling_blocked?: boolean }).scheduling_blocked === true) {
          console.log("[schedule-widget] provided contact has scheduling_blocked=true, refusing", providedContactId);
          return new Response(JSON.stringify({ error: "No momento não encontramos horários disponíveis para agendamento." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (providedContact) {
          // Re-activate if inactive
          const updates: Record<string, unknown> = {};
          if ((providedContact as { is_active?: boolean }).is_active === false) updates.is_active = true;
          if (!providedContact.name && name) updates.name = name;
          if (!providedContact.email && email) updates.email = email;
          if (!providedContact.phone && normalizedPhone) updates.phone = normalizedPhone;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from("crm_contacts").update(updates).eq("id", providedContactId);
          }

          if (!leadId) {
            const { data: existingLeads } = await supabase
              .from("crm_leads").select("id, status")
              .eq("contact_id", providedContactId).eq("workspace_id", widget.workspace_id)
              .order("created_at", { ascending: false }).limit(1);
            if (existingLeads && existingLeads.length > 0) {
              leadId = existingLeads[0].id;
              console.log("[schedule-widget] reusing existing lead from session contact:", leadId);
            }
          }
        } else {
          // Provided contact id no longer exists; fall back to lookup
          contactId = null;
          console.log("[schedule-widget] provided contact_id not found, falling back to lookup");
        }
      }

      if (companyId && !contactId) {
        const { data: companyWorkspaces } = await supabase
          .from("workspaces").select("id").eq("company_id", companyId);
        const companyWorkspaceIds = (companyWorkspaces as WorkspaceRow[] | null)?.map((w) => w.id) || [widget.workspace_id];

        // Search by phone OR email across the company; prioritize current workspace match
        const safeEmail = (email || "").replace(/[,()]/g, "");
        const orFilter = [
          normalizedPhone ? `phone.eq.${normalizedPhone}` : null,
          safeEmail ? `email.ilike.${safeEmail}` : null,
        ].filter(Boolean).join(",");

        let existingContact: ContactCandidate | null = null;
        if (orFilter) {
          const { data: candidates } = await supabase
            .from("crm_contacts")
            .select("id, name, email, phone, lead_id, workspace_id, scheduling_blocked")
            .or(orFilter)
            .eq("is_active", true)
            .in("workspace_id", companyWorkspaceIds)
            .limit(10);

          if (candidates && candidates.length > 0) {
            existingContact = (candidates as ContactCandidate[]).find((c) => c.workspace_id === widget.workspace_id) || (candidates as ContactCandidate[])[0];
          }
        }

        if (existingContact) {
          if ((existingContact as { scheduling_blocked?: boolean }).scheduling_blocked === true) {
            console.log("[schedule-widget] contact has scheduling_blocked=true, refusing", existingContact.id);
            return new Response(JSON.stringify({ error: "No momento não encontramos horários disponíveis para agendamento." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          contactId = existingContact.id;
          // Non-destructive update: only fill empty fields to avoid trigger conflicts
          const updates: Record<string, unknown> = {};
          if (!existingContact.name && name) updates.name = name;
          if (!existingContact.email && email) updates.email = email;
          if (!existingContact.phone && normalizedPhone) updates.phone = normalizedPhone;
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from("crm_contacts").update(updates).eq("id", contactId);
          }

          const { data: existingLeads, error: leadLookupErr } = await supabase
            .from("crm_leads").select("id, status")
            .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
            .order("created_at", { ascending: false }).limit(1);

          if (leadLookupErr) {
            console.error("[schedule-widget] existing lead lookup failed:", leadLookupErr);
          }
          if (existingLeads && existingLeads.length > 0) {
            leadId = existingLeads[0].id;
            console.log("[schedule-widget] reusing existing lead:", leadId, "status:", existingLeads[0].status);
          }
        }
      }


      if (!contactId) {
        const { data: newContact, error: contactErr } = await supabase
          .from("crm_contacts")
          .insert({ workspace_id: widget.workspace_id, name, email, phone: normalizedPhone, source: contactSource })
          .select("id").single();

        if (contactErr) {
          const msg = contactErr.message || "";
          console.error("[schedule-widget] crm_contacts INSERT failed:", {
            error: contactErr,
            payload: { workspace_id: widget.workspace_id, name, email, phone: normalizedPhone, source: contactSource },
          });
          // Race condition: trigger raised duplicate after our lookup. Try to recover.
          if (msg.includes("Contato duplicado") || msg.toLowerCase().includes("duplicate")) {
            const { data: wsAgain } = await supabase
              .from("workspaces").select("id").eq("company_id", companyId);
            const wsIds = (wsAgain as WorkspaceRow[] | null)?.map((w) => w.id) || [widget.workspace_id];
            const safeEmail2 = (email || "").replace(/[,()]/g, "");
            const orFilter2 = [
              normalizedPhone ? `phone.eq.${normalizedPhone}` : null,
              safeEmail2 ? `email.ilike.${safeEmail2}` : null,
            ].filter(Boolean).join(",");
            if (orFilter2) {
              const { data: recovered, error: recErr } = await supabase
                .from("crm_contacts")
                .select("id, workspace_id")
                .or(orFilter2)
                .eq("is_active", true)
                .in("workspace_id", wsIds)
                .limit(10);
              if (recErr) console.error("[schedule-widget] duplicate-recovery query failed:", recErr);
              const pick = (recovered as WorkspaceRow[] | null)?.find((c) => c.workspace_id === widget.workspace_id) || (recovered as WorkspaceRow[] | null)?.[0];
              if (pick) contactId = pick.id;
            }
            if (!contactId) {
              console.error("[schedule-widget] duplicate-recovery could not locate existing contact", { email, normalizedPhone, companyId });
              return new Response(JSON.stringify({ error: "Não foi possível concluir o agendamento: já existe um contato com esses dados na empresa." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
          } else {
            return new Response(JSON.stringify({ error: "Failed to create contact: " + msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        } else {
          contactId = newContact.id;
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        const { data: autoLead } = await supabase
          .from("crm_leads").select("id")
          .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
          .order("created_at", { ascending: false }).limit(1)
          .maybeSingle();

        if (autoLead) leadId = autoLead.id;
      }

      if (!leadId && contactId) {
        // Last-chance lookup to avoid duplicate-key on (workspace_id, contact_id)
        const { data: anyLeads, error: anyLeadErr } = await supabase
          .from("crm_leads").select("id")
          .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
          .order("created_at", { ascending: false }).limit(1);
        if (anyLeadErr) console.error("[schedule-widget] last-chance lead lookup failed:", anyLeadErr);
        if (anyLeads && anyLeads.length > 0) {
          leadId = anyLeads[0].id;
          console.log("[schedule-widget] last-chance reuse lead:", leadId);
        }
      }

      // Propagar UTMs ao crm_leads e source ao crm_contacts (só preenche o que estiver vazio)
      try {
        const utmUpdate: Record<string, string> = {};
        if (utm.utm_source) utmUpdate.utm_source = String(utm.utm_source);
        if (utm.utm_medium) utmUpdate.utm_medium = String(utm.utm_medium);
        if (utm.utm_campaign) utmUpdate.utm_campaign = String(utm.utm_campaign);
        if (utm.utm_term) utmUpdate.utm_term = String(utm.utm_term);
        if (utm.utm_content) utmUpdate.utm_content = String(utm.utm_content);

        if (leadId && Object.keys(utmUpdate).length > 0) {
          const { data: currentLead } = await supabase
            .from("crm_leads")
            .select("utm_source, utm_medium, utm_campaign, utm_term, utm_content")
            .eq("id", leadId).maybeSingle();
          const filtered: Record<string, string> = {};
          for (const [k, v] of Object.entries(utmUpdate)) {
            const cur = (currentLead as Record<string, string | null> | null)?.[k];
            if (!cur && v) filtered[k] = v;
          }
          if (Object.keys(filtered).length > 0) {
            await supabase.from("crm_leads").update(filtered).eq("id", leadId);
            console.log("[schedule-widget][book] UTMs propagados:", filtered);
          }
        }

        if (contactId) {
          const { data: c } = await supabase
            .from("crm_contacts").select("source").eq("id", contactId).maybeSingle();
          const curSrc = (c as { source?: string | null } | null)?.source;
          const newSource = computeWidgetSource(utm, validSources);
          if (newSource && isWidgetDefaultSource(curSrc)) {
            await supabase.from("crm_contacts")
              .update({ source: newSource, updated_at: new Date().toISOString() })
              .eq("id", contactId);
            console.log("[schedule-widget][book] Source atualizado:", newSource);
          }
        }
      } catch (e) {
        console.error("[schedule-widget][book] UTM/source propagation failed:", e);
      }

      // A/B testing enrichment (não-destrutivo — fallback caso etapas 1/2 não tenham capturado)
      await applyAbEnrichment(supabase, contactId, {
        ab_vid: body.ab_vid,
        ab_test: body.ab_test,
        ab_var: body.ab_var,
      });





      if (!leadId) {
        const { data: firstStage, error: stageErr } = await supabase
          .from("crm_pipeline_stages").select("id")
          .eq("workspace_id", widget.workspace_id).order("order", { ascending: true }).limit(1).single();

        if (stageErr) console.error("[schedule-widget] crm_pipeline_stages lookup failed:", { error: stageErr, workspace_id: widget.workspace_id });

        if (firstStage) {
          const { data: newLead, error: leadErr } = await supabase
            .from("crm_leads")
            .insert({
              workspace_id: widget.workspace_id,
              contact_id: contactId,
              stage_id: firstStage.id,
              title: ((body.company as string | undefined)?.trim()) || name,
              status: "open",
              assigned_to: selectedMemberId
            })
            .select("id").single();
          if (leadErr) {
            console.error("[schedule-widget] crm_leads INSERT failed:", { error: leadErr, contact_id: contactId, workspace_id: widget.workspace_id, stage_id: firstStage.id });
            const { data: recoveredLeads, error: recErr } = await supabase
              .from("crm_leads").select("id")
              .eq("contact_id", contactId).eq("workspace_id", widget.workspace_id)
              .order("created_at", { ascending: false }).limit(1);
            if (recErr) console.error("[schedule-widget] lead recovery query failed:", recErr);
            if (recoveredLeads && recoveredLeads.length > 0) {
              leadId = recoveredLeads[0].id;
              console.log("[schedule-widget] recovered existing lead after duplicate:", leadId);
            }
          }
          if (newLead) leadId = newLead.id;
        } else {
          console.error("[schedule-widget] no pipeline stage available for workspace", widget.workspace_id);
        }
      }

      if (!leadId) {
        console.error("[schedule-widget] giving up: leadId still null", { contactId, workspace_id: widget.workspace_id });
        return new Response(JSON.stringify({ error: "Failed to create lead" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Contato que volta a agendar fica com o responsavel do card dele, nao com
      // quem a distribuicao por carga sortear. So exige que esse responsavel
      // tenha horario livre — senao nao ha como marcar na agenda dele.
      const { data: existingLead } = await supabase
        .from("crm_leads")
        .select("assigned_to")
        .eq("id", leadId)
        .maybeSingle();

      const cardOwnerId = (existingLead as { assigned_to: string | null } | null)?.assigned_to ?? null;

      if (routingCfg.respect_card_owner && cardOwnerId && cardOwnerId !== selectedMemberId) {
        const ownerIsAvailable = availableMembers.some(m => m.user_id === cardOwnerId);
        if (ownerIsAvailable) {
          console.log("[schedule-widget] contato recorrente: mantendo responsavel do card", cardOwnerId);
          selectedMemberId = cardOwnerId;

          const ownerSlot = memberSlots.find(m => m.user_id === cardOwnerId)?.slot;
          if (ownerSlot) {
            startTime = new Date(ownerSlot.datetime);
            endTime = new Date(startTime);
            endTime.setMinutes(endTime.getMinutes() + widget.duration_minutes);
          }
        } else {
          console.warn(
            `[schedule-widget] responsavel do card (${cardOwnerId}) sem horario livre em ${date} ${time}; ` +
              `atribuindo a ${selectedMemberId}`,
          );
        }
      }

      // O card sempre fica com quem realmente vai atender a reuniao: ou o dono
      // atual (mantido acima quando tem agenda) ou o escolhido pelo rodizio.
      // Assim card, agendamento e atividade nunca divergem de responsavel.
      if (cardOwnerId !== selectedMemberId) {
        await supabase.from("crm_leads").update({ assigned_to: selectedMemberId }).eq("id", leadId);
      }


      // Snapshot auditável das respostas de ICP do widget + config de ICP no momento do booking.
      // Isolado dos campos compartilhados de crm_contacts (que podem vir de tráfego pago / edição
      // manual / IA). Avaliação do widget é determinística (includes), sem IA.
      const wIcp = widget as { icp_enabled?: boolean; icp_revenue_ranges?: string[] | null; icp_job_titles?: string[] | null; icp_employee_counts?: string[] | null };
      const widgetQualification = {
        answers: {
          job_title: (body.job_title as string | undefined)?.trim() ?? null,
          company: (body.company as string | undefined)?.trim() ?? null,
          revenue: (body.revenue as string | undefined)?.trim() ?? null,
          employee_count: (body.employee_count as string | undefined)?.trim() ?? null,
        },
        icp_enabled: !!wIcp.icp_enabled,
        icp_config_snapshot: wIcp.icp_enabled
          ? {
              revenue_ranges: wIcp.icp_revenue_ranges ?? [],
              job_titles: wIcp.icp_job_titles ?? [],
              employee_counts: wIcp.icp_employee_counts ?? [],
            }
          : null,
        evaluated_at: new Date().toISOString(),
      };

      const { data: appointment, error: apptErr } = await supabase
        .from("crm_appointments")
        .insert({
          workspace_id: widget.workspace_id,
          lead_id: leadId,
          contact_id: contactId!,
          assigned_to: selectedMemberId,
          title: widget.name,
          description: widget.description || `Agendamento via widget: ${widget.name}`,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          duration_minutes: widget.duration_minutes,
          status: "scheduled",
          meeting_type: "daily",
          scheduling_widget_id: widget_id,
          widget_qualification: widgetQualification,
          // Analise configurada no widget avalia a transcricao desta reuniao
          analysis_playbook_id: widget.analysis_playbook_id ?? null,
        })
        .select("id").single();

      if (apptErr || !appointment) {
        console.error("[schedule-widget] crm_appointments INSERT failed:", {
          error: apptErr,
          payload: { workspace_id: widget.workspace_id, lead_id: leadId, contact_id: contactId, assigned_to: selectedMemberId, start_time: startTime.toISOString(), end_time: endTime.toISOString(), scheduling_widget_id: widget_id },
        });
        return new Response(JSON.stringify({ error: "Failed to create appointment" + (apptErr?.message ? ": " + apptErr.message : "") }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let meetingLink: string | null = null;
      try {
        const dailyRes = await fetch(`${supabaseUrl}/functions/v1/daily-room`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          body: JSON.stringify({ action: "create", workspace_id: widget.workspace_id, appointment_id: appointment.id })
        });
        const dailyData = await dailyRes.json();
        if (dailyData.room_url) {
          meetingLink = `https://nexus.dnia.ai/m/${appointment.id}`;
        }
      } catch (err) {
        console.error("[schedule-widget] Error creating Daily room:", err);
      }

      // Helper: render template vars {{nome}} {{data}} {{hora}} {{link_reuniao}} {{responsavel}}
      //                             {{email}} {{whatsapp}} {{empresa}} {{widget}}
      // Definido aqui (antes do evento do Calendar) porque titulo/descricao do evento,
      // e-mail e WhatsApp de confirmacao compartilham a mesma interpolacao.
      const formattedDate = startTime.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
      const formattedTime = startTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });

      let responsavelName = '';
      let memberProfileFull: { name?: string | null; email?: string | null } | null = null;
      try {
        const { data: mp } = await supabase.from("profiles").select("name, email").eq("id", selectedMemberId).single();
        memberProfileFull = mp;
        responsavelName = mp?.name || '';
      } catch (_e) { /* ignore */ }

      const templateVars: Record<string, string> = {
        nome: name || '',
        data: formattedDate,
        hora: formattedTime,
        link_reuniao: meetingLink || '',
        responsavel: responsavelName,
        email: email || '',
        whatsapp: whatsapp || '',
        empresa: (body.company as string | undefined)?.trim() || '',
        widget: widget.name || '',
      };
      const renderTemplate = (tpl: string | null | undefined) =>
        (tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => templateVars[k] ?? '');

      // ===== EVENTO NO GOOGLE CALENDAR =====
      const defaultEventTitle = `${widget.name} - ${name}`;
      const defaultEventDescription = `Agendamento via widget\nContato: ${name}\nE-mail: ${email}\nWhatsApp: ${whatsapp}${meetingLink ? `\nLink: ${meetingLink}` : ''}`;
      const calTitleTpl = (widget as { calendar_event_title_template?: string | null }).calendar_event_title_template;
      const calDescTpl = (widget as { calendar_event_description_template?: string | null }).calendar_event_description_template;

      const renderedEventTitle = calTitleTpl ? renderTemplate(calTitleTpl).trim() : '';
      const renderedEventDescription = calDescTpl ? renderTemplate(calDescTpl).trim() : '';
      const eventTitle = renderedEventTitle || defaultEventTitle;
      const eventDescription = renderedEventDescription || defaultEventDescription;

      try {
        await fetch(`${supabaseUrl}/functions/v1/google-calendar-create-event`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
          body: JSON.stringify({
            workspace_id: widget.workspace_id,
            appointment_id: appointment.id,
            title: eventTitle,
            description: eventDescription,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            attendee_email: email,
            calendar_owner_id: selectedMemberId,
            create_meet_link: false,
          })
        });
      } catch (err) {
        console.error("[schedule-widget] Error creating Google Calendar event:", err);
      }

      await supabase.from("crm_lead_activities").insert({
        workspace_id: widget.workspace_id,
        lead_id: leadId,
        appointment_id: appointment.id,
        title: `Reunião: ${widget.name}`,
        type: "meeting",
        scheduled_at: startTime.toISOString(),
        duration_minutes: widget.duration_minutes,
        assigned_to: selectedMemberId,
        status: "pending",
        description: `Agendamento via widget por ${name} (${email})`,
        analysis_playbook_id: widget.analysis_playbook_id ?? null,
      });

      // Mover lead para "MQL - Reunião agendada"
      try {
        // 1ª tentativa: nome exato
        let { data: mqlStage } = await supabase
          .from("crm_pipeline_stages")
          .select("id")
          .eq("workspace_id", widget.workspace_id)
          .eq("name", "MQL - Reunião agendada")
          .maybeSingle();

        // 2ª tentativa: ilike '%mql%reuni%'
        if (!mqlStage) {
          const { data } = await supabase
            .from("crm_pipeline_stages")
            .select("id")
            .eq("workspace_id", widget.workspace_id)
            .ilike("name", "%mql%reuni%")
            .order("order", { ascending: true })
            .limit(1)
            .maybeSingle();
          mqlStage = data;
        }

        // 3ª tentativa: ilike '%reuni%'
        if (!mqlStage) {
          const { data } = await supabase
            .from("crm_pipeline_stages")
            .select("id")
            .eq("workspace_id", widget.workspace_id)
            .ilike("name", "%reuni%")
            .order("order", { ascending: true })
            .limit(1)
            .maybeSingle();
          mqlStage = data;
        }

        // Reabre o card se estiver perdido/excluído (independente de troca de estágio)
        await reopenLeadIfClosed(supabase, leadId, "Lead reativado automaticamente - nova reunião agendada via widget de agenda");

        if (mqlStage) {
          const moved = await moveLeadForwardOnly(
            supabase,
            leadId,
            mqlStage.id,
            "Reunião agendada automaticamente via widget de agenda",
          );
          if (moved) console.log("[schedule-widget] Lead movido para MQL - Reunião agendada:", leadId);
        } else {
          console.warn("[schedule-widget] Estágio 'MQL - Reunião agendada' não encontrado no workspace", widget.workspace_id);
        }
      } catch (err) {
        console.error("[schedule-widget] Erro ao mover lead para MQL:", err);
      }

      // Notify dnMarketing about the scheduling widget booking (non-blocking)
      try {
        const notifyPromise = fetch(`${supabaseUrl}/functions/v1/dnmarketing-notify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            contact_id: contactId,
            event_type: "scheduling_widget_booked",
            title: `Agendamento: ${widget.name}`,
            description: `${name} agendou "${widget.name}" para ${date} às ${time}`,
            metadata: {
              widget_id: widget_id,
              widget_name: widget.name,
              appointment_id: appointment.id,
              date,
              time,
              duration_minutes: widget.duration_minutes,
              meeting_link: meetingLink,
              assigned_to: selectedMemberId,
              lead_id: leadId,
            },
          }),
        }).then(async (r) => {
          const txt = await r.text().catch(() => "");
          console.log(`[schedule-widget][book] dnmarketing-notify status=${r.status} body=${txt.slice(0, 200)}`);
        }).catch((err) => console.error("[schedule-widget][book] dnmarketing-notify error:", err));
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(notifyPromise);
        }
      } catch (err) {
        console.error("[schedule-widget] Error notifying dnMarketing:", err);
      }


      const emailEnabled = (widget as { confirmation_email_enabled?: boolean }).confirmation_email_enabled !== false;
      const emailSubjectTpl = (widget as { confirmation_email_subject?: string | null }).confirmation_email_subject;
      const emailBodyTpl = (widget as { confirmation_email_template?: string | null }).confirmation_email_template;
      const waEnabled = (widget as { confirmation_whatsapp_enabled?: boolean }).confirmation_whatsapp_enabled === true;
      const waTemplate = (widget as { confirmation_whatsapp_template?: string | null }).confirmation_whatsapp_template;

      // ===== E-MAIL =====
      try {
        const { data: companyData } = await supabase.from("companies").select("name").eq("id", companyId).single();

        if (emailEnabled) {
          await fetch(`${supabaseUrl}/functions/v1/send-appointment-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify({
              type: "confirmation",
              email: email,
              contactName: name,
              appointmentTitle: widget.name,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              meetingLink,
              assigneeName: responsavelName,
              companyName: companyData?.name,
              company_id: companyId,
              recipientType: "contact",
              customSubject: emailSubjectTpl ? renderTemplate(emailSubjectTpl) : undefined,
              customBody: emailBodyTpl ? renderTemplate(emailBodyTpl) : undefined,
            })
          });
        } else {
          console.log("[schedule-widget] confirmation_email_enabled=false, skipping contact email");
        }

        // Always notify the assignee (internal email, uses system template)
        if (memberProfileFull?.email) {
          await fetch(`${supabaseUrl}/functions/v1/send-appointment-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify({
              type: "confirmation",
              email: memberProfileFull.email,
              contactName: memberProfileFull.name,
              appointmentTitle: widget.name,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              meetingLink,
              leadName: name,
              companyName: companyData?.name,
              company_id: companyId,
              recipientType: "assignee",
            })
          });
        }
      } catch (err) {
        console.error("[schedule-widget] Error sending emails:", err);
      }

      // ===== WHATSAPP =====
      if (waEnabled) {
        try {
          const { data: connectionWorkspace } = await supabase
            .from("connection_workspaces")
            .select("connection_id, connection_type")
            .eq("workspace_id", widget.workspace_id)
            .eq("connection_type", "zapi")
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (connectionWorkspace && normalizedPhone) {
            const whatsappMessage = renderTemplate(waTemplate) ||
              `Olá ${name}! Sua reunião "${widget.name}" foi confirmada para ${formattedDate} às ${formattedTime}.${meetingLink ? `\n\nLink: ${meetingLink}` : ''}`;

            if (connectionWorkspace.connection_type === 'zapi') {
              const { data: conn } = await supabase.from("zapi_connections").select("id").eq("id", connectionWorkspace.connection_id).maybeSingle();
              if (conn) {
                // 1) Garantir que existe um chat lead (leads) para esse telefone/workspace
                let chatLeadId: string | null = null;
                try {
                  const { data: chatLead } = await supabase
                    .from("leads")
                    .select("id")
                    .eq("phone", normalizedPhone)
                    .eq("workspace_id", widget.workspace_id)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  if (chatLead?.id) {
                    chatLeadId = chatLead.id;
                  } else {
                    const { data: newLead, error: leadErr } = await supabase
                      .from("leads")
                      .insert({
                        phone: normalizedPhone,
                        workspace_id: widget.workspace_id,
                        name,
                        source: `Agendamento Widget:${widget.id}`,
                        status: "needs_human",
                        contact_id: contactId,
                      })
                      .select("id")
                      .single();

                    if (leadErr) {
                      // Possível race: tenta reler
                      const { data: retryLead } = await supabase
                        .from("leads")
                        .select("id")
                        .eq("phone", normalizedPhone)
                        .eq("workspace_id", widget.workspace_id)
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                      chatLeadId = retryLead?.id ?? null;
                      console.warn(`[schedule-widget] leads INSERT falhou (${leadErr.message}); reused=${chatLeadId}`);
                    } else {
                      chatLeadId = newLead?.id ?? null;
                      console.log(`[schedule-widget] chat lead criado id=${chatLeadId} phone=${normalizedPhone}`);
                    }
                  }
                } catch (ensureErr) {
                  console.error("[schedule-widget] Erro ao garantir chat lead:", ensureErr);
                }

                // 2) Enviar via Z-API e capturar messageId
                console.log(`[schedule-widget] Sending confirmation WhatsApp via Z-API connection=${conn.id} phone=${normalizedPhone}`);
                const waResponse = await fetch(`${supabaseUrl}/functions/v1/zapi-send`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
                  body: JSON.stringify({ connection_id: conn.id, phone: normalizedPhone, message: whatsappMessage })
                });
                const waResponseBody = await waResponse.text().catch(() => "");
                console.log(`[schedule-widget] WhatsApp confirmation response: status=${waResponse.status} body=${waResponseBody.slice(0, 300)}`);

                let externalMessageId: string | null = null;
                try {
                  const parsed = JSON.parse(waResponseBody);
                  // IMPORTANTE: zapi-send retorna { messageId: <UUID interno de zapi_messages>, zapiMessageId: <ID hex da Z-API> }.
                  // Precisamos do ID hex da Z-API para que o webhook MessageStatusCallback consiga atualizar o status
                  // (delivered/read). Usar parsed.messageId (UUID) quebra o tracking dos checks no chat ao vivo.
                  externalMessageId = parsed?.zapiMessageId || parsed?.zaapId || parsed?.data?.zapiMessageId || parsed?.data?.messageId || null;
                } catch (_) {
                  // resposta não-JSON, ignora
                }

                // 3) Registrar mensagem no chat com status + external_message_id para tracking
                if (chatLeadId) {
                  const ok = waResponse.ok;
                  const { error: msgErr } = await supabase.from("messages").insert({
                    lead_id: chatLeadId,
                    workspace_id: widget.workspace_id,
                    sender_type: "ai",
                    content: whatsappMessage,
                    media_type: "confirmation", // evita re-disparo do trigger notify_whatsapp_on_outbound_message
                    external_message_id: externalMessageId,
                    delivery_status: ok ? "sent" : "failed",
                  });
                  if (msgErr) {
                    console.warn(`[schedule-widget] Falha ao registrar mensagem no chat lead=${chatLeadId}: ${msgErr.message}`);
                  } else {
                    console.log(`[schedule-widget] Mensagem de confirmação registrada lead=${chatLeadId} ext_id=${externalMessageId} status=${ok ? "sent" : "failed"}`);
                  }
                } else {
                  console.warn(`[schedule-widget] chatLeadId indisponível, pulando registro em messages`);
                }
              } else {
                console.warn(`[schedule-widget] Z-API connection not found for id=${connectionWorkspace.connection_id}`);
              }
            }
          } else {
            console.warn(`[schedule-widget] Skipping WhatsApp confirmation: hasZapiConnection=${Boolean(connectionWorkspace)} hasPhone=${Boolean(normalizedPhone)}`);
          }
        } catch (err) {
          console.error("[schedule-widget] Error sending WhatsApp:", err);
        }
      } else {
        console.log("[schedule-widget] confirmation_whatsapp_enabled=false, skipping WhatsApp");
      }


      // Meta Conversions API - Schedule event (non-blocking)
      try {
        let pixelId: string | null = null;
        const pixelSource = "company";

        if (companyId) {
          const { data: company } = await supabase
            .from("companies")
            .select("meta_pixel_id, meta_access_token")
            .eq("id", companyId)
            .maybeSingle();
          if (company?.meta_pixel_id && company?.meta_access_token) {
            pixelId = company.meta_pixel_id;
          }
        }

        if (pixelId && companyId) {
          const capiPayload = {
            event_name: "Schedule",
            lead_id: leadId,
            contact_id: contactId,
            workspace_id: widget.workspace_id,
            pixel_id: pixelId,
            company_id: companyId,
            custom_data: {
              widget_id: widget_id,
              widget_name: widget.name,
              appointment_date: date,
              appointment_time: time,
              duration_minutes: widget.duration_minutes,
              currency: "BRL",
              value: 0,
            },
            source_url: req.headers.get("referer") || null,
          };

          console.log(`[schedule-widget] META CAPI request: pixel_id=${pixelId} source=${pixelSource} event=Schedule contact=${contactId} lead=${leadId} custom_data=${JSON.stringify(capiPayload.custom_data)}`);

          const capiPromise = fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
            body: JSON.stringify(capiPayload),
          })
            .then(async (r) => {
              const txt = await r.text().catch(() => "");
              if (r.ok) {
                console.log(`[schedule-widget] META CAPI response: status=${r.status} body=${txt.slice(0, 300)}`);
              } else {
                console.error(`[schedule-widget] META CAPI failed: status=${r.status} body=${txt.slice(0, 300)}`);
              }
            })
            .catch((err) => console.error("[schedule-widget] META CAPI fetch error:", err));

          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            EdgeRuntime.waitUntil(capiPromise);
          }
        } else {
          console.log(`[schedule-widget] Skipping META CAPI: pixelId=${pixelId} companyId=${companyId} (configure meta_pixel_id + meta_access_token in companies)`);
        }
      } catch (err) {
        console.error("[schedule-widget] Error dispatching META CAPI Schedule:", err);
      }

      // Conversão dn.marketing é registrada via trigger trg_notify_dnmarketing_stage_conversion
      // quando o lead entra em "MQL - Reunião agendada" (tipo: mql_reuniao_agendada).
      // Não enviamos mais o evento "schedule" aqui para evitar duplicidade.



      return new Response(JSON.stringify({
        success: true,
        appointment_id: appointment.id,
        meeting_link: meetingLink,
        date,
        time,
        duration_minutes: widget.duration_minutes,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || "no stack" : "no stack";
    console.error("[schedule-widget] UNCAUGHT Error:", msg);
    console.error("[schedule-widget] UNCAUGHT Stack:", stack);
    return new Response(JSON.stringify({ error: msg, stack }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
