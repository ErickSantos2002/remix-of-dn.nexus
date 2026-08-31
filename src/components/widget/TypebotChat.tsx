import { useRef, useEffect, useCallback } from "react";
import { useWidgetChat } from "@/hooks/useWidgetChat";
import { TypebotHeader } from "./TypebotHeader";
import { TypebotMessage } from "./TypebotMessage";
import { TypebotInput } from "./TypebotInput";
import { WidgetPhoneInput } from "./WidgetPhoneInput";
import { WidgetEmailInput } from "./WidgetEmailInput";
import { WidgetListInput } from "./WidgetListInput";
import { detectInputType, stripInputHint, SpecialInputType } from "./detectInputType";
import { StarfieldBackground } from "./StarfieldBackground";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const WIDGET_CHAT_URL = `${SUPABASE_URL}/functions/v1/widget-chat`;
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadClarity, clarityEvent, claritySet } from "@/lib/clarity";
import { ensureGoogleAdsTag } from "@/lib/googleAds";

interface TypebotChatProps {
  slug: string;
  className?: string;
  visitorInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  utmParams?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
  };
}

export function TypebotChat({
  slug,
  className,
  visitorInfo,
  utmParams,
}: TypebotChatProps) {
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

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const hasInitializedRef = useRef(false);
  const prevMessagesLengthRef = useRef(0);
  const lastSentInputTypeRef = useRef<string | null>(null);

  const primaryColor = config?.settings?.primary_color || "#FF8000";

  // Inject Meta Pixel when config loads
  useEffect(() => {
    const pixelId = config?.meta_pixel_id;
    const w = window as unknown as Record<string, unknown>;
    if (!pixelId || w.__nexus_meta_pixel_loaded) return;
    const visitorEmail = visitorInfo?.email?.trim().toLowerCase();
    if (visitorEmail && visitorEmail.endsWith("@dnia.ai")) {
      console.log(`[MetaPixel] Skipping init for dnia.ai email`);
      return;
    }
    w.__nexus_meta_pixel_loaded = true;

    const initPixel = () => {
      const fbq = w.fbq as ((...args: unknown[]) => void) | undefined;
      if (typeof fbq !== "function") return;
      fbq("init", pixelId);
      fbq("track", "PageView", {
        content_name: config?.name,
        content_category: slug,
      });
      console.log(`[MetaPixel] Initialized with ID ${pixelId} and fired PageView for widget "${config?.name}" (slug: ${slug})`);
    };

    // If fbq already loaded (e.g. host page), just init
    if (typeof w.fbq === "function") {
      initPixel();
      return;
    }

    // Create minimal stub (required by fbevents.js) — omit version to avoid conflicts
    const n = function (...args: unknown[]) {
      const fn = n as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[] };
      fn.callMethod ? fn.callMethod(...args) : fn.queue.push(args);
    };
    (n as unknown as { push: typeof n }).push = n;
    (n as unknown as { loaded: boolean }).loaded = true;
    (n as unknown as { queue: unknown[] }).queue = [];
    w.fbq = n;
    w._fbq = n;

    // Load script and init on load
    if (!document.querySelector('script[src*="fbevents.js"]')) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.onload = initPixel;
      document.head.appendChild(script);
    }
  }, [config?.meta_pixel_id, visitorInfo?.email]);

  // Inject Microsoft Clarity when config loads
  useEffect(() => {
    const projectId = config?.clarity_project_id;
    if (!projectId) return;
    const visitorEmail = visitorInfo?.email?.trim().toLowerCase();
    if (visitorEmail && visitorEmail.endsWith("@dnia.ai")) {
      console.log(`[Clarity] Skipping init for dnia.ai email`);
      return;
    }
    const loaded = loadClarity(projectId);
    if (!loaded) return;
    claritySet("widget_name", config?.name || "");
    claritySet("widget_slug", slug);
    clarityEvent("PageView");
    console.log(`[Clarity] Initialized with project ${projectId} and fired PageView for widget "${config?.name}" (slug: ${slug})`);
  }, [config?.clarity_project_id, config?.name, slug, visitorInfo?.email]);

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



  // Filter system messages from display and input detection
  const visibleMessages = messages.filter(m => !m.content?.startsWith("__SYSTEM__:"));

  // Check if last message is from AI (to show input)
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isLastMessageFromAI = lastMessage && lastMessage.sender_type !== "lead";
  const showInput = visibleMessages.length === 0 || isLastMessageFromAI;

  // Track specialized input type and send system message
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

  // Scroll to input when it appears - but not on initial load
  const scrollToInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  useEffect(() => {
    // Se ainda não inicializou, apenas marcar como inicializado
    if (!hasInitializedRef.current) {
      if (messages.length > 0 || !isLoading) {
        hasInitializedRef.current = true;
        prevMessagesLengthRef.current = messages.length;
      }
      return; // NÃO fazer scroll no primeiro carregamento
    }

    // A partir daqui, só faz scroll se houver novas mensagens
    const hasNewMessages = messages.length > prevMessagesLengthRef.current;
    
    if (showInput && !isSending && hasNewMessages) {
      const timer = setTimeout(scrollToInput, 100);
      return () => clearTimeout(timer);
    }
    
    prevMessagesLengthRef.current = messages.length;
  }, [showInput, isSending, messages.length, isLoading, scrollToInput]);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full bg-background", className)}>
        <Loader2
          className="h-8 w-8 animate-spin"
          style={{ color: primaryColor }}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full bg-background gap-4 p-6", className)}>
        <AlertCircle className="h-12 w-12 text-destructive" />
        <div className="text-center">
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
    );
  }

  // Show header if enabled
  const showHeader = config?.settings?.show_header !== false;
  const headerBannerUrl = config?.settings?.header_banner_url;

  return (
    <StarfieldBackground className={cn("h-full overflow-y-auto overscroll-contain", className)}>
      <div 
        ref={containerRef}
        className="starfield-content max-w-2xl mx-auto px-6 py-6"
      >
        {/* Header with banner/logo - now inside centered container */}
        {showHeader && (
          <TypebotHeader
            bannerUrl={headerBannerUrl}
            logoUrl={config?.settings?.logo_url}
            title={config?.settings?.title}
            subtitle={config?.settings?.subtitle}
            primaryColor={primaryColor}
          />
        )}
        {/* Messages flow */}
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
        {isSending && (
          <div className="py-4 animate-fade-in">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm">Digitando...</span>
            </div>
          </div>
        )}

        {/* Inline input - appears after AI messages */}
        {showInput && !isSending && (() => {
          return (
            <div ref={inputRef}>
              {inputType === "phone" ? (
                <WidgetPhoneInput onSend={sendMessage} disabled={isSending} primaryColor={primaryColor} />
              ) : inputType === "email" ? (
                <WidgetEmailInput onSend={sendMessage} disabled={isSending} primaryColor={primaryColor} />
              ) : inputType !== null && typeof inputType === "object" && inputType.type === "list" ? (
                <WidgetListInput count={inputType.count} onSend={sendMessage} disabled={isSending} primaryColor={primaryColor} />
              ) : (
                <TypebotInput onSend={sendMessage} disabled={isSending} primaryColor={primaryColor} />
              )}
            </div>
          );
        })()}

        {/* Powered by */}
        {config?.settings?.show_powered_by !== false && (
          <div className="text-center py-8">
            <a
              href="https://dnia.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              Powered by nexus.ai | &lt;dn.ia&gt;
            </a>
          </div>
        )}
      </div>
    </StarfieldBackground>
  );
}
