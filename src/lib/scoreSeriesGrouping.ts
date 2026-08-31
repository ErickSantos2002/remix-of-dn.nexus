export type ScoreGrouping = "day" | "week" | "month";

/** Início da semana (segunda) em formato YYYY-MM-DD, a partir de um dia YYYY-MM-DD. */
export function weekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // segunda = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

/**
 * Reagrupa a série diária por dia, semana ou mês usando média simples: cada dia
 * pesa igual dentro do balde, independentemente de quantos atendimentos teve.
 */
export function groupScoreSeries<T extends { date: string; score: number }>(
  series: T[],
  grouping: ScoreGrouping,
): Array<{ date: string; score: number }> {
  if (grouping === "day") return series.map(({ date, score }) => ({ date, score }));

  const buckets = new Map<string, { total: number; count: number }>();
  for (const point of series) {
    const key = grouping === "week" ? weekStart(point.date) : `${point.date.slice(0, 7)}-01`;
    const current = buckets.get(key) ?? { total: 0, count: 0 };
    current.total += point.score;
    current.count += 1;
    buckets.set(key, current);
  }

  return [...buckets.entries()]
    .map(([date, { total, count }]) => ({ date, score: Math.round(total / count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
