import { useState, useCallback, useEffect, useRef } from "react";
import { fireGoogleAdsConversion } from "@/lib/googleAds";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const WIDGET_CHAT_URL = `${SUPABASE_URL}/functions/v1/widget-chat`;
const STORAGE_KEY_PREFIX = "nexus_widget_session_";

interface Message {
  id: string;
  content: string;
  sender_type: "lead" | "ai" | "human_agent";
  created_at: string;
  media_type?: string;
  media_url?: string;
}

interface AgentInfo {
  name: string;
  category?: string;
  avatar_url?: string;
}

interface WidgetConfig {
  id: string;
  name: string;
  type: string;
  workspace_id: string;
  settings: {
    title?: string;
    subtitle?: string;
    primary_color?: string;
    logo_url?: string;
    welcome_message?: string;
    position?: string;
    bubble_icon?: string;
    width?: number;
    height?: number;
    show_powered_by?: boolean;
    show_header?: boolean;
    header_banner_url?: string;
    agent_avatar_url?: string;
  };
  agent?: AgentInfo;
  meta_pixel_id?: string;
  clarity_project_id?: string;
  gtm_container_id?: string;
  google_ads_send_to?: string;
  

}

interface UseWidgetChatOptions {
  slug: string;
  pollingInterval?: number;
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
    source?: string;
  };
}

interface UseWidgetChatReturn {
  config: WidgetConfig | null;
  messages: Message[];
  isLoading: boolean;
  isSending: boolean;
  isWaitingForResponse: boolean;
  error: string | null;
  sessionToken: string | null;
  sendMessage: (content: string) => Promise<void>;
  initSession: () => Promise<void>;
}

export function useWidgetChat({
  slug,
  pollingInterval = 1500,
  visitorInfo,
  utmParams,
}: UseWidgetChatOptions): UseWidgetChatReturn {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const isWaitingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const pollingRef = useRef<number | null>(null);
  const lastMessageTimeRef = useRef<string | null>(null);
  const waitingTimeoutRef = useRef<number | null>(null);
  const configRef = useRef<WidgetConfig | null>(null);
  
  // Keep ref in sync with state
  const setWaiting = useCallback((val: boolean) => {
    isWaitingRef.current = val;
    setIsWaitingForResponse(val);
  }, []);

  // Load session from localStorage
  const getStoredSession = useCallback(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${slug}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Ignore errors
    }
    return null;
  }, [slug]);

  // Save session to localStorage
  const saveSession = useCallback(
    (token: string) => {
      try {
        localStorage.setItem(
          `${STORAGE_KEY_PREFIX}${slug}`,
          JSON.stringify({ token, createdAt: new Date().toISOString() })
        );
      } catch {
        // Ignore errors
      }
    },
    [slug]
  );

  // Fetch widget config
  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch(`${WIDGET_CHAT_URL}?slug=${slug}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Widget not found");
      }
      const data = await response.json();
      setConfig(data);
      configRef.current = data;
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load widget";
      setError(message);
      return null;
    }
  }, [slug]);

  // Fetch messages - returns count of messages fetched
  const fetchMessages = useCallback(async (token: string): Promise<number> => {
    try {
      const url = new URL(`${WIDGET_CHAT_URL}`);
      url.searchParams.set("session", token);
      if (lastMessageTimeRef.current) {
        url.searchParams.set("after", lastMessageTimeRef.current);
      }

      const response = await fetch(url.toString());
      if (!response.ok) return 0;

      const data = await response.json();

      // Handle meta events from polling
      if (data.meta_events_pending && Array.isArray(data.meta_events_pending) && data.meta_events_pending.length > 0) {
        const w = window as unknown as Record<string, unknown>;
        const fbq = w.fbq as ((...args: unknown[]) => void) | undefined;
        const clarity = w.clarity as ((...args: unknown[]) => void) | undefined;
        const googleSendTo = configRef.current?.google_ads_send_to;
        const visitorEmail = visitorInfo?.email?.trim().toLowerCase();
        const skipTracking = !!(visitorEmail && visitorEmail.endsWith("@dnia.ai"));
        if (!skipTracking) {
          for (const evt of data.meta_events_pending) {
            const params = {
              widget_name: configRef.current?.name,
              widget_slug: slug,
            };
            // Meta Pixel
            if (typeof fbq === "function") {
              if (evt === "Schedule") {
                fbq("track", "Schedule", { ...params, content_category: "agendamento" });
                console.log(`[MetaPixel] Fired standard event: Schedule for widget "${configRef.current?.name}" (slug: ${slug})`);
              } else {
                fbq("trackCustom", evt, params);
                console.log(`[MetaPixel] Fired custom event: ${evt} for widget "${configRef.current?.name}" (slug: ${slug})`);
              }
            }
            // Microsoft Clarity (mirror)
            if (typeof clarity === "function") {
              try {
                clarity("event", evt);
                console.log(`[Clarity] Fired event: ${evt} for widget "${configRef.current?.name}" (slug: ${slug})`);
              } catch (err) {
                console.error("[Clarity] event error:", err);
              }
            }
            // Google Ads conversion (mirror)
            if (googleSendTo) {
              void fireGoogleAdsConversion({
                sendTo: googleSendTo,
                eventName: String(evt),
                transactionId: `chat_${slug}_${sessionToken}_${String(evt).toLowerCase()}`,
              });
            }
            // GA4 via GTM — dataLayer only
            try {
              const dl = (w.dataLayer as unknown[] | undefined) ?? [];
              const gaEventName = evt === "Schedule" ? "schedule" : evt === "Lead" ? "generate_lead" : String(evt).toLowerCase();
              const gaParams = { ...params, content_category: "chat" };
              dl.push({ event: gaEventName, ...gaParams });
              (w.dataLayer as unknown[]) = dl;
              console.log(`[GTM] dataLayer push: ${gaEventName}`, gaParams);
            } catch (err) {
              console.error("[GTM] dataLayer event error:", err);
            }

          }
        } else {
          console.log(`[Tracking] Skipping Meta + Clarity + GoogleAds events for dnia.ai email`);
        }
        // Always acknowledge so server stops resending (even if we skipped)
        fetch(WIDGET_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: token, meta_events_ack: data.meta_events_pending }),
        }).catch(() => { /* ignore ack errors */ });
      }

      if (data.messages && data.messages.length > 0) {
        // Check if any new message is from AI (non-lead) to clear waiting state
        const hasAIResponse = data.messages.some(
          (m: Message) => m.sender_type !== "lead" && !m.content.includes("__INIT_GREETING__")
        );
        if (hasAIResponse && isWaitingRef.current) {
          setWaiting(false);
          if (waitingTimeoutRef.current) {
            window.clearTimeout(waitingTimeoutRef.current);
            waitingTimeoutRef.current = null;
          }
        }

        setMessages((prev) => {
          const realMessages = prev.filter((m) => !String(m.id).startsWith("temp-"));
          const tempMessages = prev.filter((m) => String(m.id).startsWith("temp-"));
          
          const existingIds = new Set(realMessages.map((m) => m.id));
          const newMessages = data.messages.filter(
            (m: Message) => !existingIds.has(m.id) && !m.content.includes("__INIT_GREETING__") && !m.content.startsWith("__SYSTEM__:")
          );
          
          if (newMessages.length > 0) {
            const remainingTempMessages = tempMessages.filter((temp) => {
              const hasRealVersion = newMessages.some(
                (real: Message) =>
                  real.content === temp.content &&
                  real.sender_type === temp.sender_type
              );
              return !hasRealVersion;
            });
            
            const allMessages = [...realMessages, ...remainingTempMessages, ...newMessages];
            allMessages.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            lastMessageTimeRef.current = allMessages[allMessages.length - 1].created_at;
            return allMessages;
          }
          return prev;
        });
        return data.messages.filter((m: Message) => !m.content.includes("__INIT_GREETING__")).length;
      }
      return 0;
    } catch {
      return 0;
    }
  }, []);

  // Initialize session
  const initSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    console.log("[useWidgetChat] initSession called. UTM params:", JSON.stringify(utmParams));

    try {
      // First fetch config
      const widgetConfig = await fetchConfig();
      if (!widgetConfig) {
        setIsLoading(false);
        return;
      }

      // Check for existing session
      const stored = getStoredSession();
      if (stored?.token) {
        const msgCount = await fetchMessages(stored.token);
        if (msgCount > 0) {
          setSessionToken(stored.token);
          // Send UTMs if present on reused session (fire-and-forget)
          if (utmParams && Object.values(utmParams).some(v => v)) {
            fetch(WIDGET_CHAT_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                widget_id: widgetConfig.id,
                session_token: stored.token,
                update_utm: utmParams,
              }),
            }).catch(() => {});
          }
          setIsLoading(false);
          return;
        }
        // Orphan session (0 messages) - clear and create new one
        console.log("[useWidgetChat] Orphan session detected, creating new session");
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${slug}`);
      }

      // Create new session
      const response = await fetch(WIDGET_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widget_id: widgetConfig.id,
          visitor_info: { ...visitorInfo, ...utmParams },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create session");
      }

      const data = await response.json();
      setSessionToken(data.session_token);
      saveSession(data.session_token);

      // Reset ref to ensure first fetch gets all messages
      lastMessageTimeRef.current = null;

      // Fetch messages with fast retry instead of fixed 1s delay
      const fetchWithRetry = async (token: string, attempt = 0) => {
        const count = await fetchMessages(token);
        if (count === 0 && attempt < 3) {
          await new Promise(r => setTimeout(r, 300));
          return fetchWithRetry(token, attempt + 1);
        }
      };
      fetchWithRetry(data.session_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [fetchConfig, getStoredSession, fetchMessages, saveSession, visitorInfo, utmParams]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!config || !sessionToken) return;

      setIsSending(true);
      setWaiting(true);
      
      // Safety timeout: 30s max wait
      if (waitingTimeoutRef.current) window.clearTimeout(waitingTimeoutRef.current);
      waitingTimeoutRef.current = window.setTimeout(() => {
        setWaiting(false);
        waitingTimeoutRef.current = null;
      }, 30000);

      try {
        // Optimistic update
        const tempMessage: Message = {
          id: `temp-${Date.now()}`,
          content,
          sender_type: "lead",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, tempMessage]);

        const response = await fetch(WIDGET_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            widget_id: config.id,
            session_token: sessionToken,
            message: content,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to send message");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send";
        setError(message);
        setWaiting(false);
        if (waitingTimeoutRef.current) {
          window.clearTimeout(waitingTimeoutRef.current);
          waitingTimeoutRef.current = null;
        }
        // Remove temp message on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));
      } finally {
        setIsSending(false);
      }
    },
    [config, sessionToken]
  );

  // Start polling when session is ready
  useEffect(() => {
    if (!sessionToken) return;

    const poll = () => {
      fetchMessages(sessionToken);
    };

    // Initial fetch
    poll();

    // Start polling
    pollingRef.current = window.setInterval(poll, pollingInterval);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [sessionToken, pollingInterval, fetchMessages]);

  // Initialize on mount
  useEffect(() => {
    initSession();
  }, [initSession]);

  return {
    config,
    messages,
    isLoading,
    isSending,
    isWaitingForResponse,
    error,
    sessionToken,
    sendMessage,
    initSession,
  };
}
