import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Bot, User } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { MediaMessage } from "@/components/chat/MediaMessage";

interface LeadConversationProps {
  leadId: string | null;
}

interface Message {
  id: number;
  content: string;
  sender_type: "ai" | "lead" | "human_agent";
  created_at: string;
  media_type: string | null;
  media_url: string | null;
}

export function LeadConversation({ leadId }: LeadConversationProps) {
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["crm-lead-messages", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, sender_type, created_at, media_type, media_url")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data as Message[];
    },
    enabled: !!leadId,
  });

  if (!leadId) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          Histórico de conversa
        </h4>
        <p className="text-xs text-muted-foreground italic bg-background/50 p-2 rounded-lg">
          Este lead não possui conversa vinculada
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        Histórico de conversa ({messages.length})
      </h4>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Carregando...</div>
      ) : messages.length === 0 ? (
        <p className="text-xs text-muted-foreground italic bg-background/50 p-2 rounded-lg">
          Nenhuma mensagem encontrada
        </p>
      ) : (
        <ScrollArea className="h-[300px] pr-2">
          <div className="space-y-2">
            {messages.map((message) => {
              // System message banner
              if (message.content?.startsWith("__SYSTEM__:")) {
                const systemText = message.content.replace("__SYSTEM__:", "");
                return (
                  <div key={message.id} className="flex items-center justify-center gap-1.5 py-1.5 my-1">
                    <div className="h-px flex-1 bg-primary/20" />
                    <span className="text-[9px] text-primary font-medium px-2">{systemText}</span>
                    <div className="h-px flex-1 bg-primary/20" />
                  </div>
                );
              }

              const isLead = message.sender_type === "lead";
              const isAI = message.sender_type === "ai";
              
              return (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-2",
                    isLead ? "justify-start" : "justify-end"
                  )}
                >
                  {isLead && (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg p-2 space-y-1",
                      isLead 
                        ? "bg-muted text-foreground" 
                        : isAI 
                          ? "bg-primary/20 text-foreground" 
                          : "bg-muted text-foreground"
                    )}
                  >
                    {message.media_type && message.media_url ? (
                      <>
                        <MediaMessage
                          type={message.media_type}
                          url={message.media_url}
                        />
                        {message.content && (
                          <p className="text-xs whitespace-pre-wrap break-words mt-1">
                            {message.content}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    )}
                    <p className="text-[9px] text-muted-foreground">
                      {format(new Date(message.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  
                  {!isLead && (
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                      isAI ? "bg-primary/20" : "bg-muted"
                    )}>
                      {isAI ? (
                        <Bot className="h-3 w-3 text-primary" />
                      ) : (
                        <User className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
