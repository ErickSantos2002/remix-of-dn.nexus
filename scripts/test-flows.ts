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

  const { data: stageA, error: stageAErr } = await db.from("crm_pipeline_stages")
    .insert({ workspace_id: workspaceId, name: `_flowtest A ${suffix}`, order: 9001 })
    .select("id").single();
  if (stageAErr || !stageA) throw new Error(`setup stageA falhou: ${stageAErr?.message}`);
  const { data: stageB, error: stageBErr } = await db.from("crm_pipeline_stages")
    .insert({ workspace_id: workspaceId, name: `_flowtest B ${suffix}`, order: 9002 })
    .select("id").single();
  if (stageBErr || !stageB) throw new Error(`setup stageB falhou: ${stageBErr?.message}`);
  cleanup.push(async () => { await db.from("crm_pipeline_stages").delete().in("id", [stageA!.id, stageB!.id]); });

  const { data: contact, error: contactErr } = await db.from("crm_contacts")
    .insert({ workspace_id: workspaceId, name: `_flowtest ${suffix}`, phone: `5511977${Math.floor(100000 + Math.random() * 899999)}` })
    .select("id").single();
  if (contactErr || !contact) throw new Error(`setup contact falhou: ${contactErr?.message}`);
  cleanup.push(async () => { await db.from("crm_contacts").delete().eq("id", contact!.id); });

  // Lead nasce na etapa B (sem fluxo) para os testes controlarem a entrada em A.
  const { data: lead, error: leadErr } = await db.from("crm_leads")
    .insert({ workspace_id: workspaceId, stage_id: stageB!.id, contact_id: contact!.id, title: `_flowtest ${suffix}` })
    .select("id").single();
  if (leadErr || !lead) throw new Error(`setup lead falhou: ${leadErr?.message}`);
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
  // Expira o lease explicitamente (sem sleep: zero janela para o cron de produção colher o run)
  await db.from("crm_flow_runs").update({ locked_until: new Date(Date.now() - 1000).toISOString() })
    .eq("id", claim1![0].run_id);
  const [ra, rb] = await Promise.all([
    db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 60, p_flow_id: claimFlow!.id }),
    db.rpc("flow_claim_due_runs", { p_limit: 10, p_lease_seconds: 60, p_flow_id: claimFlow!.id }),
  ]);
  const total = (ra.data ?? []).length + (rb.data ?? []).length;
  ok("claims concorrentes não duplicam o run", total === 1, { a: ra.data?.length, b: rb.data?.length });

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

  console.log("== Condição: última atividade ==");
  // Duas reuniões no card: a mais antiga concluída, a mais recente no-show.
  // A regra olha só a última (maior scheduled_at).
  const dayMs = 86_400_000;
  const { data: actOld } = await db.from("crm_lead_activities").insert({
    workspace_id: workspaceId, lead_id: lead!.id, type: "meeting", status: "completed",
    title: `_flowtest reuniao antiga ${suffix}`,
    scheduled_at: new Date(Date.now() - 2 * dayMs).toISOString(),
  }).select("id").single();
  const { data: actNew } = await db.from("crm_lead_activities").insert({
    workspace_id: workspaceId, lead_id: lead!.id, type: "meeting", status: "no_show",
    title: `_flowtest reuniao recente ${suffix}`,
    scheduled_at: new Date(Date.now() - 1 * dayMs).toISOString(),
  }).select("id").single();
  cleanup.push(async () => {
    await db.from("crm_lead_activities").delete().in("id", [actOld!.id, actNew!.id]);
  });

  const runActivityFlow = async (rule: Record<string, unknown>) => {
    await db.from("crm_flows").update({
      nodes: [
        { id: "b1", type: "branch", config: { logic: "and", rules: [rule] }, next: "w1", next_false: "l1" },
        { id: "w1", type: "close_lead", config: { outcome: "won", loss_reason_id: null }, next: null, next_false: null },
        { id: "l1", type: "close_lead", config: { outcome: "lost", loss_reason_id: lossReason!.id }, next: null, next_false: null },
      ],
    }).eq("id", execFlow!.id);
    await db.from("crm_flow_runs").delete().eq("lead_id", lead!.id);
    await db.from("crm_leads").update({ status: "open", closed_at: null, stage_id: stageB!.id }).eq("id", lead!.id);
    await db.from("crm_leads").update({ stage_id: stageA!.id }).eq("id", lead!.id);
    await db.functions.invoke("flow-worker", { body: {} });
    const { data } = await db.from("crm_leads").select("status").eq("id", lead!.id).single();
    return data?.status;
  };

  ok("última reunião é no-show → ramo Sim",
    (await runActivityFlow({ field: "last_activity", operator: "has", value: { type: "meeting", status: "no_show" } })) === "won");
  ok("última reunião não está concluída → ramo Não",
    (await runActivityFlow({ field: "last_activity", operator: "has", value: { type: "meeting", status: "completed" } })) === "lost");
  ok("status vazio = qualquer status → ramo Sim",
    (await runActivityFlow({ field: "last_activity", operator: "has", value: { type: "meeting" } })) === "won");
  ok("tipo sem atividade no card → ramo Não",
    (await runActivityFlow({ field: "last_activity", operator: "has", value: { type: "demo" } })) === "lost");
  ok("não tem atividade do tipo demo → ramo Sim",
    (await runActivityFlow({ field: "last_activity", operator: "not_has", value: { type: "demo" } })) === "won");

  // Reset do lead para o cleanup não deixar estado sujo
  await db.from("crm_leads").update({ status: "open", closed_at: null, value: null }).eq("id", lead!.id);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { for (const fn of cleanup.reverse()) await fn().catch(() => {}); });
