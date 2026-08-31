import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { connection_id } = await req.json();
    if (!connection_id) {
      return new Response(JSON.stringify({ error: 'connection_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: conn, error } = await supabase
      .from('whatsapp_connections')
      .select('id, phone_number_id, access_token')
      .eq('id', connection_id)
      .maybeSingle();

    if (error || !conn) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `https://graph.facebook.com/v21.0/${conn.phone_number_id}?fields=display_phone_number,verified_name`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${conn.access_token}` },
    });
    const data = await resp.json();

    if (!resp.ok) {
      console.error('Meta API error:', data);
      return new Response(JSON.stringify({
        error: data?.error?.message || 'Falha ao consultar Meta API',
        details: data?.error,
      }), {
        status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const display_phone_number = data.display_phone_number || null;
    const verified_name = data.verified_name || null;

    await supabase
      .from('whatsapp_connections')
      .update({ display_phone_number, verified_name })
      .eq('id', connection_id);

    return new Response(JSON.stringify({
      success: true, display_phone_number, verified_name,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
