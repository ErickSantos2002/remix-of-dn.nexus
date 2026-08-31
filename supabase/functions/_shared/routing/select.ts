// Seleção do responsável — decisão pura, sem I/O (spec §5.1, §6, §7).
export interface SelectOptions {
  strategy: string;
  loads: ReadonlyMap<string, number>;
  /** Responsável do card aberto do contato; vence o rodízio quando está no pool. */
  ownerId?: string | null;
  /** round_robin: última atribuição por user_id; NULL = nunca recebeu = primeiro da vez. */
  lastActivity?: ReadonlyMap<string, string | null>;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function selectAssignee(candidates: readonly string[], opts: SelectOptions): string | null {
  if (candidates.length === 0) return null;
  if (opts.ownerId && candidates.includes(opts.ownerId)) return opts.ownerId;

  const sorted = [...candidates];
  if (opts.strategy === "round_robin") {
    sorted.sort((a, b) => {
      const la = opts.lastActivity?.get(a) ?? null;
      const lb = opts.lastActivity?.get(b) ?? null;
      if (la !== lb) {
        if (la === null) return -1;
        if (lb === null) return 1;
        if (la < lb) return -1;
        if (la > lb) return 1;
      }
      return byId(a, b); // desempate estável — nunca Math.random() (spec §7 passo 5)
    });
  } else {
    // least_loaded, e também o destino de estratégia não implementada (spec §4.1);
    // o log da estratégia desconhecida acontece em config.ts, não aqui.
    sorted.sort((a, b) => {
      const la = opts.loads.get(a) ?? 0;
      const lb = opts.loads.get(b) ?? 0;
      return la !== lb ? la - lb : byId(a, b);
    });
  }
  return sorted[0];
}
