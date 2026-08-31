import { X, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WidgetHeaderProps {
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  primaryColor?: string;
  onClose?: () => void;
  onMinimize?: () => void;
  showClose?: boolean;
  showMinimize?: boolean;
}

export function WidgetHeader({
  title = "Chat",
  subtitle,
  logoUrl,
  primaryColor = "#FF8000",
  onClose,
  onMinimize,
  showClose = false,
  showMinimize = false,
}: WidgetHeaderProps) {
  return (
    <div
      className="flex items-center gap-3 p-4 rounded-t-xl"
      style={{ backgroundColor: primaryColor }}
    >
      {/* Logo */}
      {logoUrl ? (
        <img
          src={logoUrl}
          alt="Logo"
          className="w-10 h-10 rounded-full object-cover bg-background/10"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-background/20 flex items-center justify-center">
          <span className="text-lg font-bold text-primary-foreground">
            {title.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Title & subtitle */}
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-primary-foreground truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-primary-foreground/80 truncate">
            {subtitle}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {showMinimize && onMinimize && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMinimize}
            className="h-8 w-8 text-primary-foreground hover:bg-background/20"
          >
            <Minus className="h-4 w-4" />
          </Button>
        )}
        {showClose && onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-primary-foreground hover:bg-background/20"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
