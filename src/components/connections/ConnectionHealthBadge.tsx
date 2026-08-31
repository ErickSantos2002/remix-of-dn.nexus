import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity } from "lucide-react";

interface ConnectionHealthBadgeProps {
  connectionId: string;
}

type HealthLevel = "green" | "yellow" | "red" | "unknown";

function getHealthLevel(deliveryRate: number, readRate: number): HealthLevel {
  if (deliveryRate > 90 && readRate > 40) return "green";
  if (deliveryRate < 70 || readRate < 25) return "red";
  if (deliveryRate <= 90 || readRate <= 40) return "yellow";
  return "unknown";
}

const healthConfig: Record<HealthLevel, { label: string; className: string }> = {
  green: { label: "Saudavel", className: "badge-success" },
  yellow: { label: "Atencao", className: "badge-warning" },
  red: { label: "Risco", className: "badge-primary" },
  unknown: { label: "Sem dados", className: "badge-neutral" },
};

export function ConnectionHealthBadge({ connectionId }: ConnectionHealthBadgeProps) {
  const { data: healthData } = useQuery({
    queryKey: ["connection-health", connectionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("connection_health_daily")
        .select("delivery_rate, read_rate, messages_sent, date")
        .eq("connection_id", connectionId)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!healthData) {
    return null;
  }

  const level = getHealthLevel(
    Number(healthData.delivery_rate),
    Number(healthData.read_rate)
  );
  const config = healthConfig[level];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`${config.className} gap-1 text-xs`}>
            <Activity className="h-3 w-3" />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1 text-xs">
            <p>Taxa de entrega: <strong>{Number(healthData.delivery_rate).toFixed(1)}%</strong></p>
            <p>Taxa de leitura: <strong>{Number(healthData.read_rate).toFixed(1)}%</strong></p>
            <p>Msgs enviadas: <strong>{healthData.messages_sent}</strong></p>
            <p className="text-muted-foreground">Data: {healthData.date}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
