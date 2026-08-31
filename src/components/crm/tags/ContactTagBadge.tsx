import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactTag } from "@/types/tags";

interface ContactTagBadgeProps {
  tag: ContactTag;
  onRemove?: () => void;
  size?: "sm" | "md";
  className?: string;
}

export function ContactTagBadge({
  tag,
  onRemove,
  size = "sm",
  className
}: ContactTagBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
      style={{
        // Tons suaves: o fundo carrega a cor, o texto fica legivel sem saturar a interface
        backgroundColor: `${tag.color}14`,
        color: tag.color,
        border: `1px solid ${tag.color}2E`,
      }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
