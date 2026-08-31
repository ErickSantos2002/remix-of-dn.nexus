import { useState } from "react";
import { TypebotInput } from "./TypebotInput";
import { cn } from "@/lib/utils";

interface WidgetListInputProps {
  count: number;
  onSend: (message: string) => void;
  disabled?: boolean;
  primaryColor: string;
}

export function WidgetListInput({ count, onSend, disabled, primaryColor }: WidgetListInputProps) {
  const [showTextInput, setShowTextInput] = useState(false);

  if (showTextInput) {
    return (
      <div className="animate-fade-in">
        <TypebotInput onSend={onSend} disabled={disabled} primaryColor={primaryColor} />
        <button
          type="button"
          onClick={() => setShowTextInput(false)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-2 py-1"
        >
          Voltar para opcoes
        </button>
      </div>
    );
  }

  // Calculate grid columns based on count
  const getCols = () => {
    if (count <= 3) return count;
    if (count <= 4) return 4;
    if (count <= 6) return 3;
    return 4; // 7+ items: 4 columns
  };

  const cols = getCols();

  return (
    <div className="animate-fade-in py-3">
      <div
        className={cn("grid gap-2")}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: count }, (_, i) => i + 1).map((num) => (
          <button
            key={num}
            type="button"
            disabled={disabled}
            onClick={() => onSend(String(num))}
            className={cn(
              "min-h-[44px] min-w-[44px] rounded-xl",
              "font-semibold text-base",
              "border border-border/50 bg-card/80 text-foreground",
              "transition-all duration-150",
              "hover:scale-105 active:scale-95",
              "disabled:opacity-50 disabled:pointer-events-none",
              "backdrop-blur-sm"
            )}
            style={{
              borderColor: `${primaryColor}33`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = primaryColor;
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = primaryColor;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
              e.currentTarget.style.color = "";
              e.currentTarget.style.borderColor = `${primaryColor}33`;
            }}
          >
            {num}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowTextInput(true)}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-3 py-1"
      >
        Digitar resposta
      </button>
    </div>
  );
}
