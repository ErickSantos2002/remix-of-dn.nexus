import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const SetupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  company_name: z.string().trim().min(2).max(160),
  workspace_name: z.string().trim().min(1).max(160),
});

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const hasAnyUser = async (): Promise<boolean> => {
    const { count, error } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    if ((count ?? 0) > 0) return true;

    const { data, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (authError) throw authError;
    return (data?.users?.length ?? 0) > 0;
  };

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = (body as { action?: string })?.action ?? "status";

    if (action === "status") {
      return json({ needs_setup: !(await hasAnyUser()) });
    }

    if (action !== "setup") {
      return json({ error: "Ação inválida" }, 400);
    }

    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const input = parsed.data;

    if (await hasAnyUser()) {
      return json({ error: "O sistema já possui usuários cadastrados." }, 409);
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: input.email.toLowerCase(),
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    });
    if (authError || !authData?.user) {
      console.error("createUser failed", authError);
      return json({ error: authError?.message ?? "Falha ao criar usuário" }, 500);
    }

    const userId = authData.user.id;
    let companyId: string | null = null;
    let workspaceId: string | null = null;

    try {
      await admin
        .from("profiles")
        .upsert(
          { id: userId, email: input.email.toLowerCase(), name: input.name },
          { onConflict: "id" },
        );

      // O trigger on_auth_user_created ja inseriu a role 'member'. Manter as duas
      // linhas quebra os leitores que usam .single()/.maybeSingle() em user_roles,
      // entao substituimos todas as roles do usuario por super_admin.
      const { error: roleDeleteError } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", userId);
      if (roleDeleteError) throw roleDeleteError;

      const { error: roleError } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "super_admin" });
      if (roleError) throw roleError;

      const { data: company, error: companyError } = await admin
        .from("companies")
        .insert({ name: input.company_name, owner_id: userId })
        .select("id")
        .single();
      if (companyError) throw companyError;
      companyId = company.id;

      const { error: cmError } = await admin.from("company_members").insert({
        company_id: company.id,
        user_id: userId,
        role: "admin",
        status: "active",
      });
      if (cmError) throw cmError;

      const { data: workspace, error: wsError } = await admin
        .from("workspaces")
        .insert({
          name: input.workspace_name,
          company_id: company.id,
          owner_id: userId,
          is_default: true,
          icon: "Star",
        })
        .select("id")
        .single();
      if (wsError) throw wsError;
      workspaceId = workspace.id;

      // workspace_members.role tem CHECK (role IN ('admin','member')); 'owner' viola
      // a constraint. A propriedade do workspace ja fica registrada em
      // workspaces.owner_id, e as RLS tratam 'admin' e 'owner' da mesma forma.
      const { error: wmError } = await admin.from("workspace_members").insert({
        workspace_id: workspace.id,
        user_id: userId,
        role: "admin",
        status: "active",
      });
      if (wmError) throw wmError;

      return json({
        success: true,
        user_id: userId,
        company_id: company.id,
        workspace_id: workspace.id,
      });
    } catch (err) {
      console.error("bootstrap failed, rolling back", err);
      // Deletar o usuario nao remove a empresa (companies.owner_id e ON DELETE SET NULL),
      // o que deixaria uma empresa orfa e faria a proxima tentativa criar uma duplicata.
      // Os membros caem por cascade junto de workspace/company/profile.
      if (workspaceId) {
        const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
        if (error) console.error("rollback workspace failed", error);
      }
      if (companyId) {
        const { error } = await admin.from("companies").delete().eq("id", companyId);
        if (error) console.error("rollback company failed", error);
      }
      await admin.auth.admin.deleteUser(userId).catch((e) =>
        console.error("rollback user failed", e)
      );
      return json({ error: (err as Error).message ?? "Falha na configuração inicial" }, 500);
    }
  } catch (error) {
    console.error("bootstrap-admin error", error);
    return json({ error: (error as Error).message }, 500);
  }
});
