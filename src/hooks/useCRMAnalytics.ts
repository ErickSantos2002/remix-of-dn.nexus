import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { PeriodFilter, CustomDateRange } from "./useAnalyticsData";

interface FunnelStage {
  stageId: string;
  name: string;
  periodValue: number;   // leads criados no período que passaram por esta etapa (acumulativo)
  currentValue: number;  // leads open nesta etapa agora (snapshot)
  periodLeadIds: string[];
  currentLeadIds: string[];
  fill: string;
}

interface ActivityBreakdown {
  type: string;
  label: string;
  total: number;
  completed: number;
  no_show: number;
  cancelled: number;
  pending: number;
}

interface LossReasonBreakdown {
  reason: string;
  count: number;
  percentage: number;
  leadIds: string[];
}

interface CRMKPIs {
  totalCRMLeads: number;
  meetingsScheduled: number;
  meetingsCompleted: number;
  meetingsNoShow: number;
  meetingsRescheduled: number;
  conversionLeadToSale: number;
  totalLost: number;
  totalWon: number;
  trends: {
    leads: number;
    meetings: number;
    lost: number;
    won: number;
  };
  // Lead ID arrays for drill-down
  createdLeadIds: string[];
  meetingLeadIds: string[];
  meetingCompletedLeadIds: string[];
  meetingNoShowLeadIds: string[];
  wonLeadIds: string[];
  lostLeadIds: string[];
}

interface TimelinePoint {
  name: string;
  leads: number;
  mql: number;
  reunioes: number;
  negociacao: number;
  vendas: number;
}

export interface LostLeadDetail {
  id: string;
  reason: string;
  stageId: string | null;
}

export interface CRMAnalyticsData {
  kpis: CRMKPIs;
  funnelData: FunnelStage[];
  activityBreakdown: ActivityBreakdown[];
  lossReasons: LossReasonBreakdown[];
  lostLeadsDetail: LostLeadDetail[];
  stages: Array<{ id: string; name: string }>;
  timeline: TimelinePoint[];
}

/** Returns a Date object representing "now" in Brazil (America/Sao_Paulo) */
function getBrazilNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function getStartDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) {
    return customRange.from;
  }
  const brazilNow = getBrazilNow();
  const startDate = new Date(brazilNow);
  if (period === "today") startDate.setHours(0, 0, 0, 0);
  else if (period === "7d") startDate.setDate(brazilNow.getDate() - 7);
  else if (period === "30d") startDate.setDate(brazilNow.getDate() - 30);
  else if (period === "90d") startDate.setDate(brazilNow.getDate() - 90);
  return startDate;
}

function getEndDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) {
    const end = new Date(customRange.to);
    end.setDate(end.getDate() + 1); // inclui dia inteiro
    return end;
  }
  // Para presets, fim do dia de hoje (BRT) — inclui atividades agendadas para mais tarde no dia
  const brazilNow = getBrazilNow();
  const endOfToday = new Date(brazilNow);
  endOfToday.setHours(23, 59, 59, 999);
  return endOfToday;
}

function getPreviousPeriodDates(period: PeriodFilter, customRange?: CustomDateRange): { start: Date; end: Date } {
  const currentStart = getStartDate(period, customRange);
  const currentEnd = period === "custom" && customRange
    ? new Date(customRange.to.getTime() + 86400000 - 1)
    : getBrazilNow();
  const periodLength = currentEnd.getTime() - currentStart.getTime();
  return {
    start: new Date(currentStart.getTime() - periodLength),
    end: new Date(currentStart.getTime()),
  };
}

const ACTIVITY_LABELS: Record<string, string> = {
  meeting: "Reuniao",
  call: "Ligacao",
  follow_up: "Follow-up",
  email: "Email",
  demo: "Demo",
  task: "Tarefa",
  reschedule: "Reagendamento",
};

const FUNNEL_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--success))",
  "hsl(var(--accent))",
];

export interface CRMFunnelFilters {
  utmSource?: string;
  utmCampaign?: string;
  source?: string;
  tag?: string;
}

/** Paginated fetch to bypass the 1000-row API ceiling */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (buildQuery(from, from + PAGE - 1) as any);
    if (error) { console.error("fetchAllRows error:", error); break; }
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export function useCRMAnalytics(period: PeriodFilter, customRange?: CustomDateRange, filters?: CRMFunnelFilters) {
  const { workspaceId } = useWorkspace();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<CRMAnalyticsData | null>(null);
  const [availableFilters, setAvailableFilters] = useState<{
    utmSources: string[];
    utmCampaigns: string[];
    sources: string[];
    tags: string[];
  }>({ utmSources: [], utmCampaigns: [], sources: [], tags: [] });

  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      return;
    }
    if (period === "custom" && !customRange) {
      setIsLoading(false);
      return;
    }
    fetchData();
  }, [workspaceId, period, customRange?.from?.getTime(), customRange?.to?.getTime(), filters?.utmSource, filters?.utmCampaign, filters?.source, filters?.tag]);

  async function fetchData() {
    if (!workspaceId) return;
    setIsLoading(true);

    try {
      const startDate = getStartDate(period, customRange);
      const endDate = getEndDate(period, customRange);
      const prevPeriod = getPreviousPeriodDates(period, customRange);

      // Build helper to add UTM filters to a crm_leads query
      const applyUtmFilters = (query: any) => {
        if (filters?.utmSource) query = query.eq("utm_source", filters.utmSource);
        if (filters?.utmCampaign) query = query.eq("utm_campaign", filters.utmCampaign);
        return query;
      };

      const [
        stagesRes,
        crmLeadsInPeriodRes,
        prevCrmLeadsRes,
        activitiesRes,
        prevActivitiesRes,
        lostLeadsRes,
        allOpenLeadsRes,
        wonLeadsInPeriodRes,
        utmSourcesRes,
        utmCampaignsRes,
        contactSourcesRes,
      ] = await Promise.all([
        supabase
          .from("crm_pipeline_stages")
          .select("id, name, color, order")
          .eq("workspace_id", workspaceId)
          .order("order"),
        // Leads created in period
        applyUtmFilters(
          supabase
            .from("crm_leads")
            .select("id, stage_id, status, created_at, contact_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .gte("created_at", startDate.toISOString())
            .lt("created_at", endDate.toISOString())
        ).limit(10000),
        // Previous period leads
        applyUtmFilters(
          supabase
            .from("crm_leads")
            .select("id, stage_id, status, created_at, contact_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .gte("created_at", prevPeriod.start.toISOString())
            .lt("created_at", prevPeriod.end.toISOString())
        ).limit(10000),
        // Activities in period (scheduled_at)
        supabase
          .from("crm_lead_activities")
          .select("id, type, status, scheduled_at, completed_at, created_at, lead_id")
          .eq("workspace_id", workspaceId)
          .gte("scheduled_at", startDate.toISOString())
          .lt("scheduled_at", endDate.toISOString())
          .limit(10000),
        // Previous period activities
        supabase
          .from("crm_lead_activities")
          .select("id, type, status")
          .eq("workspace_id", workspaceId)
          .gte("scheduled_at", prevPeriod.start.toISOString())
          .lt("scheduled_at", prevPeriod.end.toISOString())
          .limit(10000),
        // Lost leads in period
        applyUtmFilters(
          supabase
            .from("crm_leads")
            .select("id, loss_reason_id, closed_at, contact_id, stage_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .eq("status", "lost")
            .gte("closed_at", startDate.toISOString())
            .lt("closed_at", endDate.toISOString())
        ).limit(10000),
        // All open leads (current snapshot)
        applyUtmFilters(
          supabase
            .from("crm_leads")
            .select("id, stage_id, status, contact_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .eq("status", "open")
        ).limit(10000),
        // Won leads in period
        applyUtmFilters(
          supabase
            .from("crm_leads")
            .select("id, closed_at, status, contact_id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .eq("status", "won")
            .gte("closed_at", startDate.toISOString())
            .lt("closed_at", endDate.toISOString())
        ).limit(10000),
        // Available UTM sources
        supabase
          .from("crm_leads")
          .select("utm_source")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .not("utm_source", "is", null)
          .limit(10000),
        // Available UTM campaigns
        supabase
          .from("crm_leads")
          .select("utm_campaign")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .not("utm_campaign", "is", null)
          .limit(10000),
        // Available contact sources
        supabase
          .from("crm_contacts")
          .select("source")
          .eq("workspace_id", workspaceId)
          .not("source", "is", null)
          .limit(10000),
      ]);

      // Build available filters
      const uniqueUtmSources = [...new Set((utmSourcesRes.data || []).map(r => r.utm_source).filter(Boolean))] as string[];
      const uniqueUtmCampaigns = [...new Set((utmCampaignsRes.data || []).map(r => r.utm_campaign).filter(Boolean))] as string[];
      const uniqueSources = [...new Set((contactSourcesRes.data || []).map(r => r.source).filter(Boolean))] as string[];

      // Fetch tags for available tags list (paginated to avoid 1000-row ceiling)
      const contactsWithTags = await fetchAllRows<{ id: string; tags: any; source: string | null }>(
        (from, to) => supabase
          .from("crm_contacts")
          .select("id, tags, source")
          .eq("workspace_id", workspaceId)
          .not("tags", "is", null)
          .order("id", { ascending: true })
          .range(from, to)
      );

      const tagSet = new Set<string>();
      const contactTagMap = new Map<string, { tags: any; source: string | null }>();
      contactsWithTags.forEach(c => {
        contactTagMap.set(c.id, { tags: c.tags, source: c.source });
        if (Array.isArray(c.tags)) {
          c.tags.forEach((t: any) => {
            if (t && typeof t === "object" && typeof t.name === "string") {
              tagSet.add(t.name);
            }
          });
        }
      });
      const uniqueTags = [...tagSet].sort();

      setAvailableFilters({
        utmSources: uniqueUtmSources.sort(),
        utmCampaigns: uniqueUtmCampaigns.sort(),
        sources: uniqueSources.sort(),
        tags: uniqueTags,
      });

      // If filtering by source or tag, we need to build a set of allowed contact_ids
      let allowedContactIds: Set<string> | null = null;
      if (filters?.source || filters?.tag) {
        // Paginated fetch to get ALL contacts for filtering
        const filteredContacts = await fetchAllRows<{ id: string; tags: any; source: string | null }>(
          (from, to) => supabase
            .from("crm_contacts")
            .select("id, tags, source")
            .eq("workspace_id", workspaceId)
            .order("id", { ascending: true })
            .range(from, to)
        );

        const filtered = filteredContacts.filter(c => {
          if (filters?.source && c.source !== filters.source) return false;
          if (filters?.tag) {
            const tags = Array.isArray(c.tags) ? c.tags : [];
            const hasTag = tags.some((t: any) => t && typeof t === "object" && t.name === filters.tag);
            if (!hasTag) return false;
          }
          return true;
        });
        allowedContactIds = new Set(filtered.map(c => c.id));
      }

      // Apply contact-level filters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterByContact = (items: any[]): any[] => {
        if (!allowedContactIds) return items;
        return items.filter((i: any) => i.contact_id && allowedContactIds!.has(i.contact_id));
      };

      const stages = stagesRes.data || [];
      const crmLeadsInPeriod = filterByContact(crmLeadsInPeriodRes.data || []);
      const prevCrmLeads = filterByContact(prevCrmLeadsRes.data || []);
      const activities = activitiesRes.data || [];
      const prevActivities = prevActivitiesRes.data || [];
      const lostLeads = filterByContact(lostLeadsRes.data || []);
      const allOpenLeads = filterByContact(allOpenLeadsRes.data || []);
      const wonLeadsInPeriod = filterByContact(wonLeadsInPeriodRes.data || []);

      // Loss reason names
      const lossReasonNames: Record<string, string> = {};
      const lossReasonIds = [...new Set(lostLeads.map(l => l.loss_reason_id).filter(Boolean))];
      if (lossReasonIds.length > 0) {
        const { data: reasons } = await supabase
          .from("crm_loss_reasons")
          .select("id, name")
          .in("id", lossReasonIds as string[]);
        if (reasons) {
          reasons.forEach(r => { lossReasonNames[r.id] = r.name; });
        }
      }

      // Stage map ordered
      const stageOrderMap: Record<string, number> = {};
      stages.forEach(s => { stageOrderMap[s.id] = s.order; });

      // Current snapshot: open leads per stage
      const currentStageCounts: Record<string, number> = {};
      const currentLeadIdsByStage: Record<string, string[]> = {};
      allOpenLeads.forEach(l => {
        currentStageCounts[l.stage_id] = (currentStageCounts[l.stage_id] || 0) + 1;
        if (!currentLeadIdsByStage[l.stage_id]) currentLeadIdsByStage[l.stage_id] = [];
        currentLeadIdsByStage[l.stage_id].push(l.id);
      });

      // Period value: leads that ENTERED each stage during the period (via crm_lead_history)
      // Filter by workspace on server side using inner join
      const { data: funnelHistoryEntries } = await supabase
        .from("crm_lead_history")
        .select("lead_id, to_stage_id, crm_leads!inner(workspace_id)")
        .eq("crm_leads.workspace_id", workspaceId)
        .or('action.in.(moved,stage_change,stage_entry),action.is.null')
        .not("to_stage_id", "is", null)
        .gte("created_at", startDate.toISOString())
        .lt("created_at", endDate.toISOString())
        .limit(10000);

      // Build wsLeadIdSet: when filters active, use ONLY filtered leads as the base
      let wsLeadIdSet: Set<string>;

      if (filters?.utmSource || filters?.utmCampaign || filters?.source || filters?.tag) {
        // Paginated fetch of ALL matching leads (not just period-created)
        const allFilteredLeads = await fetchAllRows<{ id: string; contact_id: string | null }>(
          (from, to) => {
            let q = supabase
              .from("crm_leads")
              .select("id, contact_id")
              .eq("workspace_id", workspaceId)
              .is("deleted_at", null)
              .order("id", { ascending: true })
              .range(from, to);
            if (filters?.utmSource) q = q.eq("utm_source", filters.utmSource);
            if (filters?.utmCampaign) q = q.eq("utm_campaign", filters.utmCampaign);
            return    q;
          }
        );
        const filteredAll = filterByContact(allFilteredLeads);
        wsLeadIdSet = new Set(filteredAll.map(l => l.id));
      } else {
        const allWsLeads = await fetchAllRows<{ id: string }>(
          (from, to) => supabase
            .from("crm_leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .order("id", { ascending: true })
            .range(from, to)
        );
        wsLeadIdSet = new Set(allWsLeads.map(l => l.id));
      }

      const filteredFunnelHistory = (funnelHistoryEntries || []).filter(h => wsLeadIdSet.has(h.lead_id));

      // For each stage, collect unique lead IDs that entered it during the period
      const directLeadsByStage: Record<string, Set<string>> = {};
      stages.forEach(s => { directLeadsByStage[s.id] = new Set(); });
      filteredFunnelHistory.forEach(h => {
        if (h.to_stage_id && directLeadsByStage[h.to_stage_id]) {
          directLeadsByStage[h.to_stage_id].add(h.lead_id);
        }
      });

      // Cumulative: a lead that entered stage N also counts for all stages with order <= N
      const leadMaxOrder: Record<string, number> = {};
      stages.forEach(s => {
        directLeadsByStage[s.id].forEach(leadId => {
          const order = stageOrderMap[s.id];
          if (leadMaxOrder[leadId] === undefined || order > leadMaxOrder[leadId]) {
            leadMaxOrder[leadId] = order;
          }
        });
      });

      const periodLeadIdsByStage: string[][] = stages.map(() => []);
      const periodLeadsByStageOrder: number[] = stages.map(() => 0);
      Object.entries(leadMaxOrder).forEach(([leadId, maxOrder]) => {
        stages.forEach((s, i) => {
          if (s.order <= maxOrder) {
            periodLeadIdsByStage[i].push(leadId);
            periodLeadsByStageOrder[i]++;
          }
        });
      });

      const wonInPeriod = wonLeadsInPeriod.length;

      // Funnel data
      const funnelData: FunnelStage[] = stages.map((s, i) => ({
        stageId: s.id,
        name: s.name,
        periodValue: periodLeadsByStageOrder[i],
        currentValue: currentStageCounts[s.id] || 0,
        periodLeadIds: periodLeadIdsByStage[i],
        currentLeadIds: currentLeadIdsByStage[s.id] || [],
        fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
      }));

      // Activity breakdown
      const activityTypeMap: Record<string, { total: number; completed: number; no_show: number; cancelled: number; pending: number }> = {};
      activities.forEach(a => {
        if (!activityTypeMap[a.type]) {
          activityTypeMap[a.type] = { total: 0, completed: 0, no_show: 0, cancelled: 0, pending: 0 };
        }
        activityTypeMap[a.type].total++;
        if (a.status === "completed") activityTypeMap[a.type].completed++;
        else if (a.status === "no_show") activityTypeMap[a.type].no_show++;
        else if (a.status === "cancelled") activityTypeMap[a.type].cancelled++;
        else activityTypeMap[a.type].pending++;
      });

      const activityBreakdown: ActivityBreakdown[] = Object.entries(activityTypeMap).map(([type, stats]) => ({
        type,
        label: ACTIVITY_LABELS[type] || type,
        ...stats,
      })).sort((a, b) => b.total - a.total);

      // Loss reasons breakdown
      const lossReasonGroups: Record<string, string[]> = {};
      lostLeads.forEach(l => {
        const key = l.loss_reason_id || "sem_motivo";
        if (!lossReasonGroups[key]) lossReasonGroups[key] = [];
        lossReasonGroups[key].push(l.id);
      });

      const totalLost = lostLeads.length;
      const lossReasonsBreakdown: LossReasonBreakdown[] = Object.entries(lossReasonGroups)
        .map(([id, ids]) => ({
          reason: id === "sem_motivo" ? "Sem motivo informado" : (lossReasonNames[id] || "Desconhecido"),
          count: ids.length,
          percentage: totalLost > 0 ? Math.round((ids.length / totalLost) * 100) : 0,
          leadIds: ids,
        }))
        .sort((a, b) => b.count - a.count);

      // KPIs
      const meetingTypes = ["meeting", "demo", "reschedule"];
      const meetingActivities = activities.filter(a => meetingTypes.includes(a.type));
      const meetingsScheduled = meetingActivities.length;
      const meetingsCompleted = meetingActivities.filter(a => a.status === "completed").length;
      const meetingsNoShow = meetingActivities.filter(a => a.status === "no_show").length;
      const meetingsRescheduled = activities.filter(a => a.type === "reschedule").length;

      // Collect unique lead IDs for drill-down
      const meetingLeadIds = [...new Set(meetingActivities.map(a => a.lead_id).filter(Boolean))] as string[];
      const meetingCompletedLeadIds = [...new Set(meetingActivities.filter(a => a.status === "completed").map(a => a.lead_id).filter(Boolean))] as string[];
      const meetingNoShowLeadIds = [...new Set(meetingActivities.filter(a => a.status === "no_show").map(a => a.lead_id).filter(Boolean))] as string[];
      const prevMeetings = prevActivities.filter(a => meetingTypes.includes(a.type)).length;

      const totalCRMLeads = crmLeadsInPeriod.length;
      const prevTotalCRMLeads = prevCrmLeads.length;
      const prevLost = prevCrmLeads.filter(l => l.status === "lost").length;
      const prevWon = prevCrmLeads.filter(l => l.status === "won").length;

      const calcTrend = (curr: number, prev: number) =>
        prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);

      const conversionLeadToSale = totalCRMLeads > 0
        ? Math.round((wonInPeriod / totalCRMLeads) * 100) : 0;

      const kpis: CRMKPIs = {
        totalCRMLeads,
        meetingsScheduled,
        meetingsCompleted,
        meetingsNoShow,
        meetingsRescheduled,
        conversionLeadToSale,
        totalLost,
        totalWon: wonInPeriod,
        trends: {
          leads: calcTrend(totalCRMLeads, prevTotalCRMLeads),
          meetings: calcTrend(meetingsScheduled, prevMeetings),
          lost: calcTrend(totalLost, prevLost),
          won: calcTrend(wonInPeriod, prevWon),
        },
        createdLeadIds: crmLeadsInPeriod.map(l => l.id),
        meetingLeadIds,
        meetingCompletedLeadIds,
        meetingNoShowLeadIds,
        wonLeadIds: wonLeadsInPeriod.map(l => l.id),
        lostLeadIds: lostLeads.map(l => l.id),
      };

      // Timeline data using crm_lead_history (filtered by workspace via join)
      const { data: historyEntries } = await supabase
        .from("crm_lead_history")
        .select("id, lead_id, to_stage_id, created_at, crm_leads!inner(workspace_id)")
        .eq("crm_leads.workspace_id", workspaceId)
        .or('action.in.(moved,stage_change,stage_entry),action.is.null')
        .gte("created_at", startDate.toISOString())
        .lt("created_at", endDate.toISOString())
        .limit(10000);

      // Filter by allowed leads (for tag/source/utm filters)
      const filteredHistory = (historyEntries || []).filter(h => wsLeadIdSet.has(h.lead_id));

      const timeline = generateTimeline(filteredHistory, stages, period, startDate);

      setData({
        kpis,
        funnelData,
        activityBreakdown,
        lossReasons: lossReasonsBreakdown,
        lostLeadsDetail: lostLeads.map((l: any) => ({
          id: l.id,
          reason: l.loss_reason_id
            ? (lossReasonNames[l.loss_reason_id] || "Desconhecido")
            : "Sem motivo informado",
          stageId: l.stage_id ?? null,
        })),
        stages: stages.map((s: any) => ({ id: s.id, name: s.name })),
        timeline,
      });
    } catch (error) {
      console.error("Error fetching CRM analytics:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return { data, isLoading, availableFilters };
}

function generateTimeline(
  history: Array<{ id: string; lead_id: string; to_stage_id: string | null; created_at: string | null }>,
  stages: Array<{ id: string; name: string; order: number }>,
  period: PeriodFilter,
  startDate: Date
): TimelinePoint[] {
  const now = getBrazilNow();
  const points: TimelinePoint[] = [];
  const isHourly = period === "today";

  const findStageId = (keyword: string) => stages.find(s => s.name.toLowerCase().includes(keyword))?.id;
  const leadStageId = findStageId("lead");
  const mqlStageId = findStageId("mql");
  const meetingStageId = findStageId("reuni");
  const negotiationStageId = findStageId("negoci");
  const saleStageId = findStageId("venda");

  if (isHourly) {
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);

      const inRange = history.filter(h => {
        const created = new Date(h.created_at || "");
        return created >= hourStart && created < hourEnd;
      });

      points.push({
        name: `${hourStart.getHours()}h`,
        leads: inRange.filter(h => h.to_stage_id === leadStageId).length,
        mql: inRange.filter(h => h.to_stage_id === mqlStageId).length,
        reunioes: inRange.filter(h => h.to_stage_id === meetingStageId).length,
        negociacao: inRange.filter(h => h.to_stage_id === negotiationStageId).length,
        vendas: inRange.filter(h => h.to_stage_id === saleStageId).length,
      });
    }
  } else {
    const diffMs = getBrazilNow().getTime() - startDate.getTime();
    const days = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 1);
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(now.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);

      const inRange = history.filter(h => {
        const created = new Date(h.created_at || "");
        return created >= dayStart && created < dayEnd;
      });

      points.push({
        name: dayStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        leads: inRange.filter(h => h.to_stage_id === leadStageId).length,
        mql: inRange.filter(h => h.to_stage_id === mqlStageId).length,
        reunioes: inRange.filter(h => h.to_stage_id === meetingStageId).length,
        negociacao: inRange.filter(h => h.to_stage_id === negotiationStageId).length,
        vendas: inRange.filter(h => h.to_stage_id === saleStageId).length,
      });
    }
  }

  return points;
}
