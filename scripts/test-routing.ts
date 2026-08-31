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
