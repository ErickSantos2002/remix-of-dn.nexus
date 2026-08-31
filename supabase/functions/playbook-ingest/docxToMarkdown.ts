// Conversao DOCX -> Markdown estruturado, sem dependencias externas.
//
// Um .docx e um ZIP contendo word/document.xml (OOXML). A tecnica de unzip
// manual (local file header PK\x03\x04 + DecompressionStream "deflate-raw") e a
// mesma usada em parse-document/index.ts.
//
// Diferenca em relacao ao parse-document: aqui NAO queremos texto puro. Os
// estilos de paragrafo (Heading1/2/3) carregam a hierarquia do playbook
// (capitulo > slide > bloco "O que Evitar" / "Criterio de Homologacao"), e e
// essa hierarquia que permite extrair a rubrica por secao depois.
//
// O parser cobre o que um playbook real usa: headings, paragrafos, listas,
// negrito/italico e tabelas simples. Imperfeicoes sao esperadas e corrigidas
// pelo admin na etapa de revisao/aprovacao do Markdown.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  const view = new Uint8Array(data.length);
  view.set(data);
  writer.write(view);
  writer.close();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Localiza um arquivo dentro do ZIP e devolve seu conteudo como texto.
 *
 * A leitura passa pelo central directory (fim do arquivo), nao pelos local file
 * headers. Motivo: quando o ZIP usa data descriptor (flag bit 3), os campos de
 * tamanho do local header vem zerados e so o central directory tem os valores
 * corretos. Word grava .docx exatamente assim.
 */
async function readZipEntry(zipBytes: Uint8Array, targetPath: string): Promise<string | null> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder();

  // Localiza o End of Central Directory varrendo de tras para frente
  // (o comentario final tem no maximo 65535 bytes).
  const minEocd = 22;
  const searchStart = Math.max(0, zipBytes.length - minEocd - 0xffff);
  let eocdOffset = -1;
  for (let i = zipBytes.length - minEocd; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let pos = view.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > zipBytes.length) return null;
    if (view.getUint32(pos, true) !== CENTRAL_FILE_HEADER_SIGNATURE) return null;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const filenameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const filename = decoder.decode(zipBytes.slice(pos + 46, pos + 46 + filenameLength));

    if (filename === targetPath) {
      // O tamanho do campo "extra" pode divergir entre local header e central
      // directory, entao o inicio dos dados sai sempre do local header.
      const localFilenameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const fileData = zipBytes.slice(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return decoder.decode(fileData);
      if (compressionMethod === 8) {
        try {
          return decoder.decode(await inflateRaw(fileData));
        } catch (e) {
          console.error("[playbook-ingest] falha ao descomprimir entrada do zip:", e);
          return null;
        }
      }
      console.warn(`[playbook-ingest] metodo de compressao nao suportado: ${compressionMethod}`);
      return null;
    }

    pos += 46 + filenameLength + extraLength + commentLength;
  }

  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/** Escapa caracteres que teriam significado estrutural no Markdown de saida. */
function escapeMarkdown(text: string): string {
  return text.replace(/([*_`[\]])/g, "\\$1");
}

/**
 * Extrai o texto de um paragrafo preservando negrito e italico por run.
 * Runs vazios ou so com espaco nao recebem marcacao (evita "** **").
 */
function extractParagraphText(paragraphXml: string): string {
  const runs = paragraphXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
  let text = "";

  for (const run of runs) {
    const propsMatch = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const props = propsMatch ? propsMatch[0] : "";
    // <w:b/> liga; <w:b w:val="0"/> desliga
    const isBold = /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(props);
    const isItalic = /<w:i(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(props);

    let runText = "";
    // Percorre <w:t>, <w:tab/> e <w:br/> na ordem em que aparecem
    const parts = run.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g) || [];
    for (const part of parts) {
      if (part.startsWith("<w:tab")) {
        runText += " ";
      } else if (part.startsWith("<w:br")) {
        runText += "\n";
      } else {
        const inner = part.replace(/^<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>$/, "");
        runText += decodeXmlEntities(inner);
      }
    }

    if (!runText) continue;

    const escaped = escapeMarkdown(runText);
    if (!escaped.trim()) {
      text += escaped;
      continue;
    }

    // Aplica marcacao preservando os espacos das bordas fora dos asteriscos
    const leading = escaped.match(/^\s*/)?.[0] ?? "";
    const trailing = escaped.match(/\s*$/)?.[0] ?? "";
    const core = escaped.trim();

    let marked = core;
    if (isBold && isItalic) marked = `***${core}***`;
    else if (isBold) marked = `**${core}**`;
    else if (isItalic) marked = `*${core}*`;

    text += `${leading}${marked}${trailing}`;
  }

  return text.replace(/[ \t]+/g, " ").trim();
}

/** Remove marcacao de negrito/italico — usado nos titulos, que ja sao destaque. */
function stripEmphasis(text: string): string {
  return text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
}

/** Nivel de heading a partir do estilo do paragrafo (pt-BR e en-US). */
function headingLevel(paragraphXml: string): number | null {
  const styleMatch = paragraphXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
  if (!styleMatch) return null;

  const style = styleMatch[1];
  if (/^(Title|T[ií]tulo)$/i.test(style)) return 1;

  const match = style.match(/^(?:Heading|T[ií]tulo)(\d)$/i);
  if (!match) return null;

  const level = Number(match[1]);
  return level >= 1 && level <= 6 ? level : null;
}

function isListParagraph(paragraphXml: string): boolean {
  return /<w:numPr>/.test(paragraphXml);
}

function listIndentLevel(paragraphXml: string): number {
  const match = paragraphXml.match(/<w:ilvl\s+w:val="(\d+)"/);
  return match ? Math.min(Number(match[1]), 5) : 0;
}

function convertTable(tableXml: string): string[] {
  const rows = tableXml.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) || [];
  const lines: string[] = [];

  for (const row of rows) {
    const cells = row.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || [];
    const values = cells.map((cell) => {
      const paragraphs = cell.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
      return paragraphs
        .map(extractParagraphText)
        .filter(Boolean)
        .join(" ")
        .replace(/\|/g, "\\|");
    });

    if (values.some((v) => v.length > 0)) {
      lines.push(`| ${values.join(" | ")} |`);
    }
  }

  if (lines.length === 0) return [];

  // Cabecalho Markdown com base na primeira linha
  const columnCount = (lines[0].match(/\|/g) || []).length - 1;
  const separator = `|${" --- |".repeat(Math.max(columnCount, 1))}`;
  return [lines[0], separator, ...lines.slice(1)];
}

/**
 * Converte o conteudo de um .docx para Markdown.
 * @param fileBytes bytes brutos do arquivo .docx
 * @returns Markdown; string vazia se o documento nao pôde ser lido
 */
export async function docxToMarkdown(fileBytes: Uint8Array): Promise<string> {
  const documentXml = await readZipEntry(fileBytes, "word/document.xml");
  if (!documentXml) return "";

  const bodyMatch = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : documentXml;

  // Varre tabelas e paragrafos na ordem do documento.
  // A alternativa com <w:tbl> primeiro evita reprocessar os paragrafos internos.
  const blocks = body.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];

  const lines: string[] = [];
  let previousWasList = false;

  for (const block of blocks) {
    if (block.startsWith("<w:tbl")) {
      const tableLines = convertTable(block);
      if (tableLines.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push(...tableLines);
        lines.push("");
      }
      previousWasList = false;
      continue;
    }

    const text = extractParagraphText(block);
    if (!text) {
      // Paragrafo vazio e uma quebra de bloco: fecha a lista corrente sem colar
      // o proximo paragrafo no ultimo item.
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      previousWasList = false;
      continue;
    }

    const level = headingLevel(block);
    if (level) {
      if (lines.length > 0) lines.push("");
      // Titulos ja sao destaque: negrito/italico interno vira ruido
      lines.push(`${"#".repeat(level)} ${stripEmphasis(text)}`);
      lines.push("");
      previousWasList = false;
      continue;
    }

    if (isListParagraph(block)) {
      if (!previousWasList && lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`${"  ".repeat(listIndentLevel(block))}- ${text}`);
      previousWasList = true;
      continue;
    }

    if (previousWasList) lines.push("");
    lines.push(text);
    lines.push("");
    previousWasList = false;
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
