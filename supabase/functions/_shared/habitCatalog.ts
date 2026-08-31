// Catalogo fixo de habitos comportamentais do vendedor.
//
// Diferenca para os criterios da rubrica: criterios sao especificos de um
// playbook; habitos sao transversais e comparaveis entre TODOS os tipos de
// atendimento (reuniao, demo, ligacao). E isso que permite dizer "esse vendedor
// fala demais" olhando o conjunto, nao um playbook isolado.
//
// O vocabulario e FIXO de proposito: se a IA pudesse inventar chaves novas a
// cada analise, nunca daria para detectar recorrencia.
//
// ESPELHO NO FRONTEND: src/lib/analysisCatalog.ts (apenas os rotulos).
// Ao adicionar/remover um habito aqui, atualize o espelho.

export interface HabitDefinition {
  key: string;
  label: string;
  /** Descricao operacional enviada no prompt — precisa ser julgavel na transcricao. */
  definition: string;
}

export const HABIT_CATALOG: HabitDefinition[] = [
  {
    key: "escuta_ativa",
    label: "Escuta ativa",
    definition:
      "O vendedor deixa o cliente falar, nao interrompe e demonstra ter ouvido (retoma o que o cliente disse com as palavras dele).",
  },
  {
    key: "proporcao_de_fala",
    label: "Proporção de fala",
    definition:
      "O vendedor mantem o cliente falando a maior parte do tempo, especialmente na fase de diagnostico.",
  },
  {
    key: "perguntas_abertas",
    label: "Perguntas abertas",
    definition:
      "O vendedor usa perguntas que abrem a conversa em vez de sequencias de perguntas fechadas de sim/nao.",
  },
  {
    key: "exploracao_de_dor",
    label: "Exploração da dor",
    definition:
      "O vendedor aprofunda o problema do cliente (consequencia, custo, urgencia) antes de propor solucao.",
  },
  {
    key: "foco_no_cliente",
    label: "Foco no cliente",
    definition:
      "A conversa gira em torno da realidade do cliente, nao em torno da empresa, do produto ou de funcionalidades.",
  },
  {
    key: "clareza_da_explicacao",
    label: "Clareza da explicação",
    definition:
      "O vendedor explica de forma simples e direta, sem jargao tecnico desnecessario ou respostas longas demais.",
  },
  {
    key: "tratamento_de_objecao",
    label: "Tratamento de objeção",
    definition:
      "Diante de uma objecao, o vendedor acolhe, entende a razao por tras e responde com argumento — sem ignorar nem discutir.",
  },
  {
    key: "controle_da_conducao",
    label: "Condução da reunião",
    definition:
      "O vendedor conduz a conversa com estrutura e mantem o rumo, sem se perder em digressoes nem deixar o cliente dirigir sem direcao.",
  },
  {
    key: "confirmacao_de_entendimento",
    label: "Confirmação de entendimento",
    definition:
      "O vendedor confirma se o cliente entendeu ou concorda antes de avancar para o proximo tema.",
  },
  {
    key: "proximo_passo_definido",
    label: "Próximo passo definido",
    definition:
      "Ao encerrar, fica combinado um proximo passo concreto: o que acontece, quem faz e quando.",
  },
  {
    key: "pressao_indevida",
    label: "Pressão indevida",
    definition:
      "O vendedor evita urgencia artificial, promessas irreais e insistencia — a decisao vem da clareza, nao da pressao.",
  },
  {
    key: "postura_consultiva",
    label: "Postura consultiva",
    definition:
      "O vendedor age como quem ajuda a decidir, com honestidade sobre limites e adequacao, em vez de apenas empurrar a venda.",
  },
];

export const HABIT_KEYS = HABIT_CATALOG.map((habit) => habit.key);

export function isKnownHabit(key: string): boolean {
  return HABIT_KEYS.includes(key);
}

export function habitLabel(key: string): string {
  return HABIT_CATALOG.find((habit) => habit.key === key)?.label ?? key;
}

/** Bloco do catalogo formatado para entrar no prompt de avaliacao. */
export function habitCatalogPromptBlock(): string {
  return HABIT_CATALOG.map((habit) => `- ${habit.key}: ${habit.definition}`).join("\n");
}
