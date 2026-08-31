import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfWeek, endOfWeek, subWeeks, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export type MeetingStatus = "rolou" | "reagendou" | "no_show";

export interface MeetingItem {
  id: string;
  contactName: string;
  memberName: string;
  status: MeetingStatus;
  scheduledAt: string;
  type: string;
}

export interface WeekTotals {
  rolou: number;
  reagendou: number;
  noShow: number;
  total: number;
  aconteceuPct: number;
  noShowPct: number;
  noShowOverTotalPct: number;
}

export interface WeekBucket {
  start: Date;
  end: Date;
  label: string;
  items: MeetingItem[];
  totals: WeekTotals;
}

interface UseMeetingsReportParams {
  workspaceId: string | null | undefined;
  memberIds: string[]; // empty = all
  weeks: number;
  types: string[]; // empty = all of [meeting,demo,reschedule]
}

const ACTIVITY_TYPES = ["meeting", "demo", "reschedule"] as const;

async function fetchAllRows<T>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) {
      console.error("[useMeetingsReport] fetchAllRows error:", error);
      break;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function formatWeekLabel(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${format(start, "dd", { locale: ptBR })} a ${format(end, "dd 'de' MMM", { locale: ptBR })}`;
  }
  return `${format(start, "dd 'de' MMM", { locale: ptBR })} a ${format(end, "dd 'de' MMM", { locale: ptBR })}`;
}

export function useMeetingsReport({ workspaceId, memberIds, weeks, types }: UseMeetingsReportParams) {
  return useQuery({
    queryKey: ["meetings-report", workspaceId, memberIds.sort().join(","), weeks, types.sort().join(",")],
    enabled: !!workspaceId,
    queryFn: async (): Promise<{ weeks: WeekBucket[] }> => {
      if (!workspaceId) return { weeks: [] };

      const effectiveTypes = (types && types.length > 0) ? types : (ACTIVITY_TYPES as readonly string[]).slice();

      // Build weekly buckets (most recent first)
      const now = new Date();
      const buckets: WeekBucket[] = [];
      for (let i = 0; i < weeks; i++) {
        const ref = subWeeks(now, i);
        const start = startOfWeek(ref, { weekStartsOn: 1 });
        const end = endOfWeek(ref, { weekStartsOn: 1 });
        buckets.push({
          start,
          end,
          label: formatWeekLabel(start, end),
          items: [],
          totals: {
            rolou: 0,
            reagendou: 0,
            noShow: 0,
            total: 0,
            aconteceuPct: 0,
            noShowPct: 0,
            noShowOverTotalPct: 0,
          },
        });
      }
      if (buckets.length === 0) return { weeks: [] };

      const rangeStart = buckets[buckets.length - 1].start.toISOString();
      const rangeEnd = buckets[0].end.toISOString();

      const rows = await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from("crm_lead_activities")
          .select(`
            id,
            type,
            status,
            no_show_reason,
            scheduled_at,
            assigned_to,
            lead:crm_leads!crm_lead_activities_lead_id_fkey(
              title,
              contact:crm_contacts(name)
            ),
            assigned_profile:profiles!crm_lead_activities_assigned_to_fkey(name, email)
          `)
          .eq("workspace_id", workspaceId)
          .in("type", effectiveTypes)
          .in("status", ["completed", "no_show"])
          .gte("scheduled_at", rangeStart)
          .lte("scheduled_at", rangeEnd)
          .order("scheduled_at", { ascending: false })
          .range(from, to);

        if (memberIds && memberIds.length > 0) {
          q = q.in("assigned_to", memberIds);
        }
        return q;
      });

      for (const r of rows) {
        const scheduled = r.scheduled_at ? new Date(r.scheduled_at) : null;
        if (!scheduled) continue;

        const bucket = buckets.find(b => scheduled >= b.start && scheduled <= b.end);
        if (!bucket) continue;

        let status: MeetingStatus;
        if (r.status === "completed") {
          status = "rolou";
        } else if (r.status === "no_show") {
          if (r.no_show_reason === "rescheduled" || r.no_show_reason === "reschedule_later") {
            status = "reagendou";
          } else {
            status = "no_show";
          }
        } else {
          continue;
        }

        const contactName = r.lead?.contact?.name || r.lead?.title || "Contato sem nome";
        const memberName = r.assigned_profile?.name || r.assigned_profile?.email || "Sem responsável";

        bucket.items.push({
          id: r.id,
          contactName,
          memberName,
          status,
          scheduledAt: r.scheduled_at,
          type: r.type,
        });

        if (status === "rolou") bucket.totals.rolou += 1;
        else if (status === "reagendou") bucket.totals.reagendou += 1;
        else bucket.totals.noShow += 1;
      }

      for (const b of buckets) {
        const total = b.totals.rolou + b.totals.reagendou + b.totals.noShow;
        b.totals.total = total;
        if (total > 0) {
          b.totals.aconteceuPct = (b.totals.rolou / total) * 100;
          b.totals.noShowPct = (b.totals.noShow / total) * 100;
          b.totals.noShowOverTotalPct = ((b.totals.noShow + b.totals.reagendou) / total) * 100;
        }
      }

      return { weeks: buckets };
    },
  });
}
