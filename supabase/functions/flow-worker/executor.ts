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
    .in("state", ["active", "waiting"])
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
      if (!(await writeRun(supabase, run, { state: "done", current_node_id: null, lock_token: null, locked_until: null }))) return "exited";
      return "done";
    }
    const node = byId.get(currentId);
    if (!node) {
      if (!(await writeRun(supabase, run, { state: "exited", exit_reason: "node_deleted", lock_token: null, locked_until: null }))) return "exited";
      return "exited";
    }

    switch (node.type) {
      case "delay": {
        const minutes = Math.max(1, Number(node.config.minutes) || 1);
        const wakeup = new Date(Date.now() + minutes * 60_000 + jitterMs(minutes)).toISOString();
        await logStep(supabase, run, node, "entered", { minutes });
        // A espera acontece ENTRE nós: current avança para o next e o run dorme.
        if (!(await writeRun(supabase, run, {
          state: "waiting", current_node_id: node.next, wakeup_at: wakeup, lock_token: null, locked_until: null,
        }))) return "exited";
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
        // Heartbeat: renova o lease e confirma a posse antes de efeitos externos.
        const owned = await writeRun(supabase, run, {
          locked_until: new Date(Date.now() + 300_000).toISOString(),
        });
        if (!owned) return "exited";
        const send = node.type === "send_whatsapp" ? execSendWhatsApp : execSendEmail;
        const outcome = await send(supabase, run, node);
        if (outcome.status === "wait") {
          // Fora da janela/período ou conexão indisponível: reagenda SEM avançar (spec §3.3/§3.4)
          await logStep(supabase, run, node, "rescheduled", { reason: outcome.reason, until: outcome.until });
          if (!(await writeRun(supabase, run, {
            state: "waiting", current_node_id: node.id, wakeup_at: outcome.until,
            context, lock_token: null, locked_until: null,
          }))) return "exited";
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
            if (!(await writeRun(supabase, run, {
              state: "waiting", current_node_id: node.id, wakeup_at: until,
              context, lock_token: null, locked_until: null,
            }))) return "exited";
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
        if (outcome.status === "fail") {
          // Conexão indisponível por 24h (spec §3.4): falha registrada, run continua.
          await logStep(supabase, run, node, "failed", { reason: outcome.reason });
          currentId = node.next;
          continue;
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
        // O trigger trg_crm_flow_lead_close normalmente já encerrou o run; se o
        // status do lead já era igual ao outcome, o trigger não dispara — esta
        // escrita (no-op quando o run já está encerrado) garante o término.
        await writeRun(supabase, run, {
          state: "exited",
          exit_reason: outcome === "won" ? "won" : "lost",
          lock_token: null,
          locked_until: null,
        });
        return "exited";
      }
    }
  }

  // Cap atingido (defesa em profundidade além da validação de ciclo): continua no próximo tick
  if (!(await writeRun(supabase, run, {
    state: "active", current_node_id: currentId, wakeup_at: new Date().toISOString(),
    context, lock_token: null, locked_until: null,
  }))) return "exited";
  return "waiting";
}
