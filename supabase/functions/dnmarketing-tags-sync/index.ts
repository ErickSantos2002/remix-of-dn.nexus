import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contact_id } = await req.json();
    if (!contact_id) {
      return new Response(JSON.stringify({ error: "contact_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: contact, error: contactError } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email, dnia_id, tags, workspace_id")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      console.error("[DNMARKETING-TAGS-SYNC] Contact not found:", contact_id, contactError);
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });

    let dniaId = contact.dnia_id as string | null;

    if (!dniaId) {
      console.log("[DNMARKETING-TAGS-SYNC] No dnia_id, invoking dnmarketing-sync for", contact_id);
      const syncRes = await supabase.functions.invoke("dnmarketing-sync", {
        body: { contact_id },
      });
      if (syncRes.error) {
        console.error("[DNMARKETING-TAGS-SYNC] dnmarketing-sync failed:", syncRes.error);
        return new Response(JSON.stringify({ error: "Failed to resolve dnia_id" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      dniaId = (syncRes.data as { dnia_id?: string })?.dnia_id ?? null;
    }

    if (!dniaId) {
      console.log("[DNMARKETING-TAGS-SYNC] Skipped, no identifiers for", contact_id);
      return new Response(JSON.stringify({ skipped: true, reason: "no_dnia_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawTags = Array.isArray(contact.tags) ? contact.tags : [];
    const tagNames: string[] = rawTags
      .map((t: unknown) => {
        if (typeof t === "string") return t;
        if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") {
          return (t as { name: string }).name;
        }
        return null;
      })
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);

    const tagColors: Record<string, string> = {};
    for (const t of rawTags) {
      if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string" && typeof (t as { color?: unknown }).color === "string") {
        tagColors[(t as { name: string }).name] = (t as { color: string }).color;
      }
    }

    const payload = {
      source_app: "nexus",
      dnia_id: dniaId,
      local_id: contact.id,
      tags: tagNames,
      tag_colors: tagColors,
    };

    console.log("[DNMARKETING-TAGS-SYNC] PUT /contact-tags-sync", { dnia_id: dniaId, tags: tagNames });

    const res = await dnFetch(supabase, companyId, {
      method: "PUT",
      path: "/contact-tags-sync",
      body: payload,
    });

    if (!res) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_active_config" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!res.ok) {
      console.error("[DNMARKETING-TAGS-SYNC] Failed:", res.status, res.raw?.substring(0, 300));
      return new Response(JSON.stringify({ error: "Sync failed", status: res.status, body: res.raw }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[DNMARKETING-TAGS-SYNC] Success");
    return new Response(JSON.stringify({ success: true, dnia_id: dniaId, tags_count: tagNames.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DNMARKETING-TAGS-SYNC] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
