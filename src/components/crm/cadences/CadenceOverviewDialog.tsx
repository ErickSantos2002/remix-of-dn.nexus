import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, CalendarIcon, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CadenceStatsDialog,
  type CadenceStatsRule,
} from "@/components/crm/cadences/CadenceStatsDialog";
import { getPreviousRangeBounds } from "@/components/crm/cadences/cadenceRange";
import { MetricCardWithDelta } from "@/components/crm/cadences/MetricCardWithDelta";

type TriggerType = "activity" | "stage";

interface Props {
  triggerType: TriggerType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RangeKey = "today" | "yesterday" | "7d" | "28d" | "all" | "custom";

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "28d": "28 dias",
  all: "Tudo",
  custom: "Personalizado",
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  meeting: "Reunião",
  call: "Ligação",
  follow_up: "Follow-up",
  email: "Email",
  demo: "Demo",
  task: "Tarefa",
  reschedule: "Reagendamento de reunião",
};

function getRangeBounds(
  range: RangeKey,
  customRange?: DateRange
): { from?: string; to?: string } {
  if (range === "all") return {};
  if (range === "custom") {
    if (!customRange?.from) return {};
    const from = new Date(customRange.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(customRange.to ?? customRange.from);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (range === "today")
    return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
  if (range === "yesterday") {
    const s = new Date(startOfToday);
    s.setDate(s.getDate() - 1);
    const e = new Date(endOfToday);
    e.setDate(e.getDate() - 1);
    return { from: s.toISOString(), to: e.toISOString() };
  }
  const days = range === "7d" ? 7 : 28;
  const from = new Date(startOfToday);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString(), to: endOfToday.toISOString() };
}

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (buildQuery(from, from + PAGE - 1) as any);
    if (error) {
      console.error("fetchAllRows error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

interface RuleBreakdown {
  rule_id: string;
  name: string;
  activations: number;
  started: number;
  total: number;
  pending: number;
  delivered: number;
  notDelivered: number;
  raw: CadenceStatsRule;
}

interface ChartPoint {
  day: string;
  entregues: number;
  naoEntregues: number;
}

interface NoShowCorrelation {
  totalActivities: number;
  totalNoShow: number;
  withFailure: number;
  withFailureNoShow: number;
  withoutFailure: number;
  withoutFailureNoShow: number;
}

interface OverviewData {
  totals: {
    activations: number;
    started: number;
    total: number;
    pending: number;
    delivered: number;
    notDelivered: number;
  };
  breakdown: RuleBreakdown[];
  chart: ChartPoint[];
  correlation: NoShowCorrelation | null;
}

const EMPTY: OverviewData = {
  totals: { activations: 0, started: 0, total: 0, pending: 0, delivered: 0, notDelivered: 0 },
  breakdown: [],
  chart: [],
  correlation: null,
};


function dayKey(iso: string): string {
  // YYYY-MM-DD in America/Sao_Paulo
  const d = new Date(iso);
  const offsetMs = -3 * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  return local.toISOString().slice(0, 10);
}

export function CadenceOverviewDialog({ triggerType, open, onOpenChange }: Props) {
  const { currentCompany } = useCompany();
  const { currentWorkspace } = useWorkspace();
  const [range, setRange] = useState<RangeKey>("7d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OverviewData>(EMPTY);
  const [previousData, setPreviousData] = useState<OverviewData | null>(null);
  const [drilldown, setDrilldown] = useState<CadenceStatsRule | null>(null);

  const bounds = useMemo(
    () => getRangeBounds(range, customRange),
    [range, customRange]
  );
  const previousBounds = useMemo(
    () => getPreviousRangeBounds(bounds),
    [bounds.from, bounds.to]
  );
  const canCompare = !!(bounds.from && bounds.to);

  useEffect(() => {
    if (!open || !currentCompany?.id || !currentWorkspace?.id) return;
    let cancelled = false;
    const loadFor = async (b: { from?: string; to?: string }): Promise<OverviewData> => {
        // 1. Rules of this type
        const { data: rulesData } = await supabase
          .from("cadence_rules" as any)
          .select("id, name, trigger_type, activity_type, stage_id")
          .eq("company_id", currentCompany.id)
          .eq("trigger_type", triggerType);
        const rules = (rulesData as any[]) || [];
        const ruleIds = rules.map((r) => r.id);

        // Stage names lookup (for stage rules)
        let stageMap = new Map<string, string>();
        if (triggerType === "stage") {
          const { data: stages } = await supabase
            .from("crm_pipeline_stages")
            .select("id, name")
            .eq("workspace_id", currentWorkspace.id);
          stageMap = new Map((stages || []).map((s: any) => [s.id, s.name]));
        }

        if (ruleIds.length === 0) {
          return EMPTY;
        }

        // 2. All scheduled messages for these rules within bounds
        const msgs = await fetchAllRows<{
          rule_id: string;
          lead_id: string;
          activity_id: string | null;
          send_at: string;
          sent_at: string | null;
          status: string;
          error: string | null;
          message_id: number | null;
        }>((f, t) => {
          let q = supabase
            .from("cadence_scheduled_messages" as any)
            .select("rule_id, lead_id, activity_id, send_at, sent_at, status, error, message_id")
            .in("rule_id", ruleIds)
            .order("send_at", { ascending: true })
            .range(f, t);
          if (b.from) q = q.gte("send_at", b.from);
          if (b.to) q = q.lte("send_at", b.to);
          return q;
        });

        // Excluir mensagens "puladas/canceladas" (supressões intencionais, não falhas)
        const msgsFiltered = msgs.filter(
          (m) => m.status !== "skipped" && m.status !== "cancelled"
        );

        // Buscar delivery_status real das mensagens vinculadas
        const linkedIds = Array.from(
          new Set(msgsFiltered.map((m) => m.message_id).filter((x): x is number => !!x))
        );
        const deliveryMap = new Map<number, string | null>();
        if (linkedIds.length > 0) {
          const linked = await fetchAllRows<{ id: number; delivery_status: string | null }>(
            (f, t) =>
              supabase
                .from("messages")
                .select("id, delivery_status")
                .in("id", linkedIds)
                .range(f, t)
          );
          for (const l of linked) deliveryMap.set(l.id, l.delivery_status);
        }

        // Tolerância: aguardamos 2h antes de classificar como "não entregue"
        // quando o WhatsApp não confirmou recebimento no aparelho.
        const TOLERANCE_MS = 2 * 60 * 60 * 1000;
        const nowMs = Date.now();
        const DELIVERED_STATUSES = new Set(["delivered", "read"]);

        const classify = (m: {
          status: string;
          error: string | null;
          sent_at: string | null;
          message_id: number | null;
        }) => {
          if (m.status === "pending") {
            return m.error ? ("notDelivered" as const) : ("pending" as const);
          }
          if (m.status !== "sent") return "notDelivered" as const;
          if (m.message_id == null) {
            return "delivered" as const;
          }
          const ds = deliveryMap.get(m.message_id);
          if (ds && DELIVERED_STATUSES.has(ds)) return "delivered" as const;
          const sentMs = m.sent_at ? new Date(m.sent_at).getTime() : 0;
          if (sentMs && nowMs - sentMs < TOLERANCE_MS) return "pending" as const;
          return "notDelivered" as const;
        };

        // 3. Totals + per-rule breakdown
        const perRule = new Map<
          string,
          {
            total: number;
            pending: number;
            delivered: number;
            notDelivered: number;
            leads: Set<string>;
            instances: Set<string>;
          }
        >();
        for (const r of rules) {
          perRule.set(r.id, {
            total: 0,
            pending: 0,
            delivered: 0,
            notDelivered: 0,
            leads: new Set(),
            instances: new Set(),
          });
        }
        const allLeads = new Set<string>();
        const allInstances = new Set<string>();
        const chartMap = new Map<string, ChartPoint>();
        for (const m of msgsFiltered) {
          const bk = perRule.get(m.rule_id);
          if (!bk) continue;
          bk.total++;
          bk.leads.add(m.lead_id);
          allLeads.add(m.lead_id);
          const instanceKey =
            triggerType === "activity"
              ? `${m.rule_id}:${m.activity_id ?? m.lead_id}`
              : `${m.rule_id}:${m.lead_id}`;
          bk.instances.add(instanceKey);
          allInstances.add(instanceKey);
          const c = classify(m);
          bk[c]++;
          const k = dayKey(m.send_at);
          const point = chartMap.get(k) || { day: k, entregues: 0, naoEntregues: 0 };
          if (c === "delivered") point.entregues++;
          else if (c === "notDelivered") point.naoEntregues++;
          chartMap.set(k, point);
        }

        const breakdown: RuleBreakdown[] = rules
          .map((r) => {
            const bk = perRule.get(r.id)!;
            const name =
              triggerType === "activity"
                ? ACTIVITY_TYPE_LABELS[r.activity_type] || r.activity_type || r.name || "—"
                : stageMap.get(r.stage_id) || r.name || "—";
            return {
              rule_id: r.id,
              name,
              activations: bk.leads.size,
              started: bk.instances.size,
              total: bk.total,
              pending: bk.pending,
              delivered: bk.delivered,
              notDelivered: bk.notDelivered,
              raw: {
                id: r.id,
                name,
                trigger_type: triggerType,
                activity_type: r.activity_type,
                stage_id: r.stage_id,
              },
            };
          })
          .sort((a, b2) => b2.total - a.total);

        const totals = breakdown.reduce(
          (acc, bk) => {
            acc.total += bk.total;
            acc.pending += bk.pending;
            acc.delivered += bk.delivered;
            acc.notDelivered += bk.notDelivered;
            return acc;
          },
          {
            total: 0,
            pending: 0,
            delivered: 0,
            notDelivered: 0,
            activations: allLeads.size,
            started: allInstances.size,
          }
        );

        const chart = Array.from(chartMap.values()).sort((a, b2) =>
          a.day < b2.day ? -1 : 1
        );

        // 4. No-show correlation (activity rules only)
        let correlation: NoShowCorrelation | null = null;
        if (triggerType === "activity") {
          const activityTypes = Array.from(
            new Set(rules.map((r) => r.activity_type).filter(Boolean))
          ) as string[];
          if (activityTypes.length > 0) {
            const activities = await fetchAllRows<{
              id: string;
              status: string;
              scheduled_at: string;
              lead_id: string;
              type: string;
            }>((f, t) => {
              let q = supabase
                .from("crm_lead_activities")
                .select("id, status, scheduled_at, lead_id, type")
                .eq("workspace_id", currentWorkspace.id)
                .in("type", activityTypes)
                .range(f, t);
              if (b.from) q = q.gte("scheduled_at", b.from);
              if (b.to) q = q.lte("scheduled_at", b.to);
              return q;
            });

            const failureByActivity = new Map<string, boolean>();
            const hasMessageByActivity = new Map<string, boolean>();
            for (const m of msgsFiltered) {
              if (!m.activity_id) continue;
              hasMessageByActivity.set(m.activity_id, true);
              if (classify(m) === "notDelivered") {
                failureByActivity.set(m.activity_id, true);
              }
            }

            let withFailure = 0;
            let withFailureNoShow = 0;
            let withoutFailure = 0;
            let withoutFailureNoShow = 0;
            let totalNoShow = 0;
            for (const a of activities) {
              if (!hasMessageByActivity.get(a.id)) continue;
              const failed = failureByActivity.get(a.id) === true;
              const noShow = a.status === "no_show";
              if (noShow) totalNoShow++;
              if (failed) {
                withFailure++;
                if (noShow) withFailureNoShow++;
              } else {
                withoutFailure++;
                if (noShow) withoutFailureNoShow++;
              }
            }
            correlation = {
              totalActivities: withFailure + withoutFailure,
              totalNoShow,
              withFailure,
              withFailureNoShow,
              withoutFailure,
              withoutFailureNoShow,
            };
          }
        }

        return { totals, breakdown, chart, correlation };
    };

    (async () => {
      setLoading(true);
      try {
        const current = await loadFor(bounds);
        const previous =
          compareEnabled && previousBounds.from && previousBounds.to
            ? await loadFor(previousBounds)
            : null;
        if (cancelled) return;
        setData(current);
        setPreviousData(previous);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    triggerType,
    currentCompany?.id,
    currentWorkspace?.id,
    range,
    bounds.from,
    bounds.to,
    compareEnabled,
    previousBounds.from,
    previousBounds.to,
  ]);

  const title =
    triggerType === "activity"
      ? "Estatísticas gerais — Réguas de atividade"
      : "Estatísticas gerais — Réguas de etapa";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[920px] glass-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Visão agregada de todas as réguas{" "}
              {triggerType === "activity" ? "de atividade" : "de etapa"} no período.
            </DialogDescription>
          </DialogHeader>

          {/* Range filter */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <ToggleGroup
              type="single"
              value={range}
              onValueChange={(v) => v && setRange(v as RangeKey)}
              className="bg-secondary/50 rounded-lg p-1 flex-wrap"
            >
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
                <ToggleGroupItem
                  key={k}
                  value={k}
                  className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {RANGE_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {range === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 text-xs justify-start text-left font-normal gap-2",
                      !customRange?.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {customRange?.from ? (
                      customRange.to ? (
                        <>
                          {format(customRange.from, "dd/MM/yy", { locale: ptBR })} —{" "}
                          {format(customRange.to, "dd/MM/yy", { locale: ptBR })}
                        </>
                      ) : (
                        format(customRange.from, "dd/MM/yy", { locale: ptBR })
                      )
                    ) : (
                      <span>Selecionar período</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={customRange}
                    onSelect={setCustomRange}
                    numberOfMonths={2}
                    locale={ptBR}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <Switch
                id="compare-prev-overview"
                checked={compareEnabled && canCompare}
                disabled={!canCompare}
                onCheckedChange={(v) => setCompareEnabled(!!v)}
              />
              <Label
                htmlFor="compare-prev-overview"
                className={cn(
                  "text-xs cursor-pointer",
                  !canCompare && "text-muted-foreground/60"
                )}
              >
                Comparar c/ período anterior
              </Label>
            </div>
          </div>

          {compareEnabled && canCompare && previousBounds.from && previousBounds.to && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Comparando com {format(new Date(previousBounds.from), "dd/MM/yy", { locale: ptBR })}
              {" — "}
              {format(new Date(previousBounds.to), "dd/MM/yy", { locale: ptBR })}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Totais */}
              <section>
                <SectionHeader
                  title="Totais agregados"
                  hint="Somatório de todas as réguas deste tipo no período"
                />
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <MetricCardWithDelta
                    label="Ativações"
                    value={data.totals.activations}
                    previousValue={previousData?.totals.activations}
                    accent="primary"
                    hint="Leads distintos"
                  />
                  <MetricCardWithDelta
                    label="Réguas iniciadas"
                    value={data.totals.started}
                    previousValue={previousData?.totals.started}
                    accent="primary"
                    hint={
                      triggerType === "activity"
                        ? "Disparos por atividade"
                        : "Disparos por lead"
                    }
                  />
                  <MetricCardWithDelta
                    label="Total"
                    value={data.totals.total}
                    previousValue={previousData?.totals.total}
                    hint="Mensagens agendadas"
                  />
                  <MetricCardWithDelta
                    label="Pendentes"
                    value={data.totals.pending}
                    previousValue={previousData?.totals.pending}
                    accent="warning"
                    inverted
                    hint="Aguardando envio ou confirmação"
                  />
                  <MetricCardWithDelta
                    label="Entregues"
                    value={data.totals.delivered}
                    previousValue={previousData?.totals.delivered}
                    accent="success"
                    hint="Enviadas com sucesso"
                  />
                  <MetricCardWithDelta
                    label="Não entregues"
                    value={data.totals.notDelivered}
                    previousValue={previousData?.totals.notDelivered}
                    accent="destructive"
                    inverted
                    hint="Falhas técnicas de envio"
                  />
                </div>

              </section>

              {/* Correlação No-show (somente atividade) */}
              {triggerType === "activity" && data.correlation && (
                <CorrelationCard
                  c={data.correlation}
                  prev={previousData?.correlation ?? null}
                />
              )}

              {/* Gráfico temporal */}
              {data.chart.length > 0 && (
                <section>
                  <SectionHeader
                    title="Mensagens por dia"
                    hint={
                      previousData
                        ? "Entregues vs não entregues — atual vs período anterior"
                        : "Entregues vs não entregues no período"
                    }
                  />
                  <div className="h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mergeChartWithPrevious(data.chart, previousData?.chart)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis
                          dataKey="day"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickFormatter={(d) => format(new Date(d + "T12:00:00"), "dd/MM")}
                        />
                        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelFormatter={(d) =>
                            format(new Date(d + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })
                          }
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="entregues" name="Entregues" fill="hsl(var(--success))" />
                        <Bar
                          dataKey="naoEntregues"
                          name="Não entregues"
                          fill="hsl(var(--destructive))"
                        />
                        {previousData && (
                          <>
                            <Bar
                              dataKey="entreguesPrev"
                              name="Entregues (anterior)"
                              fill="hsl(var(--success))"
                              fillOpacity={0.35}
                            />
                            <Bar
                              dataKey="naoEntreguesPrev"
                              name="Não entregues (anterior)"
                              fill="hsl(var(--destructive))"
                              fillOpacity={0.35}
                            />
                          </>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Quebra por régua */}
              <section>
                <SectionHeader
                  title="Quebra por régua"
                  hint="Clique em uma linha para ver detalhes"
                />
                {data.breakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma régua encontrada.
                  </p>
                ) : (
                  <div className="rounded-xl border border-border/50 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Régua</th>
                          <th className="text-right px-3 py-2 font-medium">Ativações</th>
                          <th className="text-right px-3 py-2 font-medium">Iniciadas</th>
                          <th className="text-right px-3 py-2 font-medium">Total</th>
                          <th className="text-right px-3 py-2 font-medium">Pendentes</th>
                          <th className="text-right px-3 py-2 font-medium">Entregues</th>
                          <th className="text-right px-3 py-2 font-medium">Não entregues</th>
                          <th className="text-right px-3 py-2 font-medium">Taxa</th>

                        </tr>
                      </thead>
                      <tbody>
                        {data.breakdown.map((b) => {
                          const denom = b.delivered + b.notDelivered;
                          const rate = denom > 0 ? Math.round((b.delivered / denom) * 100) : null;
                          return (
                            <tr
                              key={b.rule_id}
                              className="border-t border-border/50 hover:bg-secondary/30 cursor-pointer"
                              onClick={() => setDrilldown(b.raw)}
                            >
                              <td className="px-3 py-2 text-foreground">{b.name}</td>
                              <td className="px-3 py-2 text-right font-mono">{b.activations}</td>
                              <td className="px-3 py-2 text-right font-mono">{b.started}</td>
                              <td className="px-3 py-2 text-right font-mono">{b.total}</td>

                              <td className="px-3 py-2 text-right font-mono text-warning">
                                {b.pending}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-success">
                                {b.delivered}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-destructive">
                                {b.notDelivered}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                {rate !== null ? `${rate}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CadenceStatsDialog
        rule={drilldown}
        open={!!drilldown}
        onOpenChange={(o) => !o && setDrilldown(null)}
      />
    </>
  );
}

function CorrelationCard({
  c,
  prev,
}: {
  c: NoShowCorrelation;
  prev?: NoShowCorrelation | null;
}) {
  const rate = (cc: NoShowCorrelation, kind: "fail" | "ok") =>
    kind === "fail"
      ? cc.withFailure > 0
        ? (cc.withFailureNoShow / cc.withFailure) * 100
        : null
      : cc.withoutFailure > 0
      ? (cc.withoutFailureNoShow / cc.withoutFailure) * 100
      : null;
  const failRate = rate(c, "fail");
  const okRate = rate(c, "ok");
  const failRatePrev = prev ? rate(prev, "fail") : null;
  const okRatePrev = prev ? rate(prev, "ok") : null;
  let insight: string | null = null;
  if (failRate !== null && okRate !== null && c.withFailure >= 3) {
    const diff = failRate - okRate;
    if (Math.abs(diff) >= 1) {
      const pct = Math.round(Math.abs(diff));
      insight =
        diff > 0
          ? `Atividades cuja régua falhou no envio têm ${pct} pp a mais de no-show.`
          : `Sem evidência de impacto: atividades com falha têm ${pct} pp a menos de no-show.`;
    } else {
      insight = "Sem diferença significativa entre os grupos.";
    }
  }

  const prevLabel = (v: number | null) =>
    prev ? (v !== null ? ` (anterior: ${v.toFixed(1)}%)` : " (anterior: —)") : "";

  return (
    <section>
      <SectionHeader
        title="Correlação: falha de entrega × no-show"
        hint="Compara taxa de no-show entre atividades cuja régua falhou e as que entregaram normalmente"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-secondary/50 border border-border/50">
          <div className="text-xs text-muted-foreground">Atividades cobertas pela régua</div>
          <div className="text-2xl font-mono font-semibold text-foreground">
            {c.totalActivities}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-1">
            {c.totalNoShow} no-show no total
            {prev && ` (anterior: ${prev.totalNoShow}/${prev.totalActivities})`}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/30">
          <div className="text-xs text-muted-foreground">Com falha de entrega</div>
          <div className="text-2xl font-mono font-semibold text-destructive">
            {failRate !== null ? `${failRate.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-1">
            {c.withFailureNoShow} no-show em {c.withFailure} atividades
            {prevLabel(failRatePrev)}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-success/5 border border-success/30">
          <div className="text-xs text-muted-foreground">Entrega ok</div>
          <div className="text-2xl font-mono font-semibold text-success">
            {okRate !== null ? `${okRate.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-1">
            {c.withoutFailureNoShow} no-show em {c.withoutFailure} atividades
            {prevLabel(okRatePrev)}
          </div>
        </div>
      </div>
      {insight && (
        <p className="mt-3 text-sm text-foreground/80 flex items-start gap-2">
          <BarChart3 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <span>{insight}</span>
        </p>
      )}
    </section>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Alinha as séries diárias do período atual com as do período anterior por
 * índice de dia (Dia 1 do atual ↔ Dia 1 do anterior), permitindo overlay
 * comparativo no gráfico de barras.
 */
function mergeChartWithPrevious(
  current: ChartPoint[],
  previous?: ChartPoint[]
): Array<ChartPoint & { entreguesPrev?: number; naoEntreguesPrev?: number; dayPrev?: string }> {
  if (!previous || previous.length === 0) return current;
  return current.map((point, i) => {
    const prev = previous[i];
    return {
      ...point,
      entreguesPrev: prev?.entregues ?? 0,
      naoEntreguesPrev: prev?.naoEntregues ?? 0,
      dayPrev: prev?.day,
    };
  });
}

export default CadenceOverviewDialog;
