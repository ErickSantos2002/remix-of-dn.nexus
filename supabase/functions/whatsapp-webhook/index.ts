import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize text for keyword matching (lowercase, remove accents)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Normalize Brazilian phone numbers to 13-digit format (55 + DDD + 9 + 8 digits)
// Meta returns wa_id without the mobile "9" (12 digits), while contacts/leads store 13 digits.
function normalizeBrazilianPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return digits;
  // 55 + DDD (2) + 8 dígitos = 12 → inserir 9 se for celular
  if (digits.startsWith("55") && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (/^[1-9]\d$/.test(ddd) && /^[6-9]/.test(rest)) {
      return `55${ddd}9${rest}`;
    }
  }
  // Sem DDI: prefixar 55
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    return `55${digits}`;
  }
  return digits;
}

function extractStatusError(status: { errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> }): string | null {
  const firstError = status.errors?.[0];
  if (!firstError) return null;

  const details = firstError.error_data?.details || firstError.message || firstError.title || 'Falha no envio pelo WhatsApp Business.';
  return firstError.code ? `${details} (codigo ${firstError.code})` : details;
}


// Find the best workspace based on message content and keywords
interface LinkedWorkspace {
  workspace_id: string;
  keywords: string[];
  priority: number;
  is_default: boolean;
}

function findBestWorkspace(
  messageContent: string,
  linkedWorkspaces: LinkedWorkspace[],
  fallbackWorkspaceId: string
): string {
  if (!linkedWorkspaces || linkedWorkspaces.length === 0) {
    console.log("[ROUTING] No linked workspaces, using fallback:", fallbackWorkspaceId);
    return fallbackWorkspaceId;
  }

  const normalizedMessage = normalizeText(messageContent);
  console.log("[ROUTING] Analyzing message for routing:", normalizedMessage.substring(0, 100));

  // Sort by priority (higher first)
  const sorted = [...linkedWorkspaces].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Try to match keywords
  for (const ws of sorted) {
    if (ws.keywords && ws.keywords.length > 0) {
      for (const keyword of ws.keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (normalizedMessage.includes(normalizedKeyword)) {
          console.log("[ROUTING] Matched keyword:", keyword, "-> workspace:", ws.workspace_id);
          return ws.workspace_id;
        }
      }
    }
  }

  // No keyword match - use default workspace
  const defaultWs = sorted.find(ws => ws.is_default);
  if (defaultWs) {
    console.log("[ROUTING] No keyword match, using default workspace:", defaultWs.workspace_id);
    return defaultWs.workspace_id;
  }

  // Still no match - use first linked workspace
  if (sorted.length > 0) {
    console.log("[ROUTING] No default, using first linked workspace:", sorted[0].workspace_id);
    return sorted[0].workspace_id;
  }

  console.log("[ROUTING] Using fallback workspace:", fallbackWorkspaceId);
  return fallbackWorkspaceId;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  
  try {
    // Webhook verification (GET request from Meta)
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      console.log('Webhook verification request:', { mode, token, challenge });

      if (mode === 'subscribe' && token) {
        // Verify token against database
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: connection } = await supabase
          .from('whatsapp_connections')
          .select('id')
          .eq('webhook_verify_token', token)
          .eq('is_active', true)
          .maybeSingle();

        if (connection) {
          console.log('Webhook verified successfully');
          return new Response(challenge, { status: 200 });
        }
      }

      console.log('Webhook verification failed');
      return new Response('Forbidden', { status: 403 });
    }

    // Handle incoming messages (POST request)
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('Incoming webhook payload:', JSON.stringify(body, null, 2));

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Process WhatsApp messages
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            // ---- Template status / category updates from Meta
            if (change.field === 'message_template_status_update' || change.field === 'template_category_update') {
              const v = change.value || {};
              const metaId = v.message_template_id ? String(v.message_template_id) : null;
              const tplName = v.message_template_name || null;
              const tplLang = v.message_template_language || null;
              const isStatus = change.field === 'message_template_status_update';
              const patch: Record<string, unknown> = { synced_at: new Date().toISOString() };
              if (isStatus) {
                patch.status = String(v.event || 'PENDING').toUpperCase();
                patch.rejection_reason = v.reason || null;
              } else {
                if (v.new_category) patch.category = String(v.new_category).toUpperCase();
              }

              let updated = false;
              if (metaId) {
                const { error, count } = await supabase
                  .from('whatsapp_message_templates')
                  .update(patch, { count: 'exact' })
                  .eq('meta_template_id', metaId);
                if (!error && (count || 0) > 0) updated = true;
              }
              if (!updated && tplName && tplLang) {
                const { error } = await supabase
                  .from('whatsapp_message_templates')
                  .update(patch)
                  .eq('name', tplName)
                  .eq('language', tplLang);
                if (error) console.error('[template_status] fallback update error', error);
              }
              console.log('[template_status]', change.field, { metaId, tplName, tplLang, patch });
              continue;
            }

            if (change.field === 'messages') {
              const value = change.value;
              const phoneNumberId = value.metadata?.phone_number_id;
              
              // Find connection for this phone number
              const { data: connection } = await supabase
                .from('whatsapp_connections')
                .select('id, workspace_id, access_token')
                .eq('phone_number_id', phoneNumberId)
                .eq('is_active', true)
                .maybeSingle();

              if (!connection) {
                console.log('No connection found for phone_number_id:', phoneNumberId);
                continue;
              }

              // Process each message
              for (const message of value.messages || []) {
                const senderPhone = normalizeBrazilianPhone(message.from);
                const messageId = message.id;
                
                // Get message content based on type
                let content = '';
                const mediaUrl: string | null = null;
                let mediaType: string | null = null;

                if (message.type === 'text') {
                  content = message.text?.body || '';
                } else if (message.type === 'image') {
                  content = message.image?.caption || '[Imagem]';
                  mediaType = 'image';
                } else if (message.type === 'audio') {
                  content = '[Audio]';
                  mediaType = 'audio';
                } else if (message.type === 'video') {
                  content = message.video?.caption || '[Video]';
                  mediaType = 'video';
                } else if (message.type === 'document') {
                  content = message.document?.filename || '[Documento]';
                  mediaType = 'document';
                } else if (message.type === 'sticker') {
                  content = '[Figurinha]';
                  mediaType = 'sticker';
                } else {
                  content = `[${message.type}]`;
                }

                // Get contact name
                const contact = value.contacts?.find((c: { wa_id: string }) => c.wa_id === message.from);
                const contactName = contact?.profile?.name || senderPhone;


                // Find or create conversation
                let conversation: { id: string; lead_id: string | null; workspace_id: string } | null = null;
                
                const { data: existingConv } = await supabase
                  .from('whatsapp_conversations')
                  .select('id, lead_id, workspace_id')
                  .eq('connection_id', connection.id)
                  .eq('phone_number', senderPhone)
                  .maybeSingle();

                let targetWorkspaceId: string = connection.workspace_id;

                if (existingConv) {
                  conversation = existingConv;
                  targetWorkspaceId = existingConv.workspace_id;
                } else {
                  // NEW CONVERSATION - Apply intelligent routing
                  console.log("[WHATSAPP-WEBHOOK] New conversation, applying intelligent routing...");

                  // Fetch linked workspaces for this connection
                  const { data: linkedWorkspaces, error: lwError } = await supabase
                    .from("connection_workspaces")
                    .select("workspace_id, keywords, priority, is_default")
                    .eq("connection_id", connection.id)
                    .eq("connection_type", "whatsapp_official")
                    .eq("is_active", true);

                  if (lwError) {
                    console.error("[WHATSAPP-WEBHOOK] Error fetching linked workspaces:", lwError);
                  }

                  // Determine target workspace based on message content
                  targetWorkspaceId = findBestWorkspace(
                    content,
                    linkedWorkspaces || [],
                    connection.workspace_id
                  );

                  console.log("[WHATSAPP-WEBHOOK] Routed to workspace:", targetWorkspaceId);

                  // Check if a crm_contact already exists with this phone
                  const { data: existingContact } = await supabase
                    .from('crm_contacts')
                    .select('id')
                    .eq('phone', senderPhone)
                    .eq('workspace_id', targetWorkspaceId)
                    .maybeSingle();

                  // Check if a CRM lead already exists for this contact
                  let existingCrmLeadId: string | null = null;
                  if (existingContact?.id) {
                    const { data: existingCrmLead } = await supabase
                      .from('crm_leads')
                      .select('id')
                      .eq('workspace_id', targetWorkspaceId)
                      .eq('contact_id', existingContact.id)
                      .maybeSingle();
                    
                    if (existingCrmLead) {
                      existingCrmLeadId = existingCrmLead.id;
                      console.log('[WHATSAPP-WEBHOOK] CRM lead already exists for contact:', existingCrmLeadId);
                    }
                  }

                  // Create new conversation
                  const { data: newConversation, error: convError } = await supabase
                    .from('whatsapp_conversations')
                    .insert({
                      workspace_id: targetWorkspaceId,
                      connection_id: connection.id,
                      phone_number: senderPhone,
                      contact_name: contactName,
                      last_message_at: new Date().toISOString(),
                    })
                    .select('id, lead_id, workspace_id')
                    .single();

                  if (convError) {
                    console.error('Error creating conversation:', convError);
                    continue;
                  }
                  
                  conversation = newConversation;

                  // Create a lead for this conversation (linking existing contact if found)
                  const { data: newLead } = await supabase
                    .from('leads')
                    .insert({
                      workspace_id: targetWorkspaceId,
                      name: contactName,
                      phone: senderPhone,
                      status: 'new',
                      contact_id: existingContact?.id || null,
                    })
                    .select('id')
                    .single();

                  if (newLead && conversation) {
                    await supabase
                      .from('whatsapp_conversations')
                      .update({ lead_id: newLead.id })
                      .eq('id', conversation.id);
                    
                    conversation.lead_id = newLead.id;
                  }
                }

                if (!conversation) {
                  console.error('Failed to get or create conversation');
                  continue;
                }

                // Save message
                const { error: msgError } = await supabase
                  .from('whatsapp_messages')
                  .insert({
                    conversation_id: conversation.id,
                    whatsapp_message_id: messageId,
                    content: content,
                    sender_type: 'user',
                    media_url: mediaUrl,
                    media_type: mediaType,
                  });

                if (msgError) {
                  console.error('Error saving message:', msgError);
                  continue;
                }

                // Update conversation last_message_at
                await supabase
                  .from('whatsapp_conversations')
                  .update({ last_message_at: new Date().toISOString(), contact_name: contactName })
                  .eq('id', conversation.id);

                // Save to main messages table for unified inbox
                if (conversation.lead_id) {
                  const { error: mainMsgError } = await supabase
                    .from('messages')
                    .insert({
                      workspace_id: targetWorkspaceId,
                      lead_id: conversation.lead_id,
                      content: content,
                      sender_type: 'lead',
                      media_url: mediaUrl,
                      media_type: mediaType,
                    });

                  if (mainMsgError) {
                    console.error('[WHATSAPP-WEBHOOK] Error saving to main messages:', mainMsgError);
                  } else {
                    console.log('[WHATSAPP-WEBHOOK] Saved to main messages table - orchestrator will be triggered by database');
                  }
                }

                console.log('Message processed successfully:', messageId, 'routed to workspace:', targetWorkspaceId);
              }

              // Process status updates
              for (const status of value.statuses || []) {
                const statusMessageId = status.id;
                const statusValue = status.status;
                const statusError = extractStatusError(status);
                const timestampMs = status.timestamp ? Number(status.timestamp) * 1000 : Date.now();
                const timestampIso = new Date(timestampMs).toISOString();

                const { error: whatsappStatusError } = await supabase
                  .from('whatsapp_messages')
                  .update({ status: statusValue })
                  .eq('whatsapp_message_id', statusMessageId);

                if (whatsappStatusError) {
                  console.error('[WHATSAPP-WEBHOOK] Error updating whatsapp_messages status:', whatsappStatusError);
                }

                const messagePatch: Record<string, unknown> = {
                  delivery_status: statusValue,
                };

                if (statusValue === 'failed') {
                  messagePatch.delivery_error = statusError || 'Falha no envio pelo WhatsApp Business.';
                }

                if (statusValue === 'delivered') {
                  messagePatch.delivered_at = timestampIso;
                  messagePatch.delivery_error = null;
                }

                if (statusValue === 'read') {
                  messagePatch.read_at = timestampIso;
                  messagePatch.delivered_at = timestampIso;
                  messagePatch.delivery_error = null;
                }

                const { error: mainStatusError } = await supabase
                  .from('messages')
                  .update(messagePatch)
                  .eq('external_message_id', statusMessageId);

                if (mainStatusError) {
                  console.error('[WHATSAPP-WEBHOOK] Error updating main messages status:', mainStatusError);
                }

                console.log('Status updated:', statusMessageId, statusValue, statusError ? { error: statusError } : {});
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
