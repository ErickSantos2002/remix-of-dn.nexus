/**
 * Guarda deterministica para dados de contato extraidos por LLM.
 *
 * Problema que motivou este arquivo: o extrator de dados do orchestrator recebia
 * o historico da conversa INCLUINDO as falas do assistente e pedia "o nome da
 * empresa se mencionado". O modelo passou a extrair o nome do proprio tenant
 * (que o agente cita ao se apresentar e que aparece nos links de reuniao) e a
 * gravar isso em crm_contacts.company, o que renomeava o card do pipeline via
 * o trigger trg_sync_contact_title_to_lead.
 *
 * O prompt e mitigacao. A correcao e aqui: nada e gravado sem que o valor tenha
 * (a) saido de uma mensagem do proprio lead e (b) passado pela blocklist do tenant.
 *
 * IMPORTANTE: este arquivo e TypeScript puro de proposito -- sem Deno.*, sem
 * imports remotos. E o que permite importa-lo dos scripts de teste em Node/tsx.
 */

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------

/** Remove acentos, minusculiza e troca nao-alfanumericos por espaco. "dn.ia" -> "dn ia" */
export function normalizeForMatch(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Igual a normalizeForMatch, mas sem separador algum. "dn.ia" -> "dnia".
 *
 * Esta forma nao e detalhe cosmetico: o tenant se chama "dn.ia" e o dominio e
 * "dnia.ai". Comparando com separadores, "dn ia" !== "dnia" e a blocklist
 * passaria batido justamente no caso real.
 */
export function squash(s: string): string {
  return normalizeForMatch(s).replace(/ /g, "");
}

/** Somente os digitos, para comparacao de telefone. */
export function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const NOISE_TOKENS = new Set([
  // sufixos societarios
  "ltda", "mei", "epp", "eireli", "sa", "inc", "llc", "ltd", "cia", "corp",
  // genericos de nome fantasia
  "grupo", "group", "holding", "empresa", "consultoria", "servicos", "servico",
  "comercio", "industria", "solucoes", "sistemas", "tecnologia",
  // conectivos
  "de", "da", "do", "das", "dos", "em", "the", "of", "and",
  // partes de email/url
  "com", "net", "org", "www", "gmail", "hotmail", "outlook", "http", "https",
]);

/** Tokens com >= 3 chars que nao sao ruido -- o que de fato identifica um nome. */
export function significantTokens(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t));
}

// ---------------------------------------------------------------------------
// Proveniencia: o valor saiu mesmo da boca do lead?
// ---------------------------------------------------------------------------

export interface ProvenanceHaystack {
  spaced: string;
  squashed: string;
  digits: string;
}

export interface HistoryMessage {
  role: string;
  content: string;
}

/**
 * Monta o haystack SOMENTE com as falas do lead (role === "user").
 * As falas do assistente sao deliberadamente excluidas -- sao a origem da
 * contaminacao.
 */
export function buildLeadHaystack(
  history: HistoryMessage[],
  currentMessage?: string,
): ProvenanceHaystack {
  const parts = (history || [])
    .filter((m) => m && m.role === "user" && typeof m.content === "string")
    .map((m) => m.content);
  if (currentMessage) parts.push(currentMessage);

  const raw = parts.join(" \n ");
  const spaced = " " + normalizeForMatch(raw) + " ";
  return {
    spaced,
    squashed: squash(raw),
    digits: digitsOnly(raw),
  };
}

/**
 * O valor extraido tem respaldo nas mensagens do lead?
 *
 * Criterio: aceita quando algum token distintivo (>= 4 chars) aparece, OU
 * quando pelo menos metade dos tokens significativos aparece. A regra dupla
 * cobre os dois padroes reais de normalizacao do LLM:
 *   - expansao    ("acme" -> "ACME Corporation Brasil") -> salvo pelo token longo
 *   - complemento ("ana"  -> "Ana Silva")               -> salvo pela proporcao
 *
 * Tokens >= 6 chars casam por substring no texto sem separadores (cobre
 * "techcorp" dentro de "somosdatechcorp"); tokens curtos exigem limite de
 * palavra, para "casa" nao casar dentro de "casamento".
 */
export function hasLeadProvenance(value: string, hay: ProvenanceHaystack): boolean {
  const tokens = significantTokens(value);

  // Valores sem nenhum token significativo (ex.: "dn.ia" -> "dn", "ia").
  if (tokens.length === 0) {
    const s = squash(value);
    return s.length >= 3 && hay.squashed.includes(s);
  }

  let matched = 0;
  let matchedDistinctive = false;
  for (const t of tokens) {
    const hit = t.length >= 6 ? hay.squashed.includes(t) : hay.spaced.includes(` ${t} `);
    if (hit) {
      matched++;
      if (t.length >= 4) matchedDistinctive = true;
    }
  }

  return matchedDistinctive || (matched >= 1 && matched / tokens.length >= 0.5);
}

/** Email e literal: exige o endereco inteiro nas falas do lead. */
export function hasEmailProvenance(value: string, hay: ProvenanceHaystack): boolean {
  const s = squash(value);
  return s.length >= 5 && hay.squashed.includes(s);
}

/** Telefone: compara so os digitos (formatacao varia demais). */
export function hasPhoneProvenance(value: string, hay: ProvenanceHaystack): boolean {
  const d = digitsOnly(value);
  if (d.length < 8) return false;
  // Compara pelos ultimos 8 digitos: o lead pode omitir DDI/DDD.
  return hay.digits.includes(d.slice(-8));
}

// ---------------------------------------------------------------------------
// Blocklist do tenant
// ---------------------------------------------------------------------------

export interface TenantGuard {
  /** Nomes derivados do tenant (empresa, workspace, agentes): match por CONTENCAO. */
  strong: string[];
  /** Tokens de produto/dominio: match apenas por IGUALDADE. */
  exact: Set<string>;
}

/**
 * As duas listas tem forcas diferentes de proposito.
 *
 * `strong` casa por contencao porque precisa pegar variacoes ("dn.ia solucoes").
 * `exact` casa so por igualdade porque contencao em "nexus" rejeitaria um lead
 * legitimo chamado "Nexus Contabilidade".
 */
export function buildTenantGuard(tenantNames: (string | null | undefined)[]): TenantGuard {
  const exact = new Set([
    "nexus", "dnia", "dniaai", "nexusdniaai", "lovable", "whatsapp", "zapi",
  ]);

  const strong: string[] = [];
  for (const raw of tenantNames || []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const s = squash(raw);
    if (!s) continue;
    if (s.length >= 4) {
      strong.push(s);
    } else {
      // Nomes curtos de agente ("Ana", "Leo") entram so por igualdade. Em
      // `strong` (contencao) eles bloqueariam qualquer nome que os contenha --
      // "Ana" mataria "Ana Paula Silva", que e um lead legitimo.
      exact.add(s);
    }
  }

  return { strong: Array.from(new Set(strong)), exact };
}

export function isTenantValue(value: string, guard: TenantGuard): boolean {
  const s = squash(value);
  if (!s) return true;
  if (guard.exact.has(s)) return true;
  return guard.strong.some((b) => s.includes(b) || b.includes(s));
}

/** Email do proprio tenant (ex.: contato@dnia.ai em assinatura de template). */
function isTenantEmail(value: string, guard: TenantGuard): boolean {
  const domain = (value.split("@")[1] || "").trim();
  if (!domain) return isTenantValue(value, guard);
  const d = squash(domain);
  if (!d) return false;
  if (guard.exact.has(d)) return true;
  return guard.strong.some((b) => d.includes(b));
}

// ---------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------

export type RejectionReason = "tenant" | "no-provenance";

export interface SanitizeInput {
  extracted: Record<string, string>;
  history: HistoryMessage[];
  currentMessage?: string;
  guard: TenantGuard;
}

export interface SanitizeResult {
  clean: Record<string, string>;
  rejected: Array<{ field: string; value: string; reason: RejectionReason }>;
}

/**
 * Filtra o resultado bruto do LLM.
 *
 * Campos protegidos: company, name, email, phone.
 * employee_count e revenue ficam de fora porque sao faixas mapeadas -- exigir
 * proveniencia textual delas daria falso-negativo garantido ("51-200
 * funcionarios" nunca aparece literal na conversa). Esses dois continuam
 * protegidos pela guarda de "so grava se estiver vazio" no ponto de escrita.
 */
export function sanitizeExtractedContactData(input: SanitizeInput): SanitizeResult {
  const { extracted, history, currentMessage, guard } = input;
  const hay = buildLeadHaystack(history, currentMessage);

  const clean: Record<string, string> = {};
  const rejected: Array<{ field: string; value: string; reason: RejectionReason }> = [];

  for (const [field, rawValue] of Object.entries(extracted || {})) {
    if (typeof rawValue !== "string" || !rawValue.trim()) continue;
    const value = rawValue.trim();

    if (field === "company" || field === "name") {
      if (isTenantValue(value, guard)) {
        rejected.push({ field, value, reason: "tenant" });
        continue;
      }
      if (!hasLeadProvenance(value, hay)) {
        rejected.push({ field, value, reason: "no-provenance" });
        continue;
      }
    } else if (field === "email") {
      if (isTenantEmail(value, guard)) {
        rejected.push({ field, value, reason: "tenant" });
        continue;
      }
      if (!hasEmailProvenance(value, hay)) {
        rejected.push({ field, value, reason: "no-provenance" });
        continue;
      }
    } else if (field === "phone") {
      if (!hasPhoneProvenance(value, hay)) {
        rejected.push({ field, value, reason: "no-provenance" });
        continue;
      }
    }

    clean[field] = value;
  }

  return { clean, rejected };
}
