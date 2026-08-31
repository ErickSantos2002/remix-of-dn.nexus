import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyDnMarketing, resolveCompanyId } from "../_shared/dnmarketing.ts";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-workspace-id",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

// ---------------------------------------------------------------------------
// Contact source — validado dinamicamente contra public.crm_contact_sources
// (gerenciado em /settings/company). Valores desconhecidos viram fallback.
// ---------------------------------------------------------------------------

const CONTACT_SOURCE_FALLBACK = "API - Origem não identificada";

// Cache simples por companyId para evitar query a cada chamada
const _contactSourceCache = new Map<string, { values: Set<string>; expiresAt: number }>();

async function getValidContactSources(
  supabase: ReturnType<typeof adminClient>,
  companyId: string | null | undefined,
): Promise<Set<string>> {
  if (!companyId) return new Set();
  const cached = _contactSourceCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.values;
  const { data } = await supabase
    .from("crm_contact_sources")
    .select("name")
    .eq("company_id", companyId);
  const values = new Set<string>((data ?? []).map((r: { name: string }) => r.name));
  _contactSourceCache.set(companyId, { values, expiresAt: Date.now() + 60_000 });
  return values;
}

/**
 * Retorna o valor se estiver na lista de origens da empresa; valores desconhecidos
 * viram o fallback. Retorna `null` para entrada vazia/null/undefined.
 */
async function normalizeContactSource(
  supabase: ReturnType<typeof adminClient>,
  companyId: string | null | undefined,
  value: unknown,
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const valid = await getValidContactSources(supabase, companyId);
  return valid.has(str) ? str : CONTACT_SOURCE_FALLBACK;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function successResponse(data: unknown, meta?: Record<string, unknown>, status = 200) {
  return new Response(
    JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status },
  );
}

function errorResponse(code: string, message: string, status = 400, details: unknown[] = []) {
  return new Response(
    JSON.stringify({ success: false, error: { code, message, details } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status },
  );
}

// ---------------------------------------------------------------------------
// Paginated fetch helper (bypasses Supabase 1000-row API ceiling)
// ---------------------------------------------------------------------------

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Auth context type
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string | null;
  workspaceId: string | null;
  companyId: string | null;
  authMethod: "jwt" | "api_key";
  apiKeyId?: string;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

async function authenticate(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ ctx: AuthContext; error?: never } | { ctx?: never; error: Response }> {
  const authHeader = req.headers.get("authorization");
  const apiKeyHeader = req.headers.get("x-api-key");
  const workspaceId = req.headers.get("x-workspace-id") || null;

  // --- JWT auth ---
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { error: errorResponse("UNAUTHORIZED", "Invalid or expired JWT token", 401) };
    }

    return {
      ctx: {
        userId: user.id,
        workspaceId,
        companyId: null,
        authMethod: "jwt",
      },
    };
  }

  // --- API Key auth ---
  if (apiKeyHeader) {
    const keyHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKeyHeader)),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: apiKey, error } = await supabase
      .from("api_keys")
      .select("id, workspace_id, company_id, created_by, permissions, expires_at, is_active, last_used_at")
      .eq("key_hash", keyHash)
      .single();

    if (error || !apiKey) {
      return { error: errorResponse("UNAUTHORIZED", "Invalid API key", 401) };
    }

    if (!apiKey.is_active) {
      return { error: errorResponse("UNAUTHORIZED", "API key has been revoked", 401) };
    }

    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return { error: errorResponse("UNAUTHORIZED", "API key has expired", 401) };
    }

    // Throttled last_used_at update — only writes if NULL or >5 min stale.
    // Cuts ~95% of UPDATEs (was 183k calls / 9 min total DB time).
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const lastUsedAt = apiKey.last_used_at ? new Date(apiKey.last_used_at).getTime() : 0;
    if (!lastUsedAt || Date.now() - lastUsedAt > FIVE_MIN_MS) {
      supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKey.id)
        .then();
    }


    return {
      ctx: {
        userId: apiKey.created_by,
        workspaceId: workspaceId || apiKey.workspace_id,
        companyId: apiKey.company_id,
        authMethod: "api_key",
        apiKeyId: apiKey.id,
      },
    };
  }

  return { error: errorResponse("UNAUTHORIZED", "Missing authentication. Provide Authorization header or X-API-Key.", 401) };
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function parsePagination(url: URL): { page: number; perPage: number; from: number; to: number } {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "50", 10)));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  return { page, perPage, from, to };
}

// ---------------------------------------------------------------------------
// Route: /api-keys (fully implemented example)
// ---------------------------------------------------------------------------

async function handleApiKeys(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  // We use the authenticated user's JWT so RLS is enforced
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const workspaceId = ctx.workspaceId;
  if (!workspaceId) {
    return errorResponse("MISSING_WORKSPACE", "X-Workspace-Id header is required", 400);
  }

  // GET /api-keys — list keys for workspace
  if (method === "GET" && pathParts.length === 0) {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, permissions, created_by, last_used_at, expires_at, is_active, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      return errorResponse("DB_ERROR", error.message, 500);
    }

    return successResponse(data);
  }

  // POST /api-keys — create a new key
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body || !body.name) {
      return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    }

    // Resolve company_id from workspace
    const { data: ws, error: wsErr } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspaceId)
      .single();

    if (wsErr || !ws) {
      return errorResponse("NOT_FOUND", "Workspace not found", 404);
    }

    // Generate key
    const rawKey = `nxai_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const keyPrefix = rawKey.substring(0, 12);

    const { data: newKey, error: insertErr } = await supabase
      .from("api_keys")
      .insert({
        workspace_id: workspaceId,
        company_id: ws.company_id,
        name: body.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        permissions: body.permissions || [],
        created_by: ctx.userId,
        expires_at: body.expires_at || null,
      })
      .select("id, name, key_prefix, permissions, created_at, expires_at")
      .single();

    if (insertErr) {
      return errorResponse("DB_ERROR", insertErr.message, 500);
    }

    // Return the full key ONCE — it cannot be retrieved again
    return successResponse(
      { ...newKey, key: rawKey },
      undefined,
      201,
    );
  }

  // DELETE /api-keys/:id — soft-delete (revoke)
  if (method === "DELETE" && pathParts.length === 1) {
    const keyId = pathParts[0];
    const { data, error } = await supabase
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .single();

    if (error || !data) {
      return errorResponse("NOT_FOUND", "API key not found or already revoked", 404);
    }

    return successResponse({ id: data.id, revoked: true });
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} is not supported on /api-keys`, 405);
}

// ---------------------------------------------------------------------------
// Helper: create a service-role Supabase client (bypasses RLS)
// ---------------------------------------------------------------------------

function adminClient(supabaseUrl: string, serviceKey: string) {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Route: /auth
// ---------------------------------------------------------------------------

async function handleAuth(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  ctx: AuthContext | null,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const sub = pathParts[0] || "";

  // POST /auth/login
  if (method === "POST" && sub === "login") {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return errorResponse("VALIDATION_ERROR", "Fields 'email' and 'password' are required");
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error) return errorResponse("AUTH_ERROR", error.message, 401);
    return successResponse({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  }

  // POST /auth/register
  if (method === "POST" && sub === "register") {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password) {
      return errorResponse("VALIDATION_ERROR", "Fields 'email' and 'password' are required");
    }
    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { name: body.full_name || "" } },
    });
    if (error) return errorResponse("AUTH_ERROR", error.message, 400);
    return successResponse({
      user: { id: data.user?.id, email: data.user?.email },
      message: "Registro realizado. Verifique seu email para confirmar.",
    }, undefined, 201);
  }

  // POST /auth/logout
  if (method === "POST" && sub === "logout") {
    return successResponse({ message: "Sessao encerrada" });
  }

  // POST /auth/refresh
  if (method === "POST" && sub === "refresh") {
    const body = await req.json().catch(() => null);
    if (!body?.refresh_token) {
      return errorResponse("VALIDATION_ERROR", "Field 'refresh_token' is required");
    }
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: body.refresh_token,
    });
    if (error) return errorResponse("AUTH_ERROR", error.message, 401);
    return successResponse({
      token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_at: data.session?.expires_at,
    });
  }

  // POST /auth/reset-password
  if (method === "POST" && sub === "reset-password") {
    const body = await req.json().catch(() => null);
    if (!body?.email) {
      return errorResponse("VALIDATION_ERROR", "Field 'email' is required");
    }
    const { error } = await supabase.auth.resetPasswordForEmail(body.email);
    if (error) return errorResponse("AUTH_ERROR", error.message, 400);
    return successResponse({ message: "Email de recuperacao enviado" });
  }

  // GET /auth/me
  if (method === "GET" && sub === "me") {
    if (!ctx?.userId) {
      const authResult = await authenticate(req, supabaseUrl, serviceKey);
      if (authResult.error) return authResult.error;
      ctx = authResult.ctx;
    }
    if (!ctx?.userId) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, name, phone, availability_status, created_at")
      .eq("id", ctx.userId)
      .single();
    if (error) return errorResponse("NOT_FOUND", "Profile not found", 404);
    return successResponse(profile);
  }

  // PUT /auth/me
  if (method === "PUT" && sub === "me") {
    if (!ctx?.userId) {
      const authResult = await authenticate(req, supabaseUrl, serviceKey);
      if (authResult.error) return authResult.error;
      ctx = authResult.ctx;
    }
    if (!ctx?.userId) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.availability_status !== undefined) updates.availability_status = body.availability_status;

    if (Object.keys(updates).length === 0) {
      return errorResponse("VALIDATION_ERROR", "No fields to update");
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", ctx.userId)
      .select("id, email, name, phone, availability_status, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  return errorResponse("NOT_FOUND", `Unknown auth endpoint: /auth/${sub}`, 404);
}

// ---------------------------------------------------------------------------
// Route: /companies
// ---------------------------------------------------------------------------

async function handleCompanies(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const companyId = pathParts[0];
  const subResource = pathParts[1];
  const subId = pathParts[2];

  // --- Collection endpoints ---

  // GET /companies — list companies for the authenticated user
  if (method === "GET" && pathParts.length === 0) {
    const { data, error } = await supabase
      .from("company_members")
      .select("company_id, role, status, companies(id, name, description, icon, owner_id, created_at)")
      .eq("user_id", ctx.userId)
      .eq("status", "active");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    const companies = (data || []).map((m: Record<string, unknown>) => ({
      ...(m.companies as Record<string, unknown>),
      role: m.role,
    }));
    return successResponse(companies);
  }

  // POST /companies — create a new company
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");

    const { data: company, error } = await supabase
      .from("companies")
      .insert({ name: body.name, description: body.description || null, icon: body.icon || null, owner_id: ctx.userId })
      .select("id, name, description, icon, owner_id, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Add creator as owner member
    await supabase.from("company_members").insert({
      company_id: company.id,
      user_id: ctx.userId,
      role: "owner",
      status: "active",
    });

    return successResponse(company, undefined, 201);
  }

  if (!companyId) return errorResponse("NOT_FOUND", "Company ID required", 404);

  // --- Sub-resource routing ---

  // /companies/:id/members
  if (subResource === "members") {
    return handleCompanyMembers(method, companyId, subId || null, url, req, ctx, supabase);
  }

  // /companies/:id/invites
  if (subResource === "invites") {
    return handleCompanyInvites(method, companyId, subId || null, url, req, ctx, supabase, supabaseUrl, serviceKey);
  }

  // PUT /companies/:id/zapi-token
  if (method === "PUT" && subResource === "zapi-token") {
    const body = await req.json().catch(() => null);
    if (!body?.account_token) return errorResponse("VALIDATION_ERROR", "Field 'account_token' is required");
    const { data, error } = await supabase
      .from("companies")
      .update({
        zapi_account_token: body.account_token,
        zapi_token_status: "configured",
        zapi_token_validated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("id, name, zapi_token_status, zapi_token_validated_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // --- Single company endpoints ---

  // GET /companies/:id
  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, description, icon, owner_id, created_at, zapi_token_status, zapi_token_validated_at")
      .eq("id", companyId)
      .single();
    if (error) return errorResponse("NOT_FOUND", "Company not found", 404);
    return successResponse(data);
  }

  // PUT /companies/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.icon !== undefined) updates.icon = body.icon;

    const { data, error } = await supabase
      .from("companies")
      .update(updates)
      .eq("id", companyId)
      .select("id, name, description, icon, owner_id, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // DELETE /companies/:id
  if (method === "DELETE" && pathParts.length === 1) {
    const { error } = await supabase.from("companies").delete().eq("id", companyId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: companyId, deleted: true });
  }

  return errorResponse("NOT_FOUND", `Unknown companies endpoint`, 404);
}

// --- Company Members sub-handler ---
async function handleCompanyMembers(
  method: string,
  companyId: string,
  userId: string | null,
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
): Promise<Response> {
  // GET /companies/:id/members
  if (method === "GET" && !userId) {
    const { data, error } = await supabase
      .from("company_members")
      .select("id, user_id, role, status, joined_at, profiles!company_members_user_id_fkey(id, email, name, phone)")
      .eq("company_id", companyId)
      .order("joined_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // POST /companies/:id/members — create user directly
  if (method === "POST" && !userId) {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password || !body?.role) {
      return errorResponse("VALIDATION_ERROR", "Fields 'email', 'password', and 'role' are required");
    }

    // Check if user already exists
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", body.email.toLowerCase())
      .single();

    if (existingProfile) {
      // Check if already a member
      const { data: existingMember } = await supabase
        .from("company_members")
        .select("id")
        .eq("company_id", companyId)
        .eq("user_id", existingProfile.id)
        .single();

      if (existingMember) {
        return errorResponse("CONFLICT", "Usuario ja e membro desta empresa", 409);
      }

      // Add existing user
      const { error: memberErr } = await supabase.from("company_members").insert({
        company_id: companyId,
        user_id: existingProfile.id,
        role: body.role,
        invited_by: ctx.userId,
        status: "active",
      });
      if (memberErr) return errorResponse("DB_ERROR", memberErr.message, 500);

      // Add to workspaces if provided
      if (body.workspace_ids?.length) {
        for (const wsId of body.workspace_ids) {
          await supabase.from("workspace_members").insert({
            workspace_id: wsId,
            user_id: existingProfile.id,
            role: body.role === "admin" ? "admin" : "member",
            status: "active",
            invited_by: ctx.userId,
          });
        }
      }

      return successResponse({ user_id: existingProfile.id, is_new_user: false }, undefined, 201);
    }

    // Create new user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: body.email.toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.name || "" },
    });
    if (authErr) return errorResponse("AUTH_ERROR", authErr.message, 500);

    const newUserId = authData.user.id;
    if (body.name) {
      await supabase.from("profiles").update({ name: body.name }).eq("id", newUserId);
    }

    await supabase.from("company_members").insert({
      company_id: companyId,
      user_id: newUserId,
      role: body.role,
      invited_by: ctx.userId,
      status: "active",
    });

    if (body.workspace_ids?.length) {
      for (const wsId of body.workspace_ids) {
        await supabase.from("workspace_members").insert({
          workspace_id: wsId,
          user_id: newUserId,
          role: body.role === "admin" ? "admin" : "member",
          status: "active",
          invited_by: ctx.userId,
        });
      }
    }

    if (body.role === "super_admin") {
      await supabase.from("user_roles").upsert(
        { user_id: newUserId, role: "super_admin" },
        { onConflict: "user_id" },
      );
    }

    return successResponse({ user_id: newUserId, is_new_user: true }, undefined, 201);
  }

  // PUT /companies/:id/members/:userId — change role
  if (method === "PUT" && userId) {
    const body = await req.json().catch(() => null);
    if (!body?.role) return errorResponse("VALIDATION_ERROR", "Field 'role' is required");

    const { data, error } = await supabase
      .from("company_members")
      .update({ role: body.role })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .select("id, user_id, role, status")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Member not found", 404);
    return successResponse(data);
  }

  // DELETE /companies/:id/members/:userId
  if (method === "DELETE" && userId) {
    const { error } = await supabase
      .from("company_members")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", userId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ company_id: companyId, user_id: userId, removed: true });
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported on /companies/:id/members`, 405);
}

// --- Company Invites sub-handler ---
async function handleCompanyInvites(
  method: string,
  companyId: string,
  inviteId: string | null,
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  // GET /companies/:id/invites
  if (method === "GET" && !inviteId) {
    const { data, error } = await supabase
      .from("company_invites")
      .select("id, email, role, status, invitee_name, invitee_phone, workspace_ids, created_at, expires_at")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // POST /companies/:id/invites — send invite (delegates to send-invite-email edge function)
  if (method === "POST" && !inviteId) {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.role) {
      return errorResponse("VALIDATION_ERROR", "Fields 'email' and 'role' are required");
    }

    // Generate invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invite, error } = await supabase
      .from("company_invites")
      .insert({
        company_id: companyId,
        email: body.email.toLowerCase(),
        role: body.role,
        invitee_name: body.name || null,
        invitee_phone: body.phone || null,
        workspace_ids: body.workspace_ids || null,
        token,
        status: "pending",
        created_by: ctx.userId,
        expires_at: expiresAt,
      })
      .select("id, email, role, status, created_at, expires_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Fire-and-forget: call send-invite-email edge function
    const sendClient = adminClient(supabaseUrl, serviceKey);
    sendClient.functions.invoke("send-invite-email", {
      body: {
        inviteId: invite.id,
        email: body.email.toLowerCase(),
        companyId,
        company_id: companyId,
        role: body.role,
        token,
        invitedBy: ctx.userId,
      },
    }).catch((err: Error) => console.error("Failed to send invite email:", err));

    return successResponse(invite, undefined, 201);
  }

  // DELETE /companies/:id/invites/:inviteId — cancel invite
  if (method === "DELETE" && inviteId) {
    const { data, error } = await supabase
      .from("company_invites")
      .update({ status: "cancelled" })
      .eq("id", inviteId)
      .eq("company_id", companyId)
      .select("id, status")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Invite not found", 404);
    return successResponse(data);
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported on /companies/:id/invites`, 405);
}

// ---------------------------------------------------------------------------
// Route: /invites
// ---------------------------------------------------------------------------

async function handleInvites(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  _ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);

  // POST /invites/accept
  if (method === "POST" && pathParts[0] === "accept") {
    const body = await req.json().catch(() => null);
    if (!body?.token) return errorResponse("VALIDATION_ERROR", "Field 'token' is required");

    // Delegate to accept-invite edge function
    const { data, error } = await supabase.functions.invoke("accept-invite", {
      body: { token: body.token },
    });
    if (error) return errorResponse("INVITE_ERROR", error.message || "Failed to accept invite", 400);
    return successResponse(data);
  }

  return errorResponse("NOT_FOUND", "Unknown invites endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /workspaces
// ---------------------------------------------------------------------------

async function handleWorkspaces(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = pathParts[0];
  const subResource = pathParts[1];
  const subId = pathParts[2];

  // GET /workspaces — list workspaces for current user/company
  if (method === "GET" && pathParts.length === 0) {
    const companyId = url.searchParams.get("company_id");
    if (!companyId) {
      return errorResponse("VALIDATION_ERROR", "Query param 'company_id' is required");
    }

    // Check if user is admin/owner of company
    const { data: membership } = await supabase
      .from("company_members")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", ctx.userId)
      .single();

    const isAdmin = membership && (membership.role === "owner" || membership.role === "admin");

    if (isAdmin) {
      // Admin sees all workspaces
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name, description, icon, is_default, company_id, owner_id, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }

    // Member sees only assigned workspaces
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, description, icon, is_default, company_id, owner_id, created_at)")
      .eq("user_id", ctx.userId)
      .eq("status", "active");
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    const workspaces = (data || [])
      .filter((m: Record<string, unknown>) => {
        const ws = m.workspaces as Record<string, unknown> | null;
        return ws && ws.company_id === companyId;
      })
      .map((m: Record<string, unknown>) => m.workspaces);

    return successResponse(workspaces);
  }

  // POST /workspaces — create workspace
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name || !body?.company_id) {
      return errorResponse("VALIDATION_ERROR", "Fields 'name' and 'company_id' are required");
    }

    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        name: body.name,
        description: body.description || null,
        icon: body.icon || null,
        company_id: body.company_id,
        owner_id: ctx.userId,
      })
      .select("id, name, description, icon, is_default, company_id, owner_id, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Add creator as workspace member
    await supabase.from("workspace_members").insert({
      workspace_id: data.id,
      user_id: ctx.userId,
      role: "admin",
      status: "active",
    });

    return successResponse(data, undefined, 201);
  }

  if (!workspaceId) return errorResponse("NOT_FOUND", "Workspace ID required", 404);

  // /workspaces/:id/members
  if (subResource === "members") {
    return handleWorkspaceMembers(method, workspaceId, subId || null, req, ctx, supabase);
  }

  // GET /workspaces/:id
  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, description, icon, is_default, company_id, owner_id, created_at")
      .eq("id", workspaceId)
      .single();
    if (error) return errorResponse("NOT_FOUND", "Workspace not found", 404);
    return successResponse(data);
  }

  // PUT /workspaces/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.icon !== undefined) updates.icon = body.icon;

    const { data, error } = await supabase
      .from("workspaces")
      .update(updates)
      .eq("id", workspaceId)
      .select("id, name, description, icon, is_default, company_id, owner_id, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // DELETE /workspaces/:id
  if (method === "DELETE" && pathParts.length === 1) {
    const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: workspaceId, deleted: true });
  }

  return errorResponse("NOT_FOUND", "Unknown workspaces endpoint", 404);
}

// --- Workspace Members sub-handler ---
async function handleWorkspaceMembers(
  method: string,
  workspaceId: string,
  userId: string | null,
  req: Request,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
): Promise<Response> {
  // GET /workspaces/:id/members
  if (method === "GET" && !userId) {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("id, user_id, role, status, joined_at, profiles!workspace_members_user_id_fkey(id, email, name, phone)")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("joined_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // POST /workspaces/:id/members — add member
  if (method === "POST" && !userId) {
    const body = await req.json().catch(() => null);
    if (!body?.user_id) return errorResponse("VALIDATION_ERROR", "Field 'user_id' is required");

    const { data, error } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: body.user_id,
        role: body.role || "member",
        status: "active",
        invited_by: ctx.userId,
      })
      .select("id, user_id, role, status, joined_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  // DELETE /workspaces/:id/members/:userId
  if (method === "DELETE" && userId) {
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ workspace_id: workspaceId, user_id: userId, removed: true });
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported on /workspaces/:id/members`, 405);
}

// ---------------------------------------------------------------------------
// Route: /agents (unified: agents + agent_instances)
// ---------------------------------------------------------------------------

async function handleAgents(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId;
  if (!workspaceId) {
    return errorResponse("MISSING_WORKSPACE", "X-Workspace-Id header is required", 400);
  }
  const agentId = pathParts[0];
  const subResource = pathParts[1];

  // GET /agents — list all agents (both tables unified)
  if (method === "GET" && pathParts.length === 0) {
    const includeArchived = url.searchParams.get("include_archived") === "true";

    // Query both tables
    let legacyQuery = supabase
      .from("agents")
      .select("id, name, persona_prompt, tone, category, category_id, is_active, is_archived, is_default_for_category, keywords, split_messages, activation_description, template_id, workspace_id, created_at")
      .eq("workspace_id", workspaceId);
    if (!includeArchived) legacyQuery = legacyQuery.neq("is_archived", true);

    let instancesQuery = supabase
      .from("agent_instances")
      .select("id, name, system_prompt, tone, category, category_id, is_active, is_archived, is_default_for_category, keywords, split_messages, activation_description, icon, knowledge_base_id, template_id, is_customized, workspace_id, created_at, updated_at")
      .eq("workspace_id", workspaceId);
    if (!includeArchived) instancesQuery = instancesQuery.neq("is_archived", true);

    const [legacyRes, instancesRes] = await Promise.all([legacyQuery, instancesQuery]);

    const legacy = (legacyRes.data || []).map((a: Record<string, unknown>) => ({
      ...a,
      system_prompt: a.persona_prompt,
      source: "agents",
    }));
    const instances = (instancesRes.data || []).map((a: Record<string, unknown>) => ({
      ...a,
      source: "agent_instances",
    }));

    return successResponse([...instances, ...legacy]);
  }

  // POST /agents/from-template — create agent from template
  if (method === "POST" && agentId === "from-template") {
    const body = await req.json().catch(() => null);
    if (!body?.template_id) return errorResponse("VALIDATION_ERROR", "Field 'template_id' is required");

    const { data: template, error: tErr } = await supabase
      .from("agent_templates")
      .select("*")
      .eq("id", body.template_id)
      .single();
    if (tErr || !template) return errorResponse("NOT_FOUND", "Template not found", 404);

    const { data: instance, error: iErr } = await supabase
      .from("agent_instances")
      .insert({
        workspace_id: workspaceId,
        name: body.name || template.name,
        system_prompt: template.system_prompt,
        tone: template.tone,
        category: template.category,
        icon: template.icon,
        template_id: template.id,
        is_customized: false,
      })
      .select("*")
      .single();
    if (iErr) return errorResponse("DB_ERROR", iErr.message, 500);

    // Increment usage_count on template
    try {
      await supabase.rpc("increment_usage_count" as string, { template_id: template.id });
    } catch {
      // ignore usage count failures
    }

    return successResponse(instance, undefined, 201);
  }

  // POST /agents — create agent (legacy table)
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");

    // Default to agent_instances (new table)
    const { data, error } = await supabase
      .from("agent_instances")
      .insert({
        workspace_id: workspaceId,
        name: body.name,
        system_prompt: body.system_prompt || "",
        tone: body.tone || "professional",
        category: body.category || null,
        category_id: body.category_id || null,
        icon: body.icon || null,
        keywords: body.keywords || null,
        split_messages: body.split_messages ?? true,
        activation_description: body.activation_description || null,
        knowledge_base_id: body.knowledge_base_id || null,
      })
      .select("*")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  if (!agentId) return errorResponse("NOT_FOUND", "Agent ID required", 404);

  // /agents/:id/tools
  if (subResource === "tools") {
    return handleAgentTools(method, agentId, workspaceId, req, supabase);
  }

  // /agents/:id/knowledge-bases
  if (subResource === "knowledge-bases") {
    return handleAgentKnowledgeBases(method, agentId, req, supabase);
  }

  // GET /agents/:id
  if (method === "GET" && pathParts.length === 1) {
    // Try agent_instances first, then legacy agents
    const { data: instance } = await supabase
      .from("agent_instances")
      .select("*")
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .single();
    if (instance) return successResponse({ ...instance, source: "agent_instances" });

    const { data: legacy } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .single();
    if (legacy) return successResponse({ ...legacy, system_prompt: legacy.persona_prompt, source: "agents" });

    return errorResponse("NOT_FOUND", "Agent not found", 404);
  }

  // PUT /agents/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    const updates: Record<string, unknown> = {};
    const fields = ["name", "system_prompt", "tone", "category", "category_id", "is_active", "keywords", "icon", "split_messages", "activation_description", "knowledge_base_id", "is_default_for_category"];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    // Try agent_instances first
    const { data: instance } = await supabase
      .from("agent_instances")
      .update({ ...updates, is_customized: true })
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (instance) return successResponse(instance);

    // Fallback to legacy agents
    const legacyUpdates: Record<string, unknown> = { ...updates };
    if (legacyUpdates.system_prompt !== undefined) {
      legacyUpdates.persona_prompt = legacyUpdates.system_prompt;
      delete legacyUpdates.system_prompt;
    }
    delete legacyUpdates.icon;
    delete legacyUpdates.knowledge_base_id;

    const { data: legacy, error } = await supabase
      .from("agents")
      .update(legacyUpdates)
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error || !legacy) return errorResponse("NOT_FOUND", "Agent not found", 404);
    return successResponse(legacy);
  }

  // DELETE /agents/:id — archive
  if (method === "DELETE" && pathParts.length === 1) {
    // Try agent_instances first
    const { data: inst } = await supabase
      .from("agent_instances")
      .update({ is_archived: true, is_active: false })
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .single();
    if (inst) return successResponse({ id: inst.id, archived: true });

    const { data: leg } = await supabase
      .from("agents")
      .update({ is_archived: true, is_active: false })
      .eq("id", agentId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .single();
    if (leg) return successResponse({ id: leg.id, archived: true });

    return errorResponse("NOT_FOUND", "Agent not found", 404);
  }

  return errorResponse("NOT_FOUND", "Unknown agents endpoint", 404);
}

// --- Agent Tools sub-handler ---
async function handleAgentTools(
  method: string,
  agentId: string,
  workspaceId: string,
  req: Request,
  supabase: ReturnType<typeof adminClient>,
): Promise<Response> {
  // GET /agents/:id/tools
  if (method === "GET") {
    const { data, error } = await supabase
      .from("agent_tools")
      .select("id, agent_id, tool_id, tool_name, is_enabled, config, created_at, tool_catalog(id, name, description, label)")
      .eq("agent_id", agentId)
      .eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // PUT /agents/:id/tools — replace all tools
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body?.tools || !Array.isArray(body.tools)) {
      return errorResponse("VALIDATION_ERROR", "Field 'tools' (array) is required");
    }

    // Delete existing tools
    await supabase.from("agent_tools").delete().eq("agent_id", agentId).eq("workspace_id", workspaceId);

    // Insert new tools
    if (body.tools.length > 0) {
      const rows = body.tools.map((t: { tool_name: string; tool_id?: string; config?: unknown }) => ({
        agent_id: agentId,
        workspace_id: workspaceId,
        tool_name: t.tool_name,
        tool_id: t.tool_id || null,
        config: t.config || null,
        is_enabled: true,
      }));
      const { error } = await supabase.from("agent_tools").insert(rows);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
    }

    // Return updated list
    const { data } = await supabase
      .from("agent_tools")
      .select("id, agent_id, tool_id, tool_name, is_enabled, config, created_at")
      .eq("agent_id", agentId)
      .eq("workspace_id", workspaceId);
    return successResponse(data);
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported on /agents/:id/tools`, 405);
}

// --- Agent Knowledge Bases sub-handler ---
async function handleAgentKnowledgeBases(
  method: string,
  agentId: string,
  req: Request,
  supabase: ReturnType<typeof adminClient>,
): Promise<Response> {
  // GET /agents/:id/knowledge-bases
  if (method === "GET") {
    const { data, error } = await supabase
      .from("agent_knowledge_bases")
      .select("id, agent_id, knowledge_base_id, created_at, knowledge_bases(id, name, description)")
      .eq("agent_id", agentId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // PUT /agents/:id/knowledge-bases — replace all
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body?.knowledge_base_ids || !Array.isArray(body.knowledge_base_ids)) {
      return errorResponse("VALIDATION_ERROR", "Field 'knowledge_base_ids' (array) is required");
    }

    await supabase.from("agent_knowledge_bases").delete().eq("agent_id", agentId);

    if (body.knowledge_base_ids.length > 0) {
      const rows = body.knowledge_base_ids.map((kbId: string) => ({
        agent_id: agentId,
        knowledge_base_id: kbId,
      }));
      const { error } = await supabase.from("agent_knowledge_bases").insert(rows);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
    }

    const { data } = await supabase
      .from("agent_knowledge_bases")
      .select("id, agent_id, knowledge_base_id, created_at, knowledge_bases(id, name, description)")
      .eq("agent_id", agentId);
    return successResponse(data);
  }

  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported on /agents/:id/knowledge-bases`, 405);
}

// ---------------------------------------------------------------------------
// Route: /agent-categories
// ---------------------------------------------------------------------------

async function handleAgentCategories(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const categoryId = pathParts[0];

  // GET /agent-categories
  if (method === "GET" && pathParts.length === 0) {
    const { data, error } = await supabase
      .from("agent_categories")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // POST /agent-categories
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name || !body?.slug) return errorResponse("VALIDATION_ERROR", "Fields 'name' and 'slug' are required");

    const { data, error } = await supabase
      .from("agent_categories")
      .insert({
        workspace_id: workspaceId,
        name: body.name,
        slug: body.slug,
        description: body.description || null,
        icon: body.icon || null,
        color: body.color || null,
      })
      .select("*")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  if (!categoryId) return errorResponse("NOT_FOUND", "Category ID required", 404);

  // PUT /agent-categories/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    const updates: Record<string, unknown> = {};
    for (const f of ["name", "slug", "description", "icon", "color", "is_active"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data, error } = await supabase
      .from("agent_categories")
      .update(updates)
      .eq("id", categoryId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Category not found", 404);
    return successResponse(data);
  }

  // DELETE /agent-categories/:id
  if (method === "DELETE" && pathParts.length === 1) {
    const { error } = await supabase
      .from("agent_categories")
      .delete()
      .eq("id", categoryId)
      .eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: categoryId, deleted: true });
  }

  return errorResponse("NOT_FOUND", "Unknown agent-categories endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /agent-templates (super_admin for write, public for read)
// ---------------------------------------------------------------------------

async function handleAgentTemplates(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const templateId = pathParts[0];
  const isWriteMethod = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

  if (isWriteMethod) {
    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.userId)
      .eq("role", "super_admin")
      .maybeSingle();

    if (!roleCheck) return errorResponse("FORBIDDEN", "Only super_admin can manage templates", 403);
  }

  // GET /agent-templates
  if (method === "GET" && pathParts.length === 0) {
    const category = url.searchParams.get("category");
    let query = supabase
      .from("agent_templates")
      .select("*")
      .eq("is_published", true)
      .order("usage_count", { ascending: false });
    if (category) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // GET /agent-templates/:id
  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase
      .from("agent_templates")
      .select("*")
      .eq("id", templateId)
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Template not found", 404);
    return successResponse(data);
  }

  // POST /agent-templates
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name || !body?.system_prompt || !body?.tone) {
      return errorResponse("VALIDATION_ERROR", "Fields 'name', 'system_prompt', and 'tone' are required");
    }

    const { data, error } = await supabase
      .from("agent_templates")
      .insert({
        name: body.name,
        description: body.description || null,
        system_prompt: body.system_prompt,
        tone: body.tone,
        category: body.category || null,
        icon: body.icon || null,
        is_published: body.is_published ?? true,
        created_by: ctx.userId,
      })
      .select("*")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  if (!templateId) return errorResponse("NOT_FOUND", "Template ID required", 404);

  // PUT /agent-templates/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    const updates: Record<string, unknown> = {};
    for (const f of ["name", "description", "system_prompt", "tone", "category", "icon", "is_published"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data, error } = await supabase
      .from("agent_templates")
      .update(updates)
      .eq("id", templateId)
      .select("*")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Template not found", 404);
    return successResponse(data);
  }

  // DELETE /agent-templates/:id
  if (method === "DELETE" && pathParts.length === 1) {
    const { error } = await supabase.from("agent_templates").delete().eq("id", templateId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: templateId, deleted: true });
  }

  return errorResponse("NOT_FOUND", "Unknown agent-templates endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /inbox
// ---------------------------------------------------------------------------

async function handleInbox(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;

  // /inbox/leads/...
  if (pathParts[0] === "leads") {
    const leadId = pathParts[1];
    const subResource = pathParts[2];
    const subId = pathParts[3];

    // GET /inbox/leads — list leads
    if (method === "GET" && !leadId) {
      const { page, perPage, from, to } = parsePagination(url);
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const sort = url.searchParams.get("sort") || "last_message_at";
      const order = url.searchParams.get("order") === "asc";

      let query = supabase
        .from("leads")
        .select("id, name, phone, status, source, notes, tags, ai_summary, insights, assigned_agent_id, assigned_to_user_id, assigned_at, contact_id, is_test, last_message_at, created_at", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .is("merged_into_lead_id", null);

      if (status) query = query.eq("status", status);
      if (search) {
        const s = search.replace(/[%,()]/g, "");
        query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
      }
      query = query.order(sort, { ascending: order }).range(from, to);

      const { data, error, count } = await query;
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, { page, per_page: perPage, total: count || 0 });
    }

    if (!leadId) return errorResponse("NOT_FOUND", "Lead ID required", 404);

    // GET /inbox/leads/:id/messages
    if (method === "GET" && subResource === "messages") {
      const { page, perPage, from, to } = parsePagination(url);
      const { data, error, count } = await supabase
        .from("messages")
        .select("id, lead_id, content, sender_type, agent_id, responding_agent_id, media_type, media_url, external_message_id, delivery_status, delivered_at, read_at, reply_to_content, reply_to_external_id, reply_to_sender_type, workspace_id, created_at", { count: "exact" })
        .eq("lead_id", leadId)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .range(from, to);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, { page, per_page: perPage, total: count || 0 });
    }

    // POST /inbox/leads/:id/messages — send message (triggers WhatsApp)
    if (method === "POST" && subResource === "messages" && !subId) {
      const body = await req.json().catch(() => null);
      if (!body?.content) return errorResponse("VALIDATION_ERROR", "Field 'content' is required");

      // Insert message
      const { data: msg, error: msgErr } = await supabase
        .from("messages")
        .insert({
          lead_id: leadId,
          workspace_id: workspaceId,
          content: body.content,
          sender_type: "human",
          media_type: body.media_type || null,
          media_url: body.media_url || null,
        })
        .select("id, lead_id, content, sender_type, media_type, media_url, created_at")
        .single();
      if (msgErr) return errorResponse("DB_ERROR", msgErr.message, 500);

      // The DB trigger notify_whatsapp_on_outbound_message will handle sending via WhatsApp
      return successResponse(msg, undefined, 201);
    }

    // POST /inbox/leads/:id/messages/:msgId/transcribe
    if (method === "POST" && subResource === "messages" && pathParts[3] && pathParts[4] === "transcribe") {
      const msgId = pathParts[3];
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { message_id: parseInt(msgId, 10) },
      });
      if (error) return errorResponse("TRANSCRIPTION_ERROR", error.message || "Transcription failed", 500);
      return successResponse(data);
    }

    // PUT /inbox/leads/:id/status
    if (method === "PUT" && subResource === "status") {
      const body = await req.json().catch(() => null);
      if (!body?.status) return errorResponse("VALIDATION_ERROR", "Field 'status' is required");
      const { data, error } = await supabase
        .from("leads")
        .update({ status: body.status })
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .select("id, status")
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    // POST /inbox/leads/:id/assign
    if (method === "POST" && subResource === "assign") {
      const body = await req.json().catch(() => null);
      if (!body?.user_id) return errorResponse("VALIDATION_ERROR", "Field 'user_id' is required");
      const { data, error } = await supabase
        .from("leads")
        .update({
          assigned_to_user_id: body.user_id,
          assigned_at: new Date().toISOString(),
          status: "human_talking",
        })
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .select("id, assigned_to_user_id, assigned_at, status")
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    // POST /inbox/leads/:id/transfer
    if (method === "POST" && subResource === "transfer") {
      const body = await req.json().catch(() => null);
      if (!body?.target_agent_id) return errorResponse("VALIDATION_ERROR", "Field 'target_agent_id' is required");

      // Record transfer
      await supabase.from("agent_transfers").insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        from_agent_id: null,
        to_agent_id: body.target_agent_id,
        reason: body.reason || "API transfer",
      });

      const { data, error } = await supabase
        .from("leads")
        .update({
          assigned_agent_id: body.target_agent_id,
          status: "ai_talking",
        })
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .select("id, assigned_agent_id, status")
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    // POST /inbox/leads/:id/resolve
    if (method === "POST" && subResource === "resolve") {
      const { data, error } = await supabase
        .from("leads")
        .update({ status: "closed" })
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .select("id, status")
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    // GET /inbox/leads/:id — lead detail
    if (method === "GET" && pathParts.length === 2) {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    // PUT /inbox/leads/:id — update lead
    if (method === "PUT" && pathParts.length === 2) {
      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

      const updates: Record<string, unknown> = {};
      for (const f of ["name", "notes", "tags", "status", "assigned_agent_id", "assigned_to_user_id"]) {
        if (body[f] !== undefined) updates[f] = body[f];
      }

      const { data, error } = await supabase
        .from("leads")
        .update(updates)
        .eq("id", leadId)
        .eq("workspace_id", workspaceId)
        .select("*")
        .single();
      if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
      return successResponse(data);
    }

    return errorResponse("NOT_FOUND", "Unknown inbox/leads endpoint", 404);
  }

  // /inbox/queue
  if (pathParts[0] === "queue") {
    // GET /inbox/queue
    if (method === "GET" && pathParts.length === 1) {
      const { data, error } = await supabase
        .from("lead_queues")
        .select("id, lead_id, lead_name, lead_phone, status, priority, agent_id, category_id, assigned_to_user_id, assigned_at, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "waiting")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }

    // POST /inbox/queue/process
    if (method === "POST" && pathParts[1] === "process") {
      // Mark oldest waiting items as processing
      const { data, error } = await supabase
        .from("lead_queues")
        .update({ status: "processing" })
        .eq("workspace_id", workspaceId)
        .eq("status", "waiting")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(10)
        .select("id, lead_id, lead_name, status");
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }
  }

  return errorResponse("NOT_FOUND", "Unknown inbox endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /messages
// ---------------------------------------------------------------------------

async function handleMessages(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;

  // POST /messages/send — send message with automatic channel routing
  if (method === "POST" && pathParts[0] === "send") {
    const body = await req.json().catch(() => null);
    if (!body?.lead_id || !body?.content) {
      return errorResponse("VALIDATION_ERROR", "Fields 'lead_id' and 'content' are required");
    }

    // Insert the message — DB trigger handles WhatsApp routing
    const { data, error } = await supabase
      .from("messages")
      .insert({
        lead_id: body.lead_id,
        workspace_id: workspaceId,
        content: body.content,
        sender_type: "human",
        media_type: body.media_type || null,
        media_url: body.media_url || null,
      })
      .select("id, lead_id, content, sender_type, media_type, media_url, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  // POST /messages/send-media — send media message
  if (method === "POST" && pathParts[0] === "send-media") {
    const body = await req.json().catch(() => null);
    if (!body?.lead_id || !body?.media_url || !body?.media_type) {
      return errorResponse("VALIDATION_ERROR", "Fields 'lead_id', 'media_url', and 'media_type' are required");
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        lead_id: body.lead_id,
        workspace_id: workspaceId,
        content: body.content || "",
        sender_type: "human",
        media_type: body.media_type,
        media_url: body.media_url,
      })
      .select("id, lead_id, content, sender_type, media_type, media_url, created_at")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  return errorResponse("NOT_FOUND", "Unknown messages endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /crm (sub-routes: contacts, pipeline, leads, products, loss-reasons, tags, automove)
// ---------------------------------------------------------------------------

async function handleCrm(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const sub = pathParts[0];

  if (sub === "contacts") return handleCrmContacts(method, pathParts.slice(1), url, req, ctx, supabase, workspaceId, supabaseUrl, serviceKey);
  if (sub === "pipeline") return handleCrmPipeline(method, pathParts.slice(1), url, req, ctx, supabase, workspaceId);
  if (sub === "leads") return handleCrmLeads(method, pathParts.slice(1), url, req, ctx, supabase, workspaceId, supabaseUrl, serviceKey);
  if (sub === "products") return handleCrmProducts(method, pathParts.slice(1), req, supabase, workspaceId);
  if (sub === "loss-reasons") return handleCrmLossReasons(method, pathParts.slice(1), req, supabase, workspaceId);
  if (sub === "contact-sources") return handleCrmContactSources(method, pathParts.slice(1), url, supabase, workspaceId);
  if (sub === "tags") return handleCrmTags(method, pathParts.slice(1), req, supabase, workspaceId);
  if (sub === "automove-rules") return handleCrmAutomoveRules(method, pathParts.slice(1), url, req, supabase, workspaceId);
  if (sub === "automove-log") return handleCrmAutomoveLog(method, url, supabase, workspaceId);
  if (sub === "activities") return handleCrmActivities(method, pathParts.slice(1), url, supabase, workspaceId);
  if (sub === "funnel") return handleCrmFunnel(method, pathParts.slice(1), url, supabase, workspaceId);
  if (sub === "performance") return handleCrmPerformance(method, pathParts.slice(1), url, ctx, supabase, workspaceId);

  return errorResponse("NOT_FOUND", `Unknown CRM sub-route: /crm/${sub}`, 404);
}

// --- CRM Contacts ---
async function handleCrmContacts(
  method: string,
  parts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const contactId = parts[0];
  const subResource = parts[1];

  // GET /crm/contacts
  if (method === "GET" && parts.length === 0) {
    const { page, perPage, from, to } = parsePagination(url);
    const search = url.searchParams.get("search");
    const source = url.searchParams.get("source");
    const sort = url.searchParams.get("sort") || "created_at";
    const order = url.searchParams.get("order") === "asc";

    let query = supabase
      .from("crm_contacts")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .neq("is_active", false);

    if (search) {
      const s = search.replace(/[%,()]/g, "");
      query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
    }
    if (source) query = query.eq("source", source);
    query = query.order(sort, { ascending: order }).range(from, to);

    const { data, error, count } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { page, per_page: perPage, total: count || 0 });
  }

  // POST /crm/contacts/import
  if (method === "POST" && contactId === "import") {
    const body = await req.json().catch(() => null);
    if (!body?.contacts || !Array.isArray(body.contacts)) {
      return errorResponse("VALIDATION_ERROR", "Field 'contacts' (array) is required");
    }
    const rows = body.contacts.map((c: Record<string, unknown>) => ({
      workspace_id: workspaceId,
      name: c.name || "Sem nome",
      phone: c.phone || null,
      email: c.email || null,
      source: c.source || "importacao",
      tags: c.tags || null,
      notes: c.notes || null,
      created_by: ctx.userId,
    }));
    const { data, error } = await supabase.from("crm_contacts").insert(rows).select("id, name, phone");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ imported: data?.length || 0, contacts: data }, undefined, 201);
  }

  // GET /crm/contacts/export
  if (method === "GET" && contactId === "export") {
    const { data, error } = await supabase
      .from("crm_contacts")
      .select("name, phone, email, company, source, tags, notes, dnia_id, created_at")
      .eq("workspace_id", workspaceId)
      .neq("is_active", false)
      .order("created_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Build CSV
    const header = "nome;telefone;email;empresa;origem;tags;notas;dnia_id;criado_em";
    const rows = (data || []).map((c: Record<string, unknown>) => {
      const tags = Array.isArray(c.tags) ? (c.tags as Array<{name: string}>).map(t => t.name).join(",") : "";
      return `${c.name || ""};${c.phone || ""};${c.email || ""};${c.company || ""};${c.source || ""};${tags};${(c.notes || "").toString().replace(/;/g, ",")};${c.dnia_id || ""};${c.created_at || ""}`;
    });
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=contatos.csv",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // POST /crm/contacts/backfill
  if (method === "POST" && contactId === "backfill") {
    const body = await req.json().catch(() => null);
    if (!body?.contact_ids) return errorResponse("VALIDATION_ERROR", "Field 'contact_ids' is required");
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("backfill-contact-data", {
      body: { contact_ids: body.contact_ids, workspace_id: workspaceId },
    });
    if (error) return errorResponse("BACKFILL_ERROR", error.message || "Backfill failed", 500);
    return successResponse(data);
  }

  // POST /crm/contacts/upsert (dedupe por email/telefone na empresa; SOBRESCREVE campos enviados)
  if (method === "POST" && contactId === "upsert") {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    if (!body.phone && !body.email) {
      return errorResponse("VALIDATION_ERROR", "At least one of 'phone' or 'email' is required");
    }

    const normalizePhoneU = (p: unknown): string | null => {
      if (!p) return null;
      let digits = String(p).replace(/\D/g, "");
      if (!digits) return null;
      if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) digits = "55" + digits;
      return digits;
    };

    const phoneNorm = normalizePhoneU(body.phone);
    const emailNorm = body.email ? String(body.email).trim().toLowerCase() : null;

    const { data: wsU } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspaceId)
      .single();
    const companyIdU = (wsU as { company_id?: string } | null)?.company_id;

    // Busca contato existente na empresa (ativo ou inativo)
    let existingU: Record<string, unknown> | null = null;
    if (companyIdU) {
      const { data: companyWorkspacesU } = await supabase
        .from("workspaces").select("id").eq("company_id", companyIdU);
      const wsIdsU = (companyWorkspacesU || []).map((w: { id: string }) => w.id);
      if (wsIdsU.length > 0) {
        const orClausesU: string[] = [];
        if (phoneNorm) orClausesU.push(`phone.eq.${phoneNorm}`);
        if (emailNorm) orClausesU.push(`email.ilike.${emailNorm}`);
        const { data: matchesU } = await supabase
          .from("crm_contacts")
          .select("*")
          .in("workspace_id", wsIdsU)
          .or(orClausesU.join(","))
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1);
        existingU = (matchesU && matchesU.length > 0) ? matchesU[0] as Record<string, unknown> : null;
      }
    }

    // Campos enviados sobrescrevem os atuais
    const payload: Record<string, unknown> = {};
    const setIfDefined = (field: string, value: unknown) => {
      if (value !== undefined) payload[field] = value;
    };
    setIfDefined("name", body.name);
    if (phoneNorm) payload.phone = phoneNorm;
    if (emailNorm) payload.email = emailNorm;
    setIfDefined("company", body.company);
    setIfDefined("job_title", body.job_title ?? body.position);
    setIfDefined("position", body.position ?? body.job_title);
    setIfDefined("employee_count", body.employee_count ?? body.company_size);
    setIfDefined("revenue", body.revenue);
    setIfDefined("notes", body.notes);
    setIfDefined("tags", body.tags);
    setIfDefined("custom_fields", body.custom_fields);

    if (existingU) {
      // "source" (origem) não é alterado após o cadastro; apenas preenchido se vazio
      if (!existingU.source) {
        const normalizedSourceU = await normalizeContactSource(supabase, companyIdU, body.source);
        if (normalizedSourceU) payload.source = normalizedSourceU;
      }
      if (existingU.is_active === false) payload.is_active = true;

      let updatedU = existingU;
      if (Object.keys(payload).length > 0) {
        const { data: updU, error: updErrU } = await supabase
          .from("crm_contacts")
          .update(payload)
          .eq("id", existingU.id as string)
          .select("*")
          .single();
        if (updErrU) return errorResponse("DB_ERROR", updErrU.message, 500);
        updatedU = updU as Record<string, unknown>;
      }
      return successResponse(updatedU, { created: false, updated: true }, 200);
    }

    if (!body.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required to create a new contact");

    const { data: createdU, error: createErrU } = await supabase
      .from("crm_contacts")
      .insert({
        workspace_id: workspaceId,
        ...payload,
        name: body.name,
        source: (await normalizeContactSource(supabase, companyIdU, body.source)) || "manual",
        created_by: ctx.userId,
      })
      .select("*")
      .single();
    if (createErrU) return errorResponse("DB_ERROR", createErrU.message, 500);
    return successResponse(createdU, { created: true, updated: false }, 201);
  }

  // POST /crm/contacts (idempotente: dedupe por email/telefone na empresa)

  if (method === "POST" && parts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");


    // Normaliza telefone (mesma lógica do normalize_phone do banco e src/lib/phone.ts)
    const normalizePhone = (p: unknown): string | null => {
      if (!p) return null;
      let digits = String(p).replace(/\D/g, "");
      if (!digits) return null;
      // Adiciona DDI Brasil (55) se for 10-11 dígitos e não começar com 55
      if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
        digits = "55" + digits;
      }
      return digits;
    };

    const phoneNorm = normalizePhone(body.phone);
    const emailNorm = body.email ? String(body.email).trim().toLowerCase() : null;

    // Descobre company_id do workspace
    const { data: ws } = await supabase
      .from("workspaces")
      .select("company_id")
      .eq("id", workspaceId)
      .single();
    const companyId = (ws as { company_id?: string } | null)?.company_id;

    // Procura contato existente na empresa (ativo OU inativo) por email/telefone
    let existing: Record<string, unknown> | null = null;
    if (companyId && (phoneNorm || emailNorm)) {
      // Lista workspaces da empresa
      const { data: companyWorkspaces } = await supabase
        .from("workspaces")
        .select("id")
        .eq("company_id", companyId);
      const wsIds = (companyWorkspaces || []).map((w: { id: string }) => w.id);

      if (wsIds.length > 0) {
        const orClauses: string[] = [];
        if (phoneNorm) orClauses.push(`phone.eq.${phoneNorm}`);
        if (emailNorm) orClauses.push(`email.ilike.${emailNorm}`);

        const { data: matches } = await supabase
          .from("crm_contacts")
          .select("*")
          .in("workspace_id", wsIds)
          .or(orClauses.join(","))
          .order("is_active", { ascending: false }) // prefere ativos
          .order("created_at", { ascending: true })
          .limit(1);
        existing = (matches && matches.length > 0) ? matches[0] as Record<string, unknown> : null;
      }
    }

    if (existing) {
      // Atualiza campos vazios (não-destrutivo) e reativa se necessário
      const updates: Record<string, unknown> = {};
      const fillIfEmpty = (field: string, value: unknown) => {
        if (value && !existing![field]) updates[field] = value;
      };
      fillIfEmpty("name", body.name);
      fillIfEmpty("phone", phoneNorm);
      fillIfEmpty("email", emailNorm);
      fillIfEmpty("company", body.company);
      fillIfEmpty("job_title", body.job_title ?? body.position);
      fillIfEmpty("position", body.position ?? body.job_title);
      fillIfEmpty("employee_count", body.employee_count ?? body.company_size);
      fillIfEmpty("revenue", body.revenue);
      fillIfEmpty("notes", body.notes);
      const normalizedSourceDedup = await normalizeContactSource(supabase, companyId, body.source);
      if (normalizedSourceDedup && !existing.source) updates.source = normalizedSourceDedup;

      if (existing.is_active === false) updates.is_active = true;

      let updated = existing;
      if (Object.keys(updates).length > 0) {
        const { data: upd, error: updErr } = await supabase
          .from("crm_contacts")
          .update(updates)
          .eq("id", existing.id as string)
          .select("*")
          .single();
        if (updErr) return errorResponse("DB_ERROR", updErr.message, 500);
        updated = upd as Record<string, unknown>;
      }

      // Reaponta card aberto existente (em qualquer contato deduplicado) para este contato no workspace atual
      if (companyId) {
        const { data: companyWorkspaces2 } = await supabase
          .from("workspaces").select("id").eq("company_id", companyId);
        const wsIds2 = (companyWorkspaces2 || []).map((w: { id: string }) => w.id);
        const dupOrClauses: string[] = [];
        if (phoneNorm) dupOrClauses.push(`phone.eq.${phoneNorm}`);
        if (emailNorm) dupOrClauses.push(`email.ilike.${emailNorm}`);
        const { data: dupContacts } = await supabase
          .from("crm_contacts")
          .select("id")
          .in("workspace_id", wsIds2)
          .or(dupOrClauses.join(","))
          .neq("id", updated.id as string);
        const dupIds = (dupContacts || []).map((c: { id: string }) => c.id);

        if (dupIds.length > 0) {
          // Tenta reapontar leads abertos vinculados a contatos duplicados, mas apenas se NÃO houver lead aberto já apontando para updated.id no mesmo workspace
          const { data: alreadyOpen } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("contact_id", updated.id as string)
            .eq("workspace_id", workspaceId)
            .eq("status", "open")
            .limit(1);

          if (!alreadyOpen || alreadyOpen.length === 0) {
            const { data: openDupLeads } = await supabase
              .from("crm_leads")
              .select("id")
              .in("contact_id", dupIds)
              .eq("workspace_id", workspaceId)
              .eq("status", "open")
              .order("created_at", { ascending: true })
              .limit(1);

            if (openDupLeads && openDupLeads.length > 0) {
              await supabase
                .from("crm_leads")
                .update({ contact_id: updated.id })
                .eq("id", (openDupLeads[0] as { id: string }).id);
            }
          }
        }
      }

      return successResponse(updated, { reused: true }, 200);
    }

    // Não encontrou: cria novo (com telefone normalizado)
    const { data, error } = await supabase
      .from("crm_contacts")
      .insert({
        workspace_id: workspaceId,
        name: body.name,
        phone: phoneNorm,
        email: emailNorm,
        company: body.company || null,
        source: (await normalizeContactSource(supabase, companyId, body.source)) || "manual",
        tags: body.tags || null,
        notes: body.notes || null,
        job_title: body.job_title || body.position || null,
        position: body.position || body.job_title || null,
        employee_count: body.employee_count ?? body.company_size ?? null,
        revenue: body.revenue || null,
        created_by: ctx.userId,

      })
      .select("*")
      .single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  if (!contactId) return errorResponse("NOT_FOUND", "Contact ID required", 404);

  // PUT /crm/contacts/:id/tags
  if (method === "PUT" && subResource === "tags") {
    const body = await req.json().catch(() => null);
    if (!body || body.tags === undefined) return errorResponse("VALIDATION_ERROR", "Field 'tags' is required");
    const { data, error } = await supabase
      .from("crm_contacts")
      .update({ tags: body.tags })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .select("id, tags")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Contact not found", 404);
    return successResponse(data);
  }

  // PUT /crm/contacts/:id/opt-out
  if (method === "PUT" && subResource === "opt-out") {
    const body = await req.json().catch(() => null);
    const isOptedOut = body?.is_opted_out ?? true;
    const { data, error } = await supabase
      .from("crm_contacts")
      .update({ opted_out: isOptedOut, opted_out_at: isOptedOut ? new Date().toISOString() : null })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .select("id, opted_out, opted_out_at")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Contact not found", 404);
    return successResponse(data);
  }

  // GET /crm/contacts/:id
  if (method === "GET" && parts.length === 1) {
    const { data, error } = await supabase.from("crm_contacts").select("*").eq("id", contactId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Contact not found", 404);
    return successResponse(data);
  }

  // PUT /crm/contacts/:id
  if (method === "PUT" && parts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    // Alias: company_size -> employee_count
    if (body.company_size !== undefined && body.employee_count === undefined) body.employee_count = body.company_size;
    // NOTE: "source" (origem) é definido apenas no cadastro do lead/contato e NÃO pode ser editado depois.
    for (const f of ["name", "phone", "email", "company", "tags", "notes", "job_title", "position", "employee_count", "revenue", "custom_fields", "status"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data, error } = await supabase.from("crm_contacts").update(updates).eq("id", contactId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Contact not found", 404);
    return successResponse(data);
  }

  // DELETE /crm/contacts/:id (soft delete)
  if (method === "DELETE" && parts.length === 1) {
    const { data, error } = await supabase.from("crm_contacts").update({ is_active: false }).eq("id", contactId).eq("workspace_id", workspaceId).select("id").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Contact not found", 404);
    return successResponse({ id: data.id, deleted: true });
  }

  return errorResponse("NOT_FOUND", "Unknown CRM contacts endpoint", 404);
}

// --- CRM Pipeline Stages ---
async function handleCrmPipeline(
  method: string,
  parts: string[],
  _url: URL,
  req: Request,
  _ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
): Promise<Response> {
  // /crm/pipeline/stages/...
  if (parts[0] !== "stages") return errorResponse("NOT_FOUND", "Use /crm/pipeline/stages", 404);
  const stageId = parts[1];

  // GET /crm/pipeline/stages
  if (method === "GET" && !stageId) {
    const { data, error } = await supabase.from("crm_pipeline_stages").select("*").eq("workspace_id", workspaceId).order("position", { ascending: true });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // POST /crm/pipeline/stages
  if (method === "POST" && !stageId) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data: maxPos } = await supabase.from("crm_pipeline_stages").select("position").eq("workspace_id", workspaceId).order("position", { ascending: false }).limit(1).single();
    const nextPos = ((maxPos?.position as number) || 0) + 1;
    const { data, error } = await supabase.from("crm_pipeline_stages").insert({
      workspace_id: workspaceId, name: body.name, color: body.color || null,
      description: body.description || null, is_default: body.is_default || false,
      order: nextPos, position: nextPos,
    }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  // PUT /crm/pipeline/stages/reorder
  if (method === "PUT" && stageId === "reorder") {
    const body = await req.json().catch(() => null);
    if (!body?.stage_ids || !Array.isArray(body.stage_ids)) return errorResponse("VALIDATION_ERROR", "Field 'stage_ids' (array) is required");
    for (let i = 0; i < body.stage_ids.length; i++) {
      await supabase.from("crm_pipeline_stages").update({ position: i + 1, order: i + 1 }).eq("id", body.stage_ids[i]).eq("workspace_id", workspaceId);
    }
    const { data } = await supabase.from("crm_pipeline_stages").select("*").eq("workspace_id", workspaceId).order("position", { ascending: true });
    return successResponse(data);
  }

  if (!stageId) return errorResponse("NOT_FOUND", "Stage ID required", 404);

  // GET /crm/pipeline/stages/:id/leads?mode=current|period&start_date=&end_date=&status=
  // Lists leads in a stage. mode=current → open leads currently in stage.
  // mode=period → leads that entered the stage during [start_date, end_date) via crm_lead_history.
  if (method === "GET" && parts[2] === "leads") {
    const mode = (_url.searchParams.get("mode") || "current").toLowerCase();
    const statusFilter = _url.searchParams.get("status");
    const startDate = _url.searchParams.get("start_date") || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = _url.searchParams.get("end_date") || new Date().toISOString();
    const { page, perPage, from, to } = parsePagination(_url);

    let leadIds: string[] = [];
    const dateMap = new Map<string, string>();

    if (mode === "period") {
      // Get all lead_ids that entered this stage in window
      const { data: hist, error: hErr } = await supabase
        .from("crm_lead_history")
        .select("lead_id, created_at, crm_leads!inner(workspace_id)")
        .eq("crm_leads.workspace_id", workspaceId)
        .eq("to_stage_id", stageId)
        .gte("created_at", startDate)
        .lt("created_at", endDate)
        .order("created_at", { ascending: false })
        .limit(10000);
      if (hErr) return errorResponse("DB_ERROR", hErr.message, 500);
      for (const h of (hist || []) as Array<{ lead_id: string; created_at: string }>) {
        if (!dateMap.has(h.lead_id)) dateMap.set(h.lead_id, h.created_at);
      }
      leadIds = [...dateMap.keys()];
    } else {
      // current snapshot
      let q = supabase.from("crm_leads")
        .select("id, crm_contacts!inner(id)")
        .eq("workspace_id", workspaceId)
        .eq("stage_id", stageId)
        .is("deleted_at", null);
      if (statusFilter) q = q.eq("status", statusFilter);
      else q = q.eq("status", "open");
      const { data, error } = await q.order("created_at", { ascending: false }).limit(10000);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      leadIds = ((data || []) as Array<{ id: string }>).map((l) => l.id);
    }

    const total = leadIds.length;
    const pageIds = leadIds.slice(from, to + 1);
    if (pageIds.length === 0) {
      return successResponse([], { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) });
    }

    const { data: leads, error: lErr } = await supabase
      .from("crm_leads")
      .select("id, title, status, value, created_at, moved_at, closed_at, stage_id, contact_id, assigned_to, utm_source, utm_campaign, crm_contacts(id, name, phone, email, company)")
      .in("id", pageIds);
    if (lErr) return errorResponse("DB_ERROR", lErr.message, 500);

    // Preserve order from leadIds
    const map = new Map((leads || []).map((l: any) => [l.id, l]));
    const ordered = pageIds.map((id) => {
      const l = map.get(id);
      if (!l) return null;
      return { ...l, entered_stage_at: dateMap.get(id) || null };
    }).filter(Boolean);

    return successResponse(ordered, {
      page, per_page: perPage, total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
      mode, stage_id: stageId,
    });
  }

  // PUT /crm/pipeline/stages/:id
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "color", "description", "is_default"]) { if (body[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("crm_pipeline_stages").update(updates).eq("id", stageId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Stage not found", 404);
    return successResponse(data);
  }

  // DELETE /crm/pipeline/stages/:id
  if (method === "DELETE") {
    const { error } = await supabase.from("crm_pipeline_stages").delete().eq("id", stageId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: stageId, deleted: true });
  }

  return errorResponse("NOT_FOUND", "Unknown pipeline endpoint", 404);
}

// --- CRM Leads ---
// --- Tag merge helper for lead endpoints ---
const TAG_COLOR_PALETTE = [
  "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B",
  "#14B8A6", "#EF4444", "#64748B", "#A855F7", "#6B7280",
];
function defaultTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

function validateTagsInput(raw: unknown): { ok: true; names: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, names: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Field 'tags' must be an array of strings" };
  if (raw.length > 20) return { ok: false, error: "Field 'tags' supports at most 20 items per request" };
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: "Each tag must be a string" };
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > 50) return { ok: false, error: "Tag name must be at most 50 characters" };
    names.push(trimmed);
  }
  return { ok: true, names };
}

async function applyTagsToLeadContact(
  supabase: ReturnType<typeof adminClient>,
  leadId: string,
  workspaceId: string,
  tagNames: string[],
): Promise<{ created: string[]; skipped: string[]; warning?: string }> {
  if (tagNames.length === 0) return { created: [], skipped: [] };

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("contact_id")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!lead?.contact_id) {
    return { created: [], skipped: [], warning: "Lead has no linked contact; tags were not applied" };
  }

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("tags")
    .eq("id", lead.contact_id)
    .single();

  const current: Array<{ name: string; color: string }> = Array.isArray(contact?.tags)
    ? (contact!.tags as Array<{ name: string; color: string }>).filter(
        (t) => t && typeof t.name === "string" && typeof t.color === "string",
      )
    : [];

  const existingByLower = new Map(current.map((t) => [t.name.toLowerCase(), t]));
  const created: string[] = [];
  const skipped: string[] = [];
  const seenInBatch = new Set<string>();

  for (const name of tagNames) {
    const key = name.toLowerCase();
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    if (existingByLower.has(key)) {
      skipped.push(existingByLower.get(key)!.name);
    } else {
      const newTag = { name, color: defaultTagColor(name) };
      current.push(newTag);
      existingByLower.set(key, newTag);
      created.push(name);
    }
  }

  if (created.length > 0) {
    await supabase
      .from("crm_contacts")
      .update({ tags: current })
      .eq("id", lead.contact_id);
  }

  return { created, skipped };
}

// --- Origem / Canal / UTMs / Nota helpers (POST, PUT e UPSERT de cards) ---
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

/**
 * Monta os campos de UTM/canal a partir do body.
 * Aceita `utm_source`... na raiz e `channel` como alias de `utm_source` (é o campo exibido como "Canal" no card).
 */
function buildUtmUpdates(body: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const norm = (v: unknown): string | null => {
    if (v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  for (const f of UTM_FIELDS) {
    const raw = body[f];
    if (raw !== undefined) out[f] = norm(raw);
  }
  if (out.utm_source === undefined && body.channel !== undefined) {
    out.utm_source = norm(body.channel);
  }
  return out;
}

/**
 * Valida a origem informada contra as origens ativas da empresa
 * (/settings/company > "Origens do Lead"). Valores fora da lista
 * não bloqueiam o cadastro: viram "Não identificado" com aviso.
 */
async function resolveLeadSource(
  supabase: ReturnType<typeof adminClient>,
  companyId: string | null | undefined,
  raw: unknown,
): Promise<{ value: string | null; warning: string | null }> {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { value: null, warning: null };
  const requested = String(raw).trim();
  const { data: allowedRows } = await supabase
    .from("crm_contact_sources")
    .select("name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const allowed = (allowedRows ?? []).map((r: { name: string }) => r.name);
  const match = allowed.find((n) => n.toLowerCase() === requested.toLowerCase());
  if (match) return { value: match, warning: null };
  return {
    value: "Não identificado",
    warning: `Origem "${requested}" não está cadastrada em "Origens do Lead"; registrada como "Não identificado".`,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normaliza para comparacao: minusculas e sem acentos. */
function normalizeCompare(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Resolve o segmento do card contra o catálogo do workspace
 * (/settings/company > "Segmentos"). Aceita `segment` (nome ou UUID) ou `segment_id`.
 * Valores fora do catálogo caem no segmento marcado como padrão, com aviso.
 */
async function resolveLeadSegment(
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<{ provided: boolean; value: string | null; name: string | null; warning: string | null }> {
  const raw = body.segment_id !== undefined ? body.segment_id : body.segment;
  if (raw === undefined) return { provided: false, value: null, name: null, warning: null };
  if (raw === null || String(raw).trim() === "") {
    return { provided: true, value: null, name: null, warning: null };
  }
  const requested = String(raw).trim();

  const { data: rows } = await supabase
    .from("crm_segments")
    .select("id, name, is_active, is_default")
    .eq("workspace_id", workspaceId);
  const segments = (rows ?? []) as Array<{ id: string; name: string; is_active: boolean; is_default: boolean }>;

  const match = UUID_RE.test(requested)
    ? segments.find((s) => s.id === requested && s.is_active)
    : segments.find((s) => s.is_active && normalizeCompare(s.name) === normalizeCompare(requested));
  if (match) return { provided: true, value: match.id, name: match.name, warning: null };

  const fallback = segments.find((s) => s.is_default);
  if (fallback) {
    return {
      provided: true,
      value: fallback.id,
      name: fallback.name,
      warning: `Segmento "${requested}" não está cadastrado; registrado como "${fallback.name}" (padrão).`,
    };
  }
  return {
    provided: true,
    value: null,
    name: null,
    warning: `Segmento "${requested}" não está cadastrado e não há segmento padrão definido; campo não preenchido.`,
  };
}


function validateNoteInput(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, error: "Field 'note' must be a string" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, note: null };
  if (trimmed.length > 5000) return { ok: false, error: "Field 'note' must be at most 5000 characters" };
  return { ok: true, note: trimmed };
}

/** Registra uma nota na timeline do card (mesma estrutura da UI: crm_lead_history.action = 'note'). */
async function addLeadNote(
  supabase: ReturnType<typeof adminClient>,
  leadId: string,
  userId: string | null | undefined,
  note: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from("crm_lead_history").insert({
    lead_id: leadId,
    action: "note",
    notes: note,
    created_by: userId || null,
    moved_by: userId || "api",
  }).select("id").single();
  if (error) {
    console.error("[api-gateway] addLeadNote error:", error.message);
    return null;
  }
  return data as { id: string };
}

/** Aplica origem no contato do lead (origem é definida apenas quando ainda não existe). */
async function applySourceToContact(
  supabase: ReturnType<typeof adminClient>,
  contactId: string | null | undefined,
  sourceValue: string | null,
): Promise<void> {
  if (!contactId || !sourceValue) return;
  const { data: c } = await supabase.from("crm_contacts").select("source").eq("id", contactId).maybeSingle();
  if (c && !c.source) {
    await supabase.from("crm_contacts").update({ source: sourceValue }).eq("id", contactId);
  }
}



async function handleCrmLeads(

  method: string,
  parts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const leadId = parts[0];
  const subResource = parts[1];
  const subId = parts[2];
  // GET /crm/leads/without-appointment
  // Returns leads (default: MQL stage, open status) whose contact has no future, non-cancelled appointment.
  // Query params:
  //   stage_id           — UUID da etapa (opcional). Se omitido, tenta encontrar "MQL - Reunião agendada" por nome.
  //   status             — default "open"
  //   include_past       — "true" para considerar leads SEM nenhum agendamento (passado ou futuro). Default: só conta agendamentos futuros não cancelados.
  //   include_incomplete_contacts — mesmo comportamento do /crm/leads
  if (method === "GET" && parts[0] === "without-appointment") {
    let stageId = url.searchParams.get("stage_id");
    const statusParam = url.searchParams.get("status") || "open";
    const includePast = url.searchParams.get("include_past") === "true";
    const includeIncompleteContacts = url.searchParams.get("include_incomplete_contacts") === "true";

    // Auto-resolve MQL stage if not provided
    if (!stageId) {
      const { data: stage } = await supabase.from("crm_pipeline_stages")
        .select("id, name").eq("workspace_id", workspaceId)
        .ilike("name", "%MQL%Reuni%agendada%").maybeSingle();
      if (!stage) return errorResponse("NOT_FOUND", "stage_id não informado e etapa MQL não encontrada por nome. Passe ?stage_id=<uuid>.", 404);
      stageId = stage.id;
    }

    // Fetch all leads in the stage (apply pipeline filters)
    let leadsQuery = supabase.from("crm_leads")
      .select("id, title, contact_id, value, created_at, moved_at, assigned_to, crm_contacts!inner(id, name, phone, email, is_active)")
      .eq("workspace_id", workspaceId)
      .eq("stage_id", stageId)
      .eq("status", statusParam)
      .is("deleted_at", null);

    if (!includeIncompleteContacts) {
      leadsQuery = leadsQuery
        .not("crm_contacts.name", "is", null)
        .not("crm_contacts.name", "in", '("Visitante Widget","Visitante","Contato","Anônimo","Lead")')
        .or("email.not.is.null,phone.not.is.null", { foreignTable: "crm_contacts" });
    }

    const { data: leads, error: leadsErr } = await leadsQuery;
    if (leadsErr) return errorResponse("DB_ERROR", leadsErr.message, 500);
    const leadList = leads || [];
    if (leadList.length === 0) {
      return successResponse({ stage_id: stageId, total: 0, leads: [] });
    }

    const contactIds = Array.from(new Set(leadList.map((l: any) => l.contact_id).filter(Boolean)));

    // Fetch appointments for those contacts
    let apptQuery = supabase.from("crm_appointments")
      .select("contact_id, start_time, status")
      .eq("workspace_id", workspaceId)
      .in("contact_id", contactIds)
      .neq("status", "cancelled");
    if (!includePast) {
      apptQuery = apptQuery.gte("start_time", new Date().toISOString());
    }
    const { data: appts, error: apptErr } = await apptQuery;
    if (apptErr) return errorResponse("DB_ERROR", apptErr.message, 500);

    const contactsWithAppt = new Set((appts || []).map((a: any) => a.contact_id));
    const without = leadList.filter((l: any) => !contactsWithAppt.has(l.contact_id));

    return successResponse({
      stage_id: stageId,
      criteria: includePast ? "no_appointment_ever" : "no_future_appointment",
      total_in_stage: leadList.length,
      total_without_appointment: without.length,
      leads: without.map((l: any) => ({
        id: l.id,
        title: l.title,
        contact_id: l.contact_id,
        contact_name: l.crm_contacts?.name,
        contact_phone: l.crm_contacts?.phone,
        contact_email: l.crm_contacts?.email,
        value: l.value,
        assigned_to: l.assigned_to,
        moved_at: l.moved_at,
        created_at: l.created_at,
      })),
    });
  }

  // GET /crm/leads

  if (method === "GET" && parts.length === 0) {
    const { page, perPage, from, to } = parsePagination(url);
    const stageId = url.searchParams.get("stage_id");
    const search = url.searchParams.get("search");
    const assignedTo = url.searchParams.get("assigned_to");
    const productId = url.searchParams.get("product_id");
    const utmSource = url.searchParams.get("utm_source") || url.searchParams.get("channel");
    const utmMedium = url.searchParams.get("utm_medium");
    const utmCampaign = url.searchParams.get("utm_campaign");
    const contactSource = url.searchParams.get("source");
    const sort = url.searchParams.get("sort") || "created_at";
    const order = url.searchParams.get("order") === "asc";

    const statusParam = url.searchParams.get("status");
    const includeDeleted = url.searchParams.get("include_deleted") === "true";
    const excludeInactiveContacts = url.searchParams.get("exclude_inactive_contacts") === "true";
    // Default mirrors the Pipeline UI: hide leads without a name, with a generic name,
    // or with no contact channel (email AND phone null). Opt-out via include_incomplete_contacts=true.
    const includeIncompleteContacts = url.searchParams.get("include_incomplete_contacts") === "true";

    // Default mirrors the Pipeline UI: require a linked contact, but keep valid stage cards even when the contact is inactive.
    // Callers that explicitly need only active contacts can opt in with exclude_inactive_contacts=true.
    const contactsJoin = "crm_contacts!inner(id, name, phone, email, source, tags, is_active)";


    let query = supabase.from("crm_leads")
      .select(`*, ${contactsJoin}, crm_pipeline_stages(id, name, color), crm_products(id, name)`, { count: "exact" })
      .eq("workspace_id", workspaceId);

    if (excludeInactiveContacts) {
      query = query.eq("crm_contacts.is_active", true);
    }

    if (!includeIncompleteContacts) {
      // Same gates as src/pages/CRMPipeline.tsx filteredLeads:
      // 1) name not null, 2) name not in generic list, 3) email OR phone present
      query = query
        .not("crm_contacts.name", "is", null)
        .not("crm_contacts.name", "in", '("Visitante Widget","Visitante","Contato","Anônimo","Lead")')
        .or("email.not.is.null,phone.not.is.null", { foreignTable: "crm_contacts" });
    }

    // Default: hide soft-deleted records (caller can opt-in with include_deleted=true)
    if (!includeDeleted) query = query.is("deleted_at", null);
    // Optional status filter (e.g. open, won, lost)
    if (statusParam) query = query.eq("status", statusParam);

    if (stageId) query = query.eq("stage_id", stageId);
    if (search) {
      const s = search.replace(/[%,()]/g, "");
      query = query.or(`title.ilike.%${s}%`);
    }
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
    if (productId) query = query.eq("product_id", productId);
    if (utmSource) query = query.eq("utm_source", utmSource);
    if (utmMedium) query = query.eq("utm_medium", utmMedium);
    if (utmCampaign) query = query.eq("utm_campaign", utmCampaign);
    if (contactSource) query = query.eq("crm_contacts.source", contactSource);
    query = query.order(sort, { ascending: order }).range(from, to);

    const { data, error, count } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { page, per_page: perPage, total: count || 0 });
  }

  // POST /crm/leads
  if (method === "POST" && parts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    return await createLeadFromBody(body, ctx, supabase, workspaceId);
  }

  // POST /crm/leads/upsert
  // Atualiza o card existente (por lead_id/id, ou pelo card aberto do contact_id) ou cria um novo.
  if (method === "POST" && parts.length === 1 && parts[0] === "upsert") {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    let targetId: string | null = (body.lead_id || body.id || null) as string | null;
    if (targetId) {
      const { data: found } = await supabase
        .from("crm_leads").select("id").eq("id", targetId).eq("workspace_id", workspaceId).maybeSingle();
      if (!found) return errorResponse("NOT_FOUND", "Lead not found", 404);
    } else if (body.contact_id) {
      const { data: openLead } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("contact_id", body.contact_id)
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      targetId = (openLead as { id: string } | null)?.id || null;
    }

    if (targetId) return await updateLeadFromBody(targetId, body, ctx, supabase, workspaceId);
    return await createLeadFromBody(body, ctx, supabase, workspaceId);
  }


  if (!leadId) return errorResponse("NOT_FOUND", "Lead ID required", 404);

  // GET /crm/leads/:id/history
  if (method === "GET" && subResource === "history") {
    const { data, error } = await supabase.from("crm_lead_history")
      .select("*, from_stage:crm_pipeline_stages!crm_lead_history_from_stage_id_fkey(id, name), to_stage:crm_pipeline_stages!crm_lead_history_to_stage_id_fkey(id, name)")
      .eq("lead_id", leadId).order("created_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    const rows = (data || []) as Record<string, unknown>[];
    // created_by references auth.users (not profiles) — resolve names in a separate query.
    const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
    let profileMap: Record<string, { id: string; name: string | null }> = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, name").in("id", userIds);
      profileMap = Object.fromEntries((profs || []).map((p: { id: string; name: string | null }) => [p.id, p]));
    }
    return successResponse(rows.map((r) => ({
      ...r,
      created_by_profile: r.created_by ? (profileMap[r.created_by as string] || null) : null,
    })));
  }


  // GET /crm/leads/:id/activities  (supports ?include=call,meeting,transcript)
  if (method === "GET" && subResource === "activities") {
    const { data, error } = await supabase.from("crm_lead_activities").select("*").eq("lead_id", leadId).eq("workspace_id", workspaceId).order("scheduled_at", { ascending: true });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    const enriched = await enrichActivities(supabase, workspaceId, (data || []) as ActivityRow[], url);
    return successResponse(enriched);
  }

  // POST /crm/leads/:id/activities
  if (method === "POST" && subResource === "activities" && !subId) {
    const body = await req.json().catch(() => null);
    if (!body?.title || !body?.type || !body?.scheduled_at) return errorResponse("VALIDATION_ERROR", "Fields 'title', 'type', and 'scheduled_at' are required");
    const { data, error } = await supabase.from("crm_lead_activities").insert({
      lead_id: leadId, workspace_id: workspaceId, title: body.title, type: body.type,
      description: body.description || null, scheduled_at: body.scheduled_at,
      assigned_to: body.assigned_to || null, created_by: ctx.userId,
    }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Fire-and-forget: notify dnMarketing
    (async () => {
      try {
        const { data: lead } = await supabase.from("crm_leads").select("contact_id, value, workspace_id").eq("id", leadId).single();
        if (!lead?.contact_id) return;
        const { data: contact } = await supabase.from("crm_contacts").select("dnia_id").eq("id", lead.contact_id).single();
        if (!contact?.dnia_id) return;
        const companyId = await resolveCompanyId(supabase, { workspaceId: lead.workspace_id });
        await notifyDnMarketing(supabase, companyId, {
          dnia_id: contact.dnia_id,
          event_type: "opportunity_created",
          title: data.title,
          metadata: { activity_type: data.type, lead_id: leadId, due_date: data.scheduled_at },
        });
      } catch (e) { console.error("[dnMarketing] activity notify error:", e); }
    })();

    return successResponse(data, undefined, 201);
  }

  // PUT /crm/leads/:id/activities/:actId
  if (method === "PUT" && subResource === "activities" && subId) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    for (const f of ["title", "type", "description", "scheduled_at", "status", "assigned_to", "completed_at", "duration_minutes"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    const { data, error } = await supabase.from("crm_lead_activities").update(updates).eq("id", subId).eq("lead_id", leadId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Activity not found", 404);
    return successResponse(data);
  }

  // GET /crm/leads/:id/psychology
  if (method === "GET" && subResource === "psychology") {
    const { data, error } = await supabase.from("crm_lead_psychology").select("*").eq("lead_id", leadId).single();
    if (error) return errorResponse("NOT_FOUND", "Psychology data not found", 404);
    return successResponse(data);
  }

  // POST /crm/leads/:id/psychology/analyze
  if (method === "POST" && subResource === "psychology" && parts[2] === "analyze") {
    const sendClient = adminClient(supabaseUrl, serviceKey);
    // A edge function espera camelCase — snake_case aqui fazia o endpoint sempre retornar 400
    const { data, error } = await sendClient.functions.invoke("analyze-lead-psychology", {
      body: { leadId, workspaceId },
    });
    if (error) return errorResponse("ANALYSIS_ERROR", error.message || "Psychology analysis failed", 500);
    return successResponse(data);
  }

  // PUT /crm/leads/:id/stage
  if (method === "PUT" && subResource === "stage") {
    const body = await req.json().catch(() => null);
    if (!body?.stage_id) return errorResponse("VALIDATION_ERROR", "Field 'stage_id' is required");

    const tagsParsed = validateTagsInput(body.tags);
    if (!tagsParsed.ok) return errorResponse("VALIDATION_ERROR", tagsParsed.error);

    // Get current stage + status for history and reactivation logic
    const { data: currentLead } = await supabase.from("crm_leads").select("stage_id, status").eq("id", leadId).single();

    const updates: Record<string, unknown> = { stage_id: body.stage_id, moved_at: new Date().toISOString() };
    if (body.loss_reason_id) updates.loss_reason_id = body.loss_reason_id;

    // Reativação automática: se o lead estava perdido/ganho e recebeu uma movimentação,
    // reabre o card limpando status, closed_at e loss_reason_id.
    const wasClosed = currentLead?.status === "lost" || currentLead?.status === "won";
    if (wasClosed) {
      updates.status = "open";
      updates.closed_at = null;
      if (!body.loss_reason_id) updates.loss_reason_id = null;
    }

    const { data, error } = await supabase.from("crm_leads").update(updates).eq("id", leadId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);

    // Record history
    await supabase.from("crm_lead_history").insert({
      lead_id: leadId, from_stage_id: currentLead?.stage_id || null,
      to_stage_id: body.stage_id, moved_by: ctx.userId!, action: wasClosed ? "reactivated" : "stage_change",
      reason: body.reason || (wasClosed ? `Reaberto automaticamente (estava ${currentLead?.status})` : null),
    });


    const meta: Record<string, unknown> = {};
    if (tagsParsed.names.length > 0) {
      const result = await applyTagsToLeadContact(supabase, leadId, workspaceId, tagsParsed.names);
      meta.tags_created = result.created;
      meta.tags_skipped = result.skipped;
      if (result.warning) meta.warnings = [result.warning];
    }

    // Fire-and-forget: notify dnMarketing about stage move
    (async () => {
      try {
        const { data: lead } = await supabase.from("crm_leads").select("contact_id, value, workspace_id").eq("id", leadId).single();
        if (!lead?.contact_id) return;
        const { data: contact } = await supabase.from("crm_contacts").select("dnia_id").eq("id", lead.contact_id).single();
        if (!contact?.dnia_id) return;
        const { data: stage } = await supabase.from("crm_pipeline_stages").select("name").eq("id", body.stage_id).single();
        const companyId = await resolveCompanyId(supabase, { workspaceId: lead.workspace_id });
        await notifyDnMarketing(supabase, companyId, {
          dnia_id: contact.dnia_id,
          event_type: "deal_moved",
          title: `Oportunidade movida para ${stage?.name || "novo estágio"}`,
          metadata: { lead_id: leadId, stage_name: stage?.name, stage_id: body.stage_id, value: lead.value },
        });
      } catch (e) { console.error("[dnMarketing] stage move notify error:", e); }
    })();

    return successResponse(data, Object.keys(meta).length ? meta : undefined);
  }

  // PUT /crm/leads/:id/assign
  if (method === "PUT" && subResource === "assign") {
    const body = await req.json().catch(() => null);
    if (!body?.user_id) return errorResponse("VALIDATION_ERROR", "Field 'user_id' is required");
    const { data, error } = await supabase.from("crm_leads").update({ assigned_to: body.user_id }).eq("id", leadId).eq("workspace_id", workspaceId).select("id, assigned_to").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
    return successResponse(data);
  }

  // GET /crm/leads/:id/utm  — leitura enxuta de UTMs, canal e origem
  if (method === "GET" && parts.length === 2 && parts[1] === "utm") {
    const { data, error } = await supabase.from("crm_leads")
      .select("id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, contact_id, crm_contacts(id, source)")
      .eq("id", leadId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
    const contact = (data as any).crm_contacts;
    return successResponse({
      lead_id: data.id,
      channel: (data as any).utm_source ?? null,
      utm_source: (data as any).utm_source ?? null,
      utm_medium: (data as any).utm_medium ?? null,
      utm_campaign: (data as any).utm_campaign ?? null,
      utm_content: (data as any).utm_content ?? null,
      utm_term: (data as any).utm_term ?? null,
      contact_id: (data as any).contact_id ?? null,
      source: contact?.source ?? null,
    });
  }

  // PATCH /crm/leads/:id/utm  — atualiza somente UTMs/canal
  if (method === "PATCH" && parts.length === 2 && parts[1] === "utm") {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const utmUpdates = buildUtmUpdates(body as Record<string, unknown>);
    if (Object.keys(utmUpdates).length === 0) {
      return errorResponse("VALIDATION_ERROR", "Informe ao menos um campo: channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term");
    }
    const { data, error } = await supabase.from("crm_leads")
      .update(utmUpdates)
      .eq("id", leadId).eq("workspace_id", workspaceId)
      .select("id, utm_source, utm_medium, utm_campaign, utm_content, utm_term")
      .single();
    if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
    return successResponse({ ...data, channel: (data as any).utm_source ?? null });
  }

  // GET /crm/leads/:id
  if (method === "GET" && parts.length === 1) {
    const { data, error } = await supabase.from("crm_leads")
      .select("*, crm_contacts(id, name, phone, email, source, tags), crm_pipeline_stages(id, name, color), crm_products(id, name), crm_loss_reasons(id, name)")
      .eq("id", leadId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Lead not found", 404);
    return successResponse(data);
  }


  // PUT /crm/leads/:id
  if (method === "PUT" && parts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    return await updateLeadFromBody(leadId, body, ctx, supabase, workspaceId);
  }

  return errorResponse("NOT_FOUND", "Unknown CRM leads endpoint", 404);
}

/**
 * Criação de card do pipeline. Aceita, além dos campos base:
 * - source (origem, validada contra "Origens do Lead")
 * - channel / utm_source / utm_medium / utm_campaign / utm_content / utm_term (ou objeto `utm`)
 * - tags (array de strings, aplicadas no contato)
 * - note (nota registrada na timeline do card)
 */
async function createLeadFromBody(
  body: Record<string, unknown>,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
): Promise<Response> {
  if (!body.stage_id) return errorResponse("VALIDATION_ERROR", "Field 'stage_id' is required");

  const tagsParsed = validateTagsInput(body.tags);
  if (!tagsParsed.ok) return errorResponse("VALIDATION_ERROR", tagsParsed.error);
  const noteParsed = validateNoteInput(body.note);
  if (!noteParsed.ok) return errorResponse("VALIDATION_ERROR", noteParsed.error);

  const { value: sourceValue, warning: sourceWarning } = await resolveLeadSource(supabase, ctx.companyId, body.source);
  const segment = await resolveLeadSegment(supabase, workspaceId, body);
  const utmUpdates = buildUtmUpdates(body);

  // Título padrão: contact.company || contact.name
  let defaultTitle: string | null = typeof body.title === "string" ? (body.title.trim() || null) : null;
  if (!defaultTitle && body.contact_id) {
    const { data: c } = await supabase
      .from("crm_contacts").select("name, company").eq("id", body.contact_id as string).maybeSingle();
    defaultTitle = c?.company?.trim() || c?.name?.trim() || null;
  }

  const { data, error } = await supabase.from("crm_leads").insert({
    workspace_id: workspaceId, stage_id: body.stage_id,
    contact_id: body.contact_id || null, title: defaultTitle,
    value: body.value || null, product_id: body.product_id || null,
    assigned_to: body.assigned_to || null, description: body.description || null,
    notes: body.notes || null, created_by: ctx.userId,
    ...(segment.provided ? { segment_id: segment.value } : {}),
    ...utmUpdates,
  }).select("*").single();
  if (error) return errorResponse("DB_ERROR", error.message, 500);

  await applySourceToContact(supabase, body.contact_id as string | null, sourceValue);


  const meta: Record<string, unknown> = {};
  const warnings: string[] = [];
  if (sourceWarning) warnings.push(sourceWarning);
  if (sourceValue) meta.source = sourceValue;
  if (segment.warning) warnings.push(segment.warning);
  if (segment.provided && segment.name) meta.segment = segment.name;



  if (tagsParsed.names.length > 0) {
    const result = await applyTagsToLeadContact(supabase, data.id, workspaceId, tagsParsed.names);
    meta.tags_created = result.created;
    meta.tags_skipped = result.skipped;
    if (result.warning) warnings.push(result.warning);
  }
  if (noteParsed.note) {
    const created = await addLeadNote(supabase, data.id, ctx.userId, noteParsed.note);
    if (created) meta.note_id = created.id;
    else warnings.push("Não foi possível registrar a nota do card.");
  }
  if (warnings.length) meta.warnings = warnings;
  return successResponse(data, Object.keys(meta).length ? meta : undefined, 201);
}

/** Edição do card do pipeline com suporte a origem, canal, UTMs, tags e nota. */
async function updateLeadFromBody(
  leadId: string,
  body: Record<string, unknown>,
  ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
): Promise<Response> {
  const tagsParsed = validateTagsInput(body.tags);
  if (!tagsParsed.ok) return errorResponse("VALIDATION_ERROR", tagsParsed.error);
  const noteParsed = validateNoteInput(body.note);
  if (!noteParsed.ok) return errorResponse("VALIDATION_ERROR", noteParsed.error);

  const { value: sourceValue, warning: sourceWarning } = await resolveLeadSource(supabase, ctx.companyId, body.source);
  const segment = await resolveLeadSegment(supabase, workspaceId, body);
  const utmUpdates = buildUtmUpdates(body);

  const updates: Record<string, unknown> = { ...utmUpdates };
  if (segment.provided) updates.segment_id = segment.value;
  for (const f of ["title", "value", "description", "notes", "product_id", "assigned_to", "contact_id", "status", "stage_id"]) {
    if (body[f] !== undefined) updates[f] = body[f];
  }


  const { data: currentLead } = await supabase.from("crm_leads")
    .select("id, stage_id, contact_id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
  if (!currentLead) return errorResponse("NOT_FOUND", "Lead not found", 404);

  const stageChanged = body.stage_id !== undefined && body.stage_id !== currentLead.stage_id;
  if (stageChanged) updates.moved_at = new Date().toISOString();

  let lead: Record<string, unknown> = currentLead as Record<string, unknown>;
  if (Object.keys(updates).length > 0) {
    const { data, error } = await supabase.from("crm_leads").update(updates)
      .eq("id", leadId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("DB_ERROR", error?.message || "Update failed", 500);
    lead = data as Record<string, unknown>;
  } else {
    const { data } = await supabase.from("crm_leads").select("*").eq("id", leadId).maybeSingle();
    if (data) lead = data as Record<string, unknown>;
  }

  if (stageChanged) {
    await supabase.from("crm_lead_history").insert({
      lead_id: leadId,
      from_stage_id: currentLead.stage_id || null,
      to_stage_id: body.stage_id as string,
      moved_by: ctx.userId || "api",
      action: "stage_change",
      created_by: ctx.userId || null,
    });
  }


  await applySourceToContact(supabase, lead.contact_id as string | null, sourceValue);

  const meta: Record<string, unknown> = {};
  const warnings: string[] = [];
  if (sourceWarning) warnings.push(sourceWarning);
  if (sourceValue) meta.source = sourceValue;
  if (segment.warning) warnings.push(segment.warning);
  if (segment.provided && segment.name) meta.segment = segment.name;



  if (tagsParsed.names.length > 0) {
    const result = await applyTagsToLeadContact(supabase, leadId, workspaceId, tagsParsed.names);
    meta.tags_created = result.created;
    meta.tags_skipped = result.skipped;
    if (result.warning) warnings.push(result.warning);
  }
  if (noteParsed.note) {
    const created = await addLeadNote(supabase, leadId, ctx.userId, noteParsed.note);
    if (created) meta.note_id = created.id;
    else warnings.push("Não foi possível registrar a nota do card.");
  }
  if (warnings.length) meta.warnings = warnings;
  return successResponse(lead, Object.keys(meta).length ? meta : undefined);
}


// --- CRM Products ---
async function handleCrmProducts(
  method: string, parts: string[], req: Request,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const prodId = parts[0];

  if (method === "GET" && !prodId) {
    const { data, error } = await supabase.from("crm_products").select("*").eq("workspace_id", workspaceId).order("name");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && !prodId) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data, error } = await supabase.from("crm_products").insert({ workspace_id: workspaceId, name: body.name, description: body.description || null, price: body.price || null }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!prodId) return errorResponse("NOT_FOUND", "Product ID required", 404);
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "description", "price", "is_active"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("crm_products").update(updates).eq("id", prodId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Product not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE") {
    const { error } = await supabase.from("crm_products").delete().eq("id", prodId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: prodId, deleted: true });
  }
  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported`, 405);
}

// --- CRM Performance (avaliacao de atendimento por playbook) ---
//
// Somente leitura. Espelha o que a area /crm/desempenho mostra na tela, para
// que agentes consigam analisar os mesmos numeros:
//   GET /crm/performance/ranking
//   GET /crm/performance/overview
//   GET /crm/performance/analyses            (?seller_id, ?playbook_id, ?status, ?include_disregarded)
//   GET /crm/performance/analyses/{id}
//   GET /crm/performance/sellers/{sellerId}
//   GET /crm/performance/sellers/{sellerId}/development-points
//   GET /crm/performance/sellers/{sellerId}/brief
//   GET /crm/performance/playbooks
//   GET /crm/performance/playbooks/{id}
async function handleCrmPerformance(
  method: string, parts: string[], url: URL, ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  if (method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported`, 405);
  const sub = parts[0];
  if (sub === "ranking") return handlePerformanceRanking(url, supabase, workspaceId);
  if (sub === "overview") return handlePerformanceOverview(url, ctx, supabase, workspaceId);
  if (sub === "analyses") return handlePerformanceAnalyses(parts.slice(1), url, supabase, workspaceId);
  if (sub === "sellers") return handlePerformanceSellers(parts.slice(1), url, ctx, supabase, workspaceId);
  if (sub === "playbooks") return handlePerformancePlaybooks(parts.slice(1), ctx, supabase, workspaceId);
  return errorResponse("NOT_FOUND", `Unknown performance sub-route: /crm/performance/${sub ?? ""}`, 404);
}

/** Janela do periodo: ?period=today|7d|30d|90d ou ?start_date / ?end_date (ISO). */
function performanceWindow(url: URL): { start: Date; end: Date } | null {
  const period = url.searchParams.get("period") || "30d";
  const startParam = url.searchParams.get("start_date");
  const endParam = url.searchParams.get("end_date");

  const end = endParam ? new Date(endParam) : new Date();
  let start: Date;
  if (startParam) {
    start = new Date(startParam);
  } else {
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "today" ? 1 : 30;
    start = new Date(end);
    start.setDate(start.getDate() - days);
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

/** Empresa dona do workspace — as tabelas de avaliacao sao escopadas por empresa. */
async function performanceCompanyId(
  ctx: AuthContext, supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<string | null> {
  if (ctx.companyId) return ctx.companyId;
  const { data } = await supabase.from("workspaces").select("company_id").eq("id", workspaceId).maybeSingle();
  return (data as { company_id: string } | null)?.company_id ?? null;
}

function averageScore(rows: Array<{ score: number | null }>): number | null {
  const scored = rows.filter((r) => r.score !== null && r.score !== undefined);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, r) => sum + (r.score as number), 0) / scored.length);
}

/** Media da segunda metade menos a da primeira, em pontos de score. */
function scoreTrend(rows: Array<{ score: number | null; occurred_at: string }>): number {
  const scored = rows
    .filter((r) => r.score !== null && r.score !== undefined)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (scored.length < 2) return 0;
  const middle = Math.floor(scored.length / 2);
  const avg = (items: typeof scored) => items.reduce((s, r) => s + (r.score as number), 0) / items.length;
  return Math.round(avg(scored.slice(middle)) - avg(scored.slice(0, middle)));
}

/** Media diaria (yyyy-MM-dd) em ordem cronologica. */
function scoreSeries(rows: Array<{ score: number | null; occurred_at: string }>) {
  const byDay = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (row.score === null || row.score === undefined) continue;
    const day = row.occurred_at.slice(0, 10);
    const current = byDay.get(day) ?? { total: 0, count: 0 };
    current.total += row.score;
    current.count += 1;
    byDay.set(day, current);
  }
  return [...byDay.entries()]
    .map(([date, { total, count }]) => ({ date, score: Math.round(total / count), count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function handlePerformanceRanking(
  url: URL, supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {


  // Janela do periodo: aceita ?period=7d|30d|90d ou ?start_date / ?end_date (ISO)
  const period = url.searchParams.get("period") || "30d";
  const startParam = url.searchParams.get("start_date");
  const endParam = url.searchParams.get("end_date");

  const end = endParam ? new Date(endParam) : new Date();
  let start: Date;
  if (startParam) {
    start = new Date(startParam);
  } else {
    const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "today" ? 1 : 30;
    start = new Date(end);
    start.setDate(start.getDate() - days);
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return errorResponse("VALIDATION_ERROR", "Invalid start_date or end_date");
  }

  const analysisId = url.searchParams.get("analysis_id");
  const { page, perPage, from, to } = parsePagination(url);

  let query = supabase
    .from("activity_analysis_results")
    // occurred_at = quando o atendimento aconteceu (created_at e quando a IA
    // avaliou). O periodo consultado se refere as reunioes, nao ao processamento
    .select("seller_id, seller_name, score, occurred_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "done")
    .not("score", "is", null)
    // Avaliacoes desconsideradas pelo gestor ficam fora do ranking
    .is("disregarded_at", null)
    .gte("occurred_at", start.toISOString())
    .lte("occurred_at", end.toISOString())
    .order("occurred_at", { ascending: true });
  if (analysisId) query = query.eq("playbook_id", analysisId);

  const { data: rows, error } = await query;
  if (error) return errorResponse("DB_ERROR", error.message, 500);

  const results = (rows || []) as Array<{ seller_id: string | null; seller_name: string | null; score: number; occurred_at: string }>;
  const sellerIds = [...new Set(results.map((r) => r.seller_id).filter(Boolean))] as string[];

  if (sellerIds.length === 0) {
    return successResponse([], { total: 0, page, per_page: perPage, period: { start: start.toISOString(), end: end.toISOString() } });
  }

  const [{ data: profiles }, { data: points }] = await Promise.all([
    supabase.from("profiles").select("id, name, email").in("id", sellerIds),
    // Recorrencias do periodo consultado, para casar com a media e a tendencia
    supabase
      .from("seller_development_points")
      .select("seller_id")
      .eq("status", "recurrent")
      .gte("last_seen_at", start.toISOString())
      .lte("last_seen_at", end.toISOString())
      .in("seller_id", sellerIds),
  ]);

  const nameById = new Map(
    ((profiles || []) as Array<{ id: string; name: string | null; email: string | null }>)
      .map((p) => [p.id, p.name || p.email || "Sem nome"]),
  );

  const recurrentBySeller = new Map<string, number>();
  for (const point of (points || []) as Array<{ seller_id: string }>) {
    recurrentBySeller.set(point.seller_id, (recurrentBySeller.get(point.seller_id) || 0) + 1);
  }

  const ranking = sellerIds.map((sellerId) => {
    const sellerResults = results.filter((r) => r.seller_id === sellerId);
    const total = sellerResults.reduce((sum, r) => sum + r.score, 0);
    const avg = Math.round(total / sellerResults.length);

    // Tendencia: media da segunda metade menos a da primeira (em pontos de score)
    let trend = 0;
    if (sellerResults.length >= 2) {
      const middle = Math.floor(sellerResults.length / 2);
      const avgOf = (items: typeof sellerResults) =>
        items.reduce((sum, r) => sum + r.score, 0) / items.length;
      trend = Math.round(avgOf(sellerResults.slice(middle)) - avgOf(sellerResults.slice(0, middle)));
    }

    // Snapshot gravado na avaliacao vem primeiro: preserva o nome mesmo se a
    // pessoa sair da empresa e o profile deixar de existir.
    const snapshotName = sellerResults.find((r) => r.seller_name)?.seller_name;

    return {
      seller_id: sellerId,
      seller_name: snapshotName || nameById.get(sellerId) || "Sem nome",
      avg_score: avg,
      analyses_count: sellerResults.length,
      trend,
      recurrent_points: recurrentBySeller.get(sellerId) || 0,
    };
  }).sort((a, b) => b.avg_score - a.avg_score || b.analyses_count - a.analyses_count);

  return successResponse(ranking.slice(from, to + 1), {
    total: ranking.length,
    page,
    per_page: perPage,
    period: { start: start.toISOString(), end: end.toISOString() },
  });
}

/**
 * GET /crm/performance/overview
 * Visao agregada da empresa no periodo: media geral, total de avaliacoes,
 * media por analise (playbook), serie diaria e ranking completo de vendedores.
 */
async function handlePerformanceOverview(
  url: URL, ctx: AuthContext, supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const window = performanceWindow(url);
  if (!window) return errorResponse("VALIDATION_ERROR", "Invalid start_date or end_date");
  const companyId = await performanceCompanyId(ctx, supabase, workspaceId);
  if (!companyId) return errorResponse("NOT_FOUND", "Company not found for workspace", 404);

  const playbookId = url.searchParams.get("playbook_id") || url.searchParams.get("analysis_id");

  let query = supabase
    .from("activity_analysis_results")
    .select("seller_id, seller_name, score, occurred_at, playbook_id")
    .eq("company_id", companyId)
    .eq("status", "done")
    .is("disregarded_at", null)
    .gte("occurred_at", window.start.toISOString())
    .lte("occurred_at", window.end.toISOString());
  if (playbookId) query = query.eq("playbook_id", playbookId);

  const { data, error } = await query;
  if (error) return errorResponse("DB_ERROR", error.message, 500);

  const results = (data || []) as Array<{
    seller_id: string | null; seller_name: string | null; score: number | null;
    occurred_at: string; playbook_id: string | null;
  }>;

  const sellerIds = [...new Set(results.map((r) => r.seller_id).filter(Boolean))] as string[];
  const [{ data: profiles }, { data: playbooks }, { data: points }] = await Promise.all([
    sellerIds.length
      ? supabase.from("profiles").select("id, name, email").in("id", sellerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null }> }),
    supabase.from("analysis_playbooks").select("id, name").eq("company_id", companyId),
    supabase.from("seller_development_points").select("seller_id")
      .eq("company_id", companyId).eq("status", "recurrent")
      .gte("last_seen_at", window.start.toISOString())
      .lte("last_seen_at", window.end.toISOString()),
  ]);

  const nameById = new Map(
    ((profiles || []) as Array<{ id: string; name: string | null; email: string | null }>)
      .map((p) => [p.id, p.name || p.email || "Sem nome"]),
  );
  const playbookNameById = new Map(
    ((playbooks || []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const recurrentBySeller = new Map<string, number>();
  for (const point of (points || []) as Array<{ seller_id: string }>) {
    recurrentBySeller.set(point.seller_id, (recurrentBySeller.get(point.seller_id) || 0) + 1);
  }

  const ranking = sellerIds.map((sellerId) => {
    const rows = results.filter((r) => r.seller_id === sellerId);
    return {
      seller_id: sellerId,
      seller_name: rows.find((r) => r.seller_name)?.seller_name || nameById.get(sellerId) || "Sem nome",
      avg_score: averageScore(rows) ?? 0,
      analyses_count: rows.length,
      trend: scoreTrend(rows),
      recurrent_points: recurrentBySeller.get(sellerId) || 0,
    };
  }).sort((a, b) => b.avg_score - a.avg_score || b.analyses_count - a.analyses_count);

  const byPlaybookMap = new Map<string, { total: number; count: number }>();
  for (const row of results) {
    if (!row.playbook_id || row.score === null) continue;
    const current = byPlaybookMap.get(row.playbook_id) ?? { total: 0, count: 0 };
    current.total += row.score;
    current.count += 1;
    byPlaybookMap.set(row.playbook_id, current);
  }

  return successResponse({
    company_average: averageScore(results),
    total_analyses: results.length,
    trend: scoreTrend(results),
    by_playbook: [...byPlaybookMap.entries()]
      .map(([id, { total, count }]) => ({
        playbook_id: id,
        name: playbookNameById.get(id) || "Análise removida",
        avg_score: Math.round(total / count),
        count,
      }))
      .sort((a, b) => b.count - a.count),
    score_series: scoreSeries(results),
    ranking,
  }, { period: { start: window.start.toISOString(), end: window.end.toISOString() } });
}

/**
 * GET /crm/performance/analyses        — lista de avaliacoes do periodo
 * GET /crm/performance/analyses/{id}   — avaliacao completa (criterios, evidencias, habitos)
 *
 * Avaliacoes desconsideradas ficam fora por padrao (?include_disregarded=true as inclui).
 */
async function handlePerformanceAnalyses(
  parts: string[], url: URL, supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const resultId = parts[0];

  if (resultId) {
    const { data, error } = await supabase.from("activity_analysis_results")
      .select("*").eq("id", resultId).eq("workspace_id", workspaceId).maybeSingle();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    if (!data) return errorResponse("NOT_FOUND", "Analysis result not found", 404);
    return successResponse(data);
  }

  const window = performanceWindow(url);
  if (!window) return errorResponse("VALIDATION_ERROR", "Invalid start_date or end_date");
  const { page, perPage, from, to } = parsePagination(url);

  let query = supabase.from("activity_analysis_results")
    .select(
      "id, activity_id, lead_id, seller_id, seller_name, playbook_id, source_type, score, status, " +
      "summary_md, occurred_at, created_at, disregarded_at, model",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .gte("occurred_at", window.start.toISOString())
    .lte("occurred_at", window.end.toISOString())
    .order("occurred_at", { ascending: false })
    .range(from, to);

  const sellerId = url.searchParams.get("seller_id");
  const playbookId = url.searchParams.get("playbook_id") || url.searchParams.get("analysis_id");
  const status = url.searchParams.get("status");
  const leadId = url.searchParams.get("lead_id");
  if (sellerId) query = query.eq("seller_id", sellerId);
  if (playbookId) query = query.eq("playbook_id", playbookId);
  if (status) query = query.eq("status", status);
  if (leadId) query = query.eq("lead_id", leadId);
  if (url.searchParams.get("include_disregarded") !== "true") query = query.is("disregarded_at", null);

  const { data, error, count } = await query;
  if (error) return errorResponse("DB_ERROR", error.message, 500);

  return successResponse(data, {
    total: count ?? 0, page, per_page: perPage,
    period: { start: window.start.toISOString(), end: window.end.toISOString() },
  });
}

/**
 * GET /crm/performance/sellers/{sellerId}
 * GET /crm/performance/sellers/{sellerId}/development-points
 * GET /crm/performance/sellers/{sellerId}/brief
 */
async function handlePerformanceSellers(
  parts: string[], url: URL, ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const sellerId = parts[0];
  if (!sellerId) return errorResponse("VALIDATION_ERROR", "Seller ID required");
  const companyId = await performanceCompanyId(ctx, supabase, workspaceId);
  if (!companyId) return errorResponse("NOT_FOUND", "Company not found for workspace", 404);

  const section = parts[1];

  if (section === "brief") {
    const { data, error } = await supabase.from("seller_coaching_briefs")
      .select("*").eq("company_id", companyId).eq("seller_id", sellerId).maybeSingle();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    if (!data) return errorResponse("NOT_FOUND", "No coaching brief generated for this seller", 404);
    return successResponse(data);
  }

  if (section === "development-points") {
    let query = supabase.from("seller_development_points")
      .select("*").eq("company_id", companyId).eq("seller_id", sellerId)
      .order("last_seen_at", { ascending: false });
    const status = url.searchParams.get("status");
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { total: (data || []).length });
  }

  if (section) return errorResponse("NOT_FOUND", `Unknown seller sub-route: ${section}`, 404);

  const window = performanceWindow(url);
  if (!window) return errorResponse("VALIDATION_ERROR", "Invalid start_date or end_date");
  const playbookId = url.searchParams.get("playbook_id") || url.searchParams.get("analysis_id");

  let resultsQuery = supabase.from("activity_analysis_results")
    .select("id, activity_id, lead_id, playbook_id, score, status, occurred_at, disregarded_at, seller_name")
    .eq("company_id", companyId).eq("seller_id", sellerId).eq("status", "done")
    .gte("occurred_at", window.start.toISOString())
    .lte("occurred_at", window.end.toISOString())
    .order("occurred_at", { ascending: false });
  if (playbookId) resultsQuery = resultsQuery.eq("playbook_id", playbookId);

  const [{ data: resultRows, error: resultsError }, { data: pointRows }, { data: achievementRows }] =
    await Promise.all([
      resultsQuery,
      supabase.from("seller_development_points").select("*")
        .eq("company_id", companyId).eq("seller_id", sellerId)
        .order("last_seen_at", { ascending: false }),
      supabase.from("seller_achievements").select("*")
        .eq("company_id", companyId).eq("seller_id", sellerId)
        .order("earned_at", { ascending: false }),
    ]);
  if (resultsError) return errorResponse("DB_ERROR", resultsError.message, 500);

  const all = (resultRows || []) as Array<{
    score: number | null; occurred_at: string; disregarded_at: string | null; seller_name: string | null;
  }>;
  // Desconsideradas continuam auditaveis na lista, mas fora de toda metrica
  const counted = all.filter((r) => !r.disregarded_at);

  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  const points = (pointRows || []) as Array<{
    status: string; last_seen_at: string; corrected_at: string | null;
  }>;
  // Ponto corrigido pertence ao periodo da correcao; aberto/recorrente, ao da ultima falha
  const inPeriod = (p: typeof points[number]) => {
    const iso = p.status === "corrected" ? p.corrected_at : p.last_seen_at;
    if (!iso) return false;
    const at = Date.parse(iso);
    return at >= startMs && at <= endMs;
  };
  const periodPoints = points.filter(inPeriod);

  return successResponse({
    seller_id: sellerId,
    seller_name: all.find((r) => r.seller_name)?.seller_name || null,
    average_score: averageScore(counted),
    trend: scoreTrend(counted),
    analyses_count: counted.length,
    disregarded_count: all.length - counted.length,
    score_series: scoreSeries(counted),
    open_points: periodPoints.filter((p) => p.status === "open"),
    recurrent_points: periodPoints.filter((p) => p.status === "recurrent"),
    corrected_points: periodPoints.filter((p) => p.status === "corrected"),
    achievements: achievementRows || [],
  }, { period: { start: window.start.toISOString(), end: window.end.toISOString() } });
}

/**
 * GET /crm/performance/playbooks       — analises cadastradas na empresa
 * GET /crm/performance/playbooks/{id}  — inclui a rubrica ativa e seus criterios
 */
async function handlePerformancePlaybooks(
  parts: string[], ctx: AuthContext, supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const companyId = await performanceCompanyId(ctx, supabase, workspaceId);
  if (!companyId) return errorResponse("NOT_FOUND", "Company not found for workspace", 404);
  const playbookId = parts[0];

  if (!playbookId) {
    const { data, error } = await supabase.from("analysis_playbooks")
      .select("id, name, description, activity_types, status, is_default, ai_model, created_at, updated_at")
      .eq("company_id", companyId).order("name");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { total: (data || []).length });
  }

  const { data: playbook, error } = await supabase.from("analysis_playbooks")
    .select("id, name, description, activity_types, status, is_default, ai_model, guidelines, created_at, updated_at")
    .eq("id", playbookId).eq("company_id", companyId).maybeSingle();
  if (error) return errorResponse("DB_ERROR", error.message, 500);
  if (!playbook) return errorResponse("NOT_FOUND", "Playbook not found", 404);

  const { data: version } = await supabase.from("analysis_rubric_versions")
    .select("id, version, status, created_at").eq("playbook_id", playbookId)
    .eq("status", "active").maybeSingle();

  let criteria: unknown[] = [];
  if (version) {
    const { data: rows } = await supabase.from("analysis_rubric_criteria")
      .select("criterion_key, stage, name, description, weight, sort_order, is_active")
      .eq("version_id", (version as { id: string }).id).order("sort_order");
    criteria = rows || [];
  }

  return successResponse({ ...playbook, rubric_version: version || null, criteria });
}

// --- CRM Loss Reasons ---
async function handleCrmLossReasons(
  method: string, parts: string[], req: Request,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const reasonId = parts[0];

  if (method === "GET" && !reasonId) {
    const { data, error } = await supabase.from("crm_loss_reasons").select("*").eq("workspace_id", workspaceId).order("name");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && !reasonId) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data, error } = await supabase.from("crm_loss_reasons").insert({ workspace_id: workspaceId, name: body.name }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!reasonId) return errorResponse("NOT_FOUND", "Loss reason ID required", 404);
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "is_active"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("crm_loss_reasons").update(updates).eq("id", reasonId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Loss reason not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE") {
    const { error } = await supabase.from("crm_loss_reasons").delete().eq("id", reasonId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: reasonId, deleted: true });
  }
  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported`, 405);
}

// --- CRM Contact Sources (origens do lead) ---
// Origens são escopadas por empresa (resolvida a partir do workspace).
// Origens internas (is_system=true) NÃO são expostas pela API pública.
// GET /crm/contact-sources                       — lista origens visíveis da empresa
//   ?include_inactive=true                       — inclui origens desabilitadas
async function handleCrmContactSources(
  method: string, parts: string[], url: URL,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  if (parts.length > 0) {
    return errorResponse("NOT_FOUND", "Unknown path under /crm/contact-sources", 404);
  }
  if (method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported`, 405);
  }

  const includeInactive = url.searchParams.get("include_inactive") === "true";

  const { data: ws, error: wsErr } = await supabase
    .from("workspaces").select("company_id").eq("id", workspaceId).single();
  if (wsErr || !ws) return errorResponse("NOT_FOUND", "Workspace not found", 404);
  const companyId = (ws as { company_id: string }).company_id;

  let query = supabase
    .from("crm_contact_sources")
    .select("id, name, is_active, sort_order, created_at, updated_at")
    .eq("company_id", companyId)
    .eq("is_system", false)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return errorResponse("DB_ERROR", error.message, 500);
  return successResponse(data);
}


// --- CRM Tags ---
async function handleCrmTags(
  method: string, parts: string[], req: Request,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  // GET /crm/tags — list unique tags from contacts
  if (method === "GET" && parts.length === 0) {
    const { data, error } = await supabase.from("crm_contacts").select("tags").eq("workspace_id", workspaceId).neq("is_active", false).not("tags", "is", null);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    const tagMap = new Map<string, { name: string; color: string; count: number }>();
    for (const row of (data || [])) {
      if (Array.isArray(row.tags)) {
        for (const t of row.tags as Array<{ name: string; color: string }>) {
          const existing = tagMap.get(t.name);
          if (existing) { existing.count++; } else { tagMap.set(t.name, { name: t.name, color: t.color || "", count: 1 }); }
        }
      }
    }
    return successResponse(Array.from(tagMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
  }

  // PUT /crm/tags/rename
  if (method === "PUT" && parts[0] === "rename") {
    const body = await req.json().catch(() => null);
    if (!body?.old_name || !body?.new_name) return errorResponse("VALIDATION_ERROR", "Fields 'old_name' and 'new_name' are required");
    // Get all contacts with the old tag
    const { data: contacts } = await supabase.from("crm_contacts").select("id, tags").eq("workspace_id", workspaceId).not("tags", "is", null);
    let updated = 0;
    for (const c of (contacts || [])) {
      if (!Array.isArray(c.tags)) continue;
      const tags = c.tags as Array<{ name: string; color: string }>;
      const idx = tags.findIndex(t => t.name === body.old_name);
      if (idx >= 0) {
        tags[idx].name = body.new_name;
        await supabase.from("crm_contacts").update({ tags }).eq("id", c.id);
        updated++;
      }
    }
    return successResponse({ old_name: body.old_name, new_name: body.new_name, contacts_updated: updated });
  }

  // DELETE /crm/tags/:name
  if (method === "DELETE" && parts[0]) {
    const tagName = decodeURIComponent(parts[0]);
    const { data: contacts } = await supabase.from("crm_contacts").select("id, tags").eq("workspace_id", workspaceId).not("tags", "is", null);
    let updated = 0;
    for (const c of (contacts || [])) {
      if (!Array.isArray(c.tags)) continue;
      const tags = (c.tags as Array<{ name: string; color: string }>).filter(t => t.name !== tagName);
      if (tags.length !== (c.tags as Array<unknown>).length) {
        await supabase.from("crm_contacts").update({ tags: tags.length > 0 ? tags : null }).eq("id", c.id);
        updated++;
      }
    }
    return successResponse({ tag: tagName, contacts_updated: updated });
  }

  return errorResponse("NOT_FOUND", "Unknown CRM tags endpoint", 404);
}

// --- CRM Automove Rules ---
async function handleCrmAutomoveRules(
  method: string, parts: string[], _url: URL, req: Request,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  const ruleId = parts[0];

  if (method === "GET" && !ruleId) {
    const { data, error } = await supabase.from("crm_automove_rules").select("*").eq("workspace_id", workspaceId).order("created_at");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && !ruleId) {
    const body = await req.json().catch(() => null);
    if (!body?.name || !body?.from_stage_id || !body?.to_stage_id) {
      return errorResponse("VALIDATION_ERROR", "Fields 'name', 'from_stage_id', and 'to_stage_id' are required");
    }
    const { data, error } = await supabase.from("crm_automove_rules").insert({
      workspace_id: workspaceId, name: body.name,
      from_stage_id: body.from_stage_id, to_stage_id: body.to_stage_id,
      condition_type: body.condition_type || null, condition_value: body.condition_value || null,
      condition_operator: body.condition_operator || ">=",
      is_active: body.is_active ?? true,
    }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!ruleId) return errorResponse("NOT_FOUND", "Rule ID required", 404);
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "from_stage_id", "to_stage_id", "condition_type", "condition_value", "condition_operator", "is_active"]) {
      if (body?.[f] !== undefined) updates[f] = body[f];
    }
    const { data, error } = await supabase.from("crm_automove_rules").update(updates).eq("id", ruleId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Rule not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE") {
    const { error } = await supabase.from("crm_automove_rules").delete().eq("id", ruleId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: ruleId, deleted: true });
  }
  return errorResponse("METHOD_NOT_ALLOWED", `${method} not supported`, 405);
}

// --- CRM Automove Log ---
async function handleCrmAutomoveLog(
  method: string, url: URL,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  if (method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
  const { page, perPage, from, to } = parsePagination(url);
  const { data, error, count } = await supabase.from("crm_automove_log")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) return errorResponse("DB_ERROR", error.message, 500);
  return successResponse(data, { page, per_page: perPage, total: count || 0 });
}

// --- CRM Activities (workspace-wide) ---
// Replicates useCRMAnalytics activity-based metrics so external dashboards
// match the internal Nexus Analytics 100% (uses crm_lead_activities, NOT crm_appointments).

// Helpers: enrich activities with call/meeting media (record url, transcript, AI analysis).
type ActivityRow = { id: string; last_call_id: string | null; appointment_id: string | null; [k: string]: unknown };

function parseInclude(url: URL): { call: boolean; meeting: boolean; transcript: boolean } {
  const raw = (url.searchParams.get("include") || "").toLowerCase();
  if (!raw) return { call: false, meeting: false, transcript: false };
  const set = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
  return { call: set.has("call") || set.has("media"), meeting: set.has("meeting") || set.has("media"), transcript: set.has("transcript") };
}

async function fetchCallMap(
  supabase: ReturnType<typeof adminClient>, workspaceId: string, callIds: string[], includeTranscript: boolean,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (callIds.length === 0) return map;
  const baseCols = "id,status,duration_seconds,started_at,answered_at,ended_at,record_url,transcription_status,ai_analyzed_at,hangup_cause,call_outcome_label";
  const cols = includeTranscript ? `${baseCols},transcription_text,ai_analysis` : baseCols;
  const { data } = await supabase.from("calls").select(cols).eq("workspace_id", workspaceId).in("id", callIds);
  for (const c of (data as Array<{ id: string } & Record<string, unknown>> | null) || []) map.set(c.id, c);
  return map;
}

async function fetchMeetingMap(
  supabase: ReturnType<typeof adminClient>, workspaceId: string, appointmentIds: string[], includeTranscript: boolean,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (appointmentIds.length === 0) return map;

  const { data: apts } = await supabase.from("crm_appointments")
    .select("id,meeting_link,daily_room_url,daily_room_name,meeting_started_at,meeting_ended_at,actual_duration_seconds,recording_id,status")
    .eq("workspace_id", workspaceId).in("id", appointmentIds);

  const recCols = includeTranscript
    ? "id,appointment_id,recording_url,transcription_url,transcription_text,ai_analysis,chat_messages,duration_seconds,status,created_at"
    : "id,appointment_id,recording_url,transcription_url,duration_seconds,status,created_at";
  const { data: recs } = await supabase.from("daily_recordings")
    .select(recCols).eq("workspace_id", workspaceId).in("appointment_id", appointmentIds)
    .order("created_at", { ascending: false });

  const recByAppt = new Map<string, Record<string, unknown>>();
  for (const r of (recs as Array<{ appointment_id: string } & Record<string, unknown>> | null) || []) {
    if (!recByAppt.has(r.appointment_id)) recByAppt.set(r.appointment_id, r);
  }

  // For appointments whose recording has no transcription_text, optionally consolidate chunks.
  // Os chunks sao gravados com meeting_id = crm_appointments.daily_room_name (MeetingRoom.tsx),
  // nao com o appointment_id — por isso a busca precisa mapear room_name -> appointment.
  const chunkKeyToAppt = new Map<string, string>();
  if (includeTranscript) {
    for (const apt of apts || []) {
      const rec = recByAppt.get(apt.id);
      const text = rec && (rec as { transcription_text?: string | null }).transcription_text;
      if (text) continue;
      const roomName = (apt as { daily_room_name?: string | null }).daily_room_name;
      if (roomName) chunkKeyToAppt.set(roomName, apt.id);
      // Fallback para dados antigos eventualmente gravados sob o proprio appointment_id
      chunkKeyToAppt.set(apt.id, apt.id);
    }
  }
  const chunksByMeeting = new Map<string, string>();
  if (chunkKeyToAppt.size > 0) {
    const { data: chunks } = await supabase.from("meeting_transcript_chunks")
      .select("meeting_id,chunk_index,start_ts,end_ts,speakers,content")
      .eq("workspace_id", workspaceId).in("meeting_id", [...chunkKeyToAppt.keys()])
      .order("chunk_index", { ascending: true });
    const grouped = new Map<string, Array<{ start_ts: number | null; speakers: string[] | null; content: string }>>();
    for (const c of (chunks as Array<{ meeting_id: string; start_ts: number | null; speakers: string[] | null; content: string }> | null) || []) {
      const apptId = chunkKeyToAppt.get(c.meeting_id);
      if (!apptId) continue;
      if (!grouped.has(apptId)) grouped.set(apptId, []);
      grouped.get(apptId)!.push(c);
    }
    for (const [mid, arr] of grouped.entries()) {
      chunksByMeeting.set(mid, arr.map(c => {
        const ts = c.start_ts != null ? `[${c.start_ts}] ` : "";
        const spk = c.speakers && c.speakers.length ? `${c.speakers.join(", ")}: ` : "";
        return `${ts}${spk}${c.content}`;
      }).join("\n"));
    }
  }

  for (const apt of apts || []) {
    const rec = recByAppt.get(apt.id) as Record<string, unknown> | undefined;
    const consolidated = chunksByMeeting.get(apt.id);
    const meeting: Record<string, unknown> = {
      appointment_id: apt.id,
      meeting_link: apt.meeting_link,
      daily_room_url: apt.daily_room_url,
      started_at: apt.meeting_started_at,
      ended_at: apt.meeting_ended_at,
      duration_seconds: apt.actual_duration_seconds,
      status: apt.status,
      recording: rec ? {
        id: rec.id,
        url: rec.recording_url,
        transcription_url: rec.transcription_url,
        duration_seconds: rec.duration_seconds,
        status: rec.status,
        ...(includeTranscript ? {
          transcription_text: (rec.transcription_text as string | null) || consolidated || null,
          ai_analysis: rec.ai_analysis,
          chat_messages: rec.chat_messages,
        } : {}),
      } : null,
    };
    map.set(apt.id, meeting);
  }
  return map;
}

async function enrichActivities(
  supabase: ReturnType<typeof adminClient>, workspaceId: string, activities: ActivityRow[], url: URL,
): Promise<ActivityRow[]> {
  const inc = parseInclude(url);
  if (!inc.call && !inc.meeting) return activities;
  const callIds = inc.call ? Array.from(new Set(activities.map(a => a.last_call_id).filter((x): x is string => !!x))) : [];
  const aptIds = inc.meeting ? Array.from(new Set(activities.map(a => a.appointment_id).filter((x): x is string => !!x))) : [];
  const [callMap, meetingMap] = await Promise.all([
    inc.call ? fetchCallMap(supabase, workspaceId, callIds, inc.transcript) : Promise.resolve(new Map<string, Record<string, unknown>>()),
    inc.meeting ? fetchMeetingMap(supabase, workspaceId, aptIds, inc.transcript) : Promise.resolve(new Map<string, Record<string, unknown>>()),
  ]);
  return activities.map(a => {
    const out: ActivityRow = { ...a };
    if (inc.call && a.last_call_id) out.call = callMap.get(a.last_call_id) || null;
    if (inc.meeting && a.appointment_id) out.meeting = meetingMap.get(a.appointment_id) || null;
    return out;
  });
}

async function handleCrmActivities(
  method: string, parts: string[], url: URL,
  supabase: ReturnType<typeof adminClient>, workspaceId: string,
): Promise<Response> {
  if (method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported", 405);

  // GET /crm/activities/:id/call | /meeting | /transcript
  if (parts[0] && parts[1] && /^[0-9a-f-]{36}$/i.test(parts[0])) {
    const actId = parts[0];
    const sub = parts[1];
    const { data: act, error: actErr } = await supabase.from("crm_lead_activities")
      .select("id,workspace_id,last_call_id,appointment_id")
      .eq("id", actId).eq("workspace_id", workspaceId).maybeSingle();
    if (actErr) return errorResponse("DB_ERROR", actErr.message, 500);
    if (!act) return errorResponse("NOT_FOUND", "Activity not found", 404);

    if (sub === "call") {
      if (!act.last_call_id) return errorResponse("NOT_FOUND", "Activity has no linked call", 404);
      const map = await fetchCallMap(supabase, workspaceId, [act.last_call_id], true);
      const call = map.get(act.last_call_id);
      if (!call) return errorResponse("NOT_FOUND", "Call not found", 404);
      return successResponse(call);
    }
    if (sub === "meeting") {
      if (!act.appointment_id) return errorResponse("NOT_FOUND", "Activity has no linked meeting", 404);
      const map = await fetchMeetingMap(supabase, workspaceId, [act.appointment_id], true);
      const meeting = map.get(act.appointment_id);
      if (!meeting) return errorResponse("NOT_FOUND", "Meeting not found", 404);
      return successResponse(meeting);
    }
    if (sub === "transcript") {
      // Prefer meeting transcript when both exist.
      if (act.appointment_id) {
        const map = await fetchMeetingMap(supabase, workspaceId, [act.appointment_id], true);
        const meeting = map.get(act.appointment_id) as { recording?: { transcription_text?: string | null; ai_analysis?: unknown } | null } | undefined;
        const text = meeting?.recording?.transcription_text || null;
        if (text) return successResponse({ source: "meeting", text, ai_analysis: meeting?.recording?.ai_analysis ?? null });
      }
      if (act.last_call_id) {
        const map = await fetchCallMap(supabase, workspaceId, [act.last_call_id], true);
        const call = map.get(act.last_call_id) as { transcription_text?: string | null; ai_analysis?: unknown } | undefined;
        const text = call?.transcription_text || null;
        if (text) return successResponse({ source: "call", text, ai_analysis: call?.ai_analysis ?? null });
      }
      return errorResponse("NOT_FOUND", "No transcript available for this activity", 404);
    }
    return errorResponse("NOT_FOUND", `Unknown activity sub-route: /crm/activities/${actId}/${sub}`, 404);
  }


  // GET /crm/activities/stats?start_date=&end_date=&type=meeting,demo,reschedule
  if (parts[0] === "stats") {
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 86400000);
    const startDate = url.searchParams.get("start_date") || defaultStart.toISOString();
    const endDate = url.searchParams.get("end_date") || now.toISOString();
    const typeFilter = url.searchParams.get("type");
    const types = typeFilter ? typeFilter.split(",").map(t => t.trim()) : null;

    // IMPORTANT: use strict `lt` on end_date to match the internal Nexus Analytics
    // (useCRMAnalytics.ts) exactly. Using `lte` would include activities at the
    // exact endDate boundary (e.g., May 1st 00:00 when filtering "April"),
    // inflating the no_show denominator vs the internal report.
    let query = supabase.from("crm_lead_activities")
      .select("id, lead_id, type, status, scheduled_at, completed_at, duration_minutes, created_at")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_at", startDate)
      .lt("scheduled_at", endDate);
    if (types) query = query.in("type", types);

    const { data: activities, error } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    const all = activities || [];
    const meetingTypes = ["meeting", "demo", "reschedule"];
    const meetings = all.filter(a => meetingTypes.includes(a.type));

    // Per-type breakdown (matches activityBreakdown in useCRMAnalytics)
    const breakdown: Record<string, { total: number; completed: number; no_show: number; cancelled: number; pending: number }> = {};
    for (const a of all) {
      if (!breakdown[a.type]) breakdown[a.type] = { total: 0, completed: 0, no_show: 0, cancelled: 0, pending: 0 };
      breakdown[a.type].total++;
      if (a.status === "completed") breakdown[a.type].completed++;
      else if (a.status === "no_show") breakdown[a.type].no_show++;
      else if (a.status === "cancelled") breakdown[a.type].cancelled++;
      else breakdown[a.type].pending++;
    }

    // Meeting-specific KPIs (matches Analytics page exactly)
    const scheduled = meetings.length;
    const completed = meetings.filter(a => a.status === "completed");
    const noShow = meetings.filter(a => a.status === "no_show");
    const cancelled = meetings.filter(a => a.status === "cancelled");
    const pending = meetings.filter(a => a.status !== "completed" && a.status !== "no_show" && a.status !== "cancelled");
    const rescheduled = all.filter(a => a.type === "reschedule");

    const noShowRate = scheduled > 0 ? Math.round((noShow.length / scheduled) * 100) : 0;
    const completionRate = scheduled > 0 ? Math.round((completed.length / scheduled) * 100) : 0;
    const rescheduleRate = scheduled > 0 ? Math.round((rescheduled.length / scheduled) * 100) : 0;

    const uniq = (arr: Array<{ lead_id: string | null }>) =>
      [...new Set(arr.map(a => a.lead_id).filter(Boolean))] as string[];

    return successResponse({
      period: { start: startDate, end: endDate },
      meetings: {
        scheduled,
        completed: completed.length,
        no_show: noShow.length,
        cancelled: cancelled.length,
        pending: pending.length,
        rescheduled: rescheduled.length,
        no_show_rate: noShowRate,
        completion_rate: completionRate,
        reschedule_rate: rescheduleRate,
      },
      lead_ids: {
        scheduled: uniq(meetings),
        completed: uniq(completed),
        no_show: uniq(noShow),
        cancelled: uniq(cancelled),
        pending: uniq(pending),
        rescheduled: uniq(rescheduled),
      },
      activity_ids: {
        no_show: noShow.map(a => a.id),
        completed: completed.map(a => a.id),
        cancelled: cancelled.map(a => a.id),
        pending: pending.map(a => a.id),
      },
      breakdown_by_type: Object.entries(breakdown).map(([type, counts]) => ({ type, ...counts })),
    });
  }

  // GET /crm/activities?start_date=&end_date=&type=&status=&page=&per_page=
  // List activities across workspace (with optional filters).
  if (!parts[0]) {
    const { page, perPage, from, to } = parsePagination(url);
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const typeFilter = url.searchParams.get("type");
    const statusFilter = url.searchParams.get("status");

    let query = supabase.from("crm_lead_activities")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId);
    if (startDate) query = query.gte("scheduled_at", startDate);
    if (endDate) query = query.lte("scheduled_at", endDate);
    if (typeFilter) query = query.in("type", typeFilter.split(",").map(t => t.trim()));
    if (statusFilter) query = query.in("status", statusFilter.split(",").map(s => s.trim()));

    const { data, error, count } = await query
      .order("scheduled_at", { ascending: false })
      .range(from, to);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    const enriched = await enrichActivities(supabase, workspaceId, (data || []) as ActivityRow[], url);
    return successResponse(enriched, { page, per_page: perPage, total: count || 0 });
  }

  return errorResponse("NOT_FOUND", `Unknown activities sub-route: /crm/activities/${parts[0]}`, 404);
}

// ---------------------------------------------------------------------------
// Route: /crm/funnel  — replicates internal Analytics funnel logic
// ---------------------------------------------------------------------------
async function handleCrmFunnel(
  method: string,
  parts: string[],
  url: URL,
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
): Promise<Response> {
  // GET /crm/funnel/stats?start_date=&end_date=
  if (method === "GET" && parts[0] === "stats") {
    const endDate = url.searchParams.get("end_date") || new Date().toISOString();
    const startDate = url.searchParams.get("start_date") || new Date(Date.now() - 30 * 86400000).toISOString();
    const includeIds = url.searchParams.get("include_ids") !== "false"; // default true
    // Recorte por dono do card (crm_leads.assigned_to). Ausente = agregado do workspace.
    const assignedTo = url.searchParams.get("assigned_to") || url.searchParams.get("seller_id") || null;

    // 1) Stages
    const { data: stages, error: sErr } = await supabase
      .from("crm_pipeline_stages")
      .select("id, name, color, order, position, is_default")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true });
    if (sErr) return errorResponse("DB_ERROR", sErr.message, 500);
    if (!stages || stages.length === 0) return successResponse({ stages: [], won: { count: 0, lead_ids: [] }, lost: { count: 0, lead_ids: [] }, conversions: [] });

    // 2) Current snapshot — open leads grouped by stage_id (paged in chunks to bypass 1000-row limit)
    const currentByStage = new Map<string, string[]>();
    {
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        let q = supabase
          .from("crm_leads")
          .select("id, stage_id")
          .eq("workspace_id", workspaceId)
          .eq("status", "open");
        if (assignedTo) q = q.eq("assigned_to", assignedTo);
        const { data, error } = await q.range(offset, offset + pageSize - 1);
        if (error) return errorResponse("DB_ERROR", error.message, 500);
        if (!data || data.length === 0) break;
        for (const l of data as Array<{ id: string; stage_id: string | null }>) {
          if (!l.stage_id) continue;
          const arr = currentByStage.get(l.stage_id) || [];
          arr.push(l.id);
          currentByStage.set(l.stage_id, arr);
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }
    }

    // 3) Period — leads that ENTERED each stage in window via crm_lead_history.to_stage_id
    const periodByStage = new Map<string, Set<string>>();
    {
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        let q = supabase
          .from("crm_lead_history")
          .select("lead_id, to_stage_id, created_at, crm_leads!inner(workspace_id, assigned_to)")
          .eq("crm_leads.workspace_id", workspaceId)
          .not("to_stage_id", "is", null)
          .gte("created_at", startDate)
          .lt("created_at", endDate);
        if (assignedTo) q = q.eq("crm_leads.assigned_to", assignedTo);
        const { data, error } = await q.range(offset, offset + pageSize - 1);
        if (error) return errorResponse("DB_ERROR", error.message, 500);
        if (!data || data.length === 0) break;
        for (const h of data as Array<{ lead_id: string; to_stage_id: string }>) {
          const s = periodByStage.get(h.to_stage_id) || new Set<string>();
          s.add(h.lead_id);
          periodByStage.set(h.to_stage_id, s);
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }
    }

    // 4) Won / Lost na janela.
    // O banco grava 'closed_won'/'closed_lost' em crm_lead_history.action (os nomes antigos
    // 'won'/'lost' seguem aceitos por compatibilidade). Unimos com crm_leads.closed_at para
    // cobrir fechamentos que nao geraram linha de historico.
    const wonIds = new Set<string>();
    const lostIds = new Set<string>();
    {
      const WON_ACTIONS = ["closed_won", "won", "marked_won"];
      const LOST_ACTIONS = ["closed_lost", "lost", "marked_lost"];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        let q = supabase
          .from("crm_lead_history")
          .select("lead_id, action, created_at, crm_leads!inner(workspace_id, assigned_to)")
          .eq("crm_leads.workspace_id", workspaceId)
          .in("action", [...WON_ACTIONS, ...LOST_ACTIONS])
          .gte("created_at", startDate)
          .lt("created_at", endDate);
        if (assignedTo) q = q.eq("crm_leads.assigned_to", assignedTo);
        const { data, error } = await q.range(offset, offset + pageSize - 1);
        if (error) return errorResponse("DB_ERROR", error.message, 500);
        if (!data || data.length === 0) break;
        for (const h of data as Array<{ lead_id: string; action: string }>) {
          if (WON_ACTIONS.includes(h.action)) wonIds.add(h.lead_id);
          else lostIds.add(h.lead_id);
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      offset = 0;
      while (true) {
        let q = supabase
          .from("crm_leads")
          .select("id, status")
          .eq("workspace_id", workspaceId)
          .in("status", ["won", "lost"])
          .gte("closed_at", startDate)
          .lt("closed_at", endDate);
        if (assignedTo) q = q.eq("assigned_to", assignedTo);
        const { data, error } = await q.range(offset, offset + pageSize - 1);
        if (error) return errorResponse("DB_ERROR", error.message, 500);
        if (!data || data.length === 0) break;
        for (const l of data as Array<{ id: string; status: string }>) {
          if (l.status === "won") wonIds.add(l.id);
          else lostIds.add(l.id);
        }
        if (data.length < pageSize) break;
        offset += pageSize;
      }
    }


    // 5) Build stages payload
    const stagesOut = (stages as Array<{ id: string; name: string; color: string | null; order: number; position: number; is_default: boolean }>).map((s) => {
      const cur = currentByStage.get(s.id) || [];
      const per = [...(periodByStage.get(s.id) || [])];
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        order: s.order,
        position: s.position,
        is_default: s.is_default,
        current_count: cur.length,
        period_count: per.length,
        ...(includeIds ? { current_lead_ids: cur, period_lead_ids: per } : {}),
      };
    });

    // 6) Conversions between adjacent stages (based on period_count)
    const conversions: Array<{ from_stage_id: string; from_stage_name: string; to_stage_id: string; to_stage_name: string; rate: number }> = [];
    for (let i = 0; i < stagesOut.length - 1; i++) {
      const a = stagesOut[i];
      const b = stagesOut[i + 1];
      const rate = a.period_count > 0 ? Math.round((b.period_count / a.period_count) * 1000) / 10 : 0;
      conversions.push({
        from_stage_id: a.id, from_stage_name: a.name,
        to_stage_id: b.id, to_stage_name: b.name,
        rate,
      });
    }

    return successResponse({
      period: { start_date: startDate, end_date: endDate },
      assigned_to: assignedTo,
      stages: stagesOut,
      won: { count: wonIds.size, ...(includeIds ? { lead_ids: [...wonIds] } : {}) },
      lost: { count: lostIds.size, ...(includeIds ? { lead_ids: [...lostIds] } : {}) },
      conversions,
    });
  }

  return errorResponse("NOT_FOUND", `Unknown funnel sub-route: /crm/funnel/${parts[0] || ""}`, 404);
}

// ---------------------------------------------------------------------------

async function handleAppointments(
  method: string,
  pathParts: string[],
  url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const appointmentId = pathParts[0];
  const subResource = pathParts[1];

  // GET /appointments/availability
  if (method === "GET" && appointmentId === "availability") {
    const agentId = url.searchParams.get("agent_id");
    const date = url.searchParams.get("date");
    const duration = parseInt(url.searchParams.get("duration") || "30", 10);
    if (!agentId || !date) return errorResponse("VALIDATION_ERROR", "Query params 'agent_id' and 'date' are required");

    const { data, error } = await supabase.functions.invoke("schedule-appointment", {
      body: { action: "check", workspace_id: workspaceId, agent_id: agentId, date, duration },
    });
    if (error) return errorResponse("AVAILABILITY_ERROR", error.message || "Failed to check availability", 500);
    return successResponse(data);
  }

  // GET /appointments/stats — derived metrics (no-show / realized / cancelled / upcoming)
  if (method === "GET" && appointmentId === "stats") {
    const startDate = url.searchParams.get("start_date") || new Date(Date.now() - 30 * 86400000).toISOString();
    const endDate = url.searchParams.get("end_date") || new Date().toISOString();
    const agentId = url.searchParams.get("agent_id");

    let q = supabase.from("crm_appointments")
      .select("id, lead_id, status, start_time, meeting_started_at, contact_joined, actual_duration_seconds")
      .eq("workspace_id", workspaceId)
      .gte("start_time", startDate)
      .lt("start_time", endDate);
    if (agentId) q = q.eq("assigned_to", agentId);
    const { data, error } = await q.limit(10000);
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    const rows = (data || []) as Array<{ id: string; lead_id: string | null; status: string; start_time: string; meeting_started_at: string | null }>;
    const nowISO = new Date().toISOString();
    const realized = rows.filter((a) => !!a.meeting_started_at);
    const noShow = rows.filter((a) => !a.meeting_started_at && a.start_time < nowISO && a.status !== "cancelled");
    const cancelled = rows.filter((a) => a.status === "cancelled");
    const upcoming = rows.filter((a) => a.start_time >= nowISO && a.status !== "cancelled");
    const total = rows.length;

    return successResponse({
      total,
      realized: realized.length,
      no_show: noShow.length,
      cancelled: cancelled.length,
      upcoming: upcoming.length,
      realized_rate: total > 0 ? Math.round((realized.length / total) * 100) : 0,
      no_show_rate: total > 0 ? Math.round((noShow.length / total) * 100) : 0,
      appointment_ids: {
        realized: realized.map((a) => a.id),
        no_show: noShow.map((a) => a.id),
        cancelled: cancelled.map((a) => a.id),
        upcoming: upcoming.map((a) => a.id),
      },
      lead_ids: {
        realized: [...new Set(realized.map((a) => a.lead_id).filter(Boolean))],
        no_show: [...new Set(noShow.map((a) => a.lead_id).filter(Boolean))],
        cancelled: [...new Set(cancelled.map((a) => a.lead_id).filter(Boolean))],
        upcoming: [...new Set(upcoming.map((a) => a.lead_id).filter(Boolean))],
      },
      period: { start_date: startDate, end_date: endDate },
    });
  }

  // GET /appointments
  if (method === "GET" && pathParts.length === 0) {
    const status = url.searchParams.get("status");
    const agentId = url.searchParams.get("agent_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const derivedStatus = url.searchParams.get("derived_status"); // realized | no_show | cancelled | upcoming

    let query = supabase.from("crm_appointments")
      .select("*, crm_contacts(id, name, phone, email), profiles!crm_appointments_assigned_to_fkey(id, name, email)")
      .eq("workspace_id", workspaceId);

    if (status) query = query.eq("status", status);
    if (agentId) query = query.eq("assigned_to", agentId);
    if (startDate) query = query.gte("start_time", startDate);
    if (endDate) query = query.lte("end_time", endDate);
    query = query.order("start_time", { ascending: true });

    const { data, error } = await query;
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Enrich with derived flags
    const nowISO = new Date().toISOString();
    let enriched = (data || []).map((a: any) => {
      const isRealized = !!a.meeting_started_at;
      const isCancelled = a.status === "cancelled";
      const isPast = a.start_time < nowISO;
      const isNoShow = !isRealized && isPast && !isCancelled;
      const isUpcoming = !isPast && !isCancelled;
      return {
        ...a,
        is_realized: isRealized,
        is_no_show: isNoShow,
        is_cancelled: isCancelled,
        is_upcoming: isUpcoming,
        derived_status: isRealized ? "realized" : isCancelled ? "cancelled" : isNoShow ? "no_show" : isUpcoming ? "upcoming" : "scheduled",
      };
    });

    if (derivedStatus) {
      enriched = enriched.filter((a: any) => a.derived_status === derivedStatus);
    }

    return successResponse(enriched);
  }

  // POST /appointments
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.title || !body?.start_time || !body?.end_time || !body?.contact_id) {
      return errorResponse("VALIDATION_ERROR", "Fields 'title', 'start_time', 'end_time', and 'contact_id' are required");
    }
    const { data, error } = await supabase.from("crm_appointments").insert({
      workspace_id: workspaceId, title: body.title, description: body.description || null,
      start_time: body.start_time, end_time: body.end_time,
      contact_id: body.contact_id, lead_id: body.lead_id || null,
      assigned_to: body.assigned_to || null, location: body.location || null,
      meeting_type: body.meeting_type || "presencial",
      duration_minutes: body.duration_minutes || null, notes: body.notes || null,
      created_by: ctx.userId,
    }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // Fire-and-forget: notify dnMarketing about meeting
    if (body.lead_id) {
      (async () => {
        try {
          const { data: lead } = await supabase.from("crm_leads").select("contact_id, workspace_id").eq("id", body.lead_id).single();
          if (!lead?.contact_id) return;
          const { data: contact } = await supabase.from("crm_contacts").select("dnia_id").eq("id", lead.contact_id).single();
          if (!contact?.dnia_id) return;
          const companyId = await resolveCompanyId(supabase, { workspaceId: lead.workspace_id });
          await notifyDnMarketing(supabase, companyId, {
            dnia_id: contact.dnia_id,
            event_type: "meeting_scheduled",
            title: data.title,
            metadata: { appointment_id: data.id, start_time: data.start_time, end_time: data.end_time },
          });
        } catch (e) { console.error("[dnMarketing] appointment notify error:", e); }
      })();
    }

    return successResponse(data, undefined, 201);
  }

  if (!appointmentId) return errorResponse("NOT_FOUND", "Appointment ID required", 404);

  // POST /appointments/:id/attendees
  if (method === "POST" && subResource === "attendees") {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data: appt } = await supabase.from("crm_appointments").select("additional_attendees").eq("id", appointmentId).single();
    const attendees = (appt?.additional_attendees as string[]) || [];
    const entry = `${body.name}${body.email ? ` <${body.email}>` : ""}${body.phone ? ` (${body.phone})` : ""}`;
    attendees.push(entry);
    const { data, error } = await supabase.from("crm_appointments").update({ additional_attendees: attendees }).eq("id", appointmentId).select("id, additional_attendees").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Appointment not found", 404);
    return successResponse(data);
  }

  // POST /appointments/:id/sync-calendar
  if (method === "POST" && subResource === "sync-calendar") {
    const { data, error } = await supabase.functions.invoke("google-calendar-create-event", {
      body: { appointment_id: appointmentId, workspace_id: workspaceId },
    });
    if (error) return errorResponse("SYNC_ERROR", error.message || "Calendar sync failed", 500);
    return successResponse(data);
  }

  // GET /appointments/:id
  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase.from("crm_appointments")
      .select("*, crm_contacts(id, name, phone, email), profiles!crm_appointments_assigned_to_fkey(id, name, email)")
      .eq("id", appointmentId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Appointment not found", 404);
    const a: any = data;
    const nowISO = new Date().toISOString();
    const isRealized = !!a.meeting_started_at;
    const isCancelled = a.status === "cancelled";
    const isPast = a.start_time < nowISO;
    const isNoShow = !isRealized && isPast && !isCancelled;
    const isUpcoming = !isPast && !isCancelled;
    return successResponse({
      ...a,
      is_realized: isRealized,
      is_no_show: isNoShow,
      is_cancelled: isCancelled,
      is_upcoming: isUpcoming,
      derived_status: isRealized ? "realized" : isCancelled ? "cancelled" : isNoShow ? "no_show" : isUpcoming ? "upcoming" : "scheduled",
    });
  }

  // PUT /appointments/:id
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    for (const f of ["title", "description", "start_time", "end_time", "status", "assigned_to", "location", "meeting_type", "duration_minutes", "notes"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    const { data, error } = await supabase.from("crm_appointments").update(updates).eq("id", appointmentId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Appointment not found", 404);
    return successResponse(data);
  }

  // DELETE /appointments/:id
  if (method === "DELETE" && pathParts.length === 1) {
    const { data, error } = await supabase.from("crm_appointments").update({ status: "cancelled" }).eq("id", appointmentId).eq("workspace_id", workspaceId).select("id, status").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Appointment not found", 404);
    return successResponse(data);
  }

  return errorResponse("NOT_FOUND", "Unknown appointments endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /integrations (google-calendar)
// ---------------------------------------------------------------------------

async function handleIntegrations(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;

  if (pathParts[0] !== "google-calendar") {
    return errorResponse("NOT_FOUND", "Unknown integration", 404);
  }
  const sub = pathParts[1];

  // GET /integrations/google-calendar/auth-url
  if (method === "GET" && sub === "auth-url") {
    const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
      body: { action: "get_auth_url", workspace_id: workspaceId, user_id: ctx.userId },
    });
    if (error) return errorResponse("AUTH_URL_ERROR", error.message || "Failed to get auth URL", 500);
    return successResponse(data);
  }

  // POST /integrations/google-calendar/callback
  if (method === "POST" && sub === "callback") {
    const body = await req.json().catch(() => null);
    if (!body?.code) return errorResponse("VALIDATION_ERROR", "Field 'code' is required");
    const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
      body: { action: "exchange_code", code: body.code, workspace_id: workspaceId, user_id: ctx.userId },
    });
    if (error) return errorResponse("CALLBACK_ERROR", error.message || "Failed to exchange code", 500);
    return successResponse(data);
  }

  // GET /integrations/google-calendar/status
  if (method === "GET" && sub === "status") {
    const { data, error } = await supabase.from("crm_google_calendar_integration")
      .select("id, google_email, google_calendar_id, is_enabled, auto_create_events, auto_sync_events, last_sync_at, created_at")
      .eq("workspace_id", workspaceId).eq("user_id", ctx.userId).single();
    if (error) return successResponse({ connected: false });
    return successResponse({ connected: true, ...data });
  }

  // DELETE /integrations/google-calendar
  if (method === "DELETE" && !sub) {
    const { error } = await supabase.from("crm_google_calendar_integration").delete().eq("workspace_id", workspaceId).eq("user_id", ctx.userId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ disconnected: true });
  }

  return errorResponse("NOT_FOUND", "Unknown google-calendar endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /agent-calendars
// ---------------------------------------------------------------------------

// --- Timezone helpers (mesma lógica de schedule-appointment) ---
function tzOffsetHours(timezone: string): number {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / 3600000;
}
function localTimeToUTC(date: Date, hour: number, minute: number, timezone: string): Date {
  const d = new Date(date);
  d.setUTCHours(hour + tzOffsetHours(timezone), minute, 0, 0);
  return d;
}
function dateInTz(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}
function timeInTz(date: Date, timezone: string): string {
  return date.toLocaleString("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
}

interface CalendarGridDay {
  date: string;
  weekday: string;
  is_working_day: boolean;
  is_holiday: boolean;
  available_minutes: number;
  booked_minutes: number;
  free_slots: Array<{ start: string; end: string; time: string }>;
  busy_slots: Array<{ start: string; end: string; appointment_id: string | null; title: string | null }>;
}

interface CalendarGridAgent {
  agent_id: string;
  agent_name: string | null;
  timezone: string;
  work_days: string[];
  work_start_time: string;
  work_end_time: string;
  slot_duration_minutes: number;
  slot_step_minutes: number;
  min_interval_minutes: number;
  days: CalendarGridDay[];
  totals: {
    capacity_minutes: number;
    booked_minutes: number;
    free_minutes: number;
    occupancy_rate: number;
    total_slots: number;
    free_slots: number;
    booked_appointments: number;
  };
}

async function buildCalendarGrid(
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
  opts: { agentId?: string | null; startDate: string; endDate: string; duration?: number | null; skipPast: boolean },
): Promise<{ agents: CalendarGridAgent[] } | { error: string }> {
  const DAY_MAP: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const NUM_TO_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  let calQuery = supabase
    .from("crm_agent_calendars")
    .select("*, profiles!crm_agent_calendars_agent_id_fkey(id, name, email)")
    .eq("workspace_id", workspaceId);
  if (opts.agentId) calQuery = calQuery.eq("agent_id", opts.agentId);
  const { data: calendars, error: calError } = await calQuery;
  if (calError) return { error: calError.message };
  if (!calendars || calendars.length === 0) return { agents: [] };

  const { data: wsSettings } = await supabase
    .from("workspace_meeting_settings")
    .select("slot_step_minutes")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const workspaceStep = (wsSettings as { slot_step_minutes?: number } | null)?.slot_step_minutes || 15;

  const { data: holidays } = await supabase
    .from("crm_holidays")
    .select("date")
    .eq("workspace_id", workspaceId);
  const holidaySet = new Set(((holidays || []) as Array<{ date: string }>).map((h) => h.date));

  const rangeStart = new Date(`${opts.startDate}T00:00:00.000Z`);
  const rangeEnd = new Date(`${opts.endDate}T23:59:59.999Z`);
  const agentIds = (calendars as Array<{ agent_id: string }>).map((c) => c.agent_id);

  const { data: appts } = await supabase
    .from("crm_appointments")
    .select("id, title, start_time, end_time, assigned_to, status")
    .eq("workspace_id", workspaceId)
    .in("assigned_to", agentIds)
    .neq("status", "cancelled")
    .gte("start_time", new Date(rangeStart.getTime() - 86400000).toISOString())
    .lte("start_time", new Date(rangeEnd.getTime() + 86400000).toISOString())
    .limit(5000);

  const busyByAgent = new Map<string, Array<{ start: Date; end: Date; id: string; title: string | null }>>();
  for (const a of (appts || []) as Array<{ id: string; title: string | null; start_time: string; end_time: string; assigned_to: string }>) {
    const list = busyByAgent.get(a.assigned_to) || [];
    list.push({ start: new Date(a.start_time), end: new Date(a.end_time), id: a.id, title: a.title });
    busyByAgent.set(a.assigned_to, list);
  }

  const minTime = new Date(Date.now() + 10 * 60000);
  const agentsOut: CalendarGridAgent[] = [];

  for (const cal of calendars as Array<Record<string, any>>) {
    const timezone = cal.timezone || "America/Sao_Paulo";
    const workDays: string[] = cal.work_days || ["MON", "TUE", "WED", "THU", "FRI"];
    const workDayNumbers = workDays.map((d) => DAY_MAP[d]);
    const [startHour, startMin] = String(cal.work_start_time || "09:00").split(":").map(Number);
    const [endHour, endMin] = String(cal.work_end_time || "18:00").split(":").map(Number);
    const slotDuration = opts.duration || cal.default_appointment_duration || 30;
    const interval = cal.min_interval_between_appointments || 0;
    const busy = (busyByAgent.get(cal.agent_id) || []).sort((a, b) => a.start.getTime() - b.start.getTime());

    const days: CalendarGridDay[] = [];
    let capacityMinutes = 0;
    let bookedMinutes = 0;
    let totalSlots = 0;
    let freeSlotCount = 0;
    let bookedAppointments = 0;

    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = new Date(cursor.getTime() + 86400000)) {
      const checkDate = new Date(cursor);
      checkDate.setUTCHours(12, 0, 0, 0);
      const dateStr = dateInTz(checkDate, timezone);
      const weekdayShort = checkDate.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" }).toUpperCase().slice(0, 3);
      const dayNum = NUM_TO_DAY.indexOf(weekdayShort);
      const isWorkingDay = workDayNumbers.includes(dayNum);
      const isHoliday = holidaySet.has(dateStr);

      const dayStart = localTimeToUTC(checkDate, startHour, startMin, timezone);
      const dayEnd = localTimeToUTC(checkDate, endHour, endMin, timezone);

      const dayBusy = busy.filter((b) => b.start < dayEnd && b.end > dayStart);
      const busySlots = dayBusy.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        appointment_id: b.id,
        title: b.title,
      }));

      const freeSlots: CalendarGridDay["free_slots"] = [];
      let dayCapacity = 0;
      let dayBooked = 0;

      if (isWorkingDay && !isHoliday) {
        dayCapacity = Math.max(0, Math.round((dayEnd.getTime() - dayStart.getTime()) / 60000));
        for (const b of dayBusy) {
          const s = Math.max(b.start.getTime(), dayStart.getTime());
          const e = Math.min(b.end.getTime(), dayEnd.getTime());
          if (e > s) dayBooked += Math.round((e - s) / 60000);
        }
        bookedAppointments += dayBusy.length;

        let current = new Date(dayStart);
        while (current < dayEnd) {
          const slotEnd = new Date(current.getTime() + slotDuration * 60000);
          if (slotEnd > dayEnd) break;
          totalSlots++;
          const conflict = dayBusy.find((b) => current < b.end && slotEnd > b.start);
          const inPast = opts.skipPast && current <= minTime;
          if (!conflict && !inPast) {
            freeSlots.push({ start: current.toISOString(), end: slotEnd.toISOString(), time: timeInTz(current, timezone) });
            freeSlotCount++;
            current = new Date(current.getTime() + workspaceStep * 60000);
          } else if (conflict) {
            let next = new Date(conflict.end.getTime() + interval * 60000);
            if (next <= current) next = new Date(current.getTime() + workspaceStep * 60000);
            current = next;
          } else {
            current = new Date(current.getTime() + workspaceStep * 60000);
          }
        }
      }

      capacityMinutes += dayCapacity;
      bookedMinutes += dayBooked;

      days.push({
        date: dateStr,
        weekday: weekdayShort,
        is_working_day: isWorkingDay,
        is_holiday: isHoliday,
        available_minutes: Math.max(0, dayCapacity - dayBooked),
        booked_minutes: dayBooked,
        free_slots: freeSlots,
        busy_slots: busySlots,
      });
    }

    const profile = Array.isArray(cal.profiles) ? cal.profiles[0] : cal.profiles;
    agentsOut.push({
      agent_id: cal.agent_id,
      agent_name: profile?.name || profile?.email || null,
      timezone,
      work_days: workDays,
      work_start_time: cal.work_start_time || "09:00",
      work_end_time: cal.work_end_time || "18:00",
      slot_duration_minutes: slotDuration,
      slot_step_minutes: workspaceStep,
      min_interval_minutes: interval,
      days,
      totals: {
        capacity_minutes: capacityMinutes,
        booked_minutes: bookedMinutes,
        free_minutes: Math.max(0, capacityMinutes - bookedMinutes),
        occupancy_rate: capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 1000) / 10 : 0,
        total_slots: totalSlots,
        free_slots: freeSlotCount,
        booked_appointments: bookedAppointments,
      },
    });
  }

  return { agents: agentsOut };
}

function parseRange(url: URL, defaultDays: number): { startDate: string; endDate: string } {
  const today = new Date();
  const startDate = url.searchParams.get("start_date") || today.toISOString().slice(0, 10);
  const endParam = url.searchParams.get("end_date");
  const endDate = endParam ||
    new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + (defaultDays - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate };
}

async function handleAgentCalendars(
  method: string,
  pathParts: string[],
  _url: URL,
  req: Request,
  _ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = _ctx.workspaceId!;
  const agentId = pathParts[0];

  // GET /agent-calendars
  if (method === "GET" && pathParts.length === 0) {
    const { data, error } = await supabase.from("crm_agent_calendars")
      .select("*, profiles!crm_agent_calendars_agent_id_fkey(id, name, email)")
      .eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // GET /agent-calendars/slots — grade completa (livres + ocupados) por atendente
  if (method === "GET" && agentId === "slots") {
    const { startDate, endDate } = parseRange(_url, 7);
    const durationParam = _url.searchParams.get("duration");
    const spanDays = Math.round(
      (new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000,
    ) + 1;
    if (!Number.isFinite(spanDays) || spanDays < 1 || spanDays > 62) {
      return errorResponse("VALIDATION_ERROR", "Intervalo inválido: use até 62 dias entre start_date e end_date");
    }
    const result = await buildCalendarGrid(supabase, workspaceId, {
      agentId: _url.searchParams.get("agent_id"),
      startDate,
      endDate,
      duration: durationParam ? parseInt(durationParam, 10) : null,
      skipPast: _url.searchParams.get("include_past") !== "true",
    });
    if ("error" in result) return errorResponse("DB_ERROR", result.error, 500);
    return successResponse({ period: { start_date: startDate, end_date: endDate }, agents: result.agents });
  }

  // GET /agent-calendars/capacity — taxa de ocupação por atendente
  if (method === "GET" && agentId === "capacity") {
    const { startDate, endDate } = parseRange(_url, 7);
    const spanDays = Math.round(
      (new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000,
    ) + 1;
    if (!Number.isFinite(spanDays) || spanDays < 1 || spanDays > 186) {
      return errorResponse("VALIDATION_ERROR", "Intervalo inválido: use até 186 dias entre start_date e end_date");
    }
    const result = await buildCalendarGrid(supabase, workspaceId, {
      agentId: _url.searchParams.get("agent_id"),
      startDate,
      endDate,
      duration: null,
      skipPast: false,
    });
    if ("error" in result) return errorResponse("DB_ERROR", result.error, 500);

    const agents = result.agents.map((a) => ({
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      timezone: a.timezone,
      work_days: a.work_days,
      work_start_time: a.work_start_time,
      work_end_time: a.work_end_time,
      capacity_minutes: a.totals.capacity_minutes,
      capacity_hours: Math.round((a.totals.capacity_minutes / 60) * 10) / 10,
      booked_minutes: a.totals.booked_minutes,
      booked_hours: Math.round((a.totals.booked_minutes / 60) * 10) / 10,
      free_minutes: a.totals.free_minutes,
      free_hours: Math.round((a.totals.free_minutes / 60) * 10) / 10,
      occupancy_rate: a.totals.occupancy_rate,
      total_slots: a.totals.total_slots,
      free_slots: a.totals.free_slots,
      booked_appointments: a.totals.booked_appointments,
      working_days: a.days.filter((d) => d.is_working_day && !d.is_holiday).length,
    }));

    const capacity = agents.reduce((s, a) => s + a.capacity_minutes, 0);
    const booked = agents.reduce((s, a) => s + a.booked_minutes, 0);

    return successResponse({
      period: { start_date: startDate, end_date: endDate },
      totals: {
        capacity_minutes: capacity,
        capacity_hours: Math.round((capacity / 60) * 10) / 10,
        booked_minutes: booked,
        booked_hours: Math.round((booked / 60) * 10) / 10,
        free_minutes: Math.max(0, capacity - booked),
        free_hours: Math.round((Math.max(0, capacity - booked) / 60) * 10) / 10,
        occupancy_rate: capacity > 0 ? Math.round((booked / capacity) * 1000) / 10 : 0,
        agents: agents.length,
      },
      agents,
    });
  }

  if (!agentId) return errorResponse("NOT_FOUND", "Agent ID required", 404);


  // GET /agent-calendars/:agentId
  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase.from("crm_agent_calendars").select("*").eq("agent_id", agentId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Agent calendar not found", 404);
    return successResponse(data);
  }

  // PUT /agent-calendars/:agentId
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");

    const updates: Record<string, unknown> = {};
    for (const f of ["work_days", "work_start_time", "work_end_time", "timezone", "default_appointment_duration", "min_interval_between_appointments"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    // Upsert: try update first, insert if not found
    const { data: existing } = await supabase.from("crm_agent_calendars").select("id").eq("agent_id", agentId).eq("workspace_id", workspaceId).single();
    if (existing) {
      const { data, error } = await supabase.from("crm_agent_calendars").update(updates).eq("id", existing.id).select("*").single();
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }
    const { data, error } = await supabase.from("crm_agent_calendars").insert({ agent_id: agentId, workspace_id: workspaceId, ...updates }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }

  return errorResponse("NOT_FOUND", "Unknown agent-calendars endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /knowledge-bases
// ---------------------------------------------------------------------------

async function handleKnowledgeBases(
  method: string, pathParts: string[], url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const kbId = pathParts[0];
  const sub = pathParts[1];
  const subId = pathParts[2];

  if (method === "GET" && pathParts.length === 0) {
    const { data, error } = await supabase.from("knowledge_bases").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && pathParts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data, error } = await supabase.from("knowledge_bases").insert({ workspace_id: workspaceId, name: body.name, description: body.description || null }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!kbId) return errorResponse("NOT_FOUND", "Knowledge base ID required", 404);

  // /knowledge-bases/:id/documents
  if (sub === "documents") {
    if (method === "GET" && !subId) {
      const { page, perPage, from, to } = parsePagination(url);
      const { data, error, count } = await supabase.from("documents").select("id, content, metadata, created_at", { count: "exact" }).eq("knowledge_base_id", kbId).order("created_at").range(from, to);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, { page, per_page: perPage, total: count || 0 });
    }
    if (method === "POST" && !subId) {
      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
      const sendClient = adminClient(supabaseUrl, serviceKey);
      const { data, error } = await sendClient.functions.invoke("parse-document", { body: { ...body, knowledge_base_id: kbId, workspace_id: workspaceId } });
      if (error) return errorResponse("PARSE_ERROR", error.message || "Document parse failed", 500);
      return successResponse(data, undefined, 201);
    }
    if (method === "DELETE" && subId) {
      const { error } = await supabase.from("documents").delete().eq("id", parseInt(subId, 10)).eq("knowledge_base_id", kbId);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse({ id: subId, deleted: true });
    }
  }
  // /knowledge-bases/:id/jobs
  if (sub === "jobs" && method === "GET") {
    const { data, error } = await supabase.from("document_processing_jobs").select("*").eq("knowledge_base_id", kbId).order("created_at", { ascending: false });
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  // POST /knowledge-bases/:id/regenerate-embeddings
  if (sub === "regenerate-embeddings" && method === "POST") {
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("regenerate-embeddings", { body: { knowledge_base_id: kbId } });
    if (error) return errorResponse("REGEN_ERROR", error.message || "Regeneration failed", 500);
    return successResponse(data);
  }
  // POST /knowledge-bases/:id/search
  if (sub === "search" && method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.query) return errorResponse("VALIDATION_ERROR", "Field 'query' is required");
    // Use orchestrator's RAG search which handles embedding generation internally
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("orchestrator", {
      body: { action: "rag_search", knowledge_base_id: kbId, query: body.query, limit: body.limit || 5 },
    });
    if (error) return errorResponse("SEARCH_ERROR", error.message || "Search failed", 500);
    return successResponse(data);
  }

  if (method === "GET" && pathParts.length === 1) {
    const { data, error } = await supabase.from("knowledge_bases").select("*").eq("id", kbId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Knowledge base not found", 404);
    return successResponse(data);
  }
  if (method === "PUT" && pathParts.length === 1) {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    if (body?.name !== undefined) updates.name = body.name;
    if (body?.description !== undefined) updates.description = body.description;
    const { data, error } = await supabase.from("knowledge_bases").update(updates).eq("id", kbId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Knowledge base not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE" && pathParts.length === 1) {
    const { error } = await supabase.from("knowledge_bases").delete().eq("id", kbId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: kbId, deleted: true });
  }
  return errorResponse("NOT_FOUND", "Unknown knowledge-bases endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /connections (+ /connections/zapi, /connections/whatsapp)
// ---------------------------------------------------------------------------

async function handleConnections(
  method: string, pathParts: string[], url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const sub = pathParts[0];

  // Z-API sub-routes
  if (sub === "zapi") return handleZapiConnections(method, pathParts.slice(1), req, ctx, supabase, supabaseUrl, serviceKey);
  // WhatsApp Official sub-routes
  if (sub === "whatsapp") return handleWhatsAppConnections(method, pathParts.slice(1), req, ctx, supabase);

  // GET /connections
  if (method === "GET" && pathParts.length === 0) {
    // Scope connections by workspace via connection_workspaces junction table
    if (ctx.workspaceId) {
      const { data: cwRows } = await supabase
        .from("connection_workspaces")
        .select("connection_id, connection_type")
        .eq("workspace_id", ctx.workspaceId)
        .eq("is_active", true);
      const zapiIds = (cwRows || []).filter((r: Record<string, unknown>) => r.connection_type === "zapi").map((r: Record<string, unknown>) => r.connection_id);
      const waIds = (cwRows || []).filter((r: Record<string, unknown>) => r.connection_type === "whatsapp_official").map((r: Record<string, unknown>) => r.connection_id);
      const [zapiRes, waRes] = await Promise.all([
        zapiIds.length > 0
          ? supabase.from("zapi_connections").select("id, instance_id, name, phone_number, is_active, zapi_connected, zapi_payment_status, zapi_due, created_at").in("id", zapiIds).order("created_at")
          : Promise.resolve({ data: [] }),
        waIds.length > 0
          ? supabase.from("whatsapp_connections").select("id, phone_number_id, display_phone_number, verified_name, quality_rating, is_active, created_at").in("id", waIds).order("created_at")
          : Promise.resolve({ data: [] }),
      ]);
      const zapi = (zapiRes.data || []).map((c: Record<string, unknown>) => ({ ...c, connection_type: "zapi" }));
      const wa = (waRes.data || []).map((c: Record<string, unknown>) => ({ ...c, connection_type: "whatsapp_official" }));
      return successResponse([...zapi, ...wa]);
    }
    // Fallback: no workspace filter (admin-level view)
    const [zapiRes, waRes] = await Promise.all([
      supabase.from("zapi_connections").select("id, instance_id, name, phone_number, is_active, zapi_connected, zapi_payment_status, zapi_due, created_at").order("created_at"),
      supabase.from("whatsapp_connections").select("id, phone_number_id, display_phone_number, verified_name, quality_rating, is_active, created_at").order("created_at"),
    ]);
    const zapi = (zapiRes.data || []).map((c: Record<string, unknown>) => ({ ...c, connection_type: "zapi" }));
    const wa = (waRes.data || []).map((c: Record<string, unknown>) => ({ ...c, connection_type: "whatsapp_official" }));
    return successResponse([...zapi, ...wa]);
  }

  if (!sub) return errorResponse("NOT_FOUND", "Connection ID required", 404);
  const connId = sub;
  const connSub = pathParts[1];

  // GET /connections/:id/workspaces
  if (method === "GET" && connSub === "workspaces") {
    const { data, error } = await supabase.from("connection_workspaces").select("*, workspaces(id, name)").eq("connection_id", connId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  // PUT /connections/:id/workspaces
  if (method === "PUT" && connSub === "workspaces") {
    const body = await req.json().catch(() => null);
    if (!body?.workspace_ids) return errorResponse("VALIDATION_ERROR", "Field 'workspace_ids' is required");
    // Get connection type
    const { data: connWs } = await supabase.from("connection_workspaces").select("connection_type").eq("connection_id", connId).limit(1).single();
    const connType = connWs?.connection_type || "zapi";
    await supabase.from("connection_workspaces").delete().eq("connection_id", connId);
    if (body.workspace_ids.length > 0) {
      const rows = body.workspace_ids.map((wsId: string) => ({ connection_id: connId, workspace_id: wsId, connection_type: connType, is_active: true }));
      await supabase.from("connection_workspaces").insert(rows);
    }
    const { data } = await supabase.from("connection_workspaces").select("*, workspaces(id, name)").eq("connection_id", connId);
    return successResponse(data);
  }
  // GET /connections/:id/health
  if (method === "GET" && connSub === "health") {
    const { data, error } = await supabase.from("connection_health_daily").select("*").eq("connection_id", connId).order("date", { ascending: false }).limit(30);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  // GET /connections/:id
  if (method === "GET" && pathParts.length === 1) {
    const { data: zapi } = await supabase.from("zapi_connections").select("*").eq("id", connId).single();
    if (zapi) return successResponse({ ...zapi, connection_type: "zapi" });
    const { data: wa } = await supabase.from("whatsapp_connections").select("*").eq("id", connId).single();
    if (wa) return successResponse({ ...wa, connection_type: "whatsapp_official" });
    return errorResponse("NOT_FOUND", "Connection not found", 404);
  }
  // DELETE /connections/:id
  if (method === "DELETE" && pathParts.length === 1) {
    await supabase.from("zapi_connections").update({ is_active: false }).eq("id", connId);
    await supabase.from("whatsapp_connections").update({ is_active: false }).eq("id", connId);
    return successResponse({ id: connId, deactivated: true });
  }
  return errorResponse("NOT_FOUND", "Unknown connections endpoint", 404);
}

async function handleZapiConnections(
  method: string, parts: string[], req: Request, ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const connId = parts[0];
  const sub = parts[1];

  if (method === "POST" && parts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.instance_id || !body?.api_token) return errorResponse("VALIDATION_ERROR", "Fields 'instance_id' and 'api_token' are required");
    const { data, error } = await supabase.from("zapi_connections").insert({ instance_id: body.instance_id, api_token: body.api_token, name: body.name || null, workspace_id: body.workspace_id || null }).select("id, instance_id, name, is_active, created_at").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (method === "POST" && connId === "validate") {
    const body = await req.json().catch(() => null);
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("zapi-validate-instance", { body });
    if (error) return errorResponse("VALIDATION_ERROR", error.message || "Validation failed", 400);
    return successResponse(data);
  }
  if (method === "POST" && connId === "validate-token") {
    const body = await req.json().catch(() => null);
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("zapi-validate-token", { body });
    if (error) return errorResponse("VALIDATION_ERROR", error.message || "Token validation failed", 400);
    return successResponse(data);
  }
  if (!connId) return errorResponse("NOT_FOUND", "Z-API connection ID required", 404);
  // Guard: connId must look like a UUID to avoid collisions with action routes
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(connId)) return errorResponse("NOT_FOUND", "Unknown Z-API endpoint", 404);
  if (method === "PUT" && parts.length === 1) {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["instance_id", "api_token", "name"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("zapi_connections").update(updates).eq("id", connId).select("id, instance_id, name, is_active").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Connection not found", 404);
    return successResponse(data);
  }
  if (method === "POST" && sub === "revalidate") {
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("zapi-validate-instance", { body: { connection_id: connId } });
    if (error) return errorResponse("REVALIDATION_ERROR", error.message || "Revalidation failed", 500);
    return successResponse(data);
  }
  if (method === "POST" && sub === "control") {
    const body = await req.json().catch(() => null);
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("zapi-instance-control", { body: { connection_id: connId, ...body } });
    if (error) return errorResponse("CONTROL_ERROR", error.message || "Control action failed", 500);
    return successResponse(data);
  }
  if (method === "GET" && sub === "qrcode") {
    const sendClient = adminClient(supabaseUrl, serviceKey);
    const { data, error } = await sendClient.functions.invoke("zapi-instance-control", { body: { connection_id: connId, action: "get_qrcode" } });
    if (error) return errorResponse("QRCODE_ERROR", error.message || "QR code retrieval failed", 500);
    return successResponse(data);
  }
  return errorResponse("NOT_FOUND", "Unknown Z-API endpoint", 404);
}

async function handleWhatsAppConnections(
  method: string, parts: string[], req: Request, ctx: AuthContext,
  supabase: ReturnType<typeof adminClient>,
): Promise<Response> {
  const connId = parts[0];
  const sub = parts[1];

  if (method === "POST" && parts.length === 0) {
    const body = await req.json().catch(() => null);
    if (!body?.access_token || !body?.business_account_id || !body?.phone_number_id) {
      return errorResponse("VALIDATION_ERROR", "Fields 'access_token', 'business_account_id', and 'phone_number_id' are required");
    }
    const { data, error } = await supabase.from("whatsapp_connections").insert({ access_token: body.access_token, business_account_id: body.business_account_id, phone_number_id: body.phone_number_id, display_phone_number: body.display_phone_number || null, verified_name: body.verified_name || null }).select("id, phone_number_id, display_phone_number, is_active, created_at").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!connId) return errorResponse("NOT_FOUND", "WhatsApp connection ID required", 404);
  if (method === "PUT" && parts.length === 1) {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["access_token", "display_phone_number", "verified_name", "is_active"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("whatsapp_connections").update(updates).eq("id", connId).select("id, phone_number_id, display_phone_number, is_active").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Connection not found", 404);
    return successResponse(data);
  }
  if (method === "POST" && sub === "send") {
    const body = await req.json().catch(() => null);
    if (!body?.to || !body?.content) return errorResponse("VALIDATION_ERROR", "Fields 'to' and 'content' are required");
    const { data, error } = await supabase.functions.invoke("whatsapp-send", { body: { connection_id: connId, ...body } });
    if (error) return errorResponse("SEND_ERROR", error.message || "Send failed", 500);
    return successResponse(data);
  }
  return errorResponse("NOT_FOUND", "Unknown WhatsApp endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /routing
// ---------------------------------------------------------------------------

async function handleRouting(
  method: string, pathParts: string[], _url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const sub = pathParts[0];

  if (sub === "config") {
    if (method === "GET") {
      const { data, error } = await supabase.from("workspace_routing_config").select("*").eq("workspace_id", workspaceId).single();
      if (error) return successResponse({ workspace_id: workspaceId, strategy: "round_robin", auto_assign: true });
      return successResponse(data);
    }
    if (method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
      const { data: existing } = await supabase.from("workspace_routing_config").select("id").eq("workspace_id", workspaceId).single();
      if (existing) {
        const { data, error } = await supabase.from("workspace_routing_config").update(body).eq("id", existing.id).select("*").single();
        if (error) return errorResponse("DB_ERROR", error.message, 500);
        return successResponse(data);
      }
      const { data, error } = await supabase.from("workspace_routing_config").insert({ workspace_id: workspaceId, ...body }).select("*").single();
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, undefined, 201);
    }
  }
  if (sub === "agent-assignments") {
    if (method === "GET") {
      const { data, error } = await supabase.from("category_agent_assignments").select("*, chat_categories:category_id(id, name, color), profiles:agent_id(id, name)").eq("workspace_id", workspaceId);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }
    if (method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body?.assignments) return errorResponse("VALIDATION_ERROR", "Field 'assignments' is required");
      await supabase.from("category_agent_assignments").delete().eq("workspace_id", workspaceId);
      if (body.assignments.length > 0) {
        const rows = body.assignments.map((a: Record<string, unknown>) => ({ ...a, workspace_id: workspaceId }));
        const { error } = await supabase.from("category_agent_assignments").insert(rows);
        if (error) return errorResponse("DB_ERROR", error.message, 500);
      }
      const { data } = await supabase.from("category_agent_assignments").select("*").eq("workspace_id", workspaceId);
      return successResponse(data);
    }
  }
  return errorResponse("NOT_FOUND", "Unknown routing endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /chat-categories
// ---------------------------------------------------------------------------

async function handleChatCategories(
  method: string, pathParts: string[], _url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const catId = pathParts[0];

  if (method === "GET" && !catId) {
    const { data, error } = await supabase.from("chat_categories").select("*").eq("workspace_id", workspaceId).order("name");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && !catId) {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse("VALIDATION_ERROR", "Field 'name' is required");
    const { data, error } = await supabase.from("chat_categories").insert({ workspace_id: workspaceId, name: body.name, description: body.description || null, icon: body.icon || null, color: body.color || null, priority: body.priority ?? 0, sla_minutes: body.sla_minutes || null }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!catId) return errorResponse("NOT_FOUND", "Category ID required", 404);
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "description", "icon", "color", "priority", "sla_minutes", "is_active"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("chat_categories").update(updates).eq("id", catId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Category not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE") {
    const { error } = await supabase.from("chat_categories").delete().eq("id", catId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: catId, deleted: true });
  }
  return errorResponse("NOT_FOUND", "Unknown chat-categories endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /availability
// ---------------------------------------------------------------------------

async function handleAvailability(
  method: string, pathParts: string[], _url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const userId = pathParts[0];

  if (method === "GET" && !userId) {
    const { data, error } = await supabase.from("agent_availability").select("*, profiles(id, name, email)").eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "PUT" && !userId) {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse("VALIDATION_ERROR", "Request body is required");
    const updates: Record<string, unknown> = {};
    for (const f of ["max_concurrent_leads", "is_accepting_leads"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data: existing } = await supabase.from("agent_availability").select("id").eq("user_id", ctx.userId).eq("workspace_id", workspaceId).single();
    if (existing) {
      const { data, error } = await supabase.from("agent_availability").update(updates).eq("id", existing.id).select("*").single();
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }
    const { data, error } = await supabase.from("agent_availability").insert({ user_id: ctx.userId, workspace_id: workspaceId, ...updates }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (method === "GET" && userId) {
    const { data, error } = await supabase.from("agent_availability").select("*").eq("user_id", userId).eq("workspace_id", workspaceId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Availability not found", 404);
    return successResponse(data);
  }
  return errorResponse("NOT_FOUND", "Unknown availability endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /notifications
// ---------------------------------------------------------------------------

async function handleNotifications(
  method: string, pathParts: string[], url: URL, _req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const notifId = pathParts[0];
  const sub = pathParts[1];

  if (method === "GET" && pathParts.length === 0) {
    const { page, perPage, from, to } = parsePagination(url);
    const { data, error, count } = await supabase.from("user_notifications").select("*", { count: "exact" }).eq("user_id", ctx.userId).order("created_at", { ascending: false }).range(from, to);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { page, per_page: perPage, total: count || 0 });
  }
  if (method === "PUT" && notifId === "read-all") {
    const { error } = await supabase.from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("user_id", ctx.userId).eq("is_read", false);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ marked_all_read: true });
  }
  if (method === "PUT" && notifId && sub === "read") {
    const { data, error } = await supabase.from("user_notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", notifId).eq("user_id", ctx.userId).select("id, is_read").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Notification not found", 404);
    return successResponse(data);
  }
  return errorResponse("NOT_FOUND", "Unknown notifications endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /analytics
// ---------------------------------------------------------------------------

/**
 * Funil (Lead -> MQL -> SQL -> Venda) fatiado por vendedor (crm_leads.assigned_to).
 *
 * Atribuicao = dono ATUAL do card. Trocar o responsavel reatribui o historico do lead
 * retroativamente; nao ha snapshot do dono por transicao em crm_lead_history.
 *
 * Contagem por etapa = leads que ENTRARAM na etapa dentro da janela
 * (primeira entrada registrada em crm_lead_history.to_stage_id).
 * Ganho/perda = crm_leads.status won|lost com closed_at dentro da janela.
 */
async function computeFunnelBySeller(
  supabase: ReturnType<typeof adminClient>,
  workspaceId: string,
  startDate: string,
  endDate: string,
  assignedTo: string | null,
) {
  const pageSize = 1000;

  // 1) Etapas do pipeline
  const { data: stagesData, error: stagesErr } = await supabase
    .from("crm_pipeline_stages")
    .select("id, name, color, order")
    .eq("workspace_id", workspaceId)
    .order("order", { ascending: true });
  if (stagesErr) throw new Error(stagesErr.message);
  const stages = (stagesData || []) as Array<{ id: string; name: string; color: string | null; order: number }>;

  // 2) Todos os cards do workspace (dono, status, datas) — paginado
  type LeadRow = { id: string; assigned_to: string | null; status: string; created_at: string; closed_at: string | null; stage_id: string | null; value: number | null };
  const leads: LeadRow[] = [];
  {
    let offset = 0;
    while (true) {
      let q = supabase
        .from("crm_leads")
        .select("id, assigned_to, status, created_at, closed_at, stage_id, value")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (assignedTo) q = q.eq("assigned_to", assignedTo);
      const { data, error } = await q.range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      leads.push(...(data as LeadRow[]));
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  const ownerByLead = new Map<string, string | null>();
  for (const l of leads) ownerByLead.set(l.id, l.assigned_to);

  // 3) Primeira entrada de cada lead em cada etapa (historico completo, filtrado depois pela janela)
  const leadIds = leads.map((l) => l.id);
  const firstEntry = new Map<string, Map<string, string>>(); // leadId -> stageId -> ISO
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("crm_lead_history")
      .select("lead_id, to_stage_id, created_at")
      .in("lead_id", chunk)
      .not("to_stage_id", "is", null);
    if (error) throw new Error(error.message);
    for (const h of (data || []) as Array<{ lead_id: string; to_stage_id: string; created_at: string }>) {
      if (!h.created_at) continue;
      let perLead = firstEntry.get(h.lead_id);
      if (!perLead) { perLead = new Map(); firstEntry.set(h.lead_id, perLead); }
      const prev = perLead.get(h.to_stage_id);
      if (!prev || h.created_at < prev) perLead.set(h.to_stage_id, h.created_at);
    }
  }

  // 4) Nomes dos vendedores
  const sellerIds = [...new Set(leads.map((l) => l.assigned_to).filter(Boolean))] as string[];
  const profileMap: Record<string, { id: string; name: string | null; email: string | null }> = {};
  if (sellerIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, name, email").in("id", sellerIds);
    for (const p of (profs || []) as Array<{ id: string; name: string | null; email: string | null }>) {
      profileMap[p.id] = p;
    }
  }

  // 5) Agregacao por vendedor
  const inWindow = (iso: string | null) => !!iso && iso >= startDate && iso < endDate;
  const lower = (s: string) => s.toLowerCase();
  const mqlStage = stages.find((s) => lower(s.name).startsWith("mql"));
  const sqlStage = stages.find((s) => lower(s.name).startsWith("sql"));
  const wonStage = stages.find((s) => lower(s.name).startsWith("venda"));

  type Acc = {
    leads_created: number;
    open: number;
    won: number;
    lost: number;
    value_won: number;
    days_to_won: number[];
    stage: Map<string, number>;
  };
  const accs = new Map<string, Acc>();
  const emptyAcc = (): Acc => ({ leads_created: 0, open: 0, won: 0, lost: 0, value_won: 0, days_to_won: [], stage: new Map() });

  for (const lead of leads) {
    const key = lead.assigned_to || "__unassigned__";
    let acc = accs.get(key);
    if (!acc) { acc = emptyAcc(); accs.set(key, acc); }

    if (inWindow(lead.created_at)) acc.leads_created++;
    if (lead.status === "open") acc.open++;
    if (inWindow(lead.closed_at)) {
      if (lead.status === "won") {
        acc.won++;
        acc.value_won += Number(lead.value || 0);
        const days = (new Date(lead.closed_at as string).getTime() - new Date(lead.created_at).getTime()) / 86400000;
        if (Number.isFinite(days) && days >= 0) acc.days_to_won.push(days);
      } else if (lead.status === "lost") {
        acc.lost++;
      }
    }

    const perLead = firstEntry.get(lead.id);
    if (perLead) {
      for (const [stageId, iso] of perLead.entries()) {
        if (!inWindow(iso)) continue;
        acc.stage.set(stageId, (acc.stage.get(stageId) || 0) + 1);
      }
    }
  }

  const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  const sellers = [...accs.entries()].map(([id, acc]) => {
    const stageCounts = stages.map((s) => ({
      stage_id: s.id,
      stage_name: s.name,
      order: s.order,
      count: acc.stage.get(s.id) || 0,
    }));
    const byStage = (stageId?: string) => (stageId ? acc.stage.get(stageId) || 0 : 0);
    const mql = byStage(mqlStage?.id);
    const sql = byStage(sqlStage?.id);
    const wonStageCount = byStage(wonStage?.id);
    const sequential = stageCounts.slice(0, -1).map((a, i) => {
      const b = stageCounts[i + 1];
      return {
        from_stage_id: a.stage_id, from_stage_name: a.stage_name,
        to_stage_id: b.stage_id, to_stage_name: b.stage_name,
        rate: rate(b.count, a.count),
      };
    });
    const avgDaysToWon = acc.days_to_won.length > 0
      ? Math.round((acc.days_to_won.reduce((s, d) => s + d, 0) / acc.days_to_won.length) * 10) / 10
      : null;

    return {
      seller: id === "__unassigned__"
        ? { id: null, name: "Sem responsavel", email: null }
        : { id, name: profileMap[id]?.name || null, email: profileMap[id]?.email || null },
      leads_created: acc.leads_created,
      open: acc.open,
      won: acc.won,
      lost: acc.lost,
      value_won: Math.round(acc.value_won * 100) / 100,
      avg_days_to_won: avgDaysToWon,
      stage_counts: stageCounts,
      stage_rates: {
        lead_to_mql: rate(mql, acc.leads_created),
        mql_to_sql: rate(sql, mql),
        sql_to_won: rate(acc.won, sql),
        sql_to_won_stage: rate(wonStageCount, sql),
        win_rate: rate(acc.won, acc.won + acc.lost),
      },
      sequential_rates: sequential,
    };
  }).sort((a, b) => b.won - a.won || b.leads_created - a.leads_created);

  return {
    period: { start_date: startDate, end_date: endDate },
    attribution: "current_owner",
    stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, order: s.order })),
    stage_mapping: {
      mql_stage_id: mqlStage?.id || null,
      sql_stage_id: sqlStage?.id || null,
      won_stage_id: wonStage?.id || null,
    },
    sellers,
  };
}



async function handleAnalytics(
  method: string, pathParts: string[], url: URL, _req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const sub = pathParts[0];
  const startDate = url.searchParams.get("start_date") || new Date(Date.now() - 30 * 86400000).toISOString();
  const endDate = url.searchParams.get("end_date") || new Date().toISOString();

  if (method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported", 405);

  if (sub === "overview") {
    const [leadsRes, msgsRes, closedRes] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", startDate).lte("created_at", endDate),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("created_at", startDate).lte("created_at", endDate),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "closed").gte("created_at", startDate).lte("created_at", endDate),
    ]);
    return successResponse({
      total_leads: leadsRes.count || 0, total_messages: msgsRes.count || 0,
      closed_leads: closedRes.count || 0,
      conversion_rate: (leadsRes.count || 0) > 0 ? Math.round(((closedRes.count || 0) / (leadsRes.count || 1)) * 100) : 0,
      period: { start_date: startDate, end_date: endDate },
    });
  }
  if (sub === "leads") {
    const { data, error, count } = await supabase.from("leads").select("id, status, source, created_at", { count: "exact" }).eq("workspace_id", workspaceId).gte("created_at", startDate).lte("created_at", endDate).order("created_at");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { total: count || 0 });
  }
  if (sub === "messages") {
    const { data, error, count } = await supabase.from("messages").select("id, sender_type, media_type, created_at", { count: "exact" }).eq("workspace_id", workspaceId).gte("created_at", startDate).lte("created_at", endDate).order("created_at").limit(1000);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, { total: count || 0 });
  }
  // Funil por vendedor (Lead -> MQL -> SQL -> Venda), baseado em crm_leads.assigned_to.
  if (sub === "funnel-by-seller" || sub === "sellers") {
    const assignedTo = url.searchParams.get("assigned_to") || url.searchParams.get("seller_id") || null;
    try {
      const payload = await computeFunnelBySeller(supabase, workspaceId, startDate, endDate, assignedTo);
      return successResponse(payload);
    } catch (e) {
      return errorResponse("DB_ERROR", (e as Error).message, 500);
    }
  }

  // Desempenho comercial por vendedor (crm_leads.assigned_to), com etapas e taxas.
  // Compat: mantem agent_id/total/closed. Use ?source=ai para as conversas de IA (tabela leads).
  if (sub === "agents") {
    if (url.searchParams.get("source") === "ai") {
      const { data, error } = await supabase.from("leads").select("assigned_agent_id, status").eq("workspace_id", workspaceId).gte("created_at", startDate).lte("created_at", endDate).not("assigned_agent_id", "is", null);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      const agentMap = new Map<string, { total: number; closed: number }>();
      for (const lead of (data || []) as Array<{ assigned_agent_id: string; status: string }>) {
        const existing = agentMap.get(lead.assigned_agent_id) || { total: 0, closed: 0 };
        existing.total++;
        if (lead.status === "closed") existing.closed++;
        agentMap.set(lead.assigned_agent_id, existing);
      }
      return successResponse(Array.from(agentMap.entries()).map(([id, stats]) => ({ agent_id: id, ...stats })));
    }

    try {
      const payload = await computeFunnelBySeller(supabase, workspaceId, startDate, endDate, url.searchParams.get("assigned_to"));
      return successResponse(payload.sellers.map((s) => ({
        agent_id: s.seller.id,
        seller: s.seller,
        total: s.leads_created,
        closed: s.won + s.lost,
        won: s.won,
        lost: s.lost,
        open: s.open,
        value_won: s.value_won,
        avg_days_to_won: s.avg_days_to_won,
        stage_counts: s.stage_counts,
        stage_rates: s.stage_rates,
      })), { attribution: "current_owner", period: payload.period });
    } catch (e) {
      return errorResponse("DB_ERROR", (e as Error).message, 500);
    }
  }

  if (sub === "delivery") {
    const { data, error } = await supabase.from("connection_health_daily").select("*").gte("date", startDate.substring(0, 10)).lte("date", endDate.substring(0, 10)).order("date", { ascending: false }).limit(90);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (sub === "connection-health") {
    const { data, error } = await supabase.from("connection_health_daily").select("*").order("date", { ascending: false }).limit(30);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }

  // ── Sales cycle (ciclo de compra) ───────────────────────────────────
  if (sub === "sales-cycle") {
    const compare = url.searchParams.get("compare") !== "false";
    const utmSource = url.searchParams.get("utm_source") || url.searchParams.get("channel");
    const sourceFilter = url.searchParams.get("source");

    const start = new Date(startDate);
    const end = new Date(endDate);
    const span = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);

    const fetchWon = async (from: Date, to: Date) => {
      const all: any[] = [];
      let offset = 0;
      while (true) {
        let q = supabase
          .from("crm_leads")
          .select("id, created_at, closed_at, utm_source, value, contact:crm_contacts(source)")
          .eq("workspace_id", workspaceId)
          .eq("status", "won")
          .not("closed_at", "is", null)
          .gte("closed_at", from.toISOString())
          .lte("closed_at", to.toISOString())
          .order("closed_at", { ascending: true })
          .range(offset, offset + 999);
        if (utmSource) q = q.eq("utm_source", utmSource);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
        offset += 1000;
      }
      return sourceFilter
        ? all.filter((l) => (l.contact?.source || "").toLowerCase() === sourceFilter.toLowerCase())
        : all;
    };

    const days = (l: any) =>
      Math.max(0, (new Date(l.closed_at).getTime() - new Date(l.created_at).getTime()) / 86400000);
    const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
    const median = (v: number[]) => {
      if (!v.length) return null;
      const s = [...v].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const pct = (v: number[], p: number) => {
      if (!v.length) return null;
      const s = [...v].sort((a, b) => a - b);
      return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))];
    };
    const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
    const breakdown = (rows: any[], keyFn: (l: any) => string) => {
      const map = new Map<string, number[]>();
      rows.forEach((l) => {
        const k = keyFn(l);
        map.set(k, [...(map.get(k) || []), days(l)]);
      });
      return Array.from(map.entries())
        .map(([key, v]) => ({
          key,
          won_count: v.length,
          avg_days: r1(avg(v)),
          median_days: r1(median(v)),
        }))
        .sort((a, b) => b.won_count - a.won_count);
    };

    try {
      const current = await fetchWon(start, end);
      const previous = compare ? await fetchWon(prevStart, prevEnd) : [];
      const monthsStart = new Date();
      monthsStart.setMonth(monthsStart.getMonth() - 11, 1);
      monthsStart.setHours(0, 0, 0, 0);
      const lastYear = await fetchWon(monthsStart, new Date());
      const cur = current.map(days);
      const prev = previous.map(days);

      const buckets: Array<[string, (d: number) => boolean]> = [
        ["0-1", (d) => d <= 1],
        ["2-7", (d) => d > 1 && d <= 7],
        ["8-15", (d) => d > 7 && d <= 15],
        ["16-30", (d) => d > 15 && d <= 30],
        ["31-60", (d) => d > 30 && d <= 60],
        ["60+", (d) => d > 60],
      ];

      return successResponse({
        period: { start_date: startDate, end_date: endDate },
        won_count: current.length,
        avg_days: r1(avg(cur)),
        median_days: r1(median(cur)),
        min_days: cur.length ? r1(Math.min(...cur)) : null,
        max_days: cur.length ? r1(Math.max(...cur)) : null,
        p90_days: r1(pct(cur, 90)),
        total_value: current.reduce((a, l) => a + (Number(l.value) || 0), 0),
        previous_period: compare
          ? {
              start_date: prevStart.toISOString(),
              end_date: prevEnd.toISOString(),
              won_count: previous.length,
              avg_days: r1(avg(prev)),
              median_days: r1(median(prev)),
            }
          : null,
        distribution: buckets.map(([bucket, test]) => ({
          bucket_days: bucket,
          count: cur.filter(test).length,
        })),
        by_source: breakdown(current, (l) => l.contact?.source || "nao_identificado"),
        by_channel: breakdown(current, (l) => l.utm_source || "sem_canal"),
        by_month: (() => {
          const map = new Map<string, number[]>();
          const cursor = new Date();
          cursor.setMonth(cursor.getMonth() - 11, 1);
          for (let i = 0; i < 12; i++) {
            map.set(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`, []);
            cursor.setMonth(cursor.getMonth() + 1);
          }
          lastYear.forEach((l: any) => {
            const d = new Date(new Date(l.closed_at).getTime() - 3 * 3600000);
            const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
            map.set(k, [...(map.get(k) || []), days(l)]);
          });
          return Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([month, v]) => ({
              month,
              won_count: v.length,
              avg_days: r1(avg(v)),
              median_days: r1(median(v)),
            }));
        })(),
      });
    } catch (e) {
      return errorResponse("DB_ERROR", (e as Error).message, 500);
    }
  }

  // ── Pipeline analytics ──────────────────────────────────────────────
  if (sub === "pipeline") {
    const period = url.searchParams.get("period") || "30d";
    const utmSource = url.searchParams.get("utm_source") || null;
    const utmCampaign = url.searchParams.get("utm_campaign") || null;
    const sourceFilter = url.searchParams.get("source") || null;
    const tagFilter = url.searchParams.get("tag") || null;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodLength = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - periodLength).toISOString();
    const prevEnd = start.toISOString();

    const applyUtm = (q: any) => {
      if (utmSource) q = q.eq("utm_source", utmSource);
      if (utmCampaign) q = q.eq("utm_campaign", utmCampaign);
      return q;
    };

    const [
      stagesRes, crmLeadsRes, prevLeadsRes, activitiesRes, prevActivitiesRes,
      lostRes, openRes, wonRes, utmSrcRes, utmCampRes, contactSrcRes,
    ] = await Promise.all([
      supabase.from("crm_pipeline_stages").select("id, name, color, order").eq("workspace_id", workspaceId).order("order"),
      applyUtm(supabase.from("crm_leads").select("id, stage_id, status, created_at, contact_id").eq("workspace_id", workspaceId).gte("created_at", startDate).lt("created_at", endDate)).limit(10000),
      applyUtm(supabase.from("crm_leads").select("id, stage_id, status, created_at, contact_id").eq("workspace_id", workspaceId).gte("created_at", prevStart).lt("created_at", prevEnd)).limit(10000),
      supabase.from("crm_lead_activities").select("id, type, status, scheduled_at, completed_at, created_at, lead_id").eq("workspace_id", workspaceId).gte("scheduled_at", startDate).lt("scheduled_at", endDate).limit(10000),
      supabase.from("crm_lead_activities").select("id, type, status").eq("workspace_id", workspaceId).gte("scheduled_at", prevStart).lt("scheduled_at", prevEnd).limit(10000),
      applyUtm(supabase.from("crm_leads").select("id, loss_reason_id, closed_at, contact_id").eq("workspace_id", workspaceId).eq("status", "lost").gte("closed_at", startDate).lt("closed_at", endDate)).limit(10000),
      applyUtm(supabase.from("crm_leads").select("id, stage_id, status, contact_id").eq("workspace_id", workspaceId).eq("status", "open")).limit(10000),
      applyUtm(supabase.from("crm_leads").select("id, closed_at, status, contact_id").eq("workspace_id", workspaceId).eq("status", "won").gte("closed_at", startDate).lt("closed_at", endDate)).limit(10000),
      supabase.from("crm_leads").select("utm_source").eq("workspace_id", workspaceId).not("utm_source", "is", null).limit(10000),
      supabase.from("crm_leads").select("utm_campaign").eq("workspace_id", workspaceId).not("utm_campaign", "is", null).limit(10000),
      supabase.from("crm_contacts").select("source").eq("workspace_id", workspaceId).not("source", "is", null).limit(10000),
    ]);

    const stages = stagesRes.data || [];
    const uniqueUtmSources = [...new Set((utmSrcRes.data || []).map((r: any) => r.utm_source).filter(Boolean))] as string[];
    const uniqueUtmCampaigns = [...new Set((utmCampRes.data || []).map((r: any) => r.utm_campaign).filter(Boolean))] as string[];
    const uniqueSources = [...new Set((contactSrcRes.data || []).map((r: any) => r.source).filter(Boolean))] as string[];

    // Fetch contacts with tags for tag list + filtering
    const contactsWithTags = await fetchAllRows<{ id: string; tags: any; source: string | null }>(
      (from, to) => supabase.from("crm_contacts").select("id, tags, source").eq("workspace_id", workspaceId).not("tags", "is", null).order("id", { ascending: true }).range(from, to)
    );
    const tagSet = new Set<string>();
    contactsWithTags.forEach((c: any) => {
      if (Array.isArray(c.tags)) {
        c.tags.forEach((t: any) => { if (t && typeof t === "object" && typeof t.name === "string") tagSet.add(t.name); });
      }
    });
    const uniqueTags = [...tagSet].sort();

    // Contact-level filtering (source / tag)
    let allowedContactIds: Set<string> | null = null;
    if (sourceFilter || tagFilter) {
      const allContacts = await fetchAllRows<{ id: string; tags: any; source: string | null }>(
        (from, to) => supabase.from("crm_contacts").select("id, tags, source").eq("workspace_id", workspaceId).order("id", { ascending: true }).range(from, to)
      );
      const filtered = allContacts.filter((c: any) => {
        if (sourceFilter && c.source !== sourceFilter) return false;
        if (tagFilter) {
          const tags = Array.isArray(c.tags) ? c.tags : [];
          if (!tags.some((t: any) => t && typeof t === "object" && t.name === tagFilter)) return false;
        }
        return true;
      });
      allowedContactIds = new Set(filtered.map((c: any) => c.id));
    }

    const filterByContact = (items: any[]): any[] => {
      if (!allowedContactIds) return items;
      return items.filter((i: any) => i.contact_id && allowedContactIds!.has(i.contact_id));
    };

    const crmLeadsInPeriod = filterByContact(crmLeadsRes.data || []);
    const prevCrmLeads = filterByContact(prevLeadsRes.data || []);
    const lostLeads = filterByContact(lostRes.data || []);
    const allOpenLeads = filterByContact(openRes.data || []);
    const wonLeadsInPeriod = filterByContact(wonRes.data || []);
    const activities = activitiesRes.data || [];
    const prevActivities = prevActivitiesRes.data || [];

    // Loss reason names
    const lossReasonNames: Record<string, string> = {};
    const lossReasonIds = [...new Set(lostLeads.map((l: any) => l.loss_reason_id).filter(Boolean))];
    if (lossReasonIds.length > 0) {
      const { data: reasons } = await supabase.from("crm_loss_reasons").select("id, name").in("id", lossReasonIds);
      if (reasons) reasons.forEach((r: any) => { lossReasonNames[r.id] = r.name; });
    }

    // Stage order map
    const stageOrderMap: Record<string, number> = {};
    stages.forEach((s: any) => { stageOrderMap[s.id] = s.order; });

    // Current snapshot: open leads per stage (with lead IDs)
    const currentStageCounts: Record<string, number> = {};
    const currentLeadIdsByStage: Record<string, string[]> = {};
    allOpenLeads.forEach((l: any) => {
      currentStageCounts[l.stage_id] = (currentStageCounts[l.stage_id] || 0) + 1;
      if (!currentLeadIdsByStage[l.stage_id]) currentLeadIdsByStage[l.stage_id] = [];
      currentLeadIdsByStage[l.stage_id].push(l.id);
    });

    // Funnel history (period entries via crm_lead_history)
    const { data: funnelHistoryEntries } = await supabase
      .from("crm_lead_history")
      .select("lead_id, to_stage_id, crm_leads!inner(workspace_id)")
      .eq("crm_leads.workspace_id", workspaceId)
      .or('action.in.(moved,stage_change,stage_entry),action.is.null')
      .not("to_stage_id", "is", null)
      .gte("created_at", startDate)
      .lt("created_at", endDate)
      .limit(10000);

    // Build workspace lead set (respecting filters)
    let wsLeadIdSet: Set<string>;
    if (utmSource || utmCampaign || sourceFilter || tagFilter) {
      const allFilteredLeads = await fetchAllRows<{ id: string; contact_id: string | null }>(
        (from, to) => {
          let q = supabase.from("crm_leads").select("id, contact_id").eq("workspace_id", workspaceId).order("id", { ascending: true }).range(from, to);
          if (utmSource) q = q.eq("utm_source", utmSource);
          if (utmCampaign) q = q.eq("utm_campaign", utmCampaign);
          return q;
        }
      );
      wsLeadIdSet = new Set(filterByContact(allFilteredLeads).map((l: any) => l.id));
    } else {
      const allWsLeads = await fetchAllRows<{ id: string }>(
        (from, to) => supabase.from("crm_leads").select("id").eq("workspace_id", workspaceId).order("id", { ascending: true }).range(from, to)
      );
      wsLeadIdSet = new Set(allWsLeads.map((l: any) => l.id));
    }

    const filteredFunnelHistory = (funnelHistoryEntries || []).filter((h: any) => wsLeadIdSet.has(h.lead_id));

    // Cumulative funnel calculation (with lead IDs per stage)
    const directLeadsByStage: Record<string, Set<string>> = {};
    stages.forEach((s: any) => { directLeadsByStage[s.id] = new Set(); });
    filteredFunnelHistory.forEach((h: any) => {
      if (h.to_stage_id && directLeadsByStage[h.to_stage_id]) directLeadsByStage[h.to_stage_id].add(h.lead_id);
    });

    const leadMaxOrder: Record<string, number> = {};
    stages.forEach((s: any) => {
      directLeadsByStage[s.id].forEach((leadId: string) => {
        const order = stageOrderMap[s.id];
        if (leadMaxOrder[leadId] === undefined || order > leadMaxOrder[leadId]) leadMaxOrder[leadId] = order;
      });
    });

    const periodCountByStage: number[] = stages.map(() => 0);
    const periodLeadIdsByStage: string[][] = stages.map(() => []);
    Object.entries(leadMaxOrder).forEach(([leadId, maxOrder]) => {
      stages.forEach((s: any, i: number) => {
        if (s.order <= maxOrder) {
          periodCountByStage[i]++;
          periodLeadIdsByStage[i].push(leadId);
        }
      });
    });

    const funnel = stages.map((s: any, i: number) => ({
      stage_id: s.id, name: s.name, order: s.order,
      period_value: periodCountByStage[i],
      current_value: currentStageCounts[s.id] || 0,
      period_lead_ids: periodLeadIdsByStage[i],
      current_lead_ids: currentLeadIdsByStage[s.id] || [],
    }));

    // Activity breakdown
    const activityLabels: Record<string, string> = { meeting: "Reuniao", call: "Ligacao", follow_up: "Follow-up", email: "Email", demo: "Demo", task: "Tarefa", reschedule: "Reagendamento" };
    const activityTypeMap: Record<string, { total: number; completed: number; no_show: number; cancelled: number; pending: number }> = {};
    activities.forEach((a: any) => {
      if (!activityTypeMap[a.type]) activityTypeMap[a.type] = { total: 0, completed: 0, no_show: 0, cancelled: 0, pending: 0 };
      activityTypeMap[a.type].total++;
      if (a.status === "completed") activityTypeMap[a.type].completed++;
      else if (a.status === "no_show") activityTypeMap[a.type].no_show++;
      else if (a.status === "cancelled") activityTypeMap[a.type].cancelled++;
      else activityTypeMap[a.type].pending++;
    });
    const activity_breakdown = Object.entries(activityTypeMap).map(([type, stats]) => ({
      type, label: activityLabels[type] || type, ...stats,
    })).sort((a, b) => b.total - a.total);

    // Loss reasons
    const lossReasonGroups: Record<string, number> = {};
    lostLeads.forEach((l: any) => { const key = l.loss_reason_id || "sem_motivo"; lossReasonGroups[key] = (lossReasonGroups[key] || 0) + 1; });
    const totalLost = lostLeads.length;
    const loss_reasons = Object.entries(lossReasonGroups)
      .map(([id, count]) => ({
        reason: id === "sem_motivo" ? "Sem motivo informado" : (lossReasonNames[id] || "Desconhecido"),
        count, percentage: totalLost > 0 ? Math.round((count / totalLost) * 100) : 0,
      })).sort((a, b) => b.count - a.count);

    // KPIs — meetings come from crm_appointments (source of truth)
    // Definitions:
    //   scheduled = appointments with start_time in [startDate, endDate)
    //   realized  = meeting_started_at IS NOT NULL  (meeting actually happened)
    //   no_show   = start_time < now() AND meeting_started_at IS NULL AND status != 'cancelled'
    //   cancelled = status = 'cancelled'
    const { data: apptRows } = await supabase
      .from("crm_appointments")
      .select("id, lead_id, status, start_time, meeting_started_at, contact_joined, actual_duration_seconds")
      .eq("workspace_id", workspaceId)
      .gte("start_time", startDate)
      .lt("start_time", endDate)
      .limit(10000);
    const filteredAppts = (apptRows || []).filter((a: any) => !a.lead_id || wsLeadIdSet.has(a.lead_id));
    const nowISO = new Date().toISOString();

    const apptScheduled = filteredAppts;
    const apptRealized = filteredAppts.filter((a: any) => !!a.meeting_started_at);
    const apptNoShow = filteredAppts.filter((a: any) =>
      !a.meeting_started_at && a.start_time < nowISO && a.status !== "cancelled"
    );
    const apptCancelled = filteredAppts.filter((a: any) => a.status === "cancelled");
    const apptUpcoming = filteredAppts.filter((a: any) => a.start_time >= nowISO && a.status !== "cancelled");

    const meetingsScheduled = apptScheduled.length;
    const meetingsCompleted = apptRealized.length;
    const meetingsNoShow = apptNoShow.length;

    // Previous period appointments for trend
    const { data: prevApptRows } = await supabase
      .from("crm_appointments")
      .select("id, start_time, meeting_started_at, status")
      .eq("workspace_id", workspaceId)
      .gte("start_time", prevStart)
      .lt("start_time", prevEnd)
      .limit(10000);
    const prevMeetings = (prevApptRows || []).length;

    // Reschedules tracked via crm_lead_activities
    const meetingsRescheduled = activities.filter((a: any) => a.type === "reschedule").length;

    const totalCRMLeads = crmLeadsInPeriod.length;
    const prevTotalCRMLeads = prevCrmLeads.length;
    const prevLost = prevCrmLeads.filter((l: any) => l.status === "lost").length;
    const prevWon = prevCrmLeads.filter((l: any) => l.status === "won").length;
    const wonInPeriod = wonLeadsInPeriod.length;
    const calcTrend = (curr: number, prev: number) => prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);
    const conversionLeadToSale = totalCRMLeads > 0 ? Math.round((wonInPeriod / totalCRMLeads) * 100) : 0;

    // Lead ID arrays for drill-down (qualitative data — same as the internal Nexus reports)
    const createdLeadIds = crmLeadsInPeriod.map((l: any) => l.id);
    const wonLeadIdsArr = wonLeadsInPeriod.map((l: any) => l.id);
    const lostLeadIdsArr = lostLeads.map((l: any) => l.id);
    const meetingLeadIds = [...new Set(apptScheduled.map((a: any) => a.lead_id).filter(Boolean))] as string[];
    const meetingCompletedLeadIds = [...new Set(apptRealized.map((a: any) => a.lead_id).filter(Boolean))] as string[];
    const meetingNoShowLeadIds = [...new Set(apptNoShow.map((a: any) => a.lead_id).filter(Boolean))] as string[];
    const meetingCancelledLeadIds = [...new Set(apptCancelled.map((a: any) => a.lead_id).filter(Boolean))] as string[];

    // Timeline via crm_lead_history
    const { data: historyEntries } = await supabase
      .from("crm_lead_history")
      .select("id, lead_id, to_stage_id, created_at, crm_leads!inner(workspace_id)")
      .eq("crm_leads.workspace_id", workspaceId)
      .or('action.in.(moved,stage_change,stage_entry),action.is.null')
      .gte("created_at", startDate)
      .lt("created_at", endDate)
      .limit(10000);

    const filteredHistory = (historyEntries || []).filter((h: any) => wsLeadIdSet.has(h.lead_id));

    // Build timeline buckets
    const findStageId = (keyword: string) => stages.find((s: any) => s.name.toLowerCase().includes(keyword))?.id;
    const leadStageId = findStageId("lead");
    const mqlStageId = findStageId("mql");
    const meetingStageId = findStageId("reuni");
    const negotiationStageId = findStageId("negoci");
    const saleStageId = findStageId("venda");
    const isHourly = period === "today";
    const timeline: Array<{ name: string; leads: number; mql: number; reunioes: number; negociacao: number; vendas: number }> = [];

    if (isHourly) {
      const now = new Date();
      for (let i = 23; i >= 0; i--) {
        const hourStart = new Date(now); hourStart.setHours(now.getHours() - i, 0, 0, 0);
        const hourEnd = new Date(hourStart); hourEnd.setHours(hourStart.getHours() + 1);
        const inRange = filteredHistory.filter((h: any) => { const c = new Date(h.created_at || ""); return c >= hourStart && c < hourEnd; });
        timeline.push({
          name: `${hourStart.getHours()}h`,
          leads: inRange.filter((h: any) => h.to_stage_id === leadStageId).length,
          mql: inRange.filter((h: any) => h.to_stage_id === mqlStageId).length,
          reunioes: inRange.filter((h: any) => h.to_stage_id === meetingStageId).length,
          negociacao: inRange.filter((h: any) => h.to_stage_id === negotiationStageId).length,
          vendas: inRange.filter((h: any) => h.to_stage_id === saleStageId).length,
        });
      }
    } else {
      const diffMs = end.getTime() - start.getTime();
      const days = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 1);
      for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date(end); dayStart.setDate(end.getDate() - i); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart); dayEnd.setDate(dayStart.getDate() + 1);
        const inRange = filteredHistory.filter((h: any) => { const c = new Date(h.created_at || ""); return c >= dayStart && c < dayEnd; });
        const dd = String(dayStart.getDate()).padStart(2, "0");
        const mm = String(dayStart.getMonth() + 1).padStart(2, "0");
        timeline.push({
          name: `${dd}/${mm}`,
          leads: inRange.filter((h: any) => h.to_stage_id === leadStageId).length,
          mql: inRange.filter((h: any) => h.to_stage_id === mqlStageId).length,
          reunioes: inRange.filter((h: any) => h.to_stage_id === meetingStageId).length,
          negociacao: inRange.filter((h: any) => h.to_stage_id === negotiationStageId).length,
          vendas: inRange.filter((h: any) => h.to_stage_id === saleStageId).length,
        });
      }
    }

    // Funnel rates
    const firstStageCount = funnel.length > 0 ? funnel[0].period_value : 0;
    const mqlIdx = stages.findIndex((s: any) => s.name.toLowerCase().startsWith("mql"));
    const mqlCount = mqlIdx >= 0 ? funnel[mqlIdx].period_value : 0;
    const funnel_rates = {
      lead_to_sale: firstStageCount > 0 ? Math.round((wonInPeriod / firstStageCount) * 100) : 0,
      mql_to_sale: mqlCount > 0 ? Math.round((wonInPeriod / mqlCount) * 100) : 0,
      no_show_rate: meetingsScheduled > 0 ? Math.round((meetingsNoShow / meetingsScheduled) * 100) : 0,
      realized_rate: meetingsScheduled > 0 ? Math.round((meetingsCompleted / meetingsScheduled) * 100) : 0,
      reschedule_rate: meetingsScheduled > 0 ? Math.round((meetingsRescheduled / meetingsScheduled) * 100) : 0,
    };

    return successResponse({
      kpis: {
        total_leads: totalCRMLeads,
        meetings_scheduled: meetingsScheduled,
        meetings_completed: meetingsCompleted,
        meetings_realized: meetingsCompleted,    // alias — meeting_started_at IS NOT NULL
        meetings_no_show: meetingsNoShow,
        meetings_cancelled: apptCancelled.length,
        meetings_upcoming: apptUpcoming.length,
        meetings_rescheduled: meetingsRescheduled,
        conversion_lead_to_sale: conversionLeadToSale,
        total_lost: totalLost, total_won: wonInPeriod,
        trends: {
          leads: calcTrend(totalCRMLeads, prevTotalCRMLeads),
          meetings: calcTrend(meetingsScheduled, prevMeetings),
          lost: calcTrend(totalLost, prevLost),
          won: calcTrend(wonInPeriod, prevWon),
        },
        // Lead ID arrays for qualitative drill-down (parity with internal Nexus reports)
        lead_ids: {
          created: createdLeadIds,
          won: wonLeadIdsArr,
          lost: lostLeadIdsArr,
          meeting_scheduled: meetingLeadIds,
          meeting_realized: meetingCompletedLeadIds,
          meeting_no_show: meetingNoShowLeadIds,
          meeting_cancelled: meetingCancelledLeadIds,
        },
      },
      funnel, funnel_rates, activity_breakdown, loss_reasons, timeline,
      available_filters: { utm_sources: uniqueUtmSources.sort(), utm_campaigns: uniqueUtmCampaigns.sort(), sources: uniqueSources.sort(), tags: uniqueTags },
      period: { start_date: startDate, end_date: endDate },
    });
  }

  // ── Cohort analytics ────────────────────────────────────────────────
  if (sub === "cohort") {
    const monthsBack = Math.min(Math.max(parseInt(url.searchParams.get("months_back") || "6") || 6, 1), 12);
    const utmSource = url.searchParams.get("utm_source") || null;
    const utmCampaign = url.searchParams.get("utm_campaign") || null;
    // Recorte por dono do card (crm_leads.assigned_to). Ausente = agregado do workspace.
    const assignedTo = url.searchParams.get("assigned_to") || url.searchParams.get("seller_id") || null;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);
    const cutoffISO = cutoff.toISOString();

    let leadsQuery = supabase
      .from("crm_leads")
      .select("id, created_at, status, closed_at, value, stage_id, utm_source, utm_campaign, assigned_to")
      .eq("workspace_id", workspaceId)
      .gte("created_at", cutoffISO);
    if (assignedTo) leadsQuery = leadsQuery.eq("assigned_to", assignedTo);
    if (utmSource) leadsQuery = leadsQuery.eq("utm_source", utmSource);
    if (utmCampaign) leadsQuery = leadsQuery.eq("utm_campaign", utmCampaign);

    const [stagesRes, leadsRes, utmSrcRes, utmCampRes] = await Promise.all([
      supabase.from("crm_pipeline_stages").select("id, name, order").eq("workspace_id", workspaceId).order("order"),
      leadsQuery,
      supabase.from("crm_leads").select("utm_source").eq("workspace_id", workspaceId).not("utm_source", "is", null).limit(10000),
      supabase.from("crm_leads").select("utm_campaign").eq("workspace_id", workspaceId).not("utm_campaign", "is", null).limit(10000),
    ]);

    const stages = (stagesRes.data || []) as Array<{ id: string; name: string; order: number }>;
    const leads = leadsRes.data || [];
    const availableUtmSources = [...new Set((utmSrcRes.data || []).map((r: any) => r.utm_source).filter(Boolean))] as string[];
    const availableUtmCampaigns = [...new Set((utmCampRes.data || []).map((r: any) => r.utm_campaign).filter(Boolean))] as string[];

    if (leads.length === 0) {
      return successResponse({ stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order })), avg_conversion_days: {}, cohorts: [], available_filters: { utm_sources: availableUtmSources, utm_campaigns: availableUtmCampaigns } });
    }

    // Fetch history in batches of 200
    const leadIds = leads.map((l: any) => l.id);
    const historyEntries: Array<{ lead_id: string; to_stage_id: string | null; created_at: string | null }> = [];
    const chunkSize = 200;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const { data: histChunk } = await supabase.from("crm_lead_history").select("lead_id, to_stage_id, created_at").in("lead_id", chunk).not("to_stage_id", "is", null);
      if (histChunk) historyEntries.push(...histChunk);
    }

    // Build first-entry map: leadId -> stageId -> earliest Date
    const firstEntry: Record<string, Record<string, Date>> = {};
    for (const h of historyEntries) {
      if (!h.to_stage_id || !h.created_at) continue;
      if (!firstEntry[h.lead_id]) firstEntry[h.lead_id] = {};
      const entryDate = new Date(h.created_at);
      const existing = firstEntry[h.lead_id][h.to_stage_id];
      if (!existing || entryDate < existing) firstEntry[h.lead_id][h.to_stage_id] = entryDate;
    }

    const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const getCohortKey = (dateStr: string) => { const d = new Date(dateStr); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
    const getCohortLabel = (key: string) => { const [year, month] = key.split("-"); return `${MONTH_NAMES[parseInt(month) - 1]}/${year.slice(2)}`; };
    const diffMonths = (d1: Date, d2: Date) => (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    const diffDays = (d1: Date, d2: Date) => Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

    // Group leads by cohort
    const cohortMap: Record<string, any[]> = {};
    for (const lead of leads) {
      if (!lead.created_at) continue;
      const key = getCohortKey(lead.created_at);
      if (!cohortMap[key]) cohortMap[key] = [];
      cohortMap[key].push(lead);
    }

    const stageOrderMap: Record<string, number> = {};
    stages.forEach((s) => { stageOrderMap[s.id] = s.order; });
    const globalDaysToStage: Record<string, number[]> = {};
    stages.forEach((s) => { globalDaysToStage[s.id] = []; });

    const excludeLostPrefixes = ["venda", "em contrato", "iniciado"];
    const shouldExcludeLost = (name: string) => excludeLostPrefixes.some((p) => name.toLowerCase().startsWith(p));

    const mqlStage = stages.find((s) => s.name.toLowerCase().startsWith("mql"));
    const mqlStageId = mqlStage?.id;
    const mqlOrder = mqlStage?.order ?? Infinity;

    const cohorts = Object.keys(cohortMap).sort().map((key) => {
      const cohortLeads = cohortMap[key];
      const totalLeads = cohortLeads.length;
      const open = cohortLeads.filter((l: any) => l.status === "open").length;

      const hasPassedMQL = (lead: any) => {
        if (!mqlStageId) return true;
        if (firstEntry[lead.id]?.[mqlStageId]) return true;
        return (stageOrderMap[lead.stage_id] ?? -1) >= mqlOrder;
      };

      const wonLeads = cohortLeads.filter((l: any) => l.status === "won" && hasPassedMQL(l));
      const lostLeads = cohortLeads.filter((l: any) => l.status === "lost" && hasPassedMQL(l));
      const won = wonLeads.length;
      const lost = lostLeads.length;
      const revenue = wonLeads.reduce((sum: number, l: any) => sum + (l.value || 0), 0);

      const mqlReachedCount = cohortLeads.filter((l: any) => hasPassedMQL(l)).length;
      const wip = Math.max(0, mqlReachedCount - won - lost);

      // Stage counts & avg days
      const stage_counts: Record<string, number> = {};
      const stage_rates: Record<string, number> = {};
      const daysAccum: Record<string, number[]> = {};
      stages.forEach((s) => { daysAccum[s.id] = []; });

      for (const lead of cohortLeads) {
        const leadCreated = new Date(lead.created_at!);
        const leadHistory = firstEntry[lead.id] || {};
        for (const stage of stages) {
          if (lead.status === "lost" && shouldExcludeLost(stage.name)) continue;
          const currentOrder = stageOrderMap[lead.stage_id] ?? -1;
          const hasReached = leadHistory[stage.id] || currentOrder >= stage.order;
          if (hasReached) {
            stage_counts[stage.id] = (stage_counts[stage.id] || 0) + 1;
            if (leadHistory[stage.id]) {
              const days = diffDays(leadCreated, leadHistory[stage.id]);
              if (days >= 0) { daysAccum[stage.id].push(days); globalDaysToStage[stage.id].push(days); }
            }
          }
        }
      }

      stages.forEach((s) => { stage_rates[s.id] = totalLeads > 0 ? Math.round(((stage_counts[s.id] || 0) / totalLeads) * 1000) / 10 : 0; });
      const avg_days_to_stage: Record<string, number | null> = {};
      stages.forEach((s) => { const arr = daysAccum[s.id]; avg_days_to_stage[s.id] = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null; });

      // Evolution matrix
      const evolution_matrix: Record<number, number> = {};
      for (const lead of cohortLeads) {
        if (lead.status === "won" && lead.closed_at && lead.created_at) {
          const mIdx = diffMonths(new Date(lead.created_at), new Date(lead.closed_at));
          evolution_matrix[mIdx] = (evolution_matrix[mIdx] || 0) + 1;
        }
      }

      return {
        cohort_key: key, cohort_label: getCohortLabel(key), total_leads: totalLeads,
        stage_counts, stage_rates, avg_days_to_stage,
        won, lost, open, wip,
        wip_rate: mqlReachedCount > 0 ? Math.round((wip / mqlReachedCount) * 1000) / 10 : 0,
        won_rate: mqlReachedCount > 0 ? Math.round((won / mqlReachedCount) * 1000) / 10 : 0,
        lost_rate: mqlReachedCount > 0 ? Math.round((lost / mqlReachedCount) * 1000) / 10 : 0,
        revenue, avg_ticket: won > 0 ? Math.round(revenue / won) : 0,
        revenue_per_lead: totalLeads > 0 ? Math.round(revenue / totalLeads) : 0,
        evolution_matrix,
      };
    });

    // Global avg conversion days
    const avg_conversion_days: Record<string, number | null> = {};
    stages.forEach((s) => { const arr = globalDaysToStage[s.id]; avg_conversion_days[s.id] = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null; });

    return successResponse({
      stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order })),
      avg_conversion_days, cohorts,
      available_filters: { utm_sources: availableUtmSources, utm_campaigns: availableUtmCampaigns },
    });
  }

  return errorResponse("NOT_FOUND", "Unknown analytics endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /tools
// ---------------------------------------------------------------------------

async function handleTools(
  method: string, pathParts: string[], _url: URL, _req: Request,
  _ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const toolId = pathParts[0];

  if (method === "GET" && !toolId) {
    const { data, error } = await supabase.from("tool_catalog").select("*").eq("is_active", true).order("display_order");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "GET" && toolId) {
    const { data, error } = await supabase.from("tool_catalog").select("*").eq("id", toolId).single();
    if (error || !data) return errorResponse("NOT_FOUND", "Tool not found", 404);
    return successResponse(data);
  }
  return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
}

// ---------------------------------------------------------------------------
// Route: /widgets
// ---------------------------------------------------------------------------

async function handleWidgets(
  method: string, pathParts: string[], _url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;
  const widgetId = pathParts[0];

  if (method === "GET" && !widgetId) {
    const { data, error } = await supabase.from("widget_configs").select("*").eq("workspace_id", workspaceId).order("created_at");
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data);
  }
  if (method === "POST" && !widgetId) {
    const body = await req.json().catch(() => null);
    if (!body?.name || !body?.slug) return errorResponse("VALIDATION_ERROR", "Fields 'name' and 'slug' are required");
    const { data, error } = await supabase.from("widget_configs").insert({ workspace_id: workspaceId, name: body.name, slug: body.slug, type: body.type || "standalone", settings: body.settings || {}, agent_id: body.agent_id || null, is_active: body.is_active ?? true }).select("*").single();
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse(data, undefined, 201);
  }
  if (!widgetId) return errorResponse("NOT_FOUND", "Widget ID required", 404);
  if (method === "PUT") {
    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};
    for (const f of ["name", "slug", "type", "settings", "agent_id", "is_active", "allowed_origins"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
    const { data, error } = await supabase.from("widget_configs").update(updates).eq("id", widgetId).eq("workspace_id", workspaceId).select("*").single();
    if (error || !data) return errorResponse("NOT_FOUND", "Widget not found", 404);
    return successResponse(data);
  }
  if (method === "DELETE") {
    const { error } = await supabase.from("widget_configs").delete().eq("id", widgetId).eq("workspace_id", workspaceId);
    if (error) return errorResponse("DB_ERROR", error.message, 500);
    return successResponse({ id: widgetId, deleted: true });
  }
  return errorResponse("NOT_FOUND", "Unknown widgets endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /public (no auth)
// ---------------------------------------------------------------------------

async function handlePublic(
  method: string, pathParts: string[], _url: URL, req: Request,
  supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  // /public/widgets/:slug
  if (pathParts[0] === "widgets") {
    const slug = pathParts[1];
    if (!slug) return errorResponse("NOT_FOUND", "Widget slug required", 404);
    if (method === "GET" && pathParts.length === 2) {
      const { data, error } = await supabase.from("widget_configs").select("id, name, slug, type, settings, is_active").eq("slug", slug).eq("is_active", true).single();
      if (error || !data) return errorResponse("NOT_FOUND", "Widget not found", 404);
      return successResponse(data);
    }
    // POST /public/widgets/:slug/sessions
    if (method === "POST" && pathParts[2] === "sessions") {
      const body = await req.json().catch(() => null);
      const { data: widget } = await supabase.from("widget_configs").select("id").eq("slug", slug).eq("is_active", true).single();
      if (!widget) return errorResponse("NOT_FOUND", "Widget not found", 404);
      const sessionToken = crypto.randomUUID();
      const { data, error } = await supabase.from("widget_sessions").insert({ widget_config_id: widget.id, session_token: sessionToken, visitor_info: body?.visitor_info || null }).select("id, session_token, created_at").single();
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, undefined, 201);
    }
  }
  return errorResponse("NOT_FOUND", "Unknown public endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /webhooks (no auth, signature-based)
// ---------------------------------------------------------------------------

async function handleWebhooks(
  method: string, pathParts: string[], url: URL, req: Request,
  supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);
  const platform = pathParts[0];

  if (platform === "whatsapp") {
    if (method === "GET") {
      // Meta webhook verification
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && challenge) {
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } });
      }
      return errorResponse("FORBIDDEN", "Verification failed", 403);
    }
    if (method === "POST") {
      const body = await req.json().catch(() => null);
      const { data, error } = await supabase.functions.invoke("whatsapp-webhook", { body });
      if (error) console.error("Webhook processing error:", error);
      return successResponse({ received: true });
    }
  }
  if (platform === "zapi") {
    if (method === "GET") return successResponse({ status: "ok" });
    if (method === "POST") {
      const body = await req.json().catch(() => null);
      const { data, error } = await supabase.functions.invoke("zapi-webhook", { body });
      if (error) console.error("Z-API webhook error:", error);
      return successResponse({ received: true });
    }
  }
  return errorResponse("NOT_FOUND", "Unknown webhook platform", 404);
}

// ---------------------------------------------------------------------------
// Route: /internal
// ---------------------------------------------------------------------------

async function handleInternal(
  method: string, pathParts: string[], _url: URL, req: Request,
  _ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  if (method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", "Only POST is supported", 405);
  const supabase = adminClient(supabaseUrl, serviceKey);
  const path = pathParts.join("/");
  const body = await req.json().catch(() => null);

  const fnMap: Record<string, string> = {
    "orchestrator": "orchestrator",
    "cron/health-check": "zapi-health-check",
    "cron/health-metrics": "connection-health-metrics",
    "process-document": "process-document-background",
    "process-pdf": "process-pdf-pages",
    "generate-embeddings": "generate-embeddings-background",
  };
  const fnName = fnMap[path];
  if (!fnName) return errorResponse("NOT_FOUND", `Unknown internal endpoint: ${path}`, 404);

  const { data, error } = await supabase.functions.invoke(fnName, { body: body || {} });
  if (error) return errorResponse("INTERNAL_ERROR", error.message || `${fnName} failed`, 500);
  return successResponse(data);
}

// ---------------------------------------------------------------------------
// Route: /admin (super_admin only)
// ---------------------------------------------------------------------------

async function handleAdmin(
  method: string, pathParts: string[], url: URL, req: Request,
  ctx: AuthContext, supabaseUrl: string, serviceKey: string,
): Promise<Response> {
  const supabase = adminClient(supabaseUrl, serviceKey);

  // Verify super_admin
  const { data: roleCheck } = await supabase.from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "super_admin").single();
  if (!roleCheck) return errorResponse("FORBIDDEN", "Only super_admin can access admin endpoints", 403);

  const sub = pathParts[0];
  const subId = pathParts[1];
  const subSub = pathParts[2];

  // /admin/companies
  if (sub === "companies") {
    if (method === "GET" && !subId) {
      const { page, perPage, from, to } = parsePagination(url);
      const { data, error, count } = await supabase.from("companies").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, { page, per_page: perPage, total: count || 0 });
    }
    if (method === "GET" && subId && !subSub) {
      const { data, error } = await supabase.from("companies").select("*").eq("id", subId).single();
      if (error || !data) return errorResponse("NOT_FOUND", "Company not found", 404);
      return successResponse(data);
    }
    if (method === "PUT" && subId) {
      const body = await req.json().catch(() => null);
      const updates: Record<string, unknown> = {};
      for (const f of ["name", "description", "icon"]) { if (body?.[f] !== undefined) updates[f] = body[f]; }
      const { data, error } = await supabase.from("companies").update(updates).eq("id", subId).select("*").single();
      if (error || !data) return errorResponse("NOT_FOUND", "Company not found", 404);
      return successResponse(data);
    }
    if (method === "DELETE" && subId) {
      const { error } = await supabase.from("companies").delete().eq("id", subId);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse({ id: subId, deleted: true });
    }
  }
  // /admin/users
  if (sub === "users") {
    if (method === "GET" && !subId) {
      const { page, perPage, from, to } = parsePagination(url);
      const { data, error, count } = await supabase.from("profiles").select("id, email, name, phone, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data, { page, per_page: perPage, total: count || 0 });
    }
    if (method === "PUT" && subId && subSub === "role") {
      const body = await req.json().catch(() => null);
      if (!body?.role) return errorResponse("VALIDATION_ERROR", "Field 'role' is required");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", subId)
        .maybeSingle();

      if (profileError) return errorResponse("DB_ERROR", profileError.message, 500);
      if (!profile) return errorResponse("NOT_FOUND", "User not found", 404);

      const { error: deleteError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", subId);
      if (deleteError) return errorResponse("DB_ERROR", deleteError.message, 500);

      const { data, error } = await supabase
        .from("user_roles")
        .insert({ user_id: subId, role: body.role })
        .select("*")
        .single();

      if (error) return errorResponse("DB_ERROR", error.message, 500);
      return successResponse(data);
    }
  }
  return errorResponse("NOT_FOUND", "Unknown admin endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route: /cadences (workspace-scoped) — Relatórios de Réguas
// ---------------------------------------------------------------------------

interface CadenceRuleRow {
  id: string;
  company_id: string;
  trigger_type: "activity" | "stage";
  activity_type: string | null;
  stage_id: string | null;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CadenceScheduledMessageRow {
  id: string;
  lead_id: string;
  activity_id: string | null;
  status: string;
  error: string | null;
  send_at: string;
  sent_at: string | null;
  created_at: string;
  message_id: number | null;
  template_id: string;
}

interface CadenceStatsPayload {
  range: { from: string | null; to: string | null };
  activations: number;
  started: number;
  messages: {
    total: number;
    delivered: number;
    pending: number;
    not_delivered: number;
  };
  activities?: {
    open: number;
    overdue: number;
    completed: number;
    other: number;
  };
}

function defaultCadenceRange(url: URL): { from: string | null; to: string | null } {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  if (fromParam || toParam) {
    return { from: fromParam || null, to: toParam || null };
  }
  // default últimos 7 dias
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function previousRange(
  bounds: { from: string | null; to: string | null },
): { from: string | null; to: string | null } {
  if (!bounds.from || !bounds.to) return { from: null, to: null };
  const fromMs = new Date(bounds.from).getTime();
  const toMs = new Date(bounds.to).getTime();
  const span = toMs - fromMs;
  const prevTo = new Date(fromMs - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from: prevFrom.toISOString(), to: prevTo.toISOString() };
}

async function fetchCadenceRuleScoped(
  supabase: ReturnType<typeof adminClient>,
  ruleId: string,
  workspaceId: string,
): Promise<{ rule: CadenceRuleRow | null; error?: Response }> {
  // workspace -> company
  const { data: ws } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", workspaceId)
    .single();
  if (!ws) return { rule: null, error: errorResponse("NOT_FOUND", "Workspace not found", 404) };

  const { data: rule } = await supabase
    .from("cadence_rules")
    .select("id, company_id, trigger_type, activity_type, stage_id, name, is_active, created_at, updated_at")
    .eq("id", ruleId)
    .eq("company_id", ws.company_id)
    .single();

  if (!rule) return { rule: null, error: errorResponse("NOT_FOUND", "Cadence rule not found in this workspace", 404) };
  return { rule: rule as CadenceRuleRow };
}

async function loadCadenceStats(
  supabase: ReturnType<typeof adminClient>,
  rule: CadenceRuleRow,
  workspaceId: string,
  bounds: { from: string | null; to: string | null },
): Promise<CadenceStatsPayload> {
  const csmRows = await fetchAllRows<CadenceScheduledMessageRow>((f, t) => {
    let q = supabase
      .from("cadence_scheduled_messages")
      .select("id, lead_id, activity_id, status, error, send_at, sent_at, created_at, message_id, template_id")
      .eq("rule_id", rule.id)
      .eq("workspace_id", workspaceId)
      .not("status", "in", "(skipped,cancelled)")
      .range(f, t);
    if (bounds.from) q = q.gte("created_at", bounds.from);
    if (bounds.to) q = q.lte("created_at", bounds.to);
    return q;
  });

  const linkedIds = Array.from(
    new Set(csmRows.map((r) => r.message_id).filter((x): x is number => !!x)),
  );
  const deliveryMap = new Map<number, string | null>();
  if (linkedIds.length > 0) {
    const linked = await fetchAllRows<{ id: number; delivery_status: string | null }>((f, t) =>
      supabase.from("messages").select("id, delivery_status").in("id", linkedIds).range(f, t),
    );
    for (const l of linked) deliveryMap.set(l.id, l.delivery_status);
  }

  const TOLERANCE_MS = 2 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const DELIVERED_STATUSES = new Set(["delivered", "read"]);

  const classify = (m: CadenceScheduledMessageRow): "delivered" | "pending" | "notDelivered" => {
    if (m.status === "pending") return m.error ? "notDelivered" : "pending";
    if (m.status !== "sent") return "notDelivered";
    if (m.message_id == null) return "delivered";
    const ds = deliveryMap.get(m.message_id);
    if (ds && DELIVERED_STATUSES.has(ds)) return "delivered";
    const sentMs = m.sent_at ? new Date(m.sent_at).getTime() : 0;
    if (sentMs && nowMs - sentMs < TOLERANCE_MS) return "pending";
    return "notDelivered";
  };

  let total = 0, delivered = 0, pending = 0, notDelivered = 0;
  const leadSet = new Set<string>();
  const startedSet = new Set<string>();
  for (const m of csmRows) {
    total++;
    leadSet.add(m.lead_id);
    startedSet.add(m.activity_id ?? `lead:${m.lead_id}`);
    const c = classify(m);
    if (c === "delivered") delivered++;
    else if (c === "pending") pending++;
    else notDelivered++;
  }

  const payload: CadenceStatsPayload = {
    range: bounds,
    activations: leadSet.size,
    started: startedSet.size,
    messages: { total, delivered, pending, not_delivered: notDelivered },
  };

  if (rule.trigger_type === "activity" && rule.activity_type) {
    const nowIso = new Date().toISOString();
    const baseAct = () => {
      let q = supabase
        .from("crm_lead_activities")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("type", rule.activity_type!);
      if (bounds.from) q = q.gte("scheduled_at", bounds.from);
      if (bounds.to) q = q.lte("scheduled_at", bounds.to);
      return q;
    };
    const [openCount, overdueCount, completedCount, totalActs] = await Promise.all([
      baseAct().eq("status", "pending").gte("scheduled_at", nowIso).then((r: any) => r.count || 0),
      baseAct().eq("status", "pending").lt("scheduled_at", nowIso).then((r: any) => r.count || 0),
      baseAct().eq("status", "completed").then((r: any) => r.count || 0),
      baseAct().then((r: any) => r.count || 0),
    ]);
    payload.activities = {
      open: openCount,
      overdue: overdueCount,
      completed: completedCount,
      other: Math.max(0, totalActs - openCount - overdueCount - completedCount),
    };
  }

  return payload;
}

async function handleCadences(
  method: string,
  pathParts: string[],
  url: URL,
  _req: Request,
  ctx: AuthContext,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  if (method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", `${method} is not supported on /cadences`, 405);
  }
  const supabase = adminClient(supabaseUrl, serviceKey);
  const workspaceId = ctx.workspaceId!;

  // Resolve company_id from workspace
  const { data: ws } = await supabase
    .from("workspaces")
    .select("company_id")
    .eq("id", workspaceId)
    .single();
  if (!ws) return errorResponse("NOT_FOUND", "Workspace not found", 404);
  const companyId = (ws as { company_id: string }).company_id;

  const sub = pathParts[0]; // "rules" | "summary"
  const ruleId = pathParts[1];
  const subSub = pathParts[2]; // "stats" | "messages" | "activations" | "activities"

  // GET /cadences/summary
  if (sub === "summary" && !ruleId) {
    const bounds = defaultCadenceRange(url);
    const { data: rules } = await supabase
      .from("cadence_rules")
      .select("id, company_id, trigger_type, activity_type, stage_id, name, is_active, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    const items = await Promise.all(
      ((rules as CadenceRuleRow[]) || []).map(async (rule) => {
        const stats = await loadCadenceStats(supabase, rule, workspaceId, bounds);
        return {
          rule_id: rule.id,
          name: rule.name,
          trigger_type: rule.trigger_type,
          activity_type: rule.activity_type,
          stage_id: rule.stage_id,
          is_active: rule.is_active,
          ...stats,
        };
      }),
    );
    return successResponse(items, { range: bounds });
  }

  // GET /cadences/rules
  if (sub === "rules" && !ruleId) {
    let q = supabase
      .from("cadence_rules")
      .select("id, company_id, trigger_type, activity_type, stage_id, name, is_active, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    const trigger = url.searchParams.get("trigger_type");
    if (trigger === "activity" || trigger === "stage") q = q.eq("trigger_type", trigger);
    const isActive = url.searchParams.get("is_active");
    if (isActive === "true" || isActive === "false") q = q.eq("is_active", isActive === "true");

    const { data, error } = await q;
    if (error) return errorResponse("DB_ERROR", error.message, 500);

    // attach template_id (first template per rule, if any)
    const ids = (data || []).map((r: { id: string }) => r.id);
    const templatesByRule = new Map<string, string>();
    if (ids.length > 0) {
      const { data: tpls } = await supabase
        .from("cadence_templates")
        .select("id, rule_id")
        .in("rule_id", ids);
      for (const t of (tpls as { id: string; rule_id: string }[]) || []) {
        if (!templatesByRule.has(t.rule_id)) templatesByRule.set(t.rule_id, t.id);
      }
    }
    const enriched = (data || []).map((r: { id: string }) => ({
      ...r,
      template_id: templatesByRule.get(r.id) ?? null,
    }));
    return successResponse(enriched);
  }

  // GET /cadences/rules/{id}
  if (sub === "rules" && ruleId && !subSub) {
    const { rule, error } = await fetchCadenceRuleScoped(supabase, ruleId, workspaceId);
    if (error) return error;
    const { data: templates } = await supabase
      .from("cadence_templates")
      .select("*")
      .eq("rule_id", ruleId)
      .order("order", { ascending: true });
    return successResponse({ ...rule, templates: templates || [] });
  }

  // GET /cadences/rules/{id}/stats
  if (sub === "rules" && ruleId && subSub === "stats") {
    const { rule, error } = await fetchCadenceRuleScoped(supabase, ruleId, workspaceId);
    if (error) return error;
    const bounds = defaultCadenceRange(url);
    const compare = url.searchParams.get("compare") === "true";
    const current = await loadCadenceStats(supabase, rule!, workspaceId, bounds);
    const previous = compare
      ? await loadCadenceStats(supabase, rule!, workspaceId, previousRange(bounds))
      : null;
    return successResponse({ ...current, previous });
  }

  // GET /cadences/rules/{id}/messages
  if (sub === "rules" && ruleId && subSub === "messages") {
    const { rule, error } = await fetchCadenceRuleScoped(supabase, ruleId, workspaceId);
    if (error) return error;
    const bounds = defaultCadenceRange(url);
    const statusFilter = (url.searchParams.get("status") || "total").toLowerCase();
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

    const rows = await fetchAllRows<CadenceScheduledMessageRow>((f, t) => {
      let q = supabase
        .from("cadence_scheduled_messages")
        .select("id, lead_id, activity_id, status, error, send_at, sent_at, created_at, message_id, template_id")
        .eq("rule_id", rule!.id)
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(skipped,cancelled)")
        .order("created_at", { ascending: false })
        .range(f, t);
      if (bounds.from) q = q.gte("created_at", bounds.from);
      if (bounds.to) q = q.lte("created_at", bounds.to);
      return q;
    });

    // delivery_status enrichment
    const linkedIds = Array.from(new Set(rows.map((r) => r.message_id).filter((x): x is number => !!x)));
    const deliveryMap = new Map<number, string | null>();
    if (linkedIds.length > 0) {
      const linked = await fetchAllRows<{ id: number; delivery_status: string | null }>((f, t) =>
        supabase.from("messages").select("id, delivery_status").in("id", linkedIds).range(f, t),
      );
      for (const l of linked) deliveryMap.set(l.id, l.delivery_status);
    }

    const TOLERANCE_MS = 2 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const DELIVERED_STATUSES = new Set(["delivered", "read"]);
    const classify = (m: CadenceScheduledMessageRow) => {
      if (m.status === "pending") return m.error ? "not_delivered" : "pending";
      if (m.status !== "sent") return "not_delivered";
      if (m.message_id == null) return "delivered";
      const ds = deliveryMap.get(m.message_id);
      if (ds && DELIVERED_STATUSES.has(ds)) return "delivered";
      const sentMs = m.sent_at ? new Date(m.sent_at).getTime() : 0;
      if (sentMs && nowMs - sentMs < TOLERANCE_MS) return "pending";
      return "not_delivered";
    };

    let filtered = rows.map((m) => ({
      id: m.id,
      lead_id: m.lead_id,
      template_id: m.template_id,
      activity_id: m.activity_id,
      send_at: m.send_at,
      sent_at: m.sent_at,
      status: m.status,
      delivery_status: m.message_id != null ? deliveryMap.get(m.message_id) ?? null : null,
      classification: classify(m),
      error: m.error,
      created_at: m.created_at,
    }));

    if (statusFilter === "pending") filtered = filtered.filter((m) => m.classification === "pending");
    else if (statusFilter === "delivered") filtered = filtered.filter((m) => m.classification === "delivered");
    else if (statusFilter === "not_delivered") filtered = filtered.filter((m) => m.classification === "not_delivered");

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    // Enrich with contact info
    const leadIds = Array.from(new Set(page.map((p) => p.lead_id)));
    const contactByLead: Record<string, { contact_id: string | null; contact_name: string | null }> = {};
    if (leadIds.length > 0) {
      const { data: leads } = await supabase
        .from("crm_leads")
        .select("id, contact_id, crm_contacts(name)")
        .in("id", leadIds);
      for (const l of (leads as any[]) || []) {
        contactByLead[l.id] = {
          contact_id: l.contact_id,
          contact_name: l.crm_contacts?.name ?? null,
        };
      }
    }
    const enriched = page.map((p) => ({
      ...p,
      contact_id: contactByLead[p.lead_id]?.contact_id ?? null,
      contact_name: contactByLead[p.lead_id]?.contact_name ?? null,
    }));

    return successResponse(enriched, { total, limit, offset, range: bounds, status: statusFilter });
  }

  // GET /cadences/rules/{id}/activations
  if (sub === "rules" && ruleId && subSub === "activations") {
    const { rule, error } = await fetchCadenceRuleScoped(supabase, ruleId, workspaceId);
    if (error) return error;
    const bounds = defaultCadenceRange(url);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

    const rows = await fetchAllRows<{
      lead_id: string;
      status: string;
      send_at: string;
      created_at: string;
    }>((f, t) => {
      let q = supabase
        .from("cadence_scheduled_messages")
        .select("lead_id, status, send_at, created_at")
        .eq("rule_id", rule!.id)
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(skipped,cancelled)")
        .range(f, t);
      if (bounds.from) q = q.gte("created_at", bounds.from);
      if (bounds.to) q = q.lte("created_at", bounds.to);
      return q;
    });

    const byLead = new Map<string, { first_send_at: string; sent: number; pending: number; total: number }>();
    for (const m of rows) {
      const cur = byLead.get(m.lead_id);
      if (!cur) {
        byLead.set(m.lead_id, {
          first_send_at: m.send_at,
          sent: m.status === "sent" ? 1 : 0,
          pending: m.status === "pending" ? 1 : 0,
          total: 1,
        });
      } else {
        cur.total += 1;
        if (m.status === "sent") cur.sent += 1;
        if (m.status === "pending") cur.pending += 1;
        if (new Date(m.send_at) < new Date(cur.first_send_at)) cur.first_send_at = m.send_at;
      }
    }
    const aggregated = Array.from(byLead.entries())
      .map(([lead_id, v]) => ({ lead_id, ...v }))
      .sort((a, b) => new Date(b.first_send_at).getTime() - new Date(a.first_send_at).getTime());
    const total = aggregated.length;
    const page = aggregated.slice(offset, offset + limit);

    const leadIds = page.map((p) => p.lead_id);
    const contactByLead: Record<string, { contact_id: string | null; contact_name: string | null }> = {};
    if (leadIds.length > 0) {
      const { data: leads } = await supabase
        .from("crm_leads")
        .select("id, contact_id, crm_contacts(name)")
        .in("id", leadIds);
      for (const l of (leads as any[]) || []) {
        contactByLead[l.id] = {
          contact_id: l.contact_id,
          contact_name: l.crm_contacts?.name ?? null,
        };
      }
    }
    const enriched = page.map((p) => ({
      lead_id: p.lead_id,
      contact_id: contactByLead[p.lead_id]?.contact_id ?? null,
      contact_name: contactByLead[p.lead_id]?.contact_name ?? null,
      first_send_at: p.first_send_at,
      sent_count: p.sent,
      pending_count: p.pending,
      total: p.total,
    }));

    return successResponse(enriched, { total, limit, offset, range: bounds });
  }

  // GET /cadences/rules/{id}/activities
  if (sub === "rules" && ruleId && subSub === "activities") {
    const { rule, error } = await fetchCadenceRuleScoped(supabase, ruleId, workspaceId);
    if (error) return error;
    if (rule!.trigger_type !== "activity" || !rule!.activity_type) {
      return errorResponse("BAD_REQUEST", "This rule is not an activity-triggered cadence", 400);
    }
    const bounds = defaultCadenceRange(url);
    const statusFilter = (url.searchParams.get("status") || "").toLowerCase();
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

    const nowIso = new Date().toISOString();
    let q = supabase
      .from("crm_lead_activities")
      .select("id, lead_id, scheduled_at, status, crm_leads(contact_id, crm_contacts(name))", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("type", rule!.activity_type)
      .order("scheduled_at", { ascending: false });
    if (bounds.from) q = q.gte("scheduled_at", bounds.from);
    if (bounds.to) q = q.lte("scheduled_at", bounds.to);
    if (statusFilter === "open") q = q.eq("status", "pending").gte("scheduled_at", nowIso);
    else if (statusFilter === "overdue") q = q.eq("status", "pending").lt("scheduled_at", nowIso);
    else if (statusFilter === "completed") q = q.eq("status", "completed");
    else if (statusFilter === "other") q = q.not("status", "in", "(pending,completed)");
    q = q.range(offset, offset + limit - 1);

    const { data, error: actErr, count } = await q;
    if (actErr) return errorResponse("DB_ERROR", actErr.message, 500);

    const items = ((data as any[]) || []).map((row) => ({
      id: row.id,
      lead_id: row.lead_id,
      contact_id: row.crm_leads?.contact_id ?? null,
      contact_name: row.crm_leads?.crm_contacts?.name ?? null,
      scheduled_at: row.scheduled_at,
      status: row.status,
    }));
    return successResponse(items, { total: count || 0, limit, offset, range: bounds, status: statusFilter || null });
  }

  return errorResponse("NOT_FOUND", "Unknown cadences endpoint", 404);
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

interface RouteGroup {
  prefix: string;
  requiresAuth: boolean;
  requiresWorkspace: boolean;
  scope?: "company" | "user" | "super_admin" | "service";
}

const ROUTE_GROUPS: RouteGroup[] = [
  // No auth needed
  { prefix: "public", requiresAuth: false, requiresWorkspace: false },
  { prefix: "webhooks", requiresAuth: false, requiresWorkspace: false },

  // Auth handled internally (login/register are public, /me requires auth)
  { prefix: "auth", requiresAuth: false, requiresWorkspace: false },
  { prefix: "companies", requiresAuth: true, requiresWorkspace: false },
  { prefix: "invites", requiresAuth: true, requiresWorkspace: false },
  { prefix: "agent-templates", requiresAuth: true, requiresWorkspace: false, scope: "super_admin" },
  { prefix: "notifications", requiresAuth: true, requiresWorkspace: false, scope: "user" },
  { prefix: "admin", requiresAuth: true, requiresWorkspace: false, scope: "super_admin" },

  // Auth needed, company scope
  { prefix: "connections", requiresAuth: true, requiresWorkspace: false, scope: "company" },

  // Auth needed, workspace scope
  { prefix: "workspaces", requiresAuth: true, requiresWorkspace: false }, // some sub-routes need workspace
  { prefix: "agents", requiresAuth: true, requiresWorkspace: true },
  { prefix: "agent-categories", requiresAuth: true, requiresWorkspace: true },
  { prefix: "inbox", requiresAuth: true, requiresWorkspace: true },
  { prefix: "crm", requiresAuth: true, requiresWorkspace: true },
  { prefix: "appointments", requiresAuth: true, requiresWorkspace: true },
  { prefix: "integrations", requiresAuth: true, requiresWorkspace: true },
  { prefix: "agent-calendars", requiresAuth: true, requiresWorkspace: true },
  { prefix: "knowledge-bases", requiresAuth: true, requiresWorkspace: true },
  { prefix: "messages", requiresAuth: true, requiresWorkspace: true },
  { prefix: "routing", requiresAuth: true, requiresWorkspace: true },
  { prefix: "chat-categories", requiresAuth: true, requiresWorkspace: true },
  { prefix: "availability", requiresAuth: true, requiresWorkspace: true },
  { prefix: "analytics", requiresAuth: true, requiresWorkspace: true },
  { prefix: "tools", requiresAuth: true, requiresWorkspace: true },
  { prefix: "widgets", requiresAuth: true, requiresWorkspace: true },
  { prefix: "cadences", requiresAuth: true, requiresWorkspace: true },
  { prefix: "api-keys", requiresAuth: true, requiresWorkspace: true },

  // Internal / service auth
  { prefix: "internal", requiresAuth: true, requiresWorkspace: false, scope: "service" },
];

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const url = new URL(req.url);
    const method = req.method;

    // Extract path after api-gateway/
    // Supabase invokes at: /functions/v1/api-gateway/...
    const fnPrefix = "/api-gateway";
    const fullPath = url.pathname;
    const gatewayIdx = fullPath.indexOf(fnPrefix);
    const apiPath =
      gatewayIdx >= 0
        ? fullPath.substring(gatewayIdx + fnPrefix.length).replace(/^\/+/, "")
        : fullPath.replace(/^\/+/, "");

    // Strip optional /api/v1/ prefix for convenience
    const normalizedPath = apiPath.replace(/^api\/v1\//, "");

    if (!normalizedPath) {
      return successResponse({
        service: "Nexus AI API Gateway",
        version: "1.0.0",
        docs: "/api/v1/docs",
      });
    }

    // Split path: first segment is the route group, rest are sub-path
    const segments = normalizedPath.split("/").filter(Boolean);
    const groupName = segments[0];
    const pathParts = segments.slice(1);

    // Find matching route group
    const routeGroup = ROUTE_GROUPS.find((r) => r.prefix === groupName);
    if (!routeGroup) {
      return errorResponse("NOT_FOUND", `Unknown route group: /${groupName}`, 404);
    }

    // --- Auth ---
    let ctx: AuthContext | null = null;

    if (routeGroup.requiresAuth) {
      const authResult = await authenticate(req, supabaseUrl, serviceKey);
      if (authResult.error) {
        return authResult.error;
      }
      ctx = authResult.ctx;
    }

    // --- Workspace check ---
    if (routeGroup.requiresWorkspace && ctx && !ctx.workspaceId) {
      return errorResponse(
        "MISSING_WORKSPACE",
        "X-Workspace-Id header is required for this endpoint",
        400,
      );
    }

    // --- Route to handler ---
    switch (groupName) {
      // Fully implemented
      case "api-keys":
        return await handleApiKeys(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Public (no auth)
      case "public":
        return await handlePublic(method, pathParts, url, req, supabaseUrl, serviceKey);

      // Webhooks (no auth, signature-based)
      case "webhooks":
        return await handleWebhooks(method, pathParts, url, req, supabaseUrl, serviceKey);

      // Auth group
      case "auth":
        return await handleAuth(method, pathParts, url, req, ctx, supabaseUrl, serviceKey);

      // Companies
      case "companies":
        return await handleCompanies(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Invites
      case "invites":
        return await handleInvites(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Workspaces
      case "workspaces":
        return await handleWorkspaces(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Agent Templates (super_admin for write)
      case "agent-templates":
        return await handleAgentTemplates(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Notifications (user-scoped)
      case "notifications":
        return await handleNotifications(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Admin (super_admin only)
      case "admin":
        return await handleAdmin(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Connections (company-scoped)
      case "connections":
        return await handleConnections(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Agents (workspace-scoped)
      case "agents":
        return await handleAgents(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Agent Categories (workspace-scoped)
      case "agent-categories":
        return await handleAgentCategories(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Inbox (workspace-scoped)
      case "inbox":
        return await handleInbox(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Messages (workspace-scoped)
      case "messages":
        return await handleMessages(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // CRM (workspace-scoped)
      case "crm":
        return await handleCrm(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Appointments (workspace-scoped)
      case "appointments":
        return await handleAppointments(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Integrations (google-calendar)
      case "integrations":
        return await handleIntegrations(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Agent Calendars (workspace-scoped)
      case "agent-calendars":
        return await handleAgentCalendars(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Knowledge Bases (workspace-scoped)
      case "knowledge-bases":
        return await handleKnowledgeBases(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Routing (workspace-scoped)
      case "routing":
        return await handleRouting(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Chat Categories (workspace-scoped)
      case "chat-categories":
        return await handleChatCategories(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Availability (workspace-scoped)
      case "availability":
        return await handleAvailability(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Analytics (workspace-scoped)
      case "analytics":
        return await handleAnalytics(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Tools (workspace-scoped)
      case "tools":
        return await handleTools(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Widgets (workspace-scoped)
      case "widgets":
        return await handleWidgets(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      // Cadences (workspace-scoped)
      case "cadences":
        return await handleCadences(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);


      // Internal service routes
      case "internal":
        return await handleInternal(method, pathParts, url, req, ctx!, supabaseUrl, serviceKey);

      default:
        return errorResponse("NOT_FOUND", `Unknown route: /${groupName}`, 404);
    }
  } catch (err) {
    console.error("API Gateway error:", err);
    return errorResponse(
      "INTERNAL_ERROR",
      err instanceof Error ? err.message : "An unexpected error occurred",
      500,
    );
  }
});
