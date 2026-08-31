// analyze-transcript-playbook
//
// Avalia a transcricao de um atendimento (reuniao, demo ou ligacao) contra a
// rubrica ativa da analise vinculada aquela atividade.
//
// Divisao de responsabilidades:
// - A IA emite um VEREDICTO por criterio, com evidencia citada da transcricao.
// - O SCORE e calculado em codigo (soma ponderada) -> deterministico.
// - RECORRENCIA e CORRECAO sao calculadas em codigo comparando com a memoria do
//   vendedor -> recorrencia vira alerta, nunca penalidade no score.
//
// Acoes:
//   evaluate        - avalia um atendimento
//   coaching-brief  - gera orientacao de gestao sobre um vendedor (admin)
//   rebuild-points  - refaz a memoria do vendedor a partir das avaliacoes validas

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatCompletionWithFallback } from "../_shared/geminiClient.ts";
import { computeScore, isVerdict, type Verdict } from "../_shared/analysisScoring.ts";
import { habitCatalogPromptBlock, habitLabel, isKnownHabit } from "../_shared/habitCatalog.ts";
import {
  applyDevelopmentPoints,
  evaluateAchievements,
  rebuildSellerMemory,
  type PointOutcome,
} from "../_shared/developmentPoints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POINT_STATUS_PT: Record<string, string> = {
  open: "em aberto",
  recurrent: "recorrente",
  corrected: "corrigido",
};

/**
 * Nome legivel de um ponto de desenvolvimento para uso no prompt.
 *
 * A chave crua ("validou_o_principal_desafio_com_o_cliente") vazava para o texto
 * gerado pela IA, que a repetia entre aspas no feedback ao gestor. O rotulo
 * gravado junto do ponto e a fonte preferida; registros antigos caem na
 * conversao da chave.
 */
function developmentPointLabel(point: {
  point_type: string;
  point_key: string;
  label?: string | null;
}): string {
  if (point.label) return point.label;
  if (point.point_type === "habit") return habitLabel(point.point_key);
  const words = point.point_key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
const MAX_TRANSCRIPT_CHARS = 120_000;
// O playbook entra so como contexto de apoio: os criterios que importam ja
// foram extraidos dele para a rubrica. Mandar o documento inteiro (100k+
// caracteres) inflava a latencia sem ganho proporcional de qualidade.
const MAX_PLAYBOOK_CHARS = 15_000;

// Edge function tem tempo de parede limitado. Abortamos antes de sermos
// mortos, para registrar a falha em vez de deixar a linha presa em
// 'processing' para sempre.
const AI_TIMEOUT_MS = 110_000;

// Rubricas grandes nao cabem numa resposta so: cada criterio custa ~150-200
// tokens de saida (veredicto + evidencia citada + feedback) e, acima de ~30,
// o JSON estoura o orcamento de saida do modelo ou a geracao passa do timeout.
// Os criterios sao avaliados em LOTES contra a mesma transcricao e mesclados em
// codigo — o score ja e deterministico, entao a mescla nao muda nada.
const CRITERIA_PER_CALL = 25;
const EVAL_CONCURRENCY = 3;
// Acima desta fracao de criterios sem veredicto a avaliacao FALHA em vez de
// gravar nota: 'missed' em massa por falha tecnica puniria o vendedor.
const MAX_MISSING_RATIO = 0.3;
// Reunioes curtas, parciais ou focadas em poucas etapas legitimamente geram
// muitos "not_applicable". Tres criterios aplicaveis ainda formam uma amostra
// minima util; os N/A ficam fora do denominador do score.
const MIN_SCORED_CRITERIA = 3;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

interface RubricCriterion {
  criterion_key: string;
  stage: string | null;
  name: string;
  description: string | null;
  weight: number;
  is_active: boolean;
  sort_order: number;
}

interface ModelCriterionResult {
  criterion_key: string;
  verdict: Verdict;
  evidence: string;
  feedback: string;
}

interface ModelOutput {
  summary_md: string;
  criteria: ModelCriterionResult[];
  strengths: Array<{ title: string; evidence: string }>;
  improvements: Array<{ criterion_key: string | null; title: string; suggestion: string }>;
  habits: Array<{ habit_key: string; observed: "positive" | "negative"; evidence: string }>;
}

// =====================================================
// Prompt
// =====================================================

const JUDGING_RULES = `Como julgar cada criterio:
- "met": a transcricao mostra claramente que o criterio foi atendido.
- "partial": houve tentativa incompleta, superficial ou parcialmente correta.
- "missed": nao ha evidencia de que o criterio foi atendido, ou foi feito o oposto.
- "not_applicable": a ETAPA a que o criterio pertence nao aconteceu na reuniao
  (ex.: a conversa foi encerrada antes daquele slide, ou o cliente pediu para
  pular aquele bloco). Use SOMENTE para etapas de conteudo nao alcancadas.
  Criterios de conducao geral, diagnostico, proximos passos e encerramento NUNCA
  sao "not_applicable" — mesmo uma reuniao interrompida deve ser bem conduzida e
  bem encerrada. Ao usar, deixe "evidence" vazia e explique no "feedback" por que
  a etapa nao ocorreu. Se a etapa aconteceu e o vendedor nao fez o que o criterio
  pede, o veredicto e "missed", nunca "not_applicable".

Regras rigidas:
- Julgue APENAS pelo que esta na transcricao. Nunca suponha o que nao foi dito.
- "evidence" deve ser COPIA LITERAL de um trecho da transcricao, palavra por palavra.
  NAO descreva, NAO resuma, NAO parafraseie, NAO cite numero de linha ou intervalo.
  Para juntar dois trechos separados, use reticencias entre eles.
  CERTO:  "me conta um pouquinho mais da empresa de voces ... e hoje quem cuida disso?"
  ERRADO: "O cliente descreve a empresa do trecho 55 ao 280"
  ERRADO: "A vendedora fez perguntas para guiar a conversa"
  Sem trecho aplicavel (caso tipico de "missed"), use string vazia — e melhor
  vazio do que uma descricao.
- "feedback" e curto, direto e acionavel, dirigido ao vendedor (maximo 300 caracteres).
- "evidence" com no maximo 240 caracteres: recorte apenas o trecho que importa.
- Avalie o VENDEDOR, nunca o cliente. Os dois sao identificados no bloco
  "## Quem e quem" da mensagem seguinte; use aquilo, nao suposicao.
- Emita um resultado para CADA criterio informado, sem inventar criterios novos.
- Escreva em portugues do Brasil, sem emojis.`;

function buildSystemPrompt(): string {
  return `Voce avalia a qualidade de atendimentos comerciais a partir da transcricao.

${JUDGING_RULES}
- Em "habits", use somente as chaves do catalogo fornecido, e apenas as que voce
  realmente observou na transcricao.

Catalogo de habitos (observed = "positive" quando o vendedor demonstra o habito,
"negative" quando demonstra o oposto):
${habitCatalogPromptBlock()}

Responda SOMENTE com JSON valido no formato:
{
  "summary_md": "resumo executivo do atendimento em markdown",
  "criteria": [{"criterion_key":"...","verdict":"met|partial|missed|not_applicable","evidence":"...","feedback":"..."}],
  "strengths": [{"title":"...","evidence":"..."}],
  "improvements": [{"criterion_key":"... ou null","title":"...","suggestion":"..."}],
  "habits": [{"habit_key":"...","observed":"positive|negative","evidence":"..."}]
}`;
}

/**
 * Prompt dos lotes seguintes: mesmas regras de julgamento, mas a resposta traz
 * SO os criterios. Resumo, pontos fortes, melhorias e habitos leem a conversa
 * inteira e sao pedidos uma unica vez, no primeiro lote.
 */
function buildCriteriaOnlySystemPrompt(): string {
  return `Voce avalia a qualidade de atendimentos comerciais a partir da transcricao.

${JUDGING_RULES}

Responda SOMENTE com JSON valido no formato:
{"criteria":[{"criterion_key":"...","verdict":"met|partial|missed|not_applicable","evidence":"...","feedback":"..."}]}`;
}

/** Erro de IA que aborta a avaliacao inteira (limite de uso / creditos). */
class AiQuotaError extends Error {
  status: number;
  constructor(status: number) {
    super(`IA respondeu ${status}`);
    this.status = status;
  }
}

/** Executa tarefas com concorrencia limitada, preservando a ordem dos resultados. */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let abortError: unknown = null;

  const worker = async () => {
    while (true) {
      if (abortError) return;
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        abortError = e;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  if (abortError) throw abortError;
  return results;
}

function buildUserPrompt(params: {
  companyGuidelines: string | null;
  playbookGuidelines: string | null;
  playbookMd: string | null;
  criteria: RubricCriterion[];
  openPoints: Array<{
    point_type: string;
    point_key: string;
    label: string | null;
    status: string;
    occurrences: number;
  }>;
  transcript: string;
  /** Nome de quem falou na reuniao — usado no prompt. */
  sellerName: string | null;
  clientName: string | null;
}): string {
  const blocks: string[] = [];

  // Identificacao explicita: transcricoes nem sempre marcam o papel do falante,
  // e deixar a IA deduzir quem vende arrisca avaliar a pessoa errada.
  if (params.sellerName || params.clientName) {
    const lines: string[] = [];
    if (params.sellerName) lines.push(`- VENDEDOR (quem deve ser avaliado): ${params.sellerName}`);
    if (params.clientName) lines.push(`- CLIENTE (nao deve ser avaliado): ${params.clientName}`);
    blocks.push(`## Quem e quem\n${lines.join("\n")}`);
  }

  if (params.companyGuidelines?.trim()) {
    blocks.push(`## Diretrizes gerais da empresa\n${params.companyGuidelines.trim()}`);
  }
  if (params.playbookGuidelines?.trim()) {
    blocks.push(`## Diretrizes desta analise\n${params.playbookGuidelines.trim()}`);
  }
  if (params.playbookMd?.trim()) {
    blocks.push(`## Playbook (contexto)\n${params.playbookMd.slice(0, MAX_PLAYBOOK_CHARS)}`);
  }

  // Pesos NAO vao no prompt: evitam enviesar o texto do feedback.
  const rubricLines = params.criteria
    .filter((criterion) => criterion.is_active)
    .map((criterion) => {
      const stage = criterion.stage ? `[${criterion.stage}] ` : "";
      const description = criterion.description ? ` — ${criterion.description}` : "";
      return `- ${criterion.criterion_key}: ${stage}${criterion.name}${description}`;
    });
  blocks.push(`## Rubrica a avaliar\n${rubricLines.join("\n")}`);

  if (params.openPoints.length > 0) {
    const pointLines = params.openPoints.map(
      (point) => `- ${developmentPointLabel(point)} (${POINT_STATUS_PT[point.status] ?? point.status}, ${point.occurrences}x)`,
    );
    blocks.push(
      `## Pontos em aberto deste vendedor\n${pointLines.join("\n")}\n\n` +
        "Use apenas para contextualizar o feedback. NAO ajuste veredictos por causa deles e " +
        "nao mencione penalizacao: reincidencia e calculada fora da sua resposta.",
    );
  }

  blocks.push(`## Transcricao\n${params.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`);

  return blocks.join("\n\n");
}

// =====================================================
// Parsing e validacao da resposta
// =====================================================

/**
 * Objetos completos de um array JSON, varrendo caractere a caractere.
 *
 * Existe para sobreviver a resposta truncada: quando o modelo estoura o limite
 * de tokens no meio do JSON, JSON.parse falha inteiro e perderiamos tambem os
 * criterios que ja tinham vindo completos. Aqui o ultimo elemento incompleto e
 * simplesmente descartado.
 */
function extractArrayObjects(source: string, key: string): Record<string, unknown>[] {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return [];
  const arrayStart = source.indexOf("[", keyIndex);
  if (arrayStart < 0) return [];

  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart + 1; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') { inString = true; continue; }
    if (char === "{") { if (depth === 0) objectStart = i; depth++; continue; }
    if (char === "}") {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          objects.push(JSON.parse(source.slice(objectStart, i + 1)));
        } catch { /* objeto malformado: ignora e segue */ }
        objectStart = -1;
      }
      continue;
    }
    if (char === "]" && depth === 0) break;
  }

  return objects;
}

/**
 * Valor de uma chave string de topo, tolerando JSON incompleto depois dela.
 * Varredura manual em vez de regex: montar o padrao com template literal
 * comeria as barras de `\s` e `\\`, quebrando o casamento silenciosamente.
 */
function extractStringField(source: string, key: string): string {
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return "";

  const colon = source.indexOf(":", keyIndex + key.length + 2);
  if (colon < 0) return "";

  const quoteStart = source.indexOf('"', colon);
  if (quoteStart < 0) return "";

  let escaped = false;
  for (let i = quoteStart + 1; i < source.length; i++) {
    const char = source[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') {
      const raw = source.slice(quoteStart, i + 1);
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
  }

  return "";
}

function parseModelOutput(content: string): ModelOutput {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Resposta sem JSON.");

  const end = cleaned.lastIndexOf("}");
  let parsed: Record<string, unknown>;

  try {
    if (end <= start) throw new Error("JSON incompleto.");
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    // Resposta truncada: recupera o que veio completo em vez de perder tudo
    const body = cleaned.slice(start);
    parsed = {
      summary_md: extractStringField(body, "summary_md"),
      criteria: extractArrayObjects(body, "criteria"),
      strengths: extractArrayObjects(body, "strengths"),
      improvements: extractArrayObjects(body, "improvements"),
      habits: extractArrayObjects(body, "habits"),
    };
    const recovered = (parsed.criteria as unknown[]).length;
    if (recovered === 0) throw new Error("Resposta truncada e sem criterios recuperaveis.");
    console.warn(`[analyze-transcript-playbook] resposta truncada; ${recovered} criterios recuperados`);
  }

  const criteria: ModelCriterionResult[] = (Array.isArray(parsed?.criteria) ? parsed.criteria : [])
    .filter((item: unknown) => !!item && typeof item === "object")
    .map((item: Record<string, unknown>) => ({
      criterion_key: String(item.criterion_key ?? "").trim(),
      verdict: isVerdict(item.verdict) ? item.verdict : "missed",
      evidence: String(item.evidence ?? "").trim(),
      feedback: String(item.feedback ?? "").trim(),
    }))
    .filter((item: ModelCriterionResult) => item.criterion_key.length > 0);

  const strengths = (Array.isArray(parsed?.strengths) ? parsed.strengths : [])
    .map((item: Record<string, unknown>) => ({
      title: String(item?.title ?? "").trim(),
      evidence: String(item?.evidence ?? "").trim(),
    }))
    .filter((item: { title: string }) => item.title.length > 0);

  const improvements = (Array.isArray(parsed?.improvements) ? parsed.improvements : [])
    .map((item: Record<string, unknown>) => ({
      criterion_key: item?.criterion_key ? String(item.criterion_key).trim() : null,
      title: String(item?.title ?? "").trim(),
      suggestion: String(item?.suggestion ?? "").trim(),
    }))
    .filter((item: { title: string }) => item.title.length > 0);

  // Descarta chaves fora do catalogo: o vocabulario fixo e o que torna a
  // comparacao entre atendimentos possivel.
  const habits = (Array.isArray(parsed?.habits) ? parsed.habits : [])
    .map((item: Record<string, unknown>) => ({
      habit_key: String(item?.habit_key ?? "").trim(),
      observed: item?.observed === "negative" ? ("negative" as const) : ("positive" as const),
      evidence: String(item?.evidence ?? "").trim(),
    }))
    .filter((item: { habit_key: string }) => isKnownHabit(item.habit_key));

  return {
    summary_md: String(parsed?.summary_md ?? "").trim(),
    criteria,
    strengths,
    improvements,
    habits,
  };
}

/** Criterios ativos que o modelo deixou de avaliar. */
function missingCriteria(criteria: RubricCriterion[], output: ModelOutput): string[] {
  const answered = new Set(output.criteria.map((item) => item.criterion_key));
  return criteria
    .filter((criterion) => criterion.is_active && !answered.has(criterion.criterion_key))
    .map((criterion) => criterion.criterion_key);
}

/** Forma comparavel: sem acento, sem pontuacao, sem caixa, espacos colapsados. */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Turnos de fala: linhas "[m:ss] Nome (Papel): fala" viram blocos por falante,
 * unindo linhas consecutivas da mesma pessoa.
 *
 * O transcritor corta a fala em segmentos de poucos segundos, cada um com seu
 * proprio prefixo de timestamp e nome. Uma frase completa quase nunca cabe num
 * segmento so — o prefixo cai no meio dela e quebra tanto a leitura da IA
 * quanto a conferencia de citacoes.
 */
interface TranscriptTurn {
  timestamp: string | null;
  speaker: string | null;
  text: string;
}

/** Identificador de cue do WebVTT ("transcript:357") — nao e fala. */
const VTT_CUE_ID = /^[A-Za-z_][A-Za-z0-9_-]*:\d+$/;
/** Tag de voz do WebVTT: <v>Nome:</v>texto */
const VTT_VOICE = /^<v(?:\s[^>]*)?>\s*([^<]*?)\s*:?\s*<\/v>\s*(.*)$/i;
/** Linha "[m:ss] Nome (Papel): texto" produzida pelo parser JSON do Daily. */
const SPEAKER_LINE = /^(?:\[(\d+:\d{2}(?::\d{2})?)\]\s*)?([^:]{1,60}?)\s*:\s*(.*)$/;

function pushTurn(
  turns: TranscriptTurn[],
  timestamp: string | null,
  speaker: string | null,
  text: string,
): void {
  // Restos de marcacao (</v>, <c>) atrapalham tanto a leitura quanto o
  // casamento literal das citacoes
  const clean = text.replace(/<\/?[^>]+>/g, "").trim();
  if (!clean) return;

  const previous = turns[turns.length - 1];
  if (previous && previous.speaker === speaker) previous.text += ` ${clean}`;
  else turns.push({ timestamp, speaker, text: clean });
}

/**
 * Divide a transcricao em turnos de fala, aceitando os dois formatos gravados:
 * o do parser JSON do Daily ("[m:ss] Nome (Papel): texto") e o WebVTT cru, que
 * chega quando a resposta do Daily nao e JSON e cai no fallback de
 * process-daily-recording.
 *
 * O WebVTT precisa de tratamento proprio: identificadores de cue
 * ("transcript:357") casam com o padrao "Nome: texto" e viravam um falante
 * chamado "transcript", intercalando numeros no meio de cada frase.
 */
function parseTranscriptTurns(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Estrutura do WebVTT: cabecalho, notas, tempos e identificadores de cue
    if (line === "WEBVTT" || line.startsWith("NOTE ")) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line) || VTT_CUE_ID.test(line)) continue;

    const voice = line.match(VTT_VOICE);
    if (voice) {
      pushTurn(turns, null, voice[1] || null, voice[2]);
      continue;
    }

    const match = line.match(SPEAKER_LINE);
    // Pontuacao de frase no suposto nome = dois-pontos no meio de uma fala
    if (match && !/[.!?"]/.test(match[2])) {
      pushTurn(turns, match[1] ?? null, match[2], match[3]);
      continue;
    }

    // Linha sem marcador de falante: continuacao do turno anterior
    const previous = turns[turns.length - 1];
    if (previous) previous.text += ` ${line.replace(/<\/?[^>]+>/g, "").trim()}`;
    else pushTurn(turns, null, null, line);
  }

  return turns;
}

/** Transcricao agrupada por turno de fala — o que a IA le. */
function groupTranscriptForPrompt(transcript: string): string {
  const turns = parseTranscriptTurns(transcript);
  if (turns.length === 0) return transcript;
  return turns
    .map((turn) => {
      const timestamp = turn.timestamp ? `[${turn.timestamp}] ` : "";
      return turn.speaker ? `${timestamp}${turn.speaker}: ${turn.text}` : turn.text;
    })
    .join("\n");
}

/**
 * Textos contra os quais uma citacao pode ser conferida:
 *
 * 1. A fala corrida inteira, sem prefixos de nome/timestamp.
 * 2. Um fluxo por falante — toda a fala de cada pessoa concatenada em ordem.
 *    Cobre a interrupcao: o vendedor e cortado pelo cliente e retoma a frase;
 *    a citacao da IA junta as duas metades, que so sao contiguas no fluxo dele.
 * 3. A transcricao crua normalizada, valvula de escape se o parsing de turnos
 *    nao reconhecer o formato.
 */
function buildEvidenceHaystacks(transcript: string): string[] {
  const turns = parseTranscriptTurns(transcript);

  const bySpeaker = new Map<string, string[]>();
  for (const turn of turns) {
    if (!turn.speaker) continue;
    const parts = bySpeaker.get(turn.speaker) ?? [];
    parts.push(turn.text);
    bySpeaker.set(turn.speaker, parts);
  }

  return [
    normalizeForMatch(turns.map((turn) => turn.text).join(" ")),
    ...[...bySpeaker.values()].map((parts) => normalizeForMatch(parts.join(" "))),
    normalizeForMatch(transcript),
  ].filter((haystack) => haystack.length > 0);
}

/**
 * Um fragmento confere se aparece literalmente em algum dos textos, ou — para
 * fragmentos longos — se ao menos 80% das janelas de 5 palavras aparecem no
 * MESMO texto. A tolerancia absorve uma palavra corrigida pela IA ("tornalas"
 * -> "torna-las") sem aceitar parafrase, que erra em quase todas as janelas.
 */
function fragmentMatches(fragment: string, haystacks: string[]): boolean {
  for (const haystack of haystacks) {
    if (haystack.includes(fragment)) return true;
  }

  const words = fragment.split(" ");
  const WINDOW = 5;
  if (words.length < WINDOW + 3) return false; // curto: so vale casamento literal

  const windows: string[] = [];
  for (let i = 0; i + WINDOW <= words.length; i++) {
    windows.push(words.slice(i, i + WINDOW).join(" "));
  }

  for (const haystack of haystacks) {
    let hits = 0;
    for (const window of windows) {
      if (haystack.includes(window)) hits++;
    }
    if (hits / windows.length >= 0.8) return true;
  }
  return false;
}

/**
 * Confere se a evidencia e mesmo copia da transcricao.
 *
 * Instrucao no prompt nao basta: o modelo ja devolveu parafrase ("O cliente
 * descreve a empresa do trecho 55 ao 280") no lugar de citacao. Sem conferir,
 * uma evidencia inventada passa por prova.
 *
 * Reticencias unem trechos separados, entao cada fragmento e checado por si.
 * Fragmentos muito curtos nao provam nada e sao ignorados.
 */
function isEvidenceLiteral(evidence: string, haystacks: string[]): boolean {
  if (!evidence.trim()) return true; // ausencia de evidencia nao e falsificacao

  const fragments = evidence
    .split(/\.{3}|…/)
    .map((fragment) => normalizeForMatch(fragment))
    .filter((fragment) => fragment.length >= 15);

  if (fragments.length === 0) return false; // so restou texto curto demais para provar

  return fragments.every((fragment) => fragmentMatches(fragment, haystacks));
}

// =====================================================
// Resolucao da fonte da transcricao
// =====================================================

interface ResolvedSource {
  transcript: string;
  workspaceId: string;
  companyId: string;
  activityId: string | null;
  leadId: string | null;
  sellerId: string | null;
  playbookId: string | null;
  /** Quem conduziu, extraido dos participantes — usado no prompt. */
  sellerName: string | null;
  /** Nome do vendedor creditado (dono da atividade), gravado como snapshot. */
  creditedName: string | null;
  clientName: string | null;
  /**
   * Quando o atendimento aconteceu. Vira `occurred_at` no resultado e e o eixo
   * de tempo do painel — sem ele, avaliar em lote um periodo passado carimbaria
   * tudo com a data do processamento.
   */
  occurredAt: string | null;
}

/** Chave de comparacao de nomes: sem acento, sem caixa, espacos colapsados. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Membro creditado pelo atendimento: o responsavel pela ATIVIDADE.
 *
 * Regra de negocio: a avaliacao pertence estritamente a quem esta vinculado
 * aquela atividade — nao ao dono do card nem a quem conduziu a reuniao. O card
 * pode ser reatribuido depois; a atividade e o registro daquele atendimento.
 *
 * O fallback para o appointment cobre apenas o caso em que nao existe atividade
 * vinculada (reuniao criada direto pelo AppointmentDialog). Havendo atividade,
 * o responsavel dela e a unica fonte.
 */
function resolveActivityOwner(
  activityId: string | null,
  activityAssignedTo: string | null,
  appointmentAssignedTo: string | null,
): string | null {
  if (activityId) return activityAssignedTo;
  return appointmentAssignedTo;
}

/**
 * Nomes de quem esteve na sala, segundo os participantes registrados pelo Daily
 * (is_owner = dono da sala).
 *
 * Serve apenas para o prompt saber quem e o vendedor e quem e o cliente dentro
 * da transcricao. O CREDITO do score nao vem daqui: e sempre do responsavel
 * pelo card (regra de negocio), mesmo quando outra pessoa conduziu a reuniao.
 */
async function resolveMeetingParticipants(
  supabase: SB,
  appointmentId: string,
): Promise<{ hostName: string | null; guestName: string | null }> {
  const { data: participants } = await supabase
    .from("daily_meeting_participants")
    .select("user_name, is_owner")
    .eq("appointment_id", appointmentId);

  const decode = (value: string | null): string | null => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const rows = (participants ?? []) as Array<{ user_name: string | null; is_owner: boolean }>;
  const hostName = decode(rows.find((p) => p.is_owner)?.user_name ?? null);
  const guestName = decode(rows.find((p) => !p.is_owner)?.user_name ?? null);

  return { hostName, guestName };
}

async function resolveDailyRecording(supabase: SB, recordingId: string): Promise<ResolvedSource | null> {
  const { data: recording } = await supabase
    .from("daily_recordings")
    .select("id, transcription_text, appointment_id, workspace_id")
    .eq("id", recordingId)
    .maybeSingle();

  if (!recording?.transcription_text) return null;

  const { data: appointment } = await supabase
    .from("crm_appointments")
    .select("id, lead_id, assigned_to, created_by, analysis_playbook_id, start_time, contact_id")
    .eq("id", recording.appointment_id)
    .maybeSingle();

  // O vinculo canonico e a atividade; o appointment e o fallback para
  // reunioes criadas sem atividade (AppointmentDialog).
  const { data: activity } = await supabase
    .from("crm_lead_activities")
    .select("id, assigned_to, lead_id, analysis_playbook_id, scheduled_at")
    .eq("appointment_id", recording.appointment_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", recording.workspace_id)
    .maybeSingle();

  const { hostName, guestName } = await resolveMeetingParticipants(
    supabase,
    recording.appointment_id as string,
  );

  const leadId = (activity?.lead_id as string) ?? (appointment?.lead_id as string) ?? null;
  const sellerId = resolveActivityOwner(
    (activity?.id as string) ?? null,
    (activity?.assigned_to as string) ?? null,
    (appointment?.assigned_to as string) ?? null,
  );

  let creditedName: string | null = null;
  if (sellerId) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", sellerId).maybeSingle();
    creditedName = (profile?.name as string) ?? null;
  }
  // Para o prompt vale quem falou na reuniao, que pode nao ser o creditado
  const sellerName = hostName ?? creditedName;

  let clientName = guestName;
  if (!clientName && appointment?.contact_id) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("name")
      .eq("id", appointment.contact_id)
      .maybeSingle();
    clientName = (contact?.name as string) ?? null;
  }

  return {
    transcript: recording.transcription_text as string,
    workspaceId: recording.workspace_id as string,
    companyId: (workspace?.company_id as string) ?? "",
    activityId: (activity?.id as string) ?? null,
    leadId,
    sellerId,
    playbookId:
      (activity?.analysis_playbook_id as string) ?? (appointment?.analysis_playbook_id as string) ?? null,
    sellerName,
    creditedName,
    clientName,
    occurredAt:
      (activity?.scheduled_at as string) ?? (appointment?.start_time as string) ?? null,
  };
}

/**
 * Monta a transcricao a partir dos chunks indexados ao vivo.
 *
 * Necessario porque o Daily so entrega transcricao ao vivo quando /transcription/start
 * e chamado sem pedir armazenamento — nesses casos nao existe arquivo para buscar
 * depois, e a unica copia da conversa sao estes chunks.
 *
 * Os chunks ja vem no formato "Nome: fala" e sao agrupados por daily_room_name.
 */
async function resolveMeetingChunks(supabase: SB, appointmentId: string): Promise<ResolvedSource | null> {
  const { data: appointment } = await supabase
    .from("crm_appointments")
    .select(
      "id, workspace_id, lead_id, assigned_to, created_by, contact_id, daily_room_name, analysis_playbook_id, start_time",
    )
    .eq("id", appointmentId)
    .maybeSingle();

  if (!appointment?.daily_room_name) return null;

  const { data: chunks } = await supabase
    .from("meeting_transcript_chunks")
    .select("content, chunk_index")
    .eq("meeting_id", appointment.daily_room_name)
    .order("chunk_index", { ascending: true });

  const rows = (chunks ?? []) as Array<{ content: string | null }>;
  const transcript = rows
    .map((chunk) => chunk.content ?? "")
    .filter(Boolean)
    .join("\n");

  if (!transcript.trim()) return null;

  const { data: activity } = await supabase
    .from("crm_lead_activities")
    .select("id, assigned_to, lead_id, analysis_playbook_id, scheduled_at")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", appointment.workspace_id)
    .maybeSingle();

  const { hostName, guestName } = await resolveMeetingParticipants(supabase, appointmentId);

  const leadId = (activity?.lead_id as string) ?? (appointment.lead_id as string) ?? null;
  const sellerId = resolveActivityOwner(
    (activity?.id as string) ?? null,
    (activity?.assigned_to as string) ?? null,
    (appointment.assigned_to as string) ?? null,
  );

  let creditedName: string | null = null;
  if (sellerId) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", sellerId).maybeSingle();
    creditedName = (profile?.name as string) ?? null;
  }
  const sellerName = hostName ?? creditedName;

  let clientName = guestName;
  if (!clientName && appointment.contact_id) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("name")
      .eq("id", appointment.contact_id)
      .maybeSingle();
    clientName = (contact?.name as string) ?? null;
  }

  console.log(
    `[analyze-transcript-playbook] avaliando por transcricao ao vivo: appointment=${appointmentId} ` +
      `chunks=${rows.length} chars=${transcript.length}`,
  );

  return {
    transcript,
    workspaceId: appointment.workspace_id as string,
    companyId: (workspace?.company_id as string) ?? "",
    activityId: (activity?.id as string) ?? null,
    leadId,
    sellerId,
    playbookId:
      (activity?.analysis_playbook_id as string) ?? (appointment.analysis_playbook_id as string) ?? null,
    sellerName,
    creditedName,
    clientName,
    occurredAt:
      (activity?.scheduled_at as string) ?? (appointment.start_time as string) ?? null,
  };
}

async function resolveCall(supabase: SB, callId: string): Promise<ResolvedSource | null> {
  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, transcription_text, workspace_id, company_id, activity_id, lead_id, user_id, contact_id, started_at",
    )
    .eq("id", callId)
    .maybeSingle();

  if (!call?.transcription_text) return null;

  let activity:
    | { id: string; assigned_to: string | null; analysis_playbook_id: string | null; scheduled_at: string | null }
    | null = null;
  if (call.activity_id) {
    const { data } = await supabase
      .from("crm_lead_activities")
      .select("id, assigned_to, analysis_playbook_id, scheduled_at")
      .eq("id", call.activity_id)
      .maybeSingle();
    activity = data ?? null;
  }

  const sellerId = resolveActivityOwner(
    (call.activity_id as string) ?? null,
    activity?.assigned_to ?? null,
    (call.user_id as string) ?? null,
  );

  let sellerName: string | null = null;
  if (sellerId) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", sellerId).maybeSingle();
    sellerName = (profile?.name as string) ?? null;
  }

  let clientName: string | null = null;
  if (call.contact_id) {
    const { data: contact } = await supabase
      .from("crm_contacts")
      .select("name")
      .eq("id", call.contact_id)
      .maybeSingle();
    clientName = (contact?.name as string) ?? null;
  }

  return {
    transcript: call.transcription_text as string,
    workspaceId: call.workspace_id as string,
    companyId: call.company_id as string,
    activityId: (call.activity_id as string) ?? null,
    leadId: (call.lead_id as string) ?? null,
    sellerId,
    playbookId: activity?.analysis_playbook_id ?? null,
    sellerName,
    creditedName: sellerName,
    clientName,
    // A atividade da ligacao nasce automatica junto da chamada, mas started_at
    // e a hora real da discagem
    occurredAt: (call.started_at as string) ?? activity?.scheduled_at ?? null,
  };
}

// =====================================================
// Acao: evaluate
// =====================================================

async function handleEvaluate(supabase: SB, body: Record<string, unknown>): Promise<Response> {
  const sourceType = String(body.source_type ?? "");
  const sourceId = String(body.source_id ?? "");

  if (sourceType !== "daily_recording" && sourceType !== "call" && sourceType !== "meeting_chunks") {
    return json({ error: "source_type deve ser 'daily_recording', 'call' ou 'meeting_chunks'." }, 400);
  }
  if (!sourceId) return json({ error: "source_id obrigatorio." }, 400);

  const source =
    sourceType === "daily_recording"
      ? await resolveDailyRecording(supabase, sourceId)
      : sourceType === "call"
        ? await resolveCall(supabase, sourceId)
        : await resolveMeetingChunks(supabase, sourceId);

  if (!source) return json({ error: "Transcricao nao encontrada ou vazia." }, 404);
  if (!source.playbookId) {
    // Sem analise vinculada a avaliacao nao se aplica; quem chamou usa o fluxo generico.
    return json({ success: true, skipped: true, reason: "no_playbook_linked" });
  }

  const { data: playbook } = await supabase
    .from("analysis_playbooks")
    .select("id, company_id, name, playbook_md, guidelines, ai_model, status")
    .eq("id", source.playbookId)
    .maybeSingle();

  if (!playbook) return json({ success: true, skipped: true, reason: "playbook_not_found" });

  const { data: version } = await supabase
    .from("analysis_rubric_versions")
    .select("id")
    .eq("playbook_id", playbook.id)
    .eq("status", "active")
    .maybeSingle();

  if (!version) return json({ success: true, skipped: true, reason: "no_active_rubric" });

  const { data: criteriaRows } = await supabase
    .from("analysis_rubric_criteria")
    .select("criterion_key, stage, name, description, weight, is_active, sort_order")
    .eq("version_id", version.id)
    .order("sort_order", { ascending: true });

  const criteria = ((criteriaRows ?? []) as RubricCriterion[]).map((criterion) => ({
    ...criterion,
    weight: Number(criterion.weight) || 1,
  }));

  if (criteria.filter((criterion) => criterion.is_active).length === 0) {
    return json({ success: true, skipped: true, reason: "rubric_without_active_criteria" });
  }

  const companyId = (playbook.company_id as string) || source.companyId;

  // Preserva points_applied: reanalisar substitui o resultado mas nao reaplica pontos.
  const { data: previousResult } = await supabase
    .from("activity_analysis_results")
    .select("id, points_applied")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();

  const alreadyApplied = Boolean(previousResult?.points_applied);

  const baseRow = {
    workspace_id: source.workspaceId,
    company_id: companyId,
    activity_id: source.activityId,
    lead_id: source.leadId,
    seller_id: source.sellerId,
    // Snapshot do nome: o app nao consegue ler profiles de quem nao e colega
    // de empresa, e o ranking mostrava "Sem nome"
    seller_name: source.creditedName,
    source_type: sourceType,
    source_id: sourceId,
    playbook_id: playbook.id,
    rubric_version_id: version.id,
    // Eixo de tempo do painel. Sem a data da origem, o processamento e a melhor
    // aproximacao — e o que o comportamento antigo ja fazia.
    occurred_at: source.occurredAt ?? new Date().toISOString(),
    status: "processing",
    error_message: null,
  };

  const { data: resultRow, error: upsertError } = await supabase
    .from("activity_analysis_results")
    .upsert(baseRow, { onConflict: "source_type,source_id" })
    .select("id")
    .single();

  if (upsertError) return json({ error: upsertError.message }, 500);
  const resultId = resultRow.id as string;

  const failResult = async (message: string, status: number) => {
    await supabase
      .from("activity_analysis_results")
      .update({ status: "failed", error_message: message })
      .eq("id", resultId);
    return json({ error: message }, status);
  };

  try {
    const { data: company } = await supabase
      .from("companies")
      .select("analysis_guidelines")
      .eq("id", companyId)
      .maybeSingle();

    const openPoints = source.sellerId
      ? ((
          await supabase
            .from("seller_development_points")
            .select("point_type, point_key, label, status, occurrences")
            .eq("company_id", companyId)
            .eq("seller_id", source.sellerId)
            .in("status", ["open", "recurrent"])
        ).data ?? [])
      : [];

    const model = (playbook.ai_model as string) || DEFAULT_MODEL;
    // Agrupada por turno de fala: sem o prefixo repetido a cada segmento, a
    // IA le frases inteiras e consegue citar literalmente
    const groupedTranscript = groupTranscriptForPrompt(source.transcript);
    const activeCriteria = criteria.filter((criterion) => criterion.is_active);

    const buildPromptFor = (chunk: RubricCriterion[], isFirst: boolean) =>
      buildUserPrompt({
        companyGuidelines: (company?.analysis_guidelines as string) ?? null,
        playbookGuidelines: (playbook.guidelines as string) ?? null,
        playbookMd: (playbook.playbook_md as string) ?? null,
        criteria: chunk,
        // Pontos em aberto so contextualizam o feedback qualitativo do 1o lote
        openPoints: isFirst ? openPoints : [],
        transcript: groupedTranscript,
        sellerName: source.sellerName,
        clientName: source.clientName,
      });

    const callChunk = async (chunk: RubricCriterion[], isFirst: boolean): Promise<ModelOutput> => {
      const messages = [
        {
          role: "system" as const,
          content: isFirst ? buildSystemPrompt() : buildCriteriaOnlySystemPrompt(),
        },
        { role: "user" as const, content: buildPromptFor(chunk, isFirst) },
      ];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      let response: Response;
      try {
        response = await chatCompletionWithFallback(
          // Sem max_tokens de proposito: o lote e dimensionado (CRITERIA_PER_CALL)
          // para caber com folga no orcamento de saida padrao do modelo
          { model, messages, temperature: 0.2, response_format: { type: "json_object" } },
          { companyId, supabase, signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        if (response.status === 429 || response.status === 402) throw new AiQuotaError(response.status);
        const detail = await response.text();
        throw new Error(`IA respondeu ${response.status}: ${detail.slice(0, 300)}`);
      }

      const payload = await response.json();
      const rawContent = payload?.choices?.[0]?.message?.content ?? "";
      const finishReason = payload?.choices?.[0]?.finish_reason ?? "";
      try {
        return parseModelOutput(rawContent);
      } catch (parseError) {
        // Sem esse log a falha fica invisivel: o boot/shutdown da function nao diz nada
        console.error(
          `[analyze-transcript-playbook] falha ao interpretar lote. ` +
            `finish_reason=${finishReason} chars=${rawContent.length} ` +
            `erro=${parseError instanceof Error ? parseError.message : parseError}`,
        );
        throw parseError;
      }
    };

    const runChunk = async (chunk: RubricCriterion[], index: number): Promise<ModelOutput | null> => {
      try {
        return await callChunk(chunk, index === 0);
      } catch (firstError) {
        if (firstError instanceof AiQuotaError) throw firstError;
        console.warn(`[analyze-transcript-playbook] lote ${index + 1} falhou, retentando:`, firstError);
        try {
          return await callChunk(chunk, index === 0);
        } catch (secondError) {
          if (secondError instanceof AiQuotaError) throw secondError;
          console.error(`[analyze-transcript-playbook] lote ${index + 1} falhou apos retry:`, secondError);
          return null;
        }
      }
    };

    // Lotes de criterios contra a mesma transcricao, em paralelo limitado
    const chunks: RubricCriterion[][] = [];
    for (let i = 0; i < activeCriteria.length; i += CRITERIA_PER_CALL) {
      chunks.push(activeCriteria.slice(i, i + CRITERIA_PER_CALL));
    }
    console.log(
      `[analyze-transcript-playbook] avaliando ${activeCriteria.length} criterios em ${chunks.length} lote(s)`,
    );

    let chunkOutputs: Array<ModelOutput | null>;
    try {
      chunkOutputs = await runWithConcurrency(
        chunks.map((chunk, index) => () => runChunk(chunk, index)),
        EVAL_CONCURRENCY,
      );
    } catch (e) {
      if (e instanceof AiQuotaError) {
        return await failResult(
          e.status === 429 ? "Limite de uso da IA atingido." : "Creditos de IA insuficientes.",
          e.status,
        );
      }
      throw e;
    }

    // Resumo/fortes/melhorias/habitos vem do 1o lote; criterios, de todos
    const firstOutput = chunkOutputs[0];
    const output: ModelOutput = {
      summary_md: firstOutput?.summary_md ?? "",
      strengths: firstOutput?.strengths ?? [],
      improvements: firstOutput?.improvements ?? [],
      habits: firstOutput?.habits ?? [],
      criteria: chunkOutputs.filter(Boolean).flatMap((item) => (item as ModelOutput).criteria),
    };

    // Retry dirigido: reenvia SO os criterios sem veredicto, nao o JSON inteiro
    let missing = missingCriteria(activeCriteria, output);
    if (missing.length > 0) {
      console.warn(`[analyze-transcript-playbook] criterios ausentes apos os lotes: ${missing.join(", ")}`);
      const missingSet = new Set(missing);
      try {
        const retryOutput = await callChunk(
          activeCriteria.filter((criterion) => missingSet.has(criterion.criterion_key)),
          false,
        );
        const answeredKeys = new Set(output.criteria.map((item) => item.criterion_key));
        for (const item of retryOutput.criteria) {
          if (!answeredKeys.has(item.criterion_key)) output.criteria.push(item);
        }
      } catch (e) {
        if (e instanceof AiQuotaError) {
          return await failResult(
            e.status === 429 ? "Limite de uso da IA atingido." : "Creditos de IA insuficientes.",
            e.status,
          );
        }
        console.warn("[analyze-transcript-playbook] retry dirigido falhou, seguindo sem ele:", e);
      }
      missing = missingCriteria(activeCriteria, output);
    }

    // Falha tecnica em massa nao pode virar nota: acima do limiar a avaliacao
    // FALHA (e pode ser reprocessada) em vez de gravar 'missed' injusto.
    if (missing.length > Math.ceil(activeCriteria.length * MAX_MISSING_RATIO)) {
      return await failResult(
        `A IA nao avaliou ${missing.length} de ${activeCriteria.length} criterios. Tente novamente.`,
        502,
      );
    }

    // Monta o resultado por criterio na ordem da rubrica, SO com os ativos:
    // criterio desativado nao foi enviado a IA e aparecia como 'missed' no modal.
    // Criterio ausente vira 'missed' explicito: mantem o denominador do score.
    const answered = new Map(output.criteria.map((item) => [item.criterion_key, item]));
    const evidenceHaystacks = buildEvidenceHaystacks(source.transcript);
    let unverifiedEvidence = 0;

    const criteriaResults = activeCriteria.map((criterion) => {
      const item = answered.get(criterion.criterion_key);
      const evidence = item?.evidence ?? "";
      // Marcamos em vez de rebaixar o veredicto: parafrasear nao significa que
      // o julgamento esteja errado, mas quem le precisa saber que aquele trecho
      // nao foi conferido contra a transcricao.
      const evidenceVerified = isEvidenceLiteral(evidence, evidenceHaystacks);
      if (!evidenceVerified) unverifiedEvidence++;

      return {
        criterion_key: criterion.criterion_key,
        name: criterion.name,
        stage: criterion.stage,
        weight: criterion.weight,
        verdict: item?.verdict ?? "missed",
        evidence,
        evidence_verified: evidenceVerified,
        feedback: item?.feedback ?? (item ? "" : "Não avaliado pela IA nesta análise."),
      };
    });

    if (unverifiedEvidence > 0) {
      console.warn(
        `[analyze-transcript-playbook] ${unverifiedEvidence} de ${criteriaResults.length} evidencias ` +
          "nao conferem com a transcricao (provavel parafrase)",
      );
    }

    // Guarda do N/A: so falha quando sobram criterios avaliados de menos para
    // que o score calculado sobre o restante signifique alguma coisa.
    const naCount = criteriaResults.filter((item) => item.verdict === "not_applicable").length;
    const scoredCount = criteriaResults.length - naCount;
    if (scoredCount < MIN_SCORED_CRITERIA) {
      return await failResult(
        `A IA marcou ${naCount} de ${activeCriteria.length} criterios como "nao se aplica", ` +
          `restando apenas ${scoredCount} avaliados. Confira se a transcricao esta completa e tente novamente.`,
        502,
      );
    }

    // Pontos fortes tambem citam a transcricao e merecem a mesma conferencia
    const verifiedStrengths = output.strengths.map((strength) => ({
      ...strength,
      evidence_verified: isEvidenceLiteral(strength.evidence, evidenceHaystacks),
    }));

    const verdicts = new Map<string, Verdict>(
      criteriaResults.map((item) => [item.criterion_key, item.verdict as Verdict]),
    );
    const score = computeScore(criteria, verdicts);

    let recurrences: PointOutcome[] = [];
    let corrected: PointOutcome[] = [];
    let newAchievements: string[] = [];

    if (source.sellerId && !alreadyApplied) {
      const applied = await applyDevelopmentPoints({
        supabase,
        companyId,
        sellerId: source.sellerId,
        playbookId: playbook.id as string,
        // So met/missed movem a memoria do vendedor: partial e not_applicable
        // nao mudam estado. O corte por peso minimo mora em applyDevelopmentPoints.
        criterionVerdicts: criteriaResults
          .filter((item) => item.verdict === "met" || item.verdict === "missed")
          .map((item) => ({
            criterion_key: item.criterion_key,
            label: item.name,
            verdict: item.verdict as Verdict,
            weight: item.weight,
          })),
        habitObservations: output.habits.map((habit) => ({
          habit_key: habit.habit_key,
          observed: habit.observed,
        })),
        // Data do atendimento, nao do processamento: os cards do painel filtram
        // os pontos por periodo
        occurredAt: source.occurredAt ?? undefined,
      });
      recurrences = applied.recurrences;
      corrected = applied.corrected;

      // Avaliacoes descartadas ficam de fora de qualquer calculo
      const { data: history } = await supabase
        .from("activity_analysis_results")
        .select("score")
        .eq("company_id", companyId)
        .eq("seller_id", source.sellerId)
        .eq("status", "done")
        .is("disregarded_at", null)
        .not("score", "is", null)
        .neq("id", resultId)
        .order("occurred_at", { ascending: false })
        .limit(3);

      const { count: totalAnalyses } = await supabase
        .from("activity_analysis_results")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("seller_id", source.sellerId)
        .is("disregarded_at", null);

      newAchievements = await evaluateAchievements({
        supabase,
        companyId,
        sellerId: source.sellerId,
        currentScore: score,
        correctedCount: corrected.length,
        previousScores: ((history ?? []) as Array<{ score: number }>).map((row) => row.score),
        totalAnalyses: totalAnalyses ?? 1,
        earnedAt: source.occurredAt ?? undefined,
      });
    }

    // Score zero = a reuniao nao bateu nenhum criterio do playbook (conversa
    // que virou outra coisa, transcricao sem conteudo comercial). Nao e
    // desempenho do vendedor: entra ja desconsiderada, fora das metricas.
    const autoDisregard = score === 0;

    await supabase
      .from("activity_analysis_results")
      .update({
        score,
        summary_md: output.summary_md || null,
        criteria_results: criteriaResults,
        strengths: verifiedStrengths,
        improvements: output.improvements,
        habits: output.habits,
        recurrences,
        corrected,
        points_applied: alreadyApplied || !!source.sellerId,
        model,
        status: "done",
        error_message: null,
        ...(autoDisregard ? { disregarded_at: new Date().toISOString(), disregarded_by: null } : {}),
      })
      .eq("id", resultId);


    // Mantem a UI atual funcionando: o resumo ocupa o campo que a analise
    // generica preenchia. Os dados ricos ficam no modal dedicado.
    const summaryText = output.summary_md || `Atendimento avaliado. Score ${score}/100.`;
    if (sourceType === "meeting_chunks") {
      // Sem registro de gravacao para anexar o resumo: ele vive apenas no
      // resultado da avaliacao, exibido no modal.
    } else if (sourceType === "daily_recording") {
      await supabase.from("daily_recordings").update({ ai_analysis: summaryText }).eq("id", sourceId);
    } else {
      await supabase
        .from("calls")
        .update({
          ai_analysis: { text: summaryText, model, generated_at: new Date().toISOString() },
          ai_analyzed_at: new Date().toISOString(),
        })
        .eq("id", sourceId);
    }

    if (source.sellerId) {
      const recurrenceNote = recurrences.length > 0 ? ` ${recurrences.length} ponto(s) recorrente(s).` : "";
      const correctedNote = corrected.length > 0 ? ` ${corrected.length} ponto(s) corrigido(s).` : "";
      await supabase.from("user_notifications").insert({
        user_id: source.sellerId,
        workspace_id: source.workspaceId,
        type: "analysis_result",
        title: autoDisregard
          ? "Atendimento desconsiderado na avaliação"
          : `Atendimento avaliado: ${score}/100`,
        message: autoDisregard
          ? `${playbook.name}. A reunião não atendeu a nenhum critério e ficou fora das métricas.`
          : `${playbook.name}.${correctedNote}${recurrenceNote}`.trim(),
        action_url: "/crm/desempenho",
        related_lead_id: source.leadId,
        is_read: false,
      });
    }


    console.log(
      `[analyze-transcript-playbook] result=${resultId} score=${score} recorrencias=${recurrences.length} ` +
        `correcoes=${corrected.length} conquistas=${newAchievements.length} modelo=${model}`,
    );

    return json({
      success: true,
      result_id: resultId,
      score,
      recurrences: recurrences.length,
      corrected: corrected.length,
      achievements: newAchievements,
    });
  } catch (e) {
    console.error("[analyze-transcript-playbook] falha na avaliacao:", e);
    return await failResult(e instanceof Error ? e.message : "Erro inesperado.", 500);
  }
}

// =====================================================
// Acao: coaching-brief
// =====================================================

async function handleCoachingBrief(supabase: SB, body: Record<string, unknown>): Promise<Response> {
  const companyId = String(body.company_id ?? "");
  const sellerId = String(body.seller_id ?? "");
  const requestedBy = body.requested_by ? String(body.requested_by) : null;

  if (!companyId || !sellerId) return json({ error: "company_id e seller_id obrigatorios." }, 400);

  const { data: results } = await supabase
    .from("activity_analysis_results")
    .select("score, summary_md, criteria_results, strengths, improvements, habits, occurred_at")
    .eq("company_id", companyId)
    .eq("seller_id", sellerId)
    .eq("status", "done")
    // Uma avaliacao descartada nao representa o vendedor: orientar o gestor com
    // base nela seria pior do que nao orientar
    .is("disregarded_at", null)
    .order("occurred_at", { ascending: false })
    .limit(10);

  if (!results || results.length === 0) {
    return json({ error: "Este vendedor ainda nao tem atendimentos avaliados." }, 404);
  }

  const { data: points } = await supabase
    .from("seller_development_points")
    .select("point_type, point_key, label, status, occurrences")
    .eq("company_id", companyId)
    .eq("seller_id", sellerId)
    .in("status", ["open", "recurrent"]);

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", sellerId)
    .maybeSingle();

  const sellerName = (profile?.name as string) || (profile?.email as string) || "o vendedor";

  const scoreLine = (results as Array<{ score: number | null; occurred_at: string }>)
    .map((row) => `${row.occurred_at.slice(0, 10)}: ${row.score ?? "-"}`)
    .join(" | ");

  const failedCriteria: string[] = [];
  for (const row of results as Array<{ criteria_results: unknown }>) {
    const items = Array.isArray(row.criteria_results) ? row.criteria_results : [];
    for (const item of items as Array<{ verdict?: string; name?: string }>) {
      if (item?.verdict === "missed" && item?.name) failedCriteria.push(item.name);
    }
  }

  const pointLines = (
    (points ?? []) as Array<{
      point_type: string;
      point_key: string;
      label: string | null;
      status: string;
      occurrences: number;
    }>
  )
    .map(
      (point) =>
        `- ${developmentPointLabel(point)} (${POINT_STATUS_PT[point.status] ?? point.status}, ${point.occurrences}x)`,
    )
    .join("\n");

  const userPrompt = [
    `## Vendedor\n${sellerName}`,
    `## Scores recentes (mais recente primeiro)\n${scoreLine}`,
    pointLines ? `## Pontos de desenvolvimento ativos\n${pointLines}` : "",
    failedCriteria.length > 0
      ? `## Criterios que mais falharam\n${[...new Set(failedCriteria)].slice(0, 15).map((c) => `- ${c}`).join("\n")}`
      : "",
    `## Resumos dos ultimos atendimentos\n${(results as Array<{ summary_md: string | null }>)
      .map((row, index) => `### Atendimento ${index + 1}\n${row.summary_md ?? "(sem resumo)"}`)
      .join("\n\n")
      .slice(0, 40_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `Voce orienta gestores comerciais sobre como desenvolver seus vendedores.

Escreva um brief de coaching em markdown, direto e pratico, com esta estrutura:
## Leitura geral
## Pontos fortes a reforcar
## O que precisa evoluir
## Como conduzir a proxima conversa de feedback
## Sugestao de foco para as proximas semanas

Regras: fale COM o gestor SOBRE o vendedor. Seja especifico e baseado nos dados
recebidos, sem inventar fatos. Sem emojis. Portugues do Brasil. Maximo 600 palavras.
Ao citar um criterio ou habito, use o nome como recebeu, em linguagem natural —
nunca identificadores tecnicos com underscore.`;

  const response = await chatCompletionWithFallback(
    {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // Sem max_tokens: o teto anterior cortava o brief no meio de uma frase
      temperature: 0.4,
    },
    { companyId, supabase },
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error(`[analyze-transcript-playbook] coaching-brief IA ${response.status}: ${detail.slice(0, 300)}`);
    return json({ error: "Nao foi possivel gerar a orientacao agora." }, 502);
  }

  const payload = await response.json();
  const brief = String(payload?.choices?.[0]?.message?.content ?? "").trim();
  if (!brief) return json({ error: "A IA retornou uma orientacao vazia." }, 502);

  await supabase.from("seller_coaching_briefs").upsert(
    {
      company_id: companyId,
      seller_id: sellerId,
      brief_md: brief,
      model: DEFAULT_MODEL,
      generated_by: requestedBy,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,seller_id" },
  );

  return json({ success: true, brief_md: brief });
}

// =====================================================
// Acao: rebuild-points
// =====================================================

/**
 * Refaz os pontos de desenvolvimento e as conquistas do vendedor considerando
 * apenas as avaliacoes validas. Chamada depois de desconsiderar (ou reconsiderar)
 * uma avaliacao.
 *
 * E puro recalculo a partir de dados que ja existem: rodar duas vezes produz o
 * mesmo resultado, e nao ha o que vazar.
 */
async function handleRebuildPoints(supabase: SB, body: Record<string, unknown>): Promise<Response> {
  const companyId = String(body.company_id ?? "");
  const sellerId = String(body.seller_id ?? "");

  if (!companyId || !sellerId) return json({ error: "company_id e seller_id obrigatorios." }, 400);

  const summary = await rebuildSellerMemory({ supabase, companyId, sellerId });
  return json({ success: true, ...summary });
}

// =====================================================
// Entrada
// =====================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "evaluate");

    if (action === "coaching-brief") return await handleCoachingBrief(supabase, body);
    if (action === "rebuild-points") return await handleRebuildPoints(supabase, body);
    if (action === "evaluate") return await handleEvaluate(supabase, body);

    return json({ error: `Acao desconhecida: ${action}` }, 400);
  } catch (e) {
    console.error("[analyze-transcript-playbook] erro inesperado:", e);
    return json({ error: e instanceof Error ? e.message : "Erro inesperado." }, 500);
  }
});
