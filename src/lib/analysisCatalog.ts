// Rótulos em português da Análise de Atendimento.
//
// ESPELHO de supabase/functions/_shared/habitCatalog.ts — o backend é a fonte
// canônica (as chaves entram no prompt e são gravadas no banco); aqui ficam só
// os rótulos usados na renderização. Ao adicionar/remover um hábito lá,
// atualize esta lista.
//
// Edge functions não conseguem importar de src/, por isso a duplicação.

import type { CriterionVerdict, DevelopmentPointStatus } from "@/types/analysis";

export const HABIT_LABELS: Record<string, string> = {
  escuta_ativa: "Escuta ativa",
  proporcao_de_fala: "Proporção de fala",
  perguntas_abertas: "Perguntas abertas",
  exploracao_de_dor: "Exploração da dor",
  foco_no_cliente: "Foco no cliente",
  clareza_da_explicacao: "Clareza da explicação",
  tratamento_de_objecao: "Tratamento de objeção",
  controle_da_conducao: "Condução da reunião",
  confirmacao_de_entendimento: "Confirmação de entendimento",
  proximo_passo_definido: "Próximo passo definido",
  pressao_indevida: "Pressão indevida",
  postura_consultiva: "Postura consultiva",
};

export function habitLabel(key: string): string {
  return HABIT_LABELS[key] ?? key;
}

export const VERDICT_LABELS: Record<CriterionVerdict, string> = {
  met: "Atendido",
  partial: "Parcial",
  missed: "Não atendido",
  not_applicable: "Não se aplica",
};

/** Classe de badge semântica por veredicto (tokens do Design System). */
export const VERDICT_BADGE_CLASS: Record<CriterionVerdict, string> = {
  met: "badge-success",
  partial: "badge-warning",
  missed: "badge-accent",
  not_applicable: "badge-neutral",
};

export const POINT_STATUS_LABELS: Record<DevelopmentPointStatus, string> = {
  open: "Em aberto",
  recurrent: "Recorrente",
  corrected: "Corrigido",
};

export const ACHIEVEMENT_LABELS: Record<string, { label: string; description: string }> = {
  primeira_analise: { label: "Primeira avaliação", description: "Teve o primeiro atendimento avaliado." },
  score_70: { label: "Consistência", description: "Alcançou 70 pontos em um atendimento." },
  score_85: { label: "Alta performance", description: "Alcançou 85 pontos em um atendimento." },
  score_95: { label: "Excelência", description: "Alcançou 95 pontos em um atendimento." },
  primeira_correcao: { label: "Evolução", description: "Corrigiu um ponto que estava em aberto." },
  tres_correcoes: { label: "Em transformação", description: "Corrigiu três pontos de desenvolvimento." },
  sequencia_3_melhorias: {
    label: "Sequência de evolução",
    description: "Melhorou o score em três avaliações seguidas.",
  },
  dez_analises: { label: "Rodagem", description: "Teve dez atendimentos avaliados." },
};

export function achievementLabel(key: string): string {
  return ACHIEVEMENT_LABELS[key]?.label ?? key;
}

/** Faixa de cor do score, usada em badges e no destaque do modal. */
export function scoreTone(score: number | null): "success" | "warning" | "destructive" | "muted" {
  if (score === null) return "muted";
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "destructive";
}

export function scoreTextClass(score: number | null): string {
  const tone = scoreTone(score);
  if (tone === "success") return "text-success";
  if (tone === "warning") return "text-warning";
  if (tone === "destructive") return "text-destructive";
  return "text-muted-foreground";
}

/** Faixas de score usadas nos gráficos (mesmos limiares de `scoreTone`). */
export const SCORE_BANDS = [
  { label: "80 a 100", color: "hsl(var(--success))" },
  { label: "60 a 79", color: "hsl(var(--warning))" },
  { label: "Abaixo de 60", color: "hsl(var(--destructive))" },
] as const;

/** Cor da faixa do score, para uso direto em SVG/gráficos. */
export function scoreBandColor(score: number | null): string {
  const tone = scoreTone(score);
  if (tone === "success") return "hsl(var(--success))";
  if (tone === "warning") return "hsl(var(--warning))";
  if (tone === "destructive") return "hsl(var(--destructive))";
  return "hsl(var(--muted-foreground))";
}


/**
 * Converte uma chave em snake_case num rótulo legível.
 * Rede de segurança para pontos registrados antes de o label ser persistido —
 * melhor "Validou percepcao de valor antes do investimento" do que a chave crua.
 */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
