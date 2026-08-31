import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  Users,
  Phone,
  Clock,
  Mail,
  Presentation,
  ListTodo,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  meeting: Users,
  call: Phone,
  follow_up: Clock,
  email: Mail,
  demo: Presentation,
  task: ListTodo,
  reschedule: RefreshCw,
};

const getIcon = (type: string) => ICONS[type] || ListTodo;

interface ActivityRow {
  id: string;
  title: string;
  type: string;
  scheduled_at: string;
  lead_id: string;
  status: string;
  crm_leads: { title: string | null } | null;
}

function endOfTodaySaoPauloISO(): string {
  // Compute end-of-day in America/Sao_Paulo (UTC-3, no DST currently) and return UTC ISO
  const now = new Date();
  const spString = now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  const sp = new Date(spString);
  sp.setHours(23, 59, 59, 999);
  // Offset between local and SP, to recover the correct UTC instant
  const diff = sp.getTime() - new Date(now.toLocaleString("en-US")).getTime();
  return new Date(now.getTime() + diff).toISOString();
}

export function ActivitiesBell() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const { data: activities = [], refetch } = useQuery({
    queryKey: ["topbar-activities", userId],
    enabled: !!userId,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_activities")
        .select("id, title, type, scheduled_at, lead_id, status, crm_leads(title)")
        .eq("assigned_to", userId!)
        .in("status", ["pending", "scheduled", "rescheduled"])
        .not("scheduled_at", "is", null)
        .not("lead_id", "is", null)
        .lte("scheduled_at", endOfTodaySaoPauloISO())
        .order("scheduled_at", { ascending: true });

      if (error) throw error;
      return ((data || []) as unknown as ActivityRow[]).filter(
        (a) => a.lead_id && a.crm_leads?.title
      );
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`topbar-activities-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crm_lead_activities",
          filter: `assigned_to=eq.${userId}`,
        },
        () => refetch()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refetch]);

  const now = Date.now();
  const overdueCount = activities.filter(
    (a) => new Date(a.scheduled_at).getTime() < now
  ).length;
  const total = activities.length;

  const handleClick = (a: ActivityRow) => {
    setOpen(false);
    navigate(`/crm/pipeline?lead=${a.lead_id}&activity=${a.id}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative"
          aria-label="Atividades pendentes"
        >
          <ClipboardList className="h-5 w-5" />
          {total > 0 && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center text-primary-foreground",
                overdueCount > 0 ? "bg-destructive" : "bg-primary"
              )}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] p-0 glass-card border-border"
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            Minhas atividades
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Atrasadas e do dia de hoje
          </p>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {activities.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma atividade pendente para hoje
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activities.map((a) => {
                const Icon = getIcon(a.type);
                const date = new Date(a.scheduled_at);
                const isOverdue = date.getTime() < now;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => handleClick(a)}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3"
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground truncate">
                          {a.crm_leads?.title || "Sem card"}
                        </div>
                        <div className="text-sm font-medium text-foreground truncate">
                          {a.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={cn(
                              "text-xs font-mono",
                              isOverdue ? "text-destructive" : "text-muted-foreground"
                            )}
                          >
                            {format(date, "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                          {isOverdue && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-destructive">
                              Atrasada
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
