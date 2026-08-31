import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Loader2, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSalesCycle } from "@/hooks/useSalesCycle";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  period: PeriodFilter;
  customRange?: CustomDateRange;
}

const fmt = (v: number | null) => (v === null ? "—" : `${v.toString().replace(".", ",")} d`);

function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || previous === 0) {
    return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> estável vs. período anterior
      </span>
    );
  }
  // ciclo menor = melhor
  const good = diff < 0;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", good ? "text-success" : "text-destructive")}>
      {good ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {pct > 0 ? "+" : ""}
      {pct}% vs. período anterior
    </span>
  );
}

export function SalesCycleCard({ period, customRange }: Props) {
  const { data, isLoading } = useSalesCycle(period, customRange);
  const [granularity, setGranularity] = React.useState<"month" | "fortnight">("month");
  const series = granularity === "month" ? data?.monthly ?? [] : data?.fortnightly ?? [];


  return (
    <Card className="glass-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Ciclo de compra
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Dias entre a criação do card e o fechamento (ganho) — considera apenas cards ganhos no período.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.wonCount === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda ganha no período selecionado.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="text-xs text-muted-foreground">Ciclo médio</div>
                <div className="font-mono text-2xl text-foreground">{fmt(data.avgDays)}</div>
                <div className="mt-1">
                  <Delta current={data.avgDays} previous={data.previous.avgDays} />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="text-xs text-muted-foreground">Ciclo mediano</div>
                <div className="font-mono text-2xl text-foreground">{fmt(data.medianDays)}</div>
                <div className="mt-1">
                  <Delta current={data.medianDays} previous={data.previous.medianDays} />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="text-xs text-muted-foreground">Mais rápido</div>
                <div className="font-mono text-2xl text-foreground">{fmt(data.minDays)}</div>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="text-xs text-muted-foreground">90% fecham em até</div>
                <div className="font-mono text-2xl text-foreground">{fmt(data.p90Days)}</div>
              </div>
              <div className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="text-xs text-muted-foreground">Vendas ganhas</div>
                <div className="font-mono text-2xl text-foreground">{data.wonCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  anterior: {data.previous.wonCount}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Distribuição do ciclo</div>
              <div className="space-y-1.5">
                {data.distribution.map((b) => {
                  const pct = data.wonCount ? Math.round((b.count / data.wonCount) * 100) : 0;
                  return (
                    <div key={b.bucket} className="flex items-center gap-3">
                      <span className="w-24 text-xs text-muted-foreground">{b.bucket}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-right font-mono text-xs text-foreground">
                        {b.count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {granularity === "month" ? "Evolução mês a mês" : "Evolução quinzenal (15 em 15 dias)"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {granularity === "month" ? "últimos 12 meses" : "últimos 6 meses"} (independe do filtro)
                  </span>
                  <div className="flex rounded-lg border border-border p-0.5">
                    {[
                      { key: "month" as const, label: "Mensal" },
                      { key: "fortnight" as const, label: "Quinzenal" },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setGranularity(opt.key)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                          granularity === opt.key
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {series.every((m) => m.count === 0) ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Sem vendas ganhas no intervalo exibido.
                </p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="days"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="count"
                        orientation="right"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.75rem",
                          fontSize: 12,
                        }}
                        formatter={(value: number, name: string) =>
                          name === "Vendas ganhas" ? [value, name] : [`${String(value).replace(".", ",")} d`, name]
                        }
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        yAxisId="count"
                        dataKey="count"
                        name="Vendas ganhas"
                        fill="hsl(var(--muted-foreground))"
                        fillOpacity={0.25}
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="days"
                        type="monotone"
                        dataKey="avgDays"
                        name="Ciclo médio"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                      <Line
                        yAxisId="days"
                        type="monotone"
                        dataKey="medianDays"
                        name="Ciclo mediano"
                        stroke="hsl(var(--chart-2))"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>


            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { title: "Por origem do contato", rows: data.bySource },
                { title: "Por canal (utm_source)", rows: data.byChannel },
              ].map((block) => (
                <div key={block.title}>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">{block.title}</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Item</TableHead>
                        <TableHead className="text-right text-xs">Ganhos</TableHead>
                        <TableHead className="text-right text-xs">Médio</TableHead>
                        <TableHead className="text-right text-xs">Mediana</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {block.rows.slice(0, 8).map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="text-xs">{r.label}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{r.count}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(r.avgDays)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(r.medianDays)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SalesCycleCard;
