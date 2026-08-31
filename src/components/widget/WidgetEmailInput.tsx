import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Send, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WidgetEmailInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  primaryColor?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function WidgetEmailInput({
  onSend,
  disabled = false,
  primaryColor = "#3D61FF",
}: WidgetEmailInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [disabled]);

  const valid = isValidEmail(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    if (touched) {
      setError(v.trim().length > 0 && !isValidEmail(v) ? "Email invalido" : null);
    }
  };

  const handleSend = () => {
    if (!valid || disabled) return;
    onSend(value.trim());
    setValue("");
    setError(null);
    setTouched(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (valid) handleSend();
      else {
        setTouched(true);
        setError("Email invalido");
      }
    }
  };

  const handleBlur = () => {
    if (value.trim().length > 0) {
      setTouched(true);
      if (!valid) setError("Email invalido");
    }
  };

  return (
    <div className="py-4 animate-fade-in">
      <p className="text-xs text-muted-foreground mb-2 px-1">Informe seu email</p>
      <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-3 border border-border/50">
        {/* Email icon */}
        <Mail className="h-5 w-5 text-muted-foreground flex-shrink-0" />

        {/* Email input */}
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="seu@email.com"
          disabled={disabled}
          className={cn(
            "flex-1 bg-transparent border-0 outline-none",
            "text-foreground placeholder:text-muted-foreground",
            "text-base",
            "min-w-0",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />

        {/* Send button */}
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || !valid}
          className="h-9 w-9 rounded-lg flex-shrink-0"
          style={{
            backgroundColor: valid && !disabled ? primaryColor : undefined,
            opacity: valid && !disabled ? 1 : 0.5,
          }}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Error message */}
      {touched && error && (
        <p className="text-xs text-destructive mt-1.5 px-1 animate-fade-in">{error}</p>
      )}
    </div>
  );
}
