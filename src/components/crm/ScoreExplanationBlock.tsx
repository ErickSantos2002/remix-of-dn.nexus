import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, HelpCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ScoreExplanation } from "@/lib/dniaScoreExplain";

interface ScoreExplanationBlockProps {
  explanation: ScoreExplanation;
  className?: string;
}

/** Bloco "Por que este score?" — abre a memória de cálculo do score DNIA. */
export function ScoreExplanationBlock({ explanation, className }: ScoreExplanationBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("space-y-2", className)}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <HelpCircle className="h-3.5 w-3.5" />
        Por que este score?
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 rounded-lg bg-background/50 p-3">
        <p className="text-xs text-foreground leading-relaxed">{explanation.headline}</p>
        <ul className="space-y-1">
          {explanation.narrative.map((line) => (
            <li key={line} className="text-[11px] text-muted-foreground flex gap-1.5">
              <span className="text-primary">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-foreground border-t border-border/50 pt-2">
          <span className="text-primary font-medium">O que fazer agora: </span>
          {explanation.action}
        </p>
        <div className="space-y-1 border-t border-border/50 pt-2">
          {explanation.drivers.map((driver) => (
            <div key={driver.label} className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{driver.label}</span>
              <span
                className={cn(
                  "font-mono",
                  driver.effect === "positive" ? "text-success" : "text-warning",
                )}
              >
                {driver.value}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Cálculo: {explanation.formula}
        </p>
      </CollapsibleContent>

    </Collapsible>
  );
}
