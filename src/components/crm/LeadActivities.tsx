import { useState, useCallback, useEffect, useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ACTIVITY_TYPE_OPTIONS } from "@/lib/activityVocabulary";
import { format, addMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Plus, 
  Calendar, 
  Phone, 
  Mail, 
  Users, 
  CheckCircle2, 
  Clock, 
  Presentation,
  ListTodo,
  MoreHorizontal,
  Check,
  X,
  Loader2,
  Pencil,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  XCircle,
  Video,
  FileText,
  ExternalLink,
  Download,
  ChevronDown,
  Trash2,
  UserX,
  Copy,
  ClipboardCheck
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { freeSlotForNoShow } from "@/lib/freeSlotOnNoShow";
import { CallActivitySection } from "./CallActivitySection";
import { AnalysisPlaybookSelect } from "./AnalysisPlaybookSelect";
import { ActivityAnalysisSection } from "./ActivityAnalysisSection";
import { useActivityAnalysisScores } from "@/hooks/usePerformanceData";
import { useSelectableAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import { scoreTextClass } from "@/lib/analysisCatalog";
import { activityTypeToAnalysisType } from "@/types/analysis";
import { useUserRole } from "@/hooks/useUserRole";
import { useAssignableMembers } from "@/hooks/useAssignableMembers";

interface LeadActivitiesProps {
  leadId: string;
  workspaceId: string;
  stages?: Array<{ id: string; name: string; color: string }>;
  lossReasons?: Array<{ id: string; name: string }>;
  onMoveLead?: (stageId: string, reason?: string) => void;
  onMarkLost?: (lossReasonId: string) => void;
  initialActivityId?: string | null;
}

interface Activity {
  id: string;
  type: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  completed_at: string | null;
  analysis_playbook_id?: string | null;
  assigned_to?: string | null;
}

// Rótulos e valores vêm de activityVocabulary (compartilhado com a condição
// "Atividade" dos Fluxos); os ícones são exclusivos desta tela.
const ACTIVITY_ICONS: Record<string, typeof ListTodo> = {
  meeting: Users,
  call: Phone,
  follow_up: Clock,
  email: Mail,
  demo: Presentation,
  task: ListTodo,
  reschedule: RefreshCw,
};

const activityTypes = ACTIVITY_TYPE_OPTIONS.map((t) => ({
  ...t,
  icon: ACTIVITY_ICONS[t.value] || ListTodo,
}));

const getTypeIcon = (type: string) => {
  const found = activityTypes.find(t => t.value === type);
  return found?.icon || ListTodo;
};

const getTypeLabel = (type: string) => {
  const found = activityTypes.find(t => t.value === type);
  return found?.label || type;
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return { label: "Concluída", className: "bg-success/20 text-success border-success/30" };
    case "cancelled":
      return { label: "Cancelada", className: "bg-destructive/20 text-destructive border-destructive/30" };
    case "no_show":
      return { label: "No-show", className: "bg-warning/20 text-warning border-warning/30" };
    default:
      return null;
  }
};

function ActivityDetailDialog({ activity, leadId, workspaceId, onClose }: { activity: Activity | null; leadId: string; workspaceId: string; onClose: () => void }) {
  const { toast: detailToast } = useToast();
  const detailQueryClient = useQueryClient();
  const [signedVideoUrls, setSignedVideoUrls] = useState<Record<string, { url: string; at: number }>>({});
  // Daily.co access links têm TTL de 60 minutos; expiramos em 55 para segurança
  const VIDEO_URL_TTL_MS = 55 * 60 * 1000;
  useEffect(() => {
    const entries = Object.entries(signedVideoUrls);
    if (entries.length === 0) return;
    const now = Date.now();
    const expired = entries.filter(([, v]) => v.at + VIDEO_URL_TTL_MS - now <= 0).map(([k]) => k);
    if (expired.length > 0) {
      setSignedVideoUrls((prev) => {
        const next = { ...prev };
        for (const k of expired) delete next[k];
        return next;
      });
      return;
    }
    const nextExpiry = Math.min(...entries.map(([, v]) => v.at + VIDEO_URL_TTL_MS - now));
    const timer = window.setTimeout(() => {
      setSignedVideoUrls((prev) => {
        const next: typeof prev = {};
        const t = Date.now();
        for (const [k, v] of Object.entries(prev)) {
          if (v.at + VIDEO_URL_TTL_MS - t > 0) next[k] = v;
        }
        return next;
      });
    }, nextExpiry);
    return () => window.clearTimeout(timer);
  }, [signedVideoUrls, VIDEO_URL_TTL_MS]);

  const [isFetchingTranscription, setIsFetchingTranscription] = useState(false);
  const [isFetchingRecording, setIsFetchingRecording] = useState(false);
  const [isDialing, setIsDialing] = useState(false);

  // Fetch lead contact for call dial
  // Nome do membro vinculado a esta atividade
  const { isSuperAdmin } = useUserRole();
  const { data: assignableMembers = [] } = useAssignableMembers(workspaceId, isSuperAdmin && !!activity);
  const [isSavingAssignee, setIsSavingAssignee] = useState(false);

  const { data: assigneeName } = useQuery({
    queryKey: ["activity-assignee", activity?.assigned_to],
    enabled: !!activity?.assigned_to,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", activity!.assigned_to!)
        .maybeSingle();
      return data?.name || data?.email || null;
    },
    staleTime: 60_000,
  });

  const handleChangeAssignee = useCallback(async (userId: string) => {
    if (!activity) return;
    setIsSavingAssignee(true);
    try {
      const { error } = await supabase
        .from("crm_lead_activities")
        .update({ assigned_to: userId })
        .eq("id", activity.id);
      if (error) throw error;
      detailToast({ title: "Responsável atualizado" });
      detailQueryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      detailQueryClient.invalidateQueries({ queryKey: ["activity-assignee"] });
    } catch (e) {
      detailToast({
        variant: "destructive",
        title: "Erro ao atualizar responsável",
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setIsSavingAssignee(false);
    }
  }, [activity, detailToast, detailQueryClient, leadId]);



  const { data: leadContact } = useQuery({
    queryKey: ["activity-lead-contact", leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_leads")
        .select("contact:crm_contacts(id, name, phone)")
        .eq("id", leadId)
        .maybeSingle();
      return (data?.contact as { id: string; name: string; phone: string | null } | null) || null;
    },
    enabled: !!activity && activity.type === "call" && activity.status === "pending",
  });

  const handleApi4comDial = useCallback(async () => {
    if (!leadContact?.phone || !leadId || !activity) return;
    setIsDialing(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-dial", {
        body: {
          workspace_id: workspaceId,
          lead_id: leadId,
          contact_id: leadContact.id,
          activity_id: activity.id,
          phone: leadContact.phone,
        },
      });

      let errMsg = "";
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try { const body = await ctx.json(); errMsg = body?.error || ""; } catch { /* ignore */ }
        }
        if (!errMsg) errMsg = error.message || "";
      } else if (!data?.success) {
        errMsg = typeof data?.error === "string" ? data.error : JSON.stringify(data?.error || "");
      }

      if (errMsg) {
        if (/user not registered/i.test(errMsg) || (/ramal/i.test(errMsg) && /(registr|logad|online)/i.test(errMsg))) {
          detailToast({
            variant: "destructive",
            title: "Ramal não está logado no webphone",
            description: "Abra a extensão api4com no Chrome e faça login com o seu ramal antes de ligar. O ramal precisa estar online (verde) na extensão.",
          });
        } else if (/[Rr]amal/.test(errMsg) && /configur/i.test(errMsg)) {
          detailToast({
            variant: "destructive",
            title: "Ramal não configurado",
            description: "Configure seu ramal api4com em Time > Editar Membro para fazer ligações.",
          });
        } else if (/api4com/i.test(errMsg) && /configur/i.test(errMsg)) {
          detailToast({
            variant: "destructive",
            title: "Integração api4com pendente",
            description: "Configure a integração em Empresa > Integração api4com.",
          });
        } else {
          detailToast({ variant: "destructive", title: "Falha ao discar", description: errMsg });
        }
        return;
      }

      detailToast({ title: "Chamada iniciada", description: "Atenda no seu ramal/webphone." });
      detailQueryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
    } catch (e) {
      detailToast({ variant: "destructive", title: "Erro", description: e instanceof Error ? e.message : "Falha" });
    } finally {
      setIsDialing(false);
    }
  }, [leadContact, leadId, activity, workspaceId, detailToast, detailQueryClient]);

  const { data: appointment } = useQuery({
    queryKey: ["activity-appointment", leadId, activity?.id],
    queryFn: async () => {
      if (!activity) return null;
      const scheduledIso = new Date(activity.scheduled_at).toISOString();
      const { data } = await supabase
        .from("crm_appointments")
        .select("id, meeting_link, meeting_type, daily_room_url, daily_room_name, meeting_started_at, contact_joined_at")
        .eq("lead_id", leadId)
        .eq("start_time", scheduledIso)
        .maybeSingle();
      if (!data) {
        const { data: fallback } = await supabase
          .from("crm_appointments")
          .select("id, meeting_link, meeting_type, daily_room_url, daily_room_name, meeting_started_at, contact_joined_at")
          .eq("lead_id", leadId)
          .eq("title", activity.title)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return fallback;
      }
      return data;
    },
    enabled: !!activity && (activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule"),
  });

  // Query daily_recordings for this appointment (may have multiple entries per meeting)
  type RecordingRow = {
    id: string;
    recording_url: string | null;
    transcription_url: string | null;
    transcription_text: string | null;
    status: string;
    duration_seconds: number | null;
    ai_analysis: string | null;
    chat_messages: Array<{ from: string; fromName: string; role: "host" | "guest"; text: string; ts: string }> | null;
    created_at: string;
  };
  const { data: recordings = [] } = useQuery({
    queryKey: ["daily-recordings", appointment?.id],
    queryFn: async () => {
      if (!appointment?.id) return [] as RecordingRow[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("daily_recordings") as any)
        .select("id, recording_url, transcription_url, transcription_text, status, duration_seconds, ai_analysis, chat_messages, created_at")
        .eq("appointment_id", appointment.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as RecordingRow[];
    },
    enabled: !!appointment?.id,
  });

  // Log de acessos à sala Daily.co (preenchido pelo daily-webhook)
  // Os nomes vêm percent-encoded do token da sala (ex.: "Thiago%20Petrocchi")
  const decodeParticipantName = (raw: string | null) => {
    if (!raw) return "Participante sem nome";
    try {
      return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return raw;
    }
  };
  type RoomParticipantRow = {
    id: string;
    participant_id: string;
    user_name: string | null;
    joined_at: string;
    is_owner: boolean;
  };
  const { data: roomParticipants = [] } = useQuery({
    queryKey: ["daily-meeting-participants", appointment?.id],
    queryFn: async () => {
      if (!appointment?.id) return [] as RoomParticipantRow[];
      const { data } = await supabase
        .from("daily_meeting_participants")
        .select("id, participant_id, user_name, joined_at, is_owner")
        .eq("appointment_id", appointment.id)
        .order("joined_at", { ascending: true });
      return (data ?? []) as RoomParticipantRow[];
    },
    enabled: !!appointment?.id && appointment?.meeting_type === "daily",
  });

  // O webhook do Daily nem sempre registra todos os participantes (eventos
  // perdidos). Complementamos com os marcos gravados no próprio agendamento:
  // meeting_started_at (anfitrião) e contact_joined_at (convidado).
  const roomAccessEntries = (() => {
    // A mesma pessoa pode gerar linhas por várias origens (webhook do Daily,
    // lobby, emissão de token). Agrupamos por nome + papel, mantendo a
    // primeira entrada registrada.
    const byPerson = new Map<
      string,
      { key: string; name: string; isOwner: boolean; joinedAt: string; inferred: boolean }
    >();
    for (const p of roomParticipants) {
      const name = decodeParticipantName(p.user_name);
      const groupKey = `${p.is_owner ? "host" : "guest"}:${name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()}`;
      const current = byPerson.get(groupKey);
      if (!current || new Date(p.joined_at).getTime() < new Date(current.joinedAt).getTime()) {
        byPerson.set(groupKey, {
          key: current?.key ?? p.id,
          name,
          isOwner: p.is_owner,
          joinedAt: p.joined_at,
          inferred: false,
        });
      }
    }
    const entries = Array.from(byPerson.values());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appt = appointment as any;
    if (appt?.meeting_started_at && !entries.some((e) => e.isOwner)) {
      entries.push({
        key: "inferred-host",
        name: "Anfitrião",
        isOwner: true,
        joinedAt: appt.meeting_started_at,
        inferred: true,
      });
    }
    if (appt?.contact_joined_at && !entries.some((e) => !e.isOwner)) {
      entries.push({
        key: "inferred-guest",
        name: leadContact?.name || "Convidado",
        isOwner: false,
        joinedAt: appt.contact_joined_at,
        inferred: true,
      });
    }
    return entries.sort(
      (a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
    );
  })();




  // Transcrição ao vivo, indexada durante a reunião. Diferente de chat_messages,
  // aqui os locutores vêm identificados — o chat perde a atribuição e registra
  // todo mundo como "Participante".
  const { data: transcriptChunks = [] } = useQuery({
    queryKey: ["meeting-transcript-chunks", appointment?.id, appointment?.daily_room_name],
    queryFn: async () => {
      const keys = [appointment?.daily_room_name, appointment?.id].filter(Boolean) as string[];
      if (keys.length === 0) return [] as Array<{ chunk_index: number; speakers: string[]; content: string }>;
      const { data } = await supabase
        .from("meeting_transcript_chunks")
        .select("chunk_index, speakers, content")
        .in("meeting_id", keys)
        .order("chunk_index", { ascending: true });
      return (data ?? []) as Array<{ chunk_index: number; speakers: string[]; content: string }>;
    },
    enabled: !!(appointment?.daily_room_name || appointment?.id),
  });

  // O conteúdo dos chunks vem como "Nome: fala", uma por linha. Separamos o locutor
  // conferindo contra os nomes declarados em `speakers` — assim uma fala que contenha
  // dois-pontos no meio não é confundida com um prefixo de locutor.
  const transcriptLines = useMemo(() => {
    const speakers = new Set(transcriptChunks.flatMap((c) => c.speakers ?? []));
    return transcriptChunks
      .flatMap((c) => c.content.split("\n"))
      .filter((raw) => raw.trim().length > 0)
      .map((raw) => {
        const sep = raw.indexOf(": ");
        if (sep > 0) {
          const candidate = raw.slice(0, sep);
          if (speakers.has(candidate)) {
            return { speaker: candidate, text: raw.slice(sep + 2) };
          }
        }
        return { speaker: null as string | null, text: raw };
      });
  }, [transcriptChunks]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      detailToast({ title: `${label} copiada` });
    } catch {
      detailToast({ variant: "destructive", title: `Não foi possível copiar ${label.toLowerCase()}` });
    }
  };

  // Generate signed URL for each ready recording
  useEffect(() => {
    const ready = recordings.filter((r) => r.recording_url && (r.status === "ready" || r.status === "external_link"));
    let cancelled = false;
    (async () => {
      for (const r of ready) {
        if (signedVideoUrls[r.id]) continue;
        const url = r.recording_url as string;
        try {
          if (url.startsWith("http")) {
            try {
              const { data: freshData, error: freshError } = await supabase.functions.invoke("daily-room", {
                body: {
                  action: "get-access-link",
                  appointment_id: appointment?.id,
                  workspace_id: workspaceId,
                  recording_id: r.id,
                },
              });
              if (!cancelled && !freshError && freshData?.url) {
                setSignedVideoUrls((prev) => ({ ...prev, [r.id]: { url: freshData.url, at: Date.now() } }));
                continue;
              }
            } catch {
              // fallback below
            }
            if (!cancelled) {
              setSignedVideoUrls((prev) => ({ ...prev, [r.id]: { url, at: Date.now() } }));
            }
          } else if (url.includes("/")) {
            const { data } = await supabase.storage.from("recordings").createSignedUrl(url, 3600);
            if (!cancelled && data?.signedUrl) {
              setSignedVideoUrls((prev) => ({ ...prev, [r.id]: { url: data.signedUrl, at: Date.now() } }));
            }
          }
        } catch {
          // ignore per-recording failures
        }
      }
    })();
    return () => { cancelled = true; };
  }, [recordings, appointment?.id, workspaceId, signedVideoUrls]);


  const handleFetchRecordings = useCallback(async (recoveryType: "transcription" | "recording" | "all") => {
    if (!appointment?.id) return;
    const setLoading = recoveryType === "transcription" ? setIsFetchingTranscription : setIsFetchingRecording;
    const label = recoveryType === "transcription" ? "transcrição" : "vídeo";
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-room", {
        body: { action: "fetch-recordings", appointment_id: appointment.id, recovery_type: recoveryType },
      });
      if (error) throw error;

      const jobId = data?.job_id;
      if (!jobId) throw new Error("Falha ao criar job de recuperação");

      detailToast({ title: "Recuperação iniciada", description: `A ${label} está sendo processada em segundo plano...` });

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const pollInterval = setInterval(async () => {
        try {
          const { data: statusData } = await supabase.functions.invoke("daily-room", {
            body: { action: "fetch-recordings-status", job_id: jobId },
          });
          if (statusData?.status === "completed") {
            clearInterval(pollInterval);
            if (timeoutId) clearTimeout(timeoutId);
            setLoading(false);
            detailToast({ title: `${label.charAt(0).toUpperCase() + label.slice(1)} recuperada`, description: "Processamento concluído." });
            detailQueryClient.invalidateQueries({ queryKey: ["daily-recordings", appointment.id] });

          } else if (statusData?.status === "failed") {
            clearInterval(pollInterval);
            if (timeoutId) clearTimeout(timeoutId);
            setLoading(false);
            detailToast({ variant: "destructive", title: `Erro ao recuperar ${label}`, description: statusData.error || "Falha no processamento" });
          }
        } catch {
          clearInterval(pollInterval);
          if (timeoutId) clearTimeout(timeoutId);
          setLoading(false);
        }
      }, 5000);

      timeoutId = setTimeout(() => {
        clearInterval(pollInterval);
        setLoading(false);
        detailToast({
          variant: "destructive",
          title: "Processamento demorado",
          description: "A recuperação está demorando mais que o esperado. Tente novamente em alguns minutos.",
        });
      }, 180000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      detailToast({ variant: "destructive", title: `Erro ao recuperar ${label}`, description: msg });
      setLoading(false);
    }
  }, [appointment?.id, detailToast, detailQueryClient]);



  if (!activity) return null;

  const statusBadge = getStatusBadge(activity.status);
  const scheduledDate = new Date(activity.scheduled_at);
  const meetingLink = appointment?.meeting_link || null;
  const meetingType = appointment?.meeting_type || null;
  const dailyRoomName = appointment?.daily_room_name || null;
  const isOnline = meetingType === "daily" || meetingType === "google_meet";
  const effectiveLink = meetingLink || (appointment?.id ? `${window.location.origin}/m/${appointment.id}` : (dailyRoomName ? `${window.location.origin}/meeting/${dailyRoomName}` : null));

  const playableRecordings = recordings.filter((r) => (r.status === "ready" || r.status === "external_link") && signedVideoUrls[r.id]?.url);
  const analysisRecordings = recordings.filter((r) => !!r.ai_analysis);
  const chatRecordings = recordings.filter((r) => r.chat_messages && r.chat_messages.length > 0);
  const transcriptionRecordings = recordings.filter((r) => !!r.transcription_text);
  const processingRecordings = recordings.filter((r) => r.status !== "ready" && r.status !== "external_link");
  const hasRecording = playableRecordings.length > 0;
  const hasTranscription = transcriptionRecordings.length > 0;
  const totalParts = recordings.length;
  const partLabel = (r: RecordingRow) => {
    if (totalParts <= 1) return "";
    const idx = recordings.findIndex((x) => x.id === r.id);
    return ` — Parte ${idx + 1}/${totalParts}`;
  };


  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={cn("glass-card border-border max-h-[90vh]", hasRecording || hasTranscription ? "sm:max-w-5xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {(() => { const Icon = getTypeIcon(activity.type); return <Icon className="h-5 w-5 text-primary" />; })()}
            Detalhes da atividade
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-3">
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Título</p>
            <p className="text-sm font-medium text-foreground">{activity.title}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Tipo</p>
              <div className="flex items-center gap-1.5">
                {(() => { const Icon = getTypeIcon(activity.type); return <Icon className="h-3.5 w-3.5 text-primary" />; })()}
                <span className="text-sm text-foreground">{getTypeLabel(activity.type)}</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
              {statusBadge ? (
                <Badge variant="outline" className={cn("text-[10px]", statusBadge.className)}>
                  {statusBadge.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                  Pendente
                </Badge>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Responsável</p>
            {isSuperAdmin ? (
              <Select
                value={activity.assigned_to ?? undefined}
                onValueChange={handleChangeAssignee}
                disabled={isSavingAssignee}
              >
                <SelectTrigger className="h-9 w-full sm:w-72 text-sm">
                  <SelectValue placeholder="Sem responsável definido" />
                </SelectTrigger>
                <SelectContent>
                  {assignableMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-foreground">
                {activity.assigned_to
                  ? (assigneeName ?? "Carregando...")
                  : "Sem responsável definido"}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Data e hora</p>
              <p className="text-sm text-foreground">
                {format(scheduledDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Duração</p>
              <p className="text-sm text-foreground">{activity.duration_minutes} min</p>
            </div>
          </div>
          {isOnline && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Reunião online</p>
              <p className="text-xs text-muted-foreground mb-1">
                {meetingType === "daily" ? "Daily.co" : meetingType === "google_meet" ? "Google Meet" : meetingType}
              </p>
              {effectiveLink ? (
                <a
                  href={effectiveLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
                  onClick={async (e) => {
                    if (effectiveLink.includes("/meeting/")) {
                      e.preventDefault();
                      const { data: { session } } = await supabase.auth.getSession();
                      const tokenParam = session?.access_token ? `?token=${session.access_token}` : "";
                      window.open(`${effectiveLink}${tokenParam}`, "_blank");
                    }
                  }}
                >
                  <Video className="h-3.5 w-3.5 shrink-0" />
                  {effectiveLink}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="text-xs text-warning italic">Link não disponível - verifique a configuração da API</p>
              )}
            </div>
          )}
          {meetingType === "daily" && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Acessos à sala</p>
              {roomAccessEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhum acesso registrado nesta sala</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {roomAccessEntries.length} {roomAccessEntries.length === 1 ? "acesso" : "acessos"} —{" "}
                    {roomAccessEntries.some((p) => p.isOwner) ? "anfitrião entrou" : "anfitrião não entrou"};{" "}
                    {roomAccessEntries.some((p) => !p.isOwner) ? "convidado entrou" : "convidado não entrou"}
                  </p>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {roomAccessEntries.map((p) => (
                      <div key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{p.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {p.isOwner ? "Anfitrião" : "Convidado"}
                            {p.inferred ? " — registro do agendamento" : ""}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {format(new Date(p.joinedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              )}
            </div>
          )}
          {activity.description && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Descrição</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{activity.description}</p>
            </div>
          )}
          {activity.type === "call" && activity.status === "pending" && (
            <div>
              <Button
                onClick={handleApi4comDial}
                disabled={isDialing || !leadContact?.phone}
                size="sm"
                className="gap-2"
              >
                {isDialing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Phone className="h-3.5 w-3.5" />
                )}
                {isDialing ? "Discando..." : "Ligar agora"}
              </Button>
              {!leadContact?.phone && (
                <p className="text-xs text-muted-foreground mt-1 italic">Contato sem telefone cadastrado.</p>
              )}
            </div>
          )}

          {activity.type === "call" && (
            <CallActivitySection activityId={activity.id} workspaceId={workspaceId} />
          )}

          {activity.completed_at && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Concluída em</p>
              <p className="text-sm text-foreground">
                {format(new Date(activity.completed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
          )}

          {/* AI Analysis Section */}
          {analysisRecordings.map((r) => (
            <div key={`ai-${r.id}`}>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                Análise IA{partLabel(r)}
              </p>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed prose prose-sm prose-invert max-w-none">
                  {r.ai_analysis}
                </div>
              </div>
            </div>
          ))}

          {/* Transcrição ao vivo, com os locutores identificados */}
          {transcriptChunks.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Transcrição da reunião
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1.5 text-xs"
                  onClick={() => copyToClipboard(transcriptChunks.map((c) => c.content).join("\n"), "Transcrição")}
                >
                  <Copy className="h-3 w-3" />
                  Copiar
                </Button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                {transcriptLines.map((line, idx) => (
                  <p key={idx} className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                    {line.speaker && (
                      <span className="font-semibold text-foreground">{line.speaker}: </span>
                    )}
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Chat da reunião */}
          {chatRecordings.map((r) => (
            <div key={`chat-${r.id}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Chat da reunião{partLabel(r)} ({r.chat_messages!.length})
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1.5 text-xs"
                  onClick={() =>
                    copyToClipboard(
                      r.chat_messages!.map((m) => `${m.fromName}: ${m.text}`).join("\n"),
                      "Conversa"
                    )
                  }
                >
                  <Copy className="h-3 w-3" />
                  Copiar
                </Button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                {r.chat_messages!.map((m, idx) => (
                  <div key={idx} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={
                          m.role === "host"
                            ? "text-xs font-semibold text-primary"
                            : "text-xs font-semibold text-foreground"
                        }
                      >
                        {m.fromName}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {(() => {
                          try {
                            return format(new Date(m.ts), "HH:mm", { locale: ptBR });
                          } catch {
                            return "";
                          }
                        })()}
                      </span>
                    </div>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {m.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}


          {/* Recording Section */}
          {hasRecording && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {playableRecordings.length > 1 ? `Gravações da reunião (${playableRecordings.length})` : "Gravação da reunião"}
              </p>
              {playableRecordings.map((r) => {
                const videoUrl = signedVideoUrls[r.id]?.url;
                return (
                  <div key={`video-${r.id}`}>
                    {totalParts > 1 && (
                      <p className="text-[11px] text-muted-foreground mb-1">Parte {recordings.findIndex((x) => x.id === r.id) + 1}/{totalParts}</p>
                    )}
                    {r.status === "external_link" ? (
                      <div className="flex flex-col items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
                        <p className="text-xs text-muted-foreground text-center">
                          Vídeo grande — disponível para visualização externa
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => {
                              const playerHtml = `<!DOCTYPE html><html><head><title>Gravação da reunião</title><style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh}video{max-width:100%;max-height:100vh}</style></head><body><video src="${videoUrl}" controls autoplay></video></body></html>`;
                              const blob = new Blob([playerHtml], { type: "text/html" });
                              window.open(URL.createObjectURL(blob), "_blank");
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                            Assistir vídeo
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            asChild
                          >
                            <a href={videoUrl} download="gravacao.mp4">
                              <Download className="h-4 w-4" />
                              Download
                            </a>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <video
                        src={videoUrl}
                        controls
                        className="w-full rounded-lg border border-border bg-black"
                        style={{ maxHeight: "300px" }}
                      />
                    )}
                    {r.duration_seconds && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Duração: {Math.floor(r.duration_seconds / 60)}min {r.duration_seconds % 60}s
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Avaliacao: escolher a analise e roda-la sobre a transcricao */}
          {activity && (
            <ActivityAnalysisSection
              activityId={activity.id}
              activityType={activity.type}
              workspaceId={workspaceId}
              analysisPlaybookId={activity.analysis_playbook_id ?? null}
              sources={
                transcriptionRecordings.length > 0
                  ? transcriptionRecordings.map((r) => ({
                      id: r.id,
                      sourceType: "daily_recording" as const,
                      label: partLabel(r),
                      hasAnalysis: !!r.ai_analysis,
                    }))
                  : // Sem arquivo do Daily, a transcrição ao vivo é a única cópia
                    transcriptChunks.length > 0 && appointment?.id
                    ? [
                        {
                          id: appointment.id,
                          sourceType: "meeting_chunks" as const,
                          label: "",
                          hasAnalysis: false,
                        },
                      ]
                    : []
              }
              onAnalyzed={() => {
                detailQueryClient.invalidateQueries({ queryKey: ["daily-recordings", appointment?.id] });
              }}
            />
          )}

          {/* Transcription Section - Collapsible, below AI Analysis */}
          {hasTranscription && (
            <Collapsible>
              <div className="flex items-center justify-between gap-2">
                <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left group">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {transcriptionRecordings.length > 1 ? `Transcrições (${transcriptionRecordings.length})` : "Transcrição"}
                  </p>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1.5 text-xs shrink-0"
                  onClick={() =>
                    copyToClipboard(
                      transcriptionRecordings.map((r) => r.transcription_text ?? "").join("\n\n"),
                      "Transcrição"
                    )
                  }
                >
                  <Copy className="h-3 w-3" />
                  Copiar
                </Button>
              </div>
              <CollapsibleContent>
                <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  {transcriptionRecordings.map((r) => (
                    <div key={`tr-${r.id}`}>
                      {totalParts > 1 && (
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">— Parte {recordings.findIndex((x) => x.id === r.id) + 1}/{totalParts} —</p>
                      )}
                      <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                        {r.transcription_text}
                      </pre>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Processing indicator */}
          {processingRecordings.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processando gravação/transcrição...

            </div>
          )}

          {/* Manual recovery button - always visible for Daily.co meetings */}
          {meetingType === "daily" && (
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFetchRecordings("transcription")}
                disabled={isFetchingTranscription}
                className="gap-2"
              >
                {isFetchingTranscription ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {isFetchingTranscription ? "Recuperando..." : "Recuperar transcrição"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFetchRecordings("recording")}
                disabled={isFetchingRecording}
                className="gap-2"
              >
                {isFetchingRecording ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isFetchingRecording ? "Recuperando..." : "Recuperar vídeo"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (!appointment?.id) return;
                  try {
                    const { data, error } = await supabase.functions.invoke("daily-room", {
                      body: { action: "debug-recordings", appointment_id: appointment.id },
                    });
                    if (error) throw error;
                    console.log("[debug-recordings]", data);
                    detailToast({
                      title: "Diagnóstico no console",
                      description: "Abra o console do navegador (F12) para ver o JSON completo.",
                    });
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    detailToast({ variant: "destructive", title: "Erro no diagnóstico", description: msg });
                  }
                }}
                className="gap-2"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Diagnosticar
              </Button>
            </div>
          )}
        </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
export function LeadActivities({ leadId, workspaceId, stages, lossReasons, onMoveLead, onMarkLost, initialActivityId }: LeadActivitiesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [newActivity, setNewActivity] = useState({
    type: "follow_up",
    title: "",
    description: "",
    scheduled_date: "",
    scheduled_time: "",
    duration_minutes: "30",
    is_online: false,
    meeting_platform: "daily" as "google_meet" | "daily",
    notify_attendees: true,
    // Análise de atendimento aplicada à transcrição desta atividade
    analysis_playbook_id: "",
  });
  const [editForm, setEditForm] = useState({
    type: "",
    title: "",
    description: "",
    scheduled_date: "",
    scheduled_time: "",
    duration_minutes: "30",
  });

  // State for meeting completion dialog (advance/lost)
  const [completeMeetingActivity, setCompleteMeetingActivity] = useState<Activity | null>(null);
  // State for no-show dialog (reagendar ou perdido)
  const [noShowActivity, setNoShowActivity] = useState<Activity | null>(null);
  const [viewActivity, setViewActivity] = useState<Activity | null>(null);
  // State for loss reason selection after meeting completion
  const [showLossReasonDialog, setShowLossReasonDialog] = useState(false);
  const [selectedLossReason, setSelectedLossReason] = useState("");

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["crm-activities", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_activities")
        .select("*")
        .eq("lead_id", leadId)
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      return data as Activity[];
    },
    enabled: !!leadId,
  });

  // Auto-open activity detail when deep-linked via ?activity= param
  useEffect(() => {
    if (!initialActivityId || !activities.length) return;
    const found = activities.find((a) => a.id === initialActivityId);
    if (found) setViewActivity(found);
  }, [initialActivityId, activities]);

  // Fire-and-forget: notify dnMarketing about activity events
  const notifyDn = useCallback(
    async (eventType: string, title: string, metadata: Record<string, unknown> = {}) => {
      try {
        const { data: lead } = await supabase
          .from("crm_leads")
          .select("contact_id")
          .eq("id", leadId)
          .maybeSingle();
        const contactId = (lead as { contact_id: string | null } | null)?.contact_id;
        if (!contactId) return;
        supabase.functions
          .invoke("dnmarketing-notify", {
            body: {
              contact_id: contactId,
              event_type: eventType,
              title,
              metadata: { lead_id: leadId, ...metadata },
            },
          })
          .then((r) => {
            if (r.error) console.error("[LeadActivities] dnmarketing-notify error:", r.error);
          });
      } catch (e) {
        console.error("[LeadActivities] notifyDn error:", e);
      }
    },
    [leadId]
  );

  const createActivity = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

      // Fetch lead assigned_to for activity assignment (so notification trigger has a recipient)
      const { data: leadRow } = await supabase
        .from("crm_leads")
        .select("assigned_to")
        .eq("id", leadId)
        .maybeSingle();
      const leadAssignedTo = (leadRow as { assigned_to: string | null } | null)?.assigned_to ?? null;
      const activityAssignedTo = leadAssignedTo ?? currentUserId ?? null;

      const scheduledAt = new Date(`${newActivity.scheduled_date}T${newActivity.scheduled_time}`);
      const durationMinutes = parseInt(newActivity.duration_minutes) || 30;
      const endTime = addMinutes(scheduledAt, durationMinutes);


      const isMeetingType = newActivity.type === "meeting" || newActivity.type === "demo" || newActivity.type === "reschedule";
      let createdAppointmentId: string | null = null;

      let googleCalendarSuccess = false;
      const emailsSent: string[] = [];
      let meetingLink: string | null = null;

      // 1. If meeting type, create appointment FIRST so we can link the activity via FK
      if (isMeetingType) {
        console.log("[LeadActivities] Meeting type detected, fetching CRM lead data...");
        
        // Fetch CRM lead data with contact info
        const { data: crmLead, error: leadError } = await supabase
          .from("crm_leads")
          .select(`
            id,
            contact_id,
            assigned_to,
            title,
            crm_contacts!crm_leads_contact_id_fkey (
              id,
              name,
              email
            )
          `)
          .eq("id", leadId)
          .single();

        if (leadError) {
          console.error("[LeadActivities] Error fetching CRM lead:", leadError);
        }

        if (crmLead) {
          const contact = crmLead.crm_contacts as { id: string; name: string; email: string | null } | null;
          const contactEmail = contact?.email || null;
          const contactName = contact?.name || "Cliente";

          // Fetch assignee info
          let assigneeName = "Equipe";
          let assigneeEmail: string | null = null;
          if (crmLead.assigned_to) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("name, email")
              .eq("id", crmLead.assigned_to)
              .single();
            if (profile) {
              assigneeName = profile.name || "Vendedor";
              assigneeEmail = profile.email;
            }
          }

          // Fetch creator info
          let creatorName: string | null = null;
          let creatorEmail: string | null = null;
          if (currentUserId) {
            const { data: creatorProfile } = await supabase
              .from("profiles")
              .select("name, email")
              .eq("id", currentUserId)
              .single();
            if (creatorProfile) {
              creatorName = creatorProfile.name;
              creatorEmail = creatorProfile.email;
            }
          }

          // Fetch company name + id
          let companyName = "Nossa Empresa";
          let companyId: string | null = null;
          const { data: workspace } = await supabase
            .from("workspaces")
            .select("company_id, companies(name)")
            .eq("id", workspaceId)
            .single();
          if (workspace?.company_id) companyId = workspace.company_id as string;
          if (workspace?.companies && typeof workspace.companies === 'object' && 'name' in workspace.companies) {
            companyName = (workspace.companies as { name: string }).name;
          }

          console.log("[LeadActivities] Creating appointment in crm_appointments...");

          const { data: appointment, error: appointmentError } = await supabase
            .from("crm_appointments")
            .insert({
              workspace_id: workspaceId,
              lead_id: leadId,
              contact_id: crmLead.contact_id,
              title: newActivity.title,
              description: newActivity.description || null,
              start_time: scheduledAt.toISOString(),
              end_time: endTime.toISOString(),
              duration_minutes: durationMinutes,
              assigned_to: crmLead.assigned_to,
              created_by: currentUserId,
              status: "scheduled",
              meeting_type: newActivity.is_online ? newActivity.meeting_platform : "presencial",
              // Redundante com a atividade: serve de fallback quando a avaliação
              // só encontra o appointment (ex.: criado pelo AppointmentDialog).
              analysis_playbook_id: newActivity.analysis_playbook_id || null,
            } as never)
            .select("id")
            .single();

          if (appointmentError) {
            console.error("[LeadActivities] Error creating appointment:", appointmentError);
          }

          // Fallback: if select didn't return data, query the appointment we just created
          let appointmentId = appointment?.id;
          if (!appointmentId && !appointmentError) {
            console.log("[LeadActivities] Appointment select returned null, querying by title+start_time...");
            const { data: fallbackAppt } = await supabase
              .from("crm_appointments")
              .select("id")
              .eq("lead_id", leadId)
              .eq("title", newActivity.title)
              .eq("start_time", scheduledAt.toISOString())
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            appointmentId = fallbackAppt?.id;
          }

          if (appointmentId) {
            createdAppointmentId = appointmentId;
            console.log("[LeadActivities] Appointment created:", appointmentId);

            // 3a. If Daily.co selected, create room first
            if (newActivity.is_online && newActivity.meeting_platform === "daily") {
              try {
                console.log("[LeadActivities] Creating Daily.co room...");
                const dailyResponse = await supabase.functions.invoke("daily-room", {
                  body: {
                    action: "create",
                    workspace_id: workspaceId,
                    appointment_id: appointmentId,
                    title: newActivity.title,
                  },
                });
                if (dailyResponse.data?.room_name) {
                  // Public meeting gate URL (decides host vs guest)
                  const baseUrl = window.location.origin;
                  meetingLink = `${baseUrl}/m/${appointmentId}`;
                  await supabase
                    .from("crm_appointments")
                    .update({ meeting_link: meetingLink })
                    .eq("id", appointmentId);
                  console.log("[LeadActivities] Daily.co room created:", dailyResponse.data.room_name);
                }
              } catch (e) {
                console.error("[LeadActivities] Error creating Daily.co room:", e);
              }
            }

            // 3b. Always try to create Google Calendar event
            {
              const calendarOwnerId = crmLead.assigned_to || currentUserId;
              try {
                console.log("[LeadActivities] Invoking google-calendar-create-event for calendar owner:", calendarOwnerId);
                
                const additionalAttendees: string[] = [];
                if (creatorEmail && currentUserId !== calendarOwnerId) {
                  additionalAttendees.push(creatorEmail);
                }

                const useGoogleMeet = !newActivity.is_online || newActivity.meeting_platform === "google_meet";

                const calendarResponse = await supabase.functions.invoke("google-calendar-create-event", {
                  body: {
                    workspace_id: workspaceId,
                    appointment_id: appointmentId,
                    title: newActivity.title,
                    description: newActivity.description 
                      ? (meetingLink && newActivity.meeting_platform === "daily"
                          ? `${newActivity.description}\n\nLink da reunião: ${meetingLink}`
                          : newActivity.description)
                      : (meetingLink && newActivity.meeting_platform === "daily"
                          ? `Link da reunião: ${meetingLink}`
                          : ""),
                    start_time: scheduledAt.toISOString(),
                    end_time: endTime.toISOString(),
                    attendee_email: contactEmail,
                    additional_attendees: additionalAttendees,
                    calendar_owner_id: calendarOwnerId,
                    create_meet_link: useGoogleMeet,
                    notify_attendees: newActivity.notify_attendees,
                  },
                });

                console.log("[LeadActivities] Google Calendar response:", calendarResponse);

                if (calendarResponse.data?.event_id) {
                  googleCalendarSuccess = true;
                  // Only use Google Meet link if that's the chosen platform
                  if (useGoogleMeet && calendarResponse.data?.meeting_link) {
                    meetingLink = calendarResponse.data.meeting_link;
                    await supabase
                      .from("crm_appointments")
                      .update({ meeting_link: meetingLink })
                      .eq("id", appointmentId);
                  }
                }
              } catch (e) {
                console.error("[LeadActivities] Error calling Google Calendar:", e);
              }
            }

            // 4. Send emails to all involved parties
            const emailRecipients: Array<{ email: string; name: string; recipientType: string }> = [];

            if (contactEmail) {
              emailRecipients.push({ email: contactEmail, name: contactName, recipientType: "contact" });
            }
            if (assigneeEmail && assigneeEmail !== contactEmail) {
              emailRecipients.push({ email: assigneeEmail, name: assigneeName, recipientType: "assignee" });
            }
            if (creatorEmail && creatorEmail !== assigneeEmail && creatorEmail !== contactEmail) {
              emailRecipients.push({ email: creatorEmail, name: creatorName || "Gestor", recipientType: "creator" });
            }

            const attendeesList = emailRecipients.map(r => ({
              name: r.name,
              email: r.email,
              role: r.recipientType as "contact" | "assignee" | "creator" | "guest"
            }));

            for (const recipient of emailRecipients) {
              try {
                console.log(`[LeadActivities] Sending email to ${recipient.recipientType}:`, recipient.email);
                const emailResponse = await supabase.functions.invoke("send-appointment-email", {
                  body: {
                    type: "confirmation",
                    email: recipient.email,
                    contactName: recipient.name,
                    recipientType: recipient.recipientType,
                    appointmentTitle: newActivity.title,
                    startTime: scheduledAt.toISOString(),
                    endTime: endTime.toISOString(),
                    meetingLink: meetingLink,
                    assigneeName: assigneeName,
                    companyName: companyName,
                    company_id: companyId,
                    leadName: contactName,
                    creatorName: creatorName,
                    attendees: attendeesList,
                  },
                });

                if (!emailResponse.error) {
                  emailsSent.push(recipient.recipientType);
                }
              } catch (e) {
                console.error(`[LeadActivities] Error sending email to ${recipient.recipientType}:`, e);
              }
            }

            // 5. Create reminders if integrations succeeded
            if (googleCalendarSuccess || emailsSent.length > 0) {
              console.log("[LeadActivities] Creating reminder for appointment...");
              await supabase.from("crm_appointment_reminders").insert({
                appointment_id: appointmentId,
                reminder_type: "email",
                scheduled_time: addMinutes(scheduledAt, -60).toISOString(),
                status: "pending",
              });
            }
          }
        }
      }

      // 2. Insert activity AFTER appointment so we can link via FK (appointment_id)
      const { error: activityError } = await supabase.from("crm_lead_activities").insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        appointment_id: createdAppointmentId,
        type: newActivity.type,
        title: newActivity.title,
        description: newActivity.description || null,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
        status: "pending",
        created_by: currentUserId,
        assigned_to: activityAssignedTo,
        analysis_playbook_id: newActivity.analysis_playbook_id || null,
      } as never);

      if (activityError) throw activityError;

      // dnMarketing notification (fire-and-forget)
      const baseMeta = {
        activity_type: newActivity.type,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
        appointment_id: createdAppointmentId,
        meeting_link: meetingLink,
        meeting_platform: newActivity.is_online ? newActivity.meeting_platform : null,
      };
      // activity_created é enviado pelo trigger no banco (notify_dnmarketing_on_activity_change)
      if (isMeetingType && createdAppointmentId) {
        const evt = newActivity.type === "reschedule" ? "meeting_rescheduled" : "meeting_scheduled";
        const evtTitle = newActivity.type === "reschedule"
          ? `Reunião reagendada — ${newActivity.title}`
          : `Reunião agendada — ${newActivity.title}`;
        notifyDn(evt, evtTitle, baseMeta);
      }

      return {
        isMeeting: isMeetingType,
        googleCalendarSuccess,
        emailsSent
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
      setIsOpen(false);
      setNewActivity({
        type: "follow_up",
        title: "",
        description: "",
        scheduled_date: "",
        scheduled_time: "",
        duration_minutes: "30",
        is_online: false,
        meeting_platform: "google_meet",
        notify_attendees: true,
        analysis_playbook_id: "",
      });

      if (data?.isMeeting) {
        const parts: string[] = [];
        if (data.googleCalendarSuccess) parts.push("evento no calendário");
        if (data.emailsSent?.length > 0) parts.push("email enviado");
        
        if (parts.length > 0) {
          toast({ title: `Reunião agendada! ${parts.join(" e ")}.` });
        } else {
          toast({ 
            title: "Reunião agendada!", 
            description: "Integrações não configuradas ou contato sem email." 
          });
        }
      } else {
        toast({ title: "Atividade criada" });
      }
    },
    onError: (error: Error) => {
      console.error("[LeadActivities] Error creating activity:", error);
      toast({ variant: "destructive", title: "Erro ao criar atividade" });
    },
  });

  const updateActivityStatus = useMutation({
    mutationFn: async ({ id, status, activity, noShowReason }: { id: string; status: string; activity?: Activity; noShowReason?: 'rescheduled' | 'reschedule_later' | 'no_show' | 'lost' }) => {
      const updatePayload: Record<string, unknown> = {
        status,
        completed_at: (status === "completed" || status === "no_show") ? new Date().toISOString() : null,
      };
      if (status === "no_show" && noShowReason) {
        updatePayload.no_show_reason = noShowReason;
      }
      const { error } = await supabase
        .from("crm_lead_activities")
        .update(updatePayload)
        .eq("id", id);
      if (error) throw error;

      // Libera o slot da agenda quando no-show é marcado com 30+ min de antecedência
      let freedSlot = false;
      let googleDeleteFailed = false;
      if (status === "no_show" && activity) {
        try {
          const { data: row } = await supabase
            .from("crm_lead_activities")
            .select("appointment_id")
            .eq("id", id)
            .maybeSingle();
          const appointmentId = (row as { appointment_id: string | null } | null)?.appointment_id;
          const result = await freeSlotForNoShow({
            appointmentId,
            scheduledAt: activity.scheduled_at,
            type: activity.type,
          });
          freedSlot = result.freed;
          googleDeleteFailed = !!result.googleDeleteFailed;
        } catch (e) {
          console.error("[LeadActivities] freeSlotForNoShow failed:", e);
        }
      }

      // dnMarketing notification (fire-and-forget)
      if (activity) {
        const meta = {
          activity_id: activity.id,
          activity_type: activity.type,
          scheduled_at: activity.scheduled_at,
          duration_minutes: activity.duration_minutes,
        };
        if (status === "completed") {
          notifyDn("activity_completed", `Atividade concluída — ${activity.title}`, meta);
        } else if (status === "no_show") {
          notifyDn("activity_no_show", `No-show — ${activity.title}`, meta);
        } else if (status === "cancelled") {
          notifyDn("activity_cancelled", `Atividade cancelada — ${activity.title}`, meta);
        }
      }

      return { freedSlot, googleDeleteFailed };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      if (result?.freedSlot) {
        queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
        if (result.googleDeleteFailed) {
          toast({
            variant: "destructive",
            title: "Horário liberado da agenda",
            description: "Falha ao remover do Google Calendar — verifique manualmente.",
          });
        } else {
          toast({
            title: "Horário liberado da agenda",
            description: "Agendamento e evento do Google Calendar removidos.",
          });
        }
      }
    },
  });

  // State for cancel confirmation
  const [cancelConfirmActivity, setCancelConfirmActivity] = useState<Activity | null>(null);
  const [deleteConfirmActivity, setDeleteConfirmActivity] = useState<Activity | null>(null);

  // Open edit dialog for non-meeting activities
  const openEditDialog = (activity: Activity) => {
    const scheduledDate = new Date(activity.scheduled_at);
    setEditForm({
      type: activity.type,
      title: activity.title,
      description: activity.description || "",
      scheduled_date: format(scheduledDate, "yyyy-MM-dd"),
      scheduled_time: format(scheduledDate, "HH:mm"),
      duration_minutes: String(activity.duration_minutes),
    });
    setEditingActivity(activity);
  };

  // Update activity mutation
  const updateActivity = useMutation({
    mutationFn: async () => {
      if (!editingActivity) return;
      
      const scheduledAt = new Date(`${editForm.scheduled_date}T${editForm.scheduled_time}`);
      const durationMinutes = parseInt(editForm.duration_minutes) || 30;
      
      const { error } = await supabase
        .from("crm_lead_activities")
        .update({
          type: editForm.type,
          title: editForm.title,
          description: editForm.description || null,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: durationMinutes,
        })
        .eq("id", editingActivity.id);
      
      if (error) throw error;

      // dnMarketing notification (fire-and-forget)
      notifyDn("activity_updated", `Atividade atualizada — ${editForm.title}`, {
        activity_id: editingActivity.id,
        activity_type: editForm.type,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: durationMinutes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      setEditingActivity(null);
      toast({ title: "Atividade atualizada" });
    },
    onError: (error: Error) => {
      console.error("[LeadActivities] Error updating activity:", error);
      toast({ variant: "destructive", title: "Erro ao atualizar atividade" });
    },
  });

  // Cancel meeting with full integrations (Google Calendar + Email)
  const cancelMeetingWithIntegrations = useMutation({
    mutationFn: async (activity: Activity) => {
      console.log("[LeadActivities] Cancelling meeting with integrations:", activity.id);
      
      const activityTime = new Date(activity.scheduled_at);
      const startRange = new Date(activityTime.getTime() - 60000).toISOString();
      const endRange = new Date(activityTime.getTime() + 60000).toISOString();
      
      const { data: appointment } = await supabase
        .from("crm_appointments")
        .select("id, google_event_id, assigned_to, title, start_time, contact_id")
        .eq("workspace_id", workspaceId)
        .gte("start_time", startRange)
        .lte("start_time", endRange)
        .in("status", ["scheduled", "confirmed"])
        .maybeSingle();
      
      let hadAppointment = false;
      let hadGoogleEvent = false;
      
      if (appointment) {
        console.log("[LeadActivities] Found appointment:", appointment.id);
        hadAppointment = true;
        hadGoogleEvent = !!appointment.google_event_id;
        
        if (appointment.google_event_id) {
          try {
            console.log("[LeadActivities] Calling schedule-appointment cancel action...");
            const { error: cancelError } = await supabase.functions.invoke("schedule-appointment", {
              body: {
                action: "cancel",
                lead_id: leadId,
                workspace_id: workspaceId,
                reason: "Cancelado manualmente pelo usuario"
              }
            });
            
            if (cancelError) {
              console.error("[LeadActivities] Error cancelling via edge function:", cancelError);
            }
          } catch (e) {
            console.error("[LeadActivities] Exception calling cancel:", e);
          }
        } else {
          await supabase
            .from("crm_appointments")
            .update({ status: "cancelled", notes: "Cancelado manualmente" })
            .eq("id", appointment.id);
        }
      }
      
      const { error } = await supabase
        .from("crm_lead_activities")
        .update({ status: "cancelled" })
        .eq("id", activity.id);
      
      if (error) throw error;

      // dnMarketing notification (fire-and-forget)
      notifyDn("activity_cancelled", `Atividade cancelada — ${activity.title}`, {
        activity_id: activity.id,
        activity_type: activity.type,
        scheduled_at: activity.scheduled_at,
        duration_minutes: activity.duration_minutes,
        had_appointment: hadAppointment,
      });

      return { hadAppointment, hadGoogleEvent };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
      setCancelConfirmActivity(null);
      
      if (data?.hadGoogleEvent) {
        toast({ 
          title: "Reunião cancelada", 
          description: "Evento removido do calendário e emails enviados" 
        });
      } else if (data?.hadAppointment) {
        toast({ title: "Reunião cancelada" });
      } else {
        toast({ title: "Atividade cancelada" });
      }
    },
    onError: (error: Error) => {
      console.error("[LeadActivities] Error cancelling:", error);
      setCancelConfirmActivity(null);
      toast({ variant: "destructive", title: "Erro ao cancelar" });
    },
  });

  // Delete activity + linked appointment (FK CASCADE will remove activity automatically)
  const deleteActivityWithCancel = useMutation({
    mutationFn: async (activity: Activity) => {
      console.log("[LeadActivities] Deleting activity + appointment:", activity.id);

      // 1. Get the activity with its appointment_id link
      const { data: activityRow } = await supabase
        .from("crm_lead_activities")
        .select("id, appointment_id")
        .eq("id", activity.id)
        .maybeSingle();

      const appointmentId = (activityRow as { appointment_id: string | null } | null)?.appointment_id;
      let googleDeleteFailed = false;
      let hadAppointment = false;

      if (appointmentId) {
        hadAppointment = true;
        // 2. Fetch appointment details to remove from Google Calendar if synced
        const { data: ap } = await supabase
          .from("crm_appointments")
          .select("id, workspace_id, assigned_to, google_event_id, is_synced_to_google")
          .eq("id", appointmentId)
          .maybeSingle();

        const apt = ap as {
          id: string;
          workspace_id: string;
          assigned_to: string | null;
          google_event_id: string | null;
          is_synced_to_google: boolean | null;
        } | null;

        if (apt?.google_event_id && apt?.is_synced_to_google) {
          try {
            const { data: gData, error: gErr } = await supabase.functions.invoke("google-calendar-delete-event", {
              body: {
                workspace_id: apt.workspace_id,
                appointment_id: apt.id,
                google_event_id: apt.google_event_id,
                calendar_owner_id: apt.assigned_to ?? undefined,
              },
            });
            if (gErr || (gData && gData.success === false)) {
              googleDeleteFailed = true;
              console.error("[LeadActivities] Google Calendar delete failed:", gErr || gData?.error);
            }
          } catch (e) {
            googleDeleteFailed = true;
            console.error("[LeadActivities] Exception calling google-calendar-delete-event:", e);
          }
        }

        // 3. DELETE appointment - FK CASCADE removes the linked activity automatically
        const { error: apDelErr } = await supabase
          .from("crm_appointments")
          .delete()
          .eq("id", apt!.id);
        if (apDelErr) throw apDelErr;
      } else {
        // No linked appointment - just delete the activity
        const { error } = await supabase
          .from("crm_lead_activities")
          .delete()
          .eq("id", activity.id);
        if (error) throw error;
      }

      // activity_deleted é enviado pelo trigger no banco (notify_dnmarketing_on_activity_change)

      return { hadAppointment, googleDeleteFailed };
    },
    onSuccess: ({ hadAppointment, googleDeleteFailed }) => {
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      setDeleteConfirmActivity(null);

      if (googleDeleteFailed) {
        toast({
          variant: "destructive",
          title: "Atividade e agendamento excluídos",
          description: "Erro ao remover do Google Calendar, mas o restante foi excluído.",
        });
      } else if (hadAppointment) {
        toast({ title: "Atividade e agendamento excluídos" });
      } else {
        toast({ title: "Atividade excluída" });
      }
    },
    onError: (error: Error) => {
      console.error("[LeadActivities] Error deleting activity:", error);
      setDeleteConfirmActivity(null);
      toast({ variant: "destructive", title: "Erro ao excluir atividade", description: error.message });
    },
  });

  const handleCheckClick = (activity: Activity) => {
    if (activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule") {
      // For meeting types, show advance/lost dialog
      setCompleteMeetingActivity(activity);
    } else {
      // For other types, just complete
      updateActivityStatus.mutate({ id: activity.id, status: "completed", activity });
      toast({ title: "Atividade concluida" });
    }
  };

  // Handle X button click (no-show dialog for meetings, cancel for others)
  const handleXClick = (activity: Activity) => {
    console.log("[LeadActivities] handleXClick called, type:", activity.type, "id:", activity.id);
    const isMeetingType = activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule";
    if (isMeetingType) {
      // Open no-show dialog with options
      setNoShowActivity(activity);
    } else {
      updateActivityStatus.mutate(
        { id: activity.id, status: "cancelled", activity },
        {
          onSuccess: () => {
            toast({ title: "Atividade cancelada" });
          },
          onError: (error: Error) => {
            console.error("[LeadActivities] cancel mutation error:", error);
            toast({ variant: "destructive", title: "Erro ao cancelar" });
          },
        }
      );
    }
  };

  // Handle no-show → reschedule
  const handleNoShowReschedule = () => {
    if (!noShowActivity) return;
    const activity = noShowActivity;
    const rescheduleData = {
      type: "reschedule" as const,
      title: `Reagendamento: ${activity.title}`,
      description: `Reagendamento devido a no-show em ${format(new Date(activity.scheduled_at), "dd/MM/yyyy", { locale: ptBR })}`,
      scheduled_date: "",
      scheduled_time: "",
      duration_minutes: String(activity.duration_minutes),
      is_online: false,
      meeting_platform: "google_meet" as const,
      notify_attendees: true,
      analysis_playbook_id: "",
    };
    updateActivityStatus.mutate(
      { id: activity.id, status: "no_show", activity, noShowReason: "rescheduled" },
      {
        onSuccess: () => {
          setNoShowActivity(null);
          toast({ title: "Marcado como no-show" });
          setNewActivity(rescheduleData);
          setIsOpen(true);
        },
        onError: () => {
          toast({ title: "Erro ao marcar no-show", description: "Tente novamente.", variant: "destructive" });
        },
      }
    );
  };
  // Handle no-show → reschedule later (just mark as no-show, no form)
  const handleNoShowRescheduleLater = () => {
    if (!noShowActivity) return;
    const activity = noShowActivity;
    updateActivityStatus.mutate(
      { id: activity.id, status: "no_show", activity, noShowReason: "reschedule_later" },
      {
        onSuccess: () => {
          setNoShowActivity(null);
          toast({ title: "Marcado como no-show", description: "Reagende quando possivel." });
        },
        onError: () => {
          toast({ title: "Erro ao marcar no-show", description: "Tente novamente.", variant: "destructive" });
        },
      }
    );
  };

  // Handle no-show → apenas registrar não comparecimento (sem reagendar nem perder)
  const handleNoShowJustRecord = () => {
    if (!noShowActivity) return;
    const activity = noShowActivity;
    updateActivityStatus.mutate(
      { id: activity.id, status: "no_show", activity, noShowReason: "no_show" },
      {
        onSuccess: () => {
          setNoShowActivity(null);
          toast({ title: "Registrado como não comparecimento" });
        },
        onError: () => {
          toast({ title: "Erro ao registrar", description: "Tente novamente.", variant: "destructive" });
        },
      }
    );
  };

  // Handle no-show → mark lost
  const handleNoShowMarkLost = () => {
    if (!noShowActivity) return;
    const activity = noShowActivity;
    updateActivityStatus.mutate(
      { id: activity.id, status: "no_show", activity, noShowReason: "lost" },
      {
        onSuccess: () => {
          setNoShowActivity(null);
          toast({ title: "Marcado como no-show" });
          setShowLossReasonDialog(true);
        },
        onError: () => {
          toast({ title: "Erro ao marcar no-show", description: "Tente novamente.", variant: "destructive" });
        },
      }
    );
  };

  // Handle advance to "Em negociação"
  const handleAdvanceToNegotiation = () => {
    if (!completeMeetingActivity) return;
    
    // Mark activity as completed
    updateActivityStatus.mutate({ id: completeMeetingActivity.id, status: "completed", activity: completeMeetingActivity });
    
    // Find "Em negociação" stage
    if (stages && onMoveLead) {
      const negotiationStage = stages.find(s => 
        s.name.toLowerCase().includes("negoci")
      );
      if (negotiationStage) {
        onMoveLead(negotiationStage.id, "Reunião realizada - avançando para negociação");
      }
    }
    
    setCompleteMeetingActivity(null);
    toast({ title: "Reunião concluída e lead avançado para Em negociação" });
  };

  // Handle mark as lost from meeting completion
  const handleMarkLostFromMeeting = () => {
    if (!completeMeetingActivity) return;
    
    // Mark activity as completed first
    updateActivityStatus.mutate({ id: completeMeetingActivity.id, status: "completed", activity: completeMeetingActivity });
    setCompleteMeetingActivity(null);
    
    // Open loss reason dialog
    setShowLossReasonDialog(true);
  };

  const handleConfirmLoss = () => {
    if (selectedLossReason && onMarkLost) {
      onMarkLost(selectedLossReason);
    }
    setShowLossReasonDialog(false);
    setSelectedLossReason("");
  };

  const pendingActivities = activities.filter(a => a.status === "pending");
  const historyActivities = activities.filter(a => a.status !== "pending");

  // Score da avaliacao ao lado do nome da reuniao, buscado em lote
  const { data: analysisScores } = useActivityAnalysisScores(activities.map((a) => a.id));

  // ----- Analise padrao do primeiro atendimento -----
  // O primeiro atendimento de cada tipo no card e sempre avaliado pelo playbook
  // padrao: sem isso, comparar vendedores dependeria de todos escolherem a mesma
  // analise na mao. A partir do segundo, a escolha volta a ser livre.
  const newActivityAnalysisType = activityTypeToAnalysisType(newActivity.type);
  const { data: analysisOptions } = useSelectableAnalysisPlaybooks(
    newActivityAnalysisType ?? undefined,
  );
  const defaultPlaybook = (analysisOptions ?? []).find((p) => p.is_default) ?? null;

  // Cancelada nao conta: o atendimento nao aconteceu. No-show conta porque a
  // reuniao foi realizada do lado do vendedor — a proxima ja nao e a primeira.
  const hasSameTypeAttended = activities.some(
    (a) =>
      (a.status === "completed" || a.status === "no_show") &&
      activityTypeToAnalysisType(a.type) === newActivityAnalysisType,
  );
  const lockAnalysisToDefault =
    !!newActivityAnalysisType && !!defaultPlaybook && !hasSameTypeAttended;

  // Reconcilia a analise sempre que o tipo muda com o dialog aberto. Sem isso o
  // playbook escolhido para uma reuniao ficaria pendurado numa tarefa, onde o
  // campo nem aparece — e o usuario nao teria como remove-lo.
  useEffect(() => {
    if (!isOpen) return;
    setNewActivity((current) => {
      if (!newActivityAnalysisType) {
        return current.analysis_playbook_id ? { ...current, analysis_playbook_id: "" } : current;
      }
      if (lockAnalysisToDefault && defaultPlaybook) {
        return current.analysis_playbook_id === defaultPlaybook.id
          ? current
          : { ...current, analysis_playbook_id: defaultPlaybook.id };
      }
      // Escolha livre: descarta analise que nao atende o tipo atual. Enquanto a
      // lista nao carregou nao ha como julgar, entao preserva.
      if (!analysisOptions || !current.analysis_playbook_id) return current;
      return analysisOptions.some((p) => p.id === current.analysis_playbook_id)
        ? current
        : { ...current, analysis_playbook_id: "" };
    });
  }, [isOpen, newActivityAnalysisType, lockAnalysisToDefault, defaultPlaybook, analysisOptions]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          Atividades
        </h4>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Nova
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-card border-border">
            <DialogHeader>
              <DialogTitle>Nova Atividade</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={newActivity.type}
                  onValueChange={(v) => setNewActivity({ ...newActivity, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activityTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <div className="flex items-center gap-2">
                          <t.icon className="h-4 w-4" />
                          {t.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  value={newActivity.title}
                  onChange={(e) => setNewActivity({ ...newActivity, title: e.target.value })}
                  placeholder="Ex: Reunião de apresentação"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Data *</Label>
                  <Input
                    type="date"
                    value={newActivity.scheduled_date}
                    onChange={(e) => setNewActivity({ ...newActivity, scheduled_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hora *</Label>
                  <Input
                    type="time"
                    value={newActivity.scheduled_time}
                    onChange={(e) => setNewActivity({ ...newActivity, scheduled_time: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Duração (minutos)</Label>
                <Select
                  value={newActivity.duration_minutes}
                  onValueChange={(v) => setNewActivity({ ...newActivity, duration_minutes: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="45">45 min</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="90">1h 30min</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <AnalysisPlaybookSelect
                activityType={newActivityAnalysisType}
                value={newActivity.analysis_playbook_id}
                onChange={(playbookId) => setNewActivity({ ...newActivity, analysis_playbook_id: playbookId })}
                disabled={lockAnalysisToDefault}
                description={
                  lockAnalysisToDefault
                    ? "Primeiro atendimento deste tipo no card — a análise padrão é aplicada automaticamente."
                    : undefined
                }
              />

              {/* Online meeting toggle - only for meeting/demo/reschedule */}
              {(newActivity.type === "meeting" || newActivity.type === "demo" || newActivity.type === "reschedule") && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="is-online" className="flex items-center gap-2 cursor-pointer">
                      <Video className="h-4 w-4 text-primary" />
                      Reunião online?
                    </Label>
                    <Switch
                      id="is-online"
                      checked={newActivity.is_online}
                      onCheckedChange={(checked) => setNewActivity({ ...newActivity, is_online: checked })}
                    />
                  </div>
                  {newActivity.is_online && (
                    <div className="space-y-2">
                      <Label>Plataforma</Label>
                      <Select
                        value={newActivity.meeting_platform}
                        onValueChange={(v) => setNewActivity({ ...newActivity, meeting_platform: v as "google_meet" | "daily" })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="google_meet">
                            <div className="flex items-center gap-2">
                              <Video className="h-4 w-4" />
                              Google Meet
                            </div>
                          </SelectItem>
                          <SelectItem value="daily">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4" />
                              Daily.co (Sala propria)
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="notify-attendees" className="flex items-center gap-2 cursor-pointer">
                  <Users className="h-4 w-4 text-primary" />
                  Notificar convidados por e-mail
                </Label>
                <Switch
                  id="notify-attendees"
                  checked={newActivity.notify_attendees}
                  onCheckedChange={(checked) => setNewActivity({ ...newActivity, notify_attendees: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={newActivity.description}
                  onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                  placeholder="Detalhes da atividade..."
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => createActivity.mutate()}
                  disabled={!newActivity.title || !newActivity.scheduled_date || !newActivity.scheduled_time || createActivity.isPending}
                >
                  Criar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Carregando...</div>
      ) : (
        <div className="space-y-2">
          {pendingActivities.length === 0 && historyActivities.length === 0 && (
            <p className="text-xs text-muted-foreground italic bg-background/50 p-2 rounded-lg">
              Nenhuma atividade agendada
            </p>
          )}

          {pendingActivities.map((activity) => {
            const Icon = getTypeIcon(activity.type);
            const scheduledDate = new Date(activity.scheduled_at);
            const isPast = scheduledDate < new Date();
            
            return (
              <div
                key={activity.id}
                className={cn(
                  "bg-background/50 p-2.5 rounded-lg space-y-1 border",
                  isPast ? "border-warning/30" : "border-transparent"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                    <button
                      type="button"
                      className="text-xs font-medium text-foreground hover:text-primary hover:underline cursor-pointer text-left"
                      onClick={() => setViewActivity(activity)}
                    >
                      {activity.title}
                    </button>
                    {analysisScores?.has(activity.id) && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 h-4 font-mono shrink-0",
                          scoreTextClass(analysisScores.get(activity.id)!),
                        )}
                        title="Score da avaliação de atendimento"
                      >
                        {analysisScores.get(activity.id)}/100
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <TooltipProvider delayDuration={300}>
                    {/* Edit button - only for non-meeting activities */}
                    {activity.type !== "meeting" && activity.type !== "demo" && activity.type !== "reschedule" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => openEditDialog(activity)}
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => handleCheckClick(activity)}
                        >
                          <Check className="h-3 w-3 text-success" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Concluir</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => handleXClick(activity)}
                          disabled={cancelMeetingWithIntegrations.isPending}
                        >
                          {cancelMeetingWithIntegrations.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule") ? (
                            <AlertTriangle className="h-3 w-3 text-warning" />
                          ) : (
                            <X className="h-3 w-3 text-destructive" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {(activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule") ? "No-show" : "Cancelar"}
                      </TooltipContent>
                    </Tooltip>
                    {(activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule") && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => setDeleteConfirmActivity(activity)}
                            disabled={deleteActivityWithCancel.isPending}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Excluir</TooltipContent>
                      </Tooltip>
                    )}
                    </TooltipProvider>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span className={isPast ? "text-warning" : ""}>
                    {format(scheduledDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <span>({activity.duration_minutes} min)</span>
                </div>
                {activity.description && (
                  <p className="text-[10px] text-muted-foreground">{activity.description}</p>
                )}
              </div>
            );
          })}

          {/* History - all non-pending activities */}
          {historyActivities.length > 0 && (
            <div className="pt-2">
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Histórico</p>
              {historyActivities.map((activity) => {
                const Icon = getTypeIcon(activity.type);
                const statusBadge = getStatusBadge(activity.status);
                return (
                  <div
                    key={activity.id}
                    className="bg-background/30 p-2 rounded-lg flex items-center gap-2 opacity-70 mb-1"
                  >
                    {activity.status === "completed" && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                    {activity.status === "cancelled" && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                    {activity.status === "no_show" && <AlertTriangle className="h-3 w-3 text-warning shrink-0" />}
                    <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground line-through flex-1 text-left hover:text-foreground hover:underline cursor-pointer"
                      onClick={() => setViewActivity(activity)}
                    >
                      {activity.title}
                    </button>
                    {analysisScores?.has(activity.id) && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[8px] px-1 py-0 h-4 font-mono",
                          scoreTextClass(analysisScores.get(activity.id)!),
                        )}
                        title="Score da avaliação de atendimento"
                      >
                        {analysisScores.get(activity.id)}/100
                      </Badge>
                    )}
                    {statusBadge && (
                      <Badge variant="outline" className={cn("text-[8px] px-1 py-0 h-4", statusBadge.className)}>
                        {statusBadge.label}
                      </Badge>
                    )}
                    {(activity.type === "meeting" || activity.type === "demo" || activity.type === "reschedule") && (
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 opacity-100"
                              onClick={() => setDeleteConfirmActivity(activity)}
                              disabled={deleteActivityWithCancel.isPending}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* No-show Dialog - Reagendar ou Perdido */}
      <Dialog open={!!noShowActivity} onOpenChange={(open) => { if (!open) setNoShowActivity(null); }}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              No-show detectado
            </DialogTitle>
            <DialogDescription>
              O cliente não compareceu. Como deseja prosseguir?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={handleNoShowReschedule}
              className="w-full justify-start gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Reagendar reunião
            </Button>
            <Button
              variant="outline"
              onClick={handleNoShowRescheduleLater}
              className="w-full justify-start gap-2"
            >
              <Clock className="h-4 w-4" />
              Reagendar depois
            </Button>
            <Button
              variant="outline"
              onClick={handleNoShowJustRecord}
              className="w-full justify-start gap-2"
            >
              <UserX className="h-4 w-4" />
              Não apareceu
            </Button>
            <Button
              variant="outline"
              onClick={handleNoShowMarkLost}
              className="w-full justify-start gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <XCircle className="h-4 w-4" />
              Marcar como Perdido
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoShowActivity(null)}>Voltar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meeting Completion Dialog - Advance or Lost */}
      <Dialog open={!!completeMeetingActivity} onOpenChange={(open) => { if (!open) setCompleteMeetingActivity(null); }}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Reunião realizada</DialogTitle>
            <DialogDescription>
              Como deseja prosseguir com este lead após a reunião?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button 
              onClick={handleAdvanceToNegotiation}
              className="w-full justify-start gap-2"
            >
              <ArrowRight className="h-4 w-4" />
              Avançar para Em negociação
            </Button>
            <Button 
              variant="outline"
              onClick={handleMarkLostFromMeeting}
              className="w-full justify-start gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <XCircle className="h-4 w-4" />
              Marcar como Perdido
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteMeetingActivity(null)}>Voltar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loss Reason Dialog */}
      <Dialog open={showLossReasonDialog} onOpenChange={setShowLossReasonDialog}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Motivo da perda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Select value={selectedLossReason} onValueChange={setSelectedLossReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo..." />
              </SelectTrigger>
              <SelectContent>
                {(lossReasons || []).map((reason) => (
                  <SelectItem key={reason.id} value={reason.id}>
                    {reason.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowLossReasonDialog(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={handleConfirmLoss}
                disabled={!selectedLossReason}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Confirmar perda
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Activity Dialog - Only for non-meeting activities */}
      <Dialog open={!!editingActivity} onOpenChange={(open) => !open && setEditingActivity(null)}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Editar Atividade</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activityTypes
                    .filter(t => t.value !== "meeting" && t.value !== "demo" && t.value !== "reschedule")
                    .map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <div className="flex items-center gap-2">
                          <t.icon className="h-4 w-4" />
                          {t.label}
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Ex: Follow-up por telefone"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={editForm.scheduled_date}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora *</Label>
                <Input
                  type="time"
                  value={editForm.scheduled_time}
                  onChange={(e) => setEditForm({ ...editForm, scheduled_time: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Duração (minutos)</Label>
              <Select
                value={editForm.duration_minutes}
                onValueChange={(v) => setEditForm({ ...editForm, duration_minutes: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="60">1 hora</SelectItem>
                  <SelectItem value="90">1h 30min</SelectItem>
                  <SelectItem value="120">2 horas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Detalhes da atividade..."
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingActivity(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => updateActivity.mutate()}
                disabled={!editForm.title || !editForm.scheduled_date || !editForm.scheduled_time || updateActivity.isPending}
              >
                {updateActivity.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Meeting Confirmation Dialog */}
      <Dialog open={!!cancelConfirmActivity} onOpenChange={(open) => { if (!open) setCancelConfirmActivity(null); }}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Cancelar Reunião</DialogTitle>
            <DialogDescription>
              Esta ação irá cancelar a reunião, remover o evento do Google Calendar 
              e enviar email de cancelamento para os participantes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelConfirmActivity(null)}>Voltar</Button>
            <Button 
              variant="destructive"
              onClick={() => {
                if (cancelConfirmActivity) {
                  cancelMeetingWithIntegrations.mutate(cancelConfirmActivity);
                }
              }}
              disabled={cancelMeetingWithIntegrations.isPending}
            >
              {cancelMeetingWithIntegrations.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelando...
                </>
              ) : (
                "Cancelar Reunião"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Activity Confirmation */}
      <AlertDialog open={!!deleteConfirmActivity} onOpenChange={(open) => { if (!open) setDeleteConfirmActivity(null); }}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir atividade</AlertDialogTitle>
            <AlertDialogDescription>
              A reunião associada será automaticamente cancelada. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmActivity) {
                  deleteActivityWithCancel.mutate(deleteConfirmActivity);
                }
              }}
              disabled={deleteActivityWithCancel.isPending}
            >
              {deleteActivityWithCancel.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activity Detail View Dialog */}
      <ActivityDetailDialog
        activity={viewActivity}
        leadId={leadId}
        workspaceId={workspaceId}
        onClose={() => setViewActivity(null)}
      />
    </div>
  );
}
