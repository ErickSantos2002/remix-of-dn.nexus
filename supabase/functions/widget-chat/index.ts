import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-widget-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Carrega origens cadastradas (ativas) da empresa para validar source vindo do widget.
async function loadValidSources(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<Set<string>> {
  const valid = new Set<string>();
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspaceId)
      .maybeSingle();
    const companyId = (ws as { company_id?: string } | null)?.company_id;
    if (!companyId) return valid;
    const { data: sources } = await supabase
      .from("crm_contact_sources")
      .select("name")
      .eq("company_id", companyId)
      .eq("is_active", true);
    for (const s of (sources as Array<{ name: string }> | null) ?? []) {
      if (s?.name) valid.add(s.name.trim().toLowerCase());
    }
  } catch (err) {
    console.error("[WIDGET-CHAT] loadValidSources error:", err);
  }
  return valid;
}

// Calcula a Origem do contato a partir dos params da página:
// 1) source explícito (validado contra origens cadastradas da empresa) → usa literal
// 2) qualquer utm_* presente → "Tráfego Pago"
// 3) caso contrário → "Orgânica"
function computeWidgetSource(
  info: Record<string, unknown> | null | undefined,
  validSources?: Set<string>,
): string {
  const src = (info?.source as string | undefined)?.trim();
  if (src && validSources && validSources.has(src.toLowerCase())) return src;
  const hasUtm = !!(info?.utm_source || info?.utm_medium || info?.utm_campaign || info?.utm_term || info?.utm_content);
  return hasUtm ? "Tráfego Pago" : "Orgânica";
}

// Origem "default" do widget que pode ser sobrescrita pela origem calculada
function isWidgetDefaultSource(current: string | null | undefined): boolean {
  if (!current) return true;
  const c = current.trim().toLowerCase();
  return c === "" || c === "chat" || c === "widget" || c === "agendamento" || c.startsWith("widget:");
}


interface WidgetConfig {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  agent_id: string | null;
  is_active: boolean;
  slug: string;
  settings: {
    title?: string;
    subtitle?: string;
    primary_color?: string;
    logo_url?: string;
    welcome_message?: string;
    position?: string;
    bubble_icon?: string;
    width?: number;
    height?: number;
    show_powered_by?: boolean;
    show_header?: boolean;
    header_banner_url?: string;
    agent_avatar_url?: string;
  };
  allowed_origins: string[];
}

interface WidgetSession {
  id: string;
  widget_config_id: string;
  lead_id: string | null;
  session_token: string;
  visitor_info: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Anon client for reading public data
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    // Service role client for creating leads/sessions
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const origin = req.headers.get("origin") || "";

    // =============================================
    // GET /widget-chat?slug=xxx - Fetch widget config
    // =============================================
    if (req.method === "GET" && url.searchParams.has("slug")) {
      const slug = url.searchParams.get("slug")!;

      const { data: config, error } = await supabaseAnon
        .from("widget_configs")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (error || !config) {
        return new Response(
          JSON.stringify({ error: "Widget not found or inactive" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate origin only for external embeddings
      // Skip validation for internal Lovable domains and direct access
      const widgetConfig = config as WidgetConfig;
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const isInternalOrigin = !origin || 
        origin.includes("lovableproject.com") || 
        origin.includes("lovable.app") ||
        origin.includes("localhost") ||
        origin.includes("supabase.co") ||
        (supabaseUrl && origin.includes(new URL(supabaseUrl).hostname));

      if (!isInternalOrigin && 
          widgetConfig.allowed_origins && 
          widgetConfig.allowed_origins.length > 0) {
        const isAllowed = widgetConfig.allowed_origins.some(
          (allowed) => origin.includes(allowed) || allowed === "*"
        );
        if (!isAllowed) {
          return new Response(
            JSON.stringify({ error: "Origin not allowed" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Fetch agent data + meta_pixel_id in PARALLEL
      const agentPromise = (async () => {
        if (!widgetConfig.agent_id) return null;
        // Try legacy agents table first
        const { data: legacyAgent } = await supabaseService
          .from("agents")
          .select("name, category, category_id, agent_categories(name)")
          .eq("id", widgetConfig.agent_id)
          .single();
        
        if (legacyAgent) {
          const categoryData = legacyAgent.agent_categories as unknown as { name: string } | null;
          return {
            name: legacyAgent.name,
            category: categoryData?.name || legacyAgent.category || null,
            avatar_url: (widgetConfig.settings as Record<string, unknown>)?.agent_avatar_url as string | undefined,
          };
        }
        // Fallback to agent_instances
        const { data: instanceAgent } = await supabaseService
          .from("agent_instances")
          .select("name, category, category_id, agent_categories(name)")
          .eq("id", widgetConfig.agent_id)
          .single();
        
        if (instanceAgent) {
          const categoryData = instanceAgent.agent_categories as unknown as { name: string } | null;
          return {
            name: instanceAgent.name,
            category: categoryData?.name || instanceAgent.category || null,
            avatar_url: (widgetConfig.settings as Record<string, unknown>)?.agent_avatar_url as string | undefined,
          };
        }
        return null;
      })();

      const companyTrackingPromise = (async () => {
        const { data: ws } = await supabaseService
          .from("workspaces")
          .select("company_id")
          .eq("id", widgetConfig.workspace_id)
          .single();
        if (ws?.company_id) {
          const { data: company } = await supabaseService
            .from("companies")
            .select("meta_pixel_id, clarity_project_id, gtm_container_id, google_ads_send_to")
            .eq("id", ws.company_id)
            .single();
          const c = company as Record<string, unknown> | null;
          return {
            meta_pixel_id: (c?.meta_pixel_id as string | null) || null,
            clarity_project_id: (c?.clarity_project_id as string | null) || null,
            gtm_container_id: (c?.gtm_container_id as string | null) || null,
            google_ads_send_to: (c?.google_ads_send_to as string | null) || null,
          };
        }
        return { meta_pixel_id: null, clarity_project_id: null, gtm_container_id: null, google_ads_send_to: null };
      })();

      const [agentData, tracking] = await Promise.all([agentPromise, companyTrackingPromise]);

      // Return sanitized config with cache headers
      const cacheHeaders = {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      };

      return new Response(
        JSON.stringify({
          id: widgetConfig.id,
          name: widgetConfig.name,
          type: widgetConfig.type,
          settings: widgetConfig.settings,
          workspace_id: widgetConfig.workspace_id,
          agent: agentData,
          meta_pixel_id: tracking.meta_pixel_id || undefined,
          clarity_project_id: tracking.clarity_project_id || undefined,
          gtm_container_id: tracking.gtm_container_id || undefined,
          google_ads_send_to: tracking.google_ads_send_to || undefined,
          
        }),

        { status: 200, headers: cacheHeaders }
      );
    }

    // =============================================
    // GET /widget-chat/messages?session=xxx - Fetch messages
    // =============================================
    if (req.method === "GET" && url.searchParams.has("session")) {
      const sessionToken = url.searchParams.get("session")!;
      const after = url.searchParams.get("after"); // For polling new messages

      // Get session
      const { data: session, error: sessionError } = await supabaseService
        .from("widget_sessions")
        .select("*")
        .eq("session_token", sessionToken)
        .single();

      if (sessionError || !session) {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!session.lead_id) {
        // No messages yet - return empty
        return new Response(
          JSON.stringify({ messages: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch messages for this lead
      let query = supabaseService
        .from("messages")
        .select("id, content, sender_type, created_at, media_type, media_url")
        .eq("lead_id", session.lead_id)
        .order("created_at", { ascending: true });

      if (after) {
        query = query.gt("created_at", after);
      }

      const { data: messages, error: messagesError } = await query;

      if (messagesError) {
        console.error("Error fetching messages:", messagesError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch messages" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update last activity
      await supabaseService
        .from("widget_sessions")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", session.id);

      // Check for pending meta events
      const firedEvents: string[] = Array.isArray(session.meta_events_fired) ? session.meta_events_fired as string[] : [];
      // deno-lint-ignore no-explicit-any
      const allPossibleEvents = ["MQL", "Schedule"];
      const pendingEvents = allPossibleEvents.filter(e => {
        // Check if event exists in fired list but NOT yet acknowledged by client
        return firedEvents.includes(`pending:${e}`) && !firedEvents.includes(`acked:${e}`);
      });

      return new Response(
        JSON.stringify({ messages: messages || [], meta_events_pending: pendingEvents.length > 0 ? pendingEvents : undefined }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =============================================
    // POST /widget-chat - Send message / Create session
    // =============================================
    if (req.method === "POST") {
      const body = await req.json();
      const { widget_id, session_token, message, visitor_info, meta_events_ack } = body;

      // Handle UTM update for existing sessions
      if (session_token && body.update_utm && !message) {
        console.log("[WIDGET-CHAT] UTM update request for session:", session_token);
        const { data: utmSession } = await supabaseService
          .from("widget_sessions")
          .select("lead_id")
          .eq("session_token", session_token)
          .single();

        if (utmSession?.lead_id) {
          // Find crm_contact linked to this lead
          const { data: contact } = await supabaseService
            .from("crm_contacts")
            .select("id")
            .eq("lead_id", utmSession.lead_id)
            .maybeSingle();

          if (contact?.id) {
            const utm = body.update_utm;
            const utmUpdate: Record<string, string> = {};
            if (utm.utm_source) utmUpdate.utm_source = utm.utm_source;
            if (utm.utm_medium) utmUpdate.utm_medium = utm.utm_medium;
            if (utm.utm_campaign) utmUpdate.utm_campaign = utm.utm_campaign;
            if (utm.utm_term) utmUpdate.utm_term = utm.utm_term;
            if (utm.utm_content) utmUpdate.utm_content = utm.utm_content;

            if (Object.keys(utmUpdate).length > 0) {
              const { error: utmError } = await supabaseService
                .from("crm_leads")
                .update(utmUpdate)
                .eq("contact_id", contact.id);

              if (utmError) {
                console.error("[WIDGET-CHAT] UTM update error:", JSON.stringify(utmError));
              } else {
                console.log("[WIDGET-CHAT] UTM updated for existing session:", JSON.stringify(utmUpdate));
              }
            }
          } else {
            console.warn("[WIDGET-CHAT] No crm_contact found for lead:", utmSession.lead_id);
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Handle system message (specialized input tracking)
      if (session_token && body.system_message && !message) {
        const { data: sysSession } = await supabaseService
          .from("widget_sessions")
          .select("lead_id, widget_config_id")
          .eq("session_token", session_token)
          .single();

        if (sysSession?.lead_id) {
          // Get workspace_id from widget config
          const { data: sysConfig } = await supabaseService
            .from("widget_configs")
            .select("workspace_id")
            .eq("id", sysSession.widget_config_id)
            .single();

          if (sysConfig?.workspace_id) {
            await supabaseService.from("messages").insert({
              lead_id: sysSession.lead_id,
              workspace_id: sysConfig.workspace_id,
              content: `__SYSTEM__:${body.system_message}`,
              sender_type: "ai",
            });
            console.log(`[WIDGET-CHAT] System message logged: ${body.system_message}`);
          }
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Handle meta events acknowledgment
      if (session_token && meta_events_ack && Array.isArray(meta_events_ack)) {
        const { data: ackSession } = await supabaseService
          .from("widget_sessions")
          .select("id, meta_events_fired")
          .eq("session_token", session_token)
          .single();
        
        if (ackSession) {
          const fired: string[] = Array.isArray(ackSession.meta_events_fired) ? ackSession.meta_events_fired as string[] : [];
          const updated = [...fired];
          for (const evt of meta_events_ack) {
            if (!updated.includes(`acked:${evt}`)) {
              updated.push(`acked:${evt}`);
            }
          }
          await supabaseService
            .from("widget_sessions")
            .update({ meta_events_fired: updated })
            .eq("id", ackSession.id);
        }

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!widget_id) {
        return new Response(
          JSON.stringify({ error: "widget_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get widget config
      const { data: config, error: configError } = await supabaseService
        .from("widget_configs")
        .select("*")
        .eq("id", widget_id)
        .eq("is_active", true)
        .single();

      if (configError || !config) {
        return new Response(
          JSON.stringify({ error: "Widget not found or inactive" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const widgetConfig = config as WidgetConfig;

      // Validate origin only for external embeddings
      const isInternalOrigin = !origin || 
        origin.includes("lovableproject.com") || 
        origin.includes("lovable.app") ||
        origin.includes("localhost") ||
        origin.includes("supabase.co") ||
        (supabaseUrl && origin.includes(new URL(supabaseUrl).hostname));

      if (!isInternalOrigin && 
          widgetConfig.allowed_origins && 
          widgetConfig.allowed_origins.length > 0) {
        const isAllowed = widgetConfig.allowed_origins.some(
          (allowed) => origin.includes(allowed) || allowed === "*"
        );
        if (!isAllowed) {
          return new Response(
            JSON.stringify({ error: "Origin not allowed" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Resolve effective agent_id: null if agent disabled for live chat
      let effectiveAgentId: string | null = widgetConfig.agent_id;
      if (effectiveAgentId) {
        const { data: legacyA } = await supabaseService
          .from("agents")
          .select("live_chat_enabled")
          .eq("id", effectiveAgentId)
          .maybeSingle();
        let liveEnabled: boolean | null | undefined = legacyA?.live_chat_enabled;
        if (liveEnabled === undefined || liveEnabled === null) {
          const { data: instA } = await supabaseService
            .from("agent_instances")
            .select("live_chat_enabled")
            .eq("id", effectiveAgentId)
            .maybeSingle();
          liveEnabled = instA?.live_chat_enabled;
        }
        if (liveEnabled === false) {
          console.log("[WIDGET-CHAT] Agent disabled for live chat, skipping assignment:", effectiveAgentId);
          effectiveAgentId = null;
        }
      }

      // Carrega origens válidas da empresa (para validar `source` vindo do widget)
      const validSources = await loadValidSources(supabaseService, widgetConfig.workspace_id);

      let session: WidgetSession | null = null;


      // Try to get existing session or create new one
      if (session_token) {
        const { data: existingSession } = await supabaseService
          .from("widget_sessions")
          .select("*")
          .eq("session_token", session_token)
          .single();

      if (existingSession) {
        session = existingSession as WidgetSession;
        
        // Repair orphan session: create lead if session has no lead_id
        if (!session.lead_id) {
          console.log(`[WIDGET-CHAT] Repairing orphan session: ${session.session_token}`);
          
          const widgetSource = computeWidgetSource(session.visitor_info as Record<string, unknown> | null, validSources);
          const visitorInfo = session.visitor_info as Record<string, unknown> | null;
          
          const { data: repairedLead, error: repairError } = await supabaseService
            .from("leads")
            .insert({
              workspace_id: widgetConfig.workspace_id,
              name: (visitorInfo?.name as string) || "Visitante Widget",
              phone: (visitorInfo?.phone as string) || null,
              status: "ai_talking",
              assigned_agent_id: effectiveAgentId,
              source: widgetSource,
            })
            .select()
            .single();
          
          if (repairError || !repairedLead) {
            console.error("[WIDGET-CHAT] Error repairing session:", repairError);
            return new Response(
              JSON.stringify({ error: "Failed to repair session" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          
          // Update session with the new lead_id
          await supabaseService
            .from("widget_sessions")
            .update({ lead_id: repairedLead.id })
            .eq("id", session.id);
          
          session.lead_id = repairedLead.id;
          console.log(`[WIDGET-CHAT] Session repaired with lead_id: ${repairedLead.id}`);
          
          // Propagate UTMs from visitor_info to crm_leads
          const rUtmSource = visitorInfo?.utm_source as string | undefined;
          const rUtmMedium = visitorInfo?.utm_medium as string | undefined;
          const rUtmCampaign = visitorInfo?.utm_campaign as string | undefined;
          const rUtmTerm = visitorInfo?.utm_term as string | undefined;
          const rUtmContent = visitorInfo?.utm_content as string | undefined;
          
          const rSource = visitorInfo?.source as string | undefined;
          
          if (rUtmSource || rUtmMedium || rUtmCampaign || rUtmTerm || rUtmContent || rSource) {
            const { data: repairContact } = await supabaseService
              .from("crm_contacts")
              .select("id, source")
              .eq("lead_id", repairedLead.id)
              .eq("workspace_id", widgetConfig.workspace_id)
              .maybeSingle();
            
            if (repairContact?.id) {
              const rUtmUpdate: Record<string, string> = {};
              if (rUtmSource) rUtmUpdate.utm_source = rUtmSource;
              if (rUtmMedium) rUtmUpdate.utm_medium = rUtmMedium;
              if (rUtmCampaign) rUtmUpdate.utm_campaign = rUtmCampaign;
              if (rUtmTerm) rUtmUpdate.utm_term = rUtmTerm;
              if (rUtmContent) rUtmUpdate.utm_content = rUtmContent;
              
              if (Object.keys(rUtmUpdate).length > 0) {
                await supabaseService
                  .from("crm_leads")
                  .update(rUtmUpdate)
                  .eq("contact_id", repairContact.id)
                  .eq("workspace_id", widgetConfig.workspace_id);
                console.log("[WIDGET-CHAT] UTM params propagated (repair path):", rUtmUpdate);
              }

              // Atualiza source (Origem) só se atual for vazio/default — não sobrescreve origem já preenchida
              const currentSource = (repairContact as { source?: string | null }).source;
              const computedSource = computeWidgetSource(visitorInfo, validSources);
              const newSource = computedSource;
              if (newSource && isWidgetDefaultSource(currentSource)) {
                await supabaseService
                  .from("crm_contacts")
                  .update({ source: newSource, updated_at: new Date().toISOString() })
                  .eq("id", repairContact.id);
                console.log("[WIDGET-CHAT] Source updated on crm_contacts (repair path):", newSource);
              }
            }
          }
        }
        
        // Sync agent if widget config has changed
        if (session.lead_id && effectiveAgentId) {
            const { data: lead } = await supabaseService
              .from("leads")
              .select("assigned_agent_id")
              .eq("id", session.lead_id)
              .single();
            
            if (lead && lead.assigned_agent_id !== effectiveAgentId) {
              console.log(`[WIDGET-CHAT] Syncing agent: ${lead.assigned_agent_id} -> ${effectiveAgentId}`);
              await supabaseService
                .from("leads")
                .update({ assigned_agent_id: effectiveAgentId })
                .eq("id", session.lead_id);
            }
          }
        }
      }

      // Create new session if doesn't exist
      if (!session) {
        const newToken = session_token || crypto.randomUUID();

        // Create lead first with widget source
        const widgetSource = computeWidgetSource(visitor_info as Record<string, unknown> | null, validSources);
        
        const { data: newLead, error: leadError } = await supabaseService
          .from("leads")
          .insert({
            workspace_id: widgetConfig.workspace_id,
            name: visitor_info?.name || "Visitante Widget",
            phone: visitor_info?.phone || null,
            status: "ai_talking",
            assigned_agent_id: effectiveAgentId,
            source: widgetSource,
          })
          .select()
          .single();

        if (leadError) {
          console.error("Error creating lead:", leadError);
          return new Response(
            JSON.stringify({ error: "Failed to create lead" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create session
        const { data: newSession, error: sessionError } = await supabaseService
          .from("widget_sessions")
          .insert({
            widget_config_id: widget_id,
            lead_id: newLead.id,
            session_token: newToken,
            visitor_info: visitor_info || {},
          })
          .select()
          .single();

        if (sessionError) {
          console.error("Error creating session:", sessionError);
          return new Response(
            JSON.stringify({ error: "Failed to create session" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

      session = newSession as WidgetSession;

        // === PROPAGATE UTM PARAMS TO CRM LEAD ===
        const utmSource = visitor_info?.utm_source as string | undefined;
        const utmMedium = visitor_info?.utm_medium as string | undefined;
        const utmCampaign = visitor_info?.utm_campaign as string | undefined;
        const utmTerm = visitor_info?.utm_term as string | undefined;
        const utmContent = visitor_info?.utm_content as string | undefined;
        
        console.log("[WIDGET-CHAT] UTM raw from visitor_info:", JSON.stringify({ utmSource, utmMedium, utmCampaign, utmTerm, utmContent }));
        console.log("[WIDGET-CHAT] Full visitor_info:", JSON.stringify(visitor_info));
        
        const sourceValue = visitor_info?.source as string | undefined;
        
        if (utmSource || utmMedium || utmCampaign || utmTerm || utmContent || sourceValue) {
          // Wait for trigger chain to complete (leads → crm_contacts → crm_leads)
          let crmContact: { id: string; source?: string | null } | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const { data } = await supabaseService
              .from("crm_contacts")
              .select("id, source")
              .eq("lead_id", newLead.id)
              .eq("workspace_id", widgetConfig.workspace_id)
              .maybeSingle();
            crmContact = data as typeof crmContact;
            console.log(`[WIDGET-CHAT] UTM: crm_contact lookup attempt ${attempt + 1}, found: ${!!crmContact?.id}`);
            if (crmContact?.id) break;
          }
          
          if (crmContact?.id) {
            const utmUpdate: Record<string, string> = {};
            if (utmSource) utmUpdate.utm_source = utmSource;
            if (utmMedium) utmUpdate.utm_medium = utmMedium;
            if (utmCampaign) utmUpdate.utm_campaign = utmCampaign;
            if (utmTerm) utmUpdate.utm_term = utmTerm;
            if (utmContent) utmUpdate.utm_content = utmContent;
            
            if (Object.keys(utmUpdate).length > 0) {
              const { data: updatedLeads, error: utmError } = await supabaseService
                .from("crm_leads")
                .update(utmUpdate)
                .eq("contact_id", crmContact.id)
                .eq("workspace_id", widgetConfig.workspace_id)
                .select("id, utm_source, utm_medium, utm_campaign");
              
              if (utmError) {
                console.error("[WIDGET-CHAT] Error updating UTM params:", JSON.stringify(utmError));
              } else {
                console.log("[WIDGET-CHAT] UTM params saved to crm_leads successfully:", JSON.stringify(updatedLeads));
              }
            }

            // Atualiza source (Origem) — não sobrescreve se já houver origem real preenchida
            const currentSource = crmContact.source;
            const computedSource = computeWidgetSource(visitor_info as Record<string, unknown> | null, validSources);
            const newSource = computedSource;
            if (newSource && isWidgetDefaultSource(currentSource)) {
              const { error: srcError } = await supabaseService
                .from("crm_contacts")
                .update({ source: newSource, updated_at: new Date().toISOString() })
                .eq("id", crmContact.id);
              if (srcError) {
                console.error("[WIDGET-CHAT] Error updating contact source:", JSON.stringify(srcError));
              } else {
                console.log("[WIDGET-CHAT] Contact source updated:", newSource);
              }
            }
          } else {
            console.warn("[WIDGET-CHAT] No crm_contact found after 3 attempts for lead:", newLead.id);
          }
        } else {
          console.log("[WIDGET-CHAT] No UTM/source params present, skipping propagation");
        }

        // === PERSISTENT WELCOME MESSAGE ===
        const wSettings = widgetConfig.settings as Record<string, unknown>;
        const welcomeEnabled = wSettings?.welcome_message_enabled === true || 
          (wSettings?.welcome_message_enabled === undefined && wSettings?.welcome_message && typeof wSettings.welcome_message === "string" && (wSettings.welcome_message as string).trim() !== "");
        const welcomeMessage = wSettings?.welcome_message;
        
        if (welcomeEnabled && welcomeMessage && typeof welcomeMessage === "string" && welcomeMessage.trim()) {
          await new Promise(resolve => setTimeout(resolve, 200));

          for (let attempt = 0; attempt < 2; attempt++) {
            const { error: welcomeError } = await supabaseService.from("messages").insert({
              lead_id: newLead.id,
              workspace_id: widgetConfig.workspace_id,
              content: welcomeMessage,
              sender_type: "ai",
            });

            if (!welcomeError) {
              console.log("[WIDGET-CHAT] Welcome message saved to database");
              break;
            }
            console.error(`[WIDGET-CHAT] Welcome message insert attempt ${attempt + 1} failed:`, JSON.stringify(welcomeError));
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
          }
          // NO __INIT_GREETING__ - agent will only respond when lead sends first real message
        } else {
          // Welcome message disabled: trigger agent's own greeting via orchestrator
          await new Promise(resolve => setTimeout(resolve, 200));
          await supabaseService.from("messages").insert({
            lead_id: newLead.id,
            workspace_id: widgetConfig.workspace_id,
            content: "__INIT_GREETING__",
            sender_type: "lead",
          });
          console.log("[WIDGET-CHAT] __INIT_GREETING__ sent (welcome_message disabled)");
        }
        // === END PERSISTENT WELCOME MESSAGE ===
      }

      // If no message, just return the session (used for initialization)
      if (!message) {
        return new Response(
          JSON.stringify({
            session_token: session.session_token,
            lead_id: session.lead_id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert message - this will trigger the orchestrator via the existing trigger
      const { data: newMessage, error: messageError } = await supabaseService
        .from("messages")
        .insert({
          lead_id: session.lead_id,
          workspace_id: widgetConfig.workspace_id,
          content: message,
          sender_type: "lead",
        })
        .select()
        .single();

      if (messageError) {
        console.error("Error inserting message:", messageError);
        return new Response(
          JSON.stringify({ error: "Failed to send message" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update last activity
      await supabaseService
        .from("widget_sessions")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", session.id);

      return new Response(
        JSON.stringify({
          session_token: session.session_token,
          message_id: newMessage.id,
          lead_id: session.lead_id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Widget chat error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
