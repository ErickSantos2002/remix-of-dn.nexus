import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Send, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WidgetPhoneInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  primaryColor?: string;
}

interface CountryCode {
  code: string;
  flag: string;
  label: string;
}

const COUNTRY_CODES: CountryCode[] = [
  { code: "+55", flag: "🇧🇷", label: "Brasil" },
  { code: "+1", flag: "🇺🇸", label: "EUA" },
  { code: "+351", flag: "🇵🇹", label: "Portugal" },
  { code: "+54", flag: "🇦🇷", label: "Argentina" },
  { code: "+598", flag: "🇺🇾", label: "Uruguai" },
  { code: "+595", flag: "🇵🇾", label: "Paraguai" },
];

function applyPhoneMask(digits: string): string {
  // Brazilian format: (XX) XXXXX-XXXX or (XX) XXXX-XXXX
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function isValidPhone(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 11;
}

export function WidgetPhoneInput({
  onSend,
  disabled = false,
  primaryColor = "#3D61FF",
}: WidgetPhoneInputProps) {
  const [digits, setDigits] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(COUNTRY_CODES[0]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [disabled]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const valid = isValidPhone(digits);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
    setDigits(raw);
    if (touched) {
      setError(raw.length > 0 && !isValidPhone(raw) ? "Numero invalido" : null);
    }
  };

  const handleSend = () => {
    if (!valid || disabled) return;
    setTouched(true);
    // Send formatted for readability: +55 (11) 99999-9999
    const formatted = `${selectedCountry.code} ${applyPhoneMask(digits)}`;
    onSend(formatted);
    setDigits("");
    setError(null);
    setTouched(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (valid) handleSend();
      else {
        setTouched(true);
        setError("Numero invalido");
      }
    }
  };

  const handleBlur = () => {
    if (digits.length > 0) {
      setTouched(true);
      if (!valid) setError("Numero invalido");
    }
  };

  return (
    <div className="py-4 animate-fade-in">
      <p className="text-xs text-muted-foreground mb-2 px-1">Informe seu telefone</p>
      <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-3 border border-border/50">
        {/* Country code selector */}
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowDropdown((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-lg",
              "bg-background/60 border border-border/50",
              "text-sm text-foreground hover:bg-background/80 transition-colors"
            )}
          >
            <span className="text-base">{selectedCountry.flag}</span>
            <span className="font-mono text-xs text-muted-foreground">{selectedCountry.code}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {showDropdown && (
            <div className="absolute bottom-full mb-1 left-0 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
              {COUNTRY_CODES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    setSelectedCountry(c);
                    setShowDropdown(false);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground",
                    "hover:bg-muted/50 transition-colors",
                    c.code === selectedCountry.code && "bg-muted/30"
                  )}
                >
                  <span>{c.flag}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  <span className="text-muted-foreground text-xs">{c.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Phone input */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          value={applyPhoneMask(digits)}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="(11) 99999-9999"
          disabled={disabled}
          className={cn(
            "flex-1 bg-transparent border-0 outline-none",
            "text-foreground placeholder:text-muted-foreground",
            "text-base font-mono",
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
