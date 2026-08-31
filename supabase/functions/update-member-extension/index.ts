import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const targetUserId: string | undefined = body?.user_id;
    const companyId: string | undefined = body?.company_id;
    const extension: string | null = body?.extension ?? null;

    if (!targetUserId || !companyId) {
      return new Response(JSON.stringify({ error: "user_id and company_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: caller must be super_admin, company owner, or company admin
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: user.id, _role: "super_admin" });
    let allowed = !!isSuper;

    if (!allowed) {
      const { data: company } = await admin
        .from("companies").select("owner_id").eq("id", companyId).single();
      if (company?.owner_id === user.id) allowed = true;
    }

    if (!allowed) {
      const { data: membership } = await admin
        .from("company_members").select("role,status")
        .eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
      if (membership?.role === "admin" && membership?.status === "active") allowed = true;
    }

    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden: requires admin/owner" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify target user belongs to the company
    const { data: targetMembership } = await admin
      .from("company_members").select("id")
      .eq("company_id", companyId).eq("user_id", targetUserId).maybeSingle();
    const { data: targetCompany } = await admin
      .from("companies").select("owner_id").eq("id", companyId).single();
    if (!targetMembership && targetCompany?.owner_id !== targetUserId) {
      return new Response(JSON.stringify({ error: "Target user is not a member of this company" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updated, error: updErr } = await admin
      .from("profiles")
      .update({
        api4com_extension: extension || null,
        api4com_synced_at: new Date().toISOString(),
      })
      .eq("id", targetUserId)
      .select("api4com_extension")
      .single();

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, api4com_extension: updated?.api4com_extension }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
