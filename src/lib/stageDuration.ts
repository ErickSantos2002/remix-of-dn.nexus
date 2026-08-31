/**
 * Formata uma duração em segundos para exibição curta em pt-BR.
 * Ex.: "menos de 1 min", "12min", "3h", "2d 4h", "7d".
 *
 * Períodos abaixo de um minuto não usam "agora": na timeline "Tempo por etapa"
 * o mesmo texto aparece em períodos encerrados dias atrás, e "agora" dava a
 * entender que a movimentação tinha acabado de acontecer.
 */
export function formatStageDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "menos de 1 min";
  const s = Math.floor(seconds);
  if (s < 60) return "menos de 1 min";
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours - days * 24;
  if (days < 7 && remHours > 0) return `${days}d ${remHours}h`;
  return `${days}d`;
}

/**
 * Segundos decorridos na etapa atual.
 * Se o card foi fechado (won/lost), congela em closed_at - moved_at.
 */
export function stageElapsedSeconds(
  movedAt: string | null | undefined,
  status: string | null | undefined,
  closedAt: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!movedAt) return 0;
  const start = new Date(movedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const end =
    (status === "won" || status === "lost") && closedAt
      ? new Date(closedAt).getTime()
      : nowMs;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * Cor do badge baseada na idade (em segundos), status e thresholds da etapa (em horas).
 * Cards fechados (won/lost) sempre exibem o tom neutro.
 */
export function stageBadgeTone(
  seconds: number,
  status: string | null | undefined,
  warningAfterHours: number = 72,
  dangerAfterHours: number = 168
): "neutral" | "warning" | "danger" {
  if (status === "won" || status === "lost") return "neutral";
  const hours = seconds / 3600;
  if (dangerAfterHours > 0 && hours >= dangerAfterHours) return "danger";
  if (warningAfterHours > 0 && hours >= warningAfterHours) return "warning";
  return "neutral";
}

