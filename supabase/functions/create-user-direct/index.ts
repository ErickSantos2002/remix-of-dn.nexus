import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  companyId: string;
  role: string;
  createdBy: string;
  workspaceIds?: string[];
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { email, password, name, companyId, role, createdBy, workspaceIds }: CreateUserRequest = await req.json();

    console.log(`Creating user directly: ${email} for company ${companyId}, role: ${role}, workspaces: ${workspaceIds?.join(', ') || 'none'}`);

    // Validate required fields
    if (!email || !password || !companyId || !role) {
      return new Response(
        JSON.stringify({ success: false, error: "Campos obrigatorios faltando" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // If creating a super_admin, verify that the creator is also a super_admin
    if (role === "super_admin" && createdBy) {
      const { data: creatorRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", createdBy)
        .eq("role", "super_admin")
        .single();

      if (!creatorRole) {
        console.log(`User ${createdBy} attempted to create super_admin but is not a super_admin`);
        return new Response(
          JSON.stringify({ success: false, error: "Apenas Super Admins podem criar outros Super Admins" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
    }

    // Check if user already exists
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (existingProfile) {
      // User exists, just add to company
      const { data: existingMember } = await supabaseAdmin
        .from("company_members")
        .select("id")
        .eq("company_id", companyId)
        .eq("user_id", existingProfile.id)
        .single();

      if (existingMember) {
        return new Response(
          JSON.stringify({ success: false, error: "Usuario ja e membro desta empresa" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Add existing user to company
      const { error: memberError } = await supabaseAdmin
        .from("company_members")
        .insert({
          company_id: companyId,
          user_id: existingProfile.id,
          role: role,
          invited_by: createdBy,
          status: "active",
        });

      if (memberError) {
        console.error("Error adding existing user to company:", memberError);
        return new Response(
          JSON.stringify({ success: false, error: memberError.message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // Add user to selected workspaces
      if (workspaceIds && workspaceIds.length > 0) {
        for (const workspaceId of workspaceIds) {
          const { error: wsError } = await supabaseAdmin
            .from("workspace_members")
            .insert({
              workspace_id: workspaceId,
              user_id: existingProfile.id,
              role: role === "admin" ? "admin" : "member",
              status: "active",
              invited_by: createdBy,
            });

          if (wsError) {
            console.error(`Error adding user to workspace ${workspaceId}:`, wsError);
            // Continue with other workspaces
          }
        }
        console.log(`Existing user ${email} added to ${workspaceIds.length} workspaces`);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Usuario existente adicionado a empresa",
          userId: existingProfile.id,
          isNewUser: false
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Create new user using admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: name,
      },
    });

    if (authError) {
      console.error("Error creating user:", authError);
      return new Response(
        JSON.stringify({ success: false, error: authError.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const userId = authData.user.id;
    console.log(`User created with ID: ${userId}`);

    // Update profile with name (trigger should have created the profile)
    if (name) {
      await supabaseAdmin
        .from("profiles")
        .update({ name: name })
        .eq("id", userId);
    }

    // Add user to company_members
    const { error: memberError } = await supabaseAdmin
      .from("company_members")
      .insert({
        company_id: companyId,
        user_id: userId,
        role: role,
        invited_by: createdBy,
        status: "active",
      });

    if (memberError) {
      console.error("Error adding user to company:", memberError);
      // Try to clean up the created user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ success: false, error: memberError.message }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Add user to selected workspaces
    if (workspaceIds && workspaceIds.length > 0) {
      for (const workspaceId of workspaceIds) {
        const { error: wsError } = await supabaseAdmin
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            role: role === "admin" ? "admin" : "member",
            status: "active",
            invited_by: createdBy,
          });

        if (wsError) {
          console.error(`Error adding user to workspace ${workspaceId}:`, wsError);
          // Continue with other workspaces
        }
      }
      console.log(`New user ${email} added to ${workspaceIds.length} workspaces`);
    }

    // If role is super_admin, add to user_roles table
    if (role === "super_admin") {
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert(
          { user_id: userId, role: "super_admin" },
          { onConflict: "user_id" }
        );

      if (roleError) {
        console.error("Error setting super_admin role:", roleError);
      } else {
        console.log(`User ${email} set as super_admin in user_roles`);
      }
    }

    console.log(`User ${email} added to company ${companyId} with role ${role}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Usuario criado com sucesso",
        userId: userId,
        isNewUser: true
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in create-user-direct:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
