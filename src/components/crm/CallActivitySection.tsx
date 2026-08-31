import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, RefreshCw, FileText, Brain, AlertTriangle, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CallRow {
  id: string;
  status: string;
  duration_seconds: number | null;
  hangup_cause: string | null;
  call_outcome_label: string | null;
  record_url: string | null;
  transcription_status: string | null;
  transcription_text: string | null;
  ai_analysis: Record<string, unknown> | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  workspace_id: string;
}

interface CallActivitySectionProps {
  activityId: string;
  workspaceId: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "completed": return { label: "Concluida", className: "bg-success/20 text-success border-success/30" };
    case "no_answer": return { label: "Nao atendida", className: "bg-warning/20 text-warning border-warning/30" };
    case "busy": return { label: "Ocupado", className: "bg-warning/20 text-warning border-warning/30" };
    case "failed": return { label: "Falhou", className: "bg-destructive/20 text-destructive border-destructive/30" };
    case "cancelled": return { label: "Cancelada", className: "bg-muted text-muted-foreground border-border" };
    case "ringing": return { label: "Chamando", className: "bg-primary/20 text-primary border-primary/30" };
    case "initiated": return { label: "Iniciada", className: "bg-primary/20 text-primary border-primary/30" };
    case "answered": return { label: "Em curso", className: "bg-primary/20 text-primary border-primary/30" };
    default: return { label: status, className: "bg-muted text-muted-foreground border-border" };
  }
}

function formatDuration(s: number | null | undefined) {
  const sec = Math.max(0, Math.round(s || 0));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "-"; }
}

interface CallItemProps {
  call: CallRow;
  workspaceId: string;
  defaultOpen?: boolean;
  index: number;
  total: number;
}

function CallItem({ call, workspaceId, defaultOpen, index, total }: CallItemProps) {
  const { toast } = useToast();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);
  const [aiText, setAiText] = useState<string | undefined>((call.ai_analysis as { text?: string } | null)?.text);
  const [transcriptionStatus, setTranscriptionStatus] = useState(call.transcription_status);
  const [transcriptionText, setTranscriptionText] = useState(call.transcription_text);
  const hasPlayableRecording = Boolean(
    call.record_url && (call.status === "completed" || call.answered_at || (call.duration_seconds ?? 0) > 0)
  );

  useEffect(() => {
    setAiText((call.ai_analysis as { text?: string } | null)?.text);
    setTranscriptionStatus(call.transcription_status);
    setTranscriptionText(call.transcription_text);
  }, [call.ai_analysis, call.transcription_status, call.transcription_text]);

  const buildAudioUrl = useCallback(async (): Promise<string | null> => {
    const session = (await supabase.auth.getSession()).data.session;
    const base = (import.meta as { env: { VITE_SUPABASE_URL?: string } }).env.VITE_SUPABASE_URL || "";
    const url = `${base}/functions/v1/api4com-audio-proxy?call_id=${call.id}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
    if (r.status === 204) return null;
    if (!r.ok) return null;
    const contentType = r.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return null;
    const blob = await r.blob();
    if (!blob.size) return null;
    return URL.createObjectURL(blob);
  }, [call.id]);

  useEffect(() => {
    let cancelled = false;
    if (open && hasPlayableRecording && !audioUrl) {
      buildAudioUrl()
        .then((u) => { if (u && !cancelled) setAudioUrl(u); })
        .catch(() => { if (!cancelled) setAudioUrl(null); });
    }
    return () => { cancelled = true; };
  }, [open, hasPlayableRecording, audioUrl, buildAudioUrl]);

  // Revoke blob URL only when component unmounts or URL changes
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  const handleRetryTranscription = async () => {
    setIsReprocessing(true);
    try {
      const { error } = await supabase.functions.invoke("api4com-transcribe", { body: { call_id: call.id } });
      if (error) throw error;
      toast({ title: "Transcricao reiniciada" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const { error } = await supabase.functions.invoke("api4com-analyze-call", { body: { call_id: call.id, workspace_id: workspaceId } });
      if (error) throw error;
      toast({ title: "Analise concluida" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sb = statusBadge(call.status);
  const attemptNumber = total - index;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card/50">
      <CollapsibleTrigger className="w-full flex items-center gap-2 p-2 hover:bg-muted/30 transition-colors">
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">#{attemptNumber}</Badge>
        <Badge variant="outline" className={`text-[10px] ${sb.className}`}>{sb.label}</Badge>
        <span className="text-[11px] text-muted-foreground">{formatDateTime(call.started_at)}</span>
        <span className="text-xs text-muted-foreground ml-auto font-mono">{formatDuration(call.duration_seconds)}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3 pt-2 space-y-3 border-t border-border">
        {call.status !== "completed" && (
          <div className="flex items-start gap-2 p-2 rounded-lg border border-warning/30 bg-warning/10 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Chamada nao concluida{call.hangup_cause ? ` (${call.hangup_cause})` : ""}.</span>
          </div>
        )}

        {hasPlayableRecording && audioUrl && (
          <audio
            controls
            src={audioUrl}
            className="w-full"
            preload="auto"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              // Workaround para MP3 via blob: duracao chega como Infinity.
              // Forca o calculo seekando para o fim e voltando ao inicio.
              if (!isFinite(el.duration) || el.duration === 0) {
                const onTimeUpdate = () => {
                  el.currentTime = 0;
                  el.removeEventListener("timeupdate", onTimeUpdate);
                };
                el.addEventListener("timeupdate", onTimeUpdate);
                el.currentTime = 1e10;
              }
            }}
          />
        )}

        {hasPlayableRecording && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Transcrição</p>
              <Badge variant="outline" className="text-[10px]">{transcriptionStatus || "pending"}</Badge>
              {call.record_url && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={handleRetryTranscription} disabled={isReprocessing}>
                  {isReprocessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Reprocessar
                </Button>
              )}
            </div>
            {transcriptionText ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-xs text-foreground whitespace-pre-wrap">{transcriptionText}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sem transcrição.</p>
            )}
          </div>
        )}

        {hasPlayableRecording && transcriptionText && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Analise IA</p>
              {!aiText && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={handleAnalyze} disabled={isAnalyzing}>
                  {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                  Analisar
                </Button>
              )}
            </div>
            {aiText ? (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{aiText}</div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Clique em Analisar para gerar insights.</p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CallActivitySection({ activityId, workspaceId }: CallActivitySectionProps) {
  const [calls, setCalls] = useState<CallRow[]>([]);

  const loadCalls = useCallback(async () => {
    const { data } = await supabase
      .from("calls")
      .select("id, status, duration_seconds, hangup_cause, call_outcome_label, record_url, transcription_status, transcription_text, ai_analysis, started_at, answered_at, ended_at, workspace_id")
      .eq("activity_id", activityId)
      .order("started_at", { ascending: false });
    setCalls((data as unknown as CallRow[]) || []);
  }, [activityId]);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  useEffect(() => {
    const channel = supabase
      .channel(`calls-activity-${activityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `activity_id=eq.${activityId}` }, () => {
        loadCalls();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activityId, loadCalls]);

  if (calls.length === 0) return null;

  return (
    <div className="space-y-3 pt-2 border-t border-border">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Chamadas {calls.length > 1 && <span className="ml-1 normal-case">({calls.length} tentativas)</span>}
        </p>
      </div>

      <div className="space-y-2">
        {calls.map((c, i) => (
          <CallItem key={c.id} call={c} workspaceId={workspaceId} defaultOpen={i === 0} index={i} total={calls.length} />
        ))}
      </div>
    </div>
  );
}
