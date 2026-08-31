import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, MessageSquare, Video, Phone, FileText, Info } from "lucide-react";

/** Estrutura gravada em crm_lead_psychology.sources_used pela edge function. */
/** Origem do conteúdo da atividade, na ordem da cascata da edge function. */
export type TranscriptSource =
  | "call_transcription"
  | "recording_transcription"
  | "live_transcription"
  | "live_transcription+meeting_chat"
  | "meeting_chat"
  | "none";

export interface DNIASourceActivity {
  activity_id: string;
  title: string | null;
  date: string | null;
  status: string | null;
  has_transcript: boolean;
  transcript_source?: TranscriptSource;
  has_ai_analysis: boolean;
  has_notes?: boolean;
  transcript_chars: number;
  omitted: boolean;
}

const sourceBadge: Record<TranscriptSource, { label: string; className: string } | null> = {
  call_transcription: { label: "com transcrição", className: "badge-success" },
  recording_transcription: { label: "com transcrição", className: "badge-success" },
  live_transcription: { label: "transcrição ao vivo", className: "badge-success" },
  "live_transcription+meeting_chat": { label: "transcrição + chat", className: "badge-success" },
  meeting_chat: { label: "chat da reunião", className: "badge-accent" },
  none: null,
};

export interface DNIASourcesUsed {
  chat: {
    message_count: number;
    lead_message_count: number;
    first_at: string | null;
    last_at: string | null;
    capped: boolean;
  };
  meetings: DNIASourceActivity[];
  calls: DNIASourceActivity[];
  notes: { present: boolean; chars: number };
}

interface DNIASourcesCardProps {
  sourcesUsed: DNIASourcesUsed | null;
  leadId: string | undefined;
  /** Id do lead na tabela `leads` (contact.lead_id) — usado só no fallback. */
  inboxLeadId: string | null | undefined;
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "sem data";

function EmptyRow({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground/60">{label}</p>;
}

function ActivityRow({ item }: { item: DNIASourceActivity }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs text-foreground leading-relaxed">
        {item.title || "(sem título)"}
        <span className="text-muted-foreground"> — {formatDate(item.date)}</span>
      </p>
      <div className="flex shrink-0 gap-1">
        {item.omitted ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 badge-warning">
            omitida por limite
          </Badge>
        ) : item.has_transcript ? (
          (() => {
            const badge = sourceBadge[item.transcript_source ?? "recording_transcription"];
            return (
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badge?.className ?? "badge-success"}`}>
                {badge?.label ?? "com transcrição"}
              </Badge>
            );
          })()
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 badge-neutral">
            sem transcrição
          </Badge>
        )}
      </div>
    </div>
  );
}

function SourceSection({
  icon: Icon,
  title,
  isEmpty,
  children,
}: {
  icon: typeof MessageSquare;
  title: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${isEmpty ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
      </div>
      <div className="pl-5 space-y-1">{children}</div>
    </div>
  );
}

/**
 * Fontes de contexto que alimentaram a análise DNIA.
 *
 * Quando a análise é anterior à coluna `sources_used`, o card estima as fontes a partir dos
 * dados atuais do lead e sinaliza isso explicitamente — os dados de hoje podem incluir
 * material que surgiu depois da análise.
 */
export function DNIASourcesCard({ sourcesUsed, leadId, inboxLeadId }: DNIASourcesCardProps) {
  const isEstimated = !sourcesUsed;

  const { data: fallback } = useQuery({
    queryKey: ["dnia-sources-fallback", leadId, inboxLeadId],
    queryFn: async (): Promise<DNIASourcesUsed> => {
      const empty: DNIASourcesUsed = {
        chat: { message_count: 0, lead_message_count: 0, first_at: null, last_at: null, capped: false },
        meetings: [],
        calls: [],
        notes: { present: false, chars: 0 },
      };

      if (inboxLeadId) {
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", inboxLeadId);
        empty.chat.message_count = count || 0;
        empty.chat.capped = (count || 0) >= 100;
      }

      const { data: leadRow } = await supabase
        .from("crm_leads")
        .select("notes")
        .eq("id", leadId!)
        .maybeSingle();
      const notes = (leadRow?.notes || "").trim();
      empty.notes = { present: notes.length > 0, chars: notes.length };

      const { data: activities } = await supabase
        .from("crm_lead_activities")
        .select("id, title, scheduled_at, status, last_call_id, appointment_id")
        .eq("lead_id", leadId!)
        .order("scheduled_at", { ascending: true });

      if (!activities?.length) return empty;

      const callIds = activities.map((a) => a.last_call_id).filter(Boolean) as string[];
      const apptIds = activities.map((a) => a.appointment_id).filter(Boolean) as string[];

      const [callsRes, recsRes, apptsRes] = await Promise.all([
        callIds.length
          ? supabase.from("calls").select("id, transcription_text").in("id", callIds)
          : Promise.resolve({ data: [] }),
        apptIds.length
          ? supabase
              .from("daily_recordings")
              .select("appointment_id, transcription_text, chat_messages")
              .in("appointment_id", apptIds)
          : Promise.resolve({ data: [] }),
        apptIds.length
          ? supabase.from("crm_appointments").select("id, daily_room_name").in("id", apptIds)
          : Promise.resolve({ data: [] }),
      ]);

      const callMap = new Map((callsRes.data || []).map((c) => [c.id, c]));
      const recMap = new Map((recsRes.data || []).map((r) => [r.appointment_id, r]));

      // Espelha a cascata da edge function: chunks ao vivo sao chaveados por daily_room_name
      const chunkKeyToAppt = new Map<string, string>();
      for (const apt of apptsRes.data || []) {
        if (recMap.get(apt.id)?.transcription_text?.trim()) continue;
        if (apt.daily_room_name) chunkKeyToAppt.set(apt.daily_room_name, apt.id);
        chunkKeyToAppt.set(apt.id, apt.id);
      }

      const chunkCountByAppt = new Map<string, number>();
      if (chunkKeyToAppt.size > 0) {
        const { data: chunks } = await supabase
          .from("meeting_transcript_chunks")
          .select("meeting_id, content")
          .in("meeting_id", [...chunkKeyToAppt.keys()]);
        for (const c of chunks || []) {
          const apptId = chunkKeyToAppt.get(c.meeting_id);
          if (!apptId) continue;
          chunkCountByAppt.set(apptId, (chunkCountByAppt.get(apptId) || 0) + (c.content?.length || 0));
        }
      }

      for (const a of activities) {
        if (!a.last_call_id && !a.appointment_id) continue;
        const rec = a.appointment_id ? recMap.get(a.appointment_id) : null;
        const callText = a.last_call_id ? callMap.get(a.last_call_id)?.transcription_text : null;
        const chatMsgs = Array.isArray(rec?.chat_messages) ? rec.chat_messages : [];
        const liveChars = a.appointment_id ? chunkCountByAppt.get(a.appointment_id) || 0 : 0;

        let source: TranscriptSource = "none";
        let chars = 0;
        if (callText?.trim()) {
          source = "call_transcription";
          chars = callText.length;
        } else if (rec?.transcription_text?.trim()) {
          source = "recording_transcription";
          chars = rec.transcription_text.length;
        } else if (liveChars > 0) {
          source = "live_transcription";
          chars = liveChars;
        } else if (chatMsgs.length > 0) {
          source = "meeting_chat";
          chars = chatMsgs.length;
        }

        const entry: DNIASourceActivity = {
          activity_id: a.id,
          title: a.title,
          date: a.scheduled_at,
          status: a.status,
          has_transcript: source !== "none",
          transcript_source: source,
          has_ai_analysis: false,
          transcript_chars: chars,
          omitted: false,
        };
        if (a.last_call_id) empty.calls.push(entry);
        else empty.meetings.push(entry);
      }

      return empty;
    },
    enabled: isEstimated && !!leadId,
  });

  const sources = sourcesUsed ?? fallback;
  if (!sources) return null;

  const { chat, meetings, calls, notes } = sources;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <Database className="h-4 w-4" />
          Fontes usadas na análise
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEstimated && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2">
            <Info className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Estimado a partir dos dados atuais — esta análise é anterior ao registro de fontes.
              Reprocesse a análise para ver exatamente o que foi considerado.
            </p>
          </div>
        )}

        <SourceSection icon={MessageSquare} title="Chat" isEmpty={chat.message_count === 0}>
          {chat.message_count > 0 ? (
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-foreground">
                {chat.message_count} mensagens
                {chat.first_at && chat.last_at && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({formatDate(chat.first_at)} a {formatDate(chat.last_at)})
                  </span>
                )}
              </p>
              {chat.capped && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 badge-neutral shrink-0">
                  limitado a 100
                </Badge>
              )}
            </div>
          ) : (
            <EmptyRow label="nenhuma" />
          )}
        </SourceSection>

        <SourceSection icon={Video} title="Reuniões" isEmpty={meetings.length === 0}>
          {meetings.length > 0 ? (
            meetings.map((m) => <ActivityRow key={m.activity_id} item={m} />)
          ) : (
            <EmptyRow label="nenhuma" />
          )}
        </SourceSection>

        <SourceSection icon={Phone} title="Ligações" isEmpty={calls.length === 0}>
          {calls.length > 0 ? (
            calls.map((c) => <ActivityRow key={c.activity_id} item={c} />)
          ) : (
            <EmptyRow label="nenhuma" />
          )}
        </SourceSection>

        <SourceSection icon={FileText} title="Notas do card" isEmpty={!notes.present}>
          {notes.present ? (
            <p className="text-xs text-foreground">{notes.chars} caracteres</p>
          ) : (
            <EmptyRow label="nenhuma" />
          )}
        </SourceSection>
      </CardContent>
    </Card>
  );
}
