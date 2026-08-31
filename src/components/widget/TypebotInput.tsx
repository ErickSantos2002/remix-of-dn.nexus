import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TypebotInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  primaryColor?: string;
  placeholder?: string;
}

export function TypebotInput({
  onSend,
  disabled = false,
  primaryColor = "#FF8000",
  placeholder = "Digite sua resposta...",
}: TypebotInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when mounted
  useEffect(() => {
    if (textareaRef.current && !disabled) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="py-4 animate-fade-in">
      <div className="flex items-end gap-2 bg-muted/50 rounded-xl p-3 border border-border/50">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 bg-transparent resize-none border-0 outline-none",
            "text-foreground placeholder:text-muted-foreground",
            "text-base leading-relaxed",
            "min-h-[24px] max-h-[150px]",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="h-9 w-9 rounded-lg flex-shrink-0"
          style={{ 
            backgroundColor: value.trim() && !disabled ? primaryColor : undefined,
            opacity: value.trim() && !disabled ? 1 : 0.5
          }}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
