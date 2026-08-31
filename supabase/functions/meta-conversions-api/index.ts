import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_API_VERSION = "v21.0";

/**
 * Hash a value with SHA-256 (Meta CAPI requirement).
 */
async function sha256Hash(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim();
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Decrypt AES-GCM token using company_id as passphrase.
 * Must match the frontend crypto.ts encryption.
 */
async function decryptToken(encryptedBase64: string, companyId: string): Promise<string> {
  const raw = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(companyId),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Build hashed user_data object for Meta CAPI.
 */
async function buildUserData(contact: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<Record<string, string[]>> {
  const userData: Record<string, string[]> = {};

  if (contact.email) {
    userData.em = [await sha256Hash(contact.email)];
  }

  if (contact.phone) {
    const digits = contact.phone.replace(/\D/g, "");
    if (digits.length >= 10) {
      const e164 = digits.startsWith("55") ? digits : `55${digits}`;
      userData.ph = [await sha256Hash(e164)];
    }
  }

  if (contact.name) {
    const parts = contact.name.trim().split(/\s+/);
    if (parts[0]) {
      userData.fn = [await sha256Hash(parts[0])];
    }
    if (parts.length > 1) {
      userData.ln = [await sha256Hash(parts[parts.length - 1])];
    }
  }

  userData.country = [await sha256Hash("br")];

  return userData;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const invocationId = crypto.randomUUID().slice(0, 8);
  try {
    const rawBody = await req.text();
    console.log(`[META-CAPI][${invocationId}] Incoming request. Method=${req.method} BodyLength=${rawBody.length}`);
    console.log(`[META-CAPI][${invocationId}] Raw payload: ${rawBody.substring(0, 1000)}`);

    let parsed: Record<string, unknown> = {};
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {};
    } catch (parseErr) {
      console.error(`[META-CAPI][${invocationId}] Failed to parse JSON body:`, parseErr);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      event_name,
      lead_id,
      crm_lead_id,
      contact_id,
      workspace_id,
      pixel_id,
      company_id,
      custom_data,
      source_url,
    } = parsed as {
      event_name?: string;
      lead_id?: string;
      crm_lead_id?: string;
      contact_id?: string;
      workspace_id?: string;
      pixel_id?: string;
      company_id?: string;
      custom_data?: Record<string, unknown>;
      source_url?: string;
    };

    console.log(`[META-CAPI][${invocationId}] Parsed: event_name=${event_name} crm_lead_id=${crm_lead_id} contact_id=${contact_id} workspace_id=${workspace_id} company_id=${company_id} pixel_id=${pixel_id}`);

    if (!event_name) {
      console.warn(`[META-CAPI][${invocationId}] Missing event_name, aborting`);
      return new Response(
        JSON.stringify({ error: "event_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve workspace_id / contact_id from crm_lead_id if not provided
    let resolvedWorkspaceId = workspace_id;
    let resolvedContactId = contact_id;
    if (crm_lead_id && (!resolvedWorkspaceId || !resolvedContactId)) {
      const { data: crmLeadData, error: crmLeadErr } = await supabase
        .from("crm_leads")
        .select("workspace_id, contact_id")
        .eq("id", crm_lead_id)
        .single();
      if (crmLeadErr) {
        console.error(`[META-CAPI][${invocationId}] Error fetching crm_lead ${crm_lead_id}:`, crmLeadErr);
      }
      if (crmLeadData) {
        resolvedWorkspaceId = resolvedWorkspaceId || crmLeadData.workspace_id;
        resolvedContactId = resolvedContactId || crmLeadData.contact_id;
        console.log(`[META-CAPI][${invocationId}] Resolved from crm_lead: workspace_id=${resolvedWorkspaceId} contact_id=${resolvedContactId}`);
      }
    }

    if (!resolvedWorkspaceId) {
      console.warn(`[META-CAPI][${invocationId}] No workspace_id resolvable. Aborting.`);
      return new Response(
        JSON.stringify({ error: "workspace_id (or crm_lead_id) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve company_id if not provided
    let resolvedCompanyId = company_id;
    if (!resolvedCompanyId) {
      const { data: wsData, error: wsErr } = await supabase
        .from("workspaces")
        .select("company_id")
        .eq("id", resolvedWorkspaceId)
        .single();
      if (wsErr) console.error(`[META-CAPI][${invocationId}] Error fetching workspace ${resolvedWorkspaceId}:`, wsErr);
      resolvedCompanyId = wsData?.company_id;
      console.log(`[META-CAPI][${invocationId}] Resolved company_id=${resolvedCompanyId} from workspace`);
    }

    if (!resolvedCompanyId) {
      console.error(`[META-CAPI][${invocationId}] Could not resolve company_id`);
      return new Response(
        JSON.stringify({ error: "Could not resolve company_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch meta_access_token + meta_pixel_id from company (token is encrypted)
    const { data: companyData, error: companyErr } = await supabase
      .from("companies")
      .select("meta_access_token, meta_pixel_id")
      .eq("id", resolvedCompanyId)
      .single();

    if (companyErr) console.error(`[META-CAPI][${invocationId}] Error fetching company ${resolvedCompanyId}:`, companyErr);
    console.log(`[META-CAPI][${invocationId}] Company config: has_token=${!!companyData?.meta_access_token} pixel_id=${companyData?.meta_pixel_id}`);

    if (!companyData?.meta_access_token) {
      console.error(`[META-CAPI][${invocationId}] meta_access_token not configured for company ${resolvedCompanyId}`);
      return new Response(
        JSON.stringify({ error: "meta_access_token not configured for this company" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolvedPixelId = pixel_id || companyData.meta_pixel_id;
    if (!resolvedPixelId) {
      console.error(`[META-CAPI][${invocationId}] meta_pixel_id not configured for company ${resolvedCompanyId}`);
      return new Response(
        JSON.stringify({ error: "meta_pixel_id not configured for this company" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decrypt the token
    let accessToken: string;
    try {
      accessToken = await decryptToken(companyData.meta_access_token, resolvedCompanyId);
    } catch (decryptErr) {
      console.error("[META-CAPI] Failed to decrypt meta_access_token:", decryptErr);
      return new Response(
        JSON.stringify({ error: "Failed to decrypt meta_access_token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch contact data for hashing
    let contact: { name?: string | null; email?: string | null; phone?: string | null } = {};

    if (resolvedContactId) {
      const { data } = await supabase
        .from("crm_contacts")
        .select("name, email, phone")
        .eq("id", resolvedContactId)
        .single();
      if (data) contact = data;
    } else if (lead_id) {
      const { data: leadData } = await supabase
        .from("leads")
        .select("contact_id, name, phone")
        .eq("id", lead_id)
        .single();

      if (leadData?.contact_id) {
        const { data } = await supabase
          .from("crm_contacts")
          .select("name, email, phone")
          .eq("id", leadData.contact_id)
          .single();
        if (data) contact = data;
        resolvedContactId = leadData.contact_id;
      } else if (leadData) {
        contact = { name: leadData.name, phone: leadData.phone };
      }
    }

    // Skip Meta event if contact email is from dnia.ai domain (internal/testing)
    const contactEmail = contact.email?.trim().toLowerCase();
    if (contactEmail && contactEmail.endsWith("@dnia.ai")) {
      console.log(`[META-CAPI][${invocationId}] Skipping event for dnia.ai email: ${contactEmail}`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "dnia.ai domain excluded from Meta tracking" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build hashed user data
    const userData = await buildUserData(contact);

    // Generate unique event_id for deduplication with Pixel
    const eventId = crypto.randomUUID();

    // Always send `value` and `currency` at the top level of custom_data when a value is present.
    // Default currency is BRL (Brazilian Real) for every event type.
    let finalCustomData: Record<string, unknown> | undefined = custom_data
      ? { ...custom_data }
      : undefined;

    const rawValue = (custom_data as Record<string, unknown> | undefined)?.value;
    const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== "";
    if (hasValue) {
      const numericValue =
        typeof rawValue === "number" ? rawValue : Number(rawValue);
      finalCustomData = {
        ...(finalCustomData || {}),
        value: Number.isFinite(numericValue) ? numericValue : 0,
        currency: (finalCustomData?.currency as string) || "BRL",
      };
      console.log(`[META-CAPI][${invocationId}] Event ${event_name} - value=${finalCustomData.value} currency=${finalCustomData.currency}`);
    }

    const eventPayload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          event_source_url: source_url || undefined,
          action_source: "website",
          user_data: userData,
          custom_data: finalCustomData,
        },
      ],
    };

    console.log(`[META-CAPI][${invocationId}] Sending ${event_name} to pixel ${resolvedPixelId}. user_data keys=${Object.keys(userData).join(",")} custom_data=${JSON.stringify(custom_data || {})}`);

    const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${resolvedPixelId}/events?access_token=${accessToken}`;

    const metaResponse = await fetch(metaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload),
    });

    const responseStatus = metaResponse.status;
    const responseBody = await metaResponse.text();

    console.log(`[META-CAPI][${invocationId}] Meta response: ${responseStatus} - ${responseBody.substring(0, 400)}`);

    // Log the event
    await supabase.from("meta_capi_events").insert({
      lead_id: lead_id || null,
      contact_id: resolvedContactId || null,
      event_name,
      event_id: eventId,
      pixel_id: resolvedPixelId,
      user_data: userData,
      custom_data: custom_data || null,
      response_status: responseStatus,
      response_body: responseBody.substring(0, 500),
      workspace_id: resolvedWorkspaceId,
    });

    return new Response(
      JSON.stringify({
        success: metaResponse.ok,
        event_id: eventId,
        status: responseStatus,
        events_received: metaResponse.ok ? JSON.parse(responseBody)?.events_received : 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[META-CAPI] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
