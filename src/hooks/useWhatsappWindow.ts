import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsappWindow = {
  loading: boolean;
  windowOpen: boolean;
  lastInboundAt: Date | null;
  minutesRemaining: number;
  refresh: () => void;
};

/**
 * Compute the WhatsApp 24h customer service window based on the last
 * inbound message from the lead. Only meaningful for the WhatsApp
 * Official (Cloud API) channel — outside the window only approved
 * Templates (HSM) may be sent.
 */
export function useWhatsappWindow(
  leadId: string | null,
  enabled: boolean
): WhatsappWindow {
  const [lastInboundAt, setLastInboundAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [tick, setTick] = useState(0);

  const fetchLastInbound = useCallback(async () => {
    if (!enabled || !leadId) {
      setLastInboundAt(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("messages")
      .select("created_at")
      .eq("lead_id", leadId)
      .eq("sender_type", "lead")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastInboundAt(data?.created_at ? new Date(data.created_at) : null);
    setLoading(false);
  }, [leadId, enabled]);

  useEffect(() => {
    fetchLastInbound();
  }, [fetchLastInbound]);

  // Realtime: refresh on any new message for this lead
  useEffect(() => {
    if (!enabled || !leadId) return;
    const channel = supabase
      .channel(`whatsapp-window-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const row = payload.new as { sender_type?: string; created_at?: string };
          if (row.sender_type === "lead" && row.created_at) {
            setLastInboundAt(new Date(row.created_at));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, enabled]);

  // Recompute every minute
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, [enabled]);

  const now = Date.now();
  const elapsed = lastInboundAt ? now - lastInboundAt.getTime() : Infinity;
  const windowOpen = enabled && elapsed < WINDOW_MS;
  const minutesRemaining = windowOpen
    ? Math.max(0, Math.floor((WINDOW_MS - elapsed) / 60000))
    : 0;

  // touch tick to satisfy dep
  void tick;

  return {
    loading,
    windowOpen,
    lastInboundAt,
    minutesRemaining,
    refresh: fetchLastInbound,
  };
}

export function formatWindowRemaining(minutes: number): string {
  if (minutes <= 0) return "expirada";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}
