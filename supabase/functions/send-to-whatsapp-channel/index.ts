import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limit constants
const MAX_MESSAGES_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MIN_INTERVAL_PER_LEAD_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function applyRateLimit(
  supabase: any,
  connectionId: string,
  connectionType: string,
  leadPhone: string
): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();

  // Check connection-level rate limit (20/min)
  const { count: connCount } = await supabase
    .from('whatsapp_send_log')
    .select('*', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .gte('sent_at', windowStart);

  if ((connCount ?? 0) >= MAX_MESSAGES_PER_MINUTE) {
    // Find oldest message in window to calculate wait time
    const { data: oldest } = await supabase
      .from('whatsapp_send_log')
      .select('sent_at')
      .eq('connection_id', connectionId)
      .gte('sent_at', windowStart)
      .order('sent_at', { ascending: true })
      .limit(1)
      .single();

    if (oldest) {
      const waitMs = new Date(oldest.sent_at).getTime() + RATE_LIMIT_WINDOW_MS - now.getTime();
      if (waitMs > 0) {
        console.log(`[RATE-LIMIT] Connection ${connectionId}: limit reached, waiting ${waitMs}ms`);
        await sleep(Math.min(waitMs + 100, 10_000)); // Cap at 10s safety
      }
    }
  }

  // Check per-lead rate limit (1/second)
  const leadWindowStart = new Date(now.getTime() - MIN_INTERVAL_PER_LEAD_MS).toISOString();
  const { data: recentLeadMsg } = await supabase
    .from('whatsapp_send_log')
    .select('sent_at')
    .eq('lead_phone', leadPhone)
    .gte('sent_at', leadWindowStart)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentLeadMsg) {
    const diff = now.getTime() - new Date(recentLeadMsg.sent_at).getTime();
    if (diff < MIN_INTERVAL_PER_LEAD_MS) {
      const waitMs = MIN_INTERVAL_PER_LEAD_MS - diff;
      console.log(`[RATE-LIMIT] Lead ${leadPhone}: throttling ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  // Log this send
  await supabase.from('whatsapp_send_log').insert({
    connection_id: connectionId,
    connection_type: connectionType,
    lead_phone: leadPhone,
    sent_at: new Date().toISOString(),
  });
}

// ─── Opt-Out Check ──────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function isContactOptedOut(
  supabase: any,
  leadPhone: string,
  workspaceId: string
): Promise<boolean> {
  const { data: contact } = await supabase
    .from('crm_contacts')
    .select('opted_out')
    .eq('phone', leadPhone)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  return contact?.opted_out === true;
}

// ─── Circuit Breaker Check ──────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function checkCircuitBreaker(
  supabase: any,
  connectionId: string,
  connectionTable: string
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const { data: conn } = await supabase
    .from(connectionTable)
    .select('circuit_state, circuit_opened_at, circuit_failure_count')
    .eq('id', connectionId)
    .single();

  if (!conn) return { allowed: true };

  if (conn.circuit_state === 'open') {
    const elapsed = Date.now() - new Date(conn.circuit_opened_at).getTime();
    if (elapsed < 60_000) {
      return { allowed: false, retryAfterMs: 60_000 - elapsed };
    }
    // Transition to half_open
    await supabase
      .from(connectionTable)
      .update({ circuit_state: 'half_open' })
      .eq('id', connectionId);
    console.log(`[CIRCUIT-BREAKER] Connection ${connectionId}: transitioning to half_open`);
  }

  return { allowed: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { lead_id, message_content, message_id, workspace_id } = await req.json();

    console.log('[send-to-whatsapp-channel] Received request:', {
      lead_id,
      message_id,
      workspace_id,
      content_length: message_content?.length
    });

    // Skip internal system messages (channel switch notifications, etc.)
    if (message_content?.startsWith('__SYSTEM__:')) {
      console.log('[send-to-whatsapp-channel] Skipping system message:', message_id);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'system_message' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lead_id || !message_content) {
      console.error('[send-to-whatsapp-channel] Missing required fields');
      return new Response(
        JSON.stringify({ error: 'Missing lead_id or message_content' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ─── Get lead phone for opt-out check ───────────────────────────────
    const { data: leadInfo } = await supabase
      .from('leads')
      .select('phone, workspace_id, source')
      .eq('id', lead_id)
      .single();

    // Skip widget leads — conversation stays in widget only
    if (leadInfo?.source?.startsWith('Widget:')) {
      console.log('[send-to-whatsapp-channel] Skipping widget lead:', lead_id);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'widget_only' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveWorkspaceId = workspace_id || leadInfo?.workspace_id;
    const leadPhone = leadInfo?.phone?.replace(/\D/g, '') || '';

    // ─── Opt-Out Check (Feature 3) ─────────────────────────────────────
    if (leadPhone && effectiveWorkspaceId) {
      const optedOut = await isContactOptedOut(supabase, leadPhone, effectiveWorkspaceId);
      if (optedOut) {
        console.log('[send-to-whatsapp-channel] BLOCKED: contact opted out', { lead_id, phone: leadPhone });
        return new Response(
          JSON.stringify({ success: false, error: 'Contact opted out', blocked: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Fetch reply_to_external_id if message_id is provided
    let replyToExternalId: string | null = null;
    if (message_id) {
      const { data: msgData } = await supabase
        .from('messages')
        .select('reply_to_external_id')
        .eq('id', message_id)
        .single();

      replyToExternalId = msgData?.reply_to_external_id || null;
      if (replyToExternalId) {
        console.log('[send-to-whatsapp-channel] Message is a reply to:', replyToExternalId);
      }
    }

    // Check for Z-API conversation first
    const { data: zapiConv, error: zapiError } = await supabase
      .from('zapi_conversations')
      .select('id, phone_number, connection_id')
      .eq('lead_id', lead_id)
      .eq('is_active', true)
      .maybeSingle();

    if (zapiError) {
      console.error('[send-to-whatsapp-channel] Error fetching zapi_conversation:', zapiError);
    }

    if (zapiConv) {
      console.log('[send-to-whatsapp-channel] Found Z-API conversation:', zapiConv.id);

      // ─── Circuit Breaker Check (Feature 5) ───────────────────────────
      const circuitCheck = await checkCircuitBreaker(supabase, zapiConv.connection_id, 'zapi_connections');
      if (!circuitCheck.allowed) {
        console.log('[send-to-whatsapp-channel] BLOCKED: circuit breaker open', { connection_id: zapiConv.connection_id, retry_after_ms: circuitCheck.retryAfterMs });
        return new Response(
          JSON.stringify({ error: 'Circuit breaker open', retry_after_ms: circuitCheck.retryAfterMs, channel: 'zapi' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ─── Rate Limit (Feature 1) ──────────────────────────────────────
      await applyRateLimit(supabase, zapiConv.connection_id, 'zapi', zapiConv.phone_number || leadPhone);

      // Send via Z-API
      const zapiResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/zapi-send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            conversation_id: zapiConv.id,
            message: message_content,
            reply_to_message_id: replyToExternalId,
          }),
        }
      );

      const zapiResult = await zapiResponse.json();
      console.log('[send-to-whatsapp-channel] Z-API send result:', zapiResult);

      if (!zapiResponse.ok) {
        console.error('[send-to-whatsapp-channel] Z-API send failed:', zapiResult);
        return new Response(
          JSON.stringify({
            error: 'Failed to send via Z-API',
            details: zapiResult,
            channel: 'zapi'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update message with external ID and sent status for delivery tracking
      const externalMessageId = zapiResult.zapiMessageId || zapiResult.messageId;
      if (externalMessageId && message_id) {
        const { error: updateError } = await supabase
          .from('messages')
          .update({
            external_message_id: externalMessageId,
            delivery_status: 'sent',
          })
          .eq('id', message_id);

        if (updateError) {
          console.error('[send-to-whatsapp-channel] Error updating message status:', updateError);
        } else {
          console.log('[send-to-whatsapp-channel] Updated message with external ID:', externalMessageId);
        }
      }

      console.log(`[send-to-whatsapp-channel] Success via Z-API in ${Date.now() - startTime}ms`);
      return new Response(
        JSON.stringify({
          success: true,
          channel: 'zapi',
          conversation_id: zapiConv.id,
          message_id: zapiResult.message_id,
          processing_time_ms: Date.now() - startTime
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for WhatsApp official API conversation
    const { data: waConv, error: waError } = await supabase
      .from('whatsapp_conversations')
      .select('id, phone_number, connection_id')
      .eq('lead_id', lead_id)
      .eq('is_active', true)
      .maybeSingle();

    if (waError) {
      console.error('[send-to-whatsapp-channel] Error fetching whatsapp_conversation:', waError);
    }

    if (waConv) {
      console.log('[send-to-whatsapp-channel] Found WhatsApp Official conversation:', waConv.id);

      // ─── Circuit Breaker Check (Feature 5) ───────────────────────────
      const circuitCheck = await checkCircuitBreaker(supabase, waConv.connection_id, 'whatsapp_connections');
      if (!circuitCheck.allowed) {
        console.log('[send-to-whatsapp-channel] BLOCKED: circuit breaker open (WA Official)', { connection_id: waConv.connection_id });
        return new Response(
          JSON.stringify({ error: 'Circuit breaker open', retry_after_ms: circuitCheck.retryAfterMs, channel: 'whatsapp_official' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ─── Rate Limit (Feature 1) ──────────────────────────────────────
      await applyRateLimit(supabase, waConv.connection_id, 'whatsapp_official', waConv.phone_number || leadPhone);

      // Send via WhatsApp Official API
      const waResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({
            conversation_id: waConv.id,
            message: message_content,
          }),
        }
      );

      const waResult = await waResponse.json();
      console.log('[send-to-whatsapp-channel] WhatsApp Official send result:', waResult);

      if (!waResponse.ok || waResult?.success === false || waResult?.error) {
        const deliveryError =
          waResult?.user_message ||
          waResult?.message ||
          waResult?.error ||
          waResult?.details?.error?.message ||
          'Falha ao enviar via WhatsApp Official';
        console.error('[send-to-whatsapp-channel] WhatsApp Official send failed:', waResult);
        if (message_id) {
          const { error: updateError } = await supabase
            .from('messages')
            .update({
              delivery_status: 'failed',
              delivery_error: deliveryError,
            })
            .eq('id', message_id);

          if (updateError) {
            console.error('[send-to-whatsapp-channel] Error marking message as failed:', updateError);
          }
        }
        return new Response(
          JSON.stringify({
            success: false,
            error: waResult?.error || 'Failed to send via WhatsApp Official',
            code: waResult?.code,
            meta_code: waResult?.meta_code,
            user_message: deliveryError,
            details: waResult,
            channel: 'whatsapp_official'
          }),
          { status: waResponse.ok ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update message with external ID and sent status for delivery tracking
      const waExternalMessageId = waResult.messageId || waResult.message_id;
      if (waExternalMessageId && message_id) {
        const { error: updateError } = await supabase
          .from('messages')
          .update({
            external_message_id: waExternalMessageId,
            delivery_status: 'sent',
          })
          .eq('id', message_id);

        if (updateError) {
          console.error('[send-to-whatsapp-channel] Error updating message status:', updateError);
        } else {
          console.log('[send-to-whatsapp-channel] Updated message with external ID:', waExternalMessageId);
        }
      }

      console.log(`[send-to-whatsapp-channel] Success via WhatsApp Official in ${Date.now() - startTime}ms`);
      return new Response(
        JSON.stringify({
          success: true,
          channel: 'whatsapp_official',
          conversation_id: waConv.id,
          message_id: waResult.message_id,
          processing_time_ms: Date.now() - startTime
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback: no conversation found, try to auto-create zapi_conversations
    console.log('[send-to-whatsapp-channel] No conversation found, attempting fallback auto-create');

    // 1. Get lead phone number (re-use leadInfo if available)
    const { data: leadData } = leadInfo ? { data: leadInfo } : await supabase
      .from('leads')
      .select('phone, workspace_id')
      .eq('id', lead_id)
      .single();

    // Also get name for conversation creation
    const { data: leadNameData } = await supabase
      .from('leads')
      .select('name')
      .eq('id', lead_id)
      .single();

    const fallbackWorkspaceId = workspace_id || leadData?.workspace_id;
    // Normalize phone: strip non-digits, add 55 prefix, convert 8→9 digit mobile
    let fallbackPhone = leadData?.phone?.replace(/\D/g, '');
    if (fallbackPhone && fallbackPhone.length >= 10 && fallbackPhone.length <= 11) {
      fallbackPhone = '55' + fallbackPhone;
    }
    // Convert old 8-digit mobile to 9-digit: 55+DDD+[6-9]XXXXXXX → 55+DDD+9+[6-9]XXXXXXX
    if (fallbackPhone && fallbackPhone.length === 12 && fallbackPhone.startsWith('55') && /^[6-9]/.test(fallbackPhone.slice(4))) {
      fallbackPhone = fallbackPhone.slice(0, 4) + '9' + fallbackPhone.slice(4);
    }
    console.log('[send-to-whatsapp-channel] Fallback phone normalized:', { raw: leadData?.phone, normalized: fallbackPhone });

    if (!fallbackPhone || !fallbackWorkspaceId) {
      console.log('[send-to-whatsapp-channel] Fallback failed: no phone or workspace', {
        lead_id,
        has_phone: !!fallbackPhone,
        has_workspace: !!fallbackWorkspaceId,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No WhatsApp conversation linked to this lead and no phone available for fallback',
          lead_id
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Find active Z-API connection for workspace via connection_workspaces (source of truth)
    const { data: connLink } = await supabase
      .from('connection_workspaces')
      .select('connection_id')
      .eq('workspace_id', fallbackWorkspaceId)
      .eq('connection_type', 'zapi')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const zapiConnection = connLink ? { id: connLink.connection_id } : null;
    console.log('[send-to-whatsapp-channel] Fallback connection lookup:', { workspace: fallbackWorkspaceId, connectionId: zapiConnection?.id || null });

    if (!zapiConnection) {
      console.log('[send-to-whatsapp-channel] Fallback failed: no active Z-API connection for workspace', fallbackWorkspaceId);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No active Z-API connection for this workspace',
          lead_id
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Circuit Breaker Check (Feature 5) ──────────────────────────────
    const circuitCheck = await checkCircuitBreaker(supabase, zapiConnection.id, 'zapi_connections');
    if (!circuitCheck.allowed) {
      console.log('[send-to-whatsapp-channel] BLOCKED: circuit breaker open (fallback)', { connection_id: zapiConnection.id });
      return new Response(
        JSON.stringify({ error: 'Circuit breaker open', retry_after_ms: circuitCheck.retryAfterMs, channel: 'zapi' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Rate Limit (Feature 1) ─────────────────────────────────────────
    await applyRateLimit(supabase, zapiConnection.id, 'zapi', fallbackPhone);

    // 3. Create zapi_conversations
    const { data: newZapiConv, error: createError } = await supabase
      .from('zapi_conversations')
      .insert({
        workspace_id: fallbackWorkspaceId,
        connection_id: zapiConnection.id,
        lead_id: lead_id,
        phone_number: fallbackPhone,
        contact_name: leadNameData?.name || null,
        last_message_at: new Date().toISOString(),
        is_active: true,
      })
      .select('id')
      .single();

    if (createError || !newZapiConv) {
      console.error('[send-to-whatsapp-channel] Fallback failed: error creating zapi_conversations:', createError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to auto-create Z-API conversation',
          details: createError?.message,
          lead_id
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[send-to-whatsapp-channel] Fallback: created zapi_conversations', newZapiConv.id, 'for phone', fallbackPhone);

    // 4. Send via Z-API using newly created conversation
    const fallbackResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/zapi-send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          conversation_id: newZapiConv.id,
          message: message_content,
          reply_to_message_id: replyToExternalId,
        }),
      }
    );

    const fallbackResult = await fallbackResponse.json();
    console.log('[send-to-whatsapp-channel] Fallback Z-API send result:', fallbackResult);

    if (!fallbackResponse.ok) {
      console.error('[send-to-whatsapp-channel] Fallback Z-API send failed:', fallbackResult);
      return new Response(
        JSON.stringify({
          error: 'Failed to send via Z-API (fallback)',
          details: fallbackResult,
          channel: 'zapi'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update message with external ID
    const fallbackExternalId = fallbackResult.zapiMessageId || fallbackResult.messageId;
    if (fallbackExternalId && message_id) {
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          external_message_id: fallbackExternalId,
          delivery_status: 'sent',
        })
        .eq('id', message_id);

      if (updateError) {
        console.error('[send-to-whatsapp-channel] Fallback: error updating message status:', updateError);
      } else {
        console.log('[send-to-whatsapp-channel] Fallback: updated message with external ID:', fallbackExternalId);
      }
    }

    console.log(`[send-to-whatsapp-channel] Success via Z-API (fallback) in ${Date.now() - startTime}ms`);
    return new Response(
      JSON.stringify({
        success: true,
        channel: 'zapi',
        fallback: true,
        conversation_id: newZapiConv.id,
        message_id: fallbackResult.message_id,
        processing_time_ms: Date.now() - startTime
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[send-to-whatsapp-channel] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
