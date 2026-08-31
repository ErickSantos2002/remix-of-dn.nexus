import { useEffect, useMemo, useState } from "react";
import { Download, FileCode2, BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { productDoc } from "@/docs/product/content";
import { productDocToYaml } from "@/docs/product/toYaml";
import type { DocBlock, DocSection } from "@/docs/product/types";
import { cn } from "@/lib/utils";

function BlockView({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "subheading":
      return (
        <h3 className="mt-8 mb-3 text-lg font-semibold text-foreground">{block.text}</h3>
      );
    case "paragraph":
      return <p className="mb-4 leading-relaxed text-muted-foreground">{block.text}</p>;
    case "note":
      return (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {block.text}
        </div>
      );
    case "list":
      return (
        <ul className="mb-4 space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-muted-foreground">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="mb-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40">
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left font-semibold text-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border align-top">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-muted-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function SectionView({ section }: { section: DocSection }) {
  return (
    <section id={section.id} className="scroll-mt-24 break-inside-avoid">
      <h2 className="mb-2 border-b border-border pb-3 font-display text-2xl font-bold text-foreground">
        {section.number}. {section.title}
      </h2>
      {section.summary && (
        <p className="mb-6 text-sm text-muted-foreground">{section.summary}</p>
      )}
      {section.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
      {section.subsections?.map((sub) => (
        <div key={sub.id} id={sub.id} className="scroll-mt-24">
          <h3 className="mb-3 mt-8 font-display text-xl font-semibold text-foreground">
            {sub.number} {sub.title}
          </h3>
          {sub.blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      ))}
    </section>
  );
}

export default function ProductDocs() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(productDoc.sections[0]?.id ?? "");

  useEffect(() => {
    document.title = "Documentacao de Recursos | Nexus AI";
  }, []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return productDoc.sections;
    const matches = (text: string) => text.toLowerCase().includes(q);
    const blockText = (b: DocBlock) =>
      b.type === "table"
        ? [...b.headers, ...b.rows.flat()].join(" ")
        : b.type === "list"
          ? b.items.join(" ")
          : b.text;
    return productDoc.sections.filter(
      (s) =>
        matches(s.title) ||
        matches(s.summary ?? "") ||
        s.blocks.some((b) => matches(blockText(b))) ||
        (s.subsections ?? []).some(
          (sub) => matches(sub.title) || sub.blocks.some((b) => matches(blockText(b))),
        ),
    );
  }, [query]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  const handleYaml = () => {
    const yaml = productDocToYaml(productDoc);
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexus-ai-documentacao.yaml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {productDoc.title}
          </h1>
          <p className="text-sm text-muted-foreground">{productDoc.subtitle}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            v{productDoc.version} — atualizado em {productDoc.updatedAt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Download className="mr-2 h-4 w-4" />
            Baixar PDF
          </Button>
          <Button variant="outline" onClick={handleYaml}>
            <FileCode2 className="mr-2 h-4 w-4" />
            YAML para IA
          </Button>
        </div>
      </div>

      <div className="flex flex-1 print:block">
        <aside className="sticky top-0 hidden max-h-screen w-72 shrink-0 self-start overflow-y-auto border-r border-border p-4 lg:block print:hidden">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            Sumário
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar recurso..."
              className="pl-8"
            />
          </div>
          <nav className="space-y-0.5">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  active === s.id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {s.number}. {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-6 py-8 print:overflow-visible print:px-0">
          <div className="mx-auto max-w-4xl space-y-14 print:max-w-none">
            <div className="hidden print:block">
              <h1 className="font-display text-3xl font-bold">{productDoc.title}</h1>
              <p className="text-muted-foreground">{productDoc.subtitle}</p>
            </div>
            {sections.map((s) => (
              <SectionView key={s.id} section={s} />
            ))}
            {sections.length === 0 && (
              <p className="text-muted-foreground">Nenhum recurso encontrado para a busca.</p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
