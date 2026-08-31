import type { DocBlock, DocSection, ProductDoc } from "./types";

// Serializador YAML minimo (sem dependencias) para exportar a documentação
// em formato consumivel por agentes de IA.

const indent = (level: number) => "  ".repeat(level);

function scalar(value: string): string {
  const v = String(value ?? "");
  if (v.includes("\n")) {
    return `|-\n${v
      .split("\n")
      .map((line) => `${indent(1)}${line}`)
      .join("\n")}`;
  }
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function scalarAt(value: string, level: number): string {
  const v = String(value ?? "");
  if (!v.includes("\n")) return scalar(v);
  return `|-\n${v
    .split("\n")
    .map((line) => `${indent(level + 1)}${line}`)
    .join("\n")}`;
}

function blockToYaml(block: DocBlock, level: number): string[] {
  const out: string[] = [];
  out.push(`${indent(level)}- tipo: ${block.type}`);
  const l = level + 1;
  switch (block.type) {
    case "paragraph":
    case "subheading":
    case "note":
      out.push(`${indent(l)}texto: ${scalarAt(block.text, l)}`);
      break;
    case "list":
      out.push(`${indent(l)}itens:`);
      block.items.forEach((item) => out.push(`${indent(l + 1)}- ${scalarAt(item, l + 1)}`));
      break;
    case "table":
      out.push(`${indent(l)}colunas:`);
      block.headers.forEach((h) => out.push(`${indent(l + 1)}- ${scalar(h)}`));
      out.push(`${indent(l)}linhas:`);
      block.rows.forEach((row) => {
        out.push(`${indent(l + 1)}-`);
        row.forEach((cell) => out.push(`${indent(l + 2)}- ${scalarAt(cell, l + 2)}`));
      });
      break;
  }
  return out;
}

function sectionToYaml(section: DocSection, level: number): string[] {
  const out: string[] = [];
  out.push(`${indent(level)}- id: ${scalar(section.id)}`);
  const l = level + 1;
  out.push(`${indent(l)}numero: ${scalar(section.number)}`);
  out.push(`${indent(l)}titulo: ${scalarAt(section.title, l)}`);
  if (section.summary) out.push(`${indent(l)}resumo: ${scalarAt(section.summary, l)}`);
  if (section.blocks.length) {
    out.push(`${indent(l)}conteudo:`);
    section.blocks.forEach((b) => out.push(...blockToYaml(b, l + 1)));
  }
  if (section.subsections?.length) {
    out.push(`${indent(l)}subsecoes:`);
    section.subsections.forEach((sub) => {
      out.push(`${indent(l + 1)}- id: ${scalar(sub.id)}`);
      out.push(`${indent(l + 2)}numero: ${scalar(sub.number)}`);
      out.push(`${indent(l + 2)}titulo: ${scalarAt(sub.title, l + 2)}`);
      if (sub.blocks.length) {
        out.push(`${indent(l + 2)}conteudo:`);
        sub.blocks.forEach((b) => out.push(...blockToYaml(b, l + 3)));
      }
    });
  }
  return out;
}

export function productDocToYaml(doc: ProductDoc): string {
  const lines: string[] = [];
  lines.push(`titulo: ${scalar(doc.title)}`);
  lines.push(`subtitulo: ${scalar(doc.subtitle)}`);
  lines.push(`versao: ${scalar(doc.version)}`);
  lines.push(`atualizado_em: ${scalar(doc.updatedAt)}`);
  lines.push("secoes:");
  doc.sections.forEach((s) => lines.push(...sectionToYaml(s, 1)));
  return lines.join("\n") + "\n";
}
