// WhatsApp Business API — Message Templates (HSM) management proxy
// Actions:
//   - list:   fetch templates cached in DB for a connection
//   - sync:   pull templates from Meta Graph API into local cache
//   - create: POST a new template to Meta
//   - delete: DELETE a template from Meta (by name)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const META_VERSION = 'v21.0';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function userError(message: string) {
  return jsonResponse({ error: message }, 200);
}

class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

async function loadConnection(supabase: any, connectionId: string) {
  const { data, error } = await supabase
    .from('whatsapp_connections')
    .select('id, workspace_id, phone_number_id, business_account_id, access_token, provider')
    .eq('id', connectionId)
    .maybeSingle();
  if (error || !data) throw new Error('Conexão WhatsApp não encontrada');
  if (data.provider !== 'official') {
    throw new Error('Templates HSM são exclusivos do WhatsApp Business API (Oficial).');
  }
  if (!data.business_account_id || !data.access_token) {
    throw new Error('Conexão sem WABA ID ou Access Token configurados.');
  }
  return data;
}

async function metaFetch(url: string, token: string, init: RequestInit = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = json?.error || {};
    if (err.error_subcode === 2388299) {
      throw new UserFacingError(
        'A Meta não permite variáveis no início ou no fim do modelo. Adicione texto antes e depois da variável, por exemplo: "Olá [nome], sua reunião...".',
      );
    }
    const parts = [
      err.message,
      err.error_user_title,
      err.error_user_msg,
      err.error_subcode ? `subcode ${err.error_subcode}` : null,
    ].filter(Boolean);
    const msg = parts.join(' — ') || `Meta API error (${resp.status})`;
    console.error('[metaFetch] Meta rejection:', JSON.stringify(json));
    throw new Error(msg);
  }
  return json;
}

function validateVariablePositions(components: any[]): string | null {
  const token = '(?:\\{\\{\\s*\\d+\\s*\\}\\}|\\[[a-zA-ZÀ-ÿ0-9_ ]+\\])';
  const edgeRe = new RegExp(`(^[\\s\\u200B\\uFEFF]*${token})|(${token}[\\s\\u200B\\uFEFF]*$)`);
  for (const c of components || []) {
    if ((c?.type === 'BODY' || c?.type === 'HEADER') && typeof c?.text === 'string' && edgeRe.test(c.text)) {
      const label = c.type === 'BODY' ? 'corpo' : 'cabeçalho';
      return `A Meta não permite variáveis no início ou no fim do ${label}. Adicione texto antes e depois da variável, por exemplo: "Olá [nome], ...".`;
    }
  }
  return null;
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const connectionId = body?.connection_id as string;

    if (!action || !connectionId) return jsonResponse({ error: 'action and connection_id required' }, 400);

    const conn = await loadConnection(supabase, connectionId);

    // ---- LIST (from local cache)
    if (action === 'list') {
      const { data, error } = await supabase
        .from('whatsapp_message_templates')
        .select('*')
        .eq('connection_id', connectionId)
        .order('name', { ascending: true });
      if (error) throw error;
      return jsonResponse({ templates: data || [] });
    }

    // ---- SYNC from Meta
    if (action === 'sync') {
      const url = `https://graph.facebook.com/${META_VERSION}/${conn.business_account_id}/message_templates?limit=200&fields=id,name,language,category,status,components,rejected_reason`;
      const remote = await metaFetch(url, conn.access_token);
      const items = remote?.data || [];
      const now = new Date().toISOString();
      let upserted = 0;
      for (const t of items) {
        // Preserve existing variable_map (Meta doesn't store friendly names)
        const { data: existing } = await supabase
          .from('whatsapp_message_templates')
          .select('variable_map')
          .eq('connection_id', connectionId)
          .eq('name', t.name)
          .eq('language', t.language)
          .maybeSingle();
        const payload: any = {
          workspace_id: conn.workspace_id,
          connection_id: connectionId,
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
        const { error: upErr } = await supabase
          .from('whatsapp_message_templates')
          .upsert(payload, { onConflict: 'connection_id,name,language' });
        if (upErr) {
          console.error('upsert error', upErr, payload);
        } else {
          upserted++;
        }
      }
      return jsonResponse({ success: true, synced: upserted, total_remote: items.length });
    }

    // ---- CREATE at Meta
    if (action === 'create') {
      const { name, language, category, components, variable_map, variable_examples } = body;
      if (!name || !language || !category || !components) {
        return userError('Nome, idioma, categoria e conteúdo do modelo são obrigatórios.');
      }
      const posErr = validateVariablePositions(components);
      if (posErr) return userError(posErr);

      const vex = variable_examples || {};
      const varLabel = (n: string) => {
        if (vex[n] && String(vex[n]).trim()) return String(vex[n]).trim();
        if (variable_map && variable_map[n]) return String(variable_map[n]);
        return `exemplo${n}`;
      };
      const enrichedComponents = (components as any[]).map((c) => {
        const text: string = c?.text || '';
        const nums = Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
        if (!nums.length) return c;
        if (c.type === 'BODY') return { ...c, example: { body_text: [nums.map(varLabel)] } };
        if (c.type === 'HEADER' && c.format === 'TEXT') return { ...c, example: { header_text: nums.map(varLabel) } };
        return c;
      });
      const url = `https://graph.facebook.com/${META_VERSION}/${conn.business_account_id}/message_templates`;
      const meta = await metaFetch(url, conn.access_token, {
        method: 'POST',
        body: JSON.stringify({ name, language, category, components: enrichedComponents }),
      });
      const payload: any = {
        workspace_id: conn.workspace_id,
        connection_id: connectionId,
        meta_template_id: meta?.id || null,
        name,
        category,
        language,
        status: meta?.status || 'PENDING',
        components,
        variable_map: variable_map || null,
        variable_examples: vex,
        synced_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase
        .from('whatsapp_message_templates')
        .upsert(payload, { onConflict: 'connection_id,name,language' });
      if (upErr) throw upErr;
      return jsonResponse({ success: true, template: meta });
    }

    // ---- SAVE DRAFT (local only, no Meta call). If `id` present, update existing draft.
    if (action === 'save_draft') {
      const { name, language, category, components, variable_map, variable_examples, id } = body;
      if (!name || !language || !category || !components) {
        return userError('Nome, idioma, categoria e conteúdo do modelo são obrigatórios.');
      }
      if (id) {
        const { data: existing, error: exErr } = await supabase
          .from('whatsapp_message_templates')
          .select('id, status')
          .eq('id', id)
          .maybeSingle();
        if (exErr || !existing) throw new Error('Rascunho não encontrado');
        if ((existing.status || '').toUpperCase() !== 'DRAFT') {
          return userError('Somente rascunhos podem ser editados.');
        }
        const { data, error: upErr } = await supabase
          .from('whatsapp_message_templates')
          .update({
            name, language, category, components,
            variable_map: variable_map || null,
            variable_examples: variable_examples || {},
            status: 'DRAFT',
            rejection_reason: null,
            synced_at: null,
          })
          .eq('id', id)
          .select()
          .maybeSingle();
        if (upErr) throw upErr;
        return jsonResponse({ success: true, template: data });
      }
      const payload: any = {
        workspace_id: conn.workspace_id,
        connection_id: connectionId,
        meta_template_id: null,
        name,
        category,
        language,
        status: 'DRAFT',
        components,
        variable_map: variable_map || null,
        variable_examples: variable_examples || {},
        rejection_reason: null,
        synced_at: null,
      };
      const { data, error: upErr } = await supabase
        .from('whatsapp_message_templates')
        .upsert(payload, { onConflict: 'connection_id,name,language' })
        .select()
        .maybeSingle();
      if (upErr) throw upErr;
      return jsonResponse({ success: true, template: data });
    }

    // ---- SUBMIT existing DRAFT to Meta for approval
    if (action === 'submit_draft') {
      const { template_id } = body;
      if (!template_id) return userError('Rascunho não informado.');
      const { data: tpl, error: tErr } = await supabase
        .from('whatsapp_message_templates')
        .select('*')
        .eq('id', template_id)
        .maybeSingle();
      if (tErr || !tpl) throw new Error('Rascunho não encontrado');
      const posErr = validateVariablePositions(tpl.components as any[]);
      if (posErr) return userError(posErr);

      const vmap = tpl.variable_map || {};
      const vex = tpl.variable_examples || {};
      const varLabel = (n: string) => {
        if (vex[n] && String(vex[n]).trim()) return String(vex[n]).trim();
        if (vmap[n]) return String(vmap[n]);
        return `exemplo${n}`;
      };
      const enrichedComponents = (tpl.components as any[]).map((c) => {
        const text: string = c?.text || '';
        const nums = Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
        if (!nums.length) return c;
        if (c.type === 'BODY') return { ...c, example: { body_text: [nums.map(varLabel)] } };
        if (c.type === 'HEADER' && c.format === 'TEXT') return { ...c, example: { header_text: nums.map(varLabel) } };
        return c;
      });
      const url = `https://graph.facebook.com/${META_VERSION}/${conn.business_account_id}/message_templates`;
      const meta = await metaFetch(url, conn.access_token, {
        method: 'POST',
        body: JSON.stringify({
          name: tpl.name,
          language: tpl.language,
          category: tpl.category,
          components: enrichedComponents,
        }),
      });
      const { error: upErr } = await supabase
        .from('whatsapp_message_templates')
        .update({
          meta_template_id: meta?.id || null,
          status: meta?.status || 'PENDING',
          rejection_reason: null,
          synced_at: new Date().toISOString(),
        })
        .eq('id', template_id);
      if (upErr) throw upErr;
      return jsonResponse({ success: true, template: meta });
    }

    // ---- DELETE at Meta (skip Meta call for local-only drafts)
    if (action === 'delete') {
      const { name, hsm_id } = body;
      if (!name) return jsonResponse({ error: 'name required' }, 400);
      // Check if this template exists remotely (has meta_template_id)
      const { data: local } = await supabase
        .from('whatsapp_message_templates')
        .select('meta_template_id, status')
        .eq('connection_id', connectionId)
        .eq('name', name)
        .maybeSingle();
      const isRemote = !!(hsm_id || local?.meta_template_id);
      if (isRemote) {
        const params = new URLSearchParams({ name });
        const finalHsm = hsm_id || local?.meta_template_id;
        if (finalHsm) params.set('hsm_id', finalHsm);
        const url = `https://graph.facebook.com/${META_VERSION}/${conn.business_account_id}/message_templates?${params.toString()}`;
        await metaFetch(url, conn.access_token, { method: 'DELETE' });
      }
      await supabase
        .from('whatsapp_message_templates')
        .delete()
        .eq('connection_id', connectionId)
        .eq('name', name);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error('[whatsapp-templates]', e);
    if (e instanceof UserFacingError) {
      return userError(e.message);
    }
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
