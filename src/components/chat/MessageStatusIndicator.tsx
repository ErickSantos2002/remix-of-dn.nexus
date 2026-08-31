import { Check, CheckCheck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageStatusIndicatorProps {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null | undefined;
  className?: string;
  title?: string;
}

export function MessageStatusIndicator({ status, className, title }: MessageStatusIndicatorProps) {
  if (status === 'failed') {
    return (
      <span title={title || "Falha no envio"} className="inline-flex">
        <AlertCircle
          className={cn("h-3.5 w-3.5 flex-shrink-0 text-destructive", className)}
          aria-label="Falha no envio"
        />
      </span>
    );
  }

  const isRead = status === 'read';
  const isDelivered = status === 'delivered' || isRead;

  // Double check for delivered/read
  if (isDelivered) {
    return (
      <CheckCheck
        className={cn(
          "h-3.5 w-3.5 flex-shrink-0",
          isRead ? "text-primary-foreground" : "text-primary-foreground/70",
          className
        )}
      />
    );
  }

  // Single check for sent, pending, or unknown status
  return (
    <Check
      className={cn(
        "h-3.5 w-3.5 flex-shrink-0 text-primary-foreground/70",
        className
      )}
    />
  );
}
