/**
 * Calcula a janela imediatamente anterior à janela atual, com a mesma duração.
 * Retorna {} quando a janela atual não tem from/to (ex: range "all").
 */
export function getPreviousRangeBounds(current: {
  from?: string;
  to?: string;
}): { from?: string; to?: string } {
  if (!current.from || !current.to) return {};
  const fromMs = new Date(current.from).getTime();
  const toMs = new Date(current.to).getTime();
  const duration = toMs - fromMs;
  if (duration <= 0) return {};
  const prevToMs = fromMs - 1;
  const prevFromMs = prevToMs - duration;
  return {
    from: new Date(prevFromMs).toISOString(),
    to: new Date(prevToMs).toISOString(),
  };
}

/**
 * Retorna a chave do dia (YYYY-MM-DD) em America/Sao_Paulo (UTC-3).
 */
export function saoPauloDayKey(iso: string): string {
  const d = new Date(iso);
  const offsetMs = -3 * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  return local.toISOString().slice(0, 10);
}

/**
 * Gera as chaves de dia (YYYY-MM-DD em America/Sao_Paulo) cobrindo a janela [from, to].
 */
export function enumerateDayKeys(from: string, to: string): string[] {
  const start = saoPauloDayKey(from);
  const end = saoPauloDayKey(to);
  const out: string[] = [];
  let cursor = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  // safety cap
  let i = 0;
  while (cursor.getTime() <= endDate.getTime() && i < 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    i++;
  }
  return out;
}
