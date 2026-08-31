# Centralização do Roteamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `/settings/routing` governar de fato a distribuição de leads (chat e agendamento), corrigindo os 8 defeitos catalogados no spec (contador que vaza, fila-ralo, presença manual morta, transferência bloqueada, janela de carga errada, tabela fantasma, estratégias falsas, atendimento que nunca encerra).

**Architecture:** Módulo Deno compartilhado `supabase/functions/_shared/routing/` decide "quem atende"; orchestrator, schedule-appointment, schedule-widget e um worker novo de fila o consomem. Presença de chat derivada de `crm_agent_calendars` + `crm_holidays`; carga derivada por RPCs no banco. Frontend espelha só as funções puras (jornada/presença) para rotular — nunca para decidir.

**Tech Stack:** Deno edge functions (Supabase), Postgres (migrations, trigger, RPCs, pg_cron), React 18 + TS + TanStack Query + shadcn/ui, tokens DN.IA V3.

**Spec:** `docs/superpowers/specs/2026-08-28-centralizar-roteamento-design.md` — o plano argumenta a partir dele; leia os §§ citados em cada task.

## Global Constraints

- **Trunk-based**: trabalhar direto na `main`; deploy é o push (Lovable builda e aplica migrations). Push 1 = Tasks 1–14; Push 2 = Task 15, **somente após validar o Push 1 no ar**.
- **UI em pt-BR com acentuação correta** (`.claude/rules/spelling.mdc`). Strings novas acentuadas; strings sem acento em trechos que você editar devem ser corrigidas.
- **Design System DN.IA V3**: nunca cor crua (`text-white`, `bg-red-500`); `Pill`/`EmptyState` de `src/components/dn/`; ícones só `lucide-react`; rodar a auditoria de cor do CLAUDE.md antes de commitar arquivos `.tsx`.
- **Lint gradual**: ao editar um arquivo, corrigir os erros de lint existentes nele (`prefer-const` > `no-empty` > `no-explicit-any`).
- **Verificação de tipos**: `npx tsc --noEmit` deve passar antes de cada commit de frontend (o Vite não checa tipos).
- **`src/integrations/supabase/types.ts` é gerado — nunca editar.** Tabelas/RPCs ainda fora dele usam o padrão do projeto: `from("x" as any)` / `(supabase.rpc as any)("fn", ...)` (precedente: `src/hooks/useFlows.ts`).
- **Sem service key local**: `scripts/test-routing*.ts` rodam onde houver `SUPABASE_SERVICE_ROLE_KEY`; a validação de banco em produção é por SQL no editor do Lovable (memória do projeto).
- **Edge functions** importam `_shared` por caminho relativo com extensão: `../_shared/routing/config.ts`.
- Commits terminam com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Descobertas de recon que o spec não detalha (vinculantes para as tasks)

1. `lead_queues.lead_id` é **text** (não uuid) → todo join/filtro com `leads.id` exige `::text`.
2. `lead_queues` tem `UNIQUE (workspace_id, lead_id)` (total, não parcial) → uma linha por lead; escrita é sempre **upsert** com `onConflict: "workspace_id,lead_id"`.
3. O CHECK de `lead_queues.status` é `('waiting','assigned','in_progress','completed','abandoned')` — **não tem `'cancelled'`**; a migration da Task 1 estende o CHECK.
4. `agent_availability` **não tem UNIQUE (workspace_id, user_id)** → a migration deduplica e cria o índice único para permitir upsert.
5. `agent_availability.status` tem CHECK e índice `idx_agent_availability_status` — o drop do Push 2 remove índice e coluna.
6. `crm_leads` aberto = `status = 'open'` e `deleted_at IS NULL`.
7. `leads.status` é enum `lead_status`: `new | ai_talking | needs_human | closed | human_talking`.
8. `selectBestAgentForSlot` tem **um** call site: `schedule-appointment/index.ts:2763`, com `lead_id` em escopo.
9. OpenAPI: schemas `RoutingConfig` (yaml:1381) e `UpdateRoutingConfig` (yaml:2656); testes em `scripts/test-api.ts` `phase12_routing()` (linha ~673).

---

### Task 1: Migration base (colunas, trigger de encerramento, backfill, RPCs, índices)

**Files:**
- Create: `supabase/migrations/20260828150000_routing_centralization_base.sql`

**Interfaces:**
- Produces: colunas `workspace_routing_config.respect_card_owner|scheduling_strategy|scheduling_load_window_days`; trigger `trg_close_routing_on_lead_close` em `leads`; RPCs `public.chat_load_by_user(p_workspace_id uuid, p_user_ids uuid[]) RETURNS TABLE(user_id uuid, load bigint)` e `public.scheduling_load_by_user(p_workspace_id uuid, p_user_ids uuid[], p_window_days int) RETURNS TABLE(user_id uuid, load bigint)`; status `'cancelled'` válido em `lead_queues`; `UNIQUE (workspace_id, user_id)` em `agent_availability`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Centralização do Roteamento — fase 1 (spec docs/superpowers/specs/2026-08-28-centralizar-roteamento-design.md)
-- Colunas novas, trigger de encerramento, backfill, RPCs de carga, índices.
-- Os drops (routing_config, colunas de agent_availability) ficam para a fase 2,
-- depois que o código que parou de lê-los estiver no ar (spec §11).

-- 1. Colunas novas em workspace_routing_config (spec §4.1)
ALTER TABLE public.workspace_routing_config
  ADD COLUMN IF NOT EXISTS respect_card_owner boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scheduling_strategy text NOT NULL DEFAULT 'least_loaded',
  ADD COLUMN IF NOT EXISTS scheduling_load_window_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.workspace_routing_config
  DROP CONSTRAINT IF EXISTS workspace_routing_config_scheduling_strategy_check;
ALTER TABLE public.workspace_routing_config
  ADD CONSTRAINT workspace_routing_config_scheduling_strategy_check
  CHECK (scheduling_strategy IN ('least_loaded', 'round_robin'));

ALTER TABLE public.workspace_routing_config
  DROP CONSTRAINT IF EXISTS workspace_routing_config_sched_window_check;
ALTER TABLE public.workspace_routing_config
  ADD CONSTRAINT workspace_routing_config_sched_window_check
  CHECK (scheduling_load_window_days > 0);

-- 2. lead_queues: aceitar 'cancelled' (recon 3; spec §4.6 — waiting cancelado ≠ completado)
ALTER TABLE public.lead_queues DROP CONSTRAINT IF EXISTS lead_queues_status_check;
ALTER TABLE public.lead_queues
  ADD CONSTRAINT lead_queues_status_check
  CHECK (status IN ('waiting', 'assigned', 'in_progress', 'completed', 'abandoned', 'cancelled'));

-- 3. agent_availability: deduplicar e garantir uma linha por (workspace, user)
--    para os upserts do módulo (recon 4). Mantém a linha mais recente.
DELETE FROM public.agent_availability a
USING public.agent_availability b
WHERE a.workspace_id = b.workspace_id
  AND a.user_id = b.user_id
  AND a.id <> b.id
  AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_availability_workspace_user
  ON public.agent_availability (workspace_id, user_id);

-- 4. Trigger de encerramento (spec §4.6): fecha lead_queues/lead_assignments
--    quando o lead fecha. No banco para não depender da UI (defeito 8).
CREATE OR REPLACE FUNCTION public.close_routing_records_on_lead_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE lead_queues
      SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE lead_id = NEW.id::text AND status IN ('assigned', 'in_progress');
    -- waiting é cancelado, não completado: saiu da fila sem ser atendido por ela
    UPDATE lead_queues
      SET status = 'cancelled', completed_at = now(), updated_at = now()
      WHERE lead_id = NEW.id::text AND status = 'waiting';
    UPDATE lead_assignments
      SET completed_at = now(), result = COALESCE(result, 'resolved'), updated_at = now()
      WHERE lead_id = NEW.id AND completed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_routing_on_lead_close ON public.leads;
CREATE TRIGGER trg_close_routing_on_lead_close
  AFTER UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.close_routing_records_on_lead_close();

-- 5. Backfill (spec §11 passo 3): sem isto a carga derivada nasce inflada
--    pelos registros que nunca foram encerrados.
UPDATE public.lead_queues q
  SET status = 'completed', completed_at = now(), updated_at = now()
  FROM public.leads l
  WHERE q.lead_id = l.id::text AND l.status = 'closed'
    AND q.status IN ('assigned', 'in_progress');

UPDATE public.lead_queues q
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  FROM public.leads l
  WHERE q.lead_id = l.id::text AND l.status = 'closed'
    AND q.status = 'waiting';

UPDATE public.lead_assignments a
  SET completed_at = now(), result = COALESCE(a.result, 'resolved'), updated_at = now()
  FROM public.leads l
  WHERE a.lead_id = l.id AND l.status = 'closed' AND a.completed_at IS NULL;

-- 6. RPC de carga de chat (spec §6.1). unnest + LEFT JOIN devolve UMA LINHA POR
--    CANDIDATO (padrão "existence questions belong in the database" do CLAUDE.md;
--    agregações via PostgREST estão desabilitadas — PGRST123).
--    SECURITY INVOKER deliberado: serve o frontend sob as RLS de lead_queues
--    (SELECT para workspace members) e o service_role das edge functions.
CREATE OR REPLACE FUNCTION public.chat_load_by_user(p_workspace_id uuid, p_user_ids uuid[])
RETURNS TABLE (user_id uuid, load bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT u.uid, COALESCE(cnt.c, 0)
  FROM unnest(p_user_ids) AS u(uid)
  LEFT JOIN (
    SELECT assigned_to_user_id, count(DISTINCT lead_id) AS c
    FROM lead_queues
    WHERE workspace_id = p_workspace_id
      AND assigned_to_user_id = ANY (p_user_ids)
      AND status IN ('assigned', 'in_progress')
    GROUP BY assigned_to_user_id
  ) cnt ON cnt.assigned_to_user_id = u.uid;
$$;

-- 7. RPC de carga de agendamento (spec §7.1). No banco e não num select do
--    cliente por causa do teto silencioso de 1000 linhas do PostgREST.
--    Inclui completed/no_show: reunião distribuída é carga (defeito 6).
CREATE OR REPLACE FUNCTION public.scheduling_load_by_user(
  p_workspace_id uuid, p_user_ids uuid[], p_window_days integer
)
RETURNS TABLE (user_id uuid, load bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT u.uid, COALESCE(cnt.c, 0)
  FROM unnest(p_user_ids) AS u(uid)
  LEFT JOIN (
    SELECT assigned_to, count(*) AS c
    FROM crm_appointments
    WHERE workspace_id = p_workspace_id
      AND assigned_to = ANY (p_user_ids)
      AND start_time >= now() - make_interval(days => p_window_days)
      AND status IN ('scheduled', 'confirmed', 'completed', 'no_show')
    GROUP BY assigned_to
  ) cnt ON cnt.assigned_to = u.uid;
$$;

-- 8. Índices parciais para as duas consultas quentes novas
CREATE INDEX IF NOT EXISTS idx_lead_queues_waiting
  ON public.lead_queues (workspace_id, priority DESC, created_at)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_lead_queues_open_load
  ON public.lead_queues (workspace_id, assigned_to_user_id)
  WHERE status IN ('assigned', 'in_progress');
```

- [ ] **Step 2: Revisar o SQL contra o schema real**

Rode e confira que nada retorna (nenhuma referência a coluna inexistente):

```bash
grep -nE "lead_queues|lead_assignments|agent_availability|workspace_routing_config|crm_appointments" supabase/migrations/20260828150000_routing_centralization_base.sql | head -40
```

Verificação manual: `lead_queues.lead_id` comparado sempre com `l.id::text` (recon 1); `lead_assignments.lead_id` é uuid — sem cast. Confirme com `grep -n "lead_id" src/integrations/supabase/types.ts | head` se em dúvida.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260828150000_routing_centralization_base.sql
git commit -m "feat(routing): migration base da centralizacao (trigger de encerramento, RPCs de carga, backfill)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

*(A migration só é aplicada no push; a validação em produção está na Task 14.)*

---

### Task 2: Módulo puro — `types.ts`, `workhours.ts`, `select.ts` (+ teste unitário local)

**Files:**
- Create: `supabase/functions/_shared/routing/types.ts`
- Create: `supabase/functions/_shared/routing/workhours.ts`
- Create: `supabase/functions/_shared/routing/select.ts`
- Test: `scripts/test-routing-unit.ts`

**Interfaces:**
- Produces:
  - `RoutingConfig` `{ strategy: "least_loaded"|"round_robin"; fallback_strategy: "least_loaded"|"round_robin"|"queue"; auto_assign: boolean; category_matching: boolean; max_leads_per_agent: number; respect_card_owner: boolean; scheduling_strategy: "least_loaded"|"round_robin"; scheduling_load_window_days: number }`
  - `AgentCalendar` `{ work_days: string[]; work_start_time: string; work_end_time: string; timezone: string }`, `DEFAULT_CALENDAR`
  - `ChatCandidate` `{ user_id: string; is_accepting_leads: boolean; max_concurrent_leads: number; last_activity_at: string|null; load: number; name: string|null; email: string|null }`
  - `ChatResolution` `{ userId: string|null; userName: string|null; viaFallback: boolean; pool: ChatCandidate[] }`
  - `localParts(at: Date, timezone: string): { weekday: string; dateISO: string; minutes: number }`
  - `isWithinWorkingHours(calendar: Partial<AgentCalendar>|null, holidays: ReadonlySet<string>, at?: Date): boolean`
  - `selectAssignee(candidates: readonly string[], opts: { strategy: string; loads: ReadonlyMap<string, number>; ownerId?: string|null; lastActivity?: ReadonlyMap<string, string|null> }): string | null`

- [ ] **Step 1: Escrever o teste que falha** (`scripts/test-routing-unit.ts`)

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/test-routing-unit.ts`
Expected: FAIL — `Cannot find module .../workhours.ts`

- [ ] **Step 3: Implementar `types.ts`**

```ts
// Tipos do motor de roteamento centralizado.
// Spec: docs/superpowers/specs/2026-08-28-centralizar-roteamento-design.md
export interface RoutingConfig {
  strategy: "least_loaded" | "round_robin";
  fallback_strategy: "least_loaded" | "round_robin" | "queue";
  auto_assign: boolean;
  category_matching: boolean;
  max_leads_per_agent: number;
  respect_card_owner: boolean;
  scheduling_strategy: "least_loaded" | "round_robin";
  scheduling_load_window_days: number;
}

export interface AgentCalendar {
  work_days: string[];
  work_start_time: string; // "HH:MM"
  work_end_time: string;   // "HH:MM"
  timezone: string;        // IANA
}

// Mesmo default que os agendadores já aplicam (schedule-widget/index.ts:648-654).
export const DEFAULT_CALENDAR: AgentCalendar = {
  work_days: ["MON", "TUE", "WED", "THU", "FRI"],
  work_start_time: "09:00",
  work_end_time: "18:00",
  timezone: "America/Sao_Paulo",
};

export interface ChatCandidate {
  user_id: string;
  is_accepting_leads: boolean;
  max_concurrent_leads: number;
  last_activity_at: string | null;
  load: number;
  name: string | null;
  email: string | null;
}

export interface ChatResolution {
  userId: string | null;
  userName: string | null;
  /** true quando atribuído pelo fallback que ignora jornada/pausa (spec §6 passo 5). */
  viaFallback: boolean;
  /** Pool elegível no momento da decisão (para notificações e diagnóstico). */
  pool: ChatCandidate[];
}
```

- [ ] **Step 4: Implementar `workhours.ts`**

```ts
// Jornada de trabalho — mesma semântica dos agendadores (spec §8).
// ESPELHADO em src/lib/routing/workhours.ts (Task 9); alterações valem nos dois.
import { AgentCalendar, DEFAULT_CALENDAR } from "./types.ts";

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Partes locais (dia da semana, data ISO, minutos desde 00:00) de um instante num fuso. */
export function localParts(at: Date, timezone: string): { weekday: string; dateISO: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const weekday = String(parts.weekday || "").toUpperCase().slice(0, 3);
  const dateISO = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour) % 24; // alguns runtimes formatam meia-noite como "24"
  return { weekday, dateISO, minutes: hour * 60 + Number(parts.minute) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Dentro da jornada = dia útil do atendente, no fuso dele, fora de feriado.
 * `holidays`: datas "YYYY-MM-DD" de crm_holidays do workspace; a comparação usa
 * o "hoje" do fuso do atendente (spec §8). Sem calendário, vale DEFAULT_CALENDAR.
 * Início inclusivo, fim exclusivo (09:00 conta, 18:00 não).
 */
export function isWithinWorkingHours(
  calendar: Partial<AgentCalendar> | null,
  holidays: ReadonlySet<string>,
  at: Date = new Date(),
): boolean {
  const cal: AgentCalendar = {
    work_days: calendar?.work_days?.length ? calendar.work_days : DEFAULT_CALENDAR.work_days,
    work_start_time: calendar?.work_start_time || DEFAULT_CALENDAR.work_start_time,
    work_end_time: calendar?.work_end_time || DEFAULT_CALENDAR.work_end_time,
    timezone: calendar?.timezone || DEFAULT_CALENDAR.timezone,
  };
  const { weekday, dateISO, minutes } = localParts(at, cal.timezone);
  if (!DAY_KEYS.includes(weekday)) return false;
  if (!cal.work_days.includes(weekday)) return false;
  if (holidays.has(dateISO)) return false;
  return minutes >= toMinutes(cal.work_start_time) && minutes < toMinutes(cal.work_end_time);
}
```

- [ ] **Step 5: Implementar `select.ts`**

```ts
// Seleção do responsável — decisão pura, sem I/O (spec §5.1, §6, §7).
export interface SelectOptions {
  strategy: string;
  loads: ReadonlyMap<string, number>;
  /** Responsável do card aberto do contato; vence o rodízio quando está no pool. */
  ownerId?: string | null;
  /** round_robin: última atribuição por user_id; NULL = nunca recebeu = primeiro da vez. */
  lastActivity?: ReadonlyMap<string, string | null>;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function selectAssignee(candidates: readonly string[], opts: SelectOptions): string | null {
  if (candidates.length === 0) return null;
  if (opts.ownerId && candidates.includes(opts.ownerId)) return opts.ownerId;

  const sorted = [...candidates];
  if (opts.strategy === "round_robin") {
    sorted.sort((a, b) => {
      const la = opts.lastActivity?.get(a) ?? null;
      const lb = opts.lastActivity?.get(b) ?? null;
      if (la !== lb) {
        if (la === null) return -1;
        if (lb === null) return 1;
        if (la < lb) return -1;
        if (la > lb) return 1;
      }
      return byId(a, b); // desempate estável — nunca Math.random() (spec §7 passo 5)
    });
  } else {
    // least_loaded, e também o destino de estratégia não implementada (spec §4.1);
    // o log da estratégia desconhecida acontece em config.ts, não aqui.
    sorted.sort((a, b) => {
      const la = opts.loads.get(a) ?? 0;
      const lb = opts.loads.get(b) ?? 0;
      return la !== lb ? la - lb : byId(a, b);
    });
  }
  return sorted[0];
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx tsx scripts/test-routing-unit.ts`
Expected: `16 passed, 0 failed`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/routing/types.ts supabase/functions/_shared/routing/workhours.ts supabase/functions/_shared/routing/select.ts scripts/test-routing-unit.ts
git commit -m "feat(routing): nucleo puro do modulo compartilhado (jornada, selecao) com testes locais

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Módulo de dados — `config.ts`, `load.ts`, `owner.ts`

**Files:**
- Create: `supabase/functions/_shared/routing/config.ts`
- Create: `supabase/functions/_shared/routing/load.ts`
- Create: `supabase/functions/_shared/routing/owner.ts`

**Interfaces:**
- Consumes: `RoutingConfig` (Task 2); RPCs `chat_load_by_user`, `scheduling_load_by_user` (Task 1)
- Produces:
  - `DEFAULT_ROUTING_CONFIG: RoutingConfig`
  - `loadRoutingConfig(supabase: any, workspaceId: string): Promise<RoutingConfig>`
  - `getChatLoad(supabase: any, workspaceId: string, userIds: string[]): Promise<Map<string, number>>`
  - `getSchedulingLoad(supabase: any, workspaceId: string, userIds: string[], windowDays: number): Promise<Map<string, number>>`
  - `loadHolidays(supabase: any, workspaceId: string): Promise<Set<string>>`
  - `getCardOwner(supabase: any, workspaceId: string, contactId: string | null | undefined): Promise<string | null>`

- [ ] **Step 1: Implementar `config.ts`**

```ts
// Fonte única de configuração: workspace_routing_config (spec §4.1).
import { RoutingConfig } from "./types.ts";

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  strategy: "least_loaded",
  fallback_strategy: "queue",
  auto_assign: true,
  category_matching: true,
  max_leads_per_agent: 10,
  respect_card_owner: true,
  scheduling_strategy: "least_loaded",
  scheduling_load_window_days: 30,
};

const IMPLEMENTED = new Set(["least_loaded", "round_robin"]);
const FALLBACKS = new Set(["least_loaded", "round_robin", "queue"]);

/** Sem linha = defaults. Estratégia não implementada cai em least_loaded COM LOG (defeito 7). */
export async function loadRoutingConfig(supabase: any, workspaceId: string): Promise<RoutingConfig> {
  const { data, error } = await supabase
    .from("workspace_routing_config")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) console.error("[ROUTING] loadRoutingConfig:", error.message);
  if (!data) return { ...DEFAULT_ROUTING_CONFIG };

  let strategy = data.strategy ?? DEFAULT_ROUTING_CONFIG.strategy;
  if (!IMPLEMENTED.has(strategy)) {
    console.warn(`[ROUTING] strategy "${strategy}" não implementada; usando least_loaded (workspace ${workspaceId})`);
    strategy = "least_loaded";
  }
  const fallback = FALLBACKS.has(data.fallback_strategy) ? data.fallback_strategy : DEFAULT_ROUTING_CONFIG.fallback_strategy;
  const schedStrategy = IMPLEMENTED.has(data.scheduling_strategy) ? data.scheduling_strategy : "least_loaded";

  return {
    strategy: strategy as RoutingConfig["strategy"],
    fallback_strategy: fallback as RoutingConfig["fallback_strategy"],
    auto_assign: data.auto_assign ?? true,
    category_matching: data.category_matching ?? true,
    max_leads_per_agent: data.max_leads_per_agent ?? 10,
    respect_card_owner: data.respect_card_owner ?? true,
    scheduling_strategy: schedStrategy as RoutingConfig["scheduling_strategy"],
    scheduling_load_window_days: data.scheduling_load_window_days ?? 30,
  };
}
```

- [ ] **Step 2: Implementar `load.ts`**

```ts
// Carga derivada — sempre via RPC, nunca contador persistido (spec §6.1, §7.1)
// nem select + contagem no cliente (teto silencioso de 1000 linhas do PostgREST).

async function loadByRpc(
  supabase: any, fn: string, params: Record<string, unknown>, userIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of userIds) map.set(id, 0);
  if (userIds.length === 0) return map;
  const { data, error } = await supabase.rpc(fn, params);
  if (error) {
    // Falha de carga não pode derrubar o roteamento: segue com carga 0
    // (ninguém excluído por capacidade; o rodízio ainda distribui).
    console.error(`[ROUTING] ${fn}:`, error.message);
    return map;
  }
  for (const row of data || []) map.set(row.user_id, Number(row.load) || 0);
  return map;
}

/** Leads de chat abertos (lead_queues assigned/in_progress), por atendente. */
export function getChatLoad(supabase: any, workspaceId: string, userIds: string[]): Promise<Map<string, number>> {
  return loadByRpc(supabase, "chat_load_by_user", { p_workspace_id: workspaceId, p_user_ids: userIds }, userIds);
}

/** Reuniões na janela (inclui completed/no_show — reunião distribuída é carga). */
export function getSchedulingLoad(
  supabase: any, workspaceId: string, userIds: string[], windowDays: number,
): Promise<Map<string, number>> {
  return loadByRpc(
    supabase,
    "scheduling_load_by_user",
    { p_workspace_id: workspaceId, p_user_ids: userIds, p_window_days: windowDays },
    userIds,
  );
}

/** Datas "YYYY-MM-DD" de crm_holidays do workspace (spec §4.4). */
export async function loadHolidays(supabase: any, workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("crm_holidays").select("date").eq("workspace_id", workspaceId);
  if (error) console.error("[ROUTING] loadHolidays:", error.message);
  return new Set(((data || []) as Array<{ date: string }>).map((h) => h.date));
}
```

- [ ] **Step 3: Implementar `owner.ts`**

```ts
// Responsável do card aberto do contato — o "dono fixo" (spec §6 passo 3, §7 passo 3).
export async function getCardOwner(
  supabase: any, workspaceId: string, contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null;
  const { data, error } = await supabase
    .from("crm_leads")
    .select("assigned_to")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[ROUTING] getCardOwner:", error.message);
  return (data as { assigned_to: string | null } | null)?.assigned_to ?? null;
}
```

- [ ] **Step 4: Verificação de sintaxe**

Run: `npx tsx -e "import('./supabase/functions/_shared/routing/config.ts').then(m => console.log(typeof m.loadRoutingConfig))"`
Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/routing/config.ts supabase/functions/_shared/routing/load.ts supabase/functions/_shared/routing/owner.ts
git commit -m "feat(routing): camada de dados do modulo (config, cargas via RPC, dono do card)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Módulo de orquestração — `chat.ts` e `assign.ts`

**Files:**
- Create: `supabase/functions/_shared/routing/chat.ts`
- Create: `supabase/functions/_shared/routing/assign.ts`

**Interfaces:**
- Consumes: tudo das Tasks 2–3
- Produces:
  - `resolveChatAssignee(supabase: any, workspaceId: string, config: RoutingConfig, opts?: { categoryId?: string|null; contactId?: string|null; ignoreSchedule?: boolean }): Promise<ChatResolution>`
  - `assignChatLead(supabase: any, p: AssignChatLeadParams): Promise<void>` com `AssignChatLeadParams = { workspaceId: string; leadId: string; leadPhone: string; leadName: string|null; agentId: string|null; categoryId: string|null; priority: string; priorityValue?: number; reason: string; userId: string }`

- [ ] **Step 1: Implementar `chat.ts`**

```ts
// Pool + decisão do chat (spec §6). Consumido pelo orchestrator e pelo
// routing-queue-worker — nunca reimplementar este funil em outro lugar.
import { RoutingConfig, ChatCandidate, ChatResolution } from "./types.ts";
import { isWithinWorkingHours } from "./workhours.ts";
import { getChatLoad, loadHolidays } from "./load.ts";
import { getCardOwner } from "./owner.ts";
import { selectAssignee } from "./select.ts";

interface MemberRow { user_id: string; name: string | null; email: string | null }

/** Owner + workspace_members ativos, com perfil (spec §6 passo 1). */
async function listWorkspaceMembers(supabase: any, workspaceId: string): Promise<MemberRow[]> {
  const [{ data: ws }, { data: members }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).single(),
    supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("status", "active"),
  ]);
  const ids = new Set<string>();
  if (ws?.owner_id) ids.add(ws.owner_id);
  for (const m of members || []) ids.add(m.user_id);
  if (ids.size === 0) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", [...ids]);
  return [...ids].map((id) => {
    const p = (profiles || []).find((x: any) => x.id === id);
    return { user_id: id, name: p?.name ?? null, email: p?.email ?? null };
  });
}

export interface ChatPoolOptions {
  categoryId?: string | null;
  contactId?: string | null;
  /** true no fallback least_loaded/round_robin: ignora jornada e pausa,
   *  mantém o teto de capacidade (spec §6 passo 5). */
  ignoreSchedule?: boolean;
}

export async function resolveChatAssignee(
  supabase: any, workspaceId: string, config: RoutingConfig, opts: ChatPoolOptions = {},
): Promise<ChatResolution> {
  const members = await listWorkspaceMembers(supabase, workspaceId);
  if (members.length === 0) return { userId: null, userName: null, viaFallback: false, pool: [] };
  const ids = members.map((m) => m.user_id);

  const [calRes, avRes, holidays, loads] = await Promise.all([
    supabase.from("crm_agent_calendars")
      .select("agent_id, work_days, work_start_time, work_end_time, timezone")
      .eq("workspace_id", workspaceId),
    supabase.from("agent_availability")
      .select("user_id, is_accepting_leads, max_concurrent_leads, last_activity_at")
      .eq("workspace_id", workspaceId),
    loadHolidays(supabase, workspaceId),
    getChatLoad(supabase, workspaceId, ids),
  ]);
  const calMap = new Map((calRes.data || []).map((c: any) => [c.agent_id, c]));
  const avMap = new Map((avRes.data || []).map((a: any) => [a.user_id, a]));

  // Ausência de linha em agent_availability = aceitando, teto padrão (spec §4.3).
  const candidates: ChatCandidate[] = members.map((m) => {
    const av = avMap.get(m.user_id) as any;
    return {
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      is_accepting_leads: av?.is_accepting_leads ?? true,
      max_concurrent_leads: av?.max_concurrent_leads ?? config.max_leads_per_agent,
      last_activity_at: av?.last_activity_at ?? null,
      load: loads.get(m.user_id) ?? 0,
    };
  });

  let pool = candidates.filter((c) =>
    c.load < c.max_concurrent_leads &&
    (opts.ignoreSchedule ||
      (c.is_accepting_leads && isWithinWorkingHours(calMap.get(c.user_id) ?? null, holidays)))
  );

  // Categoria é pré-filtro; se zerar o pool, é ignorado — melhor alguém fora
  // da categoria que ninguém (spec §6 passo 2).
  if (!opts.ignoreSchedule && config.category_matching && opts.categoryId && pool.length > 0) {
    const { data: catRows } = await supabase
      .from("category_agent_assignments")
      .select("agent_id")
      .eq("workspace_id", workspaceId)
      .eq("category_id", opts.categoryId);
    const catIds = new Set((catRows || []).map((r: any) => r.agent_id));
    if (catIds.size > 0) {
      const filtered = pool.filter((c) => catIds.has(c.user_id));
      if (filtered.length > 0) pool = filtered;
    }
  }

  if (pool.length === 0) return { userId: null, userName: null, viaFallback: false, pool: [] };

  const ownerId = config.respect_card_owner
    ? await getCardOwner(supabase, workspaceId, opts.contactId)
    : null;

  const chosen = selectAssignee(pool.map((c) => c.user_id), {
    strategy: config.strategy,
    loads: new Map(pool.map((c) => [c.user_id, c.load])),
    ownerId,
    lastActivity: new Map(pool.map((c) => [c.user_id, c.last_activity_at])),
  });
  const cand = pool.find((c) => c.user_id === chosen) ?? null;
  return {
    userId: chosen,
    userName: cand?.name || cand?.email || null,
    viaFallback: !!opts.ignoreSchedule,
    pool,
  };
}
```

- [ ] **Step 2: Implementar `assign.ts`**

```ts
// Escritor ÚNICO da atribuição de chat (spec §5.1). Handoff e worker chamam
// isto; nada mais escreve lead_queues/lead_assignments/last_activity_at.
const PRIORITY_VALUE: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export interface AssignChatLeadParams {
  workspaceId: string;
  leadId: string;
  leadPhone: string;
  leadName: string | null;
  agentId: string | null;   // agente de IA que originou o handoff (pode não haver)
  categoryId: string | null;
  priority: string;         // low | normal | high | urgent
  priorityValue?: number;   // worker repassa o valor já gravado na fila
  reason: string;
  userId: string;           // atendente escolhido
}

export async function assignChatLead(supabase: any, p: AssignChatLeadParams): Promise<void> {
  const now = new Date().toISOString();

  // UNIQUE (workspace_id, lead_id): upsert atualiza a própria linha waiting
  // quando existe, em vez de inserir outra (spec §5.1; recon 2).
  const { error: qErr } = await supabase.from("lead_queues").upsert({
    workspace_id: p.workspaceId,
    lead_id: p.leadId,
    lead_phone: p.leadPhone,
    lead_name: p.leadName,
    agent_id: p.agentId,
    category_id: p.categoryId,
    assigned_to_user_id: p.userId,
    status: "assigned",
    priority: p.priorityValue ?? PRIORITY_VALUE[p.priority] ?? 1,
    assigned_at: now,
    completed_at: null,
    updated_at: now,
  }, { onConflict: "workspace_id,lead_id" });
  if (qErr) console.error("[ROUTING] assignChatLead lead_queues:", qErr.message);

  const { error: aErr } = await supabase.from("lead_assignments").insert({
    workspace_id: p.workspaceId,
    lead_id: p.leadId,
    category_id: p.categoryId,
    assigned_to_user_id: p.userId,
    assigned_by_agent_id: p.agentId,
    reason: p.reason,
    priority: p.priority,
    assigned_at: now,
  });
  if (aErr) console.error("[ROUTING] assignChatLead lead_assignments:", aErr.message);

  await supabase.from("leads")
    .update({ assigned_to_user_id: p.userId, assigned_at: now })
    .eq("id", p.leadId);

  // Único escritor de last_activity_at (spec §4.3) — é o cursor do round_robin.
  await supabase.from("agent_availability").upsert({
    workspace_id: p.workspaceId,
    user_id: p.userId,
    last_activity_at: now,
    updated_at: now,
  }, { onConflict: "workspace_id,user_id" });

  // Notificação via tabela central (padrão do CLAUDE.md — NotificationBell reage por realtime).
  await supabase.from("user_notifications").insert({
    user_id: p.userId,
    workspace_id: p.workspaceId,
    type: "lead_assigned",
    title: "Novo atendimento",
    message: `Lead ${p.leadName || p.leadPhone} precisa de atendimento humano: ${p.reason}`,
    action_url: `/?lead=${p.leadId}`,
    related_lead_id: p.leadId,
    is_read: false,
  });
}
```

- [ ] **Step 3: Verificação de sintaxe**

Run: `npx tsx -e "import('./supabase/functions/_shared/routing/chat.ts').then(m => console.log(typeof m.resolveChatAssignee)); import('./supabase/functions/_shared/routing/assign.ts').then(m => console.log(typeof m.assignChatLead))"`
Expected: `function` duas vezes

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/routing/chat.ts supabase/functions/_shared/routing/assign.ts
git commit -m "feat(routing): resolveChatAssignee e assignChatLead (funil e escritor unicos do chat)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Reescrever o roteador do orchestrator

**Files:**
- Modify: `supabase/functions/orchestrator/routing-handler.ts`

**Interfaces:**
- Consumes: `loadRoutingConfig`, `resolveChatAssignee`, `assignChatLead` (Tasks 3–4); `getPriorityValue` de `./utils.ts` (já existe)
- Produces: assinaturas **inalteradas** de `handleHandoff`, `updateLeadInsights`, `sendSpecialistSuggestion` (o `orchestrator/index.ts:11` importa as três — não muda)

- [ ] **Step 1: Substituir o miolo de roteamento**

Em `routing-handler.ts`:

1. Adicionar imports no topo:

```ts
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { resolveChatAssignee } from "../_shared/routing/chat.ts";
import { assignChatLead } from "../_shared/routing/assign.ts";
```

2. **Deletar** `getAvailableHumanAgents` (linhas 7–67) e `selectBestHumanAgent` (69–83) — o funil agora vive no módulo (só este arquivo os usa; confirmado por grep).

3. **Substituir o corpo inteiro de `routeLeadToHumanAgent`** (mantendo a assinatura exportada) por:

```ts
export async function routeLeadToHumanAgent(
  supabase: any,
  workspaceId: string,
  leadId: string,
  leadPhone: string,
  leadName: string | null,
  agentId: string,
  categoryId: string | null,
  priority: string,
  reason: string
): Promise<{ success: boolean; assignedUserId?: string; assignedUserName?: string; queued?: boolean }> {
  console.log("[ROUTING] Starting intelligent lead routing...");
  try {
    // Fonte única: workspace_routing_config — a tabela routing_config (fantasma,
    // nunca escrita) sai de cena (defeito 1).
    const config = await loadRoutingConfig(supabase, workspaceId);

    const { data: leadRow } = await supabase
      .from("leads").select("contact_id").eq("id", leadId).maybeSingle();
    const contactId = leadRow?.contact_id ?? null;

    // auto_assign desligado: needs_human + notifica o pool, ninguém recebe
    // atribuição — quem pegar no Inbox, pega (spec §6 passo 6).
    if (!config.auto_assign) {
      const res = await resolveChatAssignee(supabase, workspaceId, config, { categoryId, contactId });
      if (res.pool.length > 0) {
        await supabase.from("user_notifications").insert(res.pool.map((c) => ({
          user_id: c.user_id,
          workspace_id: workspaceId,
          type: "lead_needs_human",
          title: "Lead aguardando atendimento",
          message: `Lead ${leadName || leadPhone} precisa de atendimento humano: ${reason}`,
          action_url: `/?lead=${leadId}`,
          related_lead_id: leadId,
          is_read: false,
        })));
      }
      return { success: true, queued: false };
    }

    let res = await resolveChatAssignee(supabase, workspaceId, config, { categoryId, contactId });

    // Pool vazio → fallback (spec §6 passo 5): least_loaded/round_robin refazem
    // o pool ignorando jornada e pausa; queue vai direto para a fila.
    if (!res.userId && config.fallback_strategy !== "queue") {
      res = await resolveChatAssignee(
        supabase, workspaceId,
        { ...config, strategy: config.fallback_strategy },
        { categoryId, contactId, ignoreSchedule: true },
      );
    }

    if (!res.userId) {
      console.log("[ROUTING] No agents available, adding to queue...");
      await supabase.from("lead_queues").upsert({
        workspace_id: workspaceId,
        lead_id: leadId,
        agent_id: agentId,
        category_id: categoryId,
        lead_phone: leadPhone,
        lead_name: leadName,
        status: "waiting",
        priority: getPriorityValue(priority),
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,lead_id" });
      return { success: true, queued: true };
    }

    await assignChatLead(supabase, {
      workspaceId, leadId, leadPhone, leadName,
      agentId, categoryId, priority, reason,
      userId: res.userId,
    });
    console.log(`[ROUTING] Selected agent: ${res.userName}`);
    return { success: true, assignedUserId: res.userId, assignedUserName: res.userName ?? "Agente" };
  } catch (error) {
    console.error("[ROUTING] Error:", error);
    return { success: false };
  }
}
```

4. `handleHandoff`, `getCategoryIdFromIntent`, `updateLeadInsights`, `sendSpecialistSuggestion` **ficam como estão** — `handleHandoff` já chama `routeLeadToHumanAgent` e monta as mensagens de handoff pelas mesmas chaves de retorno.

- [ ] **Step 2: Verificar que nada mais referencia o que foi removido**

Run: `grep -rn "getAvailableHumanAgents\|selectBestHumanAgent\|from(\"routing_config\")\|from('routing_config')" supabase/functions src`
Expected: nenhuma ocorrência

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/orchestrator/routing-handler.ts
git commit -m "feat(routing): handoff do orchestrator passa a usar o modulo compartilhado

A tabela routing_config (nunca escrita) deixa de ser lida; presenca vem da
jornada e a carga e derivada, corrigindo os defeitos 1, 2 e 3 do spec.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `schedule-appointment` — seleção via config + dono do card

**Files:**
- Modify: `supabase/functions/schedule-appointment/index.ts` (função `selectBestAgentForSlot`, linhas 563–631; call site linha 2763)

**Interfaces:**
- Consumes: `loadRoutingConfig`, `getSchedulingLoad`, `getCardOwner`, `selectAssignee`

- [ ] **Step 1: Adicionar imports no topo do arquivo** (junto do import de `googleCredentials`):

```ts
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { getSchedulingLoad } from "../_shared/routing/load.ts";
import { getCardOwner } from "../_shared/routing/owner.ts";
import { selectAssignee } from "../_shared/routing/select.ts";
```

- [ ] **Step 2: Reescrever `selectBestAgentForSlot`**

Substituir a função inteira (do comentário `// Select the best agent for a given slot using round-robin` até o fim do corpo dela) por:

```ts
// Seleciona o responsável pelo slot usando a configuração central de roteamento
// (spec §7). A elegibilidade (quem tem o slot livre) já chegou resolvida em
// availableAgentSlots — aqui é só a decisão.
async function selectBestAgentForSlot(
  supabase: any,
  workspaceId: string,
  availableAgentSlots: AgentSlot[],
  preferredDate: string,
  preferredTime: string,
  leadId: string | null
): Promise<AgentSlot | null> {
  const matchingSlots = availableAgentSlots.filter(
    slot => slot.date === preferredDate && slot.time === preferredTime
  );
  if (matchingSlots.length === 0) return null;
  if (matchingSlots.length === 1) {
    console.log("[SCHEDULE] Only one agent available for slot:", matchingSlots[0].agent_name);
    return matchingSlots[0];
  }

  const config = await loadRoutingConfig(supabase, workspaceId);

  // Contato que já tem card volta para o responsável dele (spec §7 passo 3) —
  // paridade com o comportamento que o widget já tinha.
  let ownerId: string | null = null;
  if (config.respect_card_owner && leadId) {
    const { data: leadRow } = await supabase
      .from("leads").select("contact_id").eq("id", leadId).maybeSingle();
    ownerId = await getCardOwner(supabase, workspaceId, leadRow?.contact_id ?? null);
  }

  const agentIds = [...new Set(matchingSlots.map(s => s.agent_id))];
  const loads = await getSchedulingLoad(supabase, workspaceId, agentIds, config.scheduling_load_window_days);
  const chosen = selectAssignee(agentIds, { strategy: config.scheduling_strategy, loads, ownerId });

  const selectedSlot = matchingSlots.find(s => s.agent_id === chosen);
  console.log("[SCHEDULE] Selected agent:", selectedSlot?.agent_name, "strategy:", config.scheduling_strategy);
  return selectedSlot || matchingSlots[0];
}
```

- [ ] **Step 3: Atualizar o call site (linha ~2763)** — acrescentar `lead_id` (em escopo, vem do `request`):

```ts
    const selectedSlot = await selectBestAgentForSlot(
      supabase,
      workspace_id,
      allAgentSlots,
      preferred_date,
      preferred_time,
      lead_id
    );
```

Se `lead_id` não estiver destructurado nesse escopo, use `request.lead_id`.

- [ ] **Step 4: Verificar**

Run: `grep -n "selectBestAgentForSlot" supabase/functions/schedule-appointment/index.ts`
Expected: exatamente 2 ocorrências (definição + call site com 6 argumentos). E `grep -n "sevenDaysAgo" supabase/functions/schedule-appointment/index.ts` → nenhuma ocorrência (a janela de 7 dias hardcoded morreu).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/schedule-appointment/index.ts
git commit -m "feat(routing): agendamento via IA usa estrategia, janela e dono do card da config central

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `schedule-widget` — seleção via config, sem `Math.random()`

**Files:**
- Modify: `supabase/functions/schedule-widget/index.ts` (bloco de distribuição ~1467–1493; bloco do dono ~1774–1803)

**Interfaces:**
- Consumes: `loadRoutingConfig`, `getSchedulingLoad`, `selectAssignee`

- [ ] **Step 1: Adicionar imports no topo** (junto de `googleCredentials`/`dnmarketing`):

```ts
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { getSchedulingLoad } from "../_shared/routing/load.ts";
import { selectAssignee } from "../_shared/routing/select.ts";
```

- [ ] **Step 2: Substituir o bloco de contagem/sorteio**

Localizar (após `const availableMembers = memberSlots.filter(...)` e o 409 de slot indisponível) o bloco que começa em `const thirtyDaysAgo = new Date();` e termina em `let selectedMemberId = sorted[0][0];`. Substituir por:

```ts
      const routingCfg = await loadRoutingConfig(supabase, widget.workspace_id);
      const memberIds = availableMembers.map(m => m.user_id);
      // Carga na janela configurada, incluindo completed/no_show (spec §7.1 —
      // a janela antiga de 30 dias sem completed lia quem atendeu muito como
      // ocioso). Desempate estável por user_id, nunca Math.random().
      const loadMap = await getSchedulingLoad(supabase, widget.workspace_id, memberIds, routingCfg.scheduling_load_window_days);
      // Distribuicao por carga define o padrao para contatos novos. Contato que
      // ja tem card volta para o responsavel dele — resolvido mais abaixo,
      // quando o lead e conhecido.
      let selectedMemberId = selectAssignee(memberIds, { strategy: routingCfg.scheduling_strategy, loads: loadMap })!;
```

(`selectAssignee` só devolve `null` para lista vazia; `availableMembers` já foi validado não-vazio acima — o `!` é seguro.)

- [ ] **Step 3: Condicionar o dono do card à config**

No bloco `// Contato que volta a agendar fica com o responsavel do card dele...` (~1785), trocar a condição:

```ts
      if (routingCfg.respect_card_owner && cardOwnerId && cardOwnerId !== selectedMemberId) {
```

(o resto do bloco — `ownerIsAvailable`, troca de slot, `console.warn` — fica idêntico).

- [ ] **Step 4: Verificar**

Run: `grep -n "Math.random\|thirtyDaysAgo" supabase/functions/schedule-widget/index.ts`
Expected: nenhuma ocorrência de `thirtyDaysAgo`; `Math.random` só pode sobrar em usos alheios à distribuição (ex.: geração de ids) — se sobrar no rodízio, a task falhou.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/schedule-widget/index.ts
git commit -m "feat(routing): widget de agendamento usa estrategia e janela da config central

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Edge function `routing-queue-worker`

**Files:**
- Create: `supabase/functions/routing-queue-worker/index.ts`
- Modify: `supabase/config.toml` (nova entrada de função)

**Interfaces:**
- Consumes: `loadRoutingConfig`, `resolveChatAssignee`, `assignChatLead`
- Produces: endpoint `POST /functions/v1/routing-queue-worker` → `{ assigned, cancelled, skipped }` (o cron da Task 15 o chama a cada 5 min)

- [ ] **Step 1: Implementar o worker**

```ts
// routing-queue-worker — esvazia lead_queues.status='waiting' (spec §9).
// Acionado por pg_cron a cada 5 min (migration da fase 2). Um cron único cobre
// os três eventos que liberam capacidade: entrada na jornada, despausa,
// encerramento de atendimento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadRoutingConfig } from "../_shared/routing/config.ts";
import { resolveChatAssignee } from "../_shared/routing/chat.ts";
import { assignChatLead } from "../_shared/routing/assign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface WaitingRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  lead_phone: string;
  lead_name: string | null;
  agent_id: string | null;
  category_id: string | null;
  priority: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: waiting, error } = await supabase
    .from("lead_queues")
    .select("id, workspace_id, lead_id, lead_phone, lead_name, agent_id, category_id, priority")
    .eq("status", "waiting")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  const byWorkspace = new Map<string, WaitingRow[]>();
  for (const row of (waiting || []) as WaitingRow[]) {
    const arr = byWorkspace.get(row.workspace_id) || [];
    arr.push(row);
    byWorkspace.set(row.workspace_id, arr);
  }

  let assigned = 0, cancelled = 0, skipped = 0;
  for (const [workspaceId, rows] of byWorkspace) {
    const config = await loadRoutingConfig(supabase, workspaceId);
    for (const row of rows) {
      // Revalida o lead (spec §9 passo 3): o trigger cobre o fechamento, mas
      // não as outras transições (alguém pegou no Inbox, a IA retomou).
      const { data: lead } = await supabase
        .from("leads")
        .select("id, status, contact_id")
        .eq("id", row.lead_id)
        .maybeSingle();
      if (!lead || lead.status !== "needs_human") {
        await supabase.from("lead_queues")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", row.id).eq("status", "waiting");
        cancelled++;
        continue;
      }

      const res = await resolveChatAssignee(supabase, workspaceId, config, {
        categoryId: row.category_id,
        contactId: lead.contact_id,
      });
      if (!res.userId) {
        // Pool esgotado neste workspace — os demais esperam o próximo tick.
        skipped += 1;
        break;
      }

      await assignChatLead(supabase, {
        workspaceId,
        leadId: row.lead_id,
        leadPhone: row.lead_phone,
        leadName: row.lead_name,
        agentId: row.agent_id,
        categoryId: row.category_id,
        priority: "normal",
        priorityValue: row.priority ?? 1,
        reason: "Fila de espera: atendente disponível",
        userId: res.userId,
      });
      assigned++;
    }
  }
  return json({ assigned, cancelled, skipped });
});
```

- [ ] **Step 2: Registrar em `supabase/config.toml`** (seguindo o padrão das entradas existentes):

```toml
[functions.routing-queue-worker]
verify_jwt = false
```

- [ ] **Step 3: Verificar sintaxe** (se o Deno estiver instalado: `deno check supabase/functions/routing-queue-worker/index.ts`; senão, revisão manual dos imports relativos).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/routing-queue-worker/index.ts supabase/config.toml
git commit -m "feat(routing): worker da fila de espera (esvaziamento a cada 5 min via cron)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend base — espelho puro + presença + hook

**Files:**
- Create: `src/lib/routing/workhours.ts`
- Create: `src/lib/routing/presence.ts`
- Create: `src/hooks/useChatPresence.ts`

**Interfaces:**
- Consumes: `Pill` (`PillStatus` de `@/components/dn/Pill`); RPC `chat_load_by_user` (via `(supabase.rpc as any)` até o types.ts regenerar)
- Produces:
  - `isWithinWorkingHours`, `AgentCalendar`, `DEFAULT_CALENDAR` (espelho browser)
  - `PresenceState = "available" | "outside_hours" | "paused" | "at_capacity"`
  - `computePresence(input: { calendar: Partial<AgentCalendar>|null; holidays: ReadonlySet<string>; isAcceptingLeads: boolean; load: number; maxConcurrentLeads: number; at?: Date }): PresenceState`
  - `PRESENCE_LABEL: Record<PresenceState, string>`, `PRESENCE_PILL: Record<PresenceState, PillStatus>`
  - `useChatPresence(workspaceId: string | undefined): { presence: Map<string, MemberPresence>; isLoading: boolean }` com `MemberPresence = { state: PresenceState; load: number; maxConcurrentLeads: number; isAcceptingLeads: boolean; workWindow: string }`

- [ ] **Step 1: `src/lib/routing/workhours.ts`**

Espelho de `supabase/functions/_shared/routing/workhours.ts` — copiar o conteúdo dos Steps 3–4 da Task 2 (tipos `AgentCalendar`/`DEFAULT_CALENDAR` inlined neste arquivo em vez de importados de `./types.ts`), com o cabeçalho:

```ts
// ESPELHO de supabase/functions/_shared/routing/workhours.ts (spec §5.2).
// O frontend não importa código Deno; este arquivo só ROTULA — a decisão de
// roteamento é sempre do backend. Alterações lá devem ser replicadas aqui.
```

- [ ] **Step 2: `src/lib/routing/presence.ts`**

```ts
// Estado de presença de chat derivado (spec §8, §10.1).
import type { PillStatus } from "@/components/dn/Pill";
import { AgentCalendar, isWithinWorkingHours } from "./workhours";

export type PresenceState = "available" | "outside_hours" | "paused" | "at_capacity";

export interface PresenceInput {
  calendar: Partial<AgentCalendar> | null;
  holidays: ReadonlySet<string>;
  isAcceptingLeads: boolean;
  load: number;
  maxConcurrentLeads: number;
  at?: Date;
}

export function computePresence(input: PresenceInput): PresenceState {
  if (!isWithinWorkingHours(input.calendar, input.holidays, input.at)) return "outside_hours";
  if (!input.isAcceptingLeads) return "paused";
  if (input.load >= input.maxConcurrentLeads) return "at_capacity";
  return "available";
}

export const PRESENCE_LABEL: Record<PresenceState, string> = {
  available: "Disponível",
  outside_hours: "Fora do horário",
  paused: "Pausado",
  at_capacity: "Sem capacidade",
};

export const PRESENCE_PILL: Record<PresenceState, PillStatus> = {
  available: "success",
  outside_hours: "neutral",
  paused: "warning",
  at_capacity: "warning",
};
```

- [ ] **Step 3: `src/hooks/useChatPresence.ts`**

```ts
// Presença derivada dos membros do workspace para as telas de roteamento
// (spec §10.1). Só leitura e rótulo — a decisão é do backend.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CALENDAR, type AgentCalendar } from "@/lib/routing/workhours";
import { computePresence, type PresenceState } from "@/lib/routing/presence";

export interface MemberPresence {
  state: PresenceState;
  load: number;
  maxConcurrentLeads: number;
  isAcceptingLeads: boolean;
  /** Janela exibida ao lado de "Fora do horário", ex.: "09:00–18:00". */
  workWindow: string;
}

export function useChatPresence(workspaceId: string | undefined) {
  const query = useQuery({
    queryKey: ["chat-presence", workspaceId],
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const wsId = workspaceId!;
      const [{ data: ws }, { data: members }] = await Promise.all([
        supabase.from("workspaces").select("owner_id").eq("id", wsId).single(),
        supabase.from("workspace_members").select("user_id").eq("workspace_id", wsId).eq("status", "active"),
      ]);
      const ids = new Set<string>();
      if (ws?.owner_id) ids.add(ws.owner_id);
      for (const m of members || []) ids.add(m.user_id);
      const userIds = [...ids];
      if (userIds.length === 0) return new Map<string, MemberPresence>();

      const [calRes, avRes, holRes, loadRes] = await Promise.all([
        supabase.from("crm_agent_calendars")
          .select("agent_id, work_days, work_start_time, work_end_time, timezone")
          .eq("workspace_id", wsId),
        supabase.from("agent_availability")
          .select("user_id, is_accepting_leads, max_concurrent_leads")
          .eq("workspace_id", wsId),
        supabase.from("crm_holidays").select("date").eq("workspace_id", wsId),
        // RPC ainda fora do types.ts gerado — padrão do projeto (useFlows.ts)
        (supabase.rpc as any)("chat_load_by_user", { p_workspace_id: wsId, p_user_ids: userIds }),
      ]);

      const calMap = new Map<string, Partial<AgentCalendar>>(
        (calRes.data || []).map((c: any) => [c.agent_id, c]),
      );
      const avMap = new Map<string, any>((avRes.data || []).map((a: any) => [a.user_id, a]));
      const holidays = new Set<string>(((holRes.data || []) as Array<{ date: string }>).map((h) => h.date));
      const loads = new Map<string, number>(
        ((loadRes.data || []) as Array<{ user_id: string; load: number }>).map((r) => [r.user_id, Number(r.load) || 0]),
      );

      const result = new Map<string, MemberPresence>();
      for (const uid of userIds) {
        const cal = calMap.get(uid) ?? null;
        const av = avMap.get(uid);
        const load = loads.get(uid) ?? 0;
        const maxConcurrentLeads = av?.max_concurrent_leads ?? 10;
        const isAcceptingLeads = av?.is_accepting_leads ?? true;
        result.set(uid, {
          state: computePresence({ calendar: cal, holidays, isAcceptingLeads, load, maxConcurrentLeads }),
          load,
          maxConcurrentLeads,
          isAcceptingLeads,
          workWindow: `${cal?.work_start_time || DEFAULT_CALENDAR.work_start_time}–${cal?.work_end_time || DEFAULT_CALENDAR.work_end_time}`,
        });
      }
      return result;
    },
  });
  return { presence: query.data ?? new Map<string, MemberPresence>(), isLoading: query.isLoading };
}
```

- [ ] **Step 4: Tipos e commit**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

```bash
git add src/lib/routing/workhours.ts src/lib/routing/presence.ts src/hooks/useChatPresence.ts
git commit -m "feat(routing): presenca derivada no frontend (espelho de jornada + hook)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `RoutingConfig.tsx` — campos honestos, seção de agendamento, presença e fila

**Files:**
- Modify: `src/pages/RoutingConfig.tsx`

**Interfaces:**
- Consumes: `useChatPresence`, `PRESENCE_LABEL`, `PRESENCE_PILL` (Task 9); `Pill`, `EmptyState` de `@/components/dn`

- [ ] **Step 1: Estado e fetch**

1. Em `WorkspaceRoutingConfig` e `globalForm`, adicionar `respect_card_owner: boolean` (default `true`), `scheduling_strategy: string` (default `"least_loaded"`), `scheduling_load_window_days: number` (default `30`); preencher no `fetchData` a partir de `configData` (com os mesmos `??`).
2. `HumanMember`: **remover** os campos `status` e `current_leads_count` da interface e de toda a montagem em `fetchData` (as linhas `status: (availability?.status ...)` e `current_leads_count: ...` somem; `is_accepting_leads` e `max_concurrent_leads` ficam).
3. Adicionar dentro do componente: `const { presence } = useChatPresence(currentWorkspace?.id);`
4. Adicionar a query da fila (mesmo padrão do hook, direto no arquivo):

```ts
  const { data: waitingLeads } = useQuery({
    queryKey: ["routing-waiting-queue", currentWorkspace?.id],
    enabled: !!currentWorkspace,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("lead_queues")
        .select("id, lead_id, lead_name, lead_phone, priority, created_at")
        .eq("workspace_id", currentWorkspace!.id)
        .eq("status", "waiting")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });
```

(importar `useQuery` de `@tanstack/react-query`.)

- [ ] **Step 2: Estratégias e campos desabilitados** (spec §10.4)

1. `STRATEGIES`: acrescentar `disabled?: boolean` aos itens; marcar `skill_based`, `performance_based`, `category_based` com `disabled: true` e sufixo `" (em breve)"` no `label`. No `SelectItem`, passar `disabled={strategy.disabled}`.
2. Input "Timeout de Fila (minutos)": `disabled` + trocar o hint para `<p className="text-xs text-muted-foreground">Em breve — a fila é esvaziada automaticamente quando um atendente fica disponível.</p>`.
3. Switches "Requer Aprovação" e "Matching por Habilidade": `disabled` + acrescentar `(em breve)` na descrição.
4. Corrigir a acentuação das strings tocadas neste arquivo (`Configuração`, `distribuídos`, `atribuídas`, etc. — regra global).

- [ ] **Step 3: Switch "Respeitar responsável do card"** — novo item no grid de toggles:

```tsx
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Respeitar responsável do card</Label>
                <p className="text-xs text-muted-foreground">Contato com card no CRM volta para o dono dele, sem rodízio</p>
              </div>
              <Switch
                checked={globalForm.respect_card_owner}
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, respect_card_owner: checked }))}
              />
            </div>
```

- [ ] **Step 4: Card "Distribuição de agendamentos"** (spec §10.3) — novo `Card` entre a Configuração Global e o card de Atendentes:

```tsx
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Distribuição de agendamentos
          </CardTitle>
          <CardDescription>
            Regras aplicadas quando uma reunião é marcada pelo widget ou pelo WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Estratégia de distribuição</Label>
              <Select
                value={globalForm.scheduling_strategy}
                onValueChange={(value) => setGlobalForm(prev => ({ ...prev, scheduling_strategy: value }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="least_loaded">Menos carregado</SelectItem>
                  <SelectItem value="round_robin">Distribuição sequencial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Janela de cálculo de carga (dias)</Label>
              <Input
                type="number"
                min={7}
                max={90}
                value={globalForm.scheduling_load_window_days}
                onChange={(e) => setGlobalForm(prev => ({
                  ...prev,
                  scheduling_load_window_days: Math.max(7, Math.min(90, parseInt(e.target.value) || 30)),
                }))}
              />
              <p className="text-xs text-muted-foreground">Reuniões neste período contam como carga, incluindo as já realizadas</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O <strong>time</strong> de cada widget é definido em{" "}
            <Link to="/settings/scheduling-widgets" className="text-primary underline-offset-2 hover:underline">Widgets de agendamento</Link>;
            o time do agendamento por WhatsApp, na configuração do agente de IA. Esta página governa as regras.
          </p>
        </CardContent>
      </Card>
```

(importar `Link` de `react-router-dom`; o botão Salvar da Configuração Global persiste tudo — `saveGlobalConfig` já espalha o `globalForm` inteiro.)

- [ ] **Step 5: Card de Atendentes com presença derivada** (spec §10.1)

No card "Atendentes Humanos":

1. Trocar a `CardDescription` para `Configure capacidade e categorias de cada atendente — disponibilidade vale para o chat; agendamentos seguem o time de cada widget`.
2. No corpo de cada membro, substituir o bloco de status (`STATUS_CONFIG[member.status]`) e a "Carga atual" por presença derivada:

```tsx
  const p = presence.get(member.user_id);
  const state = p?.state ?? "available";
```

```tsx
                <Pill status={PRESENCE_PILL[state]}>
                  {PRESENCE_LABEL[state]}
                  {state === "outside_hours" && p ? ` · ${p.workWindow}` : ""}
                </Pill>
```

e a barra de carga usa `p?.load ?? 0` sobre `member.max_concurrent_leads` (`{p?.load ?? 0}/{member.max_concurrent_leads}`).
3. Remover `STATUS_CONFIG` e os imports que ficarem órfãos (`CheckCircle2`, `XCircle`, `Pause` se não usados).
4. Aviso quando ninguém está disponível — logo abaixo do header do card:

```tsx
          {members.length > 0 && ![...presence.values()].some(p => p.state === "available") && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--dn-amber)]/30 bg-[var(--dn-amber)]/10 p-3 text-sm text-[var(--dn-amber)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Nenhum atendente disponível agora — novos leads de chat vão para a fila de espera.
            </div>
          )}
```

- [ ] **Step 6: Bloco "Fila de espera"** (spec §10.2) — dentro do card de Atendentes, após a grade de membros:

```tsx
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Fila de espera</h3>
              <Pill status={(waitingLeads?.length ?? 0) > 0 ? "warning" : "neutral"}>
                {waitingLeads?.length ?? 0}
              </Pill>
            </div>
            {(waitingLeads?.length ?? 0) === 0 ? (
              <EmptyState icon={Users} title="Fila vazia" description="Nenhum lead aguardando atendente" />
            ) : (
              <div className="space-y-2">
                {waitingLeads!.map((q) => (
                  <div key={q.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
                    <div>
                      <p className="font-medium">{q.lead_name || q.lead_phone}</p>
                      <p className="text-xs text-muted-foreground">
                        Aguardando desde {new Date(q.created_at!).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/?lead=${q.lead_id}`}>Abrir no Inbox</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
```

(importar `Pill` e `EmptyState` de `@/components/dn/Pill` / `@/components/dn/EmptyState`.)

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit && npm run lint -- src/pages/RoutingConfig.tsx` e a auditoria de cor do CLAUDE.md sobre o arquivo.
Expected: sem erros; nenhuma cor crua.

- [ ] **Step 8: Commit**

```bash
git add src/pages/RoutingConfig.tsx
git commit -m "feat(routing): pagina de roteamento com presenca derivada, secao de agendamento e fila visivel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Transferência manual — remover o bloqueio, rotular a disponibilidade

**Files:**
- Modify: `src/lib/routing/transferLead.ts`
- Modify: `src/components/chat/TransferDialog.tsx`

**Interfaces:**
- Consumes: `useChatPresence`, `PRESENCE_LABEL`, `PRESENCE_PILL`

- [ ] **Step 1: `transferLead.ts`**

1. **Remover** o bloco 1 inteiro (fetch de `agent_availability` + `if (targetAvailability.status !== 'online') return ...` — linhas ~22-32). É a correção do defeito 5: quem transfere está escolhendo uma pessoa de propósito (spec §5.2).
2. **Remover** a função `updateAgentLeadCount` e as duas chamadas do passo 5 (`current_leads_count` está morrendo; a carga é derivada).
3. **Remover** `transferToCategory` (nenhum componente a importa; usa `status='online'` e o contador — morre junto).
4. O upsert do passo 2 em `lead_queues` ganha `status: "assigned", assigned_at: new Date().toISOString()` no objeto do `.update(...)` (transferência re-ancora a fila no novo atendente).

- [ ] **Step 2: `TransferDialog.tsx`**

1. Trocar o fetch de `agent_availability` (`status, current_leads_count, ...`) pelo hook: `const { presence } = useChatPresence(workspaceId);`. A interface `WorkspaceMember` perde `status`/`current_leads_count`.
2. Ordenação da lista: disponíveis primeiro, depois por carga — `const pa = presence.get(a.user_id); ...` com `(pa?.state === "available" ? 0 : 1) - (pb?.state === "available" ? 0 : 1) || (pa?.load ?? 0) - (pb?.load ?? 0)`.
3. Onde o item mostrava status/carga, renderizar `<Pill status={PRESENCE_PILL[state]}>{PRESENCE_LABEL[state]}</Pill>` e `{p?.load ?? 0}/{p?.maxConcurrentLeads ?? 10} leads`.
4. `isAtCapacity` passa a ser `(p?.load ?? 0) >= (p?.maxConcurrentLeads ?? 10)` e **não desabilita** a seleção — vira só o `Pill` de aviso (disponibilidade nunca é impedimento na transferência).

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run lint -- src/lib/routing/transferLead.ts src/components/chat/TransferDialog.tsx`
Expected: sem erros. `grep -n "not online" src/lib/routing/transferLead.ts` → nada.

- [ ] **Step 4: Commit**

```bash
git add src/lib/routing/transferLead.ts src/components/chat/TransferDialog.tsx
git commit -m "fix(routing): transferencia manual nunca e bloqueada por presenca; disponibilidade vira rotulo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `AgentAvailability.tsx` simplificada + remoção do código morto

**Files:**
- Modify: `src/pages/AgentAvailability.tsx`
- Modify: `src/lib/routing/index.ts`
- Delete: `src/lib/routing/routeLeadToAgent.ts`, `src/lib/routing/processWaitingQueue.ts`, `src/lib/routing/resolveLead.ts`

- [ ] **Step 1: `AgentAvailability.tsx`** (spec §8, último parágrafo)

1. **Remover** `updateStatus` e o seletor online/busy/offline da UI. O tipo `AgentStatus` e referências a `availability.status` somem.
2. **Adicionar** o toggle de pausa (grava `is_accepting_leads`):

```ts
  const togglePause = async (accepting: boolean) => {
    if (!workspaceId || !userId) return;
    setIsSaving(true);
    const { error } = await supabase
      .from("agent_availability")
      .update({ is_accepting_leads: accepting, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao atualizar", description: error.message });
    } else {
      setAvailability(prev => prev ? { ...prev, is_accepting_leads: accepting } : null);
      toast({ title: accepting ? "Recebendo leads" : "Pausado", description: accepting ? "Você voltou a receber novos leads de chat." : "Você não receberá novos leads até despausar." });
    }
    setIsSaving(false);
  };
```

com um `Switch` rotulado "Receber novos leads" e a descrição "A disponibilidade segue seu horário de trabalho; a pausa vale dentro dele".
3. **Mostrar a jornada vigente**: buscar `crm_agent_calendars` do próprio usuário (`.eq("workspace_id", workspaceId).eq("agent_id", userId).maybeSingle()`) e exibir `workWindow` + dias + o estado atual via `computePresence` (reutilizar `presence.ts`; para a própria carga, usar `(supabase.rpc as any)("chat_load_by_user", { p_workspace_id: workspaceId, p_user_ids: [userId] })`).
4. No insert de linha default (linhas ~95-105), **remover** `status: "offline"` e `current_leads_count: 0` do objeto (colunas em extinção; os defaults do banco cobrem até o Push 2).
5. O contador "Carga atual" (linhas ~346-367) usa a carga da RPC, não `availability.current_leads_count`.
6. A lista de atendimentos (`lead_queues` assigned/in_progress) fica como está.

- [ ] **Step 2: Deletar os arquivos mortos e encolher o índice**

```bash
git rm src/lib/routing/routeLeadToAgent.ts src/lib/routing/processWaitingQueue.ts src/lib/routing/resolveLead.ts
```

`src/lib/routing/index.ts` passa a ser:

```ts
// Roteamento no frontend: só a transferência manual. A decisão de roteamento
// vive em supabase/functions/_shared/routing/ (spec §5.1); aqui ficam os
// rótulos (workhours/presence) e a ação humana explícita de transferir.
export { transferLead } from './transferLead';
```

- [ ] **Step 3: Verificar que nada quebrou**

Run: `grep -rn "processWaitingQueue\|resolveLead\|routeLeadToAgent\|transferToCategory\|onAgentOnline\|onAgentOffline\|onAgentBusy\|abandonLead\|startLead" src/`
Expected: nenhuma ocorrência. Depois `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/routing src/pages/AgentAvailability.tsx
git commit -m "refactor(routing): disponibilidade segue a jornada; remove motor morto do frontend

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Triple sync (OpenAPI + test-api) e smoke script

**Files:**
- Modify: `public/openapi.yaml` (schemas `RoutingConfig` ~linha 1381 e `UpdateRoutingConfig` ~linha 2656), `public/openapi.json` (mesmos schemas)
- Modify: `scripts/test-api.ts` (`phase12_routing`, ~linha 673)
- Create: `scripts/test-routing.ts`

- [ ] **Step 1: OpenAPI** — nos dois schemas, acrescentar às `properties`:

```yaml
        respect_card_owner:
          type: boolean
          description: Contato com card aberto no CRM volta para o responsável dele, sem rodízio
        scheduling_strategy:
          type: string
          enum: [least_loaded, round_robin]
        scheduling_load_window_days:
          type: integer
          minimum: 1
          description: Janela em dias para o cálculo de carga de agendamentos
```

Refletir o mesmo em `public/openapi.json` (bloco `RoutingConfig` e `UpdateRoutingConfig` — mesmas três propriedades em JSON). Se `src/docs/openapi.*` existir com esses schemas, replicar lá também (é a cópia do docs viewer, CLAUDE.md).

- [ ] **Step 2: `scripts/test-api.ts`** — no `phase12_routing()`, estender o corpo do PUT:

```ts
  await test("PUT", "/routing/config", {
    strategy: "least_loaded",
    auto_assign: true,
    respect_card_owner: true,
    scheduling_strategy: "least_loaded",
    scheduling_load_window_days: 30,
  });
```

- [ ] **Step 3: `scripts/test-routing.ts`** (spec §12 — integração; roda onde houver service key):

```ts
// scripts/test-routing.ts — smoke do roteamento centralizado (spec §12).
// Roda contra o Supabase com service role. Cria dados _routetest e limpa no fim.
// Uso: npx tsx scripts/test-routing.ts
// (Os testes puros de jornada/seleção estão em scripts/test-routing-unit.ts.)
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.TEST_WORKSPACE_ID;
if (!url || !key || !workspaceId) {
  console.error("Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e TEST_WORKSPACE_ID");
  process.exit(1);
}
const db = createClient(url, key);

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`, extra ?? ""); }
}
const suffix = Math.random().toString(36).slice(2, 7);
const cleanup: Array<() => Promise<void>> = [];

async function main() {
  const { data: ws } = await db.from("workspaces").select("id, owner_id").eq("id", workspaceId).single();
  if (!ws) throw new Error("TEST_WORKSPACE_ID inválido");
  const ownerId = ws.owner_id as string;

  // -- RPC de carga de chat: uma linha por candidato, zero para quem não tem fila
  const { data: load0, error: loadErr } = await db.rpc("chat_load_by_user", {
    p_workspace_id: workspaceId, p_user_ids: [ownerId],
  });
  ok("chat_load_by_user responde", !loadErr, loadErr?.message);
  ok("uma linha por candidato", (load0 || []).length === 1, load0);

  // -- Lead de teste em needs_human + linha na fila
  const phone = `5511988${Math.floor(100000 + Math.random() * 899999)}`;
  const { data: lead, error: leadErr } = await db.from("leads")
    .insert({ workspace_id: workspaceId, phone, name: `_routetest ${suffix}`, status: "needs_human" })
    .select("id").single();
  if (leadErr || !lead) throw new Error(`setup lead falhou: ${leadErr?.message}`);
  cleanup.push(async () => { await db.from("leads").delete().eq("id", lead.id); });

  const { error: qErr } = await db.from("lead_queues").upsert({
    workspace_id: workspaceId, lead_id: lead.id, lead_phone: phone,
    lead_name: `_routetest ${suffix}`, status: "assigned",
    assigned_to_user_id: ownerId, priority: 1,
    assigned_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,lead_id" });
  ok("upsert em lead_queues (UNIQUE workspace,lead)", !qErr, qErr?.message);
  cleanup.push(async () => { await db.from("lead_queues").delete().eq("lead_id", lead.id); });

  // -- Carga derivada reflete a fila
  const { data: load1 } = await db.rpc("chat_load_by_user", {
    p_workspace_id: workspaceId, p_user_ids: [ownerId],
  });
  const before = Number(load1?.[0]?.load ?? -1);
  ok("carga derivada conta o lead atribuído", before >= 1, load1);

  // -- Trigger de encerramento: fechar o lead completa a fila e zera a carga
  await db.from("leads").update({ status: "closed" }).eq("id", lead.id);
  const { data: qRow } = await db.from("lead_queues").select("status, completed_at").eq("lead_id", lead.id).single();
  ok("trigger completa a linha da fila", qRow?.status === "completed" && !!qRow?.completed_at, qRow);
  const { data: load2 } = await db.rpc("chat_load_by_user", {
    p_workspace_id: workspaceId, p_user_ids: [ownerId],
  });
  ok("carga volta a cair após encerrar", Number(load2?.[0]?.load ?? -1) === before - 1, load2);

  // -- Trigger cancela waiting de lead fechado
  const { data: lead2, error: lead2Err } = await db.from("leads")
    .insert({ workspace_id: workspaceId, phone: phone.replace("5511988", "5511987"), name: `_routetest2 ${suffix}`, status: "needs_human" })
    .select("id").single();
  if (lead2Err || !lead2) throw new Error(`setup lead2 falhou: ${lead2Err?.message}`);
  cleanup.push(async () => { await db.from("leads").delete().eq("id", lead2.id); });
  await db.from("lead_queues").upsert({
    workspace_id: workspaceId, lead_id: lead2.id, lead_phone: "x", status: "waiting", priority: 1,
  }, { onConflict: "workspace_id,lead_id" });
  cleanup.push(async () => { await db.from("lead_queues").delete().eq("lead_id", lead2.id); });
  await db.from("leads").update({ status: "closed" }).eq("id", lead2.id);
  const { data: q2 } = await db.from("lead_queues").select("status").eq("lead_id", lead2.id).single();
  ok("trigger cancela waiting de lead fechado", q2?.status === "cancelled", q2);

  // -- RPC de carga de agendamento inclui completed (defeito 6)
  const { data: apptLoad, error: apptErr } = await db.rpc("scheduling_load_by_user", {
    p_workspace_id: workspaceId, p_user_ids: [ownerId], p_window_days: 30,
  });
  ok("scheduling_load_by_user responde", !apptErr, apptErr?.message);
  ok("uma linha por candidato (agendamento)", (apptLoad || []).length === 1, apptLoad);

  // -- Config: colunas novas aceitam escrita e o CHECK rejeita estratégia inválida
  const { error: cfgErr } = await db.from("workspace_routing_config").upsert({
    workspace_id: workspaceId, strategy: "least_loaded",
    respect_card_owner: true, scheduling_strategy: "round_robin", scheduling_load_window_days: 30,
  }, { onConflict: "workspace_id" });
  ok("config aceita colunas novas", !cfgErr, cfgErr?.message);
  const { error: badErr } = await db.from("workspace_routing_config")
    .update({ scheduling_strategy: "banana" }).eq("workspace_id", workspaceId);
  ok("CHECK rejeita scheduling_strategy inválida", !!badErr);
  await db.from("workspace_routing_config")
    .update({ scheduling_strategy: "least_loaded" }).eq("workspace_id", workspaceId);
}

main()
  .catch((e) => { failed++; console.error("ERRO:", e); })
  .finally(async () => {
    for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* cleanup em cascata */ } }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
```

- [ ] **Step 4: Commit**

```bash
git add public/openapi.yaml public/openapi.json scripts/test-api.ts scripts/test-routing.ts
git commit -m "docs(api): campos novos de roteamento no OpenAPI + smoke tests do motor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Push 1 e validação em produção

- [ ] **Step 1: Gate local completo**

```bash
npx tsx scripts/test-routing-unit.ts && npx tsc --noEmit && npm run lint && npm run build
```

Expected: unit 16/16, sem erros de tipo, lint sem erros novos, build ok. Auditoria de cor do CLAUDE.md limpa nos `.tsx` tocados.

- [ ] **Step 2: Push**

```bash
git push origin main
```

O Lovable builda, aplica a migration da Task 1 e deploya as functions. **Lembrete das memórias do projeto**: o deploy do frontend pode exigir Share > Publish no editor Lovable; confirmar o bundle no ar pelo hash do chunk no `index.html` (cache reload).

- [ ] **Step 3: Validar o banco (SQL no editor do Lovable)**

```sql
-- colunas novas
SELECT respect_card_owner, scheduling_strategy, scheduling_load_window_days
FROM workspace_routing_config LIMIT 1;
-- trigger instalado
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_close_routing_on_lead_close';
-- RPCs
SELECT proname FROM pg_proc WHERE proname IN ('chat_load_by_user', 'scheduling_load_by_user');
-- backfill: nada aberto de lead fechado
SELECT count(*) FROM lead_queues q JOIN leads l ON q.lead_id = l.id::text
WHERE l.status = 'closed' AND q.status IN ('waiting', 'assigned', 'in_progress');
-- esperado: 0
```

- [ ] **Step 4: Validar comportamento**

1. `/settings/routing`: estados de presença coerentes com o horário atual; estratégias "em breve" desabilitadas; salvar a seção de agendamentos e recarregar.
2. Widget: fazer um agendamento de teste e conferir no log da function que a estratégia veio da config.
3. Transferência manual no Inbox para alguém "Fora do horário": deve **completar** (defeito 5 morto).
4. Invocar o worker manualmente (o cron ainda não existe): `curl -X POST https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/routing-queue-worker -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d '{}'` → `{"assigned":0,"cancelled":N,"skipped":0}` sem erro.

**Só avance para a Task 15 com tudo acima verde.** Se algo falhar, corrigir e repetir — os drops do Push 2 são irreversíveis.

---

### Task 15 (Push 2): Drops e cron

**Files:**
- Create: `supabase/migrations/20260829100000_routing_centralization_drops.sql`
- Create: `supabase/migrations/20260829100001_routing_queue_worker_cron.sql`

- [ ] **Step 1: Confirmar que nenhum código vivo lê o que será dropado**

```bash
grep -rn "current_leads_count\|routing_config\b" src supabase/functions --include=*.ts --include=*.tsx | grep -v types.ts | grep -v workspace_routing_config
grep -rn "agent_availability" src supabase/functions --include=*.ts --include=*.tsx | grep -v types.ts | xargs -I{} echo {} | grep -n "status" || true
```

Expected: nenhuma leitura de `agent_availability.status`, `current_leads_count` ou da tabela `routing_config`. (O `types.ts` ainda vai citá-los até o Lovable regenerar — ignorar.)

- [ ] **Step 2: Migration de drops**

```sql
-- Centralização do Roteamento — fase 2 (spec §11 passos 4–5).
-- Rodar SOMENTE depois do código da fase 1 validado no ar: estas remoções
-- eliminam a segunda fonte de verdade (presença manual e contador de carga).

-- Tabela fantasma: criada em 20251212025724, nunca recebeu escrita (defeito 1).
DROP TABLE IF EXISTS public.routing_config;

-- Presença manual e contador que só sobe (defeitos 2 e 3): a presença agora
-- deriva da jornada e a carga das RPCs.
DROP INDEX IF EXISTS public.idx_agent_availability_status;
ALTER TABLE public.agent_availability
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS current_leads_count;
```

- [ ] **Step 3: Migration do cron** (padrão de `20260813122000_crm_flows_worker_cron.sql` — mesma anon key pública):

```sql
-- Fila de roteamento — tick a cada 5 minutos (spec §9). Versionado em migration
-- de propósito, como o flow-worker.
SELECT cron.unschedule('routing-queue-worker-every-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'routing-queue-worker-every-5min');

SELECT cron.schedule(
  'routing-queue-worker-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/routing-queue-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwYnZuYnVieHlhaWh5Z254ZGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwOTk4MDIsImV4cCI6MjA4MDY3NTgwMn0.vzLjyMKpGIucsgVsYzWryjNDjEYmItzwOdkuflpWg3M"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 4: Commit e push**

```bash
git add supabase/migrations/20260829100000_routing_centralization_drops.sql supabase/migrations/20260829100001_routing_queue_worker_cron.sql
git commit -m "feat(routing): fase 2 — drops da tabela fantasma e das colunas de presenca manual; cron do worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

**Atenção (memória do projeto)**: o Lovable às vezes cria migration própria duplicando SQL já commitado — se o editor propuser isso, recusar/apontar para as migrations já existentes.

- [ ] **Step 5: Validação final (SQL no Lovable)**

```sql
SELECT to_regclass('public.routing_config');          -- esperado: NULL
SELECT column_name FROM information_schema.columns
WHERE table_name = 'agent_availability';               -- sem status/current_leads_count
SELECT jobname, schedule FROM cron.job
WHERE jobname = 'routing-queue-worker-every-5min';     -- 1 linha, */5 * * * *
```

E em ~10 minutos: `SELECT status, count(*) FROM lead_queues GROUP BY status;` — nenhum `waiting` antigo sobrevivendo com pool disponível. Depois do Lovable regenerar `types.ts`, os casts `(supabase.rpc as any)` podem ser removidos numa limpeza futura (não bloqueia).

---

## Self-Review (executado na escrita do plano)

- **Cobertura do spec**: §4.1–4.6 → Task 1; §5.1 → Tasks 2–4; §6 → Tasks 4–5; §7 → Tasks 6–7; §9 → Tasks 8 e 15; §8 e §10 → Tasks 9–12; triple sync e §12 → Task 13; §11 → Tasks 14–15. `queue_timeout_minutes`/`require_approval`/`skill_matching`/estratégias fantasma → desabilitados na Task 10 (spec §10.4).
- **Divergências conscientes do spec**, resolvidas pelo recon: CHECK de `lead_queues` estendido para `'cancelled'` (recon 3); `UNIQUE agent_availability` criado para os upserts (recon 4); RPC extra `scheduling_load_by_user` no lugar de select+contagem no cliente (teto de 1000 linhas).
- **Consistência de tipos**: assinaturas dos blocos *Interfaces* conferidas entre Tasks 2→3→4→5–8 e 9→10–12 (`resolveChatAssignee(supabase, workspaceId, config, opts)`, `assignChatLead(supabase, params)`, `useChatPresence → Map<string, MemberPresence>`).
