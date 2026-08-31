// playbook-extract-rubric
//
// Le o Markdown APROVADO de uma analise e propoe uma rubrica de avaliacao:
// criterios objetivos agrupados por etapa, com peso sugerido.
//
// A extracao e feita POR LOTES: o Markdown e fatiado deterministicamente por
// headings (em codigo, nunca pela IA) e cada trecho vai numa chamada propria.
// Isso garante que o documento inteiro seja processado — uma passada unica em
// documentos longos faz o modelo detalhar o inicio e resumir o meio.
//
// Ao final, uma verificacao deterministica produz um coverage_report gravado na
// versao da rubrica: quais trechos geraram criterios, quais nao geraram (com a
// justificativa do modelo) e quais falharam. O admin ve isso no RubricEditor —
// "a IA pulou" e "a IA avaliou e descartou com razao" deixam de ser ambiguos.
//
// A rubrica nasce como rascunho (analysis_rubric_versions.status = 'draft').
// O admin revisa/edita na UI e so entao ativa - nada e aplicado automaticamente.
//
// Roda uma vez por playbook (nao por reuniao), entao vale usar o modelo mais
// capaz configurado na analise.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatCompletionWithFallback } from "../_shared/geminiClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Protecao contra documentos anomalos. Playbooks reais ficam em ~100k caracteres.
const MAX_PLAYBOOK_CHARS = 400_000;
// Teto global de criterios — guarda contra documentos anomalos, nao limite de
// produto: a avaliacao processa a rubrica em lotes e aguenta rubricas grandes.
// Se o corte acontecer, ele e LOGADO e registrado no coverage_report — nunca
// silencioso, e descarta pelos MENORES PESOS, nao pelo fim do documento.
const MAX_CRITERIA = 150;
// Tamanho alvo de cada lote. O corte so acontece em fronteira de heading.
const SECTION_TARGET_CHARS = 15_000;
// Acima disso o lote e fechado no proximo heading de qualquer nivel.
const SECTION_HARD_CHARS = 30_000;
// Chamadas simultaneas a IA.
const CONCURRENCY = 3;

const SYSTEM_PROMPT = `Voce e um especialista em qualidade de atendimento comercial.

Sua tarefa: ler um TRECHO de um playbook comercial e extrair dele criterios objetivos
de uma RUBRICA DE AVALIACAO, que sera usada para avaliar transcricoes de atendimentos reais.
O playbook foi dividido em trechos e cada trecho e processado separadamente — extraia
criterios APENAS do trecho recebido.

Regras de cobertura (as mais importantes):
- Percorra TODAS as secoes do trecho, do inicio ao fim, sem pular nenhuma.
- Toda secao "Criterio de Homologacao" DEVE gerar ao menos um criterio: ela ja e um
  criterio pronto escrito pelo proprio playbook.
- Tambem viram criterios: checklists, "o que evitar", regras de conducao, perguntas
  obrigatorias, principios e sinais esperados.
- Nao ha numero minimo nem maximo de criterios por trecho: extraia o que o trecho contem.
- Se o trecho NAO contiver nada verificavel numa transcricao, retorne "criteria" vazio e
  explique em "coverage_note" por que nada foi extraido (ex.: secao institucional, slide
  apenas com video). Se voce cobriu tudo e extraiu criterios, "coverage_note" pode ser null.

Regras de qualidade:
- Extraia apenas criterios VERIFICAVEIS em uma transcricao (o que o vendedor disse ou deixou de dizer).
- Ignore instrucoes que dependem de contexto visual, material de apoio ou postura corporal.
- Cada criterio deve ser autoexplicativo: alguem que nao leu o playbook precisa conseguir julga-lo.
- Agrupe por etapa usando os titulos do proprio trecho (ex.: "Diagnostico", "Slide 07", "Fechamento").
- criterion_key: slug curto, estavel, em snake_case, sem acentos (ex.: "fez_diagnostico_antes_de_apresentar").
- weight: 1 para criterios comuns, 2 para importantes, 3 para os decisivos segundo o playbook.
- Escreva em portugues do Brasil.

Responda SOMENTE com um objeto JSON no formato:
{"criteria":[{"criterion_key":"...","stage":"...","name":"...","description":"...","weight":1}],"coverage_note":null}`;

interface ExtractedCriterion {
  criterion_key: string;
  stage: string;
  name: string;
  description: string;
  weight: number;
}

interface PlaybookSection {
  index: number;
  label: string;
  content: string;
  headings: number;
  homologationSections: number;
}

type SectionStatus = "covered" | "no_criteria" | "failed";

interface SectionReport {
  index: number;
  label: string;
  chars: number;
  headings: number;
  homologation_sections: number;
  criteria_count: number;
  status: SectionStatus;
  note: string | null;
}

interface CoverageReport {
  sections: SectionReport[];
  sections_total: number;
  sections_no_criteria: number;
  sections_failed: number;
  homologation_total: number;
  homologation_covered: number;
  criteria_truncated: number;
  model: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function stripAccentsLower(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Fatia o Markdown em trechos por fronteira de heading, EM CODIGO.
 * Cada caractere do documento pertence a exatamente um trecho — a cobertura
 * do documento inteiro e garantida por construcao, nao por instrucao de prompt.
 */
function splitIntoSections(md: string): PlaybookSection[] {
  const lines = md.split("\n");
  const rawSections: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length > 0) {
      rawSections.push(current);
      current = [];
      currentChars = 0;
    }
  };

  for (const line of lines) {
    const isMajorHeading = /^##?\s/.test(line);
    const isAnyHeading = /^#{1,6}\s/.test(line);
    if ((isMajorHeading && currentChars >= SECTION_TARGET_CHARS) || (isAnyHeading && currentChars >= SECTION_HARD_CHARS)) {
      flush();
    }
    current.push(line);
    currentChars += line.length + 1;
  }
  flush();

  return rawSections.map((sectionLines, index) => {
    const headingLines = sectionLines.filter((l) => /^#{1,6}\s/.test(l));
    const firstHeading = headingLines[0]?.replace(/^#{1,6}\s*/, "").trim();
    const homologationSections = headingLines.filter((l) => stripAccentsLower(l).includes("homologa")).length;
    return {
      index,
      label: (firstHeading || `Trecho ${index + 1}`).slice(0, 120),
      content: sectionLines.join("\n"),
      headings: headingLines.length,
      homologationSections,
    };
  });
}

/** Extrai o JSON da resposta do modelo, tolerando cercas de codigo e texto ao redor. */
function parseSectionResponse(content: string): { criteria: ExtractedCriterion[]; coverageNote: string | null } {
  const withoutFences = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Resposta do modelo nao contem JSON.");

  const parsed = JSON.parse(withoutFences.slice(start, end + 1));
  const raw = Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  const coverageNote = typeof parsed?.coverage_note === "string" && parsed.coverage_note.trim()
    ? parsed.coverage_note.trim().slice(0, 500)
    : null;

  const criteria: ExtractedCriterion[] = [];
  for (const item of raw) {
    const name = String(item?.name ?? "").trim();
    if (!name) continue;

    const key = slugify(String(item?.criterion_key ?? "")) || slugify(name);
    if (!key) continue;

    const weight = Number(item?.weight);
    criteria.push({
      criterion_key: key,
      stage: String(item?.stage ?? "").trim(),
      name,
      description: String(item?.description ?? "").trim(),
      weight: Number.isFinite(weight) && weight > 0 ? Math.min(weight, 5) : 1,
    });
  }

  return { criteria, coverageNote };
}

/** Erro de IA que deve abortar a extracao inteira (limite de uso / creditos). */
class AiQuotaError extends Error {
  status: number;
  constructor(status: number) {
    super(`IA respondeu ${status}`);
    this.status = status;
  }
}

interface SectionResult {
  section: PlaybookSection;
  criteria: ExtractedCriterion[];
  coverageNote: string | null;
  failed: boolean;
}

async function extractSection(
  section: PlaybookSection,
  sectionsTotal: number,
  playbookName: string,
  guidelines: string | null,
  model: string,
  companyId: string,
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<SectionResult> {
  const userPrompt = [
    `## Analise: ${playbookName}`,
    guidelines ? `\n## Diretrizes desta analise\n${guidelines}` : "",
    `\n## Trecho ${section.index + 1} de ${sectionsTotal} do playbook`,
    section.homologationSections > 0
      ? `\nEste trecho contem ${section.homologationSections} secao(oes) "Criterio de Homologacao" — cada uma DEVE gerar ao menos um criterio.`
      : "",
    `\n${section.content}`,
  ]
    .filter(Boolean)
    .join("\n");

  const attempt = async (): Promise<SectionResult> => {
    const response = await chatCompletionWithFallback(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        // Sem max_tokens: o volume de criterios varia por trecho e um teto fixo truncaria JSON
        response_format: { type: "json_object" },
      },
      { companyId, supabase: admin },
    );

    if (!response.ok) {
      if (response.status === 429 || response.status === 402) throw new AiQuotaError(response.status);
      const detail = await response.text();
      throw new Error(`IA respondeu ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content ?? "";
    const { criteria, coverageNote } = parseSectionResponse(content);
    return { section, criteria, coverageNote, failed: false };
  };

  try {
    const result = await attempt();
    // Trecho com secao de homologacao nao pode voltar vazio: e criterio pronto
    // escrito no playbook. Uma nova tentativa resolve a maioria dos casos.
    if (result.criteria.length === 0 && section.homologationSections > 0) {
      console.warn(
        `[playbook-extract-rubric] trecho ${section.index + 1} com ${section.homologationSections} homologacao(oes) voltou vazio, retentando`,
      );
      const retry = await attempt();
      if (retry.criteria.length > 0) return retry;
      return { ...retry, coverageNote: retry.coverageNote ?? result.coverageNote };
    }
    return result;
  } catch (firstError) {
    if (firstError instanceof AiQuotaError) throw firstError;
    console.warn(
      `[playbook-extract-rubric] trecho ${section.index + 1} falhou, retentando:`,
      firstError instanceof Error ? firstError.message : firstError,
    );
    try {
      return await attempt();
    } catch (secondError) {
      if (secondError instanceof AiQuotaError) throw secondError;
      console.error(
        `[playbook-extract-rubric] trecho ${section.index + 1} falhou apos retry:`,
        secondError instanceof Error ? secondError.message : secondError,
      );
      return { section, criteria: [], coverageNote: "Falha ao processar este trecho.", failed: true };
    }
  }
}

/** Executa as extracoes com um pool de concorrencia limitada, preservando a ordem. */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Nao autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Nao autenticado." }, 401);
    const userId = userData.user.id;

    const { playbook_id } = (await req.json().catch(() => ({}))) as { playbook_id?: string };
    if (!playbook_id) return json({ error: "playbook_id obrigatorio." }, 400);

    const { data: playbook, error: playbookErr } = await admin
      .from("analysis_playbooks")
      .select("id, company_id, name, playbook_md, md_approved_at, guidelines, ai_model")
      .eq("id", playbook_id)
      .maybeSingle();

    if (playbookErr) return json({ error: playbookErr.message }, 500);
    if (!playbook) return json({ error: "Analise nao encontrada." }, 404);

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "super_admin" });
    const { data: isCompanyAdmin } = await admin.rpc("is_company_admin", {
      _user_id: userId,
      _company_id: playbook.company_id,
    });
    if (!isSuper && !isCompanyAdmin) {
      return json({ error: "Sem permissao para editar analises desta empresa." }, 403);
    }

    if (!playbook.playbook_md) return json({ error: "Envie o playbook antes de gerar a rubrica." }, 400);
    if (!playbook.md_approved_at) {
      return json({ error: "Aprove o Markdown do playbook antes de gerar a rubrica." }, 400);
    }

    const fullMd = playbook.playbook_md as string;
    if (fullMd.length > MAX_PLAYBOOK_CHARS) {
      console.warn(
        `[playbook-extract-rubric] playbook=${playbook_id} tem ${fullMd.length} chars, cortando em ${MAX_PLAYBOOK_CHARS}`,
      );
    }
    const playbookMd = fullMd.slice(0, MAX_PLAYBOOK_CHARS);
    const guidelines = (playbook.guidelines as string | null)?.trim() || null;
    const model = (playbook.ai_model as string) || "google/gemini-3.1-pro-preview";

    const sections = splitIntoSections(playbookMd);
    console.log(
      `[playbook-extract-rubric] playbook=${playbook_id} chars=${playbookMd.length} trechos=${sections.length} modelo=${model}`,
    );

    let sectionResults: SectionResult[];
    try {
      sectionResults = await runWithConcurrency(
        sections.map(
          (section) => () =>
            extractSection(section, sections.length, playbook.name as string, guidelines, model, playbook.company_id as string, admin),
        ),
        CONCURRENCY,
      );
    } catch (e) {
      if (e instanceof AiQuotaError) {
        if (e.status === 429) {
          return json({ error: "Limite de uso da IA atingido. Tente novamente em instantes." }, 429);
        }
        return json({ error: "Creditos de IA insuficientes." }, 402);
      }
      throw e;
    }

    // Agrega na ordem do documento e garante unicidade das chaves entre trechos
    const seen = new Set<string>();
    const allCriteria: ExtractedCriterion[] = [];
    for (const result of sectionResults) {
      for (const criterion of result.criteria) {
        // Base curta o suficiente para o sufixo nunca ser cortado pelo limite de 60
        const base = criterion.criterion_key.slice(0, 55);
        let key = criterion.criterion_key;
        let suffix = 2;
        while (seen.has(key)) key = `${base}_${suffix++}`;
        seen.add(key);
        allCriteria.push({ ...criterion, criterion_key: key });
      }
    }

    // Excedente sai pelos menores pesos, nunca pelo fim do documento: o
    // fechamento e o investimento sao tao avaliaveis quanto a abertura.
    // Empate de peso descarta o criterio mais tardio primeiro.
    const truncatedCount = Math.max(0, allCriteria.length - MAX_CRITERIA);
    let criteria = allCriteria;
    if (truncatedCount > 0) {
      console.warn(
        `[playbook-extract-rubric] playbook=${playbook_id} extraiu ${allCriteria.length} criterios, cortando em ${MAX_CRITERIA} (${truncatedCount} descartados pelos menores pesos)`,
      );
      const rankedIndexes = allCriteria
        .map((criterion, index) => ({ index, weight: criterion.weight }))
        .sort((a, b) => a.weight - b.weight || b.index - a.index)
        .slice(0, truncatedCount);
      const dropped = new Set(rankedIndexes.map((entry) => entry.index));
      criteria = allCriteria.filter((_, index) => !dropped.has(index));
    }

    if (criteria.length === 0) {
      return json(
        { error: "Nenhum criterio pode ser extraido. Revise o conteudo do playbook e tente novamente." },
        422,
      );
    }

    // Verificacao deterministica de cobertura: todo trecho aparece no relatorio,
    // com o que gerou ou com a justificativa de nao ter gerado nada.
    const sectionReports: SectionReport[] = sectionResults.map((result) => ({
      index: result.section.index,
      label: result.section.label,
      chars: result.section.content.length,
      headings: result.section.headings,
      homologation_sections: result.section.homologationSections,
      criteria_count: result.criteria.length,
      status: result.failed ? "failed" : result.criteria.length > 0 ? "covered" : "no_criteria",
      note: result.coverageNote,
    }));

    const coverageReport: CoverageReport = {
      sections: sectionReports,
      sections_total: sectionReports.length,
      sections_no_criteria: sectionReports.filter((s) => s.status === "no_criteria").length,
      sections_failed: sectionReports.filter((s) => s.status === "failed").length,
      homologation_total: sectionReports.reduce((sum, s) => sum + s.homologation_sections, 0),
      homologation_covered: sectionReports
        .filter((s) => s.criteria_count > 0)
        .reduce((sum, s) => sum + s.homologation_sections, 0),
      criteria_truncated: truncatedCount,
      model,
    };

    // Proxima versao = maior existente + 1
    const { data: lastVersion } = await admin
      .from("analysis_rubric_versions")
      .select("version")
      .eq("playbook_id", playbook_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = ((lastVersion?.version as number) ?? 0) + 1;

    const { data: version, error: versionErr } = await admin
      .from("analysis_rubric_versions")
      .insert({
        playbook_id,
        company_id: playbook.company_id,
        version: nextVersion,
        status: "draft",
        coverage_report: coverageReport,
      })
      .select("id")
      .single();

    if (versionErr) return json({ error: versionErr.message }, 500);

    const { error: criteriaErr } = await admin.from("analysis_rubric_criteria").insert(
      criteria.map((criterion, index) => ({
        version_id: version.id,
        company_id: playbook.company_id,
        criterion_key: criterion.criterion_key,
        stage: criterion.stage || null,
        name: criterion.name,
        description: criterion.description || null,
        weight: criterion.weight,
        sort_order: index,
        is_active: true,
      })),
    );

    if (criteriaErr) {
      // Sem criterios a versao nao serve para nada
      await admin.from("analysis_rubric_versions").delete().eq("id", version.id);
      return json({ error: criteriaErr.message }, 500);
    }

    console.log(
      `[playbook-extract-rubric] playbook=${playbook_id} versao=${nextVersion} criterios=${criteria.length} ` +
        `trechos=${coverageReport.sections_total} sem_criterio=${coverageReport.sections_no_criteria} ` +
        `falhas=${coverageReport.sections_failed} homologacao=${coverageReport.homologation_covered}/${coverageReport.homologation_total} ` +
        `cortados=${truncatedCount} modelo=${model}`,
    );

    return json({
      success: true,
      version_id: version.id,
      version: nextVersion,
      criteria_count: criteria.length,
      coverage: {
        sections_total: coverageReport.sections_total,
        sections_no_criteria: coverageReport.sections_no_criteria,
        sections_failed: coverageReport.sections_failed,
        criteria_truncated: truncatedCount,
      },
    });
  } catch (e) {
    console.error("[playbook-extract-rubric] erro inesperado:", e);
    return json({ error: e instanceof Error ? e.message : "Erro inesperado." }, 500);
  }
});
