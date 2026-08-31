// Registro assertivo de acessos à sala Daily.co.
//
// O webhook do Daily (participant.joined) é a fonte mais rica, porém não é
// confiável: eventos podem falhar, chegar fora de ordem ou nunca ser entregues.
// Por isso registramos também nos pontos determinísticos do nosso próprio fluxo
// (lobby / emissão de token / update-status), com um participant_id sintético
// prefixado pela origem para não conflitar com o id do Daily.

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type ParticipantSource = "daily" | "gate" | "token" | "status";

export function decodeParticipantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = String(raw);
  try {
    if (/%[0-9A-Fa-f]{2}/.test(value)) value = decodeURIComponent(value);
  } catch {
    // mantém o valor original quando não é um encoding válido
  }
  value = value.replace(/\+/g, " ").trim();
  return value || null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function buildParticipantId(
  source: ParticipantSource,
  identity: string | null | undefined,
  isOwner: boolean,
): string {
  const base = slug(identity ? String(identity) : "") || (isOwner ? "host" : "convidado");
  return `${source}:${base}`;
}

/**
 * Grava (ou completa) a entrada de um participante.
 *
 * - `ignoreDuplicates` NÃO é usado: se a mesma chave já existe, apenas o nome é
 *   completado quando estava vazio; `joined_at` original é preservado.
 * - Nunca lança: registro de presença jamais pode derrubar a entrada na sala.
 */
export async function recordMeetingParticipant(
  supabase: SupabaseAdmin,
  params: {
    appointmentId: string;
    source: ParticipantSource;
    participantId?: string | null;
    identity?: string | null;
    userName?: string | null;
    isOwner?: boolean;
    joinedAt?: string;
  },
): Promise<void> {
  const isOwner = params.isOwner === true;
  const userName = decodeParticipantName(params.userName);
  const participantId = params.participantId
    ? `${params.source === "daily" ? "" : `${params.source}:`}${params.participantId}`
    : buildParticipantId(params.source, params.identity ?? userName, isOwner);

  try {
    const { data: existing } = await supabase
      .from("daily_meeting_participants")
      .select("id, user_name, is_owner")
      .eq("appointment_id", params.appointmentId)
      .eq("participant_id", participantId)
      .maybeSingle();

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.user_name && userName) patch.user_name = userName;
      if (isOwner && existing.is_owner !== true) patch.is_owner = true;
      if (Object.keys(patch).length > 0) {
        await supabase
          .from("daily_meeting_participants")
          .update(patch)
          .eq("id", existing.id);
      }
      return;
    }

    await supabase.from("daily_meeting_participants").insert({
      appointment_id: params.appointmentId,
      participant_id: participantId,
      user_name: userName,
      is_owner: isOwner,
      joined_at: params.joinedAt ?? new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[meeting-participants] failed to record participant:", e);
  }
}
