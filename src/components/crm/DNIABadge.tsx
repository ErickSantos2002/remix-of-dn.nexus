import { Badge } from "@/components/ui/badge";
import { Flame, ThermometerSun, Sun, Snowflake } from "lucide-react";

interface DNIABadgeProps {
  dnaCode: string | null;
  temperatura: string | null;
  propensityScore: number | null;
  size?: "small" | "medium" | "large";
  showPropensity?: boolean;
}

const temperatureConfig = {
  muito_quente: {
    label: "MQ",
    fullLabel: "Muito Quente",
    color: "bg-destructive/20 text-destructive border-destructive/30",
    icon: Flame
  },
  quente: {
    label: "Q",
    fullLabel: "Quente",
    color: "bg-warning/20 text-warning border-warning/30",
    icon: ThermometerSun
  },
  morno: {
    label: "M",
    fullLabel: "Morno",
    color: "bg-warning/20 text-warning border-warning/30",
    icon: Sun
  },
  frio: {
    label: "F",
    fullLabel: "Frio",
    color: "bg-primary/20 text-primary border-primary/30",
    icon: Snowflake
  },
};

export function DNIABadge({ 
  dnaCode, 
  temperatura, 
  propensityScore,
  size = "medium",
  showPropensity = true 
}: DNIABadgeProps) {
  if (!dnaCode && !temperatura) return null;

  const tempConfig = temperatura 
    ? temperatureConfig[temperatura as keyof typeof temperatureConfig] 
    : null;
  const TempIcon = tempConfig?.icon || Sun;

  const textSize = size === "small" ? "text-[10px]" : size === "large" ? "text-sm" : "text-xs";
  const iconSize = size === "small" ? "h-3 w-3" : size === "large" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${textSize}`}>
      {/* DNA Code */}
      {dnaCode && (
        <span className="font-mono text-muted-foreground">
          {dnaCode}
        </span>
      )}

      {/* Separator */}
      {dnaCode && temperatura && (
        <span className="text-border">|</span>
      )}

      {/* Temperature Badge */}
      {tempConfig && (
        <Badge 
          variant="outline" 
          className={`${tempConfig.color} gap-1 px-1.5 py-0 h-5`}
        >
          <TempIcon className={iconSize} />
          <span>{size === "small" ? tempConfig.label : tempConfig.fullLabel}</span>
        </Badge>
      )}

      {/* Propensity Score */}
      {showPropensity && propensityScore !== null && propensityScore !== undefined && (
        <>
          <span className="text-border">|</span>
          <Badge 
            variant="outline" 
            className={`px-1.5 py-0 h-5 ${
              propensityScore >= 70 
                ? "bg-success/20 text-success border-success/30" 
                : propensityScore >= 40 
                  ? "bg-warning/20 text-warning border-warning/30"
                  : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {propensityScore}%
          </Badge>
        </>
      )}
    </div>
  );
}
