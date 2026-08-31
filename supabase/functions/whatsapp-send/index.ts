import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeBrazilianPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return digits;
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (/^[1-9]\d$/.test(ddd) && /^[6-9]/.test(rest)) {
      return `55${ddd}9${rest}`;
    }
  }
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    return `55${digits}`;
  }
  return digits;
}


function buildMetaErrorPayload(whatsappResult: Record<string, unknown>, responseStatus: number) {
  const metaError = whatsappResult?.error as
    | { message?: string; code?: number; error_data?: { details?: string } }
    | undefined;
  const metaCode = metaError?.code;
  const message = metaError?.message || 'Failed to send WhatsApp message';

  if (metaCode === 131030) {
    return {
      status: 200,
      body: {
        success: false,
        error: 'RECIPIENT_NOT_ALLOWED',
        code: 'RECIPIENT_NOT_ALLOWED',
        meta_code: metaCode,
        message,
        user_message:
          'O número do lead não está na lista de permissão da conta de teste do WhatsApp Business. Adicione esse número como destinatário permitido na Meta ou coloque o app em produção para enviar mensagens a qualquer número.',
        fallback: true,
        details: whatsappResult,
      },
    };
  }

  return {
    status: responseStatus >= 500 ? 502 : responseStatus,
    body: {
      success: false,
      error: message,
      meta_code: metaCode,
      user_message: metaError?.error_data?.details || message,
      fallback: responseStatus >= 500,
      details: whatsappResult,
    },
  };
}

function extractMetaErrorMessage(whatsappResult: Record<string, unknown>): string {
  const metaError = whatsappResult?.error as
    | { message?: string; code?: number; error_data?: { details?: string }; title?: string }
    | undefined;

  if (!metaError) return 'Falha ao enviar mensagem pelo WhatsApp Business.';

  const details = metaError.error_data?.details;
  const codeSuffix = metaError.code ? ` (codigo ${metaError.code})` : '';
  return details || metaError.message || metaError.title || `Falha no envio${codeSuffix}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      type = 'text',
      conversation_id,
      connection_id,
      phone_number,
      message,
      workspace_id,
      lead_id,
      // template-only
      template_name,
      language_code = 'pt_BR',
      variables = [] as string[],
      rendered_text,
    } = body ?? {};

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Resolve connection + recipient
    let connectionData: { id: string; phone_number_id: string; access_token: string; workspace_id: string } | null = null;
    let recipientPhone: string | undefined = phone_number;
    let conversationId: string | undefined = conversation_id;

    if (connection_id) {
      const { data } = await supabase
        .from('whatsapp_connections')
        .select('id, phone_number_id, access_token, workspace_id')
        .eq('id', connection_id)
        .eq('is_active', true)
        .single();
      connectionData = data;
    } else if (conversation_id) {
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('id, phone_number, connection_id')
        .eq('id', conversation_id)
        .single();
      if (conv) {
        recipientPhone = conv.phone_number;
        const { data: connData } = await supabase
          .from('whatsapp_connections')
          .select('id, phone_number_id, access_token, workspace_id')
          .eq('id', conv.connection_id)
          .eq('is_active', true)
          .single();
        connectionData = connData;
      }
    }

    if (!connectionData) {
      return new Response(
        JSON.stringify({ error: 'WhatsApp connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If lead_id supplied, derive phone from lead when missing and lookup active conversation
    if (lead_id) {
      if (!recipientPhone) {
        const { data: leadRow } = await supabase
          .from('leads')
          .select('phone')
          .eq('id', lead_id)
          .maybeSingle();
        recipientPhone = leadRow?.phone ?? recipientPhone;
      }
      if (!conversationId) {
        const { data: existing } = await supabase
          .from('whatsapp_conversations')
          .select('id')
          .eq('lead_id', lead_id)
          .eq('is_active', true)
          .maybeSingle();
        conversationId = existing?.id ?? conversationId;
      }
    }

    if (!recipientPhone) {
      return new Response(
        JSON.stringify({ error: 'Recipient phone not resolved' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize BR phone (Meta uses 12-digit wa_id sem o 9; nossos leads têm 13)
    recipientPhone = normalizeBrazilianPhone(recipientPhone);

    const ensureConversation = async () => {
      if (conversationId) return conversationId;
      const resolvedWorkspaceId = workspace_id || connectionData?.workspace_id;
      if (!resolvedWorkspaceId || !connectionData) return conversationId;

      const { data: existingConv, error: existingConvError } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('connection_id', connectionData.id)
        .eq('phone_number', recipientPhone)
        .eq('is_active', true)
        .maybeSingle();

      if (existingConvError) {
        console.error('[whatsapp-send] Error finding existing conversation:', existingConvError);
      }

      if (existingConv?.id) {
        conversationId = existingConv.id;
        return conversationId;
      }

      const { data: newConv, error: convError } = await supabase
        .from('whatsapp_conversations')
        .insert({
          workspace_id: resolvedWorkspaceId,
          connection_id: connectionData.id,
          phone_number: recipientPhone,
          lead_id: lead_id ?? null,
          is_active: true,
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (convError) {
        console.error('[whatsapp-send] Error creating conversation:', convError);
        return conversationId;
      }

      conversationId = newConv?.id ?? conversationId;
      return conversationId;
    };

    const persistAttempt = async ({
      status,
      externalMessageId,
      deliveryError,
    }: {
      status: 'sent' | 'failed';
      externalMessageId?: string | null;
      deliveryError?: string | null;
    }) => {
      const persistedContent =
        type === 'template' ? (rendered_text || `[Modelo] ${template_name}`) : message;
      const resolvedConversationId = await ensureConversation();

      if (resolvedConversationId) {
        const { error: waInsertError } = await supabase
          .from('whatsapp_messages')
          .insert({
            conversation_id: resolvedConversationId,
            whatsapp_message_id: externalMessageId ?? null,
            content: persistedContent,
            sender_type: 'agent',
            status,
          });

        if (waInsertError) {
          console.error('[whatsapp-send] Error saving whatsapp_messages attempt:', waInsertError);
        }

        const { error: convUpdateError } = await supabase
          .from('whatsapp_conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', resolvedConversationId);

        if (convUpdateError) {
          console.error('[whatsapp-send] Error updating conversation timestamp:', convUpdateError);
        }
      }

      if (lead_id) {
        const { error: mainInsertError } = await supabase.from('messages').insert({
          lead_id,
          workspace_id: workspace_id || connectionData.workspace_id,
          content: persistedContent,
          sender_type: 'human_agent',
          external_message_id: externalMessageId ?? null,
          delivery_status: status,
          delivery_error: deliveryError ?? null,
        });

        if (mainInsertError) {
          console.error('[whatsapp-send] Error saving main messages attempt:', mainInsertError);
        }
      }
    };


    // 24h window enforcement for free-form text
    if (type === 'text') {
      if (!message) {
        return new Response(
          JSON.stringify({ error: 'message is required for text sends' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (lead_id) {
        const { data: lastIn } = await supabase
          .from('messages')
          .select('created_at')
          .eq('lead_id', lead_id)
          .eq('sender_type', 'lead')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const ageMs = lastIn?.created_at
          ? Date.now() - new Date(lastIn.created_at).getTime()
          : Number.POSITIVE_INFINITY;
        if (ageMs > WINDOW_MS) {
          return new Response(
            JSON.stringify({
              error:
                'Janela de 24h fechada. Envie um modelo aprovado (HSM) para reabrir a conversa.',
              code: 'WINDOW_CLOSED',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (type === 'template' && !template_name) {
      return new Response(
        JSON.stringify({ error: 'template_name is required for template sends' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build payload for Meta Cloud API
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: recipientPhone,
      type: type === 'template' ? 'template' : 'text',
    };
    if (type === 'template') {
      const templatePayload: Record<string, unknown> = {
        name: template_name,
        language: { code: language_code },
      };
      if (Array.isArray(variables) && variables.length > 0) {
        templatePayload.components = [
          {
            type: 'body',
            parameters: variables.map((v: string) => ({ type: 'text', text: String(v ?? '') })),
          },
        ];
      }
      payload.template = templatePayload;
    } else {
      payload.text = { body: message };
    }

    const whatsappResponse = await fetch(
      `https://graph.facebook.com/v18.0/${connectionData.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connectionData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const whatsappResult = await whatsappResponse.json();
    console.log('WhatsApp API response:', whatsappResult);

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API error:', whatsappResult);
      const deliveryError = extractMetaErrorMessage(whatsappResult);
      await persistAttempt({ status: 'failed', deliveryError });
      const handledError = buildMetaErrorPayload(whatsappResult, whatsappResponse.status);
      return new Response(
        JSON.stringify(handledError.body),
        { status: handledError.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sentMessageId = whatsappResult.messages?.[0]?.id;

    await persistAttempt({ status: 'sent', externalMessageId: sentMessageId ?? null });

    return new Response(
      JSON.stringify({
        success: true,
        message_id: sentMessageId,
        conversation_id: conversationId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Send message error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
