import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGoogleCredentials, GoogleOAuthError } from "../_shared/googleCredentials.ts";
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { getSchedulingLoad } from "../_shared/routing/load.ts";
import { getCardOwner } from "../_shared/routing/owner.ts";
import { selectAssignee } from "../_shared/routing/select.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScheduleRequest {
  action?: "schedule" | "cancel" | "reschedule" | "check" | "info" | "list" | "add_attendee"; // Action type
  lead_id: string;
  workspace_id: string;
  agent_id: string;
  assigned_to?: string;
  title?: string;
  description?: string;
  preferred_date?: string;
  preferred_time?: string;
  duration_minutes?: number;
  reason?: string; // For cancel/reschedule
  additional_attendees?: string[]; // Additional email addresses to invite
}

interface TimeSlot {
  date: string;
  time: string;
  datetime: string;
}

// Extended slot that includes agent information
interface AgentSlot extends TimeSlot {
  agent_id: string;
  agent_name: string;
}

interface ScheduleResponse {
  success: boolean;
  appointment_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  meeting_link?: string;
  suggested_alternatives?: { date: string; time: string; reason: string }[];
  needs_selection?: boolean;
  message: string;
}

// Get timezone offset in hours for a given timezone
// Returns the number of hours to ADD to local time to get UTC
// Example: São Paulo (UTC-3) returns 3, so 09:00 local + 3 = 12:00 UTC
function getTimezoneOffsetHours(timezone: string): number {
  // Use a reference date to calculate the offset
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  
  // Offset = UTC - local (if São Paulo is 3 hours behind UTC, offset = 3)
  const offsetMs = utcDate.getTime() - tzDate.getTime();
  return offsetMs / (1000 * 60 * 60);
}

// Convert local time (e.g., "09:00" in agent's timezone) to UTC Date
function localTimeToUTC(date: Date, hour: number, minute: number, timezone: string): Date {
  const offset = getTimezoneOffsetHours(timezone);
  const utcDate = new Date(date);
  // To convert local to UTC: add the offset
  // e.g., 09:00 São Paulo (UTC-3) -> 09:00 + 3 = 12:00 UTC
  utcDate.setUTCHours(hour + offset, minute, 0, 0);
  return utcDate;
}

// Format a UTC Date to local time string in a given timezone
function formatTimeInTimezone(date: Date, timezone: string): string {
  return date.toLocaleString('pt-BR', { 
    timeZone: timezone, 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

// Format a UTC Date to local date string in a given timezone
function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format
  return parts;
}

// Sort slots by temporal proximity (closest first)
function sortSlotsByProximity(slots: AgentSlot[]): AgentSlot[] {
  const now = new Date();
  
  return [...slots].sort((a, b) => {
    const dateA = new Date(`${a.date}T${a.time}:00`);
    const dateB = new Date(`${b.date}T${b.time}:00`);
    return dateA.getTime() - dateB.getTime();
  });
}

// Refresh Google access token (uses per-company credentials)
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

    if (!response.ok) {
      console.error('[SCHEDULE] Failed to refresh token:', await response.text());
      return null;
    }

    const tokens = await response.json();
    return {
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      console.warn(`[SCHEDULE] Google OAuth indisponivel: ${error.code} - ${error.userMessage}`);
    } else {
      console.error('[SCHEDULE] Error refreshing token:', error);
    }
    return null;
  }
}

// Get busy slots from Google Calendar for a specific user
async function getGoogleCalendarBusySlots(
  supabase: any,
  workspaceId: string,
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<{ start: Date; end: Date }[]> {
  console.log("[SCHEDULE] Fetching Google Calendar events for user:", userId);
  
  // Get Google Calendar integration for this user
  const { data: integration, error } = await supabase
    .from('crm_google_calendar_integration')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_enabled', true)
    .maybeSingle();
  
  if (error || !integration) {
    console.log("[SCHEDULE] No Google Calendar integration for user:", userId);
    return [];
  }
  
  // Check if token needs refresh
  let accessToken = integration.google_access_token;
  if (new Date(integration.token_expires_at) <= new Date()) {
    console.log('[SCHEDULE] Token expired for user, refreshing...', userId);
    const refreshed = await refreshGoogleAccessToken(integration.google_refresh_token, workspaceId);
    if (!refreshed) {
      console.error('[SCHEDULE] Failed to refresh token for user:', userId);
      return [];
    }
    
    // Update tokens in database
    await supabase
      .from('crm_google_calendar_integration')
      .update({
        google_access_token: refreshed.access_token,
        token_expires_at: refreshed.expires_at,
      })
      .eq('id', integration.id);
    
    accessToken = refreshed.access_token;
  }
  
  // Fetch events from Google Calendar
  const calendarId = integration.google_calendar_id || 'primary';
  const timeMin = startDate.toISOString();
  const timeMax = endDate.toISOString();
  
  try {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
      `timeMin=${encodeURIComponent(timeMin)}&` +
      `timeMax=${encodeURIComponent(timeMax)}&` +
      `singleEvents=true&` +
      `orderBy=startTime`;
    
    console.log("[SCHEDULE] Fetching events from Google Calendar:", calendarId);
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SCHEDULE] Failed to fetch Google events:', response.status, errorText);
      return [];
    }
    
    const data = await response.json();
    const events = data.items || [];
    
    console.log("[SCHEDULE] Found", events.length, "events in Google Calendar for user:", userId);
    
    // Convert events to busy slots
    const busySlots: { start: Date; end: Date }[] = [];
    
    for (const event of events) {
      // Skip cancelled events
      if (event.status === 'cancelled') continue;
      
      // Skip all-day events (they have date instead of dateTime)
      if (!event.start?.dateTime || !event.end?.dateTime) continue;
      
      busySlots.push({
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime)
      });
    }
    
    console.log("[SCHEDULE] Processed", busySlots.length, "busy slots from Google Calendar");
    return busySlots;
    
  } catch (error) {
    console.error('[SCHEDULE] Error fetching Google Calendar events:', error);
    return [];
  }
}

const DEFAULT_SLOT_STEP_MINUTES = 15;

async function getWorkspaceSlotStepMinutes(supabase: any, workspaceId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("workspace_meeting_settings")
      .select("slot_step_minutes")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const step = data?.slot_step_minutes;
    return step && step > 0 ? step : DEFAULT_SLOT_STEP_MINUTES;
  } catch (_e) {
    return DEFAULT_SLOT_STEP_MINUTES;
  }
}

async function getWorkspaceHolidaySet(supabase: any, workspaceId: string): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("crm_holidays")
      .select("date")
      .eq("workspace_id", workspaceId);
    return new Set(((data || []) as Array<{ date: string }>).map((h) => h.date));
  } catch (_e) {
    return new Set<string>();
  }
}

function roundUpToStepInTz(date: Date, timezone: string, stepMinutes: number = DEFAULT_SLOT_STEP_MINUTES): Date {
  const step = stepMinutes > 0 ? stepMinutes : DEFAULT_SLOT_STEP_MINUTES;
  const offset = getTimezoneOffsetHours(timezone);
  const local = new Date(date.getTime() - offset * 60 * 60 * 1000);
  const minutes = local.getUTCMinutes();
  const remainder = minutes % step;
  if (remainder === 0 && local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0) {
    return date;
  }
  local.setUTCMinutes(minutes + (step - remainder), 0, 0);
  return new Date(local.getTime() + offset * 60 * 60 * 1000);
}

// Get available time slots for a specific agent
async function getAgentSlots(
  supabase: any,
  workspaceId: string,
  agentId: string,
  agentName: string,
  preferredDate: string | null,
  daysToCheck: number = 7
): Promise<AgentSlot[]> {
  const { data: agentCalendar } = await supabase
    .from("crm_agent_calendars")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .maybeSingle();
  
  const calendarSettings = {
    work_start_time: agentCalendar?.work_start_time || "09:00",
    work_end_time: agentCalendar?.work_end_time || "18:00",
    work_days: agentCalendar?.work_days || ["MON", "TUE", "WED", "THU", "FRI"],
    min_interval_between_appointments: agentCalendar?.min_interval_between_appointments || 0,
    default_appointment_duration: agentCalendar?.default_appointment_duration || 30,
    timezone: agentCalendar?.timezone || "America/Sao_Paulo"
  };
  
  const slotStepMinutes = await getWorkspaceSlotStepMinutes(supabase, workspaceId);
  const holidaySet = await getWorkspaceHolidaySet(supabase, workspaceId);

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysToCheck);
  
  // Get existing appointments FOR THIS SPECIFIC AGENT (local database)
  const { data: existingAppointments } = await supabase
    .from("crm_appointments")
    .select("start_time, end_time")
    .eq("workspace_id", workspaceId)
    .eq("assigned_to", agentId)
    .gte("start_time", startDate.toISOString())
    .lte("start_time", endDate.toISOString())
    .in("status", ["scheduled", "confirmed"]);
  
  const localBusySlots = (existingAppointments || []).map((apt: any) => ({
    start: new Date(apt.start_time),
    end: new Date(apt.end_time)
  }));
  
  console.log("[SCHEDULE] Local busy slots for agent", agentName, ":", localBusySlots.length);
  
  // Get busy slots from Google Calendar
  const googleBusySlots = await getGoogleCalendarBusySlots(
    supabase,
    workspaceId,
    agentId,
    startDate,
    endDate
  );
  
  console.log("[SCHEDULE] Google Calendar busy slots for agent", agentName, ":", googleBusySlots.length);
  
  // Combine all busy slots
  const allBusySlots = [...localBusySlots, ...googleBusySlots];
  console.log("[SCHEDULE] Total busy slots for agent", agentName, ":", allBusySlots.length);
  
  const availableSlots: AgentSlot[] = [];
  const dayMap: Record<string, number> = {
    "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6
  };
  const workDayNumbers = calendarSettings.work_days.map((d: string) => dayMap[d]);
  
  const [startHour, startMin] = calendarSettings.work_start_time.split(":").map(Number);
  const [endHour, endMin] = calendarSettings.work_end_time.split(":").map(Number);
  const slotDuration = calendarSettings.default_appointment_duration;
  const interval = calendarSettings.min_interval_between_appointments;
  const timezone = calendarSettings.timezone;
  
  // Log timezone info for debugging
  const tzOffset = getTimezoneOffsetHours(timezone);
  console.log(`[SCHEDULE] Timezone: ${timezone}, Offset to UTC: +${tzOffset} hours`);
  console.log(`[SCHEDULE] Work hours: ${calendarSettings.work_start_time} - ${calendarSettings.work_end_time} (local time)`);
  
  for (let dayOffset = 0; dayOffset < daysToCheck; dayOffset++) {
    const checkDate = new Date();
    checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);
    checkDate.setUTCHours(12, 0, 0, 0); // Set to noon UTC to avoid date boundary issues
    
    // Get the day of week in the agent's timezone (stable method, no re-parsing)
    const weekdayShort = checkDate.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' }).toUpperCase().slice(0, 3);
    const dayNameToNumber: Record<string, number> = { "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6 };
    const dayNum = dayNameToNumber[weekdayShort] ?? -1;
    if (!workDayNumbers.includes(dayNum)) continue;
    
    // Get the date string in agent's timezone
    const checkDateStr = formatDateInTimezone(checkDate, timezone);
    
    if (preferredDate) {
      if (preferredDate !== checkDateStr) continue;
    }

    if (holidaySet.has(checkDateStr)) {
      console.log(`[SCHEDULE] Skipping holiday ${checkDateStr}`);
      continue;
    }
    
    // Convert work start/end times from local timezone to UTC
    const dayStart = localTimeToUTC(checkDate, startHour, startMin, timezone);
    const dayEnd = localTimeToUTC(checkDate, endHour, endMin, timezone);
    
    console.log(`[SCHEDULE] Day ${checkDateStr}: Work hours in UTC: ${dayStart.toISOString()} - ${dayEnd.toISOString()}`);
    
    let currentSlot = new Date(dayStart);
    
    while (currentSlot < dayEnd) {
      const slotEnd = new Date(currentSlot);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);
      
      if (slotEnd > dayEnd) break;
      
      // Skip slots in the past + 10min buffer for agent preparation
      const minTime = new Date();
      minTime.setMinutes(minTime.getMinutes() + 10);
      if (currentSlot <= minTime) {
        let next = roundUpToStepInTz(minTime, timezone, slotStepMinutes);
        if (next <= currentSlot) next = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
        currentSlot = next;
        continue;
      }
      
      // Check conflicts with ALL busy slots (local appointments + Google Calendar)
      const conflict = allBusySlots.find((busy: any) => {
        const conflictCheck = currentSlot < busy.end && slotEnd > busy.start;
        if (conflictCheck) {
          const slotTimeLocal = formatTimeInTimezone(currentSlot, timezone);
          const busyStartLocal = formatTimeInTimezone(busy.start, timezone);
          const busyEndLocal = formatTimeInTimezone(busy.end, timezone);
          console.log(`[SCHEDULE] Conflict detected: Slot ${slotTimeLocal} conflicts with busy ${busyStartLocal}-${busyEndLocal}`);
        }
        return conflictCheck;
      });
      
      if (!conflict) {
        // Format date and time in agent's timezone for display
        const dateStr = formatDateInTimezone(currentSlot, timezone);
        const timeStr = formatTimeInTimezone(currentSlot, timezone);
        
        availableSlots.push({
          date: dateStr,
          time: timeStr,
          datetime: currentSlot.toISOString(),
          agent_id: agentId,
          agent_name: agentName
        });
        currentSlot = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
      } else {
        let next = new Date(conflict.end.getTime() + interval * 60_000);
        next = roundUpToStepInTz(next, timezone, slotStepMinutes);
        if (next <= currentSlot) {
          next = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
        }
        currentSlot = next;
      }
    }
  }
  
  console.log("[SCHEDULE] Available slots for agent", agentName, ":", availableSlots.length);
  return availableSlots;
}

// Read agent_tools config.allowed_attendants for the calling agent (schedule_appointment tool)
async function getAllowedAttendantsForAgent(
  supabase: any,
  workspaceId: string,
  agentId: string | null | undefined
): Promise<string[] | null> {
  if (!agentId) return null;
  const { data, error } = await supabase
    .from("agent_tools")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .eq("tool_name", "schedule_appointment")
    .eq("is_enabled", true)
    .maybeSingle();
  if (error) {
    console.warn("[SCHEDULE] Could not load allowed_attendants for agent", agentId, error.message);
    return null;
  }
  const allowed = (data?.config as any)?.allowed_attendants;
  return Array.isArray(allowed) && allowed.length > 0 ? allowed : null;
}

// Get available slots from ALL configured agents
async function getAvailableSlotsAllAgents(
  supabase: any,
  workspaceId: string,
  preferredDate: string | null,
  daysToCheck: number = 7,
  allowedAttendants?: string[] | null
): Promise<AgentSlot[]> {
  console.log("[SCHEDULE] Getting available slots from ALL agents for workspace:", workspaceId);
  if (allowedAttendants && allowedAttendants.length > 0) {
    console.log("[SCHEDULE] Restricting to allowed attendants:", allowedAttendants);
  }
  
  // First try to get agents from crm_agent_calendars
  const { data: agentCalendars, error: calError } = await supabase
    .from("crm_agent_calendars")
    .select("agent_id")
    .eq("workspace_id", workspaceId);
  
  if (calError) {
    console.error("[SCHEDULE] Error fetching agent calendars:", calError);
  }
  
  let agentIds: string[] = [];
  
  if (agentCalendars && agentCalendars.length > 0) {
    agentIds = agentCalendars.map((c: any) => c.agent_id);
    console.log("[SCHEDULE] Found", agentIds.length, "agents in crm_agent_calendars:", agentIds);
  } else {
    // FALLBACK: Use crm_google_calendar_integration to find agents
    console.log("[SCHEDULE] No crm_agent_calendars found, checking Google Calendar integrations...");
    
    const { data: googleIntegrations, error: intError } = await supabase
      .from("crm_google_calendar_integration")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("is_enabled", true);
    
    if (intError) {
      console.error("[SCHEDULE] Error fetching Google integrations:", intError);
      return [];
    }
    
    if (googleIntegrations && googleIntegrations.length > 0) {
      agentIds = googleIntegrations.map((i: any) => i.user_id);
      console.log("[SCHEDULE] Found", agentIds.length, "agents from Google Calendar integrations:", agentIds);
    } else {
      console.log("[SCHEDULE] No agents found in either source");
      return [];
    }
  }

  // Apply per-agent allow-list (configured in agent_tools.config.allowed_attendants)
  if (allowedAttendants && allowedAttendants.length > 0) {
    const allowedSet = new Set(allowedAttendants);
    const filtered = agentIds.filter((id) => allowedSet.has(id));
    if (filtered.length === 0) {
      console.log("[SCHEDULE] No overlap between configured calendars and allowed_attendants; keeping all to avoid empty result");
    } else {
      agentIds = filtered;
      console.log("[SCHEDULE] After allowed_attendants filter:", agentIds.length, "agents:", agentIds);
    }
  }
  
  // Get agent names
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", agentIds);
  
  const agentNameMap = new Map<string, string>();
  for (const profile of profiles || []) {
    agentNameMap.set(profile.id, profile.name || "Atendente");
  }
  
  // Get slots from all agents in parallel
  const allSlotsPromises = agentIds.map((agentId: string) => 
    getAgentSlots(
      supabase,
      workspaceId,
      agentId,
      agentNameMap.get(agentId) || "Atendente",
      preferredDate,
      daysToCheck
    )
  );
  
  const allSlotsArrays = await Promise.all(allSlotsPromises);
  const allSlots = allSlotsArrays.flat();
  
  console.log("[SCHEDULE] Total slots from all agents:", allSlots.length);
  
  // Sort by temporal proximity (closest first)
  return sortSlotsByProximity(allSlots);
}

// Seleciona o responsável pelo slot usando a configuração central de roteamento
// (spec §7). A elegibilidade (quem tem o slot livre) já chegou resolvida em
// availableAgentSlots — aqui é só a decisão.
async function selectBestAgentForSlot(
  supabase: any,
  workspaceId: string,
  availableAgentSlots: AgentSlot[],
  preferredDate: string,
  preferredTime: string,
  leadId: string | null
): Promise<AgentSlot | null> {
  const matchingSlots = availableAgentSlots.filter(
    slot => slot.date === preferredDate && slot.time === preferredTime
  );
  if (matchingSlots.length === 0) return null;
  if (matchingSlots.length === 1) {
    console.log("[SCHEDULE] Only one agent available for slot:", matchingSlots[0].agent_name);
    return matchingSlots[0];
  }

  const config = await loadRoutingConfig(supabase, workspaceId);

  // Contato que já tem card volta para o responsável dele (spec §7 passo 3) —
  // paridade com o comportamento que o widget já tinha.
  let ownerId: string | null = null;
  if (config.respect_card_owner && leadId) {
    const { data: leadRow } = await supabase
      .from("leads").select("contact_id").eq("id", leadId).maybeSingle();
    ownerId = await getCardOwner(supabase, workspaceId, leadRow?.contact_id ?? null);
  }

  const agentIds = [...new Set(matchingSlots.map(s => s.agent_id))];
  const loads = await getSchedulingLoad(supabase, workspaceId, agentIds, config.scheduling_load_window_days);
  const chosen = selectAssignee(agentIds, { strategy: config.scheduling_strategy, loads, ownerId });

  const selectedSlot = matchingSlots.find(s => s.agent_id === chosen);
  console.log("[SCHEDULE] Selected agent:", selectedSlot?.agent_name, "strategy:", config.scheduling_strategy);
  return selectedSlot || matchingSlots[0];
}

// Legacy function for backward compatibility (uses single agent)
async function getAvailableSlots(
  supabase: any,
  workspaceId: string,
  assignedTo: string | null,
  preferredDate: string | null,
  daysToCheck: number = 7
): Promise<TimeSlot[]> {
  console.log("[SCHEDULE] Getting available slots for workspace:", workspaceId);
  
  let calendarSettings = {
    work_start_time: "09:00",
    work_end_time: "18:00",
    work_days: ["MON", "TUE", "WED", "THU", "FRI"],
    min_interval_between_appointments: 0,
    default_appointment_duration: 30,
    timezone: "America/Sao_Paulo"
  };
  
  if (assignedTo) {
    const { data: agentCalendar } = await supabase
      .from("crm_agent_calendars")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("agent_id", assignedTo)
      .maybeSingle();
    
    if (agentCalendar) {
      calendarSettings = {
        work_start_time: agentCalendar.work_start_time || "09:00",
        work_end_time: agentCalendar.work_end_time || "18:00",
        work_days: agentCalendar.work_days || ["MON", "TUE", "WED", "THU", "FRI"],
        min_interval_between_appointments: agentCalendar.min_interval_between_appointments || 0,
        default_appointment_duration: agentCalendar.default_appointment_duration || 30,
        timezone: agentCalendar.timezone || "America/Sao_Paulo"
      };
    }
  }
  
  const slotStepMinutes = await getWorkspaceSlotStepMinutes(supabase, workspaceId);
  const holidaySet = await getWorkspaceHolidaySet(supabase, workspaceId);

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysToCheck);
  
  const { data: existingAppointments } = await supabase
    .from("crm_appointments")
    .select("start_time, end_time")
    .eq("workspace_id", workspaceId)
    .gte("start_time", startDate.toISOString())
    .lte("start_time", endDate.toISOString())
    .in("status", ["scheduled", "confirmed"]);
  
  const busySlots = (existingAppointments || []).map((apt: any) => ({
    start: new Date(apt.start_time),
    end: new Date(apt.end_time)
  }));
  
  const availableSlots: TimeSlot[] = [];
  const dayMap: Record<string, number> = {
    "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6
  };
  const workDayNumbers = calendarSettings.work_days.map(d => dayMap[d]);
  
  const [startHour, startMin] = calendarSettings.work_start_time.split(":").map(Number);
  const [endHour, endMin] = calendarSettings.work_end_time.split(":").map(Number);
  const slotDuration = calendarSettings.default_appointment_duration;
  const interval = calendarSettings.min_interval_between_appointments;
  const timezone = calendarSettings.timezone;
  
  // Log timezone info for debugging
  const tzOffset = getTimezoneOffsetHours(timezone);
  console.log(`[SCHEDULE-LEGACY] Timezone: ${timezone}, Offset to UTC: +${tzOffset} hours`);
  
  for (let dayOffset = 0; dayOffset < daysToCheck; dayOffset++) {
    const checkDate = new Date();
    checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);
    checkDate.setUTCHours(12, 0, 0, 0); // Set to noon UTC to avoid date boundary issues
    
    // Get the day of week in the agent's timezone
    const checkDateInTz = new Date(checkDate.toLocaleString('en-US', { timeZone: timezone }));
    if (!workDayNumbers.includes(checkDateInTz.getDay())) continue;
    
    // Get the date string in agent's timezone
    const checkDateStr = formatDateInTimezone(checkDate, timezone);
    
    if (preferredDate) {
      if (preferredDate !== checkDateStr) continue;
    }

    if (holidaySet.has(checkDateStr)) continue;
    
    // Convert work start/end times from local timezone to UTC
    const dayStart = localTimeToUTC(checkDate, startHour, startMin, timezone);
    const dayEnd = localTimeToUTC(checkDate, endHour, endMin, timezone);
    
    let currentSlot = new Date(dayStart);
    
    while (currentSlot < dayEnd) {
      const slotEnd = new Date(currentSlot);
      slotEnd.setMinutes(slotEnd.getMinutes() + slotDuration);
      
      if (slotEnd > dayEnd) break;
      
      // Skip slots in the past + 10min buffer
      const minTime = new Date(Date.now() + 10 * 60_000);
      if (currentSlot <= minTime) {
        let next = roundUpToStepInTz(minTime, timezone, slotStepMinutes);
        if (next <= currentSlot) next = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
        currentSlot = next;
        continue;
      }
      
      const conflict = busySlots.find((busy: any) => {
        return currentSlot < busy.end && slotEnd > busy.start;
      });
      
      if (!conflict) {
        // Format date and time in agent's timezone for display
        const dateStr = formatDateInTimezone(currentSlot, timezone);
        const timeStr = formatTimeInTimezone(currentSlot, timezone);
        
        availableSlots.push({
          date: dateStr,
          time: timeStr,
          datetime: currentSlot.toISOString()
        });
        currentSlot = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
      } else {
        let next = new Date(conflict.end.getTime() + interval * 60_000);
        next = roundUpToStepInTz(next, timezone, slotStepMinutes);
        if (next <= currentSlot) {
          next = new Date(currentSlot.getTime() + slotStepMinutes * 60_000);
        }
        currentSlot = next;
      }
    }
  }
  
  return availableSlots;
}

// Check if a specific slot is available in AgentSlot array
function isAgentSlotAvailable(availableSlots: AgentSlot[], date: string, time: string): AgentSlot[] {
  return availableSlots.filter(slot => slot.date === date && slot.time === time);
}

// Check if a specific slot is available (legacy)
function isSlotAvailable(availableSlots: TimeSlot[], date: string, time: string): TimeSlot | null {
  return availableSlots.find(slot => slot.date === date && slot.time === time) || null;
}

// Find closest available slots to preferred time (with agent info)
function findClosestAlternativesFromAgentSlots(
  availableSlots: AgentSlot[],
  preferredDate: string,
  preferredTime: string,
  count: number = 3
): AgentSlot[] {
  if (availableSlots.length === 0) return [];
  
  // Slots are already sorted by proximity, just take unique date/time combinations
  const seen = new Set<string>();
  const uniqueSlots: AgentSlot[] = [];
  
  for (const slot of availableSlots) {
    const key = `${slot.date}-${slot.time}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSlots.push(slot);
      if (uniqueSlots.length >= count) break;
    }
  }
  
  return uniqueSlots;
}

// Find closest available slots to preferred time (legacy)
function findClosestAlternatives(
  availableSlots: TimeSlot[],
  preferredDate: string,
  preferredTime: string,
  count: number = 2
): { date: string; time: string; reason: string }[] {
  if (availableSlots.length === 0) return [];
  
  const [prefHour, prefMin] = preferredTime.split(":").map(Number);
  const prefMinutes = prefHour * 60 + prefMin;
  
  // Score slots by closeness to preferred time and date
  const scored = availableSlots.map(slot => {
    const [slotHour, slotMin] = slot.time.split(":").map(Number);
    const slotMinutes = slotHour * 60 + slotMin;
    const timeDiff = Math.abs(slotMinutes - prefMinutes);
    const dateDiff = slot.date === preferredDate ? 0 : 1000; // Prioritize same day
    return { ...slot, score: timeDiff + dateDiff };
  });
  
  // Sort by score and take top N
  scored.sort((a, b) => a.score - b.score);
  
  return scored.slice(0, count).map((slot, idx) => ({
    date: slot.date,
    time: slot.time,
    reason: slot.date === preferredDate 
      ? `Mesmo dia, ${idx === 0 ? "horário mais próximo" : "segunda opção"}` 
      : `Próximo dia disponível`
  }));
}

// Create Google Calendar event
async function createGoogleCalendarEvent(
  supabase: any,
  workspaceId: string,
  appointmentId: string,
  title: string,
  description: string | null,
  startTime: string,
  endTime: string,
  attendeeEmail?: string,
  additionalAttendees?: string[]
): Promise<{ success: boolean; meeting_link: string | null; google_event_id: string | null }> {
  try {
    console.log("[SCHEDULE] Creating Google Calendar event with attendees:", {
      primary: attendeeEmail || "none",
      additional: additionalAttendees?.length || 0
    });
    
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-calendar-create-event`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          appointment_id: appointmentId,
          title,
          description,
          start_time: startTime,
          end_time: endTime,
          attendee_email: attendeeEmail,
          additional_attendees: additionalAttendees || [],
          create_meet_link: true,
        }),
      }
    );

    const result = await response.json();
    console.log("[SCHEDULE] Google Calendar result:", result);
    
    return {
      success: result.success,
      meeting_link: result.meeting_link || null,
      google_event_id: result.google_event_id || null,
    };
  } catch (error) {
    console.error("[SCHEDULE] Error creating Google Calendar event:", error);
    return { success: false, meeting_link: null, google_event_id: null };
  }
}

// Refresh Google access token (uses per-company credentials)
async function refreshAccessToken(refreshToken: string, workspaceId: string): Promise<{ access_token: string; expires_at: string } | null> {
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

    if (!response.ok) {
      console.error('[SCHEDULE] Failed to refresh token:', await response.text());
      return null;
    }

    const tokens = await response.json();
    return {
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      console.warn(`[SCHEDULE] Google OAuth indisponivel: ${error.code} - ${error.userMessage}`);
    } else {
      console.error('[SCHEDULE] Error refreshing token:', error);
    }
    return null;
  }
}

// Delete Google Calendar event from a specific user's calendar
async function deleteFromUserCalendar(
  supabase: any,
  integration: any,
  googleEventId: string
): Promise<boolean> {
  try {
    // Check if token needs refresh
    let accessToken = integration.google_access_token;
    if (new Date(integration.token_expires_at) <= new Date()) {
      console.log('[SCHEDULE] Token expired for user', integration.user_id, ', refreshing...');
      const refreshed = await refreshAccessToken(integration.google_refresh_token, integration.workspace_id);
      if (!refreshed) {
        console.error('[SCHEDULE] Failed to refresh token for user:', integration.user_id);
        return false;
      }
      
      // Update tokens in database
      await supabase
        .from('crm_google_calendar_integration')
        .update({
          google_access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_at,
        })
        .eq('id', integration.id);
      
      accessToken = refreshed.access_token;
    }
    
    // Delete event from Google Calendar
    const calendarId = integration.google_calendar_id || 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`;
    
    console.log("[SCHEDULE] Attempting DELETE from calendar:", calendarId, "user:", integration.user_id);
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    console.log("[SCHEDULE] Google Calendar delete response:", response.status);
    
    if (response.ok) {
      console.log("[SCHEDULE] Successfully deleted event from Google Calendar");
      return true;
    }
    
    if (response.status === 404) {
      console.log("[SCHEDULE] Event not found in calendar (already deleted or never existed)");
      return true; // Consider success if event doesn't exist
    }
    
    // Log detailed error for debugging
    const errorText = await response.text();
    console.error("[SCHEDULE] Google Calendar DELETE failed:", {
      status: response.status,
      statusText: response.statusText,
      body: errorText,
      calendarId,
      eventId: googleEventId,
      userId: integration.user_id
    });
    
    return false;
  } catch (error) {
    console.error("[SCHEDULE] Error in deleteFromUserCalendar:", error);
    return false;
  }
}

// Delete Google Calendar event with fallback to all workspace integrations
async function deleteGoogleCalendarEvent(
  supabase: any,
  workspaceId: string,
  googleEventId: string,
  userId?: string  // ID do usuario responsavel pelo evento (assigned_to)
): Promise<boolean> {
  console.log("[SCHEDULE] Deleting Google Calendar event:", googleEventId, "userId:", userId);
  
  try {
    // First try with the specific user if provided
    if (userId) {
      const { data: userIntegration, error: userError } = await supabase
        .from('crm_google_calendar_integration')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('is_enabled', true)
        .maybeSingle();
      
      if (userError) {
        console.error("[SCHEDULE] Error fetching user integration:", userError);
      }
      
      if (userIntegration) {
        console.log("[SCHEDULE] Found integration for assigned user:", userId);
        const success = await deleteFromUserCalendar(supabase, userIntegration, googleEventId);
        if (success) {
          return true;
        }
        console.log("[SCHEDULE] Delete from assigned user's calendar failed, trying fallback...");
      } else {
        console.log("[SCHEDULE] No integration found for assigned user:", userId);
      }
    }
    
    // Fallback: Try all enabled integrations in the workspace
    console.log("[SCHEDULE] Trying to delete from all workspace integrations...");
    
    const { data: allIntegrations, error: allError } = await supabase
      .from('crm_google_calendar_integration')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_enabled', true);
    
    if (allError) {
      console.error("[SCHEDULE] Error fetching all integrations:", allError);
      return false;
    }
    
    if (!allIntegrations || allIntegrations.length === 0) {
      console.log("[SCHEDULE] No Google Calendar integrations found in workspace");
      return true; // No integrations means nothing to delete from
    }
    
    console.log("[SCHEDULE] Found", allIntegrations.length, "integrations to try");
    
    // Try each integration (skip the one we already tried)
    for (const integration of allIntegrations) {
      if (userId && integration.user_id === userId) {
        continue; // Already tried this one
      }
      
      console.log("[SCHEDULE] Trying integration for user:", integration.user_id);
      const success = await deleteFromUserCalendar(supabase, integration, googleEventId);
      if (success) {
        console.log("[SCHEDULE] Successfully deleted from user:", integration.user_id);
        return true;
      }
    }
    
    console.error("[SCHEDULE] Failed to delete event from all integrations");
    return false;
  } catch (error) {
    console.error("[SCHEDULE] Error in deleteGoogleCalendarEvent:", error);
    return false;
  }
}

// Generate placeholder meeting link
function generatePlaceholderMeetingLink(): string {
  const randomId = Math.random().toString(36).substring(2, 12);
  return `https://meet.google.com/${randomId}`;
}

// Brazil timezone constant
const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

// Helper to get today and tomorrow in Brazil timezone
function getBrazilTodayTomorrow(): { today: string; tomorrow: string } {
  const now = new Date();
  const todayBR = now.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE }); // YYYY-MM-DD
  
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowBR = tomorrowDate.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE });
  
  console.log("[SCHEDULE] Timezone check - today BR:", todayBR, "tomorrow BR:", tomorrowBR);
  
  return { today: todayBR, tomorrow: tomorrowBR };
}

// Helper to format date in Brazilian Portuguese - NOW USES BRAZIL TIMEZONE
function formatDate(dateStr: string): string {
  // Validate YYYY-MM-DD format first
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.log("[SCHEDULE] formatDate received invalid format:", dateStr);
    // Try to parse Portuguese date format as fallback - it's already human-readable
    const ptMatch = dateStr.match(/(\d{1,2})\s*de\s*([a-záêçã]+)/i);
    if (ptMatch) {
      return dateStr; // Return as-is since it's already human-readable
    }
    return dateStr; // Return as-is if unrecognized
  }

  const { today, tomorrow } = getBrazilTodayTomorrow();
  
  // dateStr is already in YYYY-MM-DD format
  if (dateStr === today) {
    return "hoje";
  } else if (dateStr === tomorrow) {
    return "amanhã";
  } else {
    const date = new Date(dateStr + "T12:00:00");
    if (isNaN(date.getTime())) {
      console.log("[SCHEDULE] formatDate: Invalid Date from:", dateStr);
      return dateStr; // Return as-is if parsing fails
    }
    const options: Intl.DateTimeFormatOptions = { 
      timeZone: BRAZIL_TIMEZONE,
      weekday: 'long', 
      day: 'numeric', 
      month: 'long' 
    };
    return date.toLocaleDateString("pt-BR", options);
  }
}

// Format day short (Segunda, Terça, etc.) - NOW USES BRAZIL TIMEZONE
function formatDayShort(dateStr: string): string {
  const { today, tomorrow } = getBrazilTodayTomorrow();
  
  if (dateStr === today) return "Hoje";
  if (dateStr === tomorrow) return "Amanhã";
  
  const date = new Date(dateStr + "T12:00:00");
  const options: Intl.DateTimeFormatOptions = { 
    timeZone: BRAZIL_TIMEZONE,
    weekday: 'long' 
  };
  const dayName = date.toLocaleDateString("pt-BR", options);
  return dayName.charAt(0).toUpperCase() + dayName.slice(1);
}

// Format time for display
function formatTime(timeStr: string): string {
  return timeStr.replace(":", "h");
}

// Format suggestions grouped by day: "Segunda às 09h00 / 09h30 ou Terça às 10h00"
function formatSuggestionsGrouped(slots: { date: string; time: string }[]): string {
  // Group by date
  const grouped: Map<string, string[]> = new Map();
  for (const slot of slots) {
    const times = grouped.get(slot.date) || [];
    times.push(formatTime(slot.time));
    grouped.set(slot.date, times);
  }
  
  // Format: "Segunda às 09h00 / 09h30 ou Terça às 10h00"
  const parts: string[] = [];
  for (const [date, times] of grouped) {
    const shortDayName = formatDayShort(date);
    parts.push(`${shortDayName} às ${times.join(' / ')}`);
  }
  
  return parts.join(' ou ');
}

// Get fallback attendant (company owner) when no calendars configured
async function getFallbackAttendant(
  supabase: any,
  workspaceId: string
): Promise<{ id: string; name: string } | null> {
  const { data: workspaceData } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", workspaceId)
    .single();
  
  if (!workspaceData?.company_id) return null;
  
  const { data: companyOwner } = await supabase
    .from("companies")
    .select("owner_id")
    .eq("id", workspaceData.company_id)
    .single();
  
  if (!companyOwner?.owner_id) return null;
  
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", companyOwner.owner_id)
    .single();
  
  return {
    id: companyOwner.owner_id,
    name: profile?.name || "nossa equipe"
  };
}

// Send appointment email notification
async function sendAppointmentEmail(
  supabase: any,
  type: "confirmation" | "cancellation" | "reschedule",
  contactId: string,
  workspaceId: string,
  appointmentData: {
    title: string;
    startTime: string;
    endTime?: string;
    meetingLink?: string;
    assignedTo?: string;
    oldStartTime?: string;
    additionalAttendees?: string[]; // Additional email addresses
  }
): Promise<void> {
  try {
    console.log("[SCHEDULE] Sending", type, "email for contact:", contactId);
    
    // 1. Get contact email
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("email, name")
      .eq("id", contactId)
      .single();
    
    if (!contact?.email) {
      console.log("[SCHEDULE] Contact has no email, skipping email notification");
      return;
    }
    
    // 2. Get assignee name and email
    let assigneeName: string | null = null;
    let assigneeEmail: string | null = null;
    if (appointmentData.assignedTo) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", appointmentData.assignedTo)
        .single();
      assigneeName = profile?.name || null;
      assigneeEmail = profile?.email || null;
    }
    
    // 3. Get company name + id
    let companyName = null;
    let companyId: string | null = null;
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspaceId)
      .single();
    
    if (workspace?.company_id) {
      companyId = workspace.company_id as string;
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", workspace.company_id)
        .single();
      companyName = company?.name || null;
    }
    
    // 4. Build attendees list for email display
    const attendeesList: Array<{ name: string; email?: string; role: "contact" | "assignee" | "creator" | "guest" }> = [];
    
    // Add contact
    attendeesList.push({
      name: contact.name || "Cliente",
      email: contact.email,
      role: "contact"
    });
    
    // Add assignee
    if (assigneeName && assigneeEmail) {
      attendeesList.push({
        name: assigneeName,
        email: assigneeEmail,
        role: "assignee"
      });
    }
    
    // Add additional attendees
    if (appointmentData.additionalAttendees) {
      for (const email of appointmentData.additionalAttendees) {
        if (email && email !== contact.email && email !== assigneeEmail) {
          attendeesList.push({
            name: email.split("@")[0],
            email: email,
            role: "guest"
          });
        }
      }
    }
    
    // 5. Call email edge function
    const emailPayload = {
      type,
      email: contact.email,
      contactName: contact.name || "Cliente",
      recipientType: "contact" as const,
      appointmentTitle: appointmentData.title,
      startTime: appointmentData.startTime,
      endTime: appointmentData.endTime,
      meetingLink: appointmentData.meetingLink,
      assigneeName,
      companyName,
      company_id: companyId,
      oldStartTime: appointmentData.oldStartTime,
      leadName: contact.name || "Cliente",
      attendees: attendeesList
    };
    
    console.log("[SCHEDULE] Email payload:", emailPayload);
    
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-appointment-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
        },
        body: JSON.stringify(emailPayload)
      }
    );
    
    const result = await response.json();
    console.log("[SCHEDULE] Email result:", result);
    
  } catch (error) {
    console.error("[SCHEDULE] Error sending email notification:", error);
    // Don't throw - email failures shouldn't block the main flow
  }
}

// Update Google Calendar event to add new attendees
async function updateGoogleCalendarAttendees(
  supabase: any,
  workspaceId: string,
  appointmentId: string,
  googleEventId: string,
  assignedTo: string,
  newAttendees: string[]
): Promise<boolean> {
  try {
    console.log("[SCHEDULE] Updating Google Calendar event:", googleEventId, "Adding attendees:", newAttendees);
    
    // Get Google Calendar integration for the assigned user
    const { data: integration, error: intError } = await supabase
      .from('crm_google_calendar_integration')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', assignedTo)
      .eq('is_enabled', true)
      .maybeSingle();
    
    if (intError || !integration) {
      console.log("[SCHEDULE] No Google Calendar integration for user:", assignedTo);
      return false;
    }
    
    // Check if token needs refresh
    let accessToken = integration.google_access_token;
    if (new Date(integration.token_expires_at) <= new Date()) {
      console.log('[SCHEDULE] Token expired, refreshing...');
      const refreshed = await refreshAccessToken(integration.google_refresh_token, workspaceId);
      if (!refreshed) {
        console.error('[SCHEDULE] Failed to refresh token');
        return false;
      }
      
      await supabase
        .from('crm_google_calendar_integration')
        .update({
          google_access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_at,
        })
        .eq('id', integration.id);
      
      accessToken = refreshed.access_token;
    }
    
    const calendarId = integration.google_calendar_id || 'primary';
    
    // 1. First, GET the existing event to get current attendees
    const getResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    if (!getResponse.ok) {
      console.error('[SCHEDULE] Failed to get event:', await getResponse.text());
      return false;
    }
    
    const event = await getResponse.json();
    console.log("[SCHEDULE] Current event attendees:", event.attendees?.length || 0);
    
    // 2. Merge existing attendees with new ones
    const existingAttendees = event.attendees || [];
    const existingEmails = new Set(existingAttendees.map((a: { email: string }) => a.email.toLowerCase()));
    
    const mergedAttendees = [...existingAttendees];
    for (const email of newAttendees) {
      if (!existingEmails.has(email.toLowerCase())) {
        mergedAttendees.push({ email });
        console.log("[SCHEDULE] Adding new attendee:", email);
      } else {
        console.log("[SCHEDULE] Attendee already exists:", email);
      }
    }
    
    // 3. PATCH the event with updated attendees
    const patchResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          attendees: mergedAttendees
        })
      }
    );
    
    if (!patchResponse.ok) {
      console.error('[SCHEDULE] Failed to update event:', await patchResponse.text());
      return false;
    }
    
    console.log("[SCHEDULE] Google Calendar event updated successfully");
    return true;
    
  } catch (error) {
    console.error("[SCHEDULE] Error updating Google Calendar attendees:", error);
    return false;
  }
}

// Handle ADD_ATTENDEE action - add participants to an existing appointment
async function handleAddAttendee(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { lead_id, workspace_id, additional_attendees } = request;
  
  console.log("[SCHEDULE] Action: ADD_ATTENDEE - adding participants for lead:", lead_id);
  console.log("[SCHEDULE] Attendees to add:", additional_attendees);
  
  if (!additional_attendees || additional_attendees.length === 0) {
    return new Response(JSON.stringify({
      success: false,
      message: "Por favor, me informe o email do participante que deseja adicionar."
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Find lead's contact_id
  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id, name")
    .eq("id", lead_id)
    .single();
  
  if (!lead?.contact_id) {
    console.log("[SCHEDULE] ADD_ATTENDEE - No contact_id found for lead");
    return new Response(JSON.stringify({
      success: false,
      message: "Voce nao possui nenhuma reuniao agendada. Gostaria de agendar uma primeiro?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Find the most recent active appointment for this contact
  const { data: appointment } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, end_time, meeting_link, assigned_to, google_event_id, additional_attendees")
    .eq("contact_id", lead.contact_id)
    .eq("workspace_id", workspace_id)
    .in("status", ["scheduled", "confirmed"])
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();
  
  if (!appointment) {
    return new Response(JSON.stringify({
      success: false,
      message: "Voce nao possui nenhuma reuniao agendada. Gostaria de agendar uma primeiro?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  console.log("[SCHEDULE] Found appointment:", appointment.id);
  
  // Merge existing attendees with new ones
  const existingAttendees: string[] = appointment.additional_attendees || [];
  const existingEmails = new Set(existingAttendees.map(e => e.toLowerCase()));
  
  const newAttendees: string[] = [];
  for (const email of additional_attendees) {
    if (!existingEmails.has(email.toLowerCase())) {
      newAttendees.push(email);
    }
  }
  
  if (newAttendees.length === 0) {
    const emailList = additional_attendees.join(", ");
    return new Response(JSON.stringify({
      success: true,
      message: `${emailList} ja esta(ao) na lista de participantes da reuniao.`
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  const mergedAttendees = [...existingAttendees, ...newAttendees];
  
  // Update additional_attendees in database
  const { error: updateError } = await supabase
    .from("crm_appointments")
    .update({ additional_attendees: mergedAttendees })
    .eq("id", appointment.id);
  
  if (updateError) {
    console.error("[SCHEDULE] Error updating appointment:", updateError);
    return new Response(JSON.stringify({
      success: false,
      message: "Erro ao adicionar participante. Por favor, tente novamente."
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  console.log("[SCHEDULE] Updated additional_attendees in database");
  
  // Update Google Calendar event if exists
  if (appointment.google_event_id && appointment.assigned_to) {
    const googleUpdated = await updateGoogleCalendarAttendees(
      supabase,
      workspace_id,
      appointment.id,
      appointment.google_event_id,
      appointment.assigned_to,
      newAttendees
    );
    console.log("[SCHEDULE] Google Calendar update result:", googleUpdated);
  }
  
  // Send invitation email to new attendees
  for (const email of newAttendees) {
    try {
      // Get workspace info for company name
      let companyName = null;
      let companyId: string | null = null;
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("company_id")
        .eq("id", workspace_id)
        .single();
      
      if (workspace?.company_id) {
        companyId = workspace.company_id as string;
        const { data: company } = await supabase
          .from("companies")
          .select("name")
          .eq("id", workspace.company_id)
          .single();
        companyName = company?.name || null;
      }
      
      // Get assignee name
      let assigneeName = null;
      if (appointment.assigned_to) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", appointment.assigned_to)
          .single();
        assigneeName = profile?.name || null;
      }
      
      const emailPayload = {
        type: "confirmation",
        email,
        contactName: email.split("@")[0],
        appointmentTitle: appointment.title,
        startTime: appointment.start_time,
        endTime: appointment.end_time,
        meetingLink: appointment.meeting_link,
        assigneeName,
        companyName,
        company_id: companyId
      };
      
      console.log("[SCHEDULE] Sending invite email to:", email);
      
      await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-appointment-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`
          },
          body: JSON.stringify(emailPayload)
        }
      );
    } catch (emailError) {
      console.error("[SCHEDULE] Error sending email to", email, ":", emailError);
    }
  }
  
  const emailList = newAttendees.join(", ");
  const appointmentDate = new Date(appointment.start_time);
  const formattedDate = formatDate(appointmentDate.toISOString().split("T")[0]);
  const formattedTime = formatTime(
    appointmentDate.toLocaleTimeString("pt-BR", { 
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", 
      minute: "2-digit",
      hour12: false 
    }).replace(":", "h").replace("h", ":")
  );
  
  return new Response(JSON.stringify({
    success: true,
    appointment_id: appointment.id,
    message: `Pronto! Adicionei ${emailList} a sua reuniao de ${formattedDate} as ${formattedTime}. O convite foi enviado por email.`
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ==================== ACTION HANDLERS ====================

// Handle LIST action - return ALL active appointments for a lead
async function handleList(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { lead_id, workspace_id } = request;
  
  console.log("[SCHEDULE] Action: LIST - fetching all appointments for lead:", lead_id);
  
  // Find lead's contact_id
  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id, name")
    .eq("id", lead_id)
    .single();
  
  if (!lead?.contact_id) {
    console.log("[SCHEDULE] LIST - No contact_id found for lead");
    return new Response(JSON.stringify({
      success: false,
      message: "Voce nao possui nenhuma reuniao agendada no momento. Gostaria de agendar uma?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Find ALL active appointments directly by contact_id (more robust than going through crm_lead)
  const { data: appointments } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, end_time, meeting_link, assigned_to, status, lead_id")
    .eq("contact_id", lead.contact_id)
    .eq("workspace_id", workspace_id)
    .in("status", ["scheduled", "confirmed"])
    .order("start_time", { ascending: true });
  
  console.log("[SCHEDULE] LIST - Found appointments:", appointments?.length || 0);
  
  if (!appointments || appointments.length === 0) {
    return new Response(JSON.stringify({
      success: false,
      message: "Voce nao possui nenhuma reuniao agendada no momento. Gostaria de agendar uma?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Format each appointment
  const formattedAppointments: string[] = [];
  for (let i = 0; i < appointments.length; i++) {
    const apt = appointments[i];
    
    // Get attendant name if assigned
    let attendantName = "nossa equipe";
    if (apt.assigned_to) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", apt.assigned_to)
        .maybeSingle();
      if (profile?.name) attendantName = profile.name;
    }
    
    const appointmentDate = new Date(apt.start_time);
    const formattedDate = formatDate(appointmentDate.toISOString().split("T")[0]);
    const formattedTime = formatTime(
      appointmentDate.toLocaleTimeString("pt-BR", { 
        timeZone: "America/Sao_Paulo",
        hour: "2-digit", 
        minute: "2-digit",
        hour12: false 
      }).replace(":", "h").replace("h", ":")
    );
    
    formattedAppointments.push(`${i + 1}. ${formattedDate} as ${formattedTime} com ${attendantName}`);
  }
  
  const message = appointments.length === 1
    ? `Voce tem 1 reuniao agendada:\n${formattedAppointments[0]}`
    : `Voce tem ${appointments.length} reunioes agendadas:\n${formattedAppointments.join("\n")}`;
  
  return new Response(JSON.stringify({
    success: true,
    appointments: appointments.map((apt: { id: string; start_time: string; end_time: string; meeting_link: string | null }) => ({
      id: apt.id,
      start_time: apt.start_time,
      end_time: apt.end_time,
      meeting_link: apt.meeting_link
    })),
    message: message + "\n\nGostaria de remarcar ou cancelar alguma?"
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Handle INFO action - return existing appointment details
async function handleInfo(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { lead_id, workspace_id } = request;
  
  console.log("[SCHEDULE] Action: INFO - checking existing appointment for lead:", lead_id);
  
  // Find lead's contact_id
  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id, name")
    .eq("id", lead_id)
    .single();
  
  if (!lead?.contact_id) {
    console.log("[SCHEDULE] INFO - No contact_id found for lead");
    return new Response(JSON.stringify({
      success: false,
      message: "Você não possui nenhuma reunião agendada no momento. Gostaria de agendar uma?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Find active appointment directly by contact_id (more robust than going through crm_lead)
  const { data: appointment } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, end_time, meeting_link, assigned_to, status, lead_id")
    .eq("contact_id", lead.contact_id)
    .eq("workspace_id", workspace_id)
    .in("status", ["scheduled", "confirmed"])
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();
  
  console.log("[SCHEDULE] INFO - Found appointment:", appointment);
  
  if (!appointment) {
    return new Response(JSON.stringify({
      success: false,
      message: "Você não possui nenhuma reunião agendada no momento. Gostaria de agendar uma?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Get attendant name if assigned
  let attendantName = "nossa equipe";
  if (appointment.assigned_to) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", appointment.assigned_to)
      .maybeSingle();
    if (profile?.name) attendantName = profile.name;
  }
  
  const appointmentDate = new Date(appointment.start_time);
  const formattedDate = formatDate(appointmentDate.toISOString().split("T")[0]);
  // Use timezone-aware formatting for correct São Paulo time
  const formattedTime = formatTime(
    appointmentDate.toLocaleTimeString("pt-BR", { 
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", 
      minute: "2-digit",
      hour12: false 
    }).replace(":", "h").replace("h", ":")
  );
  
  const message = appointment.meeting_link
    ? `Você tem uma reunião agendada com ${attendantName} para ${formattedDate} às ${formattedTime}.

Acesse pelo link: ${appointment.meeting_link}`
    : `Você tem uma reunião agendada com ${attendantName} para ${formattedDate} às ${formattedTime}.`;
  
  return new Response(JSON.stringify({
    success: true,
    appointment_id: appointment.id,
    scheduled_date: appointmentDate.toISOString().split("T")[0],
    scheduled_time: appointmentDate.toTimeString().substring(0, 5),
    meeting_link: appointment.meeting_link,
    message
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Handle CHECK action - return available slots from ALL agents, sorted by proximity
async function handleCheck(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { workspace_id, preferred_date, agent_id } = request;
  
  console.log("[SCHEDULE] Action: CHECK availability for all agents");
  
  const allowedAttendants = await getAllowedAttendantsForAgent(supabase, workspace_id, agent_id);

  // Get slots from all agents
  const allAgentSlots = await getAvailableSlotsAllAgents(
    supabase,
    workspace_id,
    preferred_date || null,
    7,
    allowedAttendants
  );
  
  // If no agent calendars configured, fall back to legacy method
  if (allAgentSlots.length === 0) {
    console.log("[SCHEDULE] No agent slots found, using fallback");
    const legacySlots = await getAvailableSlots(
      supabase,
      workspace_id,
      null,
      preferred_date || null
    );
    
    const suggestions = legacySlots.slice(0, 5).map((slot, index) => ({
      date: slot.date,
      time: slot.time,
      reason: `Opção ${index + 1}`
    }));
    
    const message = suggestions.length > 0
      ? `Tenho os seguintes horários disponíveis: ${formatSuggestionsGrouped(suggestions)}. Qual você prefere?`
      : "Não encontrei horários disponíveis nos próximos dias. Gostaria de verificar outra data?";
    
    return new Response(JSON.stringify({
      success: true,
      suggested_alternatives: suggestions,
      needs_selection: true,
      message
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Get unique time slots (dedupe by date+time since we just need to show availability)
  const uniqueSlots = findClosestAlternativesFromAgentSlots(allAgentSlots, "", "", 5);
  
  const suggestions = uniqueSlots.map((slot, index) => ({
    date: slot.date,
    time: slot.time,
    reason: `Opção ${index + 1}`
  }));
  
  const message = suggestions.length > 0
    ? `Tenho os seguintes horários disponíveis: ${formatSuggestionsGrouped(suggestions)}. Qual você prefere?`
    : "Não encontrei horários disponíveis nos próximos dias. Gostaria de verificar outra data?";
  
  return new Response(JSON.stringify({
    success: true,
    suggested_alternatives: suggestions,
    needs_selection: true,
    message
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Handle CANCEL action
async function handleCancel(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { lead_id, workspace_id, reason } = request;
  
  console.log("[SCHEDULE] Action: CANCEL appointment for lead:", lead_id);
  
  // Try to find appointment using multiple methods (works for both CRM and inbox leads)
  let appointment = null;
  let contact_id = null;

  // Method 1: Direct lookup by lead_id in crm_appointments
  const { data: appointmentByLeadId } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, google_event_id, lead_id, assigned_to, contact_id")
    .eq("lead_id", lead_id)
    .eq("workspace_id", workspace_id)
    .in("status", ["scheduled", "confirmed"])
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (appointmentByLeadId) {
    appointment = appointmentByLeadId;
    contact_id = appointmentByLeadId.contact_id;
    console.log("[SCHEDULE] Found appointment by lead_id:", appointment.id);
  } else {
    // Method 2: Fallback - try to find via contact_id from leads table (inbox)
    const { data: inboxLead } = await supabase
      .from("leads")
      .select("contact_id")
      .eq("id", lead_id)
      .maybeSingle();
    
    if (inboxLead?.contact_id) {
      const { data: appointmentByContact } = await supabase
        .from("crm_appointments")
        .select("id, title, start_time, google_event_id, lead_id, assigned_to, contact_id")
        .eq("contact_id", inboxLead.contact_id)
        .eq("workspace_id", workspace_id)
        .in("status", ["scheduled", "confirmed"])
        .order("start_time", { ascending: true })
        .limit(1)
        .maybeSingle();
      
      if (appointmentByContact) {
        appointment = appointmentByContact;
        contact_id = inboxLead.contact_id;
        console.log("[SCHEDULE] Found appointment by inbox contact_id:", appointment.id);
      }
    }
    
    // Method 3: Try crm_leads table (CRM pipeline)
    if (!appointment) {
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select("contact_id")
        .eq("id", lead_id)
        .maybeSingle();
      
      if (crmLead?.contact_id) {
        const { data: appointmentByCrmContact } = await supabase
          .from("crm_appointments")
          .select("id, title, start_time, google_event_id, lead_id, assigned_to, contact_id")
          .eq("contact_id", crmLead.contact_id)
          .eq("workspace_id", workspace_id)
          .in("status", ["scheduled", "confirmed"])
          .order("start_time", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (appointmentByCrmContact) {
          appointment = appointmentByCrmContact;
          contact_id = crmLead.contact_id;
          console.log("[SCHEDULE] Found appointment via crm_leads contact_id:", appointment.id);
        }
      }
    }
  }

  if (!appointment) {
    console.log("[SCHEDULE] No active appointment found for lead:", lead_id);
    return new Response(JSON.stringify({
      success: false,
      message: "Você não tem nenhum agendamento ativo para cancelar. Gostaria de agendar uma nova reunião?"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  console.log("[SCHEDULE] Found appointment to cancel:", appointment.id, "assigned_to:", appointment.assigned_to);
  
  // Delete from Google Calendar if exists - passar assigned_to para buscar integracao correta
  let googleCalendarDeleteFailed = false;
  if (appointment.google_event_id) {
    const deleteSuccess = await deleteGoogleCalendarEvent(
      supabase, 
      workspace_id, 
      appointment.google_event_id,
      appointment.assigned_to
    );
    console.log("[SCHEDULE] Google Calendar delete result:", deleteSuccess);
    if (!deleteSuccess) {
      googleCalendarDeleteFailed = true;
      console.error("[SCHEDULE] WARNING: Failed to delete event from Google Calendar. Event ID:", appointment.google_event_id);
    }
  }
  
  // Update appointment status to cancelled
  const { error: updateError } = await supabase
    .from("crm_appointments")
    .update({ 
      status: "cancelled", 
      notes: reason ? `Cancelado: ${reason}` : "Cancelado pelo cliente" 
    })
    .eq("id", appointment.id);
  
  if (updateError) {
    console.error("[SCHEDULE] Error cancelling appointment:", updateError);
    return new Response(JSON.stringify({
      success: false,
      message: "Erro ao cancelar agendamento. Por favor, tente novamente."
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Delete pending reminders
  await supabase
    .from("crm_appointment_reminders")
    .delete()
    .eq("appointment_id", appointment.id)
    .eq("status", "pending");
  
  // Update CRM activity if exists (use appointment.lead_id from the fetched appointment)
  if (appointment.lead_id) {
    await supabase
      .from("crm_lead_activities")
      .update({ status: "cancelled" })
      .eq("lead_id", appointment.lead_id)
      .eq("type", "meeting")
      .eq("status", "pending");
  }
  
  const appointmentDate = new Date(appointment.start_time);
  // Use timezone-aware formatting for correct São Paulo time
  const formattedDate = appointmentDate.toLocaleDateString("pt-BR", { 
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long"
  });
  const formattedTime = appointmentDate.toLocaleTimeString("pt-BR", { 
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", 
    minute: "2-digit",
    hour12: false
  });
  
  // Send cancellation email to all involved parties (async, don't block)
  const sendCancellationEmails = async () => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[SCHEDULE] Missing environment variables for email");
      return;
    }

    const emailRecipients: Array<{ email: string; name: string; recipientType: string }> = [];

    // 1. Get contact email
    if (contact_id) {
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("email, name")
        .eq("id", contact_id)
        .maybeSingle();
      
      if (contact?.email) {
        emailRecipients.push({
          email: contact.email,
          name: contact.name || "Cliente",
          recipientType: "contact"
        });
      }
    }

    // 2. Get assignee email (vendedor)
    if (appointment.assigned_to) {
      const { data: assignee } = await supabase
        .from("profiles")
        .select("email, name")
        .eq("id", appointment.assigned_to)
        .maybeSingle();
      
      if (assignee?.email && !emailRecipients.some(r => r.email === assignee.email)) {
        emailRecipients.push({
          email: assignee.email,
          name: assignee.name || "Vendedor",
          recipientType: "assignee"
        });
      }
    }

    // 3. Get company name + id for email context
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("company_id, companies(name)")
      .eq("id", workspace_id)
      .maybeSingle();
    
    let companyName = "Nossa Empresa";
    const companyId: string | null = (workspace?.company_id as string) || null;
    if (workspace?.companies && typeof workspace.companies === 'object' && 'name' in workspace.companies) {
      companyName = (workspace.companies as { name: string }).name;
    }

    // Build attendees list for email display
    const attendeesList = emailRecipients.map(r => ({
      name: r.name,
      email: r.email,
      role: r.recipientType as "contact" | "assignee" | "creator" | "guest"
    }));

    const contactName = emailRecipients.find(r => r.recipientType === "contact")?.name || "Cliente";

    // Send email to each recipient
    for (const recipient of emailRecipients) {
      try {
        console.log(`[SCHEDULE] Sending cancellation email to ${recipient.recipientType}:`, recipient.email);
        
        const response = await fetch(
          `${supabaseUrl}/functions/v1/send-appointment-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`
            },
            body: JSON.stringify({
              type: "cancellation",
              email: recipient.email,
              contactName: recipient.name,
              recipientType: recipient.recipientType,
              appointmentTitle: appointment.title,
              startTime: appointment.start_time,
              companyName,
              company_id: companyId,
              leadName: contactName,
              attendees: attendeesList,
            })
          }
        );

        if (response.ok) {
          console.log(`[SCHEDULE] Cancellation email sent to ${recipient.recipientType}: ${recipient.email}`);
        } else {
          console.error(`[SCHEDULE] Failed to send email to ${recipient.recipientType}:`, await response.text());
        }
      } catch (err) {
        console.error(`[SCHEDULE] Error sending email to ${recipient.recipientType}:`, err);
      }
    }
  };

  // Fire and forget - don't block the response
  sendCancellationEmails().catch(err => console.error("[SCHEDULE] Email sending error:", err));
  
  // Build response message with optional Google Calendar warning
  let message = `Seu agendamento de ${formattedDate} às ${formattedTime} foi cancelado com sucesso.`;
  if (googleCalendarDeleteFailed) {
    message += " (Atenção: o evento pode ainda estar visível no Google Calendar e precisará ser removido manualmente.)";
  }
  message += " Gostaria de remarcar para outra data?";
  
  return new Response(JSON.stringify({
    success: true,
    message
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Handle RESCHEDULE action - IMPROVED: only cancel after confirming new slot
async function handleReschedule(
  supabase: any,
  request: ScheduleRequest
): Promise<Response> {
  const { lead_id, workspace_id, preferred_date, preferred_time, agent_id } = request;
  
  console.log("[SCHEDULE] Action: RESCHEDULE appointment");
  console.log("[SCHEDULE] RESCHEDULE params - date:", preferred_date, "time:", preferred_time);
  
  const allowedAttendants = await getAllowedAttendantsForAgent(supabase, workspace_id, agent_id);

  // If no new date/time provided, ask for it WITHOUT cancelling yet
  if (!preferred_date || !preferred_time) {
    const allAgentSlots = await getAvailableSlotsAllAgents(supabase, workspace_id, null, 7, allowedAttendants);
    const suggestions = findClosestAlternativesFromAgentSlots(allAgentSlots, "", "", 3).map((slot, idx) => ({
      date: slot.date,
      time: slot.time,
      reason: `Opcao ${idx + 1}`
    }));
    
    return new Response(JSON.stringify({
      success: true,
      suggested_alternatives: suggestions,
      needs_selection: true,
      message: `Para qual data e horario voce gostaria de remarcar? ${
        suggestions.length > 0 
          ? `Tenho disponibilidade em: ${formatSuggestionsGrouped(suggestions)}`
          : ""
      }`
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // We have date/time - IMPORTANT: only cancel the old appointment AFTER the new
  // one is confirmed. Cancelling first left leads without any meeting whenever the
  // requested slot was unavailable.
  console.log("[SCHEDULE] RESCHEDULE - Have date/time, getting old appointment info first");
  
  // Get old appointment info before scheduling the new one
  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id")
    .eq("id", lead_id)
    .single();
  
  let oldStartTime: string | null = null;
  let oldAppointment: {
    id?: string;
    start_time: string;
    title?: string;
    assigned_to?: string;
    google_event_id?: string;
  } | null = null;
  
  if (lead?.contact_id) {
    const { data } = await supabase
      .from("crm_appointments")
      .select("id, start_time, title, assigned_to, google_event_id")
      .eq("contact_id", lead.contact_id)
      .eq("workspace_id", workspace_id)
      .in("status", ["scheduled", "confirmed"])
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();
    
    oldAppointment = data ?? null;
    if (oldAppointment) {
      oldStartTime = oldAppointment.start_time;
      console.log("[SCHEDULE] RESCHEDULE - Old appointment:", oldStartTime, "assigned_to:", oldAppointment.assigned_to);
    }
  }
  
  // Schedule new appointment first (skip confirmation email - we'll send reschedule email instead)
  const scheduleResult = await handleSchedule(supabase, request, true);
  const scheduleData = await scheduleResult.clone().json();
  
  if (!scheduleData.success) {
    console.log("[SCHEDULE] RESCHEDULE - New appointment NOT created; keeping the original one intact");
    return scheduleResult;
  }
  
  // New appointment confirmed - now it is safe to cancel the old one
  if (oldAppointment) {
    if (oldAppointment.google_event_id) {
      const deleteSuccess = await deleteGoogleCalendarEvent(
        supabase,
        workspace_id,
        oldAppointment.google_event_id,
        oldAppointment.assigned_to
      );
      console.log("[SCHEDULE] RESCHEDULE - Google Calendar delete result:", deleteSuccess);
    }
    
    await supabase
      .from("crm_appointments")
      .update({
        status: "cancelled",
        notes: "Cancelado: IA - reagendamento solicitado pelo cliente"
      })
      .eq("id", oldAppointment.id)
      .in("status", ["scheduled", "confirmed"]);
  }
  
  // Send reschedule email when we actually replaced an existing appointment
  if (oldStartTime && lead?.contact_id) {
    // Send reschedule email (async, don't block)
    sendAppointmentEmail(supabase, "reschedule", lead.contact_id, workspace_id, {
      title: scheduleData.meeting_link ? "Reunião" : "Reunião",
      startTime: new Date(scheduleData.scheduled_date + "T" + scheduleData.scheduled_time + ":00-03:00").toISOString(),
      meetingLink: scheduleData.meeting_link,
      oldStartTime
    }).catch(err => console.error("[SCHEDULE] Reschedule email error:", err));
  }

  
  return scheduleResult;
}

// Handle SCHEDULE action - uses round-robin with all agents
// skipEmail: if true, don't send confirmation email (used by reschedule)
async function handleSchedule(
  supabase: any,
  request: ScheduleRequest,
  skipEmail: boolean = false
): Promise<Response> {
  const { 
    lead_id, 
    workspace_id, 
    agent_id,
    title = "Reunião", 
    description,
    preferred_date,
    preferred_time,
    duration_minutes: requestDuration
  } = request;
  let duration_minutes = requestDuration ?? 30;
  
  console.log("[SCHEDULE] Action: SCHEDULE new appointment with round-robin");
  console.log("[SCHEDULE] DEBUG - Received params:", { preferred_date, preferred_time, lead_id, workspace_id, agent_id });
  
  // VALIDATION: Ensure workspace_id is provided
  if (!workspace_id) {
    console.error("[SCHEDULE] ERROR: workspace_id is missing from request!");
    return new Response(JSON.stringify({
      success: false,
      message: "Erro interno: workspace_id não fornecido. Por favor, tente novamente."
    } as ScheduleResponse), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Get lead info
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, name, phone, contact_id")
    .eq("id", lead_id)
    .single();
  
  if (leadError || !lead) {
    return new Response(JSON.stringify({
      success: false,
      message: "Lead not found"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Get or create CRM lead
  let crmLeadId: string | null = null;
  let contactId = lead.contact_id;
  
  if (contactId) {
    const { data: crmLead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("contact_id", contactId)
      .maybeSingle();
    
    if (crmLead) {
      crmLeadId = crmLead.id;
    }
  }
  
  if (!contactId) {
    const { data: crmContact } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("lead_id", lead_id)
      .maybeSingle();
    
    if (crmContact) {
      contactId = crmContact.id;
      await supabase.from("leads").update({ contact_id: contactId }).eq("id", lead_id);
      
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("contact_id", contactId)
        .maybeSingle();
      
      if (crmLead) {
        crmLeadId = crmLead.id;
      }
    }
  }
  
  if (contactId && !crmLeadId) {
    // Query for crm_lead that may have been auto-created by the auto_create_pipeline_lead trigger
    const { data: autoCreatedLead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    
    if (autoCreatedLead) {
      crmLeadId = autoCreatedLead.id;
    } else {
      // Fallback: trigger didn't fire (no pipeline stages at trigger time)
      let stageId: string | null = null;
      
      const { data: defaultStage } = await supabase
        .from("crm_pipeline_stages")
        .select("id")
        .eq("workspace_id", workspace_id)
        .eq("is_default", true)
        .maybeSingle();
      
      if (defaultStage) {
        stageId = defaultStage.id;
      } else {
        const { data: firstStage } = await supabase
          .from("crm_pipeline_stages")
          .select("id")
          .eq("workspace_id", workspace_id)
          .order("order", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (firstStage) {
          stageId = firstStage.id;
        }
      }
      
      if (stageId) {
        const { data: newCrmLead } = await supabase
          .from("crm_leads")
          .insert({
            workspace_id,
            contact_id: contactId,
            stage_id: stageId,
            title: `Lead: ${lead.name || lead.phone || "Unknown"}`,
            assigned_to: request.assigned_to || null
          })
          .select("id")
          .maybeSingle();
        
        if (newCrmLead) {
          crmLeadId = newCrmLead.id;
        }
      }
    }
  }
  
  if (!contactId) {
    let stageId: string | null = null;
    
    const { data: defaultStage } = await supabase
      .from("crm_pipeline_stages")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("is_default", true)
      .maybeSingle();
    
    if (defaultStage) {
      stageId = defaultStage.id;
    } else {
      const { data: firstStage } = await supabase
        .from("crm_pipeline_stages")
        .select("id")
        .eq("workspace_id", workspace_id)
        .order("order", { ascending: true })
        .limit(1)
        .maybeSingle();
      
      if (firstStage) {
        stageId = firstStage.id;
      }
    }
    
    if (!stageId) {
      return new Response(JSON.stringify({
        success: false,
        message: "No pipeline stages configured"
      } as ScheduleResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    // Determine source dynamically based on lead source
    const contactSource = lead.source?.toLowerCase().includes("widget") ? "widget" : (lead.source || "whatsapp");
    
    const { data: newContact, error: contactError } = await supabase
      .from("crm_contacts")
      .insert({
        workspace_id,
        name: lead.name || "Lead",
        phone: lead.phone || "",
        lead_id: lead_id,
        source: contactSource
      })
      .select("id")
      .single();
    
    if (contactError) {
      return new Response(JSON.stringify({
        success: false,
        message: "Error creating contact for appointment"
      } as ScheduleResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    contactId = newContact.id;
    await supabase.from("leads").update({ contact_id: contactId }).eq("id", lead_id);
    
    // The auto_create_pipeline_lead trigger already created a crm_lead,
    // so query for it instead of inserting a duplicate
    const { data: autoCreatedLead } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    
    if (autoCreatedLead) {
      crmLeadId = autoCreatedLead.id;
    } else {
      // Fallback: trigger didn't fire (no pipeline stages at trigger time)
      const { data: newCrmLead } = await supabase
        .from("crm_leads")
        .insert({
          workspace_id,
          contact_id: contactId,
          stage_id: stageId,
          title: `Lead: ${lead.name || lead.phone || "Unknown"}`,
          assigned_to: request.assigned_to || null
        })
        .select("id")
        .maybeSingle();
      
      if (newCrmLead) {
        crmLeadId = newCrmLead.id;
      }
    }
  }
  
  if (!crmLeadId || !contactId) {
    return new Response(JSON.stringify({
      success: false,
      message: "Could not find or create CRM lead for appointment"
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Safety: ensure assigned_to is set on the CRM lead (may be NULL if created by trigger without assignment)
  if (crmLeadId && request.assigned_to) {
    const { data: existingLead } = await supabase
      .from("crm_leads")
      .select("assigned_to")
      .eq("id", crmLeadId)
      .single();
    
    if (existingLead && !existingLead.assigned_to) {
      console.log("[SCHEDULE] Safety: Setting assigned_to on CRM lead", crmLeadId, "to", request.assigned_to);
      await supabase
        .from("crm_leads")
        .update({ assigned_to: request.assigned_to })
        .eq("id", crmLeadId);
    }
  }
  
  // DUPLICATE GUARD: block creating a new appointment if the lead already has a future active one
  {
    const nowIso = new Date().toISOString();
    const orFilters: string[] = [`lead_id.eq.${lead_id}`];
    if (crmLeadId) orFilters.push(`lead_id.eq.${crmLeadId}`);
    if (contactId) orFilters.push(`contact_id.eq.${contactId}`);
    
    const { data: existingFuture, error: existingErr } = await supabase
      .from("crm_appointments")
      .select("id, title, start_time, end_time, meeting_link, assigned_to, status, lead_id, contact_id")
      .eq("workspace_id", workspace_id)
      .gt("start_time", nowIso)
      .not("status", "in", "(cancelled,canceled)")
      .or(orFilters.join(","))
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();
    
    if (existingErr) {
      console.error("[SCHEDULE] Duplicate-check error:", existingErr);
    }
    
    if (existingFuture) {
      console.log("[SCHEDULE] Duplicate guard hit. Existing future appointment:", existingFuture.id);
      
      // Format date/time in America/Sao_Paulo
      const dt = new Date(existingFuture.start_time);
      const dateStr = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
      const timeStr = dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      
      let attendantName: string | null = null;
      if (existingFuture.assigned_to) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", existingFuture.assigned_to)
          .maybeSingle();
        attendantName = prof?.full_name ?? null;
      }
      
      const message =
        `Este lead já possui um compromisso agendado para ${dateStr} às ${timeStr}` +
        (attendantName ? ` com ${attendantName}` : "") +
        `. Não é possível criar um novo agendamento enquanto este existir. ` +
        `Se necessário, ofereça reagendar ou cancelar o compromisso atual.`;
      
      return new Response(JSON.stringify({
        success: false,
        message,
        existing_appointment: {
          id: existingFuture.id,
          title: existingFuture.title,
          start_time: existingFuture.start_time,
          end_time: existingFuture.end_time,
          assigned_to: existingFuture.assigned_to,
          attendant_name: attendantName,
          meeting_link: existingFuture.meeting_link,
          status: existingFuture.status,
        }
      } as ScheduleResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  
  // Get available slots from ALL agents (sorted by proximity), restricted by agent's allowed attendants
  const allowedAttendants = await getAllowedAttendantsForAgent(supabase, workspace_id, agent_id);
  const allAgentSlots = await getAvailableSlotsAllAgents(
    supabase,
    workspace_id,
    preferred_date || null,
    7,
    allowedAttendants
  );
  
  // Check if we have configured agents or need fallback
  let effectiveAssignedTo: string | null = null;
  let attendantName = "nossa equipe";
  const useFallback = allAgentSlots.length === 0;
  
  if (useFallback) {
    console.log("[SCHEDULE] WARNING: No agent calendars configured, using fallback");
    const fallback = await getFallbackAttendant(supabase, workspace_id);
    if (fallback) {
      effectiveAssignedTo = fallback.id;
      attendantName = fallback.name;
    }
  }
  
  // Fetch company name from workspace
  let companyDisplayName = "DN.IA";
  const { data: workspaceInfo } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", workspace_id)
    .single();
  
  if (workspaceInfo?.company_id) {
    const { data: companyData } = await supabase
      .from("companies")
      .select("name")
      .eq("id", workspaceInfo.company_id)
      .single();
    
    if (companyData?.name) {
      companyDisplayName = companyData.name;
    }
  }
  
  // Fetch company or lead name and email for meeting title
  let companyName = "";
  let leadName = lead.name || "";
  let contactEmail: string | null = null;
  
  if (contactId) {
    const { data: contactInfo } = await supabase
      .from("crm_contacts")
      .select("company, name, email")
      .eq("id", contactId)
      .single();
    
    companyName = contactInfo?.company || "";
    leadName = contactInfo?.name || lead.name || "";
    contactEmail = contactInfo?.email || null;
    
    console.log("[SCHEDULE] Contact info - Name:", leadName, "Email:", contactEmail || "not set");
  }
  
  // Generate meeting title in standard format: DN.IA <> [EMPRESA] [NOME DO LEAD]
  const titleParts = [companyDisplayName, "<>"];
  if (companyName) {
    titleParts.push(companyName);
  }
  if (leadName && leadName !== companyName) {
    titleParts.push(leadName);
  }
  if (!companyName && !leadName) {
    titleParts.push("Lead");
  }
  const meetingTitle = titleParts.join(" ");
  
  // Get available slots for suggestions (use fallback if no agent calendars)
  const availableSlotsForSuggestions = useFallback 
    ? await getAvailableSlots(supabase, workspace_id, null, preferred_date || null)
    : allAgentSlots;
  
  // If no date/time specified, return suggestions (sorted by proximity)
  if (!preferred_date || !preferred_time) {
    const suggestions = useFallback
      ? availableSlotsForSuggestions.slice(0, 3).map((slot, index) => ({
          date: slot.date,
          time: slot.time,
          reason: index === 0 ? "Primeira disponibilidade" : 
                  index === 1 ? "Segunda opção" : "Terceira opção"
        }))
      : findClosestAlternativesFromAgentSlots(allAgentSlots, "", "", 3).map((slot, index) => ({
          date: slot.date,
          time: slot.time,
          reason: index === 0 ? "Primeira disponibilidade" : 
                  index === 1 ? "Segunda opção" : "Terceira opção"
        }));
    
    return new Response(JSON.stringify({
      success: false,
      suggested_alternatives: suggestions,
      needs_selection: true,
      message: suggestions.length > 0 
        ? `Para qual dia e horário você prefere? Tenho disponibilidade em: ${formatSuggestionsGrouped(suggestions)}`
        : "Não encontrei horários disponíveis nos próximos dias."
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  // Check if requested slot is available and select best agent via round-robin
  if (!useFallback) {
    const selectedSlot = await selectBestAgentForSlot(
      supabase,
      workspace_id,
      allAgentSlots,
      preferred_date,
      preferred_time,
      lead_id
    );
    
    if (selectedSlot) {
      effectiveAssignedTo = selectedSlot.agent_id;
      attendantName = selectedSlot.agent_name;
      console.log("[SCHEDULE] Selected agent:", attendantName, "for slot:", preferred_date, preferred_time);
    } else {
      // Slot not available, suggest alternatives (sorted by proximity)
      const alternatives = findClosestAlternativesFromAgentSlots(allAgentSlots, preferred_date, preferred_time, 3);
      
      if (alternatives.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          message: `Infelizmente ${formatDate(preferred_date)} às ${formatTime(preferred_time)} não está disponível e não encontrei outros horários. Gostaria de verificar outra semana?`
        } as ScheduleResponse), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      const altSuggestions = alternatives.map((slot, idx) => ({
        date: slot.date,
        time: slot.time,
        reason: `Opção ${idx + 1}`
      }));
      
      return new Response(JSON.stringify({
        success: false,
        needs_selection: true,
        suggested_alternatives: altSuggestions,
        message: `O horário das ${formatTime(preferred_time)} ${preferred_date ? `em ${formatDate(preferred_date)}` : ""} não está disponível. Posso oferecer: ${formatSuggestionsGrouped(altSuggestions)}. Qual prefere?`
      } as ScheduleResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  } else {
    // Fallback mode: check legacy slots
    const legacySlots = await getAvailableSlots(supabase, workspace_id, null, preferred_date);
    const requestedSlot = isSlotAvailable(legacySlots, preferred_date, preferred_time);
    
    if (!requestedSlot) {
      const alternatives = findClosestAlternatives(legacySlots, preferred_date, preferred_time, 2);
      
      if (alternatives.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          message: `Infelizmente ${formatDate(preferred_date)} às ${formatTime(preferred_time)} não está disponível e não encontrei outros horários. Gostaria de verificar outra semana?`
        } as ScheduleResponse), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      return new Response(JSON.stringify({
        success: false,
        needs_selection: true,
        suggested_alternatives: alternatives,
        message: `O horário das ${formatTime(preferred_time)} ${preferred_date ? `em ${formatDate(preferred_date)}` : ""} não está disponível. Posso oferecer: ${formatSuggestionsGrouped(alternatives)}. Qual prefere?`
      } as ScheduleResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  
  // Fetch agent calendar settings for duration (AFTER agent selection)
  if (effectiveAssignedTo) {
    const { data: agentCal } = await supabase
      .from("crm_agent_calendars")
      .select("default_appointment_duration")
      .eq("workspace_id", workspace_id)
      .eq("agent_id", effectiveAssignedTo)
      .maybeSingle();
    
    if (agentCal?.default_appointment_duration) {
      duration_minutes = agentCal.default_appointment_duration;
      console.log("[SCHEDULE] Using agent calendar duration:", duration_minutes, "minutes");
    }
  }

  // Create appointment with São Paulo timezone
  const saoPauloOffset = -3;
  const [year, month, day] = preferred_date.split('-').map(Number);
  const [hours, minutes] = preferred_time.split(':').map(Number);
  
  const startTimeLocal = new Date(Date.UTC(year, month - 1, day, hours - saoPauloOffset, minutes));
  const endTimeLocal = new Date(startTimeLocal);
  endTimeLocal.setMinutes(endTimeLocal.getMinutes() + duration_minutes);
  
  console.log("[SCHEDULE] Scheduling for São Paulo time:", preferred_date, preferred_time);
  console.log("[SCHEDULE] Assigned to:", effectiveAssignedTo, "Name:", attendantName);
  
  // Get additional attendees from request
  const requestAdditionalAttendees = request.additional_attendees || [];
  
  // Get assignee email for Google Calendar invite
  let assigneeEmail: string | null = null;
  if (effectiveAssignedTo) {
    const { data: assigneeProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", effectiveAssignedTo)
      .maybeSingle();
    
    assigneeEmail = assigneeProfile?.email || null;
    console.log("[SCHEDULE] Assignee email for calendar invite:", assigneeEmail);
  }
  
  // Analise padrao configurada para reunioes criadas pelo agente neste workspace
  const { data: meetingSettings } = await supabase
    .from("workspace_meeting_settings")
    .select("default_analysis_playbook_id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const defaultAnalysisPlaybookId =
    (meetingSettings as { default_analysis_playbook_id?: string | null } | null)?.default_analysis_playbook_id ?? null;

  const { data: appointment, error: appointmentError } = await supabase
    .from("crm_appointments")
    .insert({
      workspace_id,
      lead_id: crmLeadId,
      contact_id: contactId,
      assigned_to: effectiveAssignedTo || null,
      title: meetingTitle,
      description: description || null,
      start_time: startTimeLocal.toISOString(),
      end_time: endTimeLocal.toISOString(),
      duration_minutes,
      status: "scheduled",
      reminder_1_hours: 24,
      reminder_2_hours: 1,
      additional_attendees: requestAdditionalAttendees.length > 0 ? requestAdditionalAttendees : null,
      analysis_playbook_id: defaultAnalysisPlaybookId
    })
    .select("id")
    .single();
  
  if (appointmentError) {
    console.error("[SCHEDULE] Error creating appointment:", appointmentError);
    return new Response(JSON.stringify({
      success: false,
      message: "Erro ao criar agendamento. Por favor, tente novamente."
    } as ScheduleResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  
  console.log("[SCHEDULE] Appointment created:", appointment.id);

  // Signal Agendamento event to widget session if exists + dispatch META CAPI Schedule
  {
    // Find inbox lead_id from contact
    const { data: inboxLead } = await supabase
      .from("leads")
      .select("id")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Widget session flag (only when there's a widget session)
    if (inboxLead) {
      const { data: widgetSession } = await supabase
        .from("widget_sessions")
        .select("id, meta_events_fired")
        .eq("lead_id", inboxLead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (widgetSession) {
        const fired: string[] = Array.isArray(widgetSession.meta_events_fired) ? widgetSession.meta_events_fired as string[] : [];
        if (!fired.includes("pending:Schedule") && !fired.includes("acked:Schedule")) {
          fired.push("pending:Schedule");
          await supabase
            .from("widget_sessions")
            .update({ meta_events_fired: fired })
            .eq("id", widgetSession.id);
          console.log("[SCHEDULE] Schedule event flagged for widget session", widgetSession.id);
        }
      }
    }

    // --- META CAPI: Send Schedule event server-side (independent of widget_session / inboxLead) ---
    try {
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("company_id")
        .eq("id", workspace_id)
        .single();

      if (wsData?.company_id) {
        const { data: company } = await supabase
          .from("companies")
          .select("meta_pixel_id, meta_access_token")
          .eq("id", wsData.company_id)
          .maybeSingle();

        if (company?.meta_pixel_id && company?.meta_access_token) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
          const capiPayload = {
            event_name: "Schedule",
            lead_id: inboxLead?.id || lead_id || null,
            contact_id: contactId,
            workspace_id,
            company_id: wsData.company_id,
            pixel_id: company.meta_pixel_id,
            custom_data: {
              content_name: meetingTitle,
              content_category: "agendamento",
              appointment_id: appointment.id,
              scheduled_date: `${preferred_date} ${preferred_time}`,
            },
          };

          console.log(`[SCHEDULE] META CAPI request: pixel_id=${company.meta_pixel_id} event=Schedule contact=${contactId} lead=${capiPayload.lead_id} custom_data=${JSON.stringify(capiPayload.custom_data)}`);

          const capiResp = await fetch(`${supabaseUrl}/functions/v1/meta-conversions-api`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify(capiPayload),
          });
          const respBody = await capiResp.text().catch(() => "");
          if (capiResp.ok) {
            console.log(`[SCHEDULE] META CAPI response: status=${capiResp.status} body=${respBody.slice(0, 300)}`);
          } else {
            console.error(`[SCHEDULE] META CAPI failed: status=${capiResp.status} body=${respBody.slice(0, 300)}`);
          }
        } else {
          console.log(`[SCHEDULE] Skipping META CAPI: pixelId=${company?.meta_pixel_id || null} hasToken=${!!company?.meta_access_token} (configure meta_pixel_id + meta_access_token in companies)`);
        }
      } else {
        console.log(`[SCHEDULE] Skipping META CAPI: no company_id for workspace=${workspace_id}`);
      }
    } catch (capiErr) {
      console.error("[SCHEDULE] META CAPI dispatch error:", capiErr);
    }
  }
  
  // Build complete attendees list including assignee
  const additionalAttendees: string[] = [...requestAdditionalAttendees];
  
  // Add assignee email if not already in list and not same as contact
  if (assigneeEmail && !additionalAttendees.includes(assigneeEmail) && assigneeEmail !== contactEmail) {
    additionalAttendees.push(assigneeEmail);
    console.log("[SCHEDULE] Added assignee to attendees:", assigneeEmail);
  }
  
  console.log("[SCHEDULE] Creating Google Calendar event with attendees:", {
    primary: contactEmail || "none",
    additional: additionalAttendees.length,
    emails: additionalAttendees
  });
  
  // Create Google Calendar event with contact email and additional attendees
  const googleResult = await createGoogleCalendarEvent(
    supabase,
    workspace_id,
    appointment.id,
    meetingTitle,
    description || null,
    startTimeLocal.toISOString(),
    endTimeLocal.toISOString(),
    contactEmail || undefined,  // Pass contact email as primary attendee
    additionalAttendees          // Pass additional attendees including assignee
  );
  
  let meetingLink = googleResult.meeting_link;
  
  if (!meetingLink) {
    meetingLink = generatePlaceholderMeetingLink();
    await supabase
      .from("crm_appointments")
      .update({ meeting_link: meetingLink })
      .eq("id", appointment.id);
  }
  
  // Create reminders
  const reminder1Time = new Date(startTimeLocal);
  reminder1Time.setHours(reminder1Time.getHours() - 24);
  
  const reminder2Time = new Date(startTimeLocal);
  reminder2Time.setHours(reminder2Time.getHours() - 1);
  
  await supabase.from("crm_appointment_reminders").insert([
    {
      appointment_id: appointment.id,
      reminder_type: "whatsapp",
      scheduled_time: reminder1Time.toISOString(),
      status: "pending"
    },
    {
      appointment_id: appointment.id,
      reminder_type: "whatsapp",
      scheduled_time: reminder2Time.toISOString(),
      status: "pending"
    }
  ]);
  
  // Responsavel da atividade herda o dono do card: e ele quem responde pelo
  // atendimento e quem recebe o credito da avaliacao. O atendente resolvido
  // pela disponibilidade cobre apenas cards ainda sem dono.
  let activityAssignedTo: string | null = effectiveAssignedTo || null;
  if (crmLeadId) {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select("assigned_to")
      .eq("id", crmLeadId)
      .maybeSingle();
    if (lead?.assigned_to) activityAssignedTo = lead.assigned_to as string;
  }

  // Create CRM activity for "Next Steps" (linked to appointment via FK)
  await supabase.from("crm_lead_activities").insert({
    workspace_id,
    lead_id: crmLeadId,
    appointment_id: appointment.id,
    type: "meeting",
    title: meetingTitle,
    description: `Reunião agendada com ${attendantName} via WhatsApp`,
    scheduled_at: startTimeLocal.toISOString(),
    duration_minutes,
    status: "pending",
    assigned_to: activityAssignedTo,
    analysis_playbook_id: defaultAnalysisPlaybookId
  });
  
  console.log("[SCHEDULE] CRM activity created for lead:", crmLeadId);
  
  // Move lead to "Reunião agendada" stage automatically
  if (crmLeadId) {
    try {
      // Find the "MQL - Reunião agendada" stage (prioriza nome exato, com fallbacks)
      let { data: meetingStage } = await supabase
        .from('crm_pipeline_stages')
        .select('id')
        .eq('workspace_id', workspace_id)
        .eq('name', 'MQL - Reunião agendada')
        .maybeSingle();

      // Fallback 1: ilike '%mql%reuni%'
      if (!meetingStage) {
        const { data } = await supabase
          .from('crm_pipeline_stages')
          .select('id')
          .eq('workspace_id', workspace_id)
          .ilike('name', '%mql%reuni%')
          .order('order', { ascending: true })
          .limit(1)
          .maybeSingle();
        meetingStage = data;
      }

      // Fallback 2 (legado): qualquer estágio de reunião/meeting
      if (!meetingStage) {
        const { data } = await supabase
          .from('crm_pipeline_stages')
          .select('id')
          .eq('workspace_id', workspace_id)
          .or('name.ilike.%reunião%,name.ilike.%reuniao%,name.ilike.%meeting%')
          .order('order', { ascending: true })
          .limit(1)
          .maybeSingle();
        meetingStage = data;
      }
      
      if (meetingStage) {
        // Get current lead stage AND status
        const { data: currentLead } = await supabase
          .from('crm_leads')
          .select('stage_id, status')
          .eq('id', crmLeadId)
          .single();
        
        // Only move if not already in meeting stage
        if (currentLead && currentLead.stage_id !== meetingStage.id) {
          // Build update data - include reactivation if lead was lost
          // Also ensure assigned_to is set to the agent handling the meeting
          const updateData: Record<string, any> = {
            stage_id: meetingStage.id,
            moved_at: new Date().toISOString(),
            ...(effectiveAssignedTo ? { assigned_to: effectiveAssignedTo } : {})
          };
          
          // If lead was lost, reactivate it
          const wasLost = currentLead.status === "lost";
          if (wasLost) {
            updateData.status = "open";
            updateData.closed_at = null;
            updateData.loss_reason_id = null;
            console.log("[SCHEDULE] Reactivating lost lead due to new appointment");
          }
          
          // Update lead stage (and status if reactivating)
          await supabase
            .from('crm_leads')
            .update(updateData)
            .eq('id', crmLeadId);
          
          // Register in history with appropriate action
          await supabase.from('crm_lead_history').insert({
            lead_id: crmLeadId,
            from_stage_id: currentLead.stage_id,
            to_stage_id: meetingStage.id,
            moved_by: 'auto-schedule',
            action: wasLost ? 'reopened' : 'stage_change',
            reason: wasLost 
              ? 'Lead reativado automaticamente - nova reunião agendada via chat'
              : 'Reunião agendada automaticamente via chat'
          });
          
          console.log("[SCHEDULE] Lead moved to 'Reunião agendada' stage:", meetingStage.id, wasLost ? "(reactivated)" : "");
        } else if (currentLead && currentLead.status === "lost") {
          // Lead is already in meeting stage but was lost - just reactivate
          await supabase
            .from('crm_leads')
            .update({
              status: "open",
              closed_at: null,
              loss_reason_id: null,
              moved_at: new Date().toISOString()
            })
            .eq('id', crmLeadId);
          
          await supabase.from('crm_lead_history').insert({
            lead_id: crmLeadId,
            from_stage_id: currentLead.stage_id,
            to_stage_id: currentLead.stage_id,
            moved_by: 'auto-schedule',
            action: 'reopened',
            reason: 'Lead reativado automaticamente - nova reunião agendada via chat'
          });
          
          console.log("[SCHEDULE] Lost lead reactivated (already in meeting stage)");
        } else {
          console.log("[SCHEDULE] Lead already in meeting stage or stage not changed");
        }
      } else {
        console.log("[SCHEDULE] No 'Reunião agendada' stage found in workspace");
      }
      
      // Trigger DNIA psychology analysis in background (fire and forget)
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
        
        if (supabaseUrl && supabaseAnonKey) {
          // Fire and forget - don't await
          fetch(`${supabaseUrl}/functions/v1/analyze-lead-psychology`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({ 
              leadId: crmLeadId, 
              workspaceId: workspace_id 
            }),
          }).then(res => {
            console.log("[SCHEDULE] Psychology analysis triggered, status:", res.status);
          }).catch(err => {
            console.error("[SCHEDULE] Failed to trigger psychology analysis:", err);
          });
          console.log("[SCHEDULE] Triggered background psychology analysis for lead:", crmLeadId);
        }
      } catch (analysisError) {
        console.error("[SCHEDULE] Error triggering psychology analysis:", analysisError);
      }
    } catch (stageError) {
      console.error("[SCHEDULE] Error moving lead to meeting stage:", stageError);
      // Don't fail the whole operation if stage move fails
    }
  }
  
  // Send confirmation email (async, don't block) - skip if called from reschedule
  if (!skipEmail) {
    sendAppointmentEmail(supabase, "confirmation", contactId, workspace_id, {
      title: meetingTitle,
      startTime: startTimeLocal.toISOString(),
      endTime: endTimeLocal.toISOString(),
      meetingLink,
      assignedTo: effectiveAssignedTo || undefined
    }).catch(err => console.error("[SCHEDULE] Email error:", err));
  }
  
  return new Response(JSON.stringify({
    success: true,
    appointment_id: appointment.id,
    scheduled_date: preferred_date,
    scheduled_time: preferred_time,
    meeting_link: meetingLink,
    message: `Perfeito! Agendei sua reunião com ${attendantName} para ${formatDate(preferred_date)} às ${formatTime(preferred_time)}.

Acesse pelo link: ${meetingLink}

Você receberá um lembrete 1 hora antes.`
  } as ScheduleResponse), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const request: ScheduleRequest = await req.json();
    const action = request.action || "schedule"; // Default to schedule for backward compatibility
    
    console.log("[SCHEDULE] Request received:", { 
      action, 
      lead_id: request.lead_id,
      workspace_id: request.workspace_id,
      agent_id: request.agent_id,
      assigned_to: request.assigned_to,
      title: request.title, 
      preferred_date: request.preferred_date, 
      preferred_time: request.preferred_time 
    });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    // Route to appropriate handler based on action
    switch (action) {
      case "info":
        return await handleInfo(supabase, request);
      
      case "list":
        return await handleList(supabase, request);
      
      case "check":
        return await handleCheck(supabase, request);
      
      case "cancel":
        return await handleCancel(supabase, request);
      
      case "reschedule":
        return await handleReschedule(supabase, request);
      
      case "add_attendee":
        return await handleAddAttendee(supabase, request);
      
      case "schedule":
      default:
        return await handleSchedule(supabase, request);
    }
    
  } catch (error) {
    console.error("[SCHEDULE] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Erro interno ao processar agendamento."
    } as ScheduleResponse), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
