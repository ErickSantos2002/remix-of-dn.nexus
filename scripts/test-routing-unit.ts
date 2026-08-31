// scripts/test-routing-unit.ts — testes puros do módulo de roteamento (sem banco).
// Uso: npx tsx scripts/test-routing-unit.ts
import { isWithinWorkingHours } from "../supabase/functions/_shared/routing/workhours.ts";
import { selectAssignee } from "../supabase/functions/_shared/routing/select.ts";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`, extra ?? ""); }
}

const noHolidays = new Set<string>();
const cal = { work_days: ["MON", "TUE", "WED", "THU", "FRI"], work_start_time: "09:00", work_end_time: "18:00", timezone: "America/Sao_Paulo" };

// 2026-08-26 é uma quarta-feira. 15:00 UTC = 12:00 em São Paulo (UTC-3).
ok("dentro da jornada (qua 12:00 SP)", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-26T15:00:00Z")) === true);
ok("fora da jornada (qua 23:00 SP = 02:00Z qui)", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-27T02:00:00Z")) === false);
ok("fim de semana (sáb 12:00 SP)", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-29T15:00:00Z")) === false);
ok("limite: 18:00 exclusivo", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-26T21:00:00Z")) === false);
ok("limite: 09:00 inclusivo", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-26T12:00:00Z")) === true);
ok("sem calendário usa default (qua 12:00 SP)", isWithinWorkingHours(null, noHolidays, new Date("2026-08-26T15:00:00Z")) === true);
// Feriado: a data é avaliada no fuso do atendente (spec §8)
ok("feriado bloqueia", isWithinWorkingHours(cal, new Set(["2026-08-26"]), new Date("2026-08-26T15:00:00Z")) === false);
// Fuso não-BRT: 09:30 em Lisboa (UTC+1 em agosto) = 08:30Z
ok("fuso do atendente (Lisboa 09:30)", isWithinWorkingHours({ ...cal, timezone: "Europe/Lisbon" }, noHolidays, new Date("2026-08-26T08:30:00Z")) === true);
ok("mesmo instante fora em SP (05:30 local)", isWithinWorkingHours(cal, noHolidays, new Date("2026-08-26T08:30:00Z")) === false);
// crm_agent_calendars.timezone é texto livre sem CHECK — IANA inválido deve cair no default, nunca lançar.
ok("timezone inválido cai no default sem lançar", isWithinWorkingHours({ ...cal, timezone: "Nao/Existe" }, noHolidays, new Date("2026-08-26T15:00:00Z")) === true);

// selectAssignee
const loads = new Map([["a", 3], ["b", 1], ["c", 1]]);
ok("least_loaded pega menor carga, empate por user_id", selectAssignee(["a", "b", "c"], { strategy: "least_loaded", loads }) === "b");
ok("dono do card vence o rodízio", selectAssignee(["a", "b"], { strategy: "least_loaded", loads, ownerId: "a" }) === "a");
ok("dono fora do pool não vence", selectAssignee(["b", "c"], { strategy: "least_loaded", loads, ownerId: "x" }) === "b");
const lastAct = new Map<string, string | null>([["a", "2026-08-01T00:00:00Z"], ["b", null], ["c", "2026-08-20T00:00:00Z"]]);
ok("round_robin: NULL (nunca recebeu) primeiro", selectAssignee(["a", "b", "c"], { strategy: "round_robin", loads, lastActivity: lastAct }) === "b");
ok("round_robin: mais antigo depois do NULL", selectAssignee(["a", "c"], { strategy: "round_robin", loads, lastActivity: lastAct }) === "a");
ok("estratégia desconhecida cai em least_loaded", selectAssignee(["a", "b"], { strategy: "skill_based", loads }) === "b");
ok("pool vazio devolve null", selectAssignee([], { strategy: "least_loaded", loads }) === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
