/**
 * Gera documentacao estatica (markdown) da API a partir de public/openapi.yaml.
 *
 * Saidas:
 *   public/llms.txt              -> indice no padrao llms.txt para agentes de IA
 *   public/api-docs/index.md     -> visao geral + indice de grupos
 *   public/api-docs/<grupo>.md   -> um arquivo por grupo de rotas (tag)
 *   public/api-docs/full.md      -> documentacao completa em um unico arquivo
 *
 * Uso: bun run scripts/generate-agent-docs.ts
 */
import { parse } from "yaml";
import { mkdir, rm, writeFile } from "node:fs/promises";

const SPEC_PATH = "public/openapi.yaml";
const OUT_DIR = "public/api-docs";
const SITE = "https://nexus.dnia.ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const spec: Any = parse(await Bun.file(SPEC_PATH).text());
const schemas: Record<string, Any> = spec.components?.schemas ?? {};
const paramDefs: Record<string, Any> = spec.components?.parameters ?? {};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function deref(node: Any): Any {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop() as string;
    if (node.$ref.includes("/parameters/")) return paramDefs[name] ?? node;
    return schemas[name] ?? node;
  }
  return node;
}

function refName(node: Any): string | null {
  return typeof node?.$ref === "string" ? (node.$ref.split("/").pop() as string) : null;
}

function typeOf(schema: Any): string {
  if (!schema) return "any";
  const named = refName(schema);
  if (named) return named;
  if (schema.allOf) return schema.allOf.map(typeOf).join(" & ");
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map(typeOf).join(" | ");
  if (schema.type === "array") return `${typeOf(schema.items)}[]`;
  let t: string = schema.type ?? "object";
  if (schema.format) t += `<${schema.format}>`;
  if (schema.enum) t += ` (${schema.enum.join(" | ")})`;
  return t;
}

/** Lista de propriedades de um schema, em markdown, com no maximo 2 niveis. */
function renderProps(schemaIn: Any, depth = 0, seen = new Set<string>()): string[] {
  const named = refName(schemaIn);
  if (named && seen.has(named)) return [`${"  ".repeat(depth)}- (recursivo: ${named})`];
  if (named) seen.add(named);

  let schema = deref(schemaIn);
  if (schema?.allOf) {
    const merged: Any = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      const p = deref(part);
      Object.assign(merged.properties, p.properties ?? {});
      merged.required.push(...(p.required ?? []));
    }
    schema = merged;
  }
  if (schema?.type === "array") schema = deref(schema.items);
  if (!schema?.properties) return [];

  const required: string[] = schema.required ?? [];
  const lines: string[] = [];
  for (const [key, rawProp] of Object.entries<Any>(schema.properties)) {
    const prop = deref(rawProp);
    const bits = [`\`${key}\``, `_${typeOf(rawProp)}_`];
    if (required.includes(key)) bits.push("**obrigatorio**");
    if (prop?.nullable) bits.push("nullable");
    if (prop?.description) bits.push("- " + String(prop.description).replace(/\s+/g, " ").trim());
    lines.push(`${"  ".repeat(depth)}- ${bits.join(" ")}`);
    if (depth < 1) {
      const child = prop?.type === "array" ? prop.items : rawProp;
      if (refName(child) || deref(child)?.properties) {
        lines.push(...renderProps(child, depth + 1, new Set(seen)));
      }
    }
  }
  return lines;
}

function renderOperation(path: string, method: string, op: Any): string {
  const out: string[] = [];
  out.push(`### \`${method.toUpperCase()} ${path}\``);
  out.push("");
  if (op.summary) out.push(op.summary);
  if (op.description) out.push("", String(op.description).trim());
  out.push("");
  if (op.operationId) out.push(`operationId: \`${op.operationId}\``, "");

  const params: Any[] = (op.parameters ?? []).map(deref);
  if (params.length) {
    out.push("**Parametros**", "");
    out.push("| Nome | Em | Obrigatorio | Tipo | Descricao |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const p of params) {
      const desc = String(p.description ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
      const ptype = typeOf(p.schema).replace(/\|/g, "\\|");
      out.push(
        `| \`${p.name}\` | ${p.in} | ${p.required ? "sim" : "nao"} | ${ptype} | ${desc} |`,
      );
    }
    out.push("");
  }

  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    out.push(`**Body** (\`application/json\`${op.requestBody.required ? ", obrigatorio" : ""})`, "");
    const props = renderProps(bodySchema);
    out.push(props.length ? props.join("\n") : `- ${typeOf(bodySchema)}`);
    out.push("");
  }

  const responses = Object.entries<Any>(op.responses ?? {});
  if (responses.length) {
    out.push("**Respostas**", "");
    for (const [code, rawRes] of responses) {
      const res = deref(rawRes);
      const rs = res?.content?.["application/json"]?.schema;
      out.push(`- \`${code}\` ${res?.description ?? ""}${rs ? ` -> ${typeOf(rs)}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// ---- agrupa operacoes por tag ----------------------------------------------
const groups = new Map<string, Array<{ path: string; method: string; op: Any }>>();
const METHODS = ["get", "post", "put", "patch", "delete"];

for (const [path, item] of Object.entries<Any>(spec.paths ?? {})) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const tag = (op.tags && op.tags[0]) || "Outros";
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push({ path, method, op });
  }
}

const infoDesc = String(spec.info?.description ?? "").trim();
const lastUpdated = spec.info?.["x-last-updated"] ?? "";
const opCount = [...groups.values()].reduce((a, b) => a + b.length, 0);

const header = [
  `# ${spec.info?.title ?? "API"} — Referencia da API`,
  "",
  `Versao: \`${spec.info?.version ?? "1.0.0"}\``,
  lastUpdated ? `Atualizado em: \`${lastUpdated}\`` : "",
  `Endpoints: ${opCount} em ${groups.size} grupos`,
  "",
  "Base URLs:",
  ...(spec.servers ?? []).map((s: Any) => `- \`${s.url}\` (${s.description ?? ""})`),
  "",
  "Especificacao OpenAPI: " + `${SITE}/openapi.yaml` + " | " + `${SITE}/openapi.json`,
  "",
]
  .filter((l) => l !== "")
  .join("\n");

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const fullParts: string[] = [header, "", infoDesc, ""];
const indexRows: string[] = [];

for (const [tag, ops] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const file = `${slug(tag)}.md`;
  const body = [
    `# ${tag}`,
    "",
    `Parte da API ${spec.info?.title ?? ""}. ${ops.length} endpoints.`,
    lastUpdated ? `Atualizado em: \`${lastUpdated}\`` : "",
    "",
    `Indice geral: ${SITE}/api-docs/index.md`,
    "",
    ...ops.map(({ path, method, op }) => renderOperation(path, method, op)),
  ].join("\n");
  await writeFile(`${OUT_DIR}/${file}`, body + "\n", "utf-8");

  indexRows.push(`- [${tag}](${SITE}/api-docs/${file}) — ${ops.length} endpoints`);
  fullParts.push(`## ${tag}`, "", ...ops.map(({ path, method, op }) => renderOperation(path, method, op)));
}

const indexMd = [
  header,
  "",
  infoDesc,
  "",
  "## Grupos de endpoints",
  "",
  ...indexRows,
  "",
  `Documentacao completa em um arquivo: ${SITE}/api-docs/full.md`,
  "",
].join("\n");

await writeFile(`${OUT_DIR}/index.md`, indexMd, "utf-8");
const fullMd = fullParts.join("\n") + "\n";
await writeFile(`${OUT_DIR}/full.md`, fullMd, "utf-8");
// Endereco unico e canonico para agentes de IA (convencao llms-full.txt)
await writeFile("public/llms-full.txt", fullMd, "utf-8");

const llms = [
  `# ${spec.info?.title ?? "API"}`,
  "",
  `> API REST multi-tenant de atendimento com agentes de IA, CRM, WhatsApp e base de conhecimento. ${opCount} endpoints. Autenticacao via JWT (\`Authorization: Bearer\`) ou API Key (\`X-API-Key\`); a maioria dos endpoints exige o header \`X-Workspace-Id\`.`,
  "",
  lastUpdated ? `Atualizado em: ${lastUpdated}` : "",
  "",
  "## Documentacao",
  "",
  `- [Documentacao completa em um unico arquivo](${SITE}/llms-full.txt): tudo em um so endereco (recomendado para agentes)`,
  `- [Indice da API](${SITE}/api-docs/index.md): visao geral, autenticacao e lista de grupos`,
  `- [Referencia completa (markdown)](${SITE}/api-docs/full.md): mesmo conteudo de llms-full.txt`,
  `- [OpenAPI YAML](${SITE}/openapi.yaml): especificacao formal`,
  `- [OpenAPI JSON](${SITE}/openapi.json): especificacao formal`,
  "",
  "## Grupos de endpoints",
  "",
  ...indexRows,
  "",
]
  .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
  .join("\n");

await writeFile("public/llms.txt", llms, "utf-8");


console.log(`OK: ${groups.size} grupos, ${opCount} endpoints -> ${OUT_DIR}/ + public/llms.txt`);
