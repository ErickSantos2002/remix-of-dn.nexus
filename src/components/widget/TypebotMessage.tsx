import { cn } from "@/lib/utils";
import { MessageContent } from "@/components/chat/MessageContent";
import { User } from "lucide-react";

interface AgentInfo {
  name: string;
  category?: string;
  avatar_url?: string;
}

interface TypebotMessageProps {
  content: string;
  senderType: "lead" | "ai" | "human_agent";
  createdAt: string;
  primaryColor?: string;
  isNew?: boolean;
  agent?: AgentInfo;
  userAvatarUrl?: string;
}

export function TypebotMessage({
  content,
  senderType,
  primaryColor = "#FF8000",
  isNew = false,
  agent,
  userAvatarUrl,
}: TypebotMessageProps) {
  const isUser = senderType === "lead";
  const hasAgentAvatar = !isUser && !!agent?.avatar_url;
  const hasUserAvatar = isUser && !!userAvatarUrl;

  const avatarInitial = agent?.name?.charAt(0).toUpperCase() || "A";

  return (
    <div
      className={cn(
        "flex gap-2.5 mb-4 animate-fade-in",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      {hasAgentAvatar && (
        <img
          src={agent!.avatar_url!}
          alt={agent!.name}
          className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1"
        />
      )}
      {hasUserAvatar && (
        <img
          src={userAvatarUrl!}
          alt="Voce"
          className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1"
        />
      )}

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5",
          isUser ? "rounded-tr-sm" : "rounded-tl-sm"
        )}
        style={{
          backgroundColor: isUser
            ? primaryColor
            : "hsl(var(--muted))",
          color: isUser ? "#ffffff" : undefined,
        }}
      >
        {/* Agent name label */}
        {!isUser && agent?.name && (
          <span
            className="block text-[10px] font-semibold mb-1 opacity-70"
            style={{ color: primaryColor }}
          >
            {agent.name}
          </span>
        )}
        <MessageContent
          content={content}
          className={cn(
            "text-sm leading-relaxed",
            isUser ? "[&_*]:!text-[inherit]" : "text-foreground"
          )}
        />
      </div>
    </div>
  );
}
