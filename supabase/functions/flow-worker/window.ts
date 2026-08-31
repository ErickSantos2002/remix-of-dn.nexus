// supabase/functions/flow-worker/window.ts
// Janela de envio da empresa + período do dia (spec §3.3). Porte das linhas
// 112–158 do cadence-dispatcher, mais o cálculo do PRÓXIMO horário válido
// (a v1 descartava; a v2 reagenda).
const TZ = "America/Sao_Paulo";

export interface SendingWindow { start_time: string; end_time: string; weekdays: number[] }

export const PERIODS: Record<string, [number, number]> = {
  manha: [6, 11], tarde: [12, 17], noite: [18, 22],
};

export function getSpDateParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[parts.weekday] ?? 0, hour: parseInt(parts.hour, 10), minute: parseInt(parts.minute, 10) };
}

function timeStrToMinutes(t: string) {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

export function fitsWindow(now: Date, win: SendingWindow | null): boolean {
  if (!win) return true;
  const { dow, hour, minute } = getSpDateParts(now);
  if (!win.weekdays.includes(dow)) return false;
  const cur = hour * 60 + minute;
  return cur >= timeStrToMinutes(win.start_time) && cur <= timeStrToMinutes(win.end_time);
}

export function fitsPeriod(now: Date, period: string | null | undefined): boolean {
  if (!period || period === "qualquer") return true;
  const range = PERIODS[period];
  if (!range) return true;
  const { hour } = getSpDateParts(now);
  return hour >= range[0] && hour <= range[1];
}

/**
 * Próximo instante que satisfaz janela E período, varrendo até 8 dias em passos
 * de 15 min a partir de now+15min. Retorna null se nada satisfizer (janela
 * mal-configurada) — o chamador trata como "skip com motivo".
 */
export function computeNextValidSendTime(
  now: Date, win: SendingWindow | null, period: string | null | undefined,
): Date | null {
  const STEP_MS = 15 * 60_000;
  let t = new Date(Math.ceil((now.getTime() + STEP_MS) / STEP_MS) * STEP_MS);
  const limit = now.getTime() + 8 * 86_400_000;
  while (t.getTime() <= limit) {
    if (fitsWindow(t, win) && fitsPeriod(t, period)) return t;
    t = new Date(t.getTime() + STEP_MS);
  }
  return null;
}
