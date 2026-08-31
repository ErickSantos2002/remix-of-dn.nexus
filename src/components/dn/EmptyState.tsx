import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty state do DN.IA Design System V3: icone em wash azul, titulo
 * objetivo, explicacao curta e UMA proxima acao.
 */
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10">
        <Icon className="h-5 w-5 text-[var(--accent-ink)]" />
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="max-w-[42ch] text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export default EmptyState;
