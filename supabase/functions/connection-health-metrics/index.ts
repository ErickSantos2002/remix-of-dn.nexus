import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Calculate metrics for yesterday (full day)
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const dateStr = yesterday.toISOString().split("T")[0];
    const dateStart = yesterday.toISOString();
    const dateEnd = new Date(yesterday.getTime() + 86400000).toISOString();

    console.log("[HEALTH-METRICS] Calculating for date:", dateStr, "range:", dateStart, "to", dateEnd);

    // ─── Process Z-API connections ──────────────────────────────────────
    const { data: zapiConnections } = await supabase
      .from("zapi_connections")
      .select("id")
      .eq("is_active", true);

    for (const conn of zapiConnections || []) {
      try {
        // Get all messages sent through this connection's conversations
        const { data: metrics } = await supabase.rpc("calculate_connection_health", {
          p_connection_id: conn.id,
          p_date_start: dateStart,
          p_date_end: dateEnd,
          p_conversation_table: "zapi_conversations",
        });

        // Fallback: manual query if RPC doesn't exist
        if (!metrics) {
          const { data: conversations } = await supabase
            .from("zapi_conversations")
            .select("lead_id")
            .eq("connection_id", conn.id);

          if (!conversations || conversations.length === 0) continue;

          const leadIds = conversations.map((c: { lead_id: string }) => c.lead_id).filter(Boolean);
          if (leadIds.length === 0) continue;

          const { data: msgs } = await supabase
            .from("messages")
            .select("delivery_status, lead_id, created_at")
            .in("lead_id", leadIds)
            .in("sender_type", ["ai", "human_agent"])
            .gte("created_at", dateStart)
            .lt("created_at", dateEnd);

          if (!msgs || msgs.length === 0) continue;

          const sent = msgs.length;
          const delivered = msgs.filter((m: { delivery_status: string }) =>
            m.delivery_status === "delivered" || m.delivery_status === "read"
          ).length;
          const read = msgs.filter((m: { delivery_status: string }) => m.delivery_status === "read").length;
          const failed = msgs.filter((m: { delivery_status: string; created_at: string }) => {
            const age = now.getTime() - new Date(m.created_at).getTime();
            return m.delivery_status === "pending" && age > 3600000;
          }).length;
          const uniqueContacts = new Set(msgs.map((m: { lead_id: string }) => m.lead_id)).size;

          const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 10000) / 100 : 0;
          const readRate = sent > 0 ? Math.round((read / sent) * 10000) / 100 : 0;

          // Upsert into connection_health_daily
          const { error: upsertError } = await supabase
            .from("connection_health_daily")
            .upsert(
              {
                connection_id: conn.id,
                connection_type: "zapi",
                date: dateStr,
                messages_sent: sent,
                messages_delivered: delivered,
                messages_read: read,
                messages_failed: failed,
                delivery_rate: deliveryRate,
                read_rate: readRate,
                unique_contacts: uniqueContacts,
              },
              { onConflict: "connection_id,date" }
            );

          if (upsertError) {
            console.error(`[HEALTH-METRICS] Error upserting for connection ${conn.id}:`, upsertError);
          } else {
            console.log(`[HEALTH-METRICS] Z-API ${conn.id}: sent=${sent}, delivered=${delivered}, read=${read}, failed=${failed}, delivery=${deliveryRate}%, read=${readRate}%`);
          }
        }
      } catch (err) {
        console.error(`[HEALTH-METRICS] Error processing Z-API connection ${conn.id}:`, err);
      }
    }

    // ─── Process WhatsApp Official connections ──────────────────────────
    const { data: waConnections } = await supabase
      .from("whatsapp_connections")
      .select("id")
      .eq("is_active", true);

    for (const conn of waConnections || []) {
      try {
        const { data: conversations } = await supabase
          .from("whatsapp_conversations")
          .select("lead_id")
          .eq("connection_id", conn.id);

        if (!conversations || conversations.length === 0) continue;

        const leadIds = conversations.map((c: { lead_id: string }) => c.lead_id).filter(Boolean);
        if (leadIds.length === 0) continue;

        const { data: msgs } = await supabase
          .from("messages")
          .select("delivery_status, lead_id, created_at")
          .in("lead_id", leadIds)
          .in("sender_type", ["ai", "human_agent"])
          .gte("created_at", dateStart)
          .lt("created_at", dateEnd);

        if (!msgs || msgs.length === 0) continue;

        const sent = msgs.length;
        const delivered = msgs.filter((m: { delivery_status: string }) =>
          m.delivery_status === "delivered" || m.delivery_status === "read"
        ).length;
        const read = msgs.filter((m: { delivery_status: string }) => m.delivery_status === "read").length;
        const failed = msgs.filter((m: { delivery_status: string; created_at: string }) => {
          const age = now.getTime() - new Date(m.created_at).getTime();
          return m.delivery_status === "pending" && age > 3600000;
        }).length;
        const uniqueContacts = new Set(msgs.map((m: { lead_id: string }) => m.lead_id)).size;

        const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 10000) / 100 : 0;
        const readRate = sent > 0 ? Math.round((read / sent) * 10000) / 100 : 0;

        const { error: upsertError } = await supabase
          .from("connection_health_daily")
          .upsert(
            {
              connection_id: conn.id,
              connection_type: "whatsapp_official",
              date: dateStr,
              messages_sent: sent,
              messages_delivered: delivered,
              messages_read: read,
              messages_failed: failed,
              delivery_rate: deliveryRate,
              read_rate: readRate,
              unique_contacts: uniqueContacts,
            },
            { onConflict: "connection_id,date" }
          );

        if (upsertError) {
          console.error(`[HEALTH-METRICS] Error upserting for WA connection ${conn.id}:`, upsertError);
        } else {
          console.log(`[HEALTH-METRICS] WA Official ${conn.id}: sent=${sent}, delivered=${delivered}, read=${read}, delivery=${deliveryRate}%, read=${readRate}%`);
        }
      } catch (err) {
        console.error(`[HEALTH-METRICS] Error processing WA connection ${conn.id}:`, err);
      }
    }

    console.log("[HEALTH-METRICS] Done.");
    return new Response(
      JSON.stringify({ success: true, date: dateStr }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[HEALTH-METRICS] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
