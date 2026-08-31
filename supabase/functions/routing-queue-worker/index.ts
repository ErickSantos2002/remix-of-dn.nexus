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
        const { error: cancelError } = await supabase.from("lead_queues")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", row.id).eq("status", "waiting");
        if (cancelError) {
          console.error(`routing-queue-worker: failed to cancel lead_queues row ${row.id}`, cancelError);
        } else {
          cancelled++;
        }
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
