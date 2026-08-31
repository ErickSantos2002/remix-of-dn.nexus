import { cn } from "@/lib/utils";

interface UnreadBadgeProps {
  count: number;
  urgent?: boolean;
  className?: string;
}

/**
 * Badge circular para indicar mensagens nao lidas de um chat no Inbox.
 * Cor primaria por padrao; quando "urgent" (lead aguardando humano)
 * recebe glow + pulse sutil para reforcar a atencao.
 */
export function UnreadBadge({ count, urgent = false, className }: UnreadBadgeProps) {
  if (!count || count <= 0) return null;

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      aria-label={`${count} mensagens nao lidas`}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "min-w-[18px] h-[18px] px-1.5 rounded-full",
        "text-[10px] font-bold leading-none font-mono tabular-nums",
        urgent
          ? "bg-warning text-warning-foreground shadow-[0_0_8px_hsl(var(--warning)/0.6)] animate-pulse"
          : "bg-primary text-primary-foreground shadow-[0_0_6px_hsl(var(--primary)/0.45)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
