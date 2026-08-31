import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";

interface StageInfo {
  id: string;
  name: string;
  order: number;
}

interface CohortRow {
  cohortKey: string; // "2026-01"
  cohortLabel: string; // "Jan/26"
  totalLeads: number;
  leadIds: string[];
  stageCounts: Record<string, number>; // stageId -> count of leads that reached this stage
  stageLeadIds: Record<string, string[]>; // stageId -> lead IDs that reached this stage
  stageRates: Record<string, number>; // stageId -> percentage
  avgDaysToStage: Record<string, number | null>; // stageId -> avg days from creation
  won: number;
  lost: number;
  open: number;
  wip: number;
  wipLeadIds: string[];
  wonLeadIds: string[];
  lostLeadIds: string[];
  wipRate: number;
  wonRate: number;
  lostRate: number;
  revenue: number;
  avgTicket: number;
  revenuePerLead: number;
  evolutionMatrix: Record<number, number>; // M0, M1, M2... -> won count
  evolutionLeadIds: Record<number, string[]>; // M0, M1... -> lead IDs
}

export interface CohortFilters {
  utmSource?: string;
  utmCampaign?: string;
  sources?: string[];
  monthsBack: number;
}

export interface CohortSourceOption {
  name: string;
  label: string;
}

export interface CohortAnalyticsData {
  cohorts: CohortRow[];
  stages: StageInfo[];
  avgConversionDays: Record<string, number | null>; // stageId -> global avg days
  availableUtmSources: string[];
  availableUtmCampaigns: string[];
  availableSources: CohortSourceOption[];
}

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function getCohortKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getCohortLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[parseInt(month) - 1]}/${year.slice(2)}`;
}

function diffMonths(d1: Date, d2: Date): number {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

function diffDays(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function useCohortAnalytics(filters: CohortFilters) {
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<CohortAnalyticsData | null>(null);
  const [excludedLeadIds, setExcludedLeadIds] = useState<Set<string>>(new Set());
  const [refetchTick, setRefetchTick] = useState(0);

  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - filters.monthsBack);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [filters.monthsBack]);

  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      return;
    }
    fetchData();
  }, [workspaceId, companyId, filters.utmSource, filters.utmCampaign, JSON.stringify(filters.sources || []), filters.monthsBack, refetchTick]);

  const refetch = () => setRefetchTick((t) => t + 1);

  async function fetchData() {
    if (!workspaceId) return;
    setIsLoading(true);

    try {
      const PAGE = 1000;

      // Fetch ALL leads in workspace within cutoff (paginated to bypass 1000 row limit)
      const fetchAllLeads = async () => {
        const all: any[] = [];
        let from = 0;
        while (true) {
          let q = supabase
            .from("crm_leads")
            .select("id, contact_id, created_at, status, closed_at, value, stage_id, utm_source, utm_campaign")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .gte("created_at", cutoffDate.toISOString())
            .order("created_at", { ascending: true })
            .range(from, from + PAGE - 1);
          if (filters.utmSource) q = q.eq("utm_source", filters.utmSource);
          if (filters.utmCampaign) q = q.eq("utm_campaign", filters.utmCampaign);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      // Fetch ALL utm values (paginated)
      const fetchAllUtm = async (column: "utm_source" | "utm_campaign") => {
        const all: any[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("crm_leads")
            .select(column)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .not(column, "is", null)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      // Fetch contact sources configured for the company (used to populate the filter)
      const fetchContactSources = async (): Promise<CohortSourceOption[]> => {
        if (!companyId) return [];
        const { data, error } = await supabase
          .from("crm_contact_sources")
          .select("name")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (error) throw error;
        return (data || []).map((r: any) => ({ name: r.name, label: r.name }));
      };

      const [stagesRes, leadsRaw, utmSourcesData, utmCampaignsData, availableSources, exclRes] = await Promise.all([
        supabase
          .from("crm_pipeline_stages")
          .select("id, name, order")
          .eq("workspace_id", workspaceId)
          .order("order"),
        fetchAllLeads(),
        fetchAllUtm("utm_source"),
        fetchAllUtm("utm_campaign"),
        fetchContactSources(),
        supabase
          .from("cohort_excluded_leads" as any)
          .select("lead_id")
          .eq("workspace_id", workspaceId),
      ]);

      const stages = (stagesRes.data || []) as StageInfo[];
      const excludedSet = new Set<string>(((exclRes as any)?.data || []).map((r: any) => r.lead_id));
      setExcludedLeadIds(excludedSet);
      const isExcluded = (id: string) => excludedSet.has(id);

      // Get unique UTM values
      const availableUtmSources = [...new Set(utmSourcesData.map((r: any) => r.utm_source).filter(Boolean))] as string[];
      const availableUtmCampaigns = [...new Set(utmCampaignsData.map((r: any) => r.utm_campaign).filter(Boolean))] as string[];

      // Attach contact source to each lead (chunked .in())
      const contactIds = [...new Set(leadsRaw.map((l: any) => l.contact_id).filter(Boolean))] as string[];
      const contactSourceMap: Record<string, string | null> = {};
      const contactChunk = 200;
      for (let i = 0; i < contactIds.length; i += contactChunk) {
        const chunk = contactIds.slice(i, i + contactChunk);
        const { data: contacts } = await supabase
          .from("crm_contacts")
          .select("id, source")
          .in("id", chunk);
        for (const c of contacts || []) {
          contactSourceMap[(c as any).id] = (c as any).source ?? null;
        }
      }
      for (const l of leadsRaw) {
        (l as any).source = l.contact_id ? contactSourceMap[l.contact_id] ?? null : null;
      }

      // Apply source filter client-side (source lives on crm_contacts)
      const sourceSet = filters.sources && filters.sources.length > 0 ? new Set(filters.sources) : null;
      const leads = sourceSet
        ? leadsRaw.filter((l: any) => l.source && sourceSet.has(l.source))
        : leadsRaw;

      if (leads.length === 0) {
        setData({ cohorts: [], stages, avgConversionDays: {}, availableUtmSources, availableUtmCampaigns, availableSources });
        setIsLoading(false);
        return;
      }

      // Fetch history for these leads
      const leadIds = leads.map(l => l.id);
      
      // Batch fetch history (supabase .in() has limits, chunk if needed)
      const chunkSize = 200;
      const historyEntries: Array<{ lead_id: string; to_stage_id: string | null; created_at: string | null }> = [];
      
      for (let i = 0; i < leadIds.length; i += chunkSize) {
        const chunk = leadIds.slice(i, i + chunkSize);
        const { data: histChunk } = await supabase
          .from("crm_lead_history")
          .select("lead_id, to_stage_id, created_at")
          .in("lead_id", chunk)
          .not("to_stage_id", "is", null);
        if (histChunk) historyEntries.push(...histChunk);
      }

      // Build first-entry map: leadId -> stageId -> earliest date
      const firstEntry: Record<string, Record<string, Date>> = {};
      for (const h of historyEntries) {
        if (!h.to_stage_id || !h.created_at) continue;
        if (!firstEntry[h.lead_id]) firstEntry[h.lead_id] = {};
        const existing = firstEntry[h.lead_id][h.to_stage_id];
        const entryDate = new Date(h.created_at);
        if (!existing || entryDate < existing) {
          firstEntry[h.lead_id][h.to_stage_id] = entryDate;
        }
      }

      // Group leads by cohort
      const cohortMap: Record<string, typeof leads> = {};
      for (const lead of leads) {
        if (!lead.created_at) continue;
        const key = getCohortKey(lead.created_at);
        if (!cohortMap[key]) cohortMap[key] = [];
        cohortMap[key].push(lead);
      }

      // Calculate per cohort
      const stageOrderMap: Record<string, number> = {};
      stages.forEach(s => { stageOrderMap[s.id] = s.order; });

      const globalDaysToStage: Record<string, number[]> = {};
      stages.forEach(s => { globalDaysToStage[s.id] = []; });

      const cohorts: CohortRow[] = Object.keys(cohortMap)
        .sort()
        .map(key => {
          const cohortLeads = cohortMap[key];
          const totalLeads = cohortLeads.filter(l => !isExcluded(l.id)).length;
          const open = cohortLeads.filter(l => l.status === "open" && !isExcluded(l.id)).length;

          // Find MQL stage (case-insensitive, startsWith)
          const mqlStage = stages.find(s => s.name.toLowerCase().startsWith("mql"));
          const mqlStageId = mqlStage?.id;
          const mqlOrder = mqlStage?.order ?? Infinity;

          const hasPassedMQL = (lead: typeof cohortLeads[0]) => {
            if (!mqlStageId) return true; // if stage not found, don't filter
            // Has history entry for MQL stage
            if (firstEntry[lead.id]?.[mqlStageId]) return true;
            // Current stage order >= MQL order
            const currentOrder = stageOrderMap[lead.stage_id] ?? -1;
            return currentOrder >= mqlOrder;
          };

          // Keep ALL matching IDs (including excluded) for modal display.
          // Counts/sums only consider non-excluded leads.
          const wonLeadsAll = cohortLeads.filter(l => l.status === "won" && hasPassedMQL(l));
          const lostLeadsAll = cohortLeads.filter(l => l.status === "lost" && hasPassedMQL(l));
          const wonLeads = wonLeadsAll.filter(l => !isExcluded(l.id));
          const lostLeads = lostLeadsAll.filter(l => !isExcluded(l.id));
          const won = wonLeads.length;
          const lost = lostLeads.length;
          const revenue = wonLeads.reduce((sum, l) => sum + (l.value || 0), 0);

          // WIP = leads that reached MQL - Won - Lost
          const stageNameMap: Record<string, string> = {};
          stages.forEach(s => { stageNameMap[s.id] = s.name; });
          const mqlReachedLeadsAll = cohortLeads.filter(l => hasPassedMQL(l));
          const mqlReachedCount = mqlReachedLeadsAll.filter(l => !isExcluded(l.id)).length;
          const wip = Math.max(0, mqlReachedCount - won - lost);
          const wipLeadIds = mqlReachedLeadsAll
            .filter(l => l.status !== "won" && l.status !== "lost")
            .map(l => l.id);

          // Stage counts, lead IDs & avg days
          const stageCounts: Record<string, number> = {};
          const stageLeadIds: Record<string, string[]> = {};
          const stageRates: Record<string, number> = {};
          const daysToStageAccum: Record<string, number[]> = {};
          stages.forEach(s => { daysToStageAccum[s.id] = []; stageLeadIds[s.id] = []; });

          // Stages that should NOT count lost leads
          const excludeLostPrefixes = ["venda", "em contrato", "iniciado"];
          const shouldExcludeLost = (stageName: string) =>
            excludeLostPrefixes.some(p => stageName.toLowerCase().startsWith(p));

          for (const lead of cohortLeads) {
            const leadCreated = new Date(lead.created_at!);
            const leadHistory = firstEntry[lead.id] || {};
            const leadExcluded = isExcluded(lead.id);

            for (const stage of stages) {
              // Skip lost leads for specific stages
              if (lead.status === "lost" && shouldExcludeLost(stage.name)) continue;

              const currentOrder = stageOrderMap[lead.stage_id] ?? -1;
              const hasReached = leadHistory[stage.id] || currentOrder >= stage.order;

              if (hasReached) {
                // Always include in displayed ID list (modal shows excluded too)
                stageLeadIds[stage.id].push(lead.id);

                if (!leadExcluded) {
                  stageCounts[stage.id] = (stageCounts[stage.id] || 0) + 1;

                  if (leadHistory[stage.id]) {
                    const days = diffDays(leadCreated, leadHistory[stage.id]);
                    if (days >= 0) {
                      daysToStageAccum[stage.id].push(days);
                      globalDaysToStage[stage.id].push(days);
                    }
                  }
                }
              }
            }
          }

          stages.forEach(s => {
            stageRates[s.id] = totalLeads > 0 ? Math.round(((stageCounts[s.id] || 0) / totalLeads) * 1000) / 10 : 0;
          });

          const avgDaysToStage: Record<string, number | null> = {};
          stages.forEach(s => {
            const arr = daysToStageAccum[s.id];
            avgDaysToStage[s.id] = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
          });

          // Evolution matrix: won leads by M0, M1, M2...
          const evolutionMatrix: Record<number, number> = {};
          const evolutionLeadIds: Record<number, string[]> = {};
          for (const lead of cohortLeads) {
            if (lead.status === "won" && lead.closed_at && lead.created_at) {
              const createdDate = new Date(lead.created_at);
              const closedDate = new Date(lead.closed_at);
              const mIndex = diffMonths(createdDate, closedDate);
              // Show excluded in the click-through list, but exclude from count.
              if (!evolutionLeadIds[mIndex]) evolutionLeadIds[mIndex] = [];
              evolutionLeadIds[mIndex].push(lead.id);
              if (!isExcluded(lead.id)) {
                evolutionMatrix[mIndex] = (evolutionMatrix[mIndex] || 0) + 1;
              }
            }
          }

          return {
            cohortKey: key,
            cohortLabel: getCohortLabel(key),
            totalLeads,
            leadIds: cohortLeads.map(l => l.id),
            stageCounts,
            stageLeadIds,
            stageRates,
            avgDaysToStage,
            won,
            lost,
            open,
            wip,
            wipLeadIds,
            wonLeadIds: wonLeadsAll.map(l => l.id),
            lostLeadIds: lostLeadsAll.map(l => l.id),
            wipRate: mqlReachedCount > 0 ? Math.round((wip / mqlReachedCount) * 1000) / 10 : 0,
            wonRate: mqlReachedCount > 0 ? Math.round((won / mqlReachedCount) * 1000) / 10 : 0,
            lostRate: mqlReachedCount > 0 ? Math.round((lost / mqlReachedCount) * 1000) / 10 : 0,
            revenue,
            avgTicket: won > 0 ? Math.round(revenue / won) : 0,
            revenuePerLead: totalLeads > 0 ? Math.round(revenue / totalLeads) : 0,
            evolutionMatrix,
            evolutionLeadIds,
          };
        });

      // Global avg days
      const avgConversionDays: Record<string, number | null> = {};
      stages.forEach(s => {
        const arr = globalDaysToStage[s.id];
        avgConversionDays[s.id] = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      });

      setData({ cohorts, stages, avgConversionDays, availableUtmSources, availableUtmCampaigns, availableSources });
    } catch (error) {
      console.error("Error fetching cohort analytics:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return { data, isLoading, excludedLeadIds, refetch };
}

