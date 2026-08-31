import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KPICardProps {
  title: string;
  value: string | number;
  description: string | React.ReactNode;
  trend: number;
  trendLabel: string;
  icon: React.ReactNode;
  colorClass: string;
  /** Para métricas em que cair é bom (ex.: no-show). */
  invertTrend?: boolean;
  /** Classe de cor aplicada ao valor (ex.: faixa de score). */
  valueClassName?: string;
  onValueClick?: () => void;
  /** Sufixo da tendência: "%" por padrão; use "pts" para variações de score. */
  trendSuffix?: string;
}

/**
 * Cartão de indicador do padrão visual do Analytics.
 * Extraído de src/pages/Analytics.tsx para ser reaproveitado pelo painel de
 * Desempenho — as duas telas devem ler como a mesma família.
 */
export const KPICard = ({
  title,
  value,
  description,
  trend,
  trendLabel,
  icon,
  colorClass,
  invertTrend,
  valueClassName,
  onValueClick,
  trendSuffix = "%",
}: KPICardProps) => {
  const isPositive = invertTrend ? trend < 0 : trend > 0;

  return (
    <div className="glass-card-glow">
      <div className="glass-card-glow-effect"></div>
      <div className="glass-card-glow-content p-5">
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <div className={cn("p-2 rounded-lg", colorClass)}>{icon}</div>
        </div>
        {onValueClick ? (
          <button
            onClick={onValueClick}
            className={`text-3xl font-bold font-display text-foreground hover:text-primary transition-colors cursor-pointer hover:underline ${valueClassName ?? ""}`}
          >
            {value}
          </button>
        ) : (
          <div className={`text-3xl font-bold font-display text-foreground ${valueClassName ?? ""}`}>{value}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
        <div className="flex items-center gap-1 mt-2">
          {trend !== 0 ? (
            <>
              {isPositive ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className={cn("text-sm font-medium", isPositive ? "text-success" : "text-destructive")}>
                {trend > 0 ? "+" : ""}
                {trend}
                {trendSuffix}
              </span>
              <span className="text-xs text-muted-foreground">{trendLabel}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Sem dados anteriores</span>
          )}
        </div>
      </div>
    </div>
  );
};
