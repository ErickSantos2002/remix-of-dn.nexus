// Tipos de dominio da Analise de Atendimento por Playbook.
//
// As tabelas desta feature ainda nao existem em src/integrations/supabase/types.ts
// (auto-gerado pelo Lovable/Supabase). Ate a regeneracao, as queries usam cast
// `as any` e a tipagem do lado do app vem daqui.
//
// O catalogo de habitos comportamentais vive em src/lib/analysisCatalog.ts
// (espelho de supabase/functions/_shared/habitCatalog.ts).

/** Tipos de atividade que produzem transcricao e podem ser avaliados. */
export type AnalysisActivityType = "meeting" | "demo" | "phone_call";

export const ANALYSIS_ACTIVITY_TYPES: AnalysisActivityType[] = ["meeting", "demo", "phone_call"];

export const ANALYSIS_ACTIVITY_TYPE_LABELS: Record<AnalysisActivityType, string> = {
  meeting: "Reunião",
  demo: "Demonstração",
  phone_call: "Ligação",
};

/**
 * Traduz o tipo de uma atividade do CRM para o tipo de análise correspondente.
 * Retorna null para atividades que não produzem transcrição (e-mail, tarefa...).
 * `reschedule` é uma reunião remarcada, então cai em "meeting".
 */
export function activityTypeToAnalysisType(activityType: string): AnalysisActivityType | null {
  switch (activityType) {
    case "meeting":
    case "reschedule":
      return "meeting";
    case "demo":
      return "demo";
    case "call":
      return "phone_call";
    default:
      return null;
  }
}

export type AnalysisPlaybookStatus = "draft" | "active" | "archived";
export type RubricVersionStatus = "draft" | "active" | "superseded";

/** A entidade "Análise": playbook + rubrica + diretriz, cadastrada na área EMPRESA. */
export interface AnalysisPlaybook {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  activity_types: AnalysisActivityType[];
  playbook_md: string | null;
  playbook_filename: string | null;
  /** Preenchido quando o admin aprova o Markdown convertido; libera a extração da rubrica. */
  md_approved_at: string | null;
  guidelines: string | null;
  ai_model: string;
  /**
   * Padrão dos tipos em `activity_types`. Pré-selecionada e travada no primeiro
   * atendimento de cada tipo em um card — ver `LeadActivities.tsx`.
   */
  is_default: boolean;
  status: AnalysisPlaybookStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RubricCoverageSectionStatus = "covered" | "no_criteria" | "failed";

/** Um trecho do playbook processado pela extração de rubrica. */
export interface RubricCoverageSection {
  index: number;
  /** Primeiro heading do trecho — identifica a região do documento. */
  label: string;
  chars: number;
  headings: number;
  /** Quantas seções "Critério de Homologação" o trecho contém. */
  homologation_sections: number;
  criteria_count: number;
  status: RubricCoverageSectionStatus;
  /** Justificativa do modelo quando o trecho não gerou critérios. */
  note: string | null;
}

/**
 * Relatório de cobertura gravado por playbook-extract-rubric: prova de que todo
 * o documento foi processado e do destino de cada trecho. Ausente em versões
 * geradas antes da extração por lotes.
 */
export interface RubricCoverageReport {
  sections: RubricCoverageSection[];
  sections_total: number;
  sections_no_criteria: number;
  sections_failed: number;
  homologation_total: number;
  homologation_covered: number;
  /** Critérios descartados pelo teto global (MAX_CRITERIA). */
  criteria_truncated: number;
  model: string;
}

export interface AnalysisRubricVersion {
  id: string;
  playbook_id: string;
  company_id: string;
  version: number;
  status: RubricVersionStatus;
  coverage_report: RubricCoverageReport | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisRubricCriterion {
  id: string;
  version_id: string;
  company_id: string;
  /** Slug estável entre versões — base do rastreio de recorrência. */
  criterion_key: string;
  stage: string | null;
  name: string;
  description: string | null;
  weight: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =====================================================
// Resultados da avaliação
// =====================================================

/** `not_applicable` = a etapa do critério não aconteceu na reunião; fora do score. */
export type CriterionVerdict = "met" | "partial" | "missed" | "not_applicable";
/** `meeting_chunks` = transcrição capturada ao vivo, quando o Daily não guardou arquivo. */
export type AnalysisSourceType = "daily_recording" | "call" | "meeting_chunks";
export type AnalysisResultStatus = "processing" | "done" | "failed";

export interface CriterionResult {
  criterion_key: string;
  /** Cópia do rótulo da rubrica no momento da avaliação (a versão pode ser superseded depois). */
  name?: string;
  stage?: string | null;
  weight?: number;
  verdict: CriterionVerdict;
  /** Citação literal da transcrição que sustenta o veredicto. */
  evidence: string;
  /**
   * Falso quando o trecho não foi encontrado na transcrição — sinal de que a IA
   * parafraseou em vez de citar. Não invalida o veredicto, mas indica que
   * aquela evidência não serve como prova.
   */
  evidence_verified?: boolean;
  feedback: string;
}

export interface AnalysisStrength {
  title: string;
  evidence: string;
  evidence_verified?: boolean;
}

export interface AnalysisImprovement {
  criterion_key: string | null;
  title: string;
  suggestion: string;
}

export interface AnalysisHabit {
  habit_key: string;
  observed: "positive" | "negative";
  evidence: string;
}

/** Falha que já havia sido apontada antes e voltou a ocorrer. Não altera o score. */
export interface AnalysisRecurrence {
  point_type: "criterion" | "habit";
  point_key: string;
  label: string;
  occurrences: number;
  first_seen_at: string;
}

/** Ponto que estava em aberto e foi atendido nesta avaliação. */
export interface AnalysisCorrection {
  point_type: "criterion" | "habit";
  point_key: string;
  label: string;
  occurrences: number;
}

export interface ActivityAnalysisResult {
  id: string;
  workspace_id: string;
  company_id: string;
  activity_id: string | null;
  lead_id: string | null;
  seller_id: string | null;
  /** Snapshot do nome na hora da avaliação — o app nem sempre consegue ler `profiles`. */
  seller_name: string | null;
  source_type: AnalysisSourceType;
  source_id: string;
  playbook_id: string | null;
  rubric_version_id: string | null;
  /** 0–100, calculado em código (soma ponderada) — nunca pelo modelo. */
  score: number | null;
  summary_md: string | null;
  criteria_results: CriterionResult[];
  strengths: AnalysisStrength[];
  improvements: AnalysisImprovement[];
  habits: AnalysisHabit[];
  recurrences: AnalysisRecurrence[];
  corrected: AnalysisCorrection[];
  points_applied: boolean;
  model: string | null;
  status: AnalysisResultStatus;
  error_message: string | null;
  /** Preenchido quando um admin descarta a avaliação: sai das métricas, continua visível. */
  disregarded_at: string | null;
  disregarded_by: string | null;
  /**
   * Quando o atendimento aconteceu — eixo de tempo do painel de Desempenho.
   * Diferente de `created_at`, que é quando a IA avaliou: as duas divergem ao
   * avaliar em lote um período passado.
   */
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// Evolução do vendedor
// =====================================================

export type DevelopmentPointType = "criterion" | "habit";
export type DevelopmentPointStatus = "open" | "recurrent" | "corrected";

export interface SellerDevelopmentPoint {
  id: string;
  company_id: string;
  seller_id: string;
  point_type: DevelopmentPointType;
  point_key: string;
  /** Nome legível registrado junto do ponto; ausente em registros antigos. */
  label: string | null;
  playbook_id: string | null;
  status: DevelopmentPointStatus;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  corrected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerAchievement {
  id: string;
  company_id: string;
  seller_id: string;
  achievement_key: string;
  meta: Record<string, unknown>;
  earned_at: string;
}

export interface SellerCoachingBrief {
  id: string;
  company_id: string;
  seller_id: string;
  brief_md: string;
  model: string | null;
  generated_by: string | null;
  generated_at: string;
}

// =====================================================
// Agregações dos painéis
// =====================================================

export interface SellerScorePoint {
  /** Data ISO (yyyy-MM-dd) do agrupamento diário. */
  date: string;
  score: number;
  count: number;
}

export interface SellerRankingRow {
  seller_id: string;
  seller_name: string;
  avg_score: number;
  analyses_count: number;
  /** Diferença entre a média da segunda e da primeira metade do período. */
  trend: number;
  recurrent_points: number;
}
