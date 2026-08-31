import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Loader2, Send, MessageCircle } from "lucide-react";

interface ZapiStatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  connectionName: string | null;
}

interface StatsDataPoint {
  time: string;
  enviadas: number;
  recebidas: number;
}

interface RawMessage {
  created_at: string;
  sender_type: string;
}

type BucketMinutes = 10 | 30 | 60;

const chartConfig: ChartConfig = {
  enviadas: {
    label: "Enviadas",
    color: "hsl(var(--primary))",
  },
  recebidas: {
    label: "Recebidas",
    color: "hsl(var(--chart-1))",
  },
};

function buildBuckets(messages: RawMessage[], bucketMinutes: BucketMinutes) {
  const now = Date.now();
  const bucketMs = bucketMinutes * 60 * 1000;
  const totalMs = 48 * 60 * 60 * 1000;
  const bucketCount = Math.ceil(totalMs / bucketMs);
  const startTime = now - bucketCount * bucketMs;

  const buckets: StatsDataPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(startTime + i * bucketMs);
    buckets.push({
      time: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
      enviadas: 0,
      recebidas: 0,
    });
  }

  let totalEnv = 0;
  let totalRec = 0;

  for (const msg of messages) {
    const msgTime = new Date(msg.created_at).getTime();
    const bucketIndex = Math.floor((msgTime - startTime) / bucketMs);
    if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

    if (msg.sender_type === "lead") {
      buckets[bucketIndex].recebidas++;
      totalRec++;
    } else {
      buckets[bucketIndex].enviadas++;
      totalEnv++;
    }
  }

  return { buckets, totals: { enviadas: totalEnv, recebidas: totalRec } };
}

export function ZapiStatsModal({ open, onOpenChange, connectionId, connectionName }: ZapiStatsModalProps) {
  const [rawMessages, setRawMessages] = useState<RawMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [bucketMinutes, setBucketMinutes] = useState<BucketMinutes>(30);

  useEffect(() => {
    if (!open || !connectionId) return;
    fetchMessages();
  }, [open, connectionId]);

  const { buckets: data, totals } = useMemo(
    () => buildBuckets(rawMessages, bucketMinutes),
    [rawMessages, bucketMinutes]
  );

  // Tick spacing: show ~8-12 labels on the axis
  const tickInterval = useMemo(() => {
    const count = data.length;
    return Math.max(1, Math.floor(count / 8));
  }, [data.length]);

  const fetchMessages = async () => {
    if (!connectionId) return;
    setIsLoading(true);

    try {
      const { data: conversations, error: convError } = await supabase
        .from("zapi_conversations")
        .select("lead_id")
        .eq("connection_id", connectionId);

      if (convError) throw convError;

      const leadIds = conversations?.map((c) => c.lead_id).filter(Boolean) || [];

      if (leadIds.length === 0) {
        setRawMessages([]);
        setIsLoading(false);
        return;
      }

      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const batchSize = 200;
      const allMessages: RawMessage[] = [];

      for (let i = 0; i < leadIds.length; i += batchSize) {
        const batch = leadIds.slice(i, i + batchSize);
        const { data: msgs, error: msgError } = await supabase
          .from("messages")
          .select("created_at, sender_type")
          .in("lead_id", batch)
          .gte("created_at", since);

        if (msgError) throw msgError;
        if (msgs) allMessages.push(...msgs);
      }

      setRawMessages(allMessages);
    } catch (err) {
      console.error("Error fetching stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Estatisticas - {connectionName || "Conexao Z-API"}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPIs + Interval selector */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Send className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Enviadas (48h)</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{totals.enviadas.toLocaleString()}</p>
                </div>
              </div>
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-chart-1/10">
                  <MessageCircle className="w-4 h-4 text-chart-1" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Recebidas (48h)</p>
                  <p className="text-xl font-mono font-semibold text-foreground">{totals.recebidas.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Interval selector */}
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">Agrupar a cada:</span>
              <Select
                value={String(bucketMinutes)}
                onValueChange={(v) => setBucketMinutes(Number(v) as BucketMinutes)}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border z-[9999]">
                  <SelectItem value="10">10 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="60">60 minutos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Chart */}
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillEnviadas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-enviadas)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-enviadas)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillRecebidas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-recebidas)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-recebidas)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(val, i) => (i % tickInterval === 0 ? val : "")}
                  className="text-muted-foreground"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  className="text-muted-foreground"
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="enviadas"
                  stroke="var(--color-enviadas)"
                  fill="url(#fillEnviadas)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="recebidas"
                  stroke="var(--color-recebidas)"
                  fill="url(#fillRecebidas)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>

            <p className="text-xs text-muted-foreground text-center">
              Ultimas 48 horas, agrupadas a cada {bucketMinutes} minutos
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
