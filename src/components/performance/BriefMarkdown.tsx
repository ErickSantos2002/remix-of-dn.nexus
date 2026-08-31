import ReactMarkdown from "react-markdown";

/**
 * Renderiza o markdown do brief de coaching.
 *
 * Componente próprio em vez de reusar `MessageContent`: aquele é do chat, usa
 * tipografia miúda de balão de mensagem e passa o texto por `stripInputHint`,
 * regra que não faz sentido aqui.
 */
export function BriefMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h3 className="text-sm font-semibold text-foreground mt-4 first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-sm font-semibold text-foreground mt-4 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-medium text-foreground mt-3 first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-5 my-2 space-y-1.5">{children}</ol>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-5 my-2 space-y-1.5">{children}</ul>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-3 my-2 italic">{children}</blockquote>
          ),
          code: ({ children }) => (
            <code className="bg-muted/50 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:no-underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
