// Vocabulários fixos do formulário de qualificação do widget de agendamento.
// ÚNICA fonte de verdade: usados na config do widget (SchedulingWidgets.tsx) e
// nos catálogos da condição dos Fluxos (BranchRulesEditor). Os textos precisam
// bater EXATAMENTE com o que o formulário público envia como revenue/job_title/
// employee_count — o gate ICP do schedule-widget faz includes() estrito e o
// flow-worker compara igualdade (case-insensitive) contra crm_contacts.
export const REVENUE_OPTIONS = [
  "Até R$ 100 mil por mês",
  "Entre R$ 100 mil e R$ 500 mil por mês",
  "Entre R$ 500 mil e R$ 1 milhão por mês",
  "Entre R$ 1 milhão e R$ 3 milhões por mês",
  "Entre R$ 3 milhões e R$ 5 milhões por mês",
  "Acima de R$ 5 milhões por mês",
];

export const JOB_TITLE_OPTIONS = [
  "CEO / Fundador",
  "Diretor(a)",
  "Gerente / Coordenador(a)",
  "Analista / Especialista",
  "Consultor(a)",
  "Outro",
];

export const EMPLOYEE_OPTIONS = ["Individual", "2 - 10", "11 - 25", "26 - 49", "Acima de 50"];
