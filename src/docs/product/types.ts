// Tipos da documentação tecnica de produto (Nexus AI)

export type DocBlock =
  | { type: "paragraph"; text: string }
  | { type: "subheading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "note"; text: string };

export interface DocSubsection {
  id: string;
  number: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocSection {
  id: string;
  number: string;
  title: string;
  summary?: string;
  blocks: DocBlock[];
  subsections?: DocSubsection[];
}

export interface ProductDoc {
  title: string;
  subtitle: string;
  version: string;
  updatedAt: string;
  sections: DocSection[];
}
