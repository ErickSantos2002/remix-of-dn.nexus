import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Loader2, ExternalLink, X, CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { getPreviousRangeBounds } from "@/components/crm/cadences/cadenceRange";
import { MetricCardWithDelta } from "@/components/crm/cadences/MetricCardWithDelta";

export interface CadenceStatsRule {
  id: string;
  name?: string | null;
  trigger_type: "activity" | "stage";
  activity_type?: string | null;
  stage_id?: string | null;
}

interface Props {
  rule: CadenceStatsRule | null;
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

type ActivityFilter = "open" | "overdue" | "completed" | "other" | null;

const ACT_FILTER_LABELS: Record<Exclude<ActivityFilter, null>, string> = {
  open: "Em aberto",
  overdue: "Vencidas",
  completed: "Concluídas",
  other: "Outras",
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

  if (range === "today") {
    return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
  }
  if (range === "yesterday") {
    const startY = new Date(startOfToday);
    startY.setDate(startY.getDate() - 1);
    const endY = new Date(endOfToday);
    endY.setDate(endY.getDate() - 1);
    return { from: startY.toISOString(), to: endY.toISOString() };
  }
  const days = range === "7d" ? 7 : 28;
  const from = new Date(startOfToday);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString(), to: endOfToday.toISOString() };
}

interface Stats {
  activations: number;
  started: number;
  totalMessages: number;
  delivered: number;
  notDelivered: number;
  pending: number;
  activities?: {
    open: number;
    overdue: number;
    completed: number;
    other: number;
  };
  recent: Array<{
    lead_id: string;
    contact_id: string | null;
    contact_name: string | null;
    first_send_at: string;
    sent_count: number;
    pending_count: number;
    total: number;
  }>;
}

interface ActivityItem {
  id: string;
  lead_id: string;
  contact_id: string | null;
  contact_name: string | null;
  scheduled_at: string;
  status: string;
}

type MessageFilter = "total" | "pending" | "delivered" | "not_delivered" | null;

const MSG_FILTER_LABELS: Record<Exclude<MessageFilter, null>, string> = {
  total: "Todas as mensagens",
  pending: "Pendentes",
  delivered: "Entregues",
  not_delivered: "Não entregues",
};

interface MessageItem {
  id: string;
  lead_id: string;
  contact_id: string | null;
  contact_name: string | null;
  send_at: string;
  status: string;
  error: string | null;
}


const EMPTY_STATS: Stats = {
  activations: 0,
  started: 0,
  totalMessages: 0,
  delivered: 0,
  notDelivered: 0,
  pending: 0,
  recent: [],
};

export function CadenceStatsDialog({ rule, open, onOpenChange }: Props) {
  const { currentCompany } = useCompany();
  const { currentWorkspace } = useWorkspace();
  const [range, setRange] = useState<RangeKey>("7d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [previousStats, setPreviousStats] = useState<Stats | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(null);
  const [activityList, setActivityList] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>(null);
  const [messageList, setMessageList] = useState<MessageItem[] | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);

  const bounds = useMemo(() => getRangeBounds(range, customRange), [range, customRange]);
  const previousBounds = useMemo(() => getPreviousRangeBounds(bounds), [bounds.from, bounds.to]);
  const canCompare = !!(bounds.from && bounds.to);

  // Reset filters when reopening
  useEffect(() => {
    if (open) {
      setActivityFilter(null);
      setActivityList(null);
      setMessageFilter(null);
      setMessageList(null);
    }
  }, [open, rule?.id]);


  // Fetch main stats
  useEffect(() => {
    if (!open || !rule || !currentCompany?.id) return;

    let cancelled = false;
    setLoading(true);
    setStats(EMPTY_STATS);
    setPreviousStats(null);

    const fetchAll = async <T,>(builder: (f: number, t: number) => any): Promise<T[]> => {
      const PAGE = 1000;
      let acc: T[] = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await builder(from, from + PAGE - 1);
        if (error) { console.error(error); break; }
        if (!data || data.length === 0) break;
        acc = acc.concat(data as T[]);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return acc;
    };

    const loadFor = async (b: { from?: string; to?: string }): Promise<Stats> => {
      const applyMsgRange = (q: any) => {
        let out = q;
        if (b.from) out = out.gte("created_at", b.from);
        if (b.to) out = out.lte("created_at", b.to);
        return out;
      };
      const applyActRange = (q: any) => {
        let out = q;
        if (b.from) out = out.gte("scheduled_at", b.from);
        if (b.to) out = out.lte("scheduled_at", b.to);
        return out;
      };

      const csmRows = await fetchAll<{
        id: string;
        lead_id: string;
        activity_id: string | null;
        status: string;
        error: string | null;
        sent_at: string | null;
        message_id: number | null;
      }>((f, t) => {
        let q = supabase
          .from("cadence_scheduled_messages" as any)
          .select("id, lead_id, activity_id, status, error, sent_at, message_id")
          .eq("rule_id", rule.id)
          .not("status", "in", "(skipped,cancelled)")
          .range(f, t);
        q = applyMsgRange(q);
        return q;
      });

      const linkedIds = Array.from(
        new Set(csmRows.map((r) => r.message_id).filter((x): x is number => !!x)),
      );
      const deliveryMap = new Map<number, string | null>();
      if (linkedIds.length > 0) {
        const linked = await fetchAll<{ id: number; delivery_status: string | null }>(
          (f, t) =>
            supabase
              .from("messages")
              .select("id, delivery_status")
              .in("id", linkedIds)
              .range(f, t),
        );
        for (const l of linked) deliveryMap.set(l.id, l.delivery_status);
      }

      const TOLERANCE_MS = 2 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const DELIVERED_STATUSES = new Set(["delivered", "read"]);

      const classify = (m: typeof csmRows[number]):
        | "delivered" | "pending" | "notDelivered" => {
        if (m.status === "pending") return m.error ? "notDelivered" : "pending";
        if (m.status !== "sent") return "notDelivered";
        if (m.message_id == null) return "delivered";
        const ds = deliveryMap.get(m.message_id);
        if (ds && DELIVERED_STATUSES.has(ds)) return "delivered";
        const sentMs = m.sent_at ? new Date(m.sent_at).getTime() : 0;
        if (sentMs && nowMs - sentMs < TOLERANCE_MS) return "pending";
        return "notDelivered";
      };

      let total = 0, delivered = 0, pending = 0, notDelivered = 0;
      const leadSet = new Set<string>();
      const startedSet = new Set<string>();
      for (const m of csmRows) {
        total++;
        leadSet.add(m.lead_id);
        // Cada disparo da régua = activity_id distinto (quando vinculado a atividade)
        // ou lead_id distinto (para réguas por estágio sem atividade)
        startedSet.add(m.activity_id ?? `lead:${m.lead_id}`);
        const c = classify(m);
        if (c === "delivered") delivered++;
        else if (c === "pending") pending++;
        else notDelivered++;
      }
      const activations = leadSet.size;
      const started = startedSet.size;

      let activities: Stats["activities"] | undefined;
      if (rule.trigger_type === "activity" && rule.activity_type && currentWorkspace?.id) {
        const nowIso = new Date().toISOString();
        const baseAct = () =>
          applyActRange(
            supabase
              .from("crm_lead_activities")
              .select("*", { count: "exact", head: true })
              .eq("workspace_id", currentWorkspace.id)
              .eq("type", rule.activity_type!),
          );

        const [openCount, overdueCount, completedCount, totalActs] = await Promise.all([
          baseAct().eq("status", "pending").gte("scheduled_at", nowIso).then((r: any) => r.count || 0),
          baseAct().eq("status", "pending").lt("scheduled_at", nowIso).then((r: any) => r.count || 0),
          baseAct().eq("status", "completed").then((r: any) => r.count || 0),
          baseAct().then((r: any) => r.count || 0),
        ]);

        activities = {
          open: openCount,
          overdue: overdueCount,
          completed: completedCount,
          other: Math.max(0, totalActs - openCount - overdueCount - completedCount),
        };
      }

      // Recent activations (apenas para o período atual; o anterior é puramente para deltas)
      let recentQ = supabase
        .from("cadence_scheduled_messages" as any)
        .select("lead_id, status, send_at, created_at")
        .eq("rule_id", rule.id)
        .not("status", "in", "(skipped,cancelled)")
        .order("created_at", { ascending: false })
        .limit(200);
      recentQ = applyMsgRange(recentQ);
      const { data: recentMsgs } = await recentQ;

      const byLead = new Map<
        string,
        { first_send_at: string; sent: number; pending: number; total: number }
      >();
      for (const m of (recentMsgs as any[]) || []) {
        const cur = byLead.get(m.lead_id);
        if (!cur) {
          byLead.set(m.lead_id, {
            first_send_at: m.send_at,
            sent: m.status === "sent" ? 1 : 0,
            pending: m.status === "pending" ? 1 : 0,
            total: 1,
          });
        } else {
          cur.total += 1;
          if (m.status === "sent") cur.sent += 1;
          if (m.status === "pending") cur.pending += 1;
          if (new Date(m.send_at) < new Date(cur.first_send_at))
            cur.first_send_at = m.send_at;
        }
      }
      const recentLeadIds = Array.from(byLead.keys()).slice(0, 10);

      const leadInfo: Record<
        string,
        { contact_id: string | null; contact_name: string | null }
      > = {};
      if (recentLeadIds.length > 0) {
        const { data: leads } = await supabase
          .from("crm_leads")
          .select("id, contact_id, crm_contacts(name)")
          .in("id", recentLeadIds);
        for (const l of (leads as any[]) || []) {
          leadInfo[l.id] = {
            contact_id: l.contact_id,
            contact_name: l.crm_contacts?.name ?? null,
          };
        }
      }

      const recent = recentLeadIds.map((lead_id) => {
        const agg = byLead.get(lead_id)!;
        const info = leadInfo[lead_id] || { contact_id: null, contact_name: null };
        return {
          lead_id,
          contact_id: info.contact_id,
          contact_name: info.contact_name,
          first_send_at: agg.first_send_at,
          sent_count: agg.sent,
          pending_count: agg.pending,
          total: agg.total,
        };
      });

      return {
        activations,
        started,
        totalMessages: total,
        delivered,
        notDelivered,
        pending,
        activities,
        recent,
      };
    };

    (async () => {
      try {
        const current = await loadFor(bounds);
        const previous =
          compareEnabled && previousBounds.from && previousBounds.to
            ? await loadFor(previousBounds)
            : null;
        if (cancelled) return;
        setStats(current);
        setPreviousStats(previous);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    rule,
    currentCompany?.id,
    currentWorkspace?.id,
    range,
    bounds.from,
    bounds.to,
    compareEnabled,
    previousBounds.from,
    previousBounds.to,
  ]);

  // Fetch activity list when filter changes
  useEffect(() => {
    if (!open || !rule || !activityFilter || rule.trigger_type !== "activity" || !rule.activity_type || !currentWorkspace?.id) {
      setActivityList(null);
      return;
    }

    let cancelled = false;
    setActivityLoading(true);
    setActivityList(null);

    (async () => {
      try {
        const nowIso = new Date().toISOString();
        let q = supabase
          .from("crm_lead_activities")
          .select("id, lead_id, scheduled_at, status, crm_leads(contact_id, crm_contacts(name))")
          .eq("workspace_id", currentWorkspace.id)
          .eq("type", rule.activity_type!)
          .order("scheduled_at", { ascending: false })
          .limit(20);

        if (bounds.from) q = q.gte("scheduled_at", bounds.from);
        if (bounds.to) q = q.lte("scheduled_at", bounds.to);

        if (activityFilter === "open") {
          q = q.eq("status", "pending").gte("scheduled_at", nowIso);
        } else if (activityFilter === "overdue") {
          q = q.eq("status", "pending").lt("scheduled_at", nowIso);
        } else if (activityFilter === "completed") {
          q = q.eq("status", "completed");
        } else {
          // other
          q = q.not("status", "in", "(pending,completed)");
        }

        const { data } = await q;
        if (cancelled) return;

        const list: ActivityItem[] = ((data as any[]) || []).map((row) => ({
          id: row.id,
          lead_id: row.lead_id,
          contact_id: row.crm_leads?.contact_id ?? null,
          contact_name: row.crm_leads?.crm_contacts?.name ?? null,
          scheduled_at: row.scheduled_at,
          status: row.status,
        }));
        setActivityList(list);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, rule, activityFilter, currentWorkspace?.id, bounds.from, bounds.to]);

  // Fetch message list when message filter changes
  useEffect(() => {
    if (!open || !rule || !messageFilter) {
      setMessageList(null);
      return;
    }

    let cancelled = false;
    setMessageLoading(true);
    setMessageList(null);

    (async () => {
      try {
        // Buscamos mais linhas que o cap final (20) e classificamos no client,
        // pois o status "delivered/not_delivered" depende de messages.delivery_status
        // + janela de tolerância de 2h.
        let q = supabase
          .from("cadence_scheduled_messages" as any)
          .select(
            "id, lead_id, send_at, sent_at, status, error, message_id, crm_leads(contact_id, crm_contacts(name))",
          )
          .eq("rule_id", rule.id)
          .not("status", "in", "(skipped,cancelled)")
          .order("created_at", { ascending: false })
          .limit(200);

        if (bounds.from) q = q.gte("created_at", bounds.from);
        if (bounds.to) q = q.lte("created_at", bounds.to);

        const { data } = await q;
        if (cancelled) return;

        const rows = (data as any[]) || [];
        const linkedIds = Array.from(
          new Set(rows.map((r) => r.message_id).filter((x: any) => !!x)),
        ) as number[];
        const deliveryMap = new Map<number, string | null>();
        if (linkedIds.length > 0) {
          const { data: linked } = await supabase
            .from("messages")
            .select("id, delivery_status")
            .in("id", linkedIds);
          for (const l of (linked as any[]) || [])
            deliveryMap.set(l.id, l.delivery_status);
        }

        const TOLERANCE_MS = 2 * 60 * 60 * 1000;
        const nowMs = Date.now();
        const DELIVERED_STATUSES = new Set(["delivered", "read"]);

        const classify = (m: any): "delivered" | "pending" | "notDelivered" => {
          if (m.status === "pending") return m.error ? "notDelivered" : "pending";
          if (m.status !== "sent") return "notDelivered";
          if (m.message_id == null) return "delivered";
          const ds = deliveryMap.get(m.message_id);
          if (ds && DELIVERED_STATUSES.has(ds)) return "delivered";
          const sentMs = m.sent_at ? new Date(m.sent_at).getTime() : 0;
          if (sentMs && nowMs - sentMs < TOLERANCE_MS) return "pending";
          return "notDelivered";
        };

        let filtered = rows;
        if (messageFilter === "pending")
          filtered = rows.filter((r) => classify(r) === "pending");
        else if (messageFilter === "delivered")
          filtered = rows.filter((r) => classify(r) === "delivered");
        else if (messageFilter === "not_delivered")
          filtered = rows.filter((r) => classify(r) === "notDelivered");

        const list: MessageItem[] = filtered.slice(0, 20).map((row) => {
          const c = classify(row);
          const ds = row.message_id ? deliveryMap.get(row.message_id) : null;
          // Sinaliza visualmente o status real, preservando o tipo MessageItem
          let displayStatus: string = row.status;
          if (c === "delivered") displayStatus = "sent";
          else if (c === "notDelivered" && row.status === "sent") displayStatus = "not_delivered";
          else if (c === "pending" && row.status === "sent") displayStatus = "awaiting_confirmation";
          return {
            id: row.id,
            lead_id: row.lead_id,
            contact_id: row.crm_leads?.contact_id ?? null,
            contact_name: row.crm_leads?.crm_contacts?.name ?? null,
            send_at: row.send_at,
            status: displayStatus,
            error: row.error || (c === "notDelivered" && row.status === "sent" ? `Sem confirmação do WhatsApp (delivery_status=${ds || "?"})` : null),
          };
        });
        setMessageList(list);
      } finally {
        if (!cancelled) setMessageLoading(false);
      }
    })();


    return () => {
      cancelled = true;
    };
  }, [open, rule, messageFilter, bounds.from, bounds.to]);

  const showActivities = stats.activities !== undefined;



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] glass-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Estatísticas da régua</DialogTitle>
          <DialogDescription>
            {rule?.name || (rule?.trigger_type === "activity" ? rule?.activity_type : "Régua de etapa")}
          </DialogDescription>
        </DialogHeader>

        {/* Range filter */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => {
              if (!v) return;
              setRange(v as RangeKey);
            }}
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
              id="compare-prev-stats"
              checked={compareEnabled && canCompare}
              disabled={!canCompare}
              onCheckedChange={(v) => setCompareEnabled(!!v)}
            />
            <Label
              htmlFor="compare-prev-stats"
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
            {/* Section: Leads */}
            <section>
              <SectionHeader title="Leads" hint="Quantos leads tiveram a régua iniciada no período" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <MetricCardWithDelta
                  label="Ativações"
                  value={stats.activations}
                  previousValue={previousStats?.activations}
                  accent="primary"
                  hint="Leads únicos que entraram nesta régua no período"
                />
                <MetricCardWithDelta
                  label="Réguas iniciadas"
                  value={stats.started}
                  previousValue={previousStats?.started}
                  accent="primary"
                  hint={
                    rule?.trigger_type === "activity"
                      ? "Disparos da régua (1 por atividade vinculada)"
                      : "Disparos da régua no período"
                  }
                />
              </div>
            </section>

            {/* Section: Mensagens */}
            <section>
              <SectionHeader title="Mensagens" hint="Mensagens individuais agendadas pela régua no período" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCardWithDelta
                  label="Total agendadas"
                  value={stats.totalMessages}
                  previousValue={previousStats?.totalMessages}
                  hint="Soma de todas as mensagens"
                  active={messageFilter === "total"}
                  onClick={() => {
                    setActivityFilter(null);
                    setMessageFilter((f) => (f === "total" ? null : "total"));
                  }}
                />
                <MetricCardWithDelta
                  label="Pendentes"
                  value={stats.pending}
                  previousValue={previousStats?.pending}
                  accent="warning"
                  inverted
                  hint="Aguardando o horário de envio"
                  active={messageFilter === "pending"}
                  onClick={() => {
                    setActivityFilter(null);
                    setMessageFilter((f) => (f === "pending" ? null : "pending"));
                  }}
                />
                <MetricCardWithDelta
                  label="Entregues"
                  value={stats.delivered}
                  previousValue={previousStats?.delivered}
                  accent="success"
                  hint="Já enviadas com sucesso"
                  active={messageFilter === "delivered"}
                  onClick={() => {
                    setActivityFilter(null);
                    setMessageFilter((f) => (f === "delivered" ? null : "delivered"));
                  }}
                />
                <MetricCardWithDelta
                  label="Não entregues"
                  value={stats.notDelivered}
                  previousValue={previousStats?.notDelivered}
                  accent="destructive"
                  inverted
                  hint="Falhas técnicas de envio"
                  active={messageFilter === "not_delivered"}
                  onClick={() => {
                    setActivityFilter(null);
                    setMessageFilter((f) => (f === "not_delivered" ? null : "not_delivered"));
                  }}
                />
              </div>
            </section>



            {/* Activities block */}
            {showActivities && stats.activities && (
              <div>
                <h3 className="text-sm font-semibold mb-1 text-foreground">
                  Atividades vinculadas
                </h3>
                <p className="text-xs text-muted-foreground mb-2">
                  Atividades do CRM do mesmo tipo da régua, filtradas pela data agendada (<span className="font-medium">scheduled_at</span>) dentro do período selecionado.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <ClickableMetric
                    label="Em aberto"
                    value={stats.activities.open}
                    accent="primary"
                    active={activityFilter === "open"}
                    onClick={() => { setMessageFilter(null); setActivityFilter((f) => (f === "open" ? null : "open")); }}
                    hint="Pendentes agendadas para data/hora futura."
                  />
                  <ClickableMetric
                    label="Vencidas"
                    value={stats.activities.overdue}
                    accent="destructive"
                    active={activityFilter === "overdue"}
                    onClick={() => { setMessageFilter(null); setActivityFilter((f) => (f === "overdue" ? null : "overdue")); }}
                    hint="Pendentes cujo horário já passou e não foram concluídas."
                  />
                  <ClickableMetric
                    label="Concluídas"
                    value={stats.activities.completed}
                    accent="success"
                    active={activityFilter === "completed"}
                    onClick={() => { setMessageFilter(null); setActivityFilter((f) => (f === "completed" ? null : "completed")); }}
                    hint="Marcadas como concluídas no período."
                  />
                  <ClickableMetric
                    label="Outras"
                    value={stats.activities.other}
                    active={activityFilter === "other"}
                    onClick={() => { setMessageFilter(null); setActivityFilter((f) => (f === "other" ? null : "other")); }}
                    hint="No-show, canceladas ou outros status."
                  />

                </div>
              </div>
            )}

            {/* List section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {messageFilter
                    ? `Mensagens — ${MSG_FILTER_LABELS[messageFilter]}`
                    : activityFilter
                      ? `Atividades — ${ACT_FILTER_LABELS[activityFilter]}`
                      : "Ativações recentes"}
                </h3>
                {(activityFilter || messageFilter) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setActivityFilter(null); setMessageFilter(null); }}
                  >
                    <X className="h-3 w-3 mr-1" /> Limpar filtro
                  </Button>
                )}
              </div>


              {messageFilter ? (
                messageLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !messageList || messageList.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center bg-secondary/50 rounded-xl">
                    Nenhuma mensagem encontrada para este filtro.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {messageList.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-card/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {m.contact_name || "Lead sem nome"}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {new Date(m.send_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </div>
                          {m.error && (
                            <div className="text-[11px] text-destructive mt-0.5 truncate" title={m.error}>
                              {m.error}
                            </div>
                          )}
                        </div>
                        <MessageStatusBadge status={m.status} error={m.error} />
                        {m.contact_id && (
                          <Link to={`/crm/contacts/${m.contact_id}`} className="text-primary hover:opacity-80" title="Ver no CRM">
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : activityFilter ? (

                activityLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !activityList || activityList.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center bg-secondary/50 rounded-xl">
                    Nenhuma atividade encontrada para este filtro.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {activityList.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-card/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {a.contact_name || "Lead sem nome"}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {new Date(a.scheduled_at).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })}
                          </div>
                        </div>
                        <ActivityStatusBadge status={a.status} scheduledAt={a.scheduled_at} />
                        {a.contact_id && (
                          <Link
                            to={`/crm/contacts/${a.contact_id}`}
                            className="text-primary hover:opacity-80"
                            title="Ver no CRM"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : stats.recent.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center bg-secondary/50 rounded-xl">
                  Nenhuma ativação registrada neste período.
                </div>
              ) : (
                <div className="space-y-1">
                  {stats.recent.map((r) => {
                    const fullySent = r.pending_count === 0 && r.sent_count > 0;
                    const partial = r.sent_count > 0 && r.pending_count > 0;
                    return (
                      <div
                        key={r.lead_id}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-card/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {r.contact_name || "Lead sem nome"}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {new Date(r.first_send_at).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            fullySent
                              ? "bg-success/10 text-success border-success/30"
                              : partial
                                ? "bg-warning/10 text-warning border-warning/30"
                                : "bg-muted text-muted-foreground border-border"
                          }
                        >
                          {r.sent_count}/{r.total} enviadas
                        </Badge>
                        {r.contact_id && (
                          <Link
                            to={`/crm/contacts/${r.contact_id}`}
                            className="text-primary hover:opacity-80"
                            title="Ver no CRM"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function accentToClass(accent?: "primary" | "success" | "warning" | "destructive") {
  return accent === "primary"
    ? "text-primary"
    : accent === "success"
      ? "text-success"
      : accent === "warning"
        ? "text-warning"
        : accent === "destructive"
          ? "text-destructive"
          : "text-foreground";
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent?: "primary" | "success" | "warning" | "destructive";
  hint?: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-secondary/50 border border-border/50">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono font-semibold ${accentToClass(accent)}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground/80 mt-1 leading-tight">{hint}</div>}
    </div>
  );
}


function ClickableMetric({
  label,
  value,
  accent,
  active,
  onClick,
  hint,
}: {
  label: string;
  value: number;
  accent?: "primary" | "success" | "warning" | "destructive";
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-xl border transition-all ${
        active
          ? "bg-primary/10 border-primary ring-2 ring-primary/40"
          : "bg-secondary/50 border-border/50 hover:border-border hover:bg-secondary"
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-mono font-semibold ${accentToClass(accent)}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground/80 mt-1 leading-tight">{hint}</div>}
    </button>
  );
}


function ActivityStatusBadge({ status, scheduledAt }: { status: string; scheduledAt: string }) {
  const now = new Date();
  const dt = new Date(scheduledAt);
  let label: string;
  let cls: string;
  if (status === "completed") {
    label = "Concluída";
    cls = "bg-success/10 text-success border-success/30";
  } else if (status === "pending" && dt < now) {
    label = "Vencida";
    cls = "bg-destructive/10 text-destructive border-destructive/30";
  } else if (status === "pending") {
    label = "Em aberto";
    cls = "bg-primary/10 text-primary border-primary/30";
  } else {
    label = status === "no_show" ? "No Show" : status;
    cls = "bg-muted text-muted-foreground border-border";
  }

  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}

function MessageStatusBadge({ status, error }: { status: string; error: string | null }) {
  let label: string;
  let cls: string;
  if (status === "sent") {
    label = "Entregue";
    cls = "bg-success/10 text-success border-success/30";
  } else if (status === "not_delivered") {
    label = "Não entregue";
    cls = "bg-destructive/10 text-destructive border-destructive/30";
  } else if (status === "awaiting_confirmation") {
    label = "Aguardando confirmação";
    cls = "bg-warning/10 text-warning border-warning/30";
  } else if (status === "pending") {
    label = error ? "Falha" : "Pendente";
    cls = error
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-warning/10 text-warning border-warning/30";
  } else if (status === "skipped") {
    label = "Pulada";
    cls = "bg-muted text-muted-foreground border-border";
  } else if (status === "cancelled") {
    label = "Cancelada";
    cls = "bg-destructive/10 text-destructive border-destructive/30";
  } else {
    label = status;
    cls = "bg-muted text-muted-foreground border-border";
  }
  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}


export default CadenceStatsDialog;

