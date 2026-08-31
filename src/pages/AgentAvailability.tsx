import { useState, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/dn/Pill";
import { computePresence, PRESENCE_LABEL, PRESENCE_PILL } from "@/lib/routing/presence";
import { DEFAULT_CALENDAR, type AgentCalendar } from "@/lib/routing/workhours";
import {
  Clock,
  User,
  Phone,
  MessageSquare,
  CheckCircle,
  Loader2,
  Users,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadQueueItem {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string;
  status: string;
  priority: number;
  created_at: string;
  assigned_at: string | null;
  category_id: string | null;
  source?: 'queue' | 'leads'; // Track data source
}

interface AgentAvailabilityData {
  id: string;
  user_id: string;
  is_accepting_leads: boolean;
  max_concurrent_leads: number;
  last_activity_at: string | null;
}

const ORDERED_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABEL: Record<string, string> = {
  SUN: "Dom",
  MON: "Seg",
  TUE: "Ter",
  WED: "Qua",
  THU: "Qui",
  FRI: "Sex",
  SAT: "Sáb",
};

export default function AgentAvailability() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [availability, setAvailability] = useState<AgentAvailabilityData | null>(null);
  const [assignedLeads, setAssignedLeads] = useState<LeadQueueItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<Partial<AgentCalendar> | null>(null);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [load, setLoad] = useState(0);

  // Fetch current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    getUser();
  }, []);

  // Fetch availability data
  useEffect(() => {
    if (!workspaceId || !userId) return;

    const fetchAvailability = async () => {
      setIsLoading(true);

      // First, check if availability record exists
      const { data: existingAvailability, error: fetchError } = await supabase
        .from("agent_availability")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        console.error("Error fetching availability:", fetchError);
      }

      if (existingAvailability) {
        setAvailability(existingAvailability as AgentAvailabilityData);
      } else {
        // Create default availability record
        const { data: newAvailability, error: insertError } = await supabase
          .from("agent_availability")
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            max_concurrent_leads: 10
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating availability:", insertError);
        } else {
          setAvailability(newAvailability as AgentAvailabilityData);
        }
      }

      // Fetch assigned leads from lead_queues
      const { data: queueLeads, error: leadsError } = await supabase
        .from("lead_queues")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("assigned_to_user_id", userId)
        .in("status", ["assigned", "in_progress"])
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });

      if (leadsError) {
        console.error("Error fetching leads from queue:", leadsError);
      }

      // Fallback: Also fetch directly from leads table for human_talking status
      const { data: directLeads, error: directError } = await supabase
        .from("leads")
        .select("id, name, phone, status, created_at, assigned_at")
        .eq("workspace_id", workspaceId)
        .eq("assigned_to_user_id", userId)
        .eq("status", "human_talking");

      if (directError) {
        console.error("Error fetching leads directly:", directError);
      }

      // Merge both sources, avoiding duplicates
      const queueLeadIds = new Set((queueLeads || []).map(l => l.lead_id));
      const mergedLeads: LeadQueueItem[] = [
        ...(queueLeads || []).map(l => ({ ...l, source: 'queue' as const })),
        ...(directLeads || [])
          .filter(l => !queueLeadIds.has(l.id))
          .map(l => ({
            id: l.id,
            lead_id: l.id,
            lead_name: l.name,
            lead_phone: l.phone || '',
            status: 'in_progress',
            priority: 1,
            created_at: l.created_at || new Date().toISOString(),
            assigned_at: l.assigned_at,
            category_id: null,
            source: 'leads' as const
          }))
      ];

      setAssignedLeads(mergedLeads);

      // Jornada vigente (calendário próprio) + feriados do workspace, para derivar a presença
      const [{ data: calendarData, error: calendarError }, { data: holidaysData, error: holidaysError }, loadRes] = await Promise.all([
        supabase
          .from("crm_agent_calendars")
          .select("work_days, work_start_time, work_end_time, timezone")
          .eq("workspace_id", workspaceId)
          .eq("agent_id", userId)
          .maybeSingle(),
        supabase.from("crm_holidays").select("date").eq("workspace_id", workspaceId),
        // RPC ainda fora do types.ts gerado — padrão do projeto (useChatPresence.ts)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)("chat_load_by_user", { p_workspace_id: workspaceId, p_user_ids: [userId] }),
      ]);

      if (calendarError) {
        console.error("Error fetching agent calendar:", calendarError);
      }
      if (holidaysError) {
        console.error("Error fetching holidays:", holidaysError);
      }
      if (loadRes.error) {
        console.error("Error fetching chat load:", loadRes.error);
      }

      setCalendar(calendarData ?? null);
      setHolidays(new Set(((holidaysData || []) as Array<{ date: string }>).map(h => h.date)));
      const loadRows = (loadRes.data || []) as Array<{ user_id: string; load: number }>;
      setLoad(Number(loadRows.find(r => r.user_id === userId)?.load) || 0);

      setIsLoading(false);
    };

    fetchAvailability();

    // Set up realtime subscription for lead_queues
    const channel = supabase
      .channel("agent-leads")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lead_queues",
          filter: `assigned_to_user_id=eq.${userId}`
        },
        () => {
          fetchAvailability();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, userId]);

  const togglePause = async (accepting: boolean) => {
    if (!workspaceId || !userId) return;
    setIsSaving(true);
    const { error } = await supabase
      .from("agent_availability")
      .update({ is_accepting_leads: accepting, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao atualizar", description: error.message });
    } else {
      setAvailability(prev => prev ? { ...prev, is_accepting_leads: accepting } : null);
      toast({
        title: accepting ? "Recebendo leads" : "Pausado",
        description: accepting
          ? "Você voltou a receber novos leads de chat."
          : "Você não receberá novos leads até despausar."
      });
    }
    setIsSaving(false);
  };

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 3: return <Badge variant="destructive" className="text-[10px]">Urgente</Badge>;
      case 2: return <Badge className="bg-warning text-warning-foreground text-[10px]">Alta</Badge>;
      case 1: return <Badge variant="secondary" className="text-[10px]">Normal</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">Baixa</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isAcceptingLeads = availability?.is_accepting_leads ?? true;
  const maxConcurrentLeads = availability?.max_concurrent_leads || 10;
  const presenceState = computePresence({
    calendar,
    holidays,
    isAcceptingLeads,
    load,
    maxConcurrentLeads,
  });

  const workStart = calendar?.work_start_time || DEFAULT_CALENDAR.work_start_time;
  const workEnd = calendar?.work_end_time || DEFAULT_CALENDAR.work_end_time;
  const workDays = calendar?.work_days?.length ? calendar.work_days : DEFAULT_CALENDAR.work_days;
  const workDaysLabel = ORDERED_DAYS.filter(d => workDays.includes(d)).map(d => DAY_LABEL[d]).join(", ");

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Disponibilidade</h1>
        <p className="text-muted-foreground text-sm">
          Gerencie sua pausa e veja seus leads atribuídos
        </p>
      </div>

      {/* Status Card */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Seu Status
          </CardTitle>
          <CardDescription>
            A disponibilidade é calculada a partir da sua jornada de trabalho
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Presence */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Pill status={PRESENCE_PILL[presenceState]}>
              {PRESENCE_LABEL[presenceState]}
            </Pill>
            {availability?.last_activity_at && (
              <span className="text-xs text-muted-foreground">
                Última atividade: {formatDistanceToNow(new Date(availability.last_activity_at), {
                  addSuffix: true,
                  locale: ptBR
                })}
              </span>
            )}
          </div>

          {/* Work journey */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{workDaysLabel} · {workStart}–{workEnd}</span>
          </div>

          <Separator />

          {/* Pause toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="accepting-leads" className="text-sm font-medium">
                Receber novos leads
              </Label>
              <p className="text-xs text-muted-foreground">
                A disponibilidade segue seu horário de trabalho; a pausa vale dentro dele
              </p>
            </div>
            <Switch
              id="accepting-leads"
              checked={isAcceptingLeads}
              onCheckedChange={togglePause}
              disabled={isSaving}
            />
          </div>

          <Separator />

          {/* Capacity */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Capacidade</p>
              <p className="text-xs text-muted-foreground">
                Leads atribuídos vs capacidade máxima
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl text-primary">
                {load}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="font-mono text-lg text-muted-foreground">
                {maxConcurrentLeads}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                load >= maxConcurrentLeads
                  ? "bg-destructive"
                  : load >= maxConcurrentLeads * 0.8
                    ? "bg-warning"
                    : "bg-success"
              )}
              style={{
                width: `${Math.min((load / maxConcurrentLeads) * 100, 100)}%`
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Assigned Leads */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Leads Atribuídos
              </CardTitle>
              <CardDescription>
                Leads aguardando ou em atendimento
              </CardDescription>
            </div>
            <Badge variant="secondary" className="font-mono">
              {assignedLeads.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {assignedLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-success" />
              <p className="text-sm">Nenhum lead atribuído no momento</p>
              <p className="text-xs">Novos leads serão exibidos aqui quando atribuídos</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignedLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium",
                      lead.status === "in_progress"
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {lead.lead_name?.charAt(0).toUpperCase() || "?"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {lead.lead_name || "Lead sem nome"}
                        </p>
                        {getPriorityBadge(lead.priority)}
                        {lead.status === "in_progress" && (
                          <Badge variant="outline" className="text-[10px] text-primary border-primary">
                            <Zap className="h-2.5 w-2.5 mr-1" />
                            Em atendimento
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {lead.lead_phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(lead.assigned_at || lead.created_at), {
                            addSuffix: true,
                            locale: ptBR
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.href = `/?lead=${lead.lead_id}`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    Atender
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
