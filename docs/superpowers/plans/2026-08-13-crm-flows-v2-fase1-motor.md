# Fluxos de CRM v2 — Fase 1 (Motor) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de execução dos Fluxos de CRM: tabelas, validação de grafo no banco, triggers de inscrição/saída, RPC de claim, worker Deno e script de testes — sem nenhuma UI e sem tocar na v1.

**Architecture:** Máquina de estados por lead portada do motor de journeys do ai-fastlane. O grafo vive em `crm_flows.nodes` (JSONB validado por trigger); a posição de cada lead vive em `crm_flow_runs` (claim via `FOR UPDATE SKIP LOCKED` + lease + fencing token); cada passo executado gera linha em `crm_flow_step_log`. O worker (`flow-worker`, pg_cron 1/min) executa nós até encontrar espera ou fim.

**Tech Stack:** Postgres (plpgsql, pg_cron, RLS), Supabase Edge Functions (Deno), Z-API via `zapi-send`, Resend via `_shared/resendCredentials.ts`, Gemini via `_shared/geminiClient.ts`.

**Spec:** `docs/superpowers/specs/2026-08-13-crm-flows-v2-design.md`

## Global Constraints

- **v1 intocada**: NÃO modificar `cadence_rules`, `cadence_templates`, `cadence_scheduled_messages`, `cadence-dispatcher`, nem os triggers `trg_lead_stage_cadence_sync` / `trg_cancel_cadence_on_lead_close`.
- Migrations em `supabase/migrations/` com timestamp + nome descritivo (padrão do projeto).
- Edge functions com `verify_jwt = false` em `supabase/config.toml` (padrão do projeto; segurança via RLS/service_role).
- RLS: SELECT para `is_workspace_member` OR dono do workspace OR `has_role('super_admin')` OR `has_role('admin')` (padrão de `crm_segments`, migration `20260730180226`); escrita em `crm_flow_runs`/`crm_flow_step_log` só `service_role`.
- Aplicação das migrations: `npx supabase db push` OU push na `main` (o Lovable aplica; conferir no editor que ele não duplicou a migration).
- Mensagens de erro/log em português onde visíveis ao usuário; identificadores em inglês.
- Commits pequenos por task; mensagem termina com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Fluxos de teste do script usam APENAS nós `delay`/`branch`/`close_lead` (zero envios externos).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260813120000_crm_flows_core.sql` | Tabelas, índices, RLS, updated_at |
| `supabase/migrations/20260813120500_crm_flows_validation.sql` | Validação do grafo + efeitos de UPDATE em `crm_flows` (arquivar, nós excluídos) |
| `supabase/migrations/20260813121000_crm_flows_lead_triggers.sql` | Inscrição/saída por `stage_id` e encerramento por `status` em `crm_leads` |
| `supabase/migrations/20260813121500_crm_flows_claim_rpc.sql` | `flow_claim_due_runs` |
| `supabase/migrations/20260813122000_crm_flows_worker_cron.sql` | pg_cron do worker (1/min) |
| `supabase/functions/flow-worker/index.ts` | Entry point: claim + loop de runs |
| `supabase/functions/flow-worker/executor.ts` | Execução nó a nó de um run |
| `supabase/functions/flow-worker/conditions.ts` | Avaliador do nó `branch` |
| `supabase/functions/flow-worker/sending.ts` | Envio WhatsApp (porte do dispatcher, + áudio) e e-mail |
| `supabase/functions/flow-worker/window.ts` | Janela de envio, período do dia, próximo horário válido |
| `scripts/test-flows.ts` | Suíte de verificação do motor (roda contra o projeto) |
| `supabase/config.toml` | Registrar `flow-worker` com `verify_jwt = false` |

---

### Task 1: Migration — tabelas, índices e RLS

**Files:**
- Create: `supabase/migrations/20260813120000_crm_flows_core.sql`
- Create: `scripts/test-flows.ts` (esqueleto + testes de schema)

**Interfaces:**
- Produces: tabelas `crm_flows`, `crm_flow_runs` (com `exit_reason`), `crm_flow_step_log` — nomes de colunas exatamente como abaixo; todas as tasks seguintes dependem delas.

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- Fluxos de CRM v2 — Fase 1: núcleo (spec 2026-08-13-crm-flows-v2-design.md §2)
-- ============================================================

CREATE TABLE public.crm_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.crm_pipeline_stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  exit_on_stage_change boolean NOT NULL DEFAULT true,
  reentry text NOT NULL DEFAULT 'once' CHECK (reentry IN ('once','allowed')),
  reentry_cooldown_hours integer NOT NULL DEFAULT 168 CHECK (reentry_cooldown_hours > 0),
  entry_node_id text,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um fluxo ATIVO por etapa; rascunhos/pausados da mesma etapa são permitidos.
CREATE UNIQUE INDEX uniq_crm_flows_active_stage
  ON public.crm_flows(workspace_id, stage_id) WHERE status = 'active';
CREATE INDEX idx_crm_flows_workspace ON public.crm_flows(workspace_id);

CREATE TABLE public.crm_flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.crm_flows(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  current_node_id text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','waiting','done','failed','exited')),
  -- NOT NULL: run sem wakeup_at jamais seria colhido pelo claim.
  wakeup_at timestamptz NOT NULL DEFAULT now(),
  exit_reason text CHECK (exit_reason IN ('stage_change','won','lost','opted_out','flow_archived','node_deleted')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_token uuid,
  locked_until timestamptz,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No máximo UM run aberto por (fluxo, lead).
CREATE UNIQUE INDEX uniq_crm_flow_runs_open
  ON public.crm_flow_runs(flow_id, lead_id) WHERE state IN ('active','waiting');
CREATE INDEX idx_crm_flow_runs_due
  ON public.crm_flow_runs(wakeup_at) WHERE state IN ('active','waiting');
CREATE INDEX idx_crm_flow_runs_flow ON public.crm_flow_runs(flow_id, state);
CREATE INDEX idx_crm_flow_runs_lead_open
  ON public.crm_flow_runs(lead_id) WHERE state IN ('active','waiting');

CREATE TABLE public.crm_flow_step_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.crm_flow_runs(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.crm_flows(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  result text NOT NULL CHECK (result IN ('entered','sent','skipped','branch_true','branch_false','failed','rescheduled')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_flow_step_log_metrics ON public.crm_flow_step_log(flow_id, node_id, result);
CREATE INDEX idx_crm_flow_step_log_run ON public.crm_flow_step_log(run_id, occurred_at);

-- GRANTs: fluxos são editáveis por usuários; runs e log são leitura (escrita só service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_flows TO authenticated;
GRANT SELECT ON public.crm_flow_runs TO authenticated;
GRANT SELECT ON public.crm_flow_step_log TO authenticated;
GRANT ALL ON public.crm_flows, public.crm_flow_runs, public.crm_flow_step_log TO service_role;

ALTER TABLE public.crm_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_flow_step_log ENABLE ROW LEVEL SECURITY;

-- Padrão de crm_segments (20260730180226): membro do workspace OR dono OR admin/super_admin.
CREATE POLICY "flows_select" ON public.crm_flows FOR SELECT TO authenticated USING (
  public.is_workspace_member(auth.uid(), workspace_id)
  OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = crm_flows.workspace_id AND w.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "flows_insert" ON public.crm_flows FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = crm_flows.workspace_id AND w.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "flows_update" ON public.crm_flows FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = crm_flows.workspace_id AND w.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "flows_delete" ON public.crm_flows FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = crm_flows.workspace_id AND w.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "flow_runs_select" ON public.crm_flow_runs FOR SELECT TO authenticated USING (
  public.is_workspace_member(auth.uid(), workspace_id)
  OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = crm_flow_runs.workspace_id AND w.owner_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
);
CREATE POLICY "flow_step_log_select" ON public.crm_flow_step_log FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.crm_flows f
    WHERE f.id = crm_flow_step_log.flow_id
      AND (
        public.is_workspace_member(auth.uid(), f.workspace_id)
        OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = f.workspace_id AND w.owner_id = auth.uid())
        OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin')
      )
  )
);

CREATE TRIGGER trg_crm_flows_updated_at
  BEFORE UPDATE ON public.crm_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_crm_flow_runs_updated_at
  BEFORE UPDATE ON public.crm_flow_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Criar o esqueleto de `scripts/test-flows.ts` com os testes de schema**

O script segue o padrão de `scripts/test-api.ts`: seções sequenciais, contadores `passed`/`failed`, cleanup no final mesmo com falha. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_WORKSPACE_ID`.

```typescript
// scripts/test-flows.ts — Verificação do motor de Fluxos de CRM v2 (Fase 1).
// Roda contra o projeto Supabase com service role. Os fluxos de teste usam
// APENAS nós delay/branch/close_lead — nenhum envio externo é disparado.
// Uso: npx tsx scripts/test-flows.ts
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
  // ---- Setup: workspace/empresa/etapas/contato/lead de teste ----
  const { data: ws } = await db.from("workspaces").select("id, company_id").eq("id", workspaceId).single();
  if (!ws) throw new Error("TEST_WORKSPACE_ID inválido");
  const companyId = ws.company_id as string;

  const { data: stageA } = await db.from("crm_pipeline_stages")
    .insert({ workspace_id: workspaceId, name: `_flowtest A ${suffix}`, order: 9001 })
    .select("id").single();
  const { data: stageB } = await db.from("crm_pipeline_stages")
    .insert({ workspace_id: workspaceId, name: `_flowtest B ${suffix}`, order: 9002 })
    .select("id").single();
  cleanup.push(async () => { await db.from("crm_pipeline_stages").delete().in("id", [stageA!.id, stageB!.id]); });

  const { data: contact } = await db.from("crm_contacts")
    .insert({ workspace_id: workspaceId, name: `_flowtest ${suffix}`, phone: `5511977${Math.floor(100000 + Math.random() * 899999)}` })
    .select("id").single();
  cleanup.push(async () => { await db.from("crm_contacts").delete().eq("id", contact!.id); });

  // Lead nasce na etapa B (sem fluxo) para os testes controlarem a entrada em A.
  const { data: lead } = await db.from("crm_leads")
    .insert({ workspace_id: workspaceId, stage_id: stageB!.id, contact_id: contact!.id, title: `_flowtest ${suffix}` })
    .select("id").single();
  cleanup.push(async () => { await db.from("crm_leads").delete().eq("id", lead!.id); });

  console.log("== Schema ==");
  // Tabelas existem e aceitam um fluxo draft mínimo
  const { data: flow, error: e1 } = await db.from("crm_flows")
    .insert({ workspace_id: workspaceId, company_id: companyId, stage_id: stageA!.id, name: `_flowtest ${suffix}`, nodes: [], status: "draft" })
    .select("id").single();
  ok("insert de fluxo draft vazio", !e1 && !!flow, e1?.message);
  cleanup.push(async () => { await db.from("crm_flows").delete().eq("id", flow!.id); });

  // exit_reason com valor inválido é rejeitado pelo CHECK
  const { error: e2 } = await db.from("crm_flow_runs")
    .insert({ flow_id: flow!.id, lead_id: lead!.id, workspace_id: workspaceId, exit_reason: "banana" });
  ok("CHECK de exit_reason rejeita valor inválido", !!e2);

  // (as demais seções são adicionadas nas tasks seguintes)

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { for (const fn of cleanup.reverse()) await fn().catch(() => {}); });
```

- [ ] **Step 3: Rodar o teste ANTES de aplicar a migration — deve falhar**

Run: `npx tsx scripts/test-flows.ts`
Expected: FAIL na seção Schema (`relation "crm_flows" does not exist` ou similar).

- [ ] **Step 4: Aplicar a migration**

Run: `npx supabase db push` (ou push na `main` e conferir no editor Lovable que a migration foi aplicada sem duplicação).

- [ ] **Step 5: Rodar o teste — deve passar**

Run: `npx tsx scripts/test-flows.ts`
Expected: `2 passed, 0 failed` (seção Schema).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260813120000_crm_flows_core.sql scripts/test-flows.ts
git commit -m "Fluxos v2: tabelas crm_flows, crm_flow_runs e crm_flow_step_log

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — validação do grafo e efeitos de UPDATE do fluxo

**Files:**
- Create: `supabase/migrations/20260813120500_crm_flows_validation.sql`
- Modify: `scripts/test-flows.ts` (seção "Validação do grafo")

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces: função `validate_crm_flow_graph(p_nodes jsonb, p_entry_node_id text)` (RAISE EXCEPTION em grafo inválido) e trigger `trg_crm_flows_guard` em `crm_flows` que também: fecha runs ao arquivar (`exit_reason='flow_archived'`) e realoca/encerra runs parados em nós excluídos (`exit_reason='node_deleted'`).

- [ ] **Step 1: Adicionar a seção "Validação do grafo" ao `scripts/test-flows.ts`** (após a seção Schema)

```typescript
  console.log("== Validação do grafo ==");
  const validNodes = [
    { id: "n1", type: "delay", config: { minutes: 60 }, next: "n2", next_false: null },
    { id: "n2", type: "branch", config: { logic: "and", rules: [{ field: "value", operator: "gt", value: 1000 }] }, next: "n3", next_false: null },
    { id: "n3", type: "close_lead", config: { outcome: "won", loss_reason_id: null }, next: null, next_false: null },
  ];
  const base = { workspace_id: workspaceId, company_id: companyId, stage_id: stageA!.id, name: `_flowtest g ${suffix}`, entry_node_id: "n1" };

  const { error: g1 } = await db.from("crm_flows").insert({ ...base, nodes: [
    { id: "n1", type: "delay", config: { minutes: 5 }, next: "n2", next_false: null },
    { id: "n2", type: "delay", config: { minutes: 5 }, next: "n1", next_false: null },
  ]});
  ok("grafo com ciclo é rejeitado", !!g1 && /ciclo/i.test(g1.message), g1?.message);

  const { error: g2 } = await db.from("crm_flows").insert({ ...base, nodes: [
    { id: "n1", type: "delay", config: { minutes: 5 }, next: "nao-existe", next_false: null },
  ]});
  ok("ponteiro quebrado é rejeitado", !!g2, g2?.message);

  const { error: g3 } = await db.from("crm_flows").insert({ ...base, nodes: [
    { id: "n1", type: "close_lead", config: { outcome: "won", loss_reason_id: null }, next: "n1x", next_false: null },
    { id: "n1x", type: "delay", config: { minutes: 5 }, next: null, next_false: null },
  ]});
  ok("close_lead com next é rejeitado", !!g3, g3?.message);

  const { error: g4 } = await db.from("crm_flows").insert({ ...base, nodes: [
    { id: "n1", type: "close_lead", config: { outcome: "lost", loss_reason_id: null }, next: null, next_false: null },
  ]});
  ok("lost sem loss_reason_id é rejeitado", !!g4, g4?.message);

  const { error: g5 } = await db.from("crm_flows").insert({ ...base, nodes: [
    { id: "n1", type: "branch", config: { logic: "and", rules: [] }, next: null, next_false: null },
  ]});
  ok("branch sem regras é rejeitado", !!g5, g5?.message);

  const { data: gOk, error: g6 } = await db.from("crm_flows").insert({ ...base, nodes: validNodes }).select("id").single();
  ok("grafo válido é aceito", !g6 && !!gOk, g6?.message);
  if (gOk) cleanup.push(async () => { await db.from("crm_flows").delete().eq("id", gOk.id); });

  const { error: g7 } = await db.from("crm_flows")
    .update({ status: "active" }).eq("id", flow!.id); // flow da Task 1: nodes=[] e entry null
  ok("ativar fluxo sem nós é rejeitado", !!g7, g7?.message);
```

- [ ] **Step 2: Rodar — a nova seção deve falhar** (`validate` ainda não existe; inserts inválidos passam)

Run: `npx tsx scripts/test-flows.ts`
Expected: FAILs na seção "Validação do grafo".

- [ ] **Step 3: Escrever a migration**

```sql
-- ============================================================
-- Fluxos v2 — validação do grafo (spec §2.1) e efeitos de UPDATE (spec §3.1/§3.6).
-- A UI valida por conveniência; o banco é a fronteira.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_crm_flow_graph(p_nodes jsonb, p_entry_node_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_node jsonb;
  v_ids text[] := '{}';
  v_id text;
  v_type text;
  v_cfg jsonb;
  v_next text;
  v_next_false text;
  -- Kahn (detecção de ciclo)
  v_edges_from text[] := '{}';
  v_edges_to text[] := '{}';
  v_indeg int[];
  v_removed int := 0;
  v_total int;
  v_i int;
  v_j int;
  v_progress boolean;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'nodes deve ser um array JSON';
  END IF;

  -- Coleta ids e valida unicidade
  FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes) LOOP
    v_id := v_node->>'id';
    IF v_id IS NULL OR v_id = '' THEN
      RAISE EXCEPTION 'nó sem id';
    END IF;
    IF v_id = ANY(v_ids) THEN
      RAISE EXCEPTION 'id de nó duplicado: %', v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  IF p_entry_node_id IS NOT NULL AND NOT (p_entry_node_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'entry_node_id % não existe entre os nós', p_entry_node_id;
  END IF;

  -- Valida cada nó: tipo, config obrigatória, ponteiros
  FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes) LOOP
    v_id := v_node->>'id';
    v_type := v_node->>'type';
    v_cfg := COALESCE(v_node->'config', '{}'::jsonb);
    v_next := v_node->>'next';
    v_next_false := v_node->>'next_false';

    IF v_type NOT IN ('delay','branch','send_whatsapp','send_email','close_lead') THEN
      RAISE EXCEPTION 'tipo de nó inválido: % (nó %)', v_type, v_id;
    END IF;
    IF v_next IS NOT NULL AND NOT (v_next = ANY(v_ids)) THEN
      RAISE EXCEPTION 'nó % aponta next para nó inexistente %', v_id, v_next;
    END IF;
    IF v_next_false IS NOT NULL AND NOT (v_next_false = ANY(v_ids)) THEN
      RAISE EXCEPTION 'nó % aponta next_false para nó inexistente %', v_id, v_next_false;
    END IF;
    IF v_type <> 'branch' AND v_next_false IS NOT NULL THEN
      RAISE EXCEPTION 'nó % (%) não pode ter next_false', v_id, v_type;
    END IF;

    IF v_type = 'delay' THEN
      IF COALESCE((v_cfg->>'minutes')::int, 0) < 1 THEN
        RAISE EXCEPTION 'nó % (espera): minutes deve ser >= 1', v_id;
      END IF;
    ELSIF v_type = 'branch' THEN
      IF COALESCE(v_cfg->>'logic', '') NOT IN ('and','or') THEN
        RAISE EXCEPTION 'nó % (condição): logic deve ser and/or', v_id;
      END IF;
      IF jsonb_typeof(v_cfg->'rules') <> 'array' OR jsonb_array_length(v_cfg->'rules') < 1 THEN
        RAISE EXCEPTION 'nó % (condição): ao menos 1 regra', v_id;
      END IF;
    ELSIF v_type = 'send_whatsapp' THEN
      IF COALESCE(trim(v_cfg->>'content'), '') = '' AND COALESCE(v_cfg->>'media_url', '') = '' THEN
        RAISE EXCEPTION 'nó % (WhatsApp): conteúdo ou mídia obrigatório', v_id;
      END IF;
    ELSIF v_type = 'send_email' THEN
      IF COALESCE(trim(v_cfg->>'subject'), '') = '' OR COALESCE(trim(v_cfg->>'html'), '') = '' THEN
        RAISE EXCEPTION 'nó % (e-mail): assunto e conteúdo obrigatórios', v_id;
      END IF;
    ELSIF v_type = 'close_lead' THEN
      IF COALESCE(v_cfg->>'outcome', '') NOT IN ('won','lost') THEN
        RAISE EXCEPTION 'nó % (fechar lead): outcome deve ser won/lost', v_id;
      END IF;
      IF v_cfg->>'outcome' = 'lost' AND COALESCE(v_cfg->>'loss_reason_id', '') = '' THEN
        RAISE EXCEPTION 'nó % (fechar lead): motivo de perda obrigatório', v_id;
      END IF;
      IF v_next IS NOT NULL THEN
        RAISE EXCEPTION 'nó % (fechar lead) é terminal: next deve ser nulo', v_id;
      END IF;
    END IF;

    -- Arestas para o Kahn
    IF v_next IS NOT NULL THEN
      v_edges_from := array_append(v_edges_from, v_id);
      v_edges_to := array_append(v_edges_to, v_next);
    END IF;
    IF v_next_false IS NOT NULL THEN
      v_edges_from := array_append(v_edges_from, v_id);
      v_edges_to := array_append(v_edges_to, v_next_false);
    END IF;
  END LOOP;

  -- Detecção de ciclo (Kahn: remove nós de grau de entrada zero até esgotar).
  v_total := COALESCE(array_length(v_ids, 1), 0);
  IF v_total > 0 THEN
    v_indeg := array_fill(0, ARRAY[v_total]);
    FOR v_j IN 1..COALESCE(array_length(v_edges_to, 1), 0) LOOP
      v_i := array_position(v_ids, v_edges_to[v_j]);
      v_indeg[v_i] := v_indeg[v_i] + 1;
    END LOOP;
    LOOP
      v_progress := false;
      FOR v_i IN 1..v_total LOOP
        IF v_indeg[v_i] = 0 THEN
          v_indeg[v_i] := -1; -- removido
          v_removed := v_removed + 1;
          v_progress := true;
          FOR v_j IN 1..COALESCE(array_length(v_edges_from, 1), 0) LOOP
            IF v_edges_from[v_j] = v_ids[v_i] THEN
              v_indeg[array_position(v_ids, v_edges_to[v_j])] :=
                v_indeg[array_position(v_ids, v_edges_to[v_j])] - 1;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
      EXIT WHEN NOT v_progress;
    END LOOP;
    IF v_removed < v_total THEN
      RAISE EXCEPTION 'o fluxo contém um ciclo';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_crm_flows_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_old_map jsonb;
  v_cursor text;
  v_hops int;
  v_new_ids text[];
BEGIN
  -- 1. Validação do grafo (INSERT sempre; UPDATE quando grafo/entrada/status mudou)
  IF TG_OP = 'INSERT'
     OR NEW.nodes IS DISTINCT FROM OLD.nodes
     OR NEW.entry_node_id IS DISTINCT FROM OLD.entry_node_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.validate_crm_flow_graph(NEW.nodes, NEW.entry_node_id);
    IF NEW.status = 'active' THEN
      IF NEW.entry_node_id IS NULL OR jsonb_array_length(NEW.nodes) = 0 THEN
        RAISE EXCEPTION 'fluxo ativo precisa de ao menos um nó e um nó de entrada';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  -- 2. Arquivar encerra runs abertos (spec §3.1)
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    UPDATE public.crm_flow_runs
       SET state = 'exited', exit_reason = 'flow_archived', updated_at = now()
     WHERE flow_id = NEW.id AND state IN ('active','waiting');
  END IF;

  -- 3. Nós excluídos: runs parados neles seguem pelo next do grafo ANTIGO até um
  --    nó que ainda exista; sem destino → exited/node_deleted (spec §3.6)
  IF NEW.nodes IS DISTINCT FROM OLD.nodes THEN
    SELECT jsonb_object_agg(n->>'id', n) INTO v_old_map FROM jsonb_array_elements(OLD.nodes) n;
    SELECT COALESCE(array_agg(n->>'id'), '{}') INTO v_new_ids FROM jsonb_array_elements(NEW.nodes) n;
    FOR v_run IN
      SELECT id, current_node_id FROM public.crm_flow_runs
      WHERE flow_id = NEW.id AND state IN ('active','waiting')
        AND (current_node_id IS NULL OR NOT (current_node_id = ANY(v_new_ids)))
    LOOP
      v_cursor := v_run.current_node_id;
      v_hops := 0;
      WHILE v_cursor IS NOT NULL AND NOT (v_cursor = ANY(v_new_ids)) AND v_hops < 200 LOOP
        v_cursor := v_old_map->v_cursor->>'next';
        v_hops := v_hops + 1;
      END LOOP;
      IF v_cursor IS NOT NULL AND v_cursor = ANY(v_new_ids) THEN
        UPDATE public.crm_flow_runs
           SET current_node_id = v_cursor, state = 'active', wakeup_at = now(), updated_at = now()
         WHERE id = v_run.id;
      ELSE
        UPDATE public.crm_flow_runs
           SET state = 'exited', exit_reason = 'node_deleted', updated_at = now()
         WHERE id = v_run.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_flows_guard ON public.crm_flows;
CREATE TRIGGER trg_crm_flows_guard
  BEFORE INSERT OR UPDATE ON public.crm_flows
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_flows_guard();
```

Nota: o trigger é BEFORE para a validação abortar a escrita; os UPDATEs em `crm_flow_runs` dentro dele são permitidos (SECURITY DEFINER) e enxergam o estado consistente porque rodam na mesma transação.

- [ ] **Step 4: Aplicar e rodar**

Run: `npx supabase db push && npx tsx scripts/test-flows.ts`
Expected: todas as seções PASS (`9 passed, 0 failed`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813120500_crm_flows_validation.sql scripts/test-flows.ts
git commit -m "Fluxos v2: validacao de grafo no banco e efeitos de update do fluxo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — triggers de inscrição/saída em `crm_leads`

**Files:**
- Create: `supabase/migrations/20260813121000_crm_flows_lead_triggers.sql`
- Modify: `scripts/test-flows.ts` (seções "Inscrição", "Reentrada", "Saída")

**Interfaces:**
- Consumes: tabelas + validação das Tasks 1–2.
- Produces: triggers `trg_crm_flow_lead_stage` (AFTER INSERT OR UPDATE OF stage_id) e `trg_crm_flow_lead_close` (AFTER UPDATE OF status) em `crm_leads`. NÃO tocam nos triggers da v1.

- [ ] **Step 1: Adicionar as seções de teste**

```typescript
  console.log("== Inscrição / Reentrada / Saída ==");
  // Fluxo ativo na etapa A: um único delay de 24h (nenhum envio externo)
  const { data: activeFlow } = await db.from("crm_flows").insert({
    workspace_id: workspaceId, company_id: companyId, stage_id: stageA!.id,
    name: `_flowtest ativo ${suffix}`, status: "active", entry_node_id: "n1",
    reentry: "allowed", reentry_cooldown_hours: 1,
    nodes: [{ id: "n1", type: "delay", config: { minutes: 1440 }, next: null, next_false: null }],
  }).select("id").single();
  cleanup.push(async () => { await db.from("crm_flows").delete().eq("id", activeFlow!.id); });

  // Unicidade: segundo fluxo ativo na mesma etapa é rejeitado
  const { error: u1 } = await db.from("crm_flows").insert({
    workspace_id: workspaceId, company_id: companyId, stage_id: stageA!.id,
    name: `_flowtest dup ${suffix}`, status: "active", entry_node_id: "n1",
    nodes: [{ id: "n1", type: "delay", config: { minutes: 5 }, next: null, next_false: null }],
  });
  ok("segundo fluxo ativo na mesma etapa é rejeitado", !!u1, u1?.message);

  // Inscrição: mover lead B→A cria run
  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
  const { data: run1 } = await db.from("crm_flow_runs").select("*")
    .eq("flow_id", activeFlow!.id).eq("lead_id", lead!.id).in("state", ["active", "waiting"]).maybeSingle();
  ok("mover lead para a etapa cria run aberto", !!run1 && run1.current_node_id === "n1");

  // Reentrada dentro do cooldown NÃO recria (o run aberto também bloqueia)
  await db.from("crm_leads").update({ stage_id: stageB!.id }).eq("id", lead!.id); // sai (encerra run)
  const { data: run1After } = await db.from("crm_flow_runs").select("state, exit_reason").eq("id", run1!.id).single();
  ok("saída da etapa encerra run com stage_change", run1After?.state === "exited" && run1After?.exit_reason === "stage_change");

  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id); // volta dentro do cooldown de 1h
  const { count: c1 } = await db.from("crm_flow_runs").select("*", { count: "exact", head: true })
    .eq("flow_id", activeFlow!.id).eq("lead_id", lead!.id);
  ok("reentrada dentro do cooldown não cria novo run", c1 === 1);

  // exit_on_stage_change=false: run sobrevive à troca de etapa
  await db.from("crm_flows").update({ exit_on_stage_change: false }).eq("id", activeFlow!.id);
  // força reentrada: zera cooldown apagando o run antigo
  await db.from("crm_flow_runs").delete().eq("flow_id", activeFlow!.id).eq("lead_id", lead!.id);
  await db.from("crm_leads").update({ stage_id: stageB!.id }).eq("id", lead!.id);
  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
  await db.from("crm_leads").update({ stage_id: stageB!.id }).eq("id", lead!.id); // troca com fluxo "continuar"
  const { data: run2 } = await db.from("crm_flow_runs").select("state").eq("flow_id", activeFlow!.id)
    .eq("lead_id", lead!.id).in("state", ["active", "waiting"]).maybeSingle();
  ok("exit_on_stage_change=false mantém o run aberto", !!run2);

  // Marcar won encerra o run
  await db.from("crm_leads").update({ status: "won", closed_at: new Date().toISOString() }).eq("id", lead!.id);
  const { data: run2After } = await db.from("crm_flow_runs").select("state, exit_reason")
    .eq("flow_id", activeFlow!.id).eq("lead_id", lead!.id).order("entered_at", { ascending: false }).limit(1).single();
  ok("lead won encerra o run", run2After?.state === "exited" && run2After?.exit_reason === "won");
  await db.from("crm_leads").update({ status: "open", closed_at: null }).eq("id", lead!.id);

  // reentry='once': com run já existente (mesmo terminado), nova entrada não cria
  await db.from("crm_flows").update({ reentry: "once", exit_on_stage_change: true }).eq("id", activeFlow!.id);
  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
  const { count: c2 } = await db.from("crm_flow_runs").select("*", { count: "exact", head: true })
    .eq("flow_id", activeFlow!.id).eq("lead_id", lead!.id);
  ok("reentry=once não reinscreve lead que já passou", c2 === 1);
  await db.from("crm_leads").update({ stage_id: stageB!.id }).eq("id", lead!.id);
```

- [ ] **Step 2: Rodar — as novas seções devem falhar** (triggers não existem; nenhum run é criado)

Run: `npx tsx scripts/test-flows.ts`
Expected: FAILs nas seções novas (runs não criados).

- [ ] **Step 3: Escrever a migration**

```sql
-- ============================================================
-- Fluxos v2 — inscrição e saída por etapa + encerramento por status (spec §3.1).
-- Triggers SEPARADOS e independentes dos da v1 (trg_lead_stage_cadence_sync fica).
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_crm_flow_lead_stage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flow public.crm_flows%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- SAÍDA: encerra runs abertos de fluxos com exit_on_stage_change cuja etapa difere da nova
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.crm_flow_runs r
       SET state = 'exited', exit_reason = 'stage_change', updated_at = now()
      FROM public.crm_flows f
     WHERE r.flow_id = f.id
       AND r.lead_id = NEW.id
       AND r.state IN ('active','waiting')
       AND f.exit_on_stage_change
       AND f.stage_id IS DISTINCT FROM NEW.stage_id;
  END IF;

  -- ENTRADA: fluxo ativo da nova etapa no workspace do lead
  SELECT * INTO v_flow
    FROM public.crm_flows
   WHERE workspace_id = NEW.workspace_id
     AND stage_id = NEW.stage_id
     AND status = 'active'
   LIMIT 1;
  IF NOT FOUND OR v_flow.entry_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Leads já fechados não entram em fluxo
  IF NEW.status IN ('won','lost') THEN
    RETURN NEW;
  END IF;

  -- Reentrada (spec §3.1): once = nunca reinscreve; allowed = respeita cooldown
  IF v_flow.reentry = 'once' AND EXISTS (
    SELECT 1 FROM public.crm_flow_runs WHERE flow_id = v_flow.id AND lead_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;
  IF v_flow.reentry = 'allowed' AND EXISTS (
    SELECT 1 FROM public.crm_flow_runs
     WHERE flow_id = v_flow.id AND lead_id = NEW.id
       AND (state IN ('active','waiting')
            OR updated_at > now() - make_interval(hours => v_flow.reentry_cooldown_hours))
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.crm_flow_runs (flow_id, lead_id, workspace_id, current_node_id, state, wakeup_at)
  VALUES (v_flow.id, NEW.id, NEW.workspace_id, v_flow.entry_node_id, 'active', now())
  ON CONFLICT (flow_id, lead_id) WHERE state IN ('active','waiting') DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_flow_lead_stage ON public.crm_leads;
CREATE TRIGGER trg_crm_flow_lead_stage
  AFTER INSERT OR UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_flow_lead_stage();

CREATE OR REPLACE FUNCTION public.trg_crm_flow_lead_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('won','lost') THEN
    UPDATE public.crm_flow_runs
       SET state = 'exited', exit_reason = NEW.status, updated_at = now()
     WHERE lead_id = NEW.id AND state IN ('active','waiting');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_flow_lead_close ON public.crm_leads;
CREATE TRIGGER trg_crm_flow_lead_close
  AFTER UPDATE OF status ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_crm_flow_lead_close();
```

- [ ] **Step 4: Aplicar e rodar**

Run: `npx supabase db push && npx tsx scripts/test-flows.ts`
Expected: todas as seções PASS (`16 passed, 0 failed`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813121000_crm_flows_lead_triggers.sql scripts/test-flows.ts
git commit -m "Fluxos v2: triggers de inscricao/saida por etapa e encerramento por status

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Migration — RPC de claim

**Files:**
- Create: `supabase/migrations/20260813121500_crm_flows_claim_rpc.sql`
- Modify: `scripts/test-flows.ts` (seções "Pausa" e "Claim concorrente")

**Interfaces:**
- Consumes: tabelas das Tasks 1–3.
- Produces: RPC `flow_claim_due_runs(p_limit int DEFAULT 50, p_lease_seconds int DEFAULT 300, p_flow_id uuid DEFAULT NULL)` retornando `(run_id uuid, flow_id uuid, lead_id uuid, workspace_id uuid, company_id uuid, current_node_id text, state text, context jsonb, entered_at timestamptz, lock_token uuid, nodes jsonb)`. `p_flow_id` filtra um fluxo específico (usado pelos testes para não colher runs reais).

- [ ] **Step 1: Adicionar as seções de teste**

```typescript
  console.log("== Pausa / Claim ==");
  // Novo run devido agora: usa fluxo dedicado com cooldown irrelevante
  const { data: claimFlow } = await db.from("crm_flows").insert({
    workspace_id: workspaceId, company_id: companyId, stage_id: stageB!.id,
    name: `_flowtest claim ${suffix}`, status: "active", entry_node_id: "n1", reentry: "allowed", reentry_cooldown_hours: 1,
    nodes: [{ id: "n1", type: "delay", config: { minutes: 1440 }, next: null, next_false: null }],
  }).select("id").single();
  cleanup.push(async () => { await db.from("crm_flows").delete().eq("id", claimFlow!.id); });
  await db.from("crm_flow_runs").delete().eq("lead_id", lead!.id); // limpa histórico p/ reinscrever
  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
  await db.from("crm_leads").update({ stage_id: stageB!.id }).eq("id", lead!.id); // entra no claimFlow

  // Pausa congela: fluxo paused → claim não retorna o run
  await db.from("crm_flows").update({ status: "paused" }).eq("id", claimFlow!.id);
  const { data: claimPaused } = await db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 5, p_flow_id: claimFlow!.id });
  ok("fluxo pausado: claim não retorna runs", (claimPaused ?? []).length === 0);

  // Reativar → claim retorna
  await db.from("crm_flows").update({ status: "active" }).eq("id", claimFlow!.id);
  const { data: claim1 } = await db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 5, p_flow_id: claimFlow!.id });
  ok("fluxo ativo: claim retorna o run com lock_token e nodes", (claim1 ?? []).length === 1 && !!claim1![0].lock_token && Array.isArray(claim1![0].nodes));

  // Lease: segundo claim imediato não pega o mesmo run
  const { data: claim2 } = await db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 5, p_flow_id: claimFlow!.id });
  ok("run com lease não é colhido de novo", (claim2 ?? []).length === 0);

  // Claim concorrente: após lease expirar, duas chamadas paralelas nunca dividem o run
  await new Promise((r) => setTimeout(r, 5500));
  const [ra, rb] = await Promise.all([
    db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 60, p_flow_id: claimFlow!.id }),
    db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 60, p_flow_id: claimFlow!.id }),
  ]);
  const total = (ra.data ?? []).length + (rb.data ?? []).length;
  ok("claims concorrentes não duplicam o run", total === 1, { a: ra.data?.length, b: rb.data?.length });
```

- [ ] **Step 2: Rodar — deve falhar** (RPC inexistente)

Run: `npx tsx scripts/test-flows.ts`
Expected: FAIL nas seções novas (`function flow_claim_due_runs does not exist`).

- [ ] **Step 3: Escrever a migration**

```sql
-- ============================================================
-- Fluxos v2 — claim de runs devidos (spec §3.2). Porte do journey_claim_due_runs:
-- FOR UPDATE SKIP LOCKED + lease + fencing token. Fluxo pausado NÃO é colhido.
-- p_flow_id: filtro usado pelo script de testes para não colher runs reais.
-- ============================================================
CREATE OR REPLACE FUNCTION public.flow_claim_due_runs(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300,
  p_flow_id uuid DEFAULT NULL
)
RETURNS TABLE (
  run_id uuid, flow_id uuid, lead_id uuid, workspace_id uuid, company_id uuid,
  current_node_id text, state text, context jsonb, entered_at timestamptz,
  lock_token uuid, nodes jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
      FROM public.crm_flow_runs r
      JOIN public.crm_flows f ON f.id = r.flow_id
     WHERE r.state IN ('active','waiting')
       AND r.wakeup_at <= now()
       AND (r.locked_until IS NULL OR r.locked_until <= now())
       AND f.status = 'active'
       AND (p_flow_id IS NULL OR f.id = p_flow_id)
     ORDER BY r.wakeup_at
     LIMIT p_limit
     FOR UPDATE OF r SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.crm_flow_runs r
       SET lock_token = v_token,
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      FROM due
     WHERE r.id = due.id
    RETURNING r.id, r.flow_id, r.lead_id, r.workspace_id, r.current_node_id,
              r.state, r.context, r.entered_at
  )
  SELECT c.id, c.flow_id, c.lead_id, c.workspace_id, f.company_id,
         c.current_node_id, c.state, c.context, c.entered_at, v_token, f.nodes
    FROM claimed c
    JOIN public.crm_flows f ON f.id = c.flow_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.flow_claim_due_runs(integer, integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flow_claim_due_runs(integer, integer, uuid) TO service_role;
```

- [ ] **Step 4: Aplicar e rodar**

Run: `npx supabase db push && npx tsx scripts/test-flows.ts`
Expected: todas as seções PASS (`20 passed, 0 failed`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813121500_crm_flows_claim_rpc.sql scripts/test-flows.ts
git commit -m "Fluxos v2: RPC flow_claim_due_runs com lease e fencing token

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Worker — esqueleto, delay, branch de teste e close_lead

**Files:**
- Create: `supabase/functions/flow-worker/index.ts`
- Create: `supabase/functions/flow-worker/executor.ts`
- Create: `supabase/functions/flow-worker/conditions.ts`
- Modify: `supabase/config.toml` (registrar a função)
- Modify: `scripts/test-flows.ts` (seção "Execução")

**Interfaces:**
- Consumes: `flow_claim_due_runs` (Task 4).
- Produces: `executeRun(supabase, run: ClaimedRun): Promise<"waiting"|"done"|"exited"|"failed">` em `executor.ts`; `evaluateBranch(supabase, run, config): Promise<boolean>` em `conditions.ts`; tipo `ClaimedRun` (mesmas colunas do retorno da RPC); helper `logStep(supabase, run, node, result, detail)`. A Task 6 pluga `sending.ts` no `switch` do executor nos pontos marcados.

- [ ] **Step 1: Escrever `executor.ts`**

```typescript
// supabase/functions/flow-worker/executor.ts
// Executa um run nó a nó até espera futura, fim, encerramento ou cap por tick.
import { evaluateBranch } from "./conditions.ts";
import { execSendWhatsApp, execSendEmail } from "./sending.ts";

export interface FlowNode {
  id: string;
  type: "delay" | "branch" | "send_whatsapp" | "send_email" | "close_lead";
  config: Record<string, unknown>;
  next: string | null;
  next_false: string | null;
}

export interface ClaimedRun {
  run_id: string;
  flow_id: string;
  lead_id: string;
  workspace_id: string;
  company_id: string;
  current_node_id: string | null;
  state: string;
  context: Record<string, unknown>;
  entered_at: string;
  lock_token: string;
  nodes: FlowNode[];
}

const MAX_NODES_PER_TICK = 20;
const RETRY_BACKOFF_SECONDS = [300, 900, 3600]; // 5min, 15min, 1h (spec §3.4)

export async function logStep(
  supabase: any, run: ClaimedRun, node: FlowNode, result: string, detail: Record<string, unknown> = {},
) {
  await supabase.from("crm_flow_step_log").insert({
    run_id: run.run_id, flow_id: run.flow_id, lead_id: run.lead_id,
    node_id: node.id, node_type: node.type, result, detail,
  });
}

// Toda escrita no run carrega o fencing token: um worker cujo lease expirou
// não sobrescreve o run de quem o assumiu.
async function writeRun(supabase: any, run: ClaimedRun, patch: Record<string, unknown>) {
  const { data } = await supabase.from("crm_flow_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", run.run_id).eq("lock_token", run.lock_token)
    .select("id");
  return (data ?? []).length > 0;
}

function jitterMs(delayMinutes: number): number {
  // Anti-ban herdado da v1: ±3 min para esperas >= 1h
  if (delayMinutes < 60) return 0;
  return Math.floor(Math.random() * 361_000) - 180_000;
}

export async function executeRun(supabase: any, run: ClaimedRun): Promise<"waiting" | "done" | "exited" | "failed"> {
  const byId = new Map(run.nodes.map((n) => [n.id, n]));
  let currentId = run.current_node_id;
  const context = run.context ?? {};

  for (let steps = 0; steps < MAX_NODES_PER_TICK; steps++) {
    if (!currentId) {
      await writeRun(supabase, run, { state: "done", current_node_id: null, lock_token: null, locked_until: null });
      return "done";
    }
    const node = byId.get(currentId);
    if (!node) {
      await writeRun(supabase, run, { state: "exited", exit_reason: "node_deleted", lock_token: null, locked_until: null });
      return "exited";
    }

    switch (node.type) {
      case "delay": {
        const minutes = Math.max(1, Number(node.config.minutes) || 1);
        const wakeup = new Date(Date.now() + minutes * 60_000 + jitterMs(minutes)).toISOString();
        await logStep(supabase, run, node, "entered", { minutes });
        // A espera acontece ENTRE nós: current avança para o next e o run dorme.
        await writeRun(supabase, run, {
          state: "waiting", current_node_id: node.next, wakeup_at: wakeup, lock_token: null, locked_until: null,
        });
        return "waiting";
      }

      case "branch": {
        const result = await evaluateBranch(supabase, run, node.config as any);
        await logStep(supabase, run, node, result ? "branch_true" : "branch_false");
        currentId = result ? node.next : node.next_false;
        continue;
      }

      case "send_whatsapp":
      case "send_email": {
        const send = node.type === "send_whatsapp" ? execSendWhatsApp : execSendEmail;
        const outcome = await send(supabase, run, node);
        if (outcome.status === "wait") {
          // Fora da janela/período ou conexão indisponível: reagenda SEM avançar (spec §3.3/§3.4)
          await logStep(supabase, run, node, "rescheduled", { reason: outcome.reason, until: outcome.until });
          await writeRun(supabase, run, {
            state: "waiting", current_node_id: node.id, wakeup_at: outcome.until,
            context, lock_token: null, locked_until: null,
          });
          return "waiting";
        }
        if (outcome.status === "retry") {
          const retries = (context.retries ?? {}) as Record<string, number>;
          const attempt = (retries[node.id] ?? 0) + 1;
          if (attempt <= RETRY_BACKOFF_SECONDS.length) {
            retries[node.id] = attempt;
            context.retries = retries;
            const until = new Date(Date.now() + RETRY_BACKOFF_SECONDS[attempt - 1] * 1000).toISOString();
            await logStep(supabase, run, node, "rescheduled", { reason: outcome.reason, attempt, until });
            await writeRun(supabase, run, {
              state: "waiting", current_node_id: node.id, wakeup_at: until,
              context, lock_token: null, locked_until: null,
            });
            return "waiting";
          }
          // Retentativas esgotadas: nó falha e o run CONTINUA (spec §3.4)
          await logStep(supabase, run, node, "failed", { reason: outcome.reason, attempts: attempt - 1 });
          delete (context.retries as Record<string, number>)[node.id];
          currentId = node.next;
          continue;
        }
        if (outcome.status === "exit") {
          // Opt-out do contato (spec §3.1)
          await logStep(supabase, run, node, "skipped", { reason: outcome.reason });
          await writeRun(supabase, run, { state: "exited", exit_reason: "opted_out", lock_token: null, locked_until: null });
          return "exited";
        }
        await logStep(supabase, run, node, outcome.status === "sent" ? "sent" : "skipped",
          { reason: outcome.reason, message_id: outcome.messageId });
        const retries = (context.retries ?? {}) as Record<string, number>;
        delete retries[node.id];
        currentId = node.next;
        continue;
      }

      case "close_lead": {
        const outcome = String(node.config.outcome);
        const patch: Record<string, unknown> = {
          status: outcome, closed_at: new Date().toISOString(),
        };
        if (outcome === "lost") patch.loss_reason_id = node.config.loss_reason_id;
        const { error } = await supabase.from("crm_leads").update(patch).eq("id", run.lead_id);
        if (error) {
          await logStep(supabase, run, node, "failed", { error: error.message });
          await writeRun(supabase, run, { state: "failed", lock_token: null, locked_until: null });
          return "failed";
        }
        await logStep(supabase, run, node, "sent", { outcome });
        // O trigger trg_crm_flow_lead_close já encerrou o run (exit_reason won/lost).
        // Não escrevemos mais no run para não sobrescrever o exit_reason.
        return "exited";
      }
    }
  }

  // Cap atingido (defesa em profundidade além da validação de ciclo): continua no próximo tick
  await writeRun(supabase, run, {
    state: "active", current_node_id: currentId, wakeup_at: new Date().toISOString(),
    context, lock_token: null, locked_until: null,
  });
  return "waiting";
}
```

- [ ] **Step 2: Escrever `conditions.ts`**

```typescript
// supabase/functions/flow-worker/conditions.ts
// Avaliador do nó branch (spec §4.2). Regra sem dado avalia FALSO, nunca erro.
import type { ClaimedRun } from "./executor.ts";

export interface BranchRule { field: string; operator: string; value?: unknown }
export interface BranchConfig { logic: "and" | "or"; rules: BranchRule[] }

interface LeadBundle {
  lead: any; contact: any; psych: any;
  painIds: string[]; objectionIds: string[]; tags: string[];
}

async function loadBundle(supabase: any, run: ClaimedRun): Promise<LeadBundle> {
  const { data: lead } = await supabase.from("crm_leads")
    .select("*, contact:crm_contacts(id, name, phone, email, company, source, tags, opted_out)")
    .eq("id", run.lead_id).maybeSingle();
  const { data: psych } = await supabase.from("crm_lead_psychology")
    .select("propensity_score, risk_score, opportunity_score")
    .eq("lead_id", run.lead_id).maybeSingle();
  const [{ data: pains }, { data: objections }] = await Promise.all([
    supabase.from("crm_lead_pains").select("pain_id").eq("lead_id", run.lead_id),
    supabase.from("crm_lead_objections").select("objection_id").eq("lead_id", run.lead_id),
  ]);
  const contact = lead?.contact ?? null;
  let tags: string[] = [];
  try {
    const raw = contact?.tags;
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    tags = arr.map((t: any) => String(t?.name ?? t).toLowerCase());
  } catch { /* tags malformadas contam como vazias */ }
  return {
    lead, contact, psych,
    painIds: (pains ?? []).map((p: any) => p.pain_id),
    objectionIds: (objections ?? []).map((o: any) => o.objection_id),
    tags,
  };
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function cmp(op: string, left: unknown, right: unknown): boolean {
  if (op === "empty") return left === null || left === undefined || left === "";
  if (op === "not_empty") return !(left === null || left === undefined || left === "");
  if (left === null || left === undefined) return false; // sem dado → falso (spec §4.2)
  switch (op) {
    case "eq": return String(left).toLowerCase() === String(right).toLowerCase();
    case "neq": return String(left).toLowerCase() !== String(right).toLowerCase();
    case "gt": return Number(left) > Number(right);
    case "lt": return Number(left) < Number(right);
    case "contains": return String(left).toLowerCase().includes(String(right).toLowerCase());
    case "not_contains": return !String(left).toLowerCase().includes(String(right).toLowerCase());
    default: return false;
  }
}

async function repliedSinceEntry(supabase: any, run: ClaimedRun, bundle: LeadBundle): Promise<boolean> {
  // Última mensagem inbound (sender_type='lead') dos leads do inbox vinculados
  // ao contato/telefone, posterior à entrada no fluxo.
  const inboxIds: string[] = [];
  if (bundle.contact?.id) {
    const { data } = await supabase.from("leads").select("id")
      .eq("workspace_id", run.workspace_id).eq("contact_id", bundle.contact.id);
    for (const l of data ?? []) inboxIds.push(l.id);
  }
  if (inboxIds.length === 0 && bundle.contact?.phone) {
    let phone = String(bundle.contact.phone).replace(/\D/g, "");
    if (phone.length >= 10 && phone.length <= 11 && !phone.startsWith("55")) phone = "55" + phone;
    const { data } = await supabase.from("leads").select("id")
      .eq("workspace_id", run.workspace_id).eq("phone", phone);
    for (const l of data ?? []) inboxIds.push(l.id);
  }
  if (inboxIds.length === 0) return false;
  const { count } = await supabase.from("messages")
    .select("id", { count: "exact", head: true })
    .in("lead_id", inboxIds).eq("sender_type", "lead").gt("created_at", run.entered_at);
  return (count ?? 0) > 0;
}

async function evalRule(supabase: any, run: ClaimedRun, b: LeadBundle, r: BranchRule): Promise<boolean> {
  switch (r.field) {
    case "value": return cmp(r.operator, b.lead?.value, r.value);
    case "product_id": return cmp(r.operator, b.lead?.product_id, r.value);
    case "segment_id": return cmp(r.operator, b.lead?.segment_id, r.value);
    case "assigned_to": return cmp(r.operator, b.lead?.assigned_to, r.value);
    case "status": return cmp(r.operator, b.lead?.status, r.value);
    case "days_in_stage": return cmp(r.operator, daysSince(b.lead?.moved_at), r.value);
    case "lead_age_days": return cmp(r.operator, daysSince(b.lead?.created_at), r.value);
    case "utm_source": return cmp(r.operator, b.lead?.utm_source, r.value);
    case "utm_campaign": return cmp(r.operator, b.lead?.utm_campaign, r.value);
    case "utm_medium": return cmp(r.operator, b.lead?.utm_medium, r.value);
    case "utm_content": return cmp(r.operator, b.lead?.utm_content, r.value);
    case "utm_term": return cmp(r.operator, b.lead?.utm_term, r.value);
    case "contact_source": return cmp(r.operator, b.contact?.source, r.value);
    case "contact_company": return cmp(r.operator, b.contact?.company, r.value);
    case "has_phone": return cmp(r.operator === "eq" ? "not_empty" : "empty", b.contact?.phone, null);
    case "has_email": return cmp(r.operator === "eq" ? "not_empty" : "empty", b.contact?.email, null);
    case "tags": {
      const target = String(r.value ?? "").toLowerCase();
      const has = b.tags.includes(target);
      return r.operator === "not_contains" ? !has : has;
    }
    case "propensity_score": return cmp(r.operator, b.psych?.propensity_score, r.value);
    case "risk_score": return cmp(r.operator, b.psych?.risk_score, r.value);
    case "opportunity_score": return cmp(r.operator, b.psych?.opportunity_score, r.value);
    case "pain": {
      const has = b.painIds.includes(String(r.value));
      return r.operator === "not_contains" ? !has : has;
    }
    case "objection": {
      const has = b.objectionIds.includes(String(r.value));
      return r.operator === "not_contains" ? !has : has;
    }
    case "replied_since_entry": {
      const replied = await repliedSinceEntry(supabase, run, b);
      return r.operator === "eq" && String(r.value) === "false" ? !replied : replied;
    }
    default: return false; // campo desconhecido → falso, nunca erro
  }
}

export async function evaluateBranch(supabase: any, run: ClaimedRun, config: BranchConfig): Promise<boolean> {
  const bundle = await loadBundle(supabase, run);
  const rules = config.rules ?? [];
  if (rules.length === 0) return false;
  if (config.logic === "or") {
    for (const r of rules) if (await evalRule(supabase, run, bundle, r)) return true;
    return false;
  }
  for (const r of rules) if (!(await evalRule(supabase, run, bundle, r))) return false;
  return true;
}
```

- [ ] **Step 3: Escrever `index.ts` e um `sending.ts` provisório**

`index.ts`:

```typescript
// supabase/functions/flow-worker/index.ts
// Worker dos Fluxos de CRM v2 (spec §3.2). Disparado por pg_cron a cada minuto.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeRun, type ClaimedRun } from "./executor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const counts = { processed: 0, waiting: 0, done: 0, exited: 0, failed: 0 };
  try {
    const { data: runs, error } = await supabase.rpc("flow_claim_due_runs", {
      p_limit: 50, p_lease_seconds: 300,
    });
    if (error) throw error;

    for (const run of (runs ?? []) as ClaimedRun[]) {
      counts.processed++;
      try {
        const result = await executeRun(supabase, run);
        counts[result]++;
      } catch (e) {
        counts.failed++;
        console.error("[flow-worker] run error", { run_id: run.run_id, error: e instanceof Error ? e.message : e });
        await supabase.from("crm_flow_runs")
          .update({ state: "failed", updated_at: new Date().toISOString(), lock_token: null, locked_until: null })
          .eq("id", run.run_id).eq("lock_token", run.lock_token);
      }
    }
    return new Response(JSON.stringify({ ok: true, ...counts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[flow-worker] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

`sending.ts` provisório (a Task 6 substitui pelo real; o contrato `SendOutcome` já é o definitivo):

```typescript
// supabase/functions/flow-worker/sending.ts
// PROVISÓRIO (Task 5): nós de envio pulam com motivo explícito até a Task 6.
import type { ClaimedRun, FlowNode } from "./executor.ts";

export type SendOutcome =
  | { status: "sent"; messageId?: number | null; reason?: string }
  | { status: "skipped"; reason: string; messageId?: null }
  | { status: "retry"; reason: string; messageId?: null }
  | { status: "wait"; reason: string; until: string; messageId?: null }
  | { status: "exit"; reason: string; messageId?: null };

export async function execSendWhatsApp(_s: any, _r: ClaimedRun, _n: FlowNode): Promise<SendOutcome> {
  return { status: "skipped", reason: "envio WhatsApp ainda não implementado (fase 1 em progresso)" };
}
export async function execSendEmail(_s: any, _r: ClaimedRun, _n: FlowNode): Promise<SendOutcome> {
  return { status: "skipped", reason: "envio de e-mail ainda não implementado (fase 1 em progresso)" };
}
```

- [ ] **Step 4: Registrar em `supabase/config.toml`** (seguir o formato das demais entradas do arquivo)

```toml
[functions.flow-worker]
verify_jwt = false
```

- [ ] **Step 5: Adicionar a seção "Execução" ao `scripts/test-flows.ts`**

```typescript
  console.log("== Execução (worker) ==");
  // Fluxo: branch(valor>1000) → Sim: close_lead won / Não: close_lead lost — sem envios.
  // Precisamos de um motivo de perda do workspace:
  const { data: lossReason } = await db.from("crm_loss_reasons")
    .insert({ workspace_id: workspaceId, name: `_flowtest motivo ${suffix}` })
    .select("id").single();
  cleanup.push(async () => { await db.from("crm_loss_reasons").delete().eq("id", lossReason!.id); });

  const { data: execFlow } = await db.from("crm_flows").insert({
    workspace_id: workspaceId, company_id: companyId, stage_id: stageA!.id,
    name: `_flowtest exec ${suffix}`, status: "draft", entry_node_id: "b1",
    reentry: "allowed", reentry_cooldown_hours: 1,
    nodes: [
      { id: "b1", type: "branch", config: { logic: "and", rules: [{ field: "value", operator: "gt", value: 1000 }] }, next: "w1", next_false: "l1" },
      { id: "w1", type: "close_lead", config: { outcome: "won", loss_reason_id: null }, next: null, next_false: null },
      { id: "l1", type: "close_lead", config: { outcome: "lost", loss_reason_id: lossReason!.id }, next: null, next_false: null },
    ],
  }).select("id").single();
  cleanup.push(async () => { await db.from("crm_flows").delete().eq("id", execFlow!.id); });

  // O fluxo ativo anterior da etapa A (activeFlow) precisa sair do caminho:
  await db.from("crm_flows").update({ status: "archived" }).eq("id", activeFlow!.id);
  await db.from("crm_flows").update({ status: "active" }).eq("id", execFlow!.id);

  // Lead com valor 5000 → ramo Sim → won
  await db.from("crm_flow_runs").delete().eq("lead_id", lead!.id);
  await db.from("crm_leads").update({ value: 5000, status: "open", closed_at: null, stage_id: stageB!.id }).eq("id", lead!.id);
  await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
  const { error: invokeErr } = await db.functions.invoke("flow-worker", { body: {} });
  ok("flow-worker invocado sem erro", !invokeErr, invokeErr?.message);
  const { data: leadAfter } = await db.from("crm_leads").select("status").eq("id", lead!.id).single();
  ok("branch valor>1000 → close_lead won aplicado", leadAfter?.status === "won");
  const { data: execRun } = await db.from("crm_flow_runs").select("state, exit_reason")
    .eq("flow_id", execFlow!.id).eq("lead_id", lead!.id).single();
  ok("run encerrado com exit_reason won", execRun?.state === "exited" && execRun?.exit_reason === "won");
  const { data: steps } = await db.from("crm_flow_step_log").select("node_id, result")
    .eq("flow_id", execFlow!.id).order("occurred_at");
  ok("step_log registra branch_true e o close", 
    (steps ?? []).some((s) => s.node_id === "b1" && s.result === "branch_true")
    && (steps ?? []).some((s) => s.node_id === "w1" && s.result === "sent"));

  // Reset do lead para o cleanup não deixar estado sujo
  await db.from("crm_leads").update({ status: "open", closed_at: null, value: null }).eq("id", lead!.id);
```

- [ ] **Step 6: Deployar a função e rodar**

Run: `npx supabase functions deploy flow-worker && npx tsx scripts/test-flows.ts`
Expected: todas as seções PASS (`24 passed, 0 failed`).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/flow-worker supabase/config.toml scripts/test-flows.ts
git commit -m "Fluxos v2: flow-worker com executor, condicoes e close_lead

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Worker — envio WhatsApp (com áudio) e e-mail

**Files:**
- Create: `supabase/functions/flow-worker/window.ts`
- Modify: `supabase/functions/flow-worker/sending.ts` (substituir o provisório)

**Interfaces:**
- Consumes: `SendOutcome`, `ClaimedRun`, `FlowNode` (Task 5); `_shared/resendCredentials.ts` (`getResendKey`, `resolveFromAddress`, `RESEND_FROM_NOT_CONFIGURED`); `_shared/geminiClient.ts` (`chatCompletionWithFallback`).
- Produces: `execSendWhatsApp` / `execSendEmail` reais; `computeNextValidSendTime(now, window, dayPeriod): Date | null` em `window.ts`.

A lógica é o porte de `cadence-dispatcher/index.ts` (janela: linhas 112–158; reescrita: 7–102; inbox lead: 354–408; envio: 412–601; e-mail: 602–649), adaptada: sem `cadence_scheduled_messages`, retornando `SendOutcome` para o executor decidir reagendamento/retentativa. Duplicação deliberada (convenção do projeto: lógica interna de função não vira `_shared` prematuramente) — **não** modificar o dispatcher.

- [ ] **Step 1: Escrever `window.ts`**

```typescript
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
```

- [ ] **Step 2: Substituir `sending.ts` pelo real**

```typescript
// supabase/functions/flow-worker/sending.ts
// Envio WhatsApp (Z-API, com áudio) e e-mail (Resend) para nós de fluxo.
// Porte do cadence-dispatcher; a ordem das operações segue o spec §3.5:
// validações → reescrita IA → INSERT messages(sending) → zapi-send → external_id.
import type { ClaimedRun, FlowNode } from "./executor.ts";
import { computeNextValidSendTime, fitsPeriod, fitsWindow, type SendingWindow } from "./window.ts";
import { chatCompletionWithFallback } from "../_shared/geminiClient.ts";
import { getResendKey, resolveFromAddress, RESEND_FROM_NOT_CONFIGURED } from "../_shared/resendCredentials.ts";

export type SendOutcome =
  | { status: "sent"; messageId?: number | null; reason?: string }
  | { status: "skipped"; reason: string; messageId?: null }
  | { status: "retry"; reason: string; messageId?: null }
  | { status: "wait"; reason: string; until: string; messageId?: null }
  | { status: "exit"; reason: string; messageId?: null };

const windowCache = new Map<string, SendingWindow | null>();
const resendCache = new Map<string, { apiKey: string; fromEmail: string | null } | null>();

async function getWindow(supabase: any, companyId: string): Promise<SendingWindow | null> {
  if (windowCache.has(companyId)) return windowCache.get(companyId)!;
  const { data } = await supabase.from("company_sending_window")
    .select("start_time,end_time,weekdays").eq("company_id", companyId).maybeSingle();
  windowCache.set(companyId, data ?? null);
  return data ?? null;
}

function renderTemplate(content: string, vars: Record<string, string>) {
  return content.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function normalizePhone(raw: string): string {
  let p = String(raw).replace(/\D/g, "");
  if (p.length >= 10 && p.length <= 11 && !p.startsWith("55")) p = "55" + p;
  return p;
}

interface SendContext {
  lead: any; contact: any; vars: Record<string, string>;
}

async function loadSendContext(supabase: any, run: ClaimedRun): Promise<SendContext | null> {
  const { data: lead } = await supabase.from("crm_leads")
    .select("id, title, status, contact_id, workspace_id, assigned_to, contact:crm_contacts(id, name, phone, email, company, opted_out), assignee:profiles!crm_leads_assigned_to_fkey(name)")
    .eq("id", run.lead_id).maybeSingle();
  if (!lead || !lead.contact) return null;
  const leadName = lead.contact.name || lead.title || "Cliente";
  return {
    lead, contact: lead.contact,
    vars: {
      nome_lead: leadName,
      primeiro_nome: leadName.split(" ")[0],
      empresa: lead.contact.company || "",
      atendente: (lead as any)?.assignee?.name || "",
    },
  };
}

// Porte de rewriteWithAI (dispatcher linhas 7–102), com os mesmos safeguards
// (URLs/percentuais preservados, tamanho mínimo, truncamento).
async function rewriteWithAI(original: string, supabase: any, companyId: string | null): Promise<string> {
  const text = (original || "").trim();
  if (!text) return original;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const system = [
      "Voce reescreve mensagens de WhatsApp em portugues do Brasil mantendo a essencia.",
      "REGRAS OBRIGATORIAS:",
      "- NAO invente fatos, ofertas, datas, valores, prazos, nomes ou qualquer informacao nova.",
      "- Preserve EXATAMENTE: nomes proprios, URLs/links, numeros, datas, horarios, emojis e variaveis.",
      "- Faça uma reescrita perceptivel quando possivel; nao devolva texto identico salvo sem alternativa segura.",
      "- Mantenha tom natural de WhatsApp e tamanho similar ao original.",
      "- Responda APENAS com o texto reescrito.",
    ].join("\n");
    const resp = await chatCompletionWithFallback({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: system }, { role: "user", content: text }],
      temperature: 0.4,
      max_tokens: Math.min(8192, Math.max(1024, Math.ceil(text.length * 4))),
    }, { companyId, supabase, signal: ctrl.signal });
    if (!resp.ok) return original;
    const json: any = await resp.json();
    const out = json?.choices?.[0]?.message?.content;
    const rewritten = typeof out === "string" ? out.trim() : "";
    const urls = text.match(/https?:\/\/\S+/gi) || [];
    const missingUrl = urls.some((u) => !rewritten.includes(u));
    const missingPct = (text.match(/\d+\s*%/g) || []).length > (rewritten.match(/\d+\s*%/g) || []).length;
    const tooShort = rewritten.length > 0 && rewritten.length < Math.floor(text.length * 0.6);
    if (!rewritten || json?.choices?.[0]?.finish_reason === "length" || tooShort || missingUrl || missingPct) return original;
    return rewritten;
  } catch {
    return original;
  } finally {
    clearTimeout(timer);
  }
}

// Porte de resolveOrCreateInboxLead (dispatcher linhas 354–408).
// Spec §9 item 10: status do lead novo depende de haver agente configurado.
async function resolveOrCreateInboxLead(
  supabase: any, run: ClaimedRun, ctx: SendContext, hasAgent: boolean,
): Promise<{ id: string; workspace_id: string } | null> {
  let found: any = null;
  if (ctx.lead.contact_id) {
    const { data } = await supabase.from("leads").select("id, workspace_id")
      .eq("workspace_id", run.workspace_id).eq("contact_id", ctx.lead.contact_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    found = data;
  }
  if (!found && ctx.contact.phone) {
    const { data } = await supabase.from("leads").select("id, workspace_id")
      .eq("workspace_id", run.workspace_id).eq("phone", normalizePhone(ctx.contact.phone))
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    found = data;
  }
  if (found?.id) return found;
  if (!ctx.contact.phone) return null;
  const { data: created, error } = await supabase.from("leads").insert({
    workspace_id: run.workspace_id,
    contact_id: ctx.lead.contact_id ?? null,
    phone: normalizePhone(ctx.contact.phone),
    name: ctx.contact.name || ctx.vars.nome_lead,
    source: "Fluxo",
    status: hasAgent ? "ai_talking" : "new",
  }).select("id, workspace_id").single();
  if (error) throw error;
  return created;
}

export async function execSendWhatsApp(supabase: any, run: ClaimedRun, node: FlowNode): Promise<SendOutcome> {
  const cfg = node.config as Record<string, any>;
  const ctx = await loadSendContext(supabase, run);
  if (!ctx) return { status: "skipped", reason: "lead ou contato ausente" };
  if (ctx.contact.opted_out) return { status: "exit", reason: "contato opt-out" };
  if (!ctx.contact.phone) return { status: "skipped", reason: "sem telefone" };

  // Janela + período: reagenda para o próximo horário válido (spec §3.3)
  const now = new Date();
  const win = await getWindow(supabase, run.company_id);
  if (!fitsWindow(now, win) || !fitsPeriod(now, cfg.day_period)) {
    const next = computeNextValidSendTime(now, win, cfg.day_period);
    if (!next) return { status: "skipped", reason: "janela de envio sem horário válido nos próximos 8 dias" };
    return { status: "wait", reason: "fora da janela/período", until: next.toISOString() };
  }

  // Conexão Z-API: existir, conectada, sem pendência (porte dispatcher 446–516)
  const inboxLead = await resolveOrCreateInboxLead(supabase, run, ctx, !!cfg.agent_id);
  if (!inboxLead?.id) return { status: "skipped", reason: "não foi possível criar lead do inbox" };

  const { data: conv } = await supabase.from("zapi_conversations")
    .select("id, connection_id").eq("lead_id", inboxLead.id)
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  let connectionId: string | null = conv?.connection_id ?? null;
  if (!connectionId) {
    const { data: cw } = await supabase.from("connection_workspaces")
      .select("connection_id").eq("workspace_id", inboxLead.workspace_id)
      .eq("connection_type", "zapi").eq("is_active", true).limit(1).maybeSingle();
    connectionId = cw?.connection_id ?? null;
  }
  let unhealthy = connectionId ? "" : "sem conexão Z-API ativa";
  if (connectionId) {
    const { data: zconn } = await supabase.from("zapi_connections")
      .select("zapi_connected, zapi_payment_status").eq("id", connectionId).maybeSingle();
    const paymentBad = zconn?.zapi_payment_status &&
      ["OVERDUE", "CANCELED", "CANCELLED", "SUSPENDED"].includes(String(zconn.zapi_payment_status).toUpperCase());
    if (!zconn || zconn.zapi_connected !== true) unhealthy = "Z-API desconectada";
    else if (paymentBad) unhealthy = `Z-API com pendência (${zconn.zapi_payment_status})`;
  }
  if (unhealthy) {
    // Conexão fora: reagenda +15min por até 24h (spec §3.4). O executor limita
    // pelo contador de retries? Não — este caso usa "wait" com deadline no context.
    const firstWait = Number((run.context as any)?.conn_wait_started?.[node.id] ?? 0);
    const started = firstWait || Date.now();
    ((run.context as any).conn_wait_started ??= {})[node.id] = started;
    if (Date.now() - started >= 24 * 3600_000) {
      return { status: "skipped", reason: `cancelado após 24h: ${unhealthy}` };
    }
    return { status: "wait", reason: unhealthy, until: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  // Reescrita IA — DEPOIS de todas as validações (spec §3.5)
  let rendered = renderTemplate(String(cfg.content || ""), ctx.vars);
  if (cfg.ai_rewrite_enabled === true && rendered.trim()) {
    rendered = await rewriteWithAI(rendered, supabase, run.company_id);
  }

  // INSERT com delivery_status='sending' suprime o trigger de envio assíncrono
  const { data: insertedMsg, error: msgErr } = await supabase.from("messages").insert({
    lead_id: inboxLead.id,
    workspace_id: inboxLead.workspace_id,
    content: rendered,
    sender_type: "ai",
    media_url: cfg.media_url || null,
    media_type: cfg.media_type || null,
    delivery_status: "sending",
  }).select("id").single();
  if (msgErr) return { status: "retry", reason: `insert messages: ${msgErr.message}` };

  const sendBody: Record<string, unknown> = {
    connection_id: connectionId,
    phone: normalizePhone(ctx.contact.phone),
    message: rendered,
  };
  if (cfg.media_url && cfg.media_type) {
    sendBody.media_url = cfg.media_url;
    sendBody.media_type = cfg.media_type;
    if (cfg.media_type === "audio" && cfg.audio_duration) sendBody.audio_duration = cfg.audio_duration;
  }

  let sendRes: Response, sendJson: any = {};
  try {
    sendRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/zapi-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(sendBody),
    });
    sendJson = await sendRes.json().catch(() => ({}));
  } catch (e) {
    await supabase.from("messages").update({ delivery_status: "failed" }).eq("id", insertedMsg.id);
    return { status: "retry", reason: `zapi-send fetch: ${e instanceof Error ? e.message : e}` };
  }
  if (!sendRes.ok) {
    await supabase.from("messages").update({ delivery_status: "failed" }).eq("id", insertedMsg.id);
    return { status: "retry", reason: `zapi-send ${sendRes.status}: ${JSON.stringify(sendJson).slice(0, 200)}` };
  }

  const externalId = sendJson?.zapiMessageId || sendJson?.messageId || sendJson?.message_id;
  await supabase.from("messages")
    .update({ external_message_id: externalId || null, delivery_status: "sent" })
    .eq("id", insertedMsg.id);

  // Agente IA assume o chat (porte dispatcher 577–601, com guarda de workspace)
  if (cfg.agent_id) {
    const sourceTable = cfg.agent_source === "agents" ? "agents" : "agent_instances";
    const { data: agentRow } = await supabase.from(sourceTable)
      .select("id, workspace_id").eq("id", cfg.agent_id).maybeSingle();
    if (agentRow?.id && agentRow.workspace_id === inboxLead.workspace_id) {
      await supabase.from("leads").update({
        status: "ai_talking",
        assigned_agent_id: cfg.agent_id,
        assigned_to_user_id: null,
        assigned_at: new Date().toISOString(),
      }).eq("id", inboxLead.id);
    } else {
      console.warn("[flow-worker] agente não pertence ao workspace do lead, atribuição ignorada");
    }
  }

  return { status: "sent", messageId: insertedMsg.id };
}

export async function execSendEmail(supabase: any, run: ClaimedRun, node: FlowNode): Promise<SendOutcome> {
  const cfg = node.config as Record<string, any>;
  const ctx = await loadSendContext(supabase, run);
  if (!ctx) return { status: "skipped", reason: "lead ou contato ausente" };
  if (ctx.contact.opted_out) return { status: "exit", reason: "contato opt-out" };
  if (!ctx.contact.email) return { status: "skipped", reason: "sem email" };

  const now = new Date();
  const win = await getWindow(supabase, run.company_id);
  if (!fitsWindow(now, win)) {
    const next = computeNextValidSendTime(now, win, null);
    if (!next) return { status: "skipped", reason: "janela de envio sem horário válido nos próximos 8 dias" };
    return { status: "wait", reason: "fora da janela", until: next.toISOString() };
  }

  if (!resendCache.has(run.company_id)) {
    try {
      const creds = await getResendKey(run.company_id);
      resendCache.set(run.company_id, { apiKey: creds.apiKey, fromEmail: creds.fromEmail });
    } catch {
      resendCache.set(run.company_id, null);
    }
  }
  const creds = resendCache.get(run.company_id);
  if (!creds) return { status: "retry", reason: "Resend não configurada para esta empresa (Configurações > Empresa)" };

  const subject = renderTemplate(String(cfg.subject || ""), ctx.vars);
  const html = renderTemplate(String(cfg.html || ""), ctx.vars);
  const fromName = renderTemplate(String(cfg.from_name || ""), ctx.vars).trim()
    || (ctx.lead as any)?.assignee?.name || "Nexus";
  const fromHeader = resolveFromAddress(creds.fromEmail, fromName);
  if (!fromHeader) return { status: "retry", reason: RESEND_FROM_NOT_CONFIGURED };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromHeader, to: [ctx.contact.email], subject: subject || "Notificação", html }),
  });
  if (!res.ok) return { status: "retry", reason: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };

  // Log no chat do inbox (media_type='email' suprime o trigger de WhatsApp)
  let messageId: number | null = null;
  try {
    const inboxLead = await resolveOrCreateInboxLead(supabase, run, ctx, false);
    if (inboxLead?.id) {
      const { data: logMsg } = await supabase.from("messages").insert({
        lead_id: inboxLead.id,
        workspace_id: inboxLead.workspace_id,
        content: `[E-mail] ${subject || "(sem assunto)"}\n\n${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`,
        sender_type: "ai",
        media_type: "email",
        delivery_status: "sent",
      }).select("id").single();
      messageId = logMsg?.id ?? null;
    }
  } catch (e) {
    console.error("[flow-worker] email chat log error", e instanceof Error ? e.message : e);
  }
  return { status: "sent", messageId };
}
```

Nota sobre o caso "conexão indisponível": o `context.conn_wait_started[node.id]` gravado em `execSendWhatsApp` só persiste porque o executor grava `context` no `writeRun` do outcome `wait` — conferir que o executor da Task 5 passa `context` nesse caminho (ele passa).

- [ ] **Step 3: Deployar e verificar com um fluxo real de WhatsApp (manual)**

Run: `npx supabase functions deploy flow-worker`

No workspace de teste com conexão Z-API ativa, criar via SQL/Studio um fluxo `active` com nó `send_whatsapp` (`content: "Teste fluxo v2 {primeiro_nome}"`, `day_period: "qualquer"`) na etapa de teste, mover um lead com telefone real para a etapa, invocar `flow-worker` e conferir: mensagem chega no WhatsApp; `messages` tem `external_message_id` e `delivery_status='sent'`; `crm_flow_step_log` tem `result='sent'` com `message_id`.
Expected: os três pontos confirmados. (Áudio, e-mail, reescrita e reatribuição de agente ficam no checklist manual da Task 8.)

- [ ] **Step 4: Rodar a suíte para garantir que nada regrediu**

Run: `npx tsx scripts/test-flows.ts`
Expected: `24 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/flow-worker
git commit -m "Fluxos v2: envio WhatsApp (com audio) e e-mail no flow-worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Migration — cron do worker

**Files:**
- Create: `supabase/migrations/20260813122000_crm_flows_worker_cron.sql`

**Interfaces:**
- Consumes: `flow-worker` deployado (Task 6).
- Produces: job `flow-worker-every-minute` no pg_cron (resolve o problema 9 da v1: cron versionado).

- [ ] **Step 1: Escrever a migration** (mesmo padrão de `20260209140000_create_zapi_health_check_cron.sql` — URL do projeto + anon key)

```sql
-- Fluxos v2 — tick do worker a cada minuto (spec §3.2). Versionado em migration
-- de propósito: a v1 mantinha o cron só no dashboard (problema 9 da análise).
SELECT cron.unschedule('flow-worker-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-worker-every-minute');

SELECT cron.schedule(
  'flow-worker-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/flow-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwYnZuYnVieHlhaWh5Z254ZGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwOTk4MDIsImV4cCI6MjA4MDY3NTgwMn0.vzLjyMKpGIucsgVsYzWryjNDjEYmItzwOdkuflpWg3M"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Aplicar e verificar**

Run: `npx supabase db push`
Depois (SQL no Studio): `SELECT jobname, schedule FROM cron.job WHERE jobname = 'flow-worker-every-minute';`
Expected: 1 linha com schedule `* * * * *`. Após ~2 min, `SELECT count(*) FROM crm_flow_step_log` não deve crescer sozinho (nenhum fluxo ativo real) e os logs da função no dashboard mostram ticks `{ok:true, processed:0}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260813122000_crm_flows_worker_cron.sql
git commit -m "Fluxos v2: cron do flow-worker versionado em migration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação final da fase, push e prompt do Lovable

**Files:**
- Modify: `CLAUDE.md` (documentar o motor na seção Business Domain)

- [ ] **Step 1: Rodar a suíte completa**

Run: `npx tsx scripts/test-flows.ts`
Expected: `24 passed, 0 failed`, cleanup sem sobras (conferir que não restam linhas `_flowtest` em `crm_flows`, `crm_pipeline_stages`, `crm_contacts`, `crm_leads`, `crm_loss_reasons`).

- [ ] **Step 2: Checklist manual (dependências externas)** — executar no workspace de teste:

1. Nó WhatsApp com **áudio** (upload manual de um MP3 no bucket `widget-assets/cadence/{company_id}/`, `media_type:'audio'`, `audio_duration` preenchido) → chega como mensagem de voz com waveform.
2. Nó WhatsApp com `ai_rewrite_enabled: true` → texto reescrito preservando nomes/links (conferir log da função).
3. Nó WhatsApp com `agent_id` de agente do workspace → lead do inbox vai para `ai_talking` com o agente.
4. Nó e-mail (empresa com Resend configurada) → e-mail chega; `messages` ganha o log com `media_type='email'`.
5. Janela de envio: fluxo disparado fora da janela → `step_log` mostra `rescheduled` e o envio sai no próximo horário válido.
6. Pausar o fluxo entre duas mensagens → nada sai; despausar → retoma.

- [ ] **Step 3: Documentar no `CLAUDE.md`** — adicionar item na seção "Business Domain" (após o item 17):

```markdown
18. **CRM Flows v2 (motor)** (`supabase/functions/flow-worker/`):
    - Tabelas `crm_flows` (grafo JSONB validado por `validate_crm_flow_graph`: ciclo, ponteiros, config por tipo), `crm_flow_runs` (um run aberto por flow+lead, claim com lease + fencing token), `crm_flow_step_log` (métricas por nó)
    - Gatilho: entrada em etapa do pipeline (`trg_crm_flow_lead_stage` em `crm_leads`); saída configurável por `exit_on_stage_change`; `won`/`lost` encerra runs (`trg_crm_flow_lead_close`)
    - Worker via pg_cron 1/min (`flow-worker-every-minute`, versionado em migration); nós: `delay`, `branch`, `send_whatsapp` (paridade v1 + áudio), `send_email`, `close_lead`
    - Fora da janela de envio → reagenda (nunca descarta); falha de envio → backoff 5min/15min/1h e segue o fluxo
    - Convive com as réguas v1 (nenhuma tabela/trigger da v1 é tocada); teste: `scripts/test-flows.ts`
```

- [ ] **Step 4: Push e prompt do Lovable**

```bash
git push origin main
```

Entregar ao usuário o prompt para colar no editor Lovable (o deploy não é automático), por exemplo:

> As migrations de `crm_flows` (5 arquivos `20260813*`) já estão commitadas na main — aplique-as como estão, sem criar novas migrations duplicadas. Faça também o deploy da edge function `flow-worker`. Nenhuma alteração de frontend nesta fase.

Expected: migrations aplicadas 1x (sem duplicatas no editor), função deployada, cron ativo.

---

## Self-review (executado na escrita do plano)

- **Cobertura do spec (Fase 1)**: §2 tabelas → Task 1; §2.1 validação → Task 2; §3.1 triggers → Tasks 2–3; §3.2 claim/worker → Tasks 4–5; §3.3–3.5 janela/retentativa/ordem → Task 6; cron → Task 7; §6 testes → distribuídos + Task 8. UI (§5), TipTap (§5.4) e métricas de UI (§5.5) são Fases 2–4, fora deste plano.
- **Placeholders**: nenhum "TBD"; o único código provisório (sending.ts da Task 5) é deliberado, com contrato final e substituição na Task 6.
- **Consistência de tipos**: `SendOutcome` idêntico nas Tasks 5–6; colunas do retorno da RPC (Task 4) = interface `ClaimedRun` (Task 5); nomes de trigger/função iguais entre migrations e testes.
