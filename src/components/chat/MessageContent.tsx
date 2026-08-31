import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { stripInputHint } from '@/components/widget/detectInputType';

interface MessageContentProps {
  content: string;
  className?: string;
}

export function MessageContent({ content, className }: MessageContentProps) {
  return (
    <div className={cn("text-xs leading-relaxed prose prose-sm max-w-none", className)}>
      <ReactMarkdown
        components={{
          // Paragraphs
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          
          // Bold text
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          
          // Italic text
          em: ({ children }) => <em className="italic">{children}</em>,
          
          // Ordered lists (numbered)
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-4 my-2 space-y-1">{children}</ol>
          ),
          
          // Unordered lists (bullets)
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-4 my-2 space-y-1">{children}</ul>
          ),
          
          // List items
          li: ({ children }) => <li className="pl-1">{children}</li>,
          
          // Code inline
          code: ({ children }) => (
            <code className="bg-muted/50 px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
          ),
          
          // Code blocks
          pre: ({ children }) => (
            <pre className="bg-muted/50 p-2 rounded my-2 overflow-x-auto text-[11px]">{children}</pre>
          ),
          
          // Links
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
          
          // Headers
          h1: ({ children }) => <h1 className="text-sm font-bold mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-bold mb-1">{children}</h3>,
          
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-2 my-2 italic opacity-80">
              {children}
            </blockquote>
          ),
        }}
      >
        {stripInputHint(content).replace(/\n/g, '  \n')}
      </ReactMarkdown>
    </div>
  );
}
