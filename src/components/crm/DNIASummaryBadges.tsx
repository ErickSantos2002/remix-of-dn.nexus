import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Flame,
  Snowflake,
  Sun,
  Target,
  ThermometerSun,
  TrendingUp,
} from "lucide-react";

interface DNIASummary {
  temperatura: string | null;
  propensity_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  analyzed_at: string | null;
}

interface DNIASummaryBadgesProps {
  psychology: DNIASummary | null | undefined;
  className?: string;
}

const temperatureConfig = {
  muito_quente: { label: "Muito Quente", icon: Flame, textColor: "text-destructive" },
  quente: { label: "Quente", icon: ThermometerSun, textColor: "text-warning" },
  morno: { label: "Morno", icon: Sun, textColor: "text-warning" },
  frio: { label: "Frio", icon: Snowflake, textColor: "text-primary" },
};

const pillClass = "gap-1.5 h-7 px-3 rounded-full border-border bg-background/50 font-normal text-xs";

/**
 * Resumo do DNIA em pilulas — temperatura, propensao, risco e oportunidade.
 * Renderiza null enquanto o lead nao tiver analise, para nao ocupar espaco a toa.
 */
export function DNIASummaryBadges({ psychology, className }: DNIASummaryBadgesProps) {
  if (!psychology || !psychology.analyzed_at) return null;

  const tempConfig =
    (psychology.temperatura
      ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]
      : null) ?? temperatureConfig.frio;
  const TempIcon = tempConfig.icon;

  return (
    <div className={`flex items-center justify-center gap-2 flex-wrap ${className ?? ""}`}>
      <Badge
        variant="outline"
        className={`gap-1.5 h-7 px-3 rounded-full text-xs ${tempConfig.textColor} border-current/30 bg-current/10`}
      >
        <TempIcon className="h-3.5 w-3.5" />
        {tempConfig.label}
      </Badge>

      <Badge variant="outline" className={pillClass}>
        <Target className="h-3.5 w-3.5 text-success" />
        <span className="text-muted-foreground">Propensão</span>
        <span className="font-mono text-success">{psychology.propensity_score ?? 0}%</span>
      </Badge>

      <Badge variant="outline" className={pillClass}>
        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        <span className="text-muted-foreground">Risco</span>
        <span className="font-mono text-destructive">{psychology.risk_score ?? 0}%</span>
      </Badge>

      <Badge variant="outline" className={pillClass}>
        <TrendingUp className="h-3.5 w-3.5 text-primary" />
        <span className="text-muted-foreground">Oportunidade</span>
        <span className="font-mono text-primary">{psychology.opportunity_score ?? 0}%</span>
      </Badge>
    </div>
  );
}
