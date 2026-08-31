import { useState, useRef, KeyboardEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WidgetInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  primaryColor?: string;
}

export function WidgetInput({
  onSend,
  disabled = false,
  sending = false,
  placeholder = "Digite sua mensagem...",
  primaryColor = "#FF8000",
}: WidgetInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (message.trim() && !disabled && !sending) {
      onSend(message.trim());
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        // Keep focus on input after sending
        textareaRef.current.focus();
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t border-border bg-background">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder}
        disabled={disabled || sending}
        rows={1}
        className={cn(
          "flex-1 resize-none bg-muted rounded-xl px-3 py-2 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-offset-0",
          "placeholder:text-muted-foreground",
          "min-h-[40px] max-h-[120px]",
          "overscroll-contain"
        )}
        style={{
          // @ts-expect-error - CSS variable
          "--tw-ring-color": primaryColor,
        }}
      />
      <Button
        onClick={handleSend}
        disabled={!message.trim() || disabled || sending}
        size="icon"
        className="h-10 w-10 rounded-xl flex-shrink-0"
        style={{ backgroundColor: primaryColor }}
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
