// Jornada de trabalho — mesma semântica dos agendadores (spec §8).
// ESPELHADO em src/lib/routing/workhours.ts (Task 9); alterações valem nos dois.
import { AgentCalendar, DEFAULT_CALENDAR } from "./types.ts";

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Partes locais (dia da semana, data ISO, minutos desde 00:00) de um instante num fuso.
 * `crm_agent_calendars.timezone` é texto livre sem CHECK — um IANA inválido faz
 * `Intl.DateTimeFormat` lançar `RangeError`; sem o fallback, isso perde o lead
 * (orchestrator engole o erro e não enfileira) ou derruba o tick do worker (500).
 */
export function localParts(at: Date, timezone: string): { weekday: string; dateISO: string; minutes: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = buildFormatter(timezone);
  } catch {
    console.warn(`workhours.localParts: fuso horário inválido "${timezone}", usando fallback ${DEFAULT_CALENDAR.timezone}`);
    fmt = buildFormatter(DEFAULT_CALENDAR.timezone);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const weekday = String(parts.weekday || "").toUpperCase().slice(0, 3);
  const dateISO = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour) % 24; // alguns runtimes formatam meia-noite como "24"
  return { weekday, dateISO, minutes: hour * 60 + Number(parts.minute) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Dentro da jornada = dia útil do atendente, no fuso dele, fora de feriado.
 * `holidays`: datas "YYYY-MM-DD" de crm_holidays do workspace; a comparação usa
 * o "hoje" do fuso do atendente (spec §8). Sem calendário, vale DEFAULT_CALENDAR.
 * Início inclusivo, fim exclusivo (09:00 conta, 18:00 não).
 */
export function isWithinWorkingHours(
  calendar: Partial<AgentCalendar> | null,
  holidays: ReadonlySet<string>,
  at: Date = new Date(),
): boolean {
  const cal: AgentCalendar = {
    work_days: calendar?.work_days?.length ? calendar.work_days : DEFAULT_CALENDAR.work_days,
    work_start_time: calendar?.work_start_time || DEFAULT_CALENDAR.work_start_time,
    work_end_time: calendar?.work_end_time || DEFAULT_CALENDAR.work_end_time,
    timezone: calendar?.timezone || DEFAULT_CALENDAR.timezone,
  };
  const { weekday, dateISO, minutes } = localParts(at, cal.timezone);
  if (!DAY_KEYS.includes(weekday)) return false;
  if (!cal.work_days.includes(weekday)) return false;
  if (holidays.has(dateISO)) return false;
  return minutes >= toMinutes(cal.work_start_time) && minutes < toMinutes(cal.work_end_time);
}
