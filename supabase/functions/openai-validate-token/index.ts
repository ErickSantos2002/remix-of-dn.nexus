import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptOpenAIToken } from "../_shared/openaiCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callOpenAI(path: string, apiKey: string) {
  const isPost = path !== "/models";
  return await fetch(`https://api.openai.com/v1${path}`, {
    method: isPost ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: isPost
      ? JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        })
      : undefined,
  });
}

async function extractError(resp: Response): Promise<string> {
  try {
    const j = await resp.json();
    return j?.error?.message || "";
  } catch {
    return "";
  }
}

async function validateAgainstOpenAI(apiKey: string): Promise<
  | { valid: true; modelsCount: number; sampleModel: string | null }
  | { valid: false; status: number; error: string }
> {
  try {
    // 1. Try /v1/models (works for most keys)
    const resp = await callOpenAI("/models", apiKey);

    if (resp.ok) {
      const data = await resp.json();
      const models: Array<{ id: string }> = Array.isArray(data?.data) ? data.data : [];
      const sample =
        models.find((m) => m.id?.startsWith("gpt-4o"))?.id ||
        models.find((m) => m.id?.startsWith("gpt-"))?.id ||
        models[0]?.id ||
        null;
      return { valid: true, modelsCount: models.length, sampleModel: sample };
    }

    const modelsDetail = await extractError(resp);

    // 2. Fallback: restricted/project-scoped keys may fail /models but still call chat.
    if (resp.status === 401 || resp.status === 403) {
      const chatResp = await callOpenAI("/chat/completions", apiKey);
      if (chatResp.ok) {
        await chatResp.json().catch(() => null);
        return { valid: true, modelsCount: 0, sampleModel: "gpt-4o-mini" };
      }
      const chatDetail = await extractError(chatResp);
      const finalDetail = chatDetail || modelsDetail;
      const prefix =
        chatResp.status === 401
          ? "Chave invalida ou expirada (401)."
          : chatResp.status === 403
            ? "Chave sem permissao (403)."
            : `Falha (HTTP ${chatResp.status}).`;
      return {
        valid: false,
        status: chatResp.status,
        error: finalDetail ? `${prefix} OpenAI: ${finalDetail}` : prefix,
      };
    }

    const msgByStatus: Record<number, string> = {
      429: "Limite de requisicoes atingido. Tente novamente em instantes.",
    };
    return {
      valid: false,
      status: resp.status,
      error: modelsDetail
        ? `${msgByStatus[resp.status] || `Falha (HTTP ${resp.status}).`} OpenAI: ${modelsDetail}`
        : msgByStatus[resp.status] || `Falha na validacao (HTTP ${resp.status}).`,
    };
  } catch (e) {
    return {
      valid: false,
      status: 0,
      error: e instanceof Error ? e.message : "Falha ao contatar a API da OpenAI.",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Nao autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Nao autenticado." }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { company_id, api_key } = body as { company_id?: string; api_key?: string };

    if (!company_id) return json({ error: "company_id obrigatorio." }, 400);

    // Permission check: super_admin OR company admin/owner
    const { data: isSuper } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    const { data: isAdmin } = await admin.rpc("is_company_admin", {
      _user_id: userId,
      _company_id: company_id,
    });
    if (!isSuper && !isAdmin) {
      return json({ error: "Sem permissao para esta empresa." }, 403);
    }

    let keyToValidate = (api_key || "").trim();

    // Revalidate stored key
    if (!keyToValidate) {
      const { data: company } = await admin
        .from("companies")
        .select("id, openai_api_key")
        .eq("id", company_id)
        .maybeSingle();
      if (!company?.openai_api_key) {
        return json({ valid: false, error: "Nenhuma chave armazenada para revalidar." }, 400);
      }
      try {
        keyToValidate = await decryptOpenAIToken(company.openai_api_key, company.id);
      } catch {
        return json({ valid: false, error: "Falha ao decriptar a chave armazenada." }, 500);
      }
    } else {
      if (!keyToValidate.startsWith("sk-")) {
        return json({ valid: false, error: "Formato invalido. A chave deve comecar com 'sk-'." }, 400);
      }
      if (keyToValidate.length < 20) {
        return json({ valid: false, error: "Chave muito curta para ser valida." }, 400);
      }
    }

    const result = await validateAgainstOpenAI(keyToValidate);

    if (!result.valid) {
      // Mark stored key as invalid (don't deactivate automatically on revalidate failure;
      // user can choose. But ensure validated_at is cleared.)
      if (!api_key) {
        await admin
          .from("companies")
          .update({ openai_validated_at: null, openai_enabled: false })
          .eq("id", company_id);
      }
      return json({ valid: false, error: result.error, status: result.status }, 200);
    }

    // On successful revalidation of stored key, refresh metadata
    if (!api_key) {
      await admin
        .from("companies")
        .update({
          openai_validated_at: new Date().toISOString(),
          openai_model_default: result.sampleModel,
          openai_enabled: true,
        })
        .eq("id", company_id);
    }

    return json({
      valid: true,
      models_count: result.modelsCount,
      sample_model: result.sampleModel,
    });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Erro inesperado." },
      500
    );
  }
});
