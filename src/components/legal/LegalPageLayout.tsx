import { Link } from "react-router-dom";

import type { ReactNode } from "react";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  list?: ReactNode[];
};

type LegalPageLayoutProps = {
  title: string;
  version: string;
  updatedAt: string;
  intro?: string[];
  sections: LegalSection[];
  footer?: string[];
};

const legalLinks = [
  { label: "Privacidade", to: "/legal/politica-de-privacidade" },
  { label: "Segurança da informação", to: "/legal/politica-de-seguranca-da-informacao" },
  { label: "Cookies", to: "/legal/politica-de-cookies" },
  { label: "Atendimento automatizado (IA)", to: "/legal/aviso-de-atendimento-automatizado" },
  { label: "Termos de uso", to: "/legal/termos-de-uso" },
];

const LegalPageLayout = ({ title, version, updatedAt, intro, sections, footer }: LegalPageLayoutProps) => {
  return (
    <div className="dn-atmosphere min-h-screen text-foreground">

      <header className="relative border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[640px] space-y-3">
              <Link
                to="/login"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
              >
                Voltar para o login
              </Link>
              <h1 className="font-brand text-3xl leading-[1.05] tracking-[-0.03em] text-balance sm:text-4xl lg:text-5xl">
                {title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                Versão: {version}
              </span>
              <span className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                Atualizado em {updatedAt}
              </span>
            </div>
          </div>

          <nav aria-label="Documentos legais" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {legalLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex min-h-12 items-center justify-center rounded-2xl border border-border/70 bg-card/60 px-4 py-3 text-center text-sm leading-5 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <article className="glass-card mx-auto max-w-4xl rounded-[28px] border border-border/60 p-6 shadow-2xl shadow-background/20 sm:p-8 lg:p-10">
          <div className="space-y-8">
            {intro?.length ? (
              <section className="space-y-4 text-sm leading-7 text-foreground/90 sm:text-base">
                {intro.map((paragraph) => (
                  <p key={paragraph} className="overflow-wrap-anywhere text-pretty">
                    {paragraph}
                  </p>
                ))}
              </section>
            ) : null}

            {sections.map((section, index) => (
              <section
                key={`${section.title}-${index}`}
                className="scroll-mt-24 space-y-4 border-t border-border/50 pt-8 first:border-t-0 first:pt-0"
              >
                <h2 className="text-xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-2xl">
                  {section.title}
                </h2>

                {section.paragraphs?.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="overflow-wrap-anywhere text-sm leading-7 text-foreground/85 text-pretty sm:text-base"
                  >
                    {paragraph}
                  </p>
                ))}

                {section.list?.length ? (
                  <ul className="space-y-3 pl-5 text-sm leading-7 text-foreground/85 sm:text-base">
                    {section.list.map((item, i) => (
                      <li key={i} className="list-disc overflow-wrap-anywhere pl-1 text-pretty marker:text-primary">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}

            {footer?.length ? (
              <footer className="border-t border-border/50 pt-8">
                <div className="space-y-2 text-sm leading-7 text-muted-foreground sm:text-base">
                  {footer.map((paragraph) => (
                    <p key={paragraph} className="overflow-wrap-anywhere text-pretty">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </footer>
            ) : null}
          </div>
        </article>
      </main>
    </div>
  );
};

export default LegalPageLayout;
