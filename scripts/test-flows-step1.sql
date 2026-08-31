-- ============================================================================
-- Fluxos de CRM v2 — Verificação do motor em SQL puro (PASSO 1 de 2).
-- Para ambientes sem acesso ao terminal/service key (Lovable Cloud).
--
-- COMO USAR:
--   0. Rode:  SELECT id, name FROM workspaces ORDER BY name;
--      e cole o id do workspace de TESTE na linha "v_ws uuid := ..." abaixo.
--   1. Execute este arquivo inteiro no SQL Editor.
--   2. A última query mostra a tabela de resultados (test / pass / detail).
--   3. Aguarde ~2 minutos (o cron do flow-worker roda a cada 1 min) e execute
--      o test-flows-step2.sql — ele verifica a execução real e limpa TUDO.
--
-- Os fluxos de teste usam apenas nós delay/branch/close_lead — NENHUMA
-- mensagem externa é enviada. Todos os dados criados têm prefixo "_flowtest".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._flowtest_results (
  seq serial PRIMARY KEY, test text, pass boolean, detail text
);
TRUNCATE public._flowtest_results;

DO $do$
DECLARE
  -- >>>>>>>>>>>>>>>>> EDITE AQUI <<<<<<<<<<<<<<<<<
  v_ws uuid := 'a6c9db54-572e-4b3d-a0c6-e30e5b2c2e03'; -- Vendas (dn.ia)
  -- >>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<
  v_company uuid;
  v_stage_a uuid; v_stage_b uuid;
  v_contact uuid; v_lead uuid;
  v_flow uuid; v_active_flow uuid; v_claim_flow uuid; v_exec_flow uuid;
  v_forced_flow uuid; v_forced_company uuid;
  v_loss uuid;
  v_run_id uuid; v_state text; v_exit text; v_node text;
  v_cnt int; v_cnt2 int;
  v_lock uuid; v_nodes jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.workspaces WHERE id = v_ws;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'workspace % não encontrado — edite v_ws no topo do script', v_ws;
  END IF;

  -- ---------- Setup ----------
  INSERT INTO public.crm_pipeline_stages (workspace_id, name, "order")
  VALUES (v_ws, '_flowtest A', 9001) RETURNING id INTO v_stage_a;
  INSERT INTO public.crm_pipeline_stages (workspace_id, name, "order")
  VALUES (v_ws, '_flowtest B', 9002) RETURNING id INTO v_stage_b;
  INSERT INTO public.crm_contacts (workspace_id, name, phone)
  VALUES (v_ws, '_flowtest contato', '5511977' || floor(100000 + random() * 899999)::text)
  RETURNING id INTO v_contact;
  INSERT INTO public.crm_leads (workspace_id, stage_id, contact_id, title)
  VALUES (v_ws, v_stage_b, v_contact, '_flowtest lead') RETURNING id INTO v_lead;

  -- ---------- Schema ----------
  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, nodes, status)
  VALUES (v_ws, v_company, v_stage_a, '_flowtest draft', '[]'::jsonb, 'draft')
  RETURNING id INTO v_flow;
  INSERT INTO public._flowtest_results (test, pass) VALUES ('insert de fluxo draft vazio', true);

  BEGIN
    INSERT INTO public.crm_flow_runs (flow_id, lead_id, workspace_id, exit_reason)
    VALUES (v_flow, v_lead, v_ws, 'banana');
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('CHECK de exit_reason rejeita inválido', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('CHECK de exit_reason rejeita inválido', true, SQLERRM);
  END;

  -- ---------- Validação do grafo ----------
  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest ciclo', 'n1',
      '[{"id":"n1","type":"delay","config":{"minutes":5},"next":"n2","next_false":null},
        {"id":"n2","type":"delay","config":{"minutes":5},"next":"n1","next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('grafo com ciclo rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail)
    VALUES ('grafo com ciclo rejeitado', SQLERRM ILIKE '%ciclo%', SQLERRM);
  END;

  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest ponteiro', 'n1',
      '[{"id":"n1","type":"delay","config":{"minutes":5},"next":"nao-existe","next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('ponteiro quebrado rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('ponteiro quebrado rejeitado', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest terminal', 'n1',
      '[{"id":"n1","type":"close_lead","config":{"outcome":"won","loss_reason_id":null},"next":"n2","next_false":null},
        {"id":"n2","type":"delay","config":{"minutes":5},"next":null,"next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('close_lead com next rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('close_lead com next rejeitado', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest lost', 'n1',
      '[{"id":"n1","type":"close_lead","config":{"outcome":"lost","loss_reason_id":null},"next":null,"next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('lost sem motivo rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('lost sem motivo rejeitado', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest semregras', 'n1',
      '[{"id":"n1","type":"branch","config":{"logic":"and","rules":[]},"next":null,"next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('branch sem regras rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('branch sem regras rejeitado', true, SQLERRM);
  END;

  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, entry_node_id, nodes)
  VALUES (v_ws, v_company, v_stage_a, '_flowtest valido', 'n1',
    '[{"id":"n1","type":"delay","config":{"minutes":60},"next":"n2","next_false":null},
      {"id":"n2","type":"branch","config":{"logic":"and","rules":[{"field":"value","operator":"gt","value":1000}]},"next":"n3","next_false":null},
      {"id":"n3","type":"close_lead","config":{"outcome":"won","loss_reason_id":null},"next":null,"next_false":null}]'::jsonb);
  INSERT INTO public._flowtest_results (test, pass) VALUES ('grafo válido aceito', true);

  BEGIN
    UPDATE public.crm_flows SET status = 'active' WHERE id = v_flow; -- draft vazio
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('ativar fluxo sem nós rejeitado', false, 'update passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('ativar fluxo sem nós rejeitado', true, SQLERRM);
  END;

  -- I1: company_id é forçado a partir do workspace mesmo se vier errado
  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, nodes, status)
  VALUES (v_ws, gen_random_uuid(), v_stage_a, '_flowtest company', '[]'::jsonb, 'draft')
  RETURNING id INTO v_forced_flow;
  SELECT company_id INTO v_forced_company FROM public.crm_flows WHERE id = v_forced_flow;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('company_id forçado do workspace', v_forced_company = v_company, v_forced_company::text);

  -- ---------- Inscrição / Reentrada / Saída ----------
  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, status, entry_node_id, reentry, reentry_cooldown_hours, nodes)
  VALUES (v_ws, v_company, v_stage_a, '_flowtest ativo', 'active', 'n1', 'allowed', 1,
    '[{"id":"n1","type":"delay","config":{"minutes":1440},"next":null,"next_false":null}]'::jsonb)
  RETURNING id INTO v_active_flow;

  BEGIN
    INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, status, entry_node_id, nodes)
    VALUES (v_ws, v_company, v_stage_a, '_flowtest dup', 'active', 'n1',
      '[{"id":"n1","type":"delay","config":{"minutes":5},"next":null,"next_false":null}]'::jsonb);
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('segundo fluxo ativo na mesma etapa rejeitado', false, 'insert passou');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._flowtest_results (test, pass, detail) VALUES ('segundo fluxo ativo na mesma etapa rejeitado', true, SQLERRM);
  END;

  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead;
  SELECT id, current_node_id INTO v_run_id, v_node FROM public.crm_flow_runs
  WHERE flow_id = v_active_flow AND lead_id = v_lead AND state IN ('active','waiting');
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('mover lead para a etapa cria run', v_run_id IS NOT NULL AND v_node = 'n1', coalesce(v_node, 'sem run'));

  UPDATE public.crm_leads SET stage_id = v_stage_b WHERE id = v_lead;
  SELECT state, exit_reason INTO v_state, v_exit FROM public.crm_flow_runs WHERE id = v_run_id;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('saída da etapa encerra run (stage_change)', v_state = 'exited' AND v_exit = 'stage_change', v_state || '/' || coalesce(v_exit, '-'));

  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead; -- dentro do cooldown de 1h
  SELECT count(*) INTO v_cnt FROM public.crm_flow_runs WHERE flow_id = v_active_flow AND lead_id = v_lead;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('reentrada dentro do cooldown não recria run', v_cnt = 1, v_cnt::text);

  UPDATE public.crm_flows SET exit_on_stage_change = false WHERE id = v_active_flow;
  DELETE FROM public.crm_flow_runs WHERE lead_id = v_lead;
  UPDATE public.crm_leads SET stage_id = v_stage_b WHERE id = v_lead;
  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead; -- cria run
  UPDATE public.crm_leads SET stage_id = v_stage_b WHERE id = v_lead; -- não deve encerrar
  SELECT count(*) INTO v_cnt FROM public.crm_flow_runs
  WHERE flow_id = v_active_flow AND lead_id = v_lead AND state IN ('active','waiting');
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('exit_on_stage_change=false mantém o run', v_cnt = 1, v_cnt::text);

  UPDATE public.crm_leads SET status = 'won', closed_at = now() WHERE id = v_lead;
  SELECT state, exit_reason INTO v_state, v_exit FROM public.crm_flow_runs
  WHERE flow_id = v_active_flow AND lead_id = v_lead ORDER BY entered_at DESC LIMIT 1;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('lead won encerra o run', v_state = 'exited' AND v_exit = 'won', v_state || '/' || coalesce(v_exit, '-'));
  UPDATE public.crm_leads SET status = 'open', closed_at = NULL WHERE id = v_lead;

  UPDATE public.crm_flows SET reentry = 'once', exit_on_stage_change = true WHERE id = v_active_flow;
  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead; -- histórico existe → não cria
  SELECT count(*) INTO v_cnt FROM public.crm_flow_runs WHERE flow_id = v_active_flow AND lead_id = v_lead;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('reentry=once não reinscreve', v_cnt = 1, v_cnt::text);
  UPDATE public.crm_leads SET stage_id = v_stage_b WHERE id = v_lead;

  -- ---------- Pausa / Claim ----------
  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, status, entry_node_id, reentry, reentry_cooldown_hours, nodes)
  VALUES (v_ws, v_company, v_stage_b, '_flowtest claim', 'active', 'n1', 'allowed', 1,
    '[{"id":"n1","type":"delay","config":{"minutes":1440},"next":null,"next_false":null}]'::jsonb)
  RETURNING id INTO v_claim_flow;
  DELETE FROM public.crm_flow_runs WHERE lead_id = v_lead;
  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead;
  UPDATE public.crm_leads SET stage_id = v_stage_b WHERE id = v_lead; -- inscreve no claim flow

  UPDATE public.crm_flows SET status = 'paused' WHERE id = v_claim_flow;
  SELECT count(*) INTO v_cnt FROM public.flow_claim_due_runs(10, 60, v_claim_flow);
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('fluxo pausado: claim não retorna runs', v_cnt = 0, v_cnt::text);

  UPDATE public.crm_flows SET status = 'active' WHERE id = v_claim_flow;
  SELECT count(*), max(lock_token::text)::uuid, max(nodes::text)::jsonb INTO v_cnt, v_lock, v_nodes
  FROM public.flow_claim_due_runs(10, 60, v_claim_flow);
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('fluxo ativo: claim retorna run com lock e nodes',
          v_cnt = 1 AND v_lock IS NOT NULL AND jsonb_array_length(v_nodes) = 1, v_cnt::text);

  SELECT count(*) INTO v_cnt FROM public.flow_claim_due_runs(10, 60, v_claim_flow);
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('run com lease não é colhido de novo', v_cnt = 0, v_cnt::text);

  UPDATE public.crm_flow_runs SET locked_until = now() - interval '1 second'
  WHERE flow_id = v_claim_flow AND lead_id = v_lead AND state IN ('active','waiting');
  SELECT count(*) INTO v_cnt FROM public.flow_claim_due_runs(10, 60, v_claim_flow);
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('lease expirado: run é colhido de novo', v_cnt = 1, v_cnt::text);

  UPDATE public.crm_flows SET status = 'archived' WHERE id = v_claim_flow;
  SELECT state, exit_reason INTO v_state, v_exit FROM public.crm_flow_runs
  WHERE flow_id = v_claim_flow AND lead_id = v_lead ORDER BY entered_at DESC LIMIT 1;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('arquivar fluxo encerra runs (flow_archived)', v_state = 'exited' AND v_exit = 'flow_archived', v_state || '/' || coalesce(v_exit, '-'));

  -- ---------- Setup da execução real (verificada no PASSO 2) ----------
  INSERT INTO public.crm_loss_reasons (workspace_id, name)
  VALUES (v_ws, '_flowtest motivo') RETURNING id INTO v_loss;

  UPDATE public.crm_flows SET status = 'archived' WHERE id = v_active_flow;
  INSERT INTO public.crm_flows (workspace_id, company_id, stage_id, name, status, entry_node_id, reentry, reentry_cooldown_hours, nodes)
  VALUES (v_ws, v_company, v_stage_a, '_flowtest exec', 'active', 'b1', 'allowed', 1,
    ('[{"id":"b1","type":"branch","config":{"logic":"and","rules":[{"field":"value","operator":"gt","value":1000}]},"next":"w1","next_false":"l1"},
       {"id":"w1","type":"close_lead","config":{"outcome":"won","loss_reason_id":null},"next":null,"next_false":null},
       {"id":"l1","type":"close_lead","config":{"outcome":"lost","loss_reason_id":"' || v_loss || '"},"next":null,"next_false":null}]')::jsonb)
  RETURNING id INTO v_exec_flow;

  DELETE FROM public.crm_flow_runs WHERE lead_id = v_lead;
  UPDATE public.crm_leads SET value = 5000, status = 'open', closed_at = NULL WHERE id = v_lead;
  UPDATE public.crm_leads SET stage_id = v_stage_a WHERE id = v_lead; -- inscreve; cron executa em ~1 min

  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('setup da execução real concluído (aguarde ~2 min e rode o PASSO 2)', true, 'exec_flow=' || v_exec_flow);
END
$do$;

SELECT seq, test, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS resultado, detail
FROM public._flowtest_results ORDER BY seq;
