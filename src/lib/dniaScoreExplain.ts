// Explicacao dos scores e da temperatura DNIA.
//
// ESPELHO das formulas de supabase/functions/analyze-lead-psychology/index.ts.
// Os scores sao deterministicos a partir das 6 dimensoes, entao a explicacao do
// "porque" pode ser reconstruida no front sem novo campo no banco. Ao alterar as
// formulas na edge function, atualize este arquivo.

export interface DniaDimensions {
  inteligencia: number;
  investimento: number;
  intencao: number;
  engajamento: number;
  potencial: number;
  decisao: number;
}

export const DNIA_DIMENSION_LABELS: Record<keyof DniaDimensions, string> = {
  inteligencia: "Inteligência",
  investimento: "Investimento",
  intencao: "Intenção",
  engajamento: "Engajamento",
  potencial: "Potencial",
  decisao: "Decisão",
};

export interface ScoreDriver {
  label: string;
  value: number;
  /** Como a dimensão pesa no score: puxa para cima ou para baixo. */
  effect: "positive" | "negative";
}

export interface ScoreExplanation {
  /** Frase curta em linguagem de negócio. */
  headline: string;
  /** Leitura frase a frase das dimensões que formam o score. */
  narrative: string[];
  /** O que fazer com o lead diante deste score. */
  action: string;
  /** Fórmula usada, em texto legível. */
  formula: string;
  drivers: ScoreDriver[];
}

function pick(dims: DniaDimensions, keys: (keyof DniaDimensions)[], invert = false): ScoreDriver[] {
  return keys
    .map((k) => ({
      label: DNIA_DIMENSION_LABELS[k],
      value: dims[k] ?? 0,
      effect: (invert
        ? (dims[k] ?? 0) <= 2
          ? "negative"
          : "positive"
        : (dims[k] ?? 0) >= 4
          ? "positive"
          : "negative") as ScoreDriver["effect"],
    }))
    .sort((a, b) => b.value - a.value);
}

function band(score: number, high: string, mid: string, low: string): string {
  if (score >= 70) return high;
  if (score >= 40) return mid;
  return low;
}

/** Dimensões mais explicativas primeiro: as que estão longe da média (3). */
function narrateDimensions(dims: DniaDimensions, keys: (keyof DniaDimensions)[], limit = 3): string[] {
  return [...keys]
    .sort((a, b) => Math.abs(3 - (dims[b] ?? 0)) - Math.abs(3 - (dims[a] ?? 0)))
    .slice(0, limit)
    .map((k) => readDimension(dims, k));
}

export function explainPropensity(dims: DniaDimensions, score: number): ScoreExplanation {
  const keys: (keyof DniaDimensions)[] = ["intencao", "inteligencia", "investimento", "engajamento", "potencial"];
  const drivers = pick(dims, keys);
  const top = drivers[0];
  const bottom = drivers[drivers.length - 1];
  return {
    headline: band(
      score,
      `A propensão está em ${score}% porque este lead reúne o que costuma preceder uma venda: ` +
        `${top.label.toLowerCase()} em ${top.value}/5 puxa o score para cima e nenhuma dimensão o derruba de forma grave. ` +
        `Em outras palavras, ele quer, entende e tem condições de comprar.`,
      `A propensão está em ${score}%: o lead tem sinais reais de compra, mas ` +
        `${bottom.label.toLowerCase()} (${bottom.value}/5) segura o avanço. É um lead viável que ainda depende ` +
        `de destravar esse ponto antes de virar negociação.`,
      `A propensão está em ${score}% porque faltam os sinais básicos de compra. ` +
        `${bottom.label} em ${bottom.value}/5 é o principal travamento: sem resolver isso, a conversa não evolui para proposta.`,
    ),
    narrative: narrateDimensions(dims, keys),
    action: band(
      score,
      "Trate como prioridade comercial: avance para proposta ou fechamento nesta semana.",
      `Ataque o gargalo: trabalhe ${bottom.label.toLowerCase()} antes de tentar fechar.`,
      "Não force a venda agora: qualifique melhor ou devolva para nutrição.",
    ),
    formula: "Média de Intenção, Inteligência, Investimento, Engajamento e Potencial x 20",
    drivers,
  };
}

export function explainRisk(dims: DniaDimensions, score: number): ScoreExplanation {
  const engajamento = dims.engajamento ?? 0;
  const intencao = dims.intencao ?? 0;
  const drivers: ScoreDriver[] = [
    {
      label: `Engajamento baixo (${engajamento}/5)`,
      value: (5 - engajamento) * 20,
      effect: engajamento >= 4 ? "positive" : "negative",
    },
    {
      label: `Intenção baixa (${intencao}/5)`,
      value: (5 - intencao) * 10,
      effect: intencao >= 4 ? "positive" : "negative",
    },
  ];
  return {
    headline: band(
      score,
      `O risco está em ${score}% porque este lead dá poucos sinais de que continuará na conversa: ` +
        `ele interage pouco (Engajamento ${engajamento}/5) e não demonstra querer avançar (Intenção ${intencao}/5). ` +
        `Risco aqui significa chance concreta de sumir sem resposta.`,
      `O risco está em ${score}%: o lead ainda está na conversa, mas o ritmo (Engajamento ${engajamento}/5) e ` +
        `a vontade de avançar (Intenção ${intencao}/5) não são fortes o bastante para garantir que ele siga. ` +
        `Um período sem contato pode esfriá-lo.`,
      `O risco está em ${score}% porque o lead responde bem (Engajamento ${engajamento}/5) e mostra que quer avançar ` +
        `(Intenção ${intencao}/5). A chance de perdê-lo por abandono é pequena.`,
    ),
    narrative: [readDimension(dims, "engajamento"), readDimension(dims, "intencao")],
    action: band(
      score,
      "Faça uma tentativa de resgate objetiva (uma pergunta direta ou uma oferta com prazo) e defina um limite de tentativas.",
      "Mantenha cadência curta: não deixe passar mais do que poucos dias sem um novo contato com motivo real.",
      "Mantenha o ritmo atual — o risco não exige ação corretiva.",
    ),
    formula: "(5 − Engajamento) x 20 + (5 − Intenção) x 10 — quanto menores as dimensões, maior o risco",
    drivers,
  };
}

export function explainOpportunity(dims: DniaDimensions, score: number): ScoreExplanation {
  const keys: (keyof DniaDimensions)[] = ["investimento", "potencial", "decisao"];
  const drivers = pick(dims, keys);
  const top = drivers[0];
  const bottom = drivers[drivers.length - 1];
  return {
    headline: band(
      score,
      `A oportunidade está em ${score}% porque o tamanho do negócio compensa: ${top.label.toLowerCase()} em ` +
        `${top.value}/5 indica capacidade de investimento e cenário acima da média. Vale alocar tempo do time comercial.`,
      `A oportunidade está em ${score}%: existe negócio, mas ${bottom.label.toLowerCase()} (${bottom.value}/5) ` +
        `reduz o ticket ou aumenta o caminho até o sim.`,
      `A oportunidade está em ${score}% porque ${bottom.label.toLowerCase()} (${bottom.value}/5) limita o tamanho ` +
        `possível do negócio. Mesmo fechando, o retorno tende a ser baixo.`,
    ),
    narrative: narrateDimensions(dims, keys, 3),
    action: band(
      score,
      "Envolva quem decide e proponha o escopo maior — há espaço para um ticket acima da média.",
      "Confirme orçamento e quem assina antes de investir mais tempo na negociação.",
      "Trate como venda simples e de baixo esforço, sem customização.",
    ),
    formula: "Média de Investimento, Potencial e Decisão x 20",
    drivers,
  };
}


/** Leitura em linguagem de negócio de cada dimensão, por faixa de nota. */
const DIMENSION_NARRATIVE: Record<keyof DniaDimensions, [string, string, string]> = {
  // [nota <= 2, nota 3, nota >= 4]
  intencao: [
    "não demonstrou querer avançar: não pediu proposta, preço nem próximo passo",
    "demonstrou interesse, mas ainda fala em \"pensar\" e não pediu um próximo passo claro",
    "pediu explicitamente para avançar (proposta, preço, reunião ou início)",
  ],
  engajamento: [
    "responde pouco, com respostas curtas e demora entre as mensagens",
    "responde, mas a conversa depende de nós puxarmos o assunto",
    "responde rápido, faz perguntas e mantém a conversa viva por conta própria",
  ],
  investimento: [
    "não sinalizou orçamento ou indicou que o valor é um problema",
    "aceita falar de valores, mas sem confirmar orçamento disponível",
    "tratou o investimento com naturalidade e sinalizou orçamento compatível",
  ],
  decisao: [
    "não parece ser quem decide, ou depende de terceiros não mapeados",
    "participa da decisão, mas divide com outras pessoas",
    "é quem decide e pode dar o sim sem depender de aprovação externa",
  ],
  potencial: [
    "o cenário indica um negócio pequeno para o nosso perfil",
    "o cenário indica um negócio dentro da média",
    "o cenário indica um negócio acima da média em tamanho e recorrência",
  ],
  inteligencia: [
    "entende pouco do problema que resolvemos e precisa de educação antes de comprar",
    "entende o problema, mas ainda confunde partes da solução",
    "entende bem o problema e já compara soluções com clareza",
  ],
};

function readDimension(dims: DniaDimensions, key: keyof DniaDimensions): string {
  const v = dims[key] ?? 0;
  const band = v >= 4 ? 2 : v === 3 ? 1 : 0;
  return `${DNIA_DIMENSION_LABELS[key]} ${v}/5 — ${DIMENSION_NARRATIVE[key][band]}.`;
}

export interface TemperatureExplanation {
  headline: string;
  /** Explicação em linguagem natural, frase por frase, do que a conversa mostrou. */
  narrative: string[];
  /** O que fazer agora com este lead. */
  action: string;
  /** Regra exata que classificou o lead nesta faixa. */
  rule: string;
  next: string | null;
}


export function explainTemperature(
  dims: DniaDimensions,
  propensity: number,
  temperatura: string | null,
): TemperatureExplanation {
  const i = dims.intencao ?? 0;
  const e = dims.engajamento ?? 0;

  // As duas dimensoes que definem a faixa sempre aparecem; as demais entram
  // ordenadas pelo quanto explicam o resultado (extremos primeiro).
  const others = (["investimento", "decisao", "potencial", "inteligencia"] as (keyof DniaDimensions)[])
    .sort((a, b) => Math.abs(3 - (dims[b] ?? 0)) - Math.abs(3 - (dims[a] ?? 0)))
    .slice(0, 2);

  const narrative = [
    readDimension(dims, "intencao"),
    readDimension(dims, "engajamento"),
    ...others.map((k) => readDimension(dims, k)),
  ];

  if (temperatura === "muito_quente") {
    return {
      headline:
        `Este lead está Muito Quente porque juntou as duas coisas que mais antecipam uma venda: ` +
        `ele quer avançar (Intenção ${i}/5) e está conversando de verdade com a gente (Engajamento ${e}/5). ` +
        `Não é um contato curioso — é alguém em processo de decisão, com propensão de ${propensity}%.`,
      narrative,
      action:
        "Fale com ele hoje. Vá direto para proposta, condições ou agendamento — esperar aqui só esfria o lead.",
      rule:
        i >= 4 && e >= 4
          ? `Intenção ${i}/5 e Engajamento ${e}/5 (ambos ≥ 4)`
          : `Propensão ${propensity}% (≥ 80%)`,
      next: null,
    };
  }

  if (temperatura === "quente") {
    return {
      headline:
        `Este lead está Quente porque demonstrou querer avançar (Intenção ${i}/5), mas a conversa ainda ` +
        `não tem a constância de um lead pronto (Engajamento ${e}/5). O interesse existe; falta ritmo e ` +
        `confirmação de que ele está priorizando isso agora. Propensão de ${propensity}%.`,
      narrative,
      action:
        "Puxe um próximo passo concreto com data (reunião, envio de proposta) para transformar o interesse em compromisso.",
      rule:
        i >= 4 && e >= 3
          ? `Intenção ${i}/5 (≥ 4) e Engajamento ${e}/5 (≥ 3)`
          : `Propensão ${propensity}% (entre 70% e 79%)`,
      next: "Para virar Muito Quente: Engajamento ≥ 4 ou Propensão ≥ 80%.",
    };
  }

  if (temperatura === "morno") {
    return {
      headline:
        `Este lead está Morno porque há interesse no tema (Intenção ${i}/5), mas nada indica urgência: ` +
        `a conversa acontece em ritmo baixo (Engajamento ${e}/5) e ele não pediu um próximo passo. ` +
        `É um lead real, só que ainda no começo da jornada. Propensão de ${propensity}%.`,
      narrative,
      action:
        "Nutra com conteúdo e prova (casos, resultados) e volte com uma pergunta que force uma decisão pequena.",
      rule:
        i >= 3 && e >= 2
          ? `Intenção ${i}/5 (≥ 3) e Engajamento ${e}/5 (≥ 2)`
          : `Propensão ${propensity}% (entre 40% e 69%)`,
      next: "Para virar Quente: Intenção ≥ 4 e Engajamento ≥ 3, ou Propensão ≥ 70%.",
    };
  }

  return {
    headline:
      `Este lead está Frio porque a conversa não trouxe sinais de compra: ele não pediu para avançar ` +
      `(Intenção ${i}/5) e interage pouco (Engajamento ${e}/5). Pode ser curiosidade, momento errado ou ` +
      `perfil fora do nosso alvo. Propensão de ${propensity}%.`,
    narrative,
    action:
      "Não gaste tempo comercial agora: mande para nutrição e reative quando houver um novo gatilho de interesse.",
    rule: `Intenção ${i}/5 e Engajamento ${e}/5 abaixo dos limites de Morno (Intenção ≥ 3 e Engajamento ≥ 2) e Propensão ${propensity}% abaixo de 40%`,
    next: "Para virar Morno: Intenção ≥ 3 e Engajamento ≥ 2, ou Propensão ≥ 40%.",
  };
}

