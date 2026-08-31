import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Anon key — usada para chamadas do lobby (convidado), bypassando a sessão
// global do Supabase que pode estar com refresh_token invalido em outra aba.
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// Race uma promise com timeout para evitar travamento infinito (ex.: sessao
// quebrada deixando invoke pendurado tentando renovar token).
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout apos ${ms}ms`)), ms),
    ),
  ]);
}

// Decodifica payload de um JWT sem validar assinatura (apenas para extrair
// claims já validados pelo backend Supabase no momento do invoke).
function decodeJwtPayload(token: string): { email?: string; user_metadata?: { name?: string; full_name?: string }; sub?: string; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Video, Users, Mail, User, AlertTriangle, FileText, CheckCircle2, X, Circle, Minus, Maximize2, Minimize2, Sparkles, Copy, Check, ChevronDown, Bot } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import DailyIframe, {
  type DailyCall,
  type DailyEvent,
  type DailyEventObjectAppMessage,
  type DailyEventObjectTranscriptionMessage,
} from "@daily-co/daily-js";

type TranscriptLine = {
  id: string;
  participantName: string;
  role: "host" | "guest";
  text: string;
  timestamp: string;
};

type MeetingInsight = {
  insight: string;
  suggested_reply: string;
  detected: string[];
  latency_ms?: number;
  model?: string;
};

type ActiveAgent = {
  id: string;
  name: string;
  source: "agents" | "agent_instances";
};

function InsightCard({
  loading,
  insight,
  agentName,
  onManual,
  activeAgents,
  selectedAgent,
  onAgentChange,
}: {
  loading: boolean;
  insight: MeetingInsight | null;
  agentName: string | null;
  onManual: () => void;
  activeAgents: ActiveAgent[];
  selectedAgent: ActiveAgent | null;
  onAgentChange: (agent: ActiveAgent) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!insight?.suggested_reply) return;
    try {
      await navigator.clipboard.writeText(insight.suggested_reply);
      setCopied(true);
      toast.success("Sugestão copiada");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  return (
    <div className="border-b border-gray-200 bg-primary/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-gradient flex-1">
          Insight do agente
          {agentName && (
            <span className="ml-1 text-gray-800 font-medium">· {agentName}</span>
          )}
        </span>
        <Button
          variant="default"
          size="sm"
          className="h-7 px-2.5 text-[11px] gap-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          onClick={onManual}
          disabled={loading}
          aria-label="Gerar insight agora"
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Gerando...
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              Gerar agora
            </>
          )}
        </Button>
      </div>

      {activeAgents.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 shrink-0">Assistente:</span>
          <Select
            value={selectedAgent?.id || ""}
            onValueChange={(val) => {
              const agent = activeAgents.find((a) => a.id === val);
              if (agent) onAgentChange(agent);
            }}
          >
            <SelectTrigger className="h-6 text-[11px] py-0 px-2 min-w-[140px] border-primary/20 bg-white/60">
              <SelectValue placeholder="Selecionar agente" />
            </SelectTrigger>
            <SelectContent className="text-xs">
              {activeAgents.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!insight && !loading && (
        <p className="text-[11px] text-gray-500 italic">
          Aguardando fala do convidado...
        </p>
      )}

      {insight && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-900 leading-snug">{insight.insight}</p>
          {insight.suggested_reply && (
            <div className="bg-white rounded-md p-2 border border-primary/20 shadow-sm space-y-1.5">
              <div className="flex items-start gap-2">
                <p className="text-xs text-gray-900 flex-1 leading-snug">
                  {insight.suggested_reply}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={handleCopy}
                  aria-label="Copiar sugestão"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingRoom() {
  const { roomName } = useParams<{ roomName: string }>();
  const [searchParams] = useSearchParams();
  const [stage, setStage] = useState<"loading" | "lobby" | "joining" | "meeting" | "ended">("loading");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dailyFrameUrl = useRef<string | null>(null);
  const hasTrackedJoin = useRef(false);
  const hasAutoJoined = useRef(false);
  const hasRequestedMediaStart = useRef(false);
  const autoJoinRunId = useRef(0);
  const workspaceIdRef = useRef<string | null>(null);
  const appointmentIdRef = useRef<string | null>(null);
  const chatMessagesRef = useRef<Array<{ from: string; fromName: string; role: "host" | "guest"; text: string; ts: string }>>([]);
  const chatDirtyRef = useRef(false);
  const chatFlushTimerRef = useRef<number | null>(null);
  const [transcriptionState, setTranscriptionState] = useState<"idle" | "starting" | "active" | "failed">("idle");
  const [recordingState, setRecordingState] = useState<"idle" | "starting" | "active" | "failed">("idle");
  const [mediaBannerDismissed, setMediaBannerDismissed] = useState(false);
  const [isManualStartingTranscription, setIsManualStartingTranscription] = useState(false);
  const [isManualStartingRecording, setIsManualStartingRecording] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [transcriptPanelState, setTranscriptPanelState] = useState<"minimized" | "normal" | "maximized">("normal");
  const [panelOffset, setPanelOffset] = useState<{ x: number; y: number }>({ x: 0, y: -100 });
  const panelOffsetRef = useRef(panelOffset);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    panelOffsetRef.current = panelOffset;
  }, [panelOffset]);

  useEffect(() => {
    if (!isDraggingPanel) return;
    const onMove = (e: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const nextOffset = {
        x: s.origX + (e.clientX - s.startX),
        y: s.origY + (e.clientY - s.startY),
      };
      panelOffsetRef.current = nextOffset;
      setPanelOffset(nextOffset);
    };
    const onUp = () => {
      dragStateRef.current = null;
      setIsDraggingPanel(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDraggingPanel]);

  const handlePanelDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    if (transcriptPanelState !== "normal") return;
    e.preventDefault();
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panelOffset.x,
      origY: panelOffset.y,
    };
    setIsDraggingPanel(true);
  };

  const [isHost, setIsHost] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Meeting insights (IA)
  const [insightsEnabled, setInsightsEnabled] = useState(false);
  const insightsEnabledRef = useRef(false);
  const autoInsightsEnabledRef = useRef(true);
  const autoInsightsDelayRef = useRef(4000);
  // Toggle local do host (efêmero — só vale nesta reunião)
  const [agentEnabledLocal, setAgentEnabledLocal] = useState(true);
  useEffect(() => {
    autoInsightsEnabledRef.current = agentEnabledLocal;
  }, [agentEnabledLocal]);
  useEffect(() => { insightsEnabledRef.current = insightsEnabled; }, [insightsEnabled]);
  // RAG: indexação de chunks da transcrição.
  // Fila de turnos ainda não indexados — mantida separada de `transcriptLines`,
  // que é truncada em 200 para exibição.
  const pendingTurnsRef = useRef<TranscriptLine[]>([]);
  const chunkIndexRef = useRef(0);
  const isIndexerRef = useRef(false);
  const CHUNK_TURN_SIZE = 8;

  const [latestInsight, setLatestInsight] = useState<{
    insight: string;
    suggested_reply: string;
    detected: string[];
    latency_ms?: number;
    model?: string;
  } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const insightDebounceRef = useRef<number | null>(null);
  const insightInflightRef = useRef(false);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<ActiveAgent | null>(null);

  const requestInsight = async (trigger: "auto" | "manual") => {
    const wsId = workspaceIdRef.current;
    if (!wsId || !insightsEnabledRef.current || insightInflightRef.current) return;
    const transcript = transcriptRef.current.slice(-40).map((l) => ({
      role: l.role,
      name: l.participantName,
      text: l.text,
      ts: l.timestamp,
    }));
    if (transcript.length === 0) return;

    insightInflightRef.current = true;
    setInsightLoading(true);
    console.log("[meeting-insights] → request", {
      trigger,
      transcript_size: transcript.length,
      last_turn: transcript[transcript.length - 1],
      agent: selectedAgent?.name,
    });
    try {
      const body: Record<string, unknown> = {
        workspace_id: wsId,
        meeting_id: roomName,
        transcript,
        trigger,
      };
      if (selectedAgent) {
        body.override_agent_id = selectedAgent.id;
        body.override_agent_source = selectedAgent.source;
      }
      const { data, error } = await supabase.functions.invoke(
        "meeting-insights",
        { body },
      );
      if (error) {
        console.error("[meeting-insights] ✗ error", error);
      } else if (data?.error) {
        console.warn("[meeting-insights] ✗ response error", data);
      } else {
        console.log("[meeting-insights] ← response", data);
        setLatestInsight(data);
      }
    } catch (e) {
      console.error("[meeting-insights] ✗ exception", e);
    } finally {
      insightInflightRef.current = false;
      setInsightLoading(false);
    }
  };

  // Generic helper: start transcription or recording with up to 3 attempts.
  // Retries only when backend marks the error as `retryable` (404 room-not-active
  // yet, or transient 5xx/network errors). Fires the 1st attempt almost immediately
  // (2s) so we don't lose the call if the host leaves quickly; retries at 5s/8s.
  const startMediaWithRetry = useCallback(
    async (
      action: "start-transcription" | "start-recording",
      wsId: string,
      room: string,
      setState: (s: "starting" | "active" | "failed") => void,
    ) => {
      const maxAttempts = 3;
      setState("starting");
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const delayMs = attempt === 1 ? 2000 : attempt === 2 ? 5000 : 8000;
        await new Promise((r) => setTimeout(r, delayMs));
        
        let res;
        try {
          res = await supabase.functions.invoke("daily-room", {
            body: { action, workspace_id: wsId, room_name: room },
          });
        } catch (invokeErr) {
          console.error(`[MeetingRoom] ${action} attempt ${attempt} invoke threw:`, invokeErr);
          if (attempt >= maxAttempts) {
            setState("failed");
            return;
          }
          continue;
        }
        const errMsg = res.error?.message || res.data?.error;
        if (!errMsg) {
          
          setState("active");
          return;
        }
        const errStr = String(errMsg).toLowerCase();
        const alreadyRunning =
          errStr.includes("already") ||
          errStr.includes("409") ||
          res.data?.status === 409;
        if (alreadyRunning) {
          
          setState("active");
          return;
        }
        const isRetryable = res.data?.retryable === true || res.data?.error === "room_not_active";
        
        if (!isRetryable || attempt >= maxAttempts) {
          console.error(`[MeetingRoom] ${action} gave up after ${attempt} attempt(s)`);
          setState("failed");
          return;
        }
      }
    },
    [],
  );

  // Auto-join via token na URL.
  //
  // IMPORTANTE: NÃO chamamos `supabase.auth.setSession` aqui — isso sobrescrevia
  // a sessão do client global (singleton com persistSession=true), destruindo a
  // autenticação do usuário em outras abas e gerando logout em massa quando o
  // auto-refresh falhava (o access_token passado como refresh_token é inválido).
  //
  // Em vez disso, decodificamos o JWT localmente para extrair nome/email do host
  // e passamos o token como header `Authorization: Bearer ...` explicitamente nas
  // chamadas a `daily-room`, preservando intacta a sessão do client global.
  useEffect(() => {
    if (!roomName) return;

    const runId = autoJoinRunId.current + 1;
    autoJoinRunId.current = runId;
    const urlToken = searchParams.get("token");

    const attemptAutoJoin = async (token: string, userName: string, userEmail: string, currentRunId: number) => {
      if (hasAutoJoined.current && dailyFrameUrl.current) return;
      hasAutoJoined.current = true;

      
      setIsHost(true);
      setGuestName(userName);
      setGuestEmail(userEmail);
      setStage("joining");

      try {
        const { data, error: fnError } = await withTimeout(
          supabase.functions.invoke("daily-room", {
            body: { action: "guest-token", room_name: roomName, user_name: userName, is_owner: true },
            headers: { Authorization: `Bearer ${token}` },
          }),
          15000,
          "host-guest-token",
        );

        

        if (currentRunId !== autoJoinRunId.current) return;

        if (fnError || !data?.token) {
          const msg = data?.message || data?.error || "Não foi possível obter acesso à reunião";
          throw new Error(msg);
        }

        const roomUrl = data?.room_url || `https://app.daily.co/${roomName}`;
        const joinUrl = new URL(roomUrl);
        joinUrl.searchParams.set("t", data.token);
        joinUrl.searchParams.set("lang", "pt-BR");
        dailyFrameUrl.current = joinUrl.toString();
        setStage("meeting");

        if (!hasTrackedJoin.current) {
          hasTrackedJoin.current = true;
          supabase.functions.invoke("daily-room", {
            body: { action: "update-status", room_name: roomName, event_type: "host-joined" },
            headers: { Authorization: `Bearer ${token}` },
          }).catch(console.error);

          workspaceIdRef.current = data?.workspace_id || null;
        }
      } catch (err: unknown) {
        console.error("[MeetingRoom] Auto-join error:", err);
        if (currentRunId === autoJoinRunId.current) {
          setError(err instanceof Error ? err.message : "Erro ao entrar na reunião");
          setStage("lobby");
          hasAutoJoined.current = false;
        }
      }
    };

    // Sem token na URL → sempre lobby (convidado).
    if (!urlToken) {
      
      setIsHost(false);
      setStage("lobby");
      return;
    }

    // Com token: decodifica o JWT para extrair identidade do host (sem mexer
    // na sessão global do Supabase) e dispara auto-join imediatamente.
    const payload = decodeJwtPayload(urlToken);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || (payload.exp && payload.exp < nowSec)) {
      
      setIsHost(false);
      setStage("lobby");
      return;
    }

    const email = payload.email || "";
    const userName =
      payload.user_metadata?.name ||
      payload.user_metadata?.full_name ||
      (email ? email.split("@")[0] : "Membro");

    attemptAutoJoin(urlToken, userName, email, runId);
  }, [roomName, searchParams, startMediaWithRetry]);

  // Carrega configurações de Insights da IA (somente Host, depois do join)
  const [insightSettingsLoaded, setInsightSettingsLoaded] = useState(false);
  const [insightAgentName, setInsightAgentName] = useState<string | null>(null);
  const [insightModel, setInsightModel] = useState<string | null>(null);
  useEffect(() => {
    if (stage !== "meeting" || !isHost || insightSettingsLoaded) return;
    const wsId = workspaceIdRef.current;
    if (!wsId) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("workspace_meeting_settings")
          .select("enabled, agent_id, agent_source, ai_model, auto_insights_enabled, auto_insights_delay_ms")
          .eq("workspace_id", wsId)
          .maybeSingle();
        if (error) {
          console.warn("[meeting-insights] settings error", error);
          return;
        }
        console.log("[meeting-insights] settings loaded", data);
        const enabled = !!(data?.enabled && data?.agent_id);
        setInsightsEnabled(enabled);
        const autoEnabled = data?.auto_insights_enabled ?? true;
        autoInsightsEnabledRef.current = autoEnabled;
        autoInsightsDelayRef.current = (data as { auto_insights_delay_ms?: number } | null)?.auto_insights_delay_ms ?? 4000;
        setAgentEnabledLocal(autoEnabled);
        setInsightModel(data?.ai_model || null);

        // Busca todos os agentes ativos do workspace
        const [legacyRes, instancesRes] = await Promise.all([
          supabase
            .from("agents")
            .select("id, name, is_active")
            .eq("workspace_id", wsId)
            .eq("is_archived", false),
          supabase
            .from("agent_instances")
            .select("id, name, is_active")
            .eq("workspace_id", wsId)
            .eq("is_archived", false),
        ]);
        const legacyAgents = (legacyRes.data || [])
          .filter((a) => a.is_active)
          .map((a) => ({ id: a.id, name: a.name, source: "agents" as const }));
        const instanceAgents = (instancesRes.data || [])
          .filter((a) => a.is_active)
          .map((a) => ({ id: a.id, name: a.name, source: "agent_instances" as const }));
        const allActive = [...legacyAgents, ...instanceAgents];
        setActiveAgents(allActive);

        if (enabled && data?.agent_id) {
          const table = data.agent_source === "agent_instances" ? "agent_instances" : "agents";
          const { data: ag } = await supabase
            .from(table)
            .select("name")
            .eq("id", data.agent_id)
            .maybeSingle();
          setInsightAgentName(ag?.name || null);
          const defaultAgent = allActive.find(
            (a) => a.id === data.agent_id && a.source === (data.agent_source || "agents")
          );
          if (defaultAgent) {
            setSelectedAgent(defaultAgent);
          } else if (allActive.length > 0) {
            setSelectedAgent(allActive[0]);
            setInsightAgentName(allActive[0].name);
          }
        } else if (allActive.length > 0) {
          setSelectedAgent(allActive[0]);
          setInsightAgentName(allActive[0].name);
        }
      } finally {
        setInsightSettingsLoaded(true);
      }
    })();
  }, [stage, isHost, insightSettingsLoaded]);




  // Lookup contact email for auto-fill
  const handleEmailBlur = useCallback(async () => {
    if (!guestEmail || !roomName || guestName) return;
    setIsLookingUp(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("daily-room", {
        body: { action: "lookup-contact", room_name: roomName, email: guestEmail },
      });
      if (!fnError && data?.match && data?.name) {
        setGuestName(data.name);
      }
    } catch {
      // silently fail
    } finally {
      setIsLookingUp(false);
    }
  }, [guestEmail, roomName, guestName]);

  // Join the meeting (guest flow)
  const handleJoin = async () => {
    if (!roomName || !guestName.trim() || !guestEmail.trim()) return;
    setStage("joining");
    setError(null);

    // Header explicito com anon key: evita que o supabase-js fique pendurado
    // tentando renovar uma sessao quebrada (refresh_token_not_found) de outra aba.
    const anonHeaders = { Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

    try {
      // 1) Fallback do webhook: registra a entrada do convidado no backend
      //    ANTES de obter o token, garantindo que o card vá para SQL mesmo
      //    se o webhook do Daily estiver indisponível. Não bloqueia entrada
      //    em caso de falha de rede — apenas loga.
      try {
        const validateRes = await withTimeout(
          supabase.functions.invoke("daily-room", {
            body: {
              action: "validate-guest",
              room_name: roomName,
              email: guestEmail.trim(),
              name: guestName.trim(),
            },
            headers: anonHeaders,
          }),
          12000,
          "validate-guest",
        );
        if (validateRes.error) {
          
          await new Promise((r) => setTimeout(r, 1000));
          await withTimeout(
            supabase.functions.invoke("daily-room", {
              body: {
                action: "validate-guest",
                room_name: roomName,
                email: guestEmail.trim(),
                name: guestName.trim(),
              },
              headers: anonHeaders,
            }),
            12000,
            "validate-guest-retry",
          );
        }
      } catch (vErr) {
        console.warn("[meeting] validate-guest falhou", vErr);
      }

      // 2) Obtém o token de acesso à sala
      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke("daily-room", {
          body: { action: "guest-token", room_name: roomName, user_name: guestName.trim() },
          headers: anonHeaders,
        }),
        15000,
        "guest-token",
      );
      if (fnError || !data?.token) {
        const msg = data?.message || data?.error || "Não foi possível obter acesso à reunião";
        throw new Error(msg);
      }

      const roomUrl = data?.room_url || `https://app.daily.co/${roomName}`;
      const joinUrl = new URL(roomUrl);
      joinUrl.searchParams.set("t", data.token);
      joinUrl.searchParams.set("lang", "pt-BR");
      dailyFrameUrl.current = joinUrl.toString();
      hasTrackedJoin.current = true;
      setStage("meeting");

      workspaceIdRef.current = data?.workspace_id || null;
    } catch (err: unknown) {
      console.error("[MeetingRoom] Error joining:", err);
      setError(err instanceof Error ? err.message : "Erro ao entrar na reunião");
      setStage("lobby");
    }
  };

  // Listen for meeting end + recording/transcription state via iframe postMessage.
  // Daily prebuilt emite eventos como `recording-started`, `transcription-started`,
  // que sinalizam que a mídia já está ativa — mesmo que tenha sido disparada por
  // outra aba, outro participante, ou pelo botão da própria UI do Daily.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const action = event.data?.action || event.data?.type;
      if (action === "left-meeting") {
        console.error("[MeetingRoom][meeting-close] left-meeting (postMessage)", {
          roomName,
          stage,
          ts: new Date().toISOString(),
          eventData: event.data,
        });
        setStage("ended");
      } else if (action === "recording-started") {
        setRecordingState("active");
      } else if (action === "transcription-started") {
        setTranscriptionState("active");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [roomName, stage]);


  // Auto-dismiss banner verde "Gravação e transcrição ativas" após 4s
  useEffect(() => {
    if (transcriptionState === "active" && recordingState === "active" && !mediaBannerDismissed) {
      const t = setTimeout(() => setMediaBannerDismissed(true), 4000);
      return () => clearTimeout(t);
    }
  }, [transcriptionState, recordingState, mediaBannerDismissed]);

  // Helper: determina se erro do Daily significa "já está rodando" (idempotente)
  const isAlreadyRunningError = (res: { error?: { message?: string } | null; data?: { error?: string; status?: number } | null }): boolean => {
    const msg = res.error?.message || res.data?.error;
    if (!msg) return false;
    const s = String(msg).toLowerCase();
    return s.includes("already") || s.includes("409") || res.data?.status === 409;
  };

  // Manual start handlers (when auto-start failed after 3 retries)
  const handleManualStartTranscription = useCallback(async () => {
    if (!roomName || !workspaceIdRef.current) return;
    setIsManualStartingTranscription(true);
    try {
      const res = await supabase.functions.invoke("daily-room", {
        body: { action: "start-transcription", workspace_id: workspaceIdRef.current, room_name: roomName },
      });
      if (!res.error && !res.data?.error) {
        setTranscriptionState("active");
      } else if (isAlreadyRunningError(res)) {
        
        setTranscriptionState("active");
      } else {
        console.error("[MeetingRoom] Manual transcription start failed:", res.error?.message || res.data?.error);
        setTranscriptionState("failed");
      }
    } catch (err) {
      console.error("[MeetingRoom] Manual transcription error:", err);
      setTranscriptionState("failed");
    } finally {
      setIsManualStartingTranscription(false);
    }
  }, [roomName]);

  const handleManualStartRecording = useCallback(async () => {
    if (!roomName || !workspaceIdRef.current) return;
    setIsManualStartingRecording(true);
    try {
      const res = await supabase.functions.invoke("daily-room", {
        body: { action: "start-recording", workspace_id: workspaceIdRef.current, room_name: roomName },
      });
      if (!res.error && !res.data?.error) {
        setRecordingState("active");
      } else if (isAlreadyRunningError(res)) {
        
        setRecordingState("active");
      } else {
        console.error("[MeetingRoom] Manual recording start failed:", res.error?.message || res.data?.error);
        setRecordingState("failed");
      }
    } catch (err) {
      console.error("[MeetingRoom] Manual recording error:", err);
      setRecordingState("failed");
    } finally {
      setIsManualStartingRecording(false);
    }
  }, [roomName]);

  // Container para o iframe do Daily criado via SDK (necessário para o
  // botão de Picture-in-Picture nativo do Daily Prebuilt funcionar
  // sem desmontar o iframe).
  const dailyContainerRef = useRef<HTMLDivElement>(null);
  const dailyCallRef = useRef<DailyCall | null>(null);

  // Resolve appointment_id a partir do roomName (daily_room_name) e persiste o
  // chat lateral da reunião em daily_recordings.chat_messages.
  const resolveAppointmentId = useCallback(async (): Promise<string | null> => {
    if (appointmentIdRef.current) return appointmentIdRef.current;
    if (!roomName) return null;
    try {
      const { data, error } = await supabase
        .from("crm_appointments")
        .select("id")
        .eq("daily_room_name", roomName)
        .maybeSingle();
      if (error) {
        console.warn("[meeting-chat] resolveAppointmentId error", error);
        return null;
      }
      appointmentIdRef.current = data?.id ?? null;
      return appointmentIdRef.current;
    } catch (err) {
      console.warn("[meeting-chat] resolveAppointmentId exception", err);
      return null;
    }
  }, [roomName]);

  const flushChatMessages = useCallback(async () => {
    if (!chatDirtyRef.current) return;
    const wsId = workspaceIdRef.current;
    const apptId = await resolveAppointmentId();
    if (!wsId || !apptId) return;
    const local = chatMessagesRef.current;
    try {
      // Cada cliente só recebe as mensagens dos OUTROS participantes — o Daily não
      // entrega app-message ao próprio remetente. Gravar o array local por cima
      // apagaria o que os demais já tinham registrado, deixando a conversa pela
      // metade. Por isso unimos com o que está no banco antes de gravar.
      const { data: existing } = await supabase
        .from("daily_recordings")
        .select("chat_messages, status")
        .eq("appointment_id", apptId)
        .maybeSingle();

      const remote = Array.isArray(existing?.chat_messages)
        ? (existing.chat_messages as typeof local)
        : [];

      const porChave = new Map<string, (typeof local)[number]>();
      for (const m of [...remote, ...local]) {
        if (!m?.text) continue;
        porChave.set(`${m.from}|${m.ts}|${m.text}`, m);
      }
      const merged = [...porChave.values()].sort((a, b) => a.ts.localeCompare(b.ts));

      // Só marca chat_only ao criar a linha: um flush tardio não pode rebaixar o
      // status de uma gravação que já foi processada.
      const { error } = await supabase.from("daily_recordings").upsert(
        {
          appointment_id: apptId,
          workspace_id: wsId,
          chat_messages: merged,
          status: existing?.status ?? "chat_only",
        },
        { onConflict: "appointment_id", ignoreDuplicates: false },
      );
      if (error) {
        console.warn("[meeting-chat] upsert error", error);
        return;
      }
      chatDirtyRef.current = false;
      console.log("[meeting-chat] flushed", merged.length, "messages", `(${local.length} locais)`);
    } catch (err) {
      console.warn("[meeting-chat] flush exception", err);
    }
  }, [resolveAppointmentId]);


  // Monta/desmonta o Daily call frame quando entramos no stage "meeting".
  useEffect(() => {
    if (stage !== "meeting" || !dailyFrameUrl.current || !dailyContainerRef.current) {
      return;
    }
    if (dailyCallRef.current) return;

    try {
      // Usamos wrap() para criar o iframe manualmente e definir `allow`
      // antes do Daily Prebuilt carregar. No createFrame(), alterar `allow`
      // depois pode ser tarde demais para o browser liberar o PiP.
      const iframeEl = document.createElement("iframe");
      iframeEl.allow =
        "camera; microphone; fullscreen; display-capture; autoplay; picture-in-picture";
      iframeEl.style.position = "absolute";
      iframeEl.style.inset = "0";
      iframeEl.style.width = "100%";
      iframeEl.style.height = "100%";
      iframeEl.style.border = "0";
      iframeEl.title = "Reunião Daily";
      dailyContainerRef.current.replaceChildren(iframeEl);

      const call = DailyIframe.wrap(iframeEl, {
        url: dailyFrameUrl.current,
        showLeaveButton: true,
      });
      dailyCallRef.current = call;

      call.on("left-meeting", (ev?: unknown) => {
        console.error("[MeetingRoom][meeting-close] left-meeting (sdk)", {
          roomName,
          stage,
          ts: new Date().toISOString(),
          ev,
        });
        // Flush final do chat antes de encerrar
        flushChatMessages().catch(() => {});
        setStage("ended");
      });

      // Captura mensagens do chat lateral do Daily Prebuilt (via sendAppMessage)
      call.on("app-message" as DailyEvent, (ev: DailyEventObjectAppMessage<Record<string, unknown> | string>) => {
        try {
          // O Daily retransmite a transcricao ao vivo por este mesmo canal, marcando a
          // origem como "transcription". Sem esse filtro, a transcricao inteira era
          // gravada em daily_recordings.chat_messages como se fosse chat digitado — e
          // sem identificacao de locutor, ja que nao ha participante com esse session_id.
          // A transcricao tem seu proprio destino: meeting_transcript_chunks.
          const origem = (ev as unknown as { fromId?: string; from?: string })?.fromId
            ?? (ev as unknown as { from?: string })?.from;
          if (origem === "transcription") return;

          // Formato confirmado em teste real: o chat do Prebuilt chega com
          // event = "chat-msg" e as chaves { event, date, message, name, room }.
          // Os demais ramos cobrem variacoes historicas do payload.
          const data = ev?.data as Record<string, unknown> | string | undefined;
          let text: string | null = null;
          if (data && typeof data === "object") {
            const msg = data.message as unknown;
            if (data.event === "chat-msg" && msg) {
              if (typeof msg === "string") {
                text = msg;
              } else if (typeof msg === "object") {
                const m = msg as Record<string, unknown>;
                text = (typeof m.message === "string" ? m.message : null)
                  ?? (typeof m.text === "string" ? m.text : null);
              }
            } else if (typeof msg === "string") {
              text = msg;
            } else if (typeof data.text === "string") {
              text = data.text;
            }
          } else if (typeof data === "string") {
            text = data;
          }

          if (!text || !text.trim()) return;

          const evAny = ev as unknown as { fromId?: string; from?: string };
          const fromSession: string = evAny?.fromId || evAny?.from || "unknown";
          const participants = call.participants();
          const p = Object.values(participants || {}).find(
            (x) => x?.session_id === fromSession,
          );
          const dataObj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
          const fromName: string =
            (typeof dataObj.name === "string" ? dataObj.name : null) ||
            (typeof dataObj.fromName === "string" ? dataObj.fromName : null) ||
            p?.user_name ||
            "Participante";
          const role: "host" | "guest" = p?.owner ? "host" : "guest";

          chatMessagesRef.current = [
            ...chatMessagesRef.current,
            {
              from: fromSession,
              fromName,
              role,
              text: text.trim(),
              ts: new Date().toISOString(),
            },
          ];
          chatDirtyRef.current = true;
          console.log("[meeting-chat] captured", { fromName, role, text });
        } catch (err) {
          console.warn("[meeting-chat] app-message handler error", err);
        }
      });
      // Eventos do servidor Daily: room expired, ejection, etc. Antes silenciosos.
      // deno-lint-ignore no-explicit-any
      call.on("error" as DailyEvent, (ev: unknown) => {
        console.error("[MeetingRoom][meeting-close-risk] daily-error", { roomName, ev });
      });
      // deno-lint-ignore no-explicit-any
      call.on("nonfatal-error" as DailyEvent, (ev: unknown) => {
        console.error("[MeetingRoom][meeting-close-risk] daily-nonfatal-error", { roomName, ev });
      });
      call.on("recording-started", () => setRecordingState("active"));
      call.on("transcription-started", () => setTranscriptionState("active"));

      // Eleição determinística do indexador: apenas 1 host por reunião faz a
      // vetorização. Ordenado por session_id (ascendente). Re-eleito a cada
      // mudança de participantes para sobreviver à saída do indexador atual.
      const syncIndexerCursor = async () => {
        if (!roomName) return;
        try {
          const { data, error } = await supabase
            .from("meeting_transcript_chunks")
            .select("chunk_index")
            .eq("meeting_id", roomName)
            .order("chunk_index", { ascending: false })
            .limit(1);
          if (error) {
            console.warn("[meeting-transcript-index] cursor sync error", error);
            return;
          }
          const maxIdx = data?.[0]?.chunk_index;
          if (typeof maxIdx === "number") {
            chunkIndexRef.current = maxIdx + 1;
          }
          // Abre mão de re-indexar turnos anteriores à promoção; só indexa daqui pra frente.
          pendingTurnsRef.current = [];
        } catch (err) {
          console.warn("[meeting-transcript-index] cursor sync exception", err);
        }
      };

      const recomputeIndexer = () => {
        try {
          const participants = call.participants();
          const local = participants?.local;
          if (!local) return;
          const owners = Object.values(participants || {})
            // deno-lint-ignore no-explicit-any
            .filter((p) => p?.owner === true && p?.session_id);
          if (owners.length === 0) {
            isIndexerRef.current = false;
            return;
          }
          // deno-lint-ignore no-explicit-any
          const sorted = owners.sort((a, b) =>
            String(a.session_id).localeCompare(String(b.session_id)),
          );
          // deno-lint-ignore no-explicit-any
          const electedSessionId = sorted[0].session_id;
          const wasIndexer = isIndexerRef.current;
          const isLocalIndexer = local.owner === true && local.session_id === electedSessionId;
          isIndexerRef.current = isLocalIndexer;
          if (!wasIndexer && isLocalIndexer) {
            console.log("[meeting-transcript-index] elected as indexer", {
              meeting_id: roomName,
              localSessionId: local.session_id,
              electedSessionId,
            });
            // Promovido agora — sincroniza cursor antes de indexar
            void syncIndexerCursor();
          } else if (wasIndexer !== isLocalIndexer) {
            console.log("[meeting-transcript-index] indexer changed", {
              meeting_id: roomName,
              localSessionId: local.session_id,
              electedSessionId,
              isLocalIndexer,
            });
          }
        } catch (err) {
          console.warn("[meeting-transcript-index] recomputeIndexer error", err);
        }
      };

      call.on("participant-joined", recomputeIndexer);
      call.on("participant-updated", recomputeIndexer);
      call.on("participant-left", recomputeIndexer);

      call.on("transcription-message", (ev: DailyEventObjectTranscriptionMessage) => {

        if (!ev?.text) return;
        const participants = call.participants();
        const p = Object.values(participants || {}).find(
          (x) => x?.session_id === ev.participantId,
        );
        const name = p?.user_name || "Participante";
        const role: "host" | "guest" = p?.owner ? "host" : "guest";
        setTranscriptLines((prev) => {
          const newLine: TranscriptLine = {
            id: `${String(ev.timestamp)}-${ev.participantId}-${prev.length}`,
            participantName: name,
            role,
            text: ev.text,
            timestamp: ev.timestamp instanceof Date ? ev.timestamp.toISOString() : String(ev.timestamp),
          };
          const next = [...prev, newLine].slice(-200);
          transcriptRef.current = next;
          console.log("[meeting-insights] transcript chunk", { role, name, text: ev.text });

          // RAG: indexa chunk a cada CHUNK_TURN_SIZE turnos — apenas o host eleito indexa.
          //
          // A fila de pendentes e mantida separada de `next`: a lista de exibicao e
          // truncada em 200 (.slice(-200) acima), e a versao anterior indexava por
          // indice dentro dela. Quando a lista saturava, o indice ja valia 200 e a
          // diferenca nunca mais alcancava CHUNK_TURN_SIZE — a indexacao parava de vez
          // no turno 200, truncando a transcricao de reunioes longas.
          const wsIdForIndex = workspaceIdRef.current;
          if (isIndexerRef.current && wsIdForIndex && roomName) {
            pendingTurnsRef.current.push(newLine);

            while (pendingTurnsRef.current.length >= CHUNK_TURN_SIZE) {
              const chunkTurns = pendingTurnsRef.current.splice(0, CHUNK_TURN_SIZE);
              const content = chunkTurns
                .map((t) => `${t.participantName}: ${t.text}`)
                .join("\n");
              const speakers = Array.from(new Set(chunkTurns.map((t) => t.participantName)));
              const start_ts = chunkTurns[0].timestamp;
              const end_ts = chunkTurns[chunkTurns.length - 1].timestamp;
              const chunk_index = chunkIndexRef.current++;
              // fire-and-forget
              supabase.functions
                .invoke("meeting-transcript-index", {
                  body: {
                    workspace_id: wsIdForIndex,
                    meeting_id: roomName,
                    chunk_index,
                    start_ts,
                    end_ts,
                    speakers,
                    content,
                  },
                })
                .then(({ error }) => {
                  if (error) console.warn("[meeting-transcript-index] error", error);
                  else console.log("[meeting-transcript-index] indexed chunk", chunk_index);
                });
            }
          }


          // Debounce de 4s; só dispara se último turno foi do guest
          if (insightsEnabledRef.current && autoInsightsEnabledRef.current && role === "guest") {
            if (insightDebounceRef.current) window.clearTimeout(insightDebounceRef.current);
            insightDebounceRef.current = window.setTimeout(() => {
              const last = transcriptRef.current[transcriptRef.current.length - 1];
              if (last?.role === "guest") requestInsight("auto");
            }, autoInsightsDelayRef.current);
          }
          return next;
        });
      });
      call.on("joined-meeting", () => {
        recomputeIndexer();
        if (hasRequestedMediaStart.current) return;
        hasRequestedMediaStart.current = true;
        const wsId = workspaceIdRef.current;
        if (wsId && roomName) {
          startMediaWithRetry("start-transcription", wsId, roomName, setTranscriptionState);
          startMediaWithRetry("start-recording", wsId, roomName, setRecordingState);
        }
      });

      call.join().catch((err) => {
        console.error("[MeetingRoom][meeting-close-risk] daily-join-error", { roomName, err });
        setError("Não foi possível entrar na reunião");
      });

      // Flush periódico do chat — resiliente a fechamento abrupto. O flush final
      // (left-meeting e unmount) é fire-and-forget e pode não completar quando a aba
      // fecha, então o intervalo curto é o que limita a perda nesse caso.
      if (chatFlushTimerRef.current) window.clearInterval(chatFlushTimerRef.current);
      chatFlushTimerRef.current = window.setInterval(() => {
        flushChatMessages().catch(() => {});
      }, 5000);
    } catch (err) {
      console.error("[MeetingRoom][meeting-close-risk] createFrame-error", { roomName, err });
    }


    return () => {
      if (chatFlushTimerRef.current) {
        window.clearInterval(chatFlushTimerRef.current);
        chatFlushTimerRef.current = null;
      }
      // Flush final antes de desmontar
      flushChatMessages().catch(() => {});

      const call = dailyCallRef.current;
      dailyCallRef.current = null;
      if (call) {
        console.error("[MeetingRoom][meeting-close] cleanup (effect re-run / unmount)", {
          roomName,
          stage,
          ts: new Date().toISOString(),
        });
        try {
          call.destroy();
        } catch (err) {
          console.error("[MeetingRoom][meeting-close-risk] destroy-error", { roomName, err });
        }
      }
      dailyContainerRef.current?.replaceChildren();
    };

  }, [roomName, stage, startMediaWithRetry, flushChatMessages]);

  // Auto-scroll do painel de transcrição quando chegam novas linhas,
  // mas apenas se o usuário já estiver perto do final (stick-to-bottom).
  const transcriptStickToBottomRef = useRef(true);
  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    transcriptStickToBottomRef.current = distanceFromBottom < 40;
  }, []);
  useEffect(() => {
    if (transcriptPanelState === "minimized") return;
    if (!transcriptStickToBottomRef.current) return;
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcriptLines.length, transcriptPanelState]);




  if (stage === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (stage === "ended") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardContent className="pt-6 text-center space-y-4">
            <Video className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Reunião encerrada</h2>
            <p className="text-muted-foreground">Obrigado por participar!</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stage === "meeting" && dailyFrameUrl.current) {
    const anyFailed = (transcriptionState === "failed" || recordingState === "failed") && !mediaBannerDismissed;
    const bothActive =
      transcriptionState === "active" && recordingState === "active" && !mediaBannerDismissed;
    return (
      <div className="h-screen w-screen bg-background relative">
        {anyFailed && (
          <div className="absolute top-0 left-0 right-0 z-50 bg-warning/95 backdrop-blur-sm border-b border-warning/40 px-4 py-2.5 flex items-center gap-3 shadow-lg animate-fade-in">
            <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warning-foreground truncate">
                {transcriptionState === "failed" && recordingState === "failed"
                  ? "Transcrição e gravação automáticas não puderam ser iniciadas."
                  : transcriptionState === "failed"
                  ? "A transcrição automática não pôde ser iniciada."
                  : "A gravação automática não pôde ser iniciada."}
              </p>
              <p className="text-xs text-warning-foreground/80 truncate">
                Clique nos botões ao lado para tentar manualmente.
              </p>
            </div>
            {transcriptionState === "failed" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleManualStartTranscription}
                disabled={isManualStartingTranscription}
                className="gap-2 shrink-0"
              >
                {isManualStartingTranscription ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {isManualStartingTranscription ? "Iniciando..." : "Iniciar transcrição"}
              </Button>
            )}
            {recordingState === "failed" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleManualStartRecording}
                disabled={isManualStartingRecording}
                className="gap-2 shrink-0"
              >
                {isManualStartingRecording ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Circle className="h-3.5 w-3.5 fill-current" />
                )}
                {isManualStartingRecording ? "Iniciando..." : "Iniciar gravação"}
              </Button>
            )}
            <button
              onClick={() => setMediaBannerDismissed(true)}
              className="text-warning-foreground/70 hover:text-warning-foreground shrink-0"
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {bothActive && (
          <div className="absolute top-0 left-0 right-0 z-50 bg-success/90 backdrop-blur-sm border-b border-success/40 px-4 py-2 flex items-center gap-3 shadow-lg animate-fade-in">
            <CheckCircle2 className="h-4 w-4 text-success-foreground shrink-0" />
            <p className="text-sm text-success-foreground flex-1">
              Gravação e transcrição ativas — a reunião está sendo registrada.
            </p>
            <button
              onClick={() => setMediaBannerDismissed(true)}
              className="text-success-foreground/70 hover:text-success-foreground shrink-0"
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div ref={dailyContainerRef} className="relative w-full h-full" />

        {/* Painel de transcrição ao vivo — apenas para Host */}
        {isHost && insightsEnabled && (
          <>
            {isDraggingPanel && (
              <div className="fixed inset-0 z-30" style={{ cursor: "move" }} aria-hidden />
            )}
            {transcriptPanelState === "minimized" ? (
              <button
                onClick={() => setTranscriptPanelState("normal")}
                className="fixed bottom-4 right-4 z-40 bg-white flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 hover:border-primary/50 transition-colors shadow-lg animate-fade-in"
                aria-label="Abrir assistente"
              >
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm text-gray-900">Assistente</span>
                {transcriptLines.length > 0 && (
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {transcriptLines.length}
                  </span>
                )}
              </button>
            ) : (
              <div
                className={
                  transcriptPanelState === "maximized"
                    ? "fixed inset-4 md:inset-8 z-40 bg-white shadow-xl border border-gray-200 rounded-xl flex flex-col animate-fade-in"
                    : "fixed bottom-4 right-4 z-40 bg-white shadow-xl border border-gray-200 rounded-xl flex flex-col w-[380px] max-w-[calc(100vw-2rem)] h-[590px] max-h-[calc(100vh-2rem)]"
                }
                style={
                  transcriptPanelState === "normal"
                    ? { transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)` }
                    : undefined
                }
              >
                <div
                  className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 cursor-move select-none touch-none"
                  onPointerDown={handlePanelDragStart}
                >
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="text-sm font-medium text-gray-900 flex-1 truncate">
                    Assistente
                  </h3>
                  {isHost && insightsEnabled && (
                    <div
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 border border-gray-300 shrink-0"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      title={agentEnabledLocal ? "Assistente ativo — gera insights automáticos" : "Assistente pausado — economiza tokens"}
                    >
                      <Bot className={`h-3.5 w-3.5 ${agentEnabledLocal ? "text-primary" : "text-gray-500"}`} />
                      <Switch
                        checked={agentEnabledLocal}
                        onCheckedChange={setAgentEnabledLocal}
                        className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span[data-state=checked]]:translate-x-4 data-[state=unchecked]:bg-gray-300 data-[state=checked]:bg-primary"
                        aria-label="Ativar assistente"
                      />
                    </div>
                  )}
                  {transcriptionState === "active" && (
                    <span className="status-active text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide">
                      Ao vivo
                    </span>
                  )}
                  {transcriptionState === "starting" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  )}
                  {transcriptPanelState === "maximized" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                      onClick={() => setTranscriptPanelState("normal")}
                      aria-label="Restaurar painel"
                    >
                      <Minimize2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                      onClick={() => setTranscriptPanelState("maximized")}
                      aria-label="Maximizar painel"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                    onClick={() => setTranscriptPanelState("minimized")}
                    aria-label="Minimizar painel"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>

                </div>

                {insightsEnabled && (
                  <InsightCard
                    loading={insightLoading}
                    insight={latestInsight}
                    agentName={insightAgentName}
                    onManual={() => requestInsight("manual")}
                    activeAgents={activeAgents}
                    selectedAgent={selectedAgent}
                    onAgentChange={(agent) => {
                      setSelectedAgent(agent);
                      setLatestInsight(null);
                      requestInsight("manual");
                    }}
                  />
                )}



                <div
                  ref={transcriptScrollRef}
                  onScroll={handleTranscriptScroll}
                  className="flex-1 overflow-y-auto p-3 space-y-3"
                >
                  {transcriptLines.length === 0 ? (
                    <p className="text-xs text-gray-500 italic text-center py-8">
                      {transcriptionState === "failed"
                        ? "Transcrição indisponível."
                        : transcriptionState === "active"
                        ? "Aguardando primeira fala..."
                        : "Aguardando transcrição..."}
                    </p>
                  ) : (
                    transcriptLines.map((line) => {
                      const time = (() => {
                        try {
                          return new Date(line.timestamp).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                        } catch {
                          return "";
                        }
                      })();
                      return (
                        <div key={line.id} className="space-y-0.5">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-sm font-medium text-primary">
                              {line.participantName}
                            </span>
                            <span
                              className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                line.role === "host"
                                  ? "bg-primary/15 text-primary border border-primary/30"
                                  : "bg-gray-100 text-gray-500 border border-gray-200"
                              }`}
                            >
                              {line.role === "host" ? "Host" : "Guest"}
                            </span>
                            {time && (
                              <span className="text-[10px] font-mono text-gray-500">
                                {time}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-900 break-words">{line.text}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">Entrar na Reunião</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Preencha seus dados para participar
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="guest-email" className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Email
            </Label>
            <Input
              id="guest-email"
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              onBlur={handleEmailBlur}
              placeholder="seu@email.com"
              disabled={stage === "joining"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="guest-name" className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              Nome
              {isLookingUp && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </Label>
            <Input
              id="guest-name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Seu nome completo"
              disabled={stage === "joining"}
            />
          </div>

          <Button
            onClick={handleJoin}
            disabled={!guestName.trim() || !guestEmail.trim() || stage === "joining"}
            className="w-full"
            size="lg"
          >
            {stage === "joining" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Entrando...
              </>
            ) : (
              <>
                <Video className="h-4 w-4 mr-2" />
                Entrar na reunião
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
