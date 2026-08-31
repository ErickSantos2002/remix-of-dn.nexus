import { useRef, useEffect, useCallback } from "react";
import { useWidgetChat } from "@/hooks/useWidgetChat";
import { WidgetHeader } from "./WidgetHeader";
import { TypebotMessage } from "./TypebotMessage";
import { TypebotInput } from "./TypebotInput";
import { WidgetPhoneInput } from "./WidgetPhoneInput";
import { WidgetEmailInput } from "./WidgetEmailInput";
import { WidgetListInput } from "./WidgetListInput";
import { detectInputType, stripInputHint, SpecialInputType } from "./detectInputType";
import { StarfieldBackground } from "./StarfieldBackground";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ensureGoogleAdsTag } from "@/lib/googleAds";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const WIDGET_CHAT_URL = `${SUPABASE_URL}/functions/v1/widget-chat`;

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  source?: string;
}

interface WidgetChatProps {
  slug: string;
  showHeader?: boolean;
  showPoweredBy?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  className?: string;
  visitorInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  utmParams?: UtmParams;
}

export function WidgetChat({
  slug,
  showHeader = true,
  showPoweredBy = true,
  onClose,
  onMinimize,
  className,
  visitorInfo,
  utmParams,
}: WidgetChatProps) {
  const {
    config,
    messages,
    isLoading,
    isSending,
    isWaitingForResponse,
    error,
    sessionToken,
    sendMessage,
    initSession,
  } = useWidgetChat({ slug, visitorInfo, utmParams });

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages using scrollTop (prevents parent page scroll)
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const primaryColor = config?.settings?.primary_color || "#FF8000";
  const configShowPoweredBy = config?.settings?.show_powered_by ?? true;

  // Filter system messages so they don't affect widget display or input detection
  const visibleMessages = messages.filter(m => !m.content?.startsWith("__SYSTEM__:"));

  // Dynamic input logic - show input after AI response or when no messages
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isLastMessageFromAI = !lastMessage || lastMessage.sender_type !== "lead";
  const showInput = isLastMessageFromAI && !isSending && !isWaitingForResponse;

  // Track specialized input type and send system message
  const lastSentInputTypeRef = useRef<string | null>(null);
  const inputType = showInput ? detectInputType(lastMessage?.content) : null;

  const getInputTypeKey = useCallback((type: SpecialInputType): string | null => {
    if (type === "phone") return "telefone";
    if (type === "email") return "email";
    if (type !== null && typeof type === "object" && type.type === "list") return `lista (${type.count} opcoes)`;
    return null;
  }, []);

  useEffect(() => {
    const key = getInputTypeKey(inputType);
    if (!key || !config || !sessionToken) return;
    if (lastSentInputTypeRef.current === key) return;
    lastSentInputTypeRef.current = key;

    fetch(WIDGET_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widget_id: config.id,
        session_token: sessionToken,
        system_message: `Campo especializado acionado: ${key}`,
      }),
    }).catch(() => {});
  }, [inputType, config, sessionToken, getInputTypeKey]);

  // Reset tracking ref when input goes back to generic
  useEffect(() => {
    if (!inputType) lastSentInputTypeRef.current = null;
  }, [inputType]);

  // Inject Google Tag Manager when config exposes gtm_container_id (company-level)
  useEffect(() => {
    const gtmId = (config as unknown as { gtm_container_id?: string | null })?.gtm_container_id?.trim();
    if (!gtmId) return;
    if (!/^GTM-[A-Z0-9]+$/i.test(gtmId)) return;
    const w = window as unknown as Record<string, unknown> & { dataLayer?: unknown[] };
    const flag = "__nexus_gtm_loaded_" + gtmId;
    if (w[flag]) return;
    w[flag] = true;

    w.dataLayer = (w.dataLayer as unknown[]) || [];
    (w.dataLayer as unknown[]).push({ "gtm.start": Date.now(), event: "gtm.js" });

    if (!document.querySelector(`script[data-nexus-gtm="${gtmId}"]`)) {
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
      s.setAttribute("data-nexus-gtm", gtmId);
      document.head.appendChild(s);
    }
    if (!document.querySelector(`iframe[data-nexus-gtm="${gtmId}"]`)) {
      const ns = document.createElement("noscript");
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`;
      iframe.height = "0";
      iframe.width = "0";
      iframe.style.display = "none";
      iframe.style.visibility = "hidden";
      iframe.setAttribute("data-nexus-gtm", gtmId);
      ns.appendChild(iframe);
      document.body.insertBefore(ns, document.body.firstChild);
    }
    console.log(`[GTM] Container ${gtmId} injected`);
  }, [(config as unknown as { gtm_container_id?: string | null })?.gtm_container_id]);

  // Inject Google Ads gtag.js when config exposes google_ads_send_to (AW-XXXX/LABEL)
  useEffect(() => {
    void ensureGoogleAdsTag((config as unknown as { google_ads_send_to?: string | null })?.google_ads_send_to);
  }, [(config as unknown as { google_ads_send_to?: string | null })?.google_ads_send_to]);


  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-col h-full bg-background rounded-xl overflow-hidden",
          className
        )}
      >
        <div className="flex-1 flex items-center justify-center">
          <Loader2
            className="h-8 w-8 animate-spin"
            style={{ color: primaryColor }}
          />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col h-full bg-background rounded-xl overflow-hidden",
          className
        )}
      >
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Erro ao carregar chat
            </h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => initSession()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <StarfieldBackground
      className={cn(
        "flex flex-col h-full rounded-xl overflow-hidden shadow-2xl",
        className
      )}
    >
      {/* Header */}
      {showHeader && config && (
        <WidgetHeader
          title={config.settings?.title || config.name}
          subtitle={config.settings?.subtitle}
          logoUrl={config.settings?.logo_url}
          primaryColor={primaryColor}
          onClose={onClose}
          onMinimize={onMinimize}
          showClose={!!onClose}
          showMinimize={!!onMinimize}
        />
      )}

      {/* Messages area with inline input */}
      <div 
        ref={messagesContainerRef}
        className="starfield-content flex-1 overflow-y-auto overscroll-contain p-4"
      >
        {visibleMessages.length === 0 && !isSending && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Envie uma mensagem para iniciar a conversa
            </p>
          </div>
        )}

        {/* Messages */}
        {visibleMessages.map((message, index) => (
          <TypebotMessage
            key={message.id}
            content={stripInputHint(message.content)}
            senderType={message.sender_type}
            createdAt={message.created_at}
            primaryColor={primaryColor}
            isNew={index === visibleMessages.length - 1}
            agent={message.sender_type !== "lead" ? config?.agent : undefined}
          />
        ))}

        {/* Typing indicator */}
        {(isSending || isWaitingForResponse) && (
          <div className="py-4 animate-fade-in">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm">Digitando...</span>
            </div>
          </div>
        )}

        {/* Inline input - specialized or generic based on AI message */}
        {showInput && (() => {
          const inputType = detectInputType(lastMessage?.content);
          if (inputType === "phone") {
            return (
              <WidgetPhoneInput
                onSend={sendMessage}
                disabled={isSending}
                primaryColor={primaryColor}
              />
            );
          }
          if (inputType === "email") {
            return (
              <WidgetEmailInput
                onSend={sendMessage}
                disabled={isSending}
                primaryColor={primaryColor}
              />
            );
          }
          if (inputType !== null && typeof inputType === "object" && inputType.type === "list") {
            return (
              <WidgetListInput
                count={inputType.count}
                onSend={sendMessage}
                disabled={isSending}
                primaryColor={primaryColor}
              />
            );
          }
          return (
            <TypebotInput
              onSend={sendMessage}
              disabled={isSending}
              primaryColor={primaryColor}
            />
          );
        })()}

        {/* Powered by - now inline */}
        {showPoweredBy && configShowPoweredBy && (
          <div className="text-center py-4">
            <a
              href="https://dnia.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Powered by nexus.ai | &lt;dn.ia&gt;
            </a>
          </div>
        )}
      </div>
    </StarfieldBackground>
  );
}
