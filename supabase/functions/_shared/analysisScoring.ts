// Calculo do score da avaliacao.
//
// O score NAO vem do modelo: a IA emite um veredicto por criterio e o numero e
// calculado aqui. Isso garante que duas avaliacoes com os mesmos veredictos
// produzam sempre a mesma nota, e que mudar pesos nao dependa de reprocessar
// nada pela IA.
//
// Recorrencia tambem nao entra no score (decisao de produto): reincidencia vira
// alerta, para que a nota continue comparavel entre vendedores e ao longo do tempo.

// "not_applicable": a etapa daquele criterio nao aconteceu na reuniao (ex.:
// conversa encerrada antes do slide). Sai do DENOMINADOR do score — nao pontua
// nem penaliza. Sem isso, uma reuniao legitimamente curta levava 'missed' em
// bloco nos criterios das etapas nao visitadas e a nota mentia.
export type Verdict = "met" | "partial" | "missed" | "not_applicable";

export const VERDICT_VALUES: Record<Exclude<Verdict, "not_applicable">, number> = {
  met: 1,
  partial: 0.5,
  missed: 0,
};

export interface ScorableCriterion {
  criterion_key: string;
  weight: number;
  is_active: boolean;
}

export function isVerdict(value: unknown): value is Verdict {
  return value === "met" || value === "partial" || value === "missed" || value === "not_applicable";
}

/**
 * Score 0-100 = soma ponderada dos veredictos sobre a soma dos pesos aplicaveis.
 * Considera apenas criterios ativos; criterios sem veredicto contam como `missed`
 * (mantem o denominador estavel — nao avaliado nao pode virar ponto de graca).
 * Criterios "not_applicable" ficam fora do numerador E do denominador: a nota
 * responde "o que aconteceu foi bem executado?", comparavel entre reunioes de
 * duracoes diferentes.
 */
export function computeScore(
  criteria: ScorableCriterion[],
  verdicts: Map<string, Verdict>,
): number {
  const active = criteria.filter((criterion) => criterion.is_active);

  let totalWeight = 0;
  let earned = 0;
  for (const criterion of active) {
    const verdict = verdicts.get(criterion.criterion_key) ?? "missed";
    if (verdict === "not_applicable") continue;
    const weight = Number(criterion.weight) || 0;
    totalWeight += weight;
    earned += weight * VERDICT_VALUES[verdict];
  }

  if (totalWeight <= 0) return 0;
  return Math.round((earned / totalWeight) * 100);
}
