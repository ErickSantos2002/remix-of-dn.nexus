import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  User,
  Phone,
  Mail,
  Edit,
  Check,
  X,
  AlertCircle,
  Bell,
  ExternalLink,
  Brain,
  ChevronDown,
  Target,
  TrendingUp,
  ShieldAlert,
  Flame,
  Snowflake,
  Thermometer,
  Lightbulb,
  Download,
  FileText,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { freeSlotForNoShow } from "@/lib/freeSlotOnNoShow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface Appointment {
  id: string;
  workspace_id: string;
  assigned_to?: string | null;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  location: string | null;
  meeting_link: string | null;
  status: string;
  google_event_id: string | null;
  is_synced_to_google: boolean;
  notes: string | null;
  reminder_1_hours: number | null;
  reminder_2_hours: number | null;
  reminder_1_sent: boolean;
  reminder_2_sent: boolean;
  meeting_type?: string;
  contact_joined?: boolean;
  contact_joined_at?: string;
  actual_duration_seconds?: number;
  meeting_started_at?: string;
  meeting_ended_at?: string;
  daily_room_name?: string;
  widget_qualification?: {
    answers?: {
      job_title?: string | null;
      company?: string | null;
      revenue?: string | null;
      employee_count?: string | null;
    } | null;
    icp_enabled?: boolean;
    icp_config_snapshot?: {
      revenue_ranges?: string[];
      job_titles?: string[];
      employee_counts?: string[];
    } | null;
    evaluated_at?: string;
  } | null;
  contact?: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };
  lead?: {
    id: string;
    title: string | null;
  };
  assignee?: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface AppointmentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment;
  onEdit: () => void;
  onUpdate: () => void;
}

export function AppointmentDetailSheet({
  open,
  onOpenChange,
  appointment,
  onEdit,
  onUpdate,
}: AppointmentDetailSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isFetchingTranscription, setIsFetchingTranscription] = useState(false);
  const [isFetchingRecording, setIsFetchingRecording] = useState(false);

  // Fetch lead insights and psychology data
  const { data: leadInsights, isLoading: isLoadingInsights } = useQuery({
    queryKey: ["lead-insights", appointment.lead?.id],
    queryFn: async () => {
      if (!appointment.lead?.id) return null;
      
      // Fetch CRM lead with contact -> lead (for insights)
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select(`
          id,
          contact:crm_contacts!contact_id (
            lead_id,
            lead:leads!lead_id (
              insights,
              ai_summary
            )
          )
        `)
        .eq("id", appointment.lead.id)
        .single();
      
      // Fetch DNIA psychology analysis
      const { data: psychology } = await supabase
        .from("crm_lead_psychology")
        .select("*")
        .eq("lead_id", appointment.lead.id)
        .maybeSingle();
      
      const insights = crmLead?.contact?.lead?.insights as Record<string, any> | null;
      const aiSummary = crmLead?.contact?.lead?.ai_summary as string | null;
      
      return {
        insights,
        aiSummary,
        psychology
      };
    },
    enabled: !!appointment.lead?.id && open,
  });

  // Temperature styling helper
  const getTemperatureConfig = (temp: string | null) => {
    switch (temp) {
      case "muito_quente":
        return { label: "Muito Quente", icon: Flame, className: "text-destructive bg-destructive/10" };
      case "quente":
        return { label: "Quente", icon: Flame, className: "text-warning bg-warning/10" };
      case "morno":
        return { label: "Morno", icon: Thermometer, className: "text-warning bg-warning/10" };
      case "frio":
        return { label: "Frio", icon: Snowflake, className: "text-primary bg-primary/10" };
      case "muito_frio":
        return { label: "Muito Frio", icon: Snowflake, className: "text-series-3 bg-series-3/10" };
      default:
        return { label: temp || "N/A", icon: Thermometer, className: "text-muted-foreground bg-muted" };
    }
  };

  // Helper: delete the linked Google Calendar event (best-effort, non-blocking)
  const deleteGoogleEvent = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!appointment.google_event_id || !appointment.is_synced_to_google) {
      return { ok: true };
    }
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-delete-event", {
        body: {
          workspace_id: appointment.workspace_id,
          appointment_id: appointment.id,
          google_event_id: appointment.google_event_id,
          calendar_owner_id: appointment.assigned_to ?? undefined,
        },
      });
      if (error) return { ok: false, error: error.message };
      if (data && data.success === false) return { ok: false, error: data.error || "Erro desconhecido" };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Falha ao chamar Google Calendar" };
    }
  };

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      // No-show com 30+ min de antecedência: libera o slot da agenda
      if (status === "no_show") {
        const freeResult = await freeSlotForNoShow({
          appointmentId: appointment.id,
          scheduledAt: appointment.start_time,
          // Appointments aqui sempre representam reuniões/demos da agenda
          type: "meeting",
        });

        if (freeResult.freed) {
          // Atividade vinculada foi desvinculada; marca-a como no_show para preservar métricas
          await supabase
            .from("crm_lead_activities")
            .update({ status: "no_show", completed_at: new Date().toISOString() })
            .eq("lead_id", appointment.lead?.id ?? "")
            .eq("scheduled_at", appointment.start_time);
          return {
            status,
            freed: true,
            googleResult: { ok: !freeResult.googleDeleteFailed } as { ok: boolean; error?: string },
          };
        }
      }

      // If cancelling, also remove from Google Calendar (best-effort)
      let googleResult: { ok: boolean; error?: string } = { ok: true };
      if (status === "cancelled") {
        googleResult = await deleteGoogleEvent();
      }

      const { error } = await supabase
        .from("crm_appointments")
        .update(
          status === "cancelled"
            ? { status, notes: "Cancelado: usuário - agenda (/crm/appointments)" }
            : { status }
        )
        .eq("id", appointment.id);
      if (error) throw error;


      return { status, googleResult, freed: false };
    },
    onSuccess: ({ status, googleResult, freed }) => {
      if (freed) {
        if (!googleResult.ok) {
          toast({
            variant: "destructive",
            title: "Horário liberado da agenda",
            description: "Não compareceu registrado, mas falhou ao remover do Google Calendar.",
          });
        } else {
          toast({
            title: "Não compareceu registrado",
            description: "Horário liberado da agenda e do Google Calendar.",
          });
        }
        queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
        queryClient.invalidateQueries({ queryKey: ["crm-activities"] });
        onOpenChange(false);
        onUpdate();
        return;
      }
      if (status === "cancelled" && !googleResult.ok) {
        toast({
          variant: "destructive",
          title: "Agendamento cancelado",
          description: `Cancelado no CRM, mas houve erro ao remover do Google Calendar: ${googleResult.error}`,
        });
      } else if (status === "cancelled") {
        toast({
          title: "Agendamento cancelado",
          description: "Cancelado no CRM e removido do Google Calendar.",
        });
      } else {
        toast({
          title: "Status atualizado",
          description: "O status do agendamento foi atualizado.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["crm-activities"] });
      onUpdate();

    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar",
        description: error.message,
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const googleResult = await deleteGoogleEvent();

      const { error } = await supabase
        .from("crm_appointments")
        .delete()
        .eq("id", appointment.id);
      if (error) throw error;

      return { googleResult };
    },
    onSuccess: ({ googleResult }) => {
      if (!googleResult.ok) {
        toast({
          variant: "destructive",
          title: "Agendamento excluído",
          description: `Removido do CRM (e atividade vinculada), mas houve erro ao remover do Google Calendar: ${googleResult.error}`,
        });
      } else {
        toast({
          title: "Agendamento excluído",
          description: appointment.google_event_id
            ? "Removido do CRM, do Google Calendar e da atividade vinculada."
            : "Agendamento e atividade vinculada removidos.",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["crm-activities"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      onOpenChange(false);
      onUpdate();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error.message,
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled": return "bg-primary/20 text-primary border-primary/30";
      case "confirmed": return "bg-success/20 text-success border-success/30";
      case "completed": return "bg-muted text-muted-foreground border-muted";
      case "cancelled": return "bg-destructive/20 text-destructive border-destructive/30";
      case "no_show": return "bg-warning/20 text-warning border-warning/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "scheduled": return "Agendado";
      case "confirmed": return "Confirmado";
      case "completed": return "Concluído";
      case "cancelled": return "Cancelado";
      case "no_show": return "Não compareceu";
      default: return status;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold">
              Detalhes do Agendamento
            </SheetTitle>
            <Badge className={cn("text-xs", getStatusColor(appointment.status))}>
              {getStatusLabel(appointment.status)}
            </Badge>
          </div>
        </SheetHeader>

        <div className="space-y-6">
          {/* Title and Description */}
          <div>
            <h3 className="text-xl font-semibold text-foreground">{appointment.title}</h3>
            {appointment.description && (
              <p className="text-sm text-muted-foreground mt-1">{appointment.description}</p>
            )}
          </div>

          <Separator />

          {/* Date and Time */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {format(parseISO(appointment.start_time), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </div>
                <div className="text-xs text-muted-foreground">Data</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {format(parseISO(appointment.start_time), "HH:mm")} - {format(parseISO(appointment.end_time), "HH:mm")}
                  <span className="text-muted-foreground ml-1">({appointment.duration_minutes} min)</span>
                </div>
                <div className="text-xs text-muted-foreground">Horário</div>
              </div>
            </div>
          </div>

          {/* Location / Meeting Link */}
          {(appointment.location || appointment.meeting_link) && (
            <>
              <Separator />
              <div className="space-y-3">
                {appointment.location && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{appointment.location}</div>
                      <div className="text-xs text-muted-foreground">Local</div>
                    </div>
                  </div>
                )}

                {appointment.meeting_link && (
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                      <Video className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <a 
                        href={appointment.meeting_link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                      >
                        Entrar na reunião
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <div className="text-xs text-muted-foreground">Link da reunião</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Contact */}
          {appointment.contact && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Contato
                </h4>
                <div className="glass-card rounded-lg p-3 space-y-2">
                  <div className="font-medium text-foreground">{appointment.contact.name}</div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />
                    {appointment.contact.phone}
                  </div>
                  {appointment.contact.email && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      {appointment.contact.email}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Qualificação submetida ao widget (ICP) — auditável, determinística, sem IA */}
          {appointment.widget_qualification?.answers && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  Qualificação no Widget
                </h4>
                <p className="text-xs text-muted-foreground">
                  Respostas que o lead enviou no widget de agendamento. Avaliação de ICP determinística (sem IA); isolada dos campos do contato no CRM.
                </p>
                <div className="glass-card rounded-lg p-3 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Cargo</span>
                    <span className="text-foreground text-right">{appointment.widget_qualification.answers.job_title ?? "—"}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Empresa</span>
                    <span className="text-foreground text-right">{appointment.widget_qualification.answers.company ?? "—"}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Faturamento</span>
                    <span className="text-foreground text-right">{appointment.widget_qualification.answers.revenue ?? "—"}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Funcionários</span>
                    <span className="text-foreground text-right">{appointment.widget_qualification.answers.employee_count ?? "—"}</span>
                  </div>
                </div>
                {appointment.widget_qualification.icp_enabled && appointment.widget_qualification.icp_config_snapshot && (
                  <Collapsible>
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between text-xs text-primary hover:text-primary/80 transition-colors">
                        <span className="font-medium">Ver opções de ICP aceitas no momento do agendamento</span>
                        <ChevronDown className="h-3 w-3" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 animate-fade-in">
                      <div className="glass-card p-3 space-y-2 text-xs">
                        <div>
                          <span className="font-medium text-foreground">Faturamento aceito: </span>
                          <span className="text-muted-foreground">{(appointment.widget_qualification.icp_config_snapshot.revenue_ranges ?? []).join(" · ") || "—"}</span>
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Cargo aceito: </span>
                          <span className="text-muted-foreground">{(appointment.widget_qualification.icp_config_snapshot.job_titles ?? []).join(" · ") || "—"}</span>
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Funcionários aceito: </span>
                          <span className="text-muted-foreground">{(appointment.widget_qualification.icp_config_snapshot.employee_counts ?? []).join(" · ") || "—"}</span>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </>
          )}

          {/* Assignee */}
          {appointment.assignee && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Responsável</h4>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <span className="text-xs font-medium text-primary">
                      {(appointment.assignee.name || appointment.assignee.email)[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-foreground">
                    {appointment.assignee.name || appointment.assignee.email}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Meeting Attendance & Duration */}
          {(appointment.meeting_type === "daily" || appointment.contact_joined !== undefined) && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  Reunião Online
                </h4>
                <div className="space-y-2">
                  {appointment.meeting_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Plataforma</span>
                      <Badge variant="outline" className="text-xs">
                        {appointment.meeting_type === "daily" ? "Daily.co" : appointment.meeting_type === "google_meet" ? "Google Meet" : "Presencial"}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Contato presente</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        appointment.contact_joined
                          ? "bg-success/20 text-success border-success/30"
                          : "bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {appointment.contact_joined ? "Presente" : "Ausente"}
                    </Badge>
                  </div>
                  {appointment.contact_joined_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Entrou em</span>
                      <span className="text-sm font-mono text-foreground">
                        {format(parseISO(appointment.contact_joined_at), "HH:mm")}
                      </span>
                    </div>
                  )}
                  {appointment.actual_duration_seconds && appointment.actual_duration_seconds > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duracao real</span>
                      <span className="text-sm font-mono text-foreground">
                        {Math.floor(appointment.actual_duration_seconds / 60)} min
                      </span>
                    </div>
                  )}
                  {appointment.meeting_type === "daily" && (
                    <div className="pt-1 flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setIsFetchingTranscription(true);
                          try {
                            const { data, error } = await supabase.functions.invoke("daily-room", {
                              body: { action: "fetch-recordings", appointment_id: appointment.id, recovery_type: "transcription" },
                            });
                            if (error) throw error;
                            const jobId = data?.job_id;
                            if (!jobId) throw new Error("Falha ao criar job");
                            toast({ title: "Recuperação iniciada", description: "Buscando transcrição..." });
                            const pollInterval = setInterval(async () => {
                              try {
                                const { data: statusData } = await supabase.functions.invoke("daily-room", {
                                  body: { action: "fetch-recordings-status", job_id: jobId },
                                });
                                if (statusData?.status === "completed") {
                                  clearInterval(pollInterval);
                                  setIsFetchingTranscription(false);
                                  toast({ title: "Transcrição recuperada" });
                                  queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
                                } else if (statusData?.status === "failed") {
                                  clearInterval(pollInterval);
                                  setIsFetchingTranscription(false);
                                  toast({ variant: "destructive", title: "Erro", description: statusData.error || "Falha" });
                                }
                              } catch {
                                clearInterval(pollInterval);
                                setIsFetchingTranscription(false);
                              }
                            }, 5000);
                            setTimeout(() => { clearInterval(pollInterval); setIsFetchingTranscription(false); }, 180000);
                          } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : "Erro";
                            toast({ variant: "destructive", title: "Erro ao recuperar transcrição", description: msg });
                            setIsFetchingTranscription(false);
                          }
                        }}
                        disabled={isFetchingTranscription}
                        className="gap-2"
                      >
                        {isFetchingTranscription ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        {isFetchingTranscription ? "Recuperando..." : "Recuperar transcrição"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setIsFetchingRecording(true);
                          try {
                            const { data, error } = await supabase.functions.invoke("daily-room", {
                              body: { action: "fetch-recordings", appointment_id: appointment.id, recovery_type: "recording" },
                            });
                            if (error) throw error;
                            const jobId = data?.job_id;
                            if (!jobId) throw new Error("Falha ao criar job");
                            toast({ title: "Recuperação iniciada", description: "Buscando vídeo..." });
                            const pollInterval = setInterval(async () => {
                              try {
                                const { data: statusData } = await supabase.functions.invoke("daily-room", {
                                  body: { action: "fetch-recordings-status", job_id: jobId },
                                });
                                if (statusData?.status === "completed") {
                                  clearInterval(pollInterval);
                                  setIsFetchingRecording(false);
                                  toast({ title: "Vídeo recuperado" });
                                  queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
                                } else if (statusData?.status === "failed") {
                                  clearInterval(pollInterval);
                                  setIsFetchingRecording(false);
                                  toast({ variant: "destructive", title: "Erro", description: statusData.error || "Falha" });
                                }
                              } catch {
                                clearInterval(pollInterval);
                                setIsFetchingRecording(false);
                              }
                            }, 5000);
                            setTimeout(() => { clearInterval(pollInterval); setIsFetchingRecording(false); }, 180000);
                          } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : "Erro";
                            toast({ variant: "destructive", title: "Erro ao recuperar vídeo", description: msg });
                            setIsFetchingRecording(false);
                          }
                        }}
                        disabled={isFetchingRecording}
                        className="gap-2"
                      >
                        {isFetchingRecording ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {isFetchingRecording ? "Recuperando..." : "Recuperar vídeo"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Reminders */}
          <Separator />
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Lembretes
            </h4>
            <div className="space-y-1.5">
              {appointment.reminder_1_hours && (
                <div className="flex items-center gap-2 text-sm">
                  {appointment.reminder_1_sent ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={appointment.reminder_1_sent ? "text-muted-foreground" : "text-foreground"}>
                    1º lembrete ({appointment.reminder_1_hours}h antes)
                    {appointment.reminder_1_sent && " - Enviado"}
                  </span>
                </div>
              )}
              {appointment.reminder_2_hours && (
                <div className="flex items-center gap-2 text-sm">
                  {appointment.reminder_2_sent ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={appointment.reminder_2_sent ? "text-muted-foreground" : "text-foreground"}>
                    2º lembrete ({appointment.reminder_2_hours}h antes)
                    {appointment.reminder_2_sent && " - Enviado"}
                  </span>
                </div>
              )}
              {!appointment.reminder_1_hours && !appointment.reminder_2_hours && (
                <p className="text-sm text-muted-foreground">Nenhum lembrete configurado</p>
              )}
            </div>
          </div>

          {/* Notes */}
          {appointment.notes && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Notas</h4>
                <p className="text-sm text-muted-foreground">{appointment.notes}</p>
              </div>
            </>
          )}

          {/* AI Briefing Section */}
          {appointment.lead && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Briefing para Reuniao
                </h4>
                
                {isLoadingInsights ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : leadInsights?.psychology || leadInsights?.aiSummary || leadInsights?.insights ? (
                  <div className="space-y-3">
                    {/* DNIA Badge and Temperature */}
                    {(leadInsights.psychology?.dna_code || leadInsights.psychology?.temperatura) && (
                      <div className="glass-card p-3 space-y-2">
                        {leadInsights.psychology?.dna_code && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">DNA do Lead</span>
                            <Badge variant="outline" className="font-mono text-xs bg-primary/10 text-primary border-primary/30">
                              {leadInsights.psychology.dna_code}
                            </Badge>
                          </div>
                        )}
                        {leadInsights.psychology?.temperatura && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Temperatura</span>
                            {(() => {
                              const config = getTemperatureConfig(leadInsights.psychology.temperatura);
                              const Icon = config.icon;
                              return (
                                <Badge variant="outline" className={cn("text-xs flex items-center gap-1", config.className)}>
                                  <Icon className="h-3 w-3" />
                                  {config.label}
                                </Badge>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Scores */}
                    {leadInsights.psychology && (leadInsights.psychology.propensity_score || leadInsights.psychology.opportunity_score || leadInsights.psychology.risk_score) && (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="glass-card p-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Target className="h-3 w-3 text-success" />
                          </div>
                          <div className="text-lg font-mono text-success">
                            {leadInsights.psychology.propensity_score ?? "-"}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">Propensao</div>
                        </div>
                        <div className="glass-card p-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <TrendingUp className="h-3 w-3 text-warning" />
                          </div>
                          <div className="text-lg font-mono text-warning">
                            {leadInsights.psychology.opportunity_score ?? "-"}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">Oportunidade</div>
                        </div>
                        <div className="glass-card p-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <ShieldAlert className="h-3 w-3 text-destructive" />
                          </div>
                          <div className="text-lg font-mono text-destructive">
                            {leadInsights.psychology.risk_score ?? "-"}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">Risco</div>
                        </div>
                      </div>
                    )}
                    
                    {/* AI Summary */}
                    {leadInsights.aiSummary && (
                      <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg">
                        <div className="text-xs text-primary uppercase font-medium mb-1">
                          Resumo da Conversa
                        </div>
                        <p className="text-xs text-foreground leading-relaxed">{leadInsights.aiSummary}</p>
                      </div>
                    )}
                    
                    {/* Next Action */}
                    {leadInsights.insights?.suggested_action && (
                      <div className="bg-primary/10 border border-primary/30 p-3 rounded-lg">
                        <div className="text-xs text-primary uppercase font-medium mb-1 flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" />
                          Proxima Acao Sugerida
                        </div>
                        <p className="text-xs text-foreground">
                          {leadInsights.insights.suggested_action}
                        </p>
                      </div>
                    )}
                    
                    {/* Objections */}
                    {leadInsights.insights?.objections && leadInsights.insights.objections.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-warning uppercase font-medium flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Objecoes a Tratar
                        </div>
                        <div className="space-y-1">
                          {leadInsights.insights.objections.slice(0, 3).map((obj: any, i: number) => (
                            <div key={i} className="text-xs text-muted-foreground pl-2 border-l-2 border-warning/30">
                              {obj.description || obj}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Top Pains */}
                    {leadInsights.psychology?.top_pains && (leadInsights.psychology.top_pains as any[]).length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-destructive uppercase font-medium">
                          Principais Dores
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(leadInsights.psychology.top_pains as any[]).slice(0, 3).map((pain: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] bg-destructive/5 text-destructive border-destructive/20">
                              {pain.pain || pain}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Top Desires */}
                    {leadInsights.psychology?.top_desires && (leadInsights.psychology.top_desires as any[]).length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs text-success uppercase font-medium">
                          Principais Desejos
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(leadInsights.psychology.top_desires as any[]).slice(0, 3).map((desire: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] bg-success/5 text-success border-success/20">
                              {desire.desire || desire}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Sales Strategy (Collapsible) */}
                    {leadInsights.psychology?.sales_strategy && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-center justify-between text-xs text-primary hover:text-primary/80 transition-colors">
                            <span className="font-medium">Ver Estrategia de Vendas</span>
                            <ChevronDown className="h-3 w-3" />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-2 animate-fade-in">
                          <div className="glass-card p-3 space-y-2 text-xs">
                            {(leadInsights.psychology.sales_strategy as any).approach && (
                              <div>
                                <span className="font-medium text-foreground">Abordagem: </span>
                                <span className="text-muted-foreground">{(leadInsights.psychology.sales_strategy as any).approach}</span>
                              </div>
                            )}
                            {(leadInsights.psychology.sales_strategy as any).closing_technique && (
                              <div>
                                <span className="font-medium text-foreground">Fechamento: </span>
                                <span className="text-muted-foreground">{(leadInsights.psychology.sales_strategy as any).closing_technique}</span>
                              </div>
                            )}
                            {(leadInsights.psychology.sales_strategy as any).objection_handling && Array.isArray((leadInsights.psychology.sales_strategy as any).objection_handling) && (
                              <div>
                                <span className="font-medium text-foreground">Objecoes: </span>
                                <span className="text-muted-foreground">
                                  {(leadInsights.psychology.sales_strategy as any).objection_handling.map((obj: any) => 
                                    typeof obj === 'string' ? obj : obj.objection
                                  ).join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    
                    {/* AI Insights */}
                    {leadInsights.psychology?.ai_insights && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <span>Ver Insights da IA</span>
                            <ChevronDown className="h-3 w-3" />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 animate-fade-in">
                          <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                            {leadInsights.psychology.ai_insights}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma analise disponivel para este lead.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Actions */}
          <Separator />
          <div className="space-y-3">
            {/* Status Actions */}
            {appointment.status === "scheduled" && (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2"
                  onClick={() => updateStatusMutation.mutate("confirmed")}
                  disabled={updateStatusMutation.isPending}
                >
                  <Check className="h-4 w-4" />
                  Confirmar
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2 text-warning hover:text-warning"
                  onClick={() => updateStatusMutation.mutate("cancelled")}
                  disabled={updateStatusMutation.isPending}
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </Button>
              </div>
            )}

            {appointment.status === "confirmed" && (
              <div className="flex gap-2">
                <Button 
                  className="flex-1 gap-2"
                  onClick={() => updateStatusMutation.mutate("completed")}
                  disabled={updateStatusMutation.isPending}
                >
                  <Check className="h-4 w-4" />
                  Marcar Concluído
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2 text-warning hover:text-warning"
                  onClick={() => updateStatusMutation.mutate("no_show")}
                  disabled={updateStatusMutation.isPending}
                >
                  <AlertCircle className="h-4 w-4" />
                  Não compareceu
                </Button>
              </div>
            )}

            {/* Edit and Delete */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={onEdit}>
                <Edit className="h-4 w-4" />
                Editar
              </Button>
              
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="gap-2">
                    <X className="h-4 w-4" />
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita. O agendamento será permanentemente removido.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => deleteMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}