// Memoria de evolucao do vendedor: pontos de desenvolvimento e conquistas.
//
// Maquina de estados de um ponto (criterio da rubrica ou habito transversal):
//
//   missed  -> nao existe ponto  => cria como 'open' (occurrences = 1)
//   missed  -> ponto open        => vira 'recurrent' (occurrences += 1)
//   missed  -> ponto recurrent   => segue 'recurrent' (occurrences += 1)
//   missed  -> ponto corrected   => volta a 'recurrent' (occurrences += 1)
//   met     -> ponto open/recurrent => vira 'corrected' (corrected_at = agora)
//   partial -> nao altera estado (nem pune nem premia)
//
// Regredir depois de corrigir E recorrencia: por isso o ponto volta para
// 'recurrent', e nao para 'open'.
//
// Recorrencia gera ALERTA, nunca penalidade no score.
//
// Idempotencia: quem chama so aplica pontos quando o resultado ainda nao teve
// points_applied = true, para que reanalisar a mesma reuniao nao infle contagens.
//
// Descarte: como a maquina e incremental, o efeito de uma avaliacao fica
// embutido no ponto e nao da para subtrai-lo. Desconsiderar uma avaliacao
// dispara rebuildSellerMemory(), que refaz a sequencia inteira sem ela.

import { habitLabel } from "./habitCatalog.ts";
import type { Verdict } from "./analysisScoring.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export type PointType = "criterion" | "habit";
export type PointStatus = "open" | "recurrent" | "corrected";

/**
 * Peso minimo para um criterio 'missed' abrir/reincidir ponto de desenvolvimento.
 *
 * Com rubricas grandes (100+ criterios), cada falha de higiene abriria um ponto
 * e a memoria de coaching viraria ruido: 30-40 pontos novos por reuniao, alertas
 * de recorrencia sem significado. So falhas em criterios importantes (peso >= 3)
 * entram no radar. 'met' CORRIGE ponto aberto em qualquer peso — ponto criado
 * antes desta regra (ou com peso posteriormente reduzido) ainda pode ser fechado.
 *
 * A regra vive aqui para valer igualmente no fluxo ao vivo (evaluate) e no
 * replay (rebuild-points): as duas trajetorias precisam produzir a mesma memoria.
 */
export const DEV_POINT_MIN_WEIGHT = 3;

export interface PointOutcome {
  point_type: PointType;
  point_key: string;
  label: string;
  occurrences: number;
  first_seen_at: string;
}

export interface ApplyPointsInput {
  supabase: SB;
  companyId: string;
  sellerId: string;
  playbookId: string | null;
  /**
   * Veredicto por criterio da rubrica (escopo: playbook).
   * `weight` ausente = criterio de dados antigos, tratado como eligivel.
   */
  criterionVerdicts: Array<{ criterion_key: string; label: string; verdict: Verdict; weight?: number }>;
  /** Habitos observados (escopo: transversal, playbook_id nulo). */
  habitObservations: Array<{ habit_key: string; observed: "positive" | "negative" }>;
  /**
   * Quando o atendimento aconteceu. Default: agora.
   *
   * O replay precisa carimbar a data original de cada avaliacao — se todos os
   * pontos ficassem com a data da reconstrucao, o painel passaria a exibir o
   * historico inteiro como se tivesse acontecido hoje.
   */
  occurredAt?: string;
}

export interface ApplyPointsResult {
  recurrences: PointOutcome[];
  corrected: PointOutcome[];
}

interface ExistingPoint {
  id: string;
  point_type: PointType;
  point_key: string;
  playbook_id: string | null;
  status: PointStatus;
  occurrences: number;
  first_seen_at: string;
}

/** Chave composta usada para casar o ponto existente com a observacao atual. */
function pointIdentity(type: PointType, key: string, playbookId: string | null): string {
  return `${type}::${key}::${playbookId ?? ""}`;
}

/**
 * Aplica os veredictos da avaliacao sobre a memoria do vendedor.
 * Retorna o que precisa ser sinalizado nesta avaliacao: reincidencias e correcoes.
 */
export async function applyDevelopmentPoints(input: ApplyPointsInput): Promise<ApplyPointsResult> {
  const { supabase, companyId, sellerId, playbookId, criterionVerdicts, habitObservations } = input;

  // Observacoes normalizadas: cada uma vira "falhou" ou "atendeu"
  const observations: Array<{
    type: PointType;
    key: string;
    label: string;
    scopePlaybookId: string | null;
    failed: boolean;
    neutral: boolean;
  }> = [];

  for (const criterion of criterionVerdicts) {
    const failed = criterion.verdict === "missed";
    // Falha em criterio de peso baixo nao abre ponto (ruido de coaching);
    // acerto continua valendo para corrigir ponto aberto de qualquer peso.
    const belowWeightCut =
      failed && typeof criterion.weight === "number" && criterion.weight < DEV_POINT_MIN_WEIGHT;
    observations.push({
      type: "criterion",
      key: criterion.criterion_key,
      label: criterion.label,
      // Criterios sao especificos do playbook
      scopePlaybookId: playbookId,
      failed,
      neutral: criterion.verdict === "partial" || criterion.verdict === "not_applicable" || belowWeightCut,
    });
  }

  for (const habit of habitObservations) {
    observations.push({
      type: "habit",
      key: habit.habit_key,
      label: habitLabel(habit.habit_key),
      // Habitos sao transversais: comparaveis entre todos os tipos de analise
      scopePlaybookId: null,
      failed: habit.observed === "negative",
      neutral: false,
    });
  }

  if (observations.length === 0) return { recurrences: [], corrected: [] };

  const { data: existingRows } = await supabase
    .from("seller_development_points")
    .select("id, point_type, point_key, playbook_id, status, occurrences, first_seen_at")
    .eq("company_id", companyId)
    .eq("seller_id", sellerId);

  const existing = new Map<string, ExistingPoint>();
  for (const row of (existingRows ?? []) as ExistingPoint[]) {
    existing.set(pointIdentity(row.point_type, row.point_key, row.playbook_id), row);
  }

  const now = input.occurredAt ?? new Date().toISOString();
  const recurrences: PointOutcome[] = [];
  const corrected: PointOutcome[] = [];

  for (const observation of observations) {
    if (observation.neutral) continue;

    const identity = pointIdentity(observation.type, observation.key, observation.scopePlaybookId);
    const current = existing.get(identity);

    if (observation.failed) {
      if (!current) {
        await supabase.from("seller_development_points").insert({
          company_id: companyId,
          seller_id: sellerId,
          point_type: observation.type,
          point_key: observation.key,
          // Rotulo legivel junto do ponto: a rubrica pode ser substituida e o
          // painel ficaria exibindo a chave crua
          label: observation.label,
          playbook_id: observation.scopePlaybookId,
          status: "open",
          occurrences: 1,
          first_seen_at: now,
          last_seen_at: now,
        });
        continue;
      }

      const occurrences = current.occurrences + 1;
      await supabase
        .from("seller_development_points")
        .update({ status: "recurrent", occurrences, last_seen_at: now, corrected_at: null, label: observation.label })
        .eq("id", current.id);

      recurrences.push({
        point_type: observation.type,
        point_key: observation.key,
        label: observation.label,
        occurrences,
        first_seen_at: current.first_seen_at,
      });
      continue;
    }

    // Atendeu: so importa se havia um ponto em aberto
    if (current && current.status !== "corrected") {
      await supabase
        .from("seller_development_points")
        .update({ status: "corrected", corrected_at: now, last_seen_at: now, label: observation.label })
        .eq("id", current.id);

      corrected.push({
        point_type: observation.type,
        point_key: observation.key,
        label: observation.label,
        occurrences: current.occurrences,
        first_seen_at: current.first_seen_at,
      });
    }
  }

  return { recurrences, corrected };
}

// =====================================================
// Reconstrucao da memoria (replay)
// =====================================================

interface ReplayRow {
  id: string;
  /** Data do atendimento — o que situa o ponto no tempo, nao o processamento. */
  occurred_at: string;
  score: number | null;
  playbook_id: string | null;
  criteria_results: unknown;
  habits: unknown;
  disregarded_at: string | null;
}

export interface RebuildMemoryInput {
  supabase: SB;
  companyId: string;
  sellerId: string;
}

export interface RebuildMemoryResult {
  replayed: number;
  discarded: number;
}

/**
 * Recalcula do zero os pontos de desenvolvimento e as conquistas do vendedor,
 * reaplicando apenas as avaliacoes validas, em ordem cronologica.
 *
 * Por que refazer tudo em vez de descontar a avaliacao removida: a maquina de
 * estados e sequencial. Uma falha vira 'recurrent' porque ja havia um ponto
 * aberto antes; uma correcao so existe porque houve falha antes. Tirar um elo
 * do meio muda os elos seguintes, entao a unica reconstrucao correta e refazer
 * a sequencia inteira.
 *
 * Tambem reescreve os alertas de recorrencia/correcao gravados em cada
 * avaliacao — sem isso, o detalhe de uma reuniao continuaria dizendo "3a
 * ocorrencia" depois que as duas anteriores sairam de cena.
 */
export async function rebuildSellerMemory(input: RebuildMemoryInput): Promise<RebuildMemoryResult> {
  const { supabase, companyId, sellerId } = input;

  const { data: resultRows, error } = await supabase
    .from("activity_analysis_results")
    .select("id, occurred_at, score, playbook_id, criteria_results, habits, disregarded_at")
    .eq("company_id", companyId)
    .eq("seller_id", sellerId)
    .eq("status", "done")
    // Ordem do atendimento, nao do processamento: avaliar em lote um periodo
    // passado nao pode reordenar a sequencia que a maquina de estados percorre
    .order("occurred_at", { ascending: true });
  if (error) throw error;

  const rows = (resultRows ?? []) as ReplayRow[];
  const valid = rows.filter((row) => !row.disregarded_at);
  const discarded = rows.filter((row) => !!row.disregarded_at);

  // Zera antes de reaplicar: o replay passa a ser a fonte da verdade
  await supabase
    .from("seller_development_points")
    .delete()
    .eq("company_id", companyId)
    .eq("seller_id", sellerId);
  await supabase
    .from("seller_achievements")
    .delete()
    .eq("company_id", companyId)
    .eq("seller_id", sellerId);

  // Do mais recente para o mais antigo, como evaluateAchievements espera
  const previousScores: number[] = [];

  for (const row of valid) {
    const criterionVerdicts = (Array.isArray(row.criteria_results) ? row.criteria_results : [])
      .map((item) => item as { criterion_key?: string; name?: string; verdict?: string; weight?: number })
      .filter((item) => !!item?.criterion_key && (item.verdict === "met" || item.verdict === "missed"))
      .map((item) => ({
        criterion_key: String(item.criterion_key),
        label: String(item.name ?? item.criterion_key),
        verdict: item.verdict as Verdict,
        // Peso gravado no snapshot da avaliacao: o replay aplica o mesmo corte
        // de peso minimo que o fluxo ao vivo
        weight: typeof item.weight === "number" ? item.weight : undefined,
      }));

    const habitObservations = (Array.isArray(row.habits) ? row.habits : [])
      .map((item) => item as { habit_key?: string; observed?: string })
      .filter((item) => !!item?.habit_key && (item.observed === "positive" || item.observed === "negative"))
      .map((item) => ({
        habit_key: String(item.habit_key),
        observed: item.observed as "positive" | "negative",
      }));

    const applied = await applyDevelopmentPoints({
      supabase,
      companyId,
      sellerId,
      playbookId: row.playbook_id,
      criterionVerdicts,
      habitObservations,
      occurredAt: row.occurred_at,
    });

    await supabase
      .from("activity_analysis_results")
      .update({
        recurrences: applied.recurrences,
        corrected: applied.corrected,
        points_applied: true,
      })
      .eq("id", row.id);

    const score = typeof row.score === "number" ? row.score : 0;
    await evaluateAchievements({
      supabase,
      companyId,
      sellerId,
      currentScore: score,
      correctedCount: applied.corrected.length,
      previousScores: [...previousScores],
      totalAnalyses: previousScores.length + 1,
      earnedAt: row.occurred_at,
    });
    previousScores.unshift(score);
  }

  // A avaliacao descartada nao produz mais alerta nenhum; points_applied volta
  // a false para que reconsidera-la mais tarde a recoloque na sequencia
  if (discarded.length > 0) {
    await supabase
      .from("activity_analysis_results")
      .update({ recurrences: [], corrected: [], points_applied: false })
      .in(
        "id",
        discarded.map((row) => row.id),
      );
  }

  console.log(
    `[developmentPoints] memoria reconstruida seller=${sellerId} validas=${valid.length} descartadas=${discarded.length}`,
  );

  return { replayed: valid.length, discarded: discarded.length };
}

// =====================================================
// Conquistas
// =====================================================

export interface AchievementDefinition {
  key: string;
  label: string;
  description: string;
}

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  { key: "primeira_analise", label: "Primeira avaliação", description: "Teve o primeiro atendimento avaliado." },
  { key: "score_70", label: "Consistência", description: "Alcançou 70 pontos em um atendimento." },
  { key: "score_85", label: "Alta performance", description: "Alcançou 85 pontos em um atendimento." },
  { key: "score_95", label: "Excelência", description: "Alcançou 95 pontos em um atendimento." },
  { key: "primeira_correcao", label: "Evolução", description: "Corrigiu um ponto que estava em aberto." },
  { key: "tres_correcoes", label: "Em transformação", description: "Corrigiu três pontos de desenvolvimento." },
  { key: "sequencia_3_melhorias", label: "Sequência de evolução", description: "Melhorou o score em três avaliações seguidas." },
  { key: "dez_analises", label: "Rodagem", description: "Teve dez atendimentos avaliados." },
];

export interface EvaluateAchievementsInput {
  supabase: SB;
  companyId: string;
  sellerId: string;
  currentScore: number;
  correctedCount: number;
  /** Scores anteriores do vendedor, do mais recente para o mais antigo. */
  previousScores: number[];
  totalAnalyses: number;
  /** Data da conquista. Default: agora. O replay usa a data da avaliacao original. */
  earnedAt?: string;
}

/**
 * Concede as conquistas alcancadas nesta avaliacao.
 * O insert usa ON CONFLICT DO NOTHING via unique (company, seller, key), entao
 * reprocessar nao duplica nem "reconquista".
 */
export async function evaluateAchievements(input: EvaluateAchievementsInput): Promise<string[]> {
  const { supabase, companyId, sellerId, currentScore, correctedCount, previousScores, totalAnalyses } = input;

  const earned: string[] = [];

  if (totalAnalyses >= 1) earned.push("primeira_analise");
  if (totalAnalyses >= 10) earned.push("dez_analises");
  if (currentScore >= 70) earned.push("score_70");
  if (currentScore >= 85) earned.push("score_85");
  if (currentScore >= 95) earned.push("score_95");
  if (correctedCount >= 1) earned.push("primeira_correcao");

  const { count: totalCorrected } = await supabase
    .from("seller_development_points")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("seller_id", sellerId)
    .eq("status", "corrected");
  if ((totalCorrected ?? 0) >= 3) earned.push("tres_correcoes");

  // Tres avaliacoes seguidas com melhora: score atual > anterior > antepenultimo
  const [prev1, prev2, prev3] = previousScores;
  if (
    typeof prev1 === "number" &&
    typeof prev2 === "number" &&
    typeof prev3 === "number" &&
    currentScore > prev1 &&
    prev1 > prev2 &&
    prev2 > prev3
  ) {
    earned.push("sequencia_3_melhorias");
  }

  if (earned.length === 0) return [];

  const { data: alreadyEarned } = await supabase
    .from("seller_achievements")
    .select("achievement_key")
    .eq("company_id", companyId)
    .eq("seller_id", sellerId);

  const known = new Set(((alreadyEarned ?? []) as Array<{ achievement_key: string }>).map((a) => a.achievement_key));
  const fresh = earned.filter((key) => !known.has(key));
  if (fresh.length === 0) return [];

  await supabase.from("seller_achievements").insert(
    fresh.map((key) => ({
      company_id: companyId,
      seller_id: sellerId,
      achievement_key: key,
      meta: { score: currentScore },
      earned_at: input.earnedAt ?? new Date().toISOString(),
    })),
  );

  return fresh;
}
