import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AcceptInviteRequest {
  token: string;
  password: string;
  name: string;
  phone?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { token, password, name, phone } = await req.json() as AcceptInviteRequest;

    console.log("[accept-invite] Processing invite with token:", token?.substring(0, 8) + "...");

    // Validate required fields
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!password || password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Senha deve ter no mínimo 6 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!name || !name.trim()) {
      return new Response(
        JSON.stringify({ error: "Nome é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Fetch and validate invite
    console.log("[accept-invite] Fetching invite...");
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("company_invites")
      .select(`
        id,
        email,
        role,
        expires_at,
        company_id,
        workspace_ids,
        status,
        company:companies(name)
      `)
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      console.error("[accept-invite] Error fetching invite:", inviteError);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar convite" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invite) {
      console.log("[accept-invite] Invite not found");
      return new Response(
        JSON.stringify({ error: "Convite não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invite.status !== "pending") {
      console.log("[accept-invite] Invite already used, status:", invite.status);
      return new Response(
        JSON.stringify({ error: "Este convite já foi utilizado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(invite.expires_at) < new Date()) {
      console.log("[accept-invite] Invite expired");
      return new Response(
        JSON.stringify({ error: "Este convite expirou" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = invite.email.toLowerCase();
    console.log("[accept-invite] Valid invite for email:", email);

    // Step 2: Check if user already exists in auth.users
    let userId: string | null = null;
    let isNewUser = false;

    console.log("[accept-invite] Checking if user exists in auth...");
    const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error("[accept-invite] Error listing users:", listError);
      return new Response(
        JSON.stringify({ error: "Erro ao verificar usuários" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingAuthUser = authUsers.users.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (existingAuthUser) {
      console.log("[accept-invite] User already exists in auth:", existingAuthUser.id);
      userId = existingAuthUser.id;
      
      // Try to sign in to verify password is correct
      // We don't have a way to verify password via admin, so we'll update it
      const { error: updatePasswordError } = await supabaseAdmin.auth.admin.updateUserById(
        existingAuthUser.id,
        { password: password }
      );
      
      if (updatePasswordError) {
        console.error("[accept-invite] Error updating password:", updatePasswordError);
        // This is not critical, continue anyway
      }
    } else {
      // Step 3: Create new user
      console.log("[accept-invite] Creating new user...");
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          name: name,
        },
      });

      if (createError) {
        console.error("[accept-invite] Error creating user:", createError);
        return new Response(
          JSON.stringify({ error: `Erro ao criar usuário: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      userId = newUser.user.id;
      isNewUser = true;
      console.log("[accept-invite] New user created:", userId);
    }

    // Step 4: Ensure profile exists (upsert)
    console.log("[accept-invite] Upserting profile...");
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email: email,
        name: name,
        phone: phone || null,
      }, {
        onConflict: "id",
      });

    if (profileError) {
      console.error("[accept-invite] Error upserting profile:", profileError);
      return new Response(
        JSON.stringify({ error: `Erro ao criar perfil: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("[accept-invite] Profile upserted successfully");

    // Step 5: Ensure user_roles exists
    console.log("[accept-invite] Ensuring user_roles...");
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({
        user_id: userId,
        role: "member",
      }, {
        onConflict: "user_id,role",
        ignoreDuplicates: true,
      });

    if (roleError) {
      console.error("[accept-invite] Error upserting user_roles:", roleError);
      // Not critical, continue
    }

    // Step 6: Check if already a company member
    console.log("[accept-invite] Checking existing company membership...");
    const { data: existingMember, error: memberCheckError } = await supabaseAdmin
      .from("company_members")
      .select("id, status, role")
      .eq("company_id", invite.company_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberCheckError) {
      console.error("[accept-invite] Error checking membership:", memberCheckError);
    }

    if (existingMember) {
      if (existingMember.status === "removed") {
        // Reactivate member
        console.log("[accept-invite] Reactivating removed member...");
        const { error: reactivateError } = await supabaseAdmin
          .from("company_members")
          .update({
            status: "active",
            role: invite.role,
            joined_at: new Date().toISOString(),
          })
          .eq("id", existingMember.id);

        if (reactivateError) {
          console.error("[accept-invite] Error reactivating:", reactivateError);
          return new Response(
            JSON.stringify({ error: "Erro ao reativar membro" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log("[accept-invite] Member reactivated");
      } else {
        console.log("[accept-invite] User is already an active member");
      }
    } else {
      // Step 7: Add to company_members
      console.log("[accept-invite] Adding to company_members...");
      const { error: memberError } = await supabaseAdmin
        .from("company_members")
        .insert({
          company_id: invite.company_id,
          user_id: userId,
          role: invite.role,
          status: "active",
        });

      if (memberError) {
        console.error("[accept-invite] Error adding company member:", memberError);
        return new Response(
          JSON.stringify({ error: `Erro ao adicionar à empresa: ${memberError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log("[accept-invite] Added to company_members");
    }

    // Step 8: Add to workspace_members
    if (invite.workspace_ids && invite.workspace_ids.length > 0) {
      console.log("[accept-invite] Adding to workspaces:", invite.workspace_ids);
      
      for (const workspaceId of invite.workspace_ids) {
        // Check if already exists
        const { data: existingWs } = await supabaseAdmin
          .from("workspace_members")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle();

        if (!existingWs) {
          const { error: wsError } = await supabaseAdmin
            .from("workspace_members")
            .insert({
              workspace_id: workspaceId,
              user_id: userId,
              role: invite.role === "admin" ? "admin" : "member",
              status: "active",
            });

          if (wsError) {
            console.error(`[accept-invite] Error adding to workspace ${workspaceId}:`, wsError);
            // Continue with other workspaces
          } else {
            console.log(`[accept-invite] Added to workspace ${workspaceId}`);
          }
        } else {
          console.log(`[accept-invite] Already in workspace ${workspaceId}`);
        }
      }
    }

    // Step 9: Mark invite as accepted
    console.log("[accept-invite] Marking invite as accepted...");
    const { error: updateInviteError } = await supabaseAdmin
      .from("company_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    if (updateInviteError) {
      console.error("[accept-invite] Error updating invite:", updateInviteError);
      // Not critical, continue
    }

    // Get company name for response
    const companyData = Array.isArray(invite.company) ? invite.company[0] : invite.company;
    const companyName = companyData?.name || "Empresa";

    console.log("[accept-invite] Success! User:", userId, "isNewUser:", isNewUser);

    return new Response(
      JSON.stringify({
        success: true,
        userId: userId,
        isNewUser: isNewUser,
        email: email,
        companyName: companyName,
        workspaceIds: invite.workspace_ids || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[accept-invite] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro inesperado" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
