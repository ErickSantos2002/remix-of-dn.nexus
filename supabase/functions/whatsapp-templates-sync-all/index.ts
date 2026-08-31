// Reconciliation job: syncs WhatsApp HSM templates from Meta for every active connection.
// Triggered by pg_cron every 30 minutes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_VERSION = 'v21.0';
const PER_CONN_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchWithTimeout(url: string, token: string, ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const jsonBody = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(jsonBody?.error?.message || `Meta ${resp.status}`);
    return jsonBody;
  } finally {
    clearTimeout(t);
  }
}

async function syncOne(supabase: any, conn: any) {
  const url = `https://graph.facebook.com/${META_VERSION}/${conn.business_account_id}/message_templates?limit=200&fields=id,name,language,category,status,components,rejected_reason`;
  const remote = await fetchWithTimeout(url, conn.access_token, PER_CONN_TIMEOUT_MS);
  const items = remote?.data || [];
  const now = new Date().toISOString();
  let upserted = 0;
  for (const t of items) {
    const { data: existing } = await supabase
      .from('whatsapp_message_templates')
      .select('variable_map, variable_examples')
      .eq('connection_id', conn.id)
      .eq('name', t.name)
      .eq('language', t.language)
      .maybeSingle();
    const payload: any = {
      workspace_id: conn.workspace_id,
      connection_id: conn.id,
      meta_template_id: t.id || null,
      name: t.name,
      category: t.category || 'UTILITY',
      language: t.language,
      status: t.status || 'PENDING',
      components: t.components || [],
      rejection_reason: t.rejected_reason || null,
      synced_at: now,
    };
    if (existing?.variable_map) payload.variable_map = existing.variable_map;
    if (existing?.variable_examples) payload.variable_examples = existing.variable_examples;
    const { error } = await supabase
      .from('whatsapp_message_templates')
      .upsert(payload, { onConflict: 'connection_id,name,language' });
    if (!error) upserted++;
  }
  return { synced: upserted, total_remote: items.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: conns, error } = await supabase
    .from('whatsapp_connections')
    .select('id, workspace_id, business_account_id, access_token, provider, is_active')
    .eq('is_active', true)
    .eq('provider', 'official')
    .not('business_account_id', 'is', null)
    .not('access_token', 'is', null);

  if (error) return json({ error: error.message }, 500);

  const results = await Promise.allSettled(
    (conns || []).map(async (c) => ({ connection_id: c.id, ...(await syncOne(supabase, c)) })),
  );

  const summary = {
    connections_processed: results.length,
    templates_synced: 0,
    ok: [] as any[],
    errors: [] as any[],
  };
  results.forEach((r, i) => {
    const cid = (conns || [])[i]?.id;
    if (r.status === 'fulfilled') {
      summary.templates_synced += r.value.synced || 0;
      summary.ok.push(r.value);
    } else {
      summary.errors.push({ connection_id: cid, error: String(r.reason?.message || r.reason) });
    }
  });

  console.log('[wa-templates-sync-all]', JSON.stringify(summary));
  return json(summary);
});
