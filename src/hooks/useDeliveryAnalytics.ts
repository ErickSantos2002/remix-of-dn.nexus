import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export interface HealthDailyRecord {
  id: string;
  connection_id: string;
  connection_type: string;
  date: string;
  messages_sent: number;
  messages_delivered: number;
  messages_read: number;
  messages_failed: number;
  delivery_rate: number;
  read_rate: number;
  unique_contacts: number;
}

export interface ConnectionOption {
  id: string;
  name: string;
  type: string;
}

export function useDeliveryAnalytics(connectionId?: string, days: number = 30) {
  const { currentWorkspace: activeWorkspace } = useWorkspace();

  // Fetch available connections for filter
  const connectionsQuery = useQuery({
    queryKey: ["delivery-connections", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace?.id) return [];

      const options: ConnectionOption[] = [];

      // Get Z-API connections via connection_workspaces
      const { data: zapiLinks } = await supabase
        .from("connection_workspaces")
        .select("connection_id")
        .eq("workspace_id", activeWorkspace.id)
        .eq("connection_type", "zapi")
        .eq("is_active", true);

      if (zapiLinks && zapiLinks.length > 0) {
        const ids = zapiLinks.map(l => l.connection_id);
        const { data: zapiConns } = await supabase
          .from("zapi_connections")
          .select("id, zapi_instance_name, phone_number")
          .in("id", ids);

        for (const conn of zapiConns || []) {
          options.push({
            id: conn.id,
            name: conn.zapi_instance_name || conn.phone_number || conn.id.slice(0, 8),
            type: "zapi",
          });
        }
      }

      // Get WhatsApp Official connections
      const { data: waConns } = await supabase
        .from("whatsapp_connections")
        .select("id, phone_number_id")
        .eq("workspace_id", activeWorkspace.id)
        .eq("is_active", true);

      for (const conn of waConns || []) {
        options.push({
          id: conn.id,
          name: `WA Official ${conn.phone_number_id?.slice(0, 8) || conn.id.slice(0, 8)}`,
          type: "whatsapp_official",
        });
      }

      return options;
    },
    enabled: !!activeWorkspace?.id,
  });

  // Fetch health data
  const healthQuery = useQuery({
    queryKey: ["delivery-analytics", connectionId, days, activeWorkspace?.id],
    queryFn: async () => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      let query = supabase
        .from("connection_health_daily")
        .select("*")
        .gte("date", sinceDate.toISOString().split("T")[0])
        .order("date", { ascending: true });

      if (connectionId) {
        query = query.eq("connection_id", connectionId);
      } else if (connectionsQuery.data && connectionsQuery.data.length > 0) {
        // Filter to workspace connections
        const connIds = connectionsQuery.data.map(c => c.id);
        query = query.in("connection_id", connIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HealthDailyRecord[];
    },
    enabled: !!activeWorkspace?.id && connectionsQuery.isSuccess,
    staleTime: 5 * 60 * 1000,
  });

  // Compute KPIs from the data
  const records = healthQuery.data || [];
  const recentRecords = records.slice(-3); // Last 3 days
  const olderRecords = records.slice(-6, -3); // Previous 3 days

  const avgDeliveryRate = recentRecords.length > 0
    ? recentRecords.reduce((sum, r) => sum + Number(r.delivery_rate), 0) / recentRecords.length
    : 0;
  const avgReadRate = recentRecords.length > 0
    ? recentRecords.reduce((sum, r) => sum + Number(r.read_rate), 0) / recentRecords.length
    : 0;
  const avgDailyMessages = recentRecords.length > 0
    ? Math.round(recentRecords.reduce((sum, r) => sum + r.messages_sent, 0) / recentRecords.length)
    : 0;

  const prevDeliveryRate = olderRecords.length > 0
    ? olderRecords.reduce((sum, r) => sum + Number(r.delivery_rate), 0) / olderRecords.length
    : 0;

  const deliveryTrend = prevDeliveryRate > 0
    ? Math.round(((avgDeliveryRate - prevDeliveryRate) / prevDeliveryRate) * 100)
    : 0;

  const isAlert = recentRecords.length >= 3 && avgDeliveryRate < 70;

  return {
    connections: connectionsQuery.data || [],
    records,
    isLoading: healthQuery.isLoading || connectionsQuery.isLoading,
    kpis: {
      avgDeliveryRate: Math.round(avgDeliveryRate * 10) / 10,
      avgReadRate: Math.round(avgReadRate * 10) / 10,
      avgDailyMessages,
      deliveryTrend,
      isAlert,
    },
  };
}
