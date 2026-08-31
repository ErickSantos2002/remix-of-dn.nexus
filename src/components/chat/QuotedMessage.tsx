import { cn } from "@/lib/utils";

interface QuotedMessageProps {
  content: string;
  senderType: 'lead' | 'ai' | 'human_agent' | null;
  leadName?: string;
  isOutgoing?: boolean;
}

export function QuotedMessage({
  content,
  senderType,
  leadName,
  isOutgoing = false
}: QuotedMessageProps) {
  const getSenderLabel = () => {
    switch (senderType) {
      case 'lead':
        return leadName || 'Lead';
      case 'ai':
        return 'IA';
      case 'human_agent':
        return 'Agente';
      default:
        return 'Mensagem';
    }
  };

  return (
    <div
      className={cn(
        "mb-2 pl-2 py-1.5 rounded-r",
        "border-l-[3px]",
        isOutgoing
          ? "border-primary-foreground/50 bg-primary-foreground/10"
          : "border-primary bg-muted/30"
      )}
    >
      <span
        className={cn(
          "block text-[8px] font-semibold uppercase tracking-wide mb-0.5",
          senderType === 'lead' ? "text-muted-foreground" : "text-primary"
        )}
      >
        {getSenderLabel()}
      </span>
      <p
        className={cn(
          "text-[10px] line-clamp-2",
          isOutgoing ? "text-primary-foreground/70" : "text-muted-foreground"
        )}
      >
        {content}
      </p>
    </div>
  );
}
