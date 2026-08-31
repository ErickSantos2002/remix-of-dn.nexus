import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export type PeriodFilter = "today" | "7d" | "30d" | "90d" | "custom";

export interface CustomDateRange {
  from: Date;
  to: Date;
}

interface KPIData {
  totalLeads: number;
  conversionRate: number;
  totalMessages: number;
  avgResponseTime: number;
  trends: {
    leads: number;
    conversion: number;
    messages: number;
    responseTime: number;
  };
}

interface VolumeDataPoint {
  name: string;
  mensagens: number;
  leads: number;
}

interface FunnelDataPoint {
  name: string;
  value: number;
  fill: string;
}

interface SentimentDataPoint {
  name: string;
  value: number;
  color: string;
}

interface AgentRankingItem {
  name: string;
  messages: number;
  conversion: number;
  rating: number;
}

interface AnalyticsData {
  kpis: KPIData;
  volumeData: VolumeDataPoint[];
  funnelData: FunnelDataPoint[];
  sentimentData: SentimentDataPoint[];
  agentsRanking: AgentRankingItem[];
}

function getStartDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) {
    return customRange.from;
  }
  const now = new Date();
  const startDate = new Date();

  if (period === "today") {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    startDate.setDate(now.getDate() - 7);
  } else if (period === "30d") {
    startDate.setDate(now.getDate() - 30);
  } else if (period === "90d") {
    startDate.setDate(now.getDate() - 90);
  }

  return startDate;
}

function getEndDate(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange) {
    const end = new Date(customRange.to);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  return new Date();
}

function getPreviousPeriodDates(period: PeriodFilter, customRange?: CustomDateRange): { start: Date; end: Date } {
  const currentStart = getStartDate(period, customRange);
  const currentEnd = getEndDate(period, customRange);
  const periodLength = currentEnd.getTime() - currentStart.getTime();
  
  const previousEnd = new Date(currentStart.getTime());
  const previousStart = new Date(currentStart.getTime() - periodLength);
  
  return { start: previousStart, end: previousEnd };
}

export function useAnalyticsData(period: PeriodFilter, customRange?: CustomDateRange) {
  const { workspaceId } = useWorkspace();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      return;
    }
    if (period === "custom" && !customRange) {
      setIsLoading(false);
      return;
    }

    fetchAnalyticsData();
  }, [workspaceId, period, customRange?.from?.getTime(), customRange?.to?.getTime()]);

  async function fetchAnalyticsData() {
    if (!workspaceId) return;
    
    setIsLoading(true);

    try {
      const startDate = getStartDate(period, customRange);
      const previousPeriod = getPreviousPeriodDates(period, customRange);

      // Fetch all data in parallel
      const [
        leadsData,
        previousLeadsData,
        messagesData,
        previousMessagesData,
        agentsData,
      ] = await Promise.all([
        // Current period leads
        supabase
          .from("leads")
          .select("id, status, created_at, assigned_agent_id")
          .eq("workspace_id", workspaceId)
          .gte("created_at", startDate.toISOString()),
        
        // Previous period leads (for trends)
        supabase
          .from("leads")
          .select("id, status, created_at")
          .eq("workspace_id", workspaceId)
          .gte("created_at", previousPeriod.start.toISOString())
          .lt("created_at", previousPeriod.end.toISOString()),
        
        // Current period messages
        supabase
          .from("messages")
          .select("id, created_at, sender_type, lead_id, responding_agent_id")
          .eq("workspace_id", workspaceId)
          .gte("created_at", startDate.toISOString())
          .order("created_at", { ascending: true }),
        
        // Previous period messages (for trends)
        supabase
          .from("messages")
          .select("id, created_at, sender_type")
          .eq("workspace_id", workspaceId)
          .gte("created_at", previousPeriod.start.toISOString())
          .lt("created_at", previousPeriod.end.toISOString()),
        
        // Active agents
        supabase
          .from("agents")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .eq("is_archived", false),
      ]);

      const leads = leadsData.data || [];
      const previousLeads = previousLeadsData.data || [];
      const messages = messagesData.data || [];
      const previousMessages = previousMessagesData.data || [];
      const agents = agentsData.data || [];

      // Calculate KPIs
      const totalLeads = leads.length;
      const previousTotalLeads = previousLeads.length;
      
      const closedLeads = leads.filter(l => l.status === "closed").length;
      const conversionRate = totalLeads > 0 ? (closedLeads / totalLeads) * 100 : 0;
      
      const previousClosedLeads = previousLeads.filter(l => l.status === "closed").length;
      const previousConversionRate = previousTotalLeads > 0 
        ? (previousClosedLeads / previousTotalLeads) * 100 
        : 0;
      
      const totalMessages = messages.length;
      const previousTotalMessages = previousMessages.length;

      // Calculate average response time (time between lead message and AI response)
      const responseTimes: number[] = [];
      const messagesByLead: Record<string, typeof messages> = {};
      
      messages.forEach(msg => {
        if (!messagesByLead[msg.lead_id]) {
          messagesByLead[msg.lead_id] = [];
        }
        messagesByLead[msg.lead_id].push(msg);
      });

      Object.values(messagesByLead).forEach(leadMessages => {
        for (let i = 0; i < leadMessages.length - 1; i++) {
          const current = leadMessages[i];
          const next = leadMessages[i + 1];
          
          if (current.sender_type === "lead" && next.sender_type === "ai") {
            const responseTime = new Date(next.created_at!).getTime() - new Date(current.created_at!).getTime();
            responseTimes.push(responseTime / 1000); // Convert to seconds
          }
        }
      });

      const avgResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

      // Calculate trends
      const leadsTrend = previousTotalLeads > 0 
        ? Math.round(((totalLeads - previousTotalLeads) / previousTotalLeads) * 100) 
        : totalLeads > 0 ? 100 : 0;
      
      const conversionTrend = previousConversionRate > 0
        ? Math.round(conversionRate - previousConversionRate)
        : 0;
      
      const messagesTrend = previousTotalMessages > 0
        ? Math.round(((totalMessages - previousTotalMessages) / previousTotalMessages) * 100)
        : totalMessages > 0 ? 100 : 0;

      // Generate volume data (messages and leads per day/hour)
      const volumeData = generateVolumeData(leads, messages, period, startDate);

      // Generate funnel data based on lead status
      const statusCounts = {
        new: leads.filter(l => l.status === "new").length,
        ai_talking: leads.filter(l => l.status === "ai_talking").length,
        needs_human: leads.filter(l => l.status === "needs_human").length,
        closed: leads.filter(l => l.status === "closed").length,
      };

      const funnelData: FunnelDataPoint[] = [
        { name: "Novos", value: statusCounts.new + statusCounts.ai_talking + statusCounts.needs_human + statusCounts.closed, fill: "hsl(var(--primary))" },
        { name: "Em Atendimento", value: statusCounts.ai_talking + statusCounts.needs_human + statusCounts.closed, fill: "hsl(var(--chart-2))" },
        { name: "Aguardando Humano", value: statusCounts.needs_human + statusCounts.closed, fill: "hsl(var(--chart-3))" },
        { name: "Fechados", value: statusCounts.closed, fill: "hsl(var(--chart-4))" },
      ];

      // Sentiment data (based on lead status as proxy)
      const totalForSentiment = leads.length || 1;
      const sentimentData: SentimentDataPoint[] = [
        { 
          name: "Positivo", 
          value: Math.round((statusCounts.closed / totalForSentiment) * 100), 
          color: "hsl(var(--success))" 
        },
        { 
          name: "Neutro", 
          value: Math.round(((statusCounts.new + statusCounts.ai_talking) / totalForSentiment) * 100), 
          color: "hsl(var(--muted-foreground))" 
        },
        { 
          name: "Negativo", 
          value: Math.round((statusCounts.needs_human / totalForSentiment) * 100), 
          color: "hsl(var(--destructive))" 
        },
      ];

      // Agent ranking
      const agentStats: Record<string, { messages: number; conversions: number }> = {};
      
      agents.forEach(agent => {
        agentStats[agent.id] = { messages: 0, conversions: 0 };
      });

      messages.forEach(msg => {
        if (msg.responding_agent_id && agentStats[msg.responding_agent_id]) {
          agentStats[msg.responding_agent_id].messages++;
        }
      });

      leads.forEach(lead => {
        if (lead.assigned_agent_id && agentStats[lead.assigned_agent_id] && lead.status === "closed") {
          agentStats[lead.assigned_agent_id].conversions++;
        }
      });

      const agentsRanking: AgentRankingItem[] = agents
        .map(agent => {
          const stats = agentStats[agent.id] || { messages: 0, conversions: 0 };
          const leadsForAgent = leads.filter(l => l.assigned_agent_id === agent.id).length;
          const conversionPct = leadsForAgent > 0 
            ? Math.round((stats.conversions / leadsForAgent) * 100) 
            : 0;
          
          return {
            name: agent.name,
            messages: stats.messages,
            conversion: conversionPct,
            rating: 4.5, // Default rating since we don't have rating data
          };
        })
        .sort((a, b) => b.messages - a.messages);

      setData({
        kpis: {
          totalLeads,
          conversionRate,
          totalMessages,
          avgResponseTime,
          trends: {
            leads: leadsTrend,
            conversion: conversionTrend,
            messages: messagesTrend,
            responseTime: 0, // Would need previous period response times for comparison
          },
        },
        volumeData,
        funnelData,
        sentimentData,
        agentsRanking,
      });
    } catch (error) {
      console.error("Error fetching analytics data:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return { data, isLoading };
}

function generateVolumeData(
  leads: any[],
  messages: any[],
  period: PeriodFilter,
  startDate: Date
): VolumeDataPoint[] {
  const isHourly = period === "today";
  const data: VolumeDataPoint[] = [];
  const now = new Date();

  if (isHourly) {
    // Generate 24 hourly points
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);

      const hourLeads = leads.filter(l => {
        const created = new Date(l.created_at);
        return created >= hourStart && created < hourEnd;
      }).length;

      const hourMessages = messages.filter(m => {
        const created = new Date(m.created_at);
        return created >= hourStart && created < hourEnd;
      }).length;

      data.push({
        name: `${hourStart.getHours()}h`,
        mensagens: hourMessages,
        leads: hourLeads,
      });
    }
  } else {
    const diffMs = new Date().getTime() - startDate.getTime();
    const days = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 1);
    
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(now.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);

      const dayLeads = leads.filter(l => {
        const created = new Date(l.created_at);
        return created >= dayStart && created < dayEnd;
      }).length;

      const dayMessages = messages.filter(m => {
        const created = new Date(m.created_at);
        return created >= dayStart && created < dayEnd;
      }).length;

      const dayLabel = dayStart.toLocaleDateString("pt-BR", { 
        day: "2-digit", 
        month: "2-digit" 
      });

      data.push({
        name: dayLabel,
        mensagens: dayMessages,
        leads: dayLeads,
      });
    }
  }

  return data;
}
