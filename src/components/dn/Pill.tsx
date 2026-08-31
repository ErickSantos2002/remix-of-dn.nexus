import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pill de status do DN.IA Design System V3.
 *
 * Regra: a variante solida e excecao — no maximo uma por bloco. Varias
 * solidas lado a lado anulam a hierarquia.
 */
export type PillStatus = "live" | "info" | "success" | "warning" | "danger" | "neutral";

const OUTLINE: Record<PillStatus, string> = {
  live: "text-[var(--dn-blue-light)] bg-primary/10 border-primary/35",
  info: "text-primary bg-primary/10 border-primary/30",
  success: "text-[var(--dn-green)] bg-[var(--dn-green)]/10 border-[var(--dn-green)]/30",
  warning: "text-[var(--dn-amber)] bg-[var(--dn-amber)]/10 border-[var(--dn-amber)]/30",
  danger: "text-destructive bg-destructive/10 border-destructive/30",
  neutral: "text-muted-foreground bg-muted border-border",
};

const SOLID: Record<PillStatus, string> = {
  live: "bg-primary text-white border-transparent",
  info: "bg-primary text-white border-transparent",
  success: "bg-[var(--dn-green)] text-white border-transparent",
  warning: "bg-[var(--dn-amber)] text-white border-transparent",
  danger: "bg-destructive text-white border-transparent",
  neutral: "bg-muted-foreground text-background border-transparent",
};

interface PillProps {
  status?: PillStatus;
  /** Destaque pontual: KPI, cabecalho de card, estado lido de longe. */
  solid?: boolean;
  /** Dot pulsante. Automatico em status="live". */
  showDot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Pill({ status = "neutral", solid, showDot, className, children }: PillProps) {
  const dot = showDot ?? status === "live";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em]",
        solid ? SOLID[status] : OUTLINE[status],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
            status === "live" && "motion-safe:animate-pulse",
          )}
        />
      )}
      {children}
    </span>
  );
}

export default Pill;
