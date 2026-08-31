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
          .eq("id", run.run_id).eq("lock_token", run.lock_token)
          .in("state", ["active", "waiting"]);
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
