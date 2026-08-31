// Tipos do motor de roteamento centralizado.
// Spec: docs/superpowers/specs/2026-08-28-centralizar-roteamento-design.md
export interface RoutingConfig {
  strategy: "least_loaded" | "round_robin";
  fallback_strategy: "least_loaded" | "round_robin" | "queue";
  auto_assign: boolean;
  category_matching: boolean;
  max_leads_per_agent: number;
  respect_card_owner: boolean;
  scheduling_strategy: "least_loaded" | "round_robin";
  scheduling_load_window_days: number;
}

export interface AgentCalendar {
  work_days: string[];
  work_start_time: string; // "HH:MM"
  work_end_time: string;   // "HH:MM"
  timezone: string;        // IANA
}

// Mesmo default que os agendadores já aplicam (schedule-widget/index.ts:648-654).
export const DEFAULT_CALENDAR: AgentCalendar = {
  work_days: ["MON", "TUE", "WED", "THU", "FRI"],
  work_start_time: "09:00",
  work_end_time: "18:00",
  timezone: "America/Sao_Paulo",
};

export interface ChatCandidate {
  user_id: string;
  is_accepting_leads: boolean;
  max_concurrent_leads: number;
  last_activity_at: string | null;
  load: number;
  name: string | null;
  email: string | null;
}

export interface ChatResolution {
  userId: string | null;
  userName: string | null;
  /** true quando atribuído pelo fallback que ignora jornada/pausa (spec §6 passo 5). */
  viaFallback: boolean;
  /** Pool elegível no momento da decisão (para notificações e diagnóstico). */
  pool: ChatCandidate[];
}
