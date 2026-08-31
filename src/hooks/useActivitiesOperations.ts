import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { AnalysisSourceType } from "@/types/analysis";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tipos de atividade que produzem transcrição e podem ser avaliados. */
const EVALUABLE_TYPES = ["meeting", "demo", "reschedule", "call"];

export interface ActivityOperationRow {
  activityId: string;
  title: string;
  type: string;
  scheduledAt: string;
  leadId: string | null;
  appointmentId: string | null;
  /** Sem sala no Daily nao ha gravacao nem transcricao a recuperar. */
  hasDailyRoom: boolean;
  /** Recuperacao ja tentada e o Daily nao tem o arquivo — insistir nao muda nada. */
  recoveryFailed: boolean;
  assigneeName: string | null;
  /** Membro responsável — é o vendedor creditado na avaliação (rebuild da memória). */
  assignedTo: string | null;
  analysisPlaybookId: string | null;

  /** Origem disponível para avaliar; null quando não há transcrição alguma. */
  transcriptionSource: AnalysisSourceType | null;
  /** ID a passar para a avaliação: recording (Daily) ou appointment (ao vivo). */
  transcriptionSourceId: string | null;

  resultId: string | null;
  score: number | null;
  resultStatus: string | null;
  resultSourceType: AnalysisSourceType | null;
  resultSourceId: string | null;
  disregarded: boolean;
}

/**
 * Panorama operacional das atividades de um período: o que tem transcrição, o
 * que tem análise vinculada e o que já foi avaliado.
 *
 * Consultas em lote de propósito — a tela lista dezenas de atividades, e uma
 * consulta por linha inviabilizaria o carregamento.
 */
export function useActivitiesOperations(startDate: string, endDate: string) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["activities-operations", workspaceId, startDate, endDate],
    enabled: !!workspaceId && !!startDate && !!endDate,
    queryFn: async (): Promise<ActivityOperationRow[]> => {
      const start = new Date(`${startDate}T00:00:00`).toISOString();
      const end = new Date(`${endDate}T23:59:59`).toISOString();

      const { data: activities, error } = await (supabase.from("crm_lead_activities") as any)
        .select("id, title, type, scheduled_at, lead_id, appointment_id, assigned_to, analysis_playbook_id")
        .eq("workspace_id", workspaceId!)
        // Só atendimentos que aconteceram: tarefa, e-mail e follow-up nunca têm
        // transcrição, e reunião pendente, cancelada ou no-show não tem o que avaliar
        .eq("status", "completed")
        .in("type", EVALUABLE_TYPES)
        .gte("scheduled_at", start)
        .lte("scheduled_at", end)
        .order("scheduled_at", { ascending: false });
      if (error) throw error;

      const rows = (activities ?? []) as Array<{
        id: string;
        title: string;
        type: string;
        scheduled_at: string;
        lead_id: string | null;
        appointment_id: string | null;
        assigned_to: string | null;
        analysis_playbook_id: string | null;
      }>;
      if (rows.length === 0) return [];

      const activityIds = rows.map((r) => r.id);
      const appointmentIds = rows.map((r) => r.appointment_id).filter(Boolean) as string[];
      const assigneeIds = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))] as string[];

      const [{ data: recordings }, { data: appointments }, { data: results }, { data: profiles }] =
        await Promise.all([
          appointmentIds.length
            ? supabase
                .from("daily_recordings")
                .select("id, appointment_id, transcription_text")
                .in("appointment_id", appointmentIds)
            : Promise.resolve({ data: [] as any[] }),
          appointmentIds.length
            ? supabase
                .from("crm_appointments")
                .select("id, daily_room_name")
                .in("id", appointmentIds)
            : Promise.resolve({ data: [] as any[] }),
          (supabase.from("activity_analysis_results") as any)
            .select("id, activity_id, score, status, disregarded_at, created_at, source_type, source_id")
            .in("activity_id", activityIds)
            .order("created_at", { ascending: false }),
          assigneeIds.length
            ? supabase.from("profiles").select("id, name, email").in("id", assigneeIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);

      // Gravação do Daily com texto é a origem preferida
      const recordingByAppointment = new Map<string, { id: string; hasText: boolean }>();
      for (const rec of (recordings ?? []) as Array<{
        id: string;
        appointment_id: string;
        transcription_text: string | null;
      }>) {
        const current = recordingByAppointment.get(rec.appointment_id);
        // Preferir a gravação que efetivamente tem texto
        if (!current || (!current.hasText && !!rec.transcription_text)) {
          recordingByAppointment.set(rec.appointment_id, { id: rec.id, hasText: !!rec.transcription_text });
        }
      }

      // Transcrição ao vivo: agrupada pelo nome da sala, não pelo appointment
      const roomByAppointment = new Map<string, string>();
      for (const appt of (appointments ?? []) as Array<{ id: string; daily_room_name: string | null }>) {
        if (appt.daily_room_name) roomByAppointment.set(appt.id, appt.daily_room_name);
      }

      // Jobs que ja falharam: o Daily nao tem o arquivo, entao repetir e inutil
      const failedRecovery = new Set<string>();
      if (appointmentIds.length > 0) {
        const { data: failedJobs } = await supabase
          .from("daily_recording_recovery_jobs")
          .select("appointment_id")
          .eq("recovery_type", "transcription")
          .eq("status", "failed")
          .in("appointment_id", appointmentIds);
        for (const job of (failedJobs ?? []) as Array<{ appointment_id: string }>) {
          failedRecovery.add(job.appointment_id);
        }
      }

      const roomNames = [...roomByAppointment.values()];
      const roomsWithChunks = new Set<string>();
      if (roomNames.length > 0) {
        // Via RPC porque a pergunta é "quais salas têm transcrição", e consultar
        // meeting_transcript_chunks direto traz uma linha por fala: o PostgREST
        // corta em 1000 sem avisar e as salas restantes somem da tela, que passa
        // a oferecer "Recuperar" para reunião já transcrita (migration 20260814150000)
        const { data: rooms, error: roomsError } = await (supabase.rpc as any)(
          "meeting_ids_with_chunks",
          { p_meeting_ids: roomNames },
        );
        if (roomsError) {
          console.error(
            "[useActivitiesOperations] falha ao consultar salas com transcrição ao vivo:",
            roomsError,
          );
        }
        for (const room of (rooms ?? []) as Array<{ meeting_id: string }>) {
          roomsWithChunks.add(room.meeting_id);
        }
      }

      // A ordem decrescente garante que o primeiro de cada atividade é o mais recente
      const resultByActivity = new Map<
        string,
        {
          id: string;
          score: number | null;
          status: string;
          disregarded_at: string | null;
          source_type: string | null;
          source_id: string | null;
        }
      >();
      for (const res of (results ?? []) as Array<{
        id: string;
        activity_id: string | null;
        score: number | null;
        status: string;
        disregarded_at: string | null;
        source_type: string | null;
        source_id: string | null;
      }>) {
        if (res.activity_id && !resultByActivity.has(res.activity_id)) {
          resultByActivity.set(res.activity_id, res);
        }
      }

      const nameById = new Map(
        ((profiles ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map((p) => [
          p.id,
          p.name || p.email || "Sem nome",
        ]),
      );

      return rows.map((row) => {
        const recording = row.appointment_id ? recordingByAppointment.get(row.appointment_id) : undefined;
        const room = row.appointment_id ? roomByAppointment.get(row.appointment_id) : undefined;
        const hasChunks = !!room && roomsWithChunks.has(room);

        let transcriptionSource: AnalysisSourceType | null = null;
        let transcriptionSourceId: string | null = null;
        if (recording?.hasText) {
          transcriptionSource = "daily_recording";
          transcriptionSourceId = recording.id;
        } else if (hasChunks && row.appointment_id) {
          transcriptionSource = "meeting_chunks";
          transcriptionSourceId = row.appointment_id;
        }

        const result = resultByActivity.get(row.id);

        return {
          activityId: row.id,
          title: row.title,
          type: row.type,
          scheduledAt: row.scheduled_at,
          leadId: row.lead_id,
          appointmentId: row.appointment_id,
          hasDailyRoom: !!room,
          recoveryFailed: !!row.appointment_id && failedRecovery.has(row.appointment_id),
          assigneeName: row.assigned_to ? (nameById.get(row.assigned_to) ?? null) : null,
          assignedTo: row.assigned_to,
          analysisPlaybookId: row.analysis_playbook_id,
          transcriptionSource,
          transcriptionSourceId,
          resultId: result?.id ?? null,
          score: result?.score ?? null,
          resultStatus: result?.status ?? null,
          resultSourceType: (result?.source_type as AnalysisSourceType | null) ?? null,
          resultSourceId: result?.source_id ?? null,
          disregarded: !!result?.disregarded_at,
        };
      });
    },
    staleTime: 15_000,
  });
}
