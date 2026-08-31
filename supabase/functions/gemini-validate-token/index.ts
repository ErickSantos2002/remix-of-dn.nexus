import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptGeminiToken,
  REQUIRED_PUBLIC_MODELS,
  REQUIRED_EMBEDDING_MODEL,
  invalidateGeminiCache,
} from "../_shared/geminiClient.ts";

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

type ModelResult = { ok: boolean; error?: string };

async function testChatModel(apiKey: string, model: string): Promise<ModelResult> {
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    if (!resp.ok) {
      let detail = "";
      try { const j = await resp.json(); detail = j?.error?.message || ""; } catch { /* ignore */ }
      return { ok: false, error: `HTTP ${resp.status}${detail ? `: ${detail}` : ""}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}

async function testEmbeddingModel(apiKey: string, model: string): Promise<ModelResult> {
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: "ping" }] },
      }),
    });
    if (!resp.ok) {
      let detail = "";
      try { const j = await resp.json(); detail = j?.error?.message || ""; } catch { /* ignore */ }
      return { ok: false, error: `HTTP ${resp.status}${detail ? `: ${detail}` : ""}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
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

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "super_admin" });
    const { data: isAdmin } = await admin.rpc("is_company_admin", { _user_id: userId, _company_id: company_id });
    if (!isSuper && !isAdmin) return json({ error: "Sem permissao para esta empresa." }, 403);

    let keyToTest = (api_key || "").trim();
    if (!keyToTest) {
      const { data: company } = await admin
        .from("companies")
        .select("id, gemini_api_key")
        .eq("id", company_id)
        .maybeSingle();
      if (!company?.gemini_api_key) return json({ ok: false, error: "Nenhuma chave armazenada para testar." }, 400);
      try {
        keyToTest = await decryptGeminiToken(company.gemini_api_key as string, company.id as string);
      } catch {
        return json({ ok: false, error: "Falha ao decriptar a chave armazenada." }, 500);
      }
    } else {
      if (keyToTest.length < 20) return json({ ok: false, error: "Chave muito curta para ser valida." }, 400);
    }

    // Testar todos os modelos em paralelo
    const results: Record<string, ModelResult> = {};
    const chatResults = await Promise.all(REQUIRED_PUBLIC_MODELS.map((m) => testChatModel(keyToTest, m)));
    REQUIRED_PUBLIC_MODELS.forEach((m, i) => { results[m] = chatResults[i]; });
    results[REQUIRED_EMBEDDING_MODEL] = await testEmbeddingModel(keyToTest, REQUIRED_EMBEDDING_MODEL);

    const ok = Object.values(results).every((r) => r.ok);
    const lastTest = { ok, models: results, tested_at: new Date().toISOString() };

    const update: Record<string, unknown> = { gemini_last_test: lastTest };
    if (ok) update.gemini_validated_at = new Date().toISOString();
    else if (!api_key) {
      // Se foi revalidacao e falhou, desativa.
      update.gemini_enabled = false;
      update.gemini_validated_at = null;
    }
    await admin.from("companies").update(update).eq("id", company_id);
    invalidateGeminiCache(company_id);

    return json({ ok, models: results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erro inesperado." }, 500);
  }
});
