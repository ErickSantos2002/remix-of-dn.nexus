import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeadSectionProps {
  icon: LucideIcon;
  title: string;
  /** Ações à direita do cabeçalho (ex.: botão "Nova"). */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Cabeçalho padrão das seções do detalhe do lead: ícone, título em caixa normal
 * e chevron opcional. Sem card — o agrupamento visual fica por conta dos
 * divisores da coluna.
 */
export function LeadSection({
  icon: Icon,
  title,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
  contentClassName,
}: LeadSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={isOpen}
            className="flex flex-1 items-center gap-2 min-w-0 text-left transition-colors hover:text-muted-foreground"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">{title}</span>
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                !isOpen && "-rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="flex flex-1 items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">{title}</span>
          </span>
        )}

        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>

      {isOpen && <div className={contentClassName}>{children}</div>}
    </section>
  );
}
