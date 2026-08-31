import { cn } from "@/lib/utils";
import { MessageContent } from "@/components/chat/MessageContent";
import { Bot, User } from "lucide-react";

interface WidgetMessageProps {
  content: string;
  senderType: "lead" | "ai" | "human_agent";
  createdAt: string;
  primaryColor?: string;
}

export function WidgetMessage({
  content,
  senderType,
  createdAt,
  primaryColor = "#FF8000",
}: WidgetMessageProps) {
  const isOutgoing = senderType === "lead";
  const time = new Date(createdAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={cn(
        "flex gap-2 mb-3",
        isOutgoing ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
          isOutgoing ? "bg-muted" : ""
        )}
        style={!isOutgoing ? { backgroundColor: primaryColor } : undefined}
      >
        {isOutgoing ? (
          <User className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Bot className="w-4 h-4 text-primary-foreground" />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2",
          isOutgoing
            ? "rounded-tr-sm"
            : "rounded-tl-sm"
        )}
        style={{
          backgroundColor: isOutgoing ? "hsl(220 25% 20%)" : "hsl(215 50% 23%)",
          color: "#ffffff",
        }}
      >
        <MessageContent
          content={content}
          className={cn(
            "text-xs",
            isOutgoing ? "text-foreground" : "text-primary-foreground"
          )}
        />
        <span
          className={cn(
            "text-[10px] mt-1 block",
            isOutgoing ? "text-muted-foreground" : "opacity-70"
          )}
        >
          {time}
        </span>
      </div>
    </div>
  );
}
