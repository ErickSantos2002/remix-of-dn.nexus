// Monitor de saúde do webhook do Daily.co.
// Roda via pg_cron (a cada 5 min) e, para cada workspace ativo recentemente:
//   1) Consulta GET /webhooks no Daily com a API key da empresa
//   2) Se o webhook está ausente ou em FAILED, incrementa consecutive_failures
//   3) Quando consecutive_failures >= 2, força recriação via mesma lógica de
//      ensureDailyWebhook usada em daily-room (deleta e recria)
//   4) Registra estado em public.daily_webhook_health
//
// Cobre todas as features que dependem do webhook (participant.joined,
// meeting.ended, recording.ready-to-download, transcript.ready-to-download).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

const DAILY_API_BASE = "https://api.daily.co/v1";
const DESIRED_EVENTS = [
  "recording.ready-to-download",
  "transcript.ready-to-download",
  "participant.joined",
  "meeting.ended",
];
const FAILURE_THRESHOLD = 2;
const ACTIVE_WINDOW_DAYS = 7;

// --- Decryption (mirror src/lib/crypto.ts) ---
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

async function decryptToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

async function dailyFetch(apiKey: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Daily API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function recreateWebhook(apiKey: string, supabaseUrl: string): Promise<void> {
  const webhookUrl = `${supabaseUrl}/functions/v1/daily-webhook`;
  const existing = await dailyFetch(apiKey, "/webhooks");
  const webhooks = Array.isArray(existing) ? existing : (existing?.data || []);

  for (const w of webhooks) {
    try {
      await dailyFetch(apiKey, `/webhooks/${w.uuid}`, { method: "DELETE" });
      console.log("[daily-webhook-monitor] Deleted webhook", w.uuid, "state=", w.state);
    } catch (e) {
      console.warn("[daily-webhook-monitor] Failed to delete webhook", w.uuid, e);
    }
  }

  await dailyFetch(apiKey, "/webhooks", {
    method: "POST",
    body: JSON.stringify({ url: webhookUrl, eventTypes: DESIRED_EVENTS }),
  });
  console.log("[daily-webhook-monitor] Recreated webhook at", webhookUrl);
}

interface CheckResult {
  workspace_id: string;
  state: string;
  failures: number;
  recreated: boolean;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const results: CheckResult[] = [];

  try {
    // Busca workspaces com appointments do Daily nos últimos N dias.
    const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400 * 1000).toISOString();
    const { data: appts, error: apptsError } = await supabaseAdmin
      .from("crm_appointments")
      .select("workspace_id")
      .eq("meeting_type", "daily")
      .gte("created_at", since);

    if (apptsError) {
      console.error("[daily-webhook-monitor] Failed to list appointments:", apptsError);
      return new Response(JSON.stringify({ error: apptsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const workspaceIds = Array.from(
      new Set((appts || []).map((a: { workspace_id: string }) => a.workspace_id).filter(Boolean)),
    );
    console.log("[daily-webhook-monitor] Checking", workspaceIds.length, "workspace(s)");

    // Cache de API key por company (várias workspaces compartilham).
    const apiKeyCache = new Map<string, string>();

    for (const workspaceId of workspaceIds) {
      const result: CheckResult = {
        workspace_id: workspaceId,
        state: "UNKNOWN",
        failures: 0,
        recreated: false,
      };

      try {
        const { data: workspace } = await supabaseAdmin
          .from("workspaces")
          .select("company_id")
          .eq("id", workspaceId)
          .maybeSingle();
        if (!workspace?.company_id) {
          result.error = "no_company";
          results.push(result);
          continue;
        }

        let apiKey = apiKeyCache.get(workspace.company_id);
        if (!apiKey) {
          const { data: company } = await supabaseAdmin
            .from("companies")
            .select("id, daily_api_key")
            .eq("id", workspace.company_id)
            .maybeSingle();
          if (!company?.daily_api_key) {
            result.error = "no_daily_api_key";
            results.push(result);
            continue;
          }
          apiKey = await decryptToken(company.daily_api_key, company.id);
          apiKeyCache.set(workspace.company_id, apiKey);
        }

        const webhookUrl = `${supabaseUrl}/functions/v1/daily-webhook`;
        const existing = await dailyFetch(apiKey, "/webhooks");
        const webhooks = Array.isArray(existing) ? existing : (existing?.data || []);
        const desired = [...DESIRED_EVENTS].sort().join(",");

        const mine = webhooks.find((w: { url?: string; eventTypes?: string[]; state?: string }) => {
          if (w.url !== webhookUrl) return false;
          const evs = (w.eventTypes || []).slice().sort().join(",");
          return evs === desired;
        });

        const state = (mine?.state || (mine ? "UNKNOWN" : "MISSING")).toUpperCase();
        result.state = state;

        const isUnhealthy = !mine || state === "FAILED";

        // Lê contador atual.
        const { data: current } = await supabaseAdmin
          .from("daily_webhook_health")
          .select("consecutive_failures")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        const currentFailures = current?.consecutive_failures ?? 0;

        if (!isUnhealthy) {
          // Saudável — reset.
          await supabaseAdmin
            .from("daily_webhook_health")
            .upsert({
              workspace_id: workspaceId,
              consecutive_failures: 0,
              last_state: state,
              last_success_at: new Date().toISOString(),
            }, { onConflict: "workspace_id" });
          result.failures = 0;
        } else {
          const newFailures = currentFailures + 1;
          result.failures = newFailures;

          if (newFailures >= FAILURE_THRESHOLD) {
            console.log(
              "[daily-webhook-monitor] Recreating webhook for workspace=",
              workspaceId,
              "after",
              newFailures,
              "failures (state=",
              state,
              ")",
            );
            await recreateWebhook(apiKey, supabaseUrl);
            await supabaseAdmin
              .from("daily_webhook_health")
              .upsert({
                workspace_id: workspaceId,
                consecutive_failures: 0,
                last_state: "RECREATED",
                last_recreated_at: new Date().toISOString(),
                last_failure_at: new Date().toISOString(),
              }, { onConflict: "workspace_id" });
            result.recreated = true;
          } else {
            await supabaseAdmin
              .from("daily_webhook_health")
              .upsert({
                workspace_id: workspaceId,
                consecutive_failures: newFailures,
                last_state: state,
                last_failure_at: new Date().toISOString(),
              }, { onConflict: "workspace_id" });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[daily-webhook-monitor] workspace", workspaceId, "error:", msg);
        result.error = msg;
      }

      results.push(result);
    }

    return new Response(
      JSON.stringify({ ok: true, checked: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[daily-webhook-monitor] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
