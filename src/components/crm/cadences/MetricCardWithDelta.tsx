import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "primary" | "success" | "warning" | "destructive";

interface Props {
  label: string;
  value: number;
  previousValue?: number | null;
  accent?: Accent;
  hint?: string;
  /** Quando true, valor menor é considerado melhor (ex: Não entregues, Pendentes). */
  inverted?: boolean;
  active?: boolean;
  onClick?: () => void;
}

function accentClass(accent?: Accent) {
  if (accent === "primary") return "text-primary";
  if (accent === "success") return "text-success";
  if (accent === "warning") return "text-warning";
  if (accent === "destructive") return "text-destructive";
  return "text-foreground";
}

export function MetricCardWithDelta({
  label,
  value,
  previousValue,
  accent,
  hint,
  inverted,
  active,
  onClick,
}: Props) {
  const hasComparison =
    previousValue !== undefined && previousValue !== null && !Number.isNaN(previousValue);

  let delta: number | null = null;
  let pct: number | null = null;
  if (hasComparison) {
    delta = value - (previousValue as number);
    if ((previousValue as number) > 0) {
      pct = (delta / (previousValue as number)) * 100;
    } else if (value > 0) {
      pct = 100;
    } else {
      pct = 0;
    }
  }

  const isNeutral = delta === null || delta === 0;
  const improved = !isNeutral && (inverted ? (delta as number) < 0 : (delta as number) > 0);
  const deltaCls = isNeutral
    ? "text-muted-foreground"
    : improved
    ? "text-success"
    : "text-destructive";
  const Icon = isNeutral
    ? Minus
    : (delta as number) > 0
    ? TrendingUp
    : TrendingDown;

  const cardCls = onClick
    ? cn(
        "text-left p-3 rounded-xl border transition-all w-full",
        active
          ? "bg-primary/10 border-primary ring-2 ring-primary/40"
          : "bg-secondary/50 border-border/50 hover:border-border hover:bg-secondary",
      )
    : "p-3 rounded-xl bg-secondary/50 border border-border/50";

  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono font-semibold ${accentClass(accent)}`}>{value}</div>
      {hasComparison && (
        <div className={cn("flex items-center gap-1 text-[11px] mt-1", deltaCls)}>
          <Icon className="h-3 w-3" />
          <span className="font-mono">
            {pct === null ? "—" : `${(pct as number) > 0 ? "+" : ""}${(pct as number).toFixed(0)}%`}
          </span>
          <span className="text-muted-foreground/70">vs {previousValue}</span>
        </div>
      )}
      {hint && (
        <div className="text-[11px] text-muted-foreground/80 mt-1 leading-tight">{hint}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardCls}>
        {body}
      </button>
    );
  }
  return <div className={cardCls}>{body}</div>;
}
