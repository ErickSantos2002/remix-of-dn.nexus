-- ============================================================================
-- Fluxos de CRM v2 — Verificação do motor em SQL puro (PASSO 2 de 2).
-- Execute ~2 minutos após o PASSO 1 (o cron do flow-worker roda a cada 1 min).
-- Verifica a execução real (branch → close_lead won) e REMOVE todos os dados
-- de teste ("_flowtest").
-- ============================================================================

DO $do$
DECLARE
  v_lead uuid;
  v_exec_flow uuid;
  v_status text;
  v_state text; v_exit text;
  v_branch int; v_close int;
BEGIN
  SELECT id INTO v_lead FROM public.crm_leads WHERE title = '_flowtest lead' LIMIT 1;
  SELECT id INTO v_exec_flow FROM public.crm_flows WHERE name = '_flowtest exec' LIMIT 1;
  IF v_lead IS NULL OR v_exec_flow IS NULL THEN
    RAISE EXCEPTION 'dados do PASSO 1 não encontrados — rode o test-flows-step1.sql primeiro';
  END IF;

  SELECT status INTO v_status FROM public.crm_leads WHERE id = v_lead;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('worker executou branch(valor>1000) → close_lead won', v_status = 'won', coalesce(v_status, '-'));

  SELECT state, exit_reason INTO v_state, v_exit FROM public.crm_flow_runs
  WHERE flow_id = v_exec_flow AND lead_id = v_lead ORDER BY entered_at DESC LIMIT 1;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('run encerrado com exit_reason won', v_state = 'exited' AND v_exit = 'won',
          coalesce(v_state, '-') || '/' || coalesce(v_exit, '-'));

  SELECT count(*) FILTER (WHERE node_id = 'b1' AND result = 'branch_true'),
         count(*) FILTER (WHERE node_id = 'w1' AND result = 'sent')
    INTO v_branch, v_close
  FROM public.crm_flow_step_log WHERE flow_id = v_exec_flow;
  INSERT INTO public._flowtest_results (test, pass, detail)
  VALUES ('step_log registra branch_true e o fechamento', v_branch >= 1 AND v_close >= 1,
          'branch_true=' || v_branch || ' close_sent=' || v_close);
END
$do$;

-- Resultados finais (todas as linhas dos dois passos):
SELECT seq, test, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS resultado, detail
FROM public._flowtest_results ORDER BY seq;

-- ---------- Limpeza (remove TODOS os dados de teste) ----------
DELETE FROM public.crm_flows WHERE name LIKE '\_flowtest%';           -- runs e step_log caem em cascata
DELETE FROM public.crm_leads WHERE title = '_flowtest lead';
DELETE FROM public.crm_contacts WHERE name = '_flowtest contato';
DELETE FROM public.crm_loss_reasons WHERE name = '_flowtest motivo';
DELETE FROM public.crm_pipeline_stages WHERE name LIKE '\_flowtest%';
DROP TABLE IF EXISTS public._flowtest_results;
