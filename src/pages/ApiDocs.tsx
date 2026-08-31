import { useEffect, useRef } from "react";

export default function ApiDocs() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "API Documentation | Nexus AI";

    // Versao legivel por agentes de IA (a pagina em si e renderizada por JS)
    const mdLink = document.createElement("link");
    mdLink.rel = "alternate";
    mdLink.type = "text/markdown";
    mdLink.href = "/llms-full.txt";
    document.head.appendChild(mdLink);


    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css";
    document.head.appendChild(link);

    // Override SwaggerUI styles for dark theme
    const style = document.createElement("style");
    style.textContent = `
      #swagger-ui .swagger-ui {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .topbar {
        display: none;
      }
      #swagger-ui .swagger-ui .info .title {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .info p,
      #swagger-ui .swagger-ui .info li,
      #swagger-ui .swagger-ui .info table {
        color: hsl(var(--muted-foreground));
      }
      #swagger-ui .swagger-ui .scheme-container {
        background: transparent;
        box-shadow: none;
      }
      #swagger-ui .swagger-ui .opblock-tag {
        color: hsl(var(--foreground));
        border-bottom-color: hsl(var(--border));
      }
      #swagger-ui .swagger-ui .opblock .opblock-summary-description {
        color: hsl(var(--muted-foreground));
      }
      #swagger-ui .swagger-ui .opblock .opblock-section-header {
        background: hsl(var(--muted) / 0.3);
        box-shadow: none;
      }
      #swagger-ui .swagger-ui .opblock .opblock-section-header h4 {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui table thead tr th,
      #swagger-ui .swagger-ui table thead tr td,
      #swagger-ui .swagger-ui .parameter__name,
      #swagger-ui .swagger-ui .parameter__type {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .model-title {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .model {
        color: hsl(var(--muted-foreground));
      }
      #swagger-ui .swagger-ui section.models {
        border-color: hsl(var(--border));
      }
      #swagger-ui .swagger-ui section.models h4 {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .response-col_status {
        color: hsl(var(--foreground));
      }
      #swagger-ui .swagger-ui .response-col_description__inner p {
        color: hsl(var(--muted-foreground));
      }
      #swagger-ui .swagger-ui .btn {
        color: hsl(var(--foreground));
        border-color: hsl(var(--border));
      }
      #swagger-ui .swagger-ui select {
        color: hsl(var(--foreground));
        background: hsl(var(--background));
        border-color: hsl(var(--border));
      }
      #swagger-ui .swagger-ui input[type=text],
      #swagger-ui .swagger-ui textarea {
        color: hsl(var(--foreground));
        background: hsl(var(--background));
        border-color: hsl(var(--border));
      }
      #swagger-ui .swagger-ui .markdown p,
      #swagger-ui .swagger-ui .markdown li {
        color: hsl(var(--muted-foreground));
      }
    `;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SwaggerUIBundle = (window as any).SwaggerUIBundle;
      if (containerRef.current && SwaggerUIBundle) {
        SwaggerUIBundle({
          url: "/openapi.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: "BaseLayout",
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      document.head.removeChild(link);
      if (mdLink.parentNode) document.head.removeChild(mdLink);

      document.head.removeChild(style);
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-xl font-bold text-foreground">Nexus AI API</h1>
          <p className="text-sm text-muted-foreground">
            Documentacao interativa da API REST
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Para agentes de IA:</span>
          <a
            href="/llms.txt"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            llms.txt
          </a>
          <a
            href="/api-docs/index.md"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Indice markdown
          </a>
          <a
            href="/llms-full.txt"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Tudo em um arquivo (llms-full.txt)
          </a>

          <a
            href="/openapi.yaml"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI
          </a>
        </div>
      </div>

      <div
        id="swagger-ui"
        ref={containerRef}
        className="flex-1 p-4 overflow-auto"
      />
    </div>
  );
}
