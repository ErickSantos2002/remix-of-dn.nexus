// Vocabulário das atividades do card (crm_lead_activities). Compartilhado entre
// a aba Atividades do card e a condição "Atividade" dos Fluxos de CRM.
// Os valores são os literais gravados em crm_lead_activities.type/.status —
// conditions.ts do flow-worker (Deno) repete essas strings.

export interface ActivityOption {
  value: string;
  label: string;
}

export const ACTIVITY_TYPE_OPTIONS: ActivityOption[] = [
  { value: "meeting", label: "Reunião" },
  { value: "call", label: "Ligação" },
  { value: "follow_up", label: "Follow-up" },
  { value: "email", label: "Email" },
  { value: "demo", label: "Demo" },
  { value: "task", label: "Tarefa" },
  { value: "reschedule", label: "Reagendamento de reunião" },
];

export const ACTIVITY_STATUS_OPTIONS: ActivityOption[] = [
  { value: "pending", label: "Pendente" },
  { value: "completed", label: "Concluída" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelada" },
];

export function activityTypeLabel(value: string): string {
  return ACTIVITY_TYPE_OPTIONS.find((t) => t.value === value)?.label || value;
}

export function activityStatusLabel(value: string): string {
  return ACTIVITY_STATUS_OPTIONS.find((s) => s.value === value)?.label || value;
}
