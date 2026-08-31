// Estado de presença de chat derivado (spec §8, §10.1).
import type { PillStatus } from "@/components/dn/Pill";
import { AgentCalendar, isWithinWorkingHours } from "./workhours";

export type PresenceState = "available" | "outside_hours" | "paused" | "at_capacity";

export interface PresenceInput {
  calendar: Partial<AgentCalendar> | null;
  holidays: ReadonlySet<string>;
  isAcceptingLeads: boolean;
  load: number;
  maxConcurrentLeads: number;
  at?: Date;
}

export function computePresence(input: PresenceInput): PresenceState {
  if (!isWithinWorkingHours(input.calendar, input.holidays, input.at)) return "outside_hours";
  if (!input.isAcceptingLeads) return "paused";
  if (input.load >= input.maxConcurrentLeads) return "at_capacity";
  return "available";
}

export const PRESENCE_LABEL: Record<PresenceState, string> = {
  available: "Disponível",
  outside_hours: "Fora do horário",
  paused: "Pausado",
  at_capacity: "Sem capacidade",
};

export const PRESENCE_PILL: Record<PresenceState, PillStatus> = {
  available: "success",
  outside_hours: "neutral",
  paused: "warning",
  at_capacity: "warning",
};
