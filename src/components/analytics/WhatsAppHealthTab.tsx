import { useState } from "react";
import { useDeliveryAnalytics } from "@/hooks/useDeliveryAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Mail,
  MailCheck,
  Eye,
  TrendingUp,
  TrendingDown,
  Loader2,
} from "lucide-react";

const PERIOD_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === "number" && entry.value % 1 !== 0
              ? `${entry.value.toFixed(1)}%`
              : entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export function WhatsAppHealthTab() {
  const [selectedConnection, setSelectedConnection] = useState<string>("all");
  const [days, setDays] = useState(30);

  const { connections, records, isLoading, kpis } = useDeliveryAnalytics(
    selectedConnection === "all" ? undefined : selectedConnection,
    days
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Prepare chart data — aggregate by date if multiple connections
  const chartDataMap = new Map<string, { date: string; delivery_rate: number; read_rate: number; sent: number; delivered: number; read: number; count: number }>();

  for (const r of records) {
    const existing = chartDataMap.get(r.date);
    if (existing) {
      existing.delivery_rate += Number(r.delivery_rate);
      existing.read_rate += Number(r.read_rate);
      existing.sent += r.messages_sent;
      existing.delivered += r.messages_delivered;
      existing.read += r.messages_read;
      existing.count += 1;
    } else {
      chartDataMap.set(r.date, {
        date: r.date,
        delivery_rate: Number(r.delivery_rate),
        read_rate: Number(r.read_rate),
        sent: r.messages_sent,
        delivered: r.messages_delivered,
        read: r.messages_read,
        count: 1,
      });
    }
  }

  const chartData = Array.from(chartDataMap.values()).map(d => ({
    date: new Date(d.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    "Taxa Entrega": Math.round((d.delivery_rate / d.count) * 10) / 10,
    "Taxa Leitura": Math.round((d.read_rate / d.count) * 10) / 10,
    Enviadas: d.sent,
    Entregues: d.delivered,
    Lidas: d.read,
  }));

  const deliveryColor = kpis.avgDeliveryRate >= 90 ? "text-success" : kpis.avgDeliveryRate >= 70 ? "text-warning" : "text-destructive";
  const readColor = kpis.avgReadRate >= 40 ? "text-success" : kpis.avgReadRate >= 25 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-6">
      {/* Alert */}
      {kpis.isAlert && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle className="text-destructive">Alerta: Taxa de Entrega Baixa</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            A taxa de entrega nos últimos 3 dias está abaixo de 70%. Isso pode indicar risco de softban.
            Considere reduzir o volume de mensagens e verificar a qualidade do conteúdo.
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={selectedConnection} onValueChange={setSelectedConnection}>
          <SelectTrigger className="w-[200px] bg-secondary border-border">
            <SelectValue placeholder="Todas conexões" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas conexões</SelectItem>
            {connections.map(conn => (
              <SelectItem key={conn.id} value={conn.id}>
                {conn.name} ({conn.type === "zapi" ? "Z-API" : "Oficial"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-[120px] bg-secondary border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa de Entrega</CardTitle>
            <MailCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${deliveryColor}`}>
              {kpis.avgDeliveryRate}%
            </div>
            <div className="flex items-center gap-1 mt-1">
              {kpis.deliveryTrend !== 0 ? (
                <>
                  {kpis.deliveryTrend > 0 ? (
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {kpis.deliveryTrend > 0 ? "+" : ""}{kpis.deliveryTrend}% vs anterior
                  </span>
                </>
              ) : (
                 <span className="text-xs text-muted-foreground">Média últimos 3 dias</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa de Leitura</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${readColor}`}>
              {kpis.avgReadRate}%
            </div>
            <span className="text-xs text-muted-foreground">Média últimos 3 dias</span>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Msgs/Dia</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-foreground">
              {kpis.avgDailyMessages}
            </div>
            <span className="text-xs text-muted-foreground">Média diária</span>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge
              variant="outline"
              className={
                kpis.avgDeliveryRate >= 90 ? "badge-success text-lg py-1" :
                kpis.avgDeliveryRate >= 70 ? "badge-warning text-lg py-1" :
                kpis.avgDeliveryRate > 0 ? "badge-primary text-lg py-1" :
                "badge-neutral text-lg py-1"
              }
            >
               {kpis.avgDeliveryRate >= 90 ? "Saudável" :
                kpis.avgDeliveryRate >= 70 ? "Atenção" :
               kpis.avgDeliveryRate > 0 ? "Risco" : "Sem dados"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {chartData.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Delivery Rate Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Taxas de Entrega e Leitura</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" stroke="var(--chart-axis)" fontSize={12} />
                  <YAxis domain={[0, 100]} stroke="var(--chart-axis)" fontSize={12} unit="%" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine y={70} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: "Min. Entrega", fill: "hsl(var(--destructive))", fontSize: 10 }} />
                  <ReferenceLine y={40} stroke="hsl(var(--warning))" strokeDasharray="5 5" label={{ value: "Min. Leitura", fill: "hsl(var(--warning))", fontSize: 10 }} />
                  <Line type="monotone" dataKey="Taxa Entrega" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Taxa Leitura" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Message Volume Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Volume de Mensagens</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" stroke="var(--chart-axis)" fontSize={12} />
                  <YAxis stroke="var(--chart-axis)" fontSize={12} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="Enviadas" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Entregues" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Lidas" fill="var(--series-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mb-4 opacity-30" />
             <p className="text-lg font-medium">Sem dados de saúde</p>
             <p className="text-sm">Os dados aparecerão aqui após o primeiro cálculo diário de métricas.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
