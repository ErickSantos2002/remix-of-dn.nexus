import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptResendToken } from "../_shared/resendCredentials.ts";

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

interface DomainRecord {
  id?: string;
  name?: string;
  status?: string;
}

async function validateAgainstResend(apiKey: string): Promise<
  | { valid: true; domainsCount: number; sampleDomain: string | null; keyScope: "full" | "sending" }
  | { valid: false; status: number; error: string }
> {
  // Step 1: try GET /domains (works for Full access keys)
  try {
    const resp = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resp.ok) {
      const data = await resp.json();
      const domains: DomainRecord[] = Array.isArray(data?.data) ? data.data : [];
      const verified = domains.find((d) => (d.status || "").toLowerCase() === "verified");
      const sample = verified?.name || domains[0]?.name || null;
      return { valid: true, domainsCount: domains.length, sampleDomain: sample, keyScope: "full" };
    }

    // Non-auth errors are conclusive
    if (resp.status !== 401 && resp.status !== 403) {
      let detail = "";
      try {
        const j = await resp.json();
        detail = j?.message || j?.error?.message || "";
      } catch { /* ignore */ }
      const msgByStatus: Record<number, string> = {
        429: "Limite de requisicoes atingido. Tente novamente em instantes.",
      };
      return {
        valid: false,
        status: resp.status,
        error: msgByStatus[resp.status] || `Falha na validacao (HTTP ${resp.status}). ${detail}`.trim(),
      };
    }

    // Step 2: 401/403 on /domains -> probe POST /emails (works for Sending-only keys)
    // A chave "Sending access" nao tem permissao para listar dominios, mas e valida para envio.
    const probe = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Body intencionalmente invalido: a Resend valida auth antes do payload.
      body: JSON.stringify({}),
    });

    if (probe.status === 401 || probe.status === 403) {
      return {
        valid: false,
        status: probe.status,
        error: "Chave invalida ou revogada. Gere uma nova em resend.com/api-keys.",
      };
    }

    // 422/400 -> auth passou, chave e valida (escopo Sending)
    if (probe.status === 422 || probe.status === 400) {
      return { valid: true, domainsCount: 0, sampleDomain: null, keyScope: "sending" };
    }

    if (probe.status === 429) {
      return {
        valid: false,
        status: probe.status,
        error: "Limite de requisicoes atingido. Tente novamente em instantes.",
      };
    }

    let probeDetail = "";
    try {
      const j = await probe.json();
      probeDetail = j?.message || j?.error?.message || "";
    } catch { /* ignore */ }
    return {
      valid: false,
      status: probe.status,
      error: `Falha na validacao (HTTP ${probe.status}). ${probeDetail}`.trim(),
    };
  } catch (e) {
    return {
      valid: false,
      status: 0,
      error: e instanceof Error ? e.message : "Falha ao contatar a API da Resend.",
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

    if (!keyToValidate) {
      const { data: company } = await admin
        .from("companies")
        .select("id, resend_api_key")
        .eq("id", company_id)
        .maybeSingle();
      if (!company?.resend_api_key) {
        return json({ valid: false, error: "Nenhuma chave armazenada para revalidar." }, 400);
      }
      try {
        keyToValidate = await decryptResendToken(company.resend_api_key, company.id);
      } catch {
        return json({ valid: false, error: "Falha ao decriptar a chave armazenada." }, 500);
      }
    } else {
      if (!keyToValidate.startsWith("re_")) {
        return json({ valid: false, error: "Formato invalido. A chave deve comecar com 're_'." }, 400);
      }
      if (keyToValidate.length < 20) {
        return json({ valid: false, error: "Chave muito curta para ser valida." }, 400);
      }
    }

    const result = await validateAgainstResend(keyToValidate);

    if (!result.valid) {
      if (!api_key) {
        await admin
          .from("companies")
          .update({ resend_validated_at: null, resend_enabled: false })
          .eq("id", company_id);
      }
      return json({ valid: false, error: result.error, status: result.status }, 200);
    }

    if (!api_key) {
      const { data: current } = await admin
        .from("companies")
        .select("resend_from_email")
        .eq("id", company_id)
        .maybeSingle();
      const updates: Record<string, unknown> = {
        resend_validated_at: new Date().toISOString(),
        resend_enabled: true,
      };
      // Never overwrite a sender domain the company configured manually.
      if (!current?.resend_from_email && result.sampleDomain) {
        updates.resend_from_email = result.sampleDomain;
      }
      await admin.from("companies").update(updates).eq("id", company_id);
    }


    return json({
      valid: true,
      domains_count: result.domainsCount,
      sample_domain: result.sampleDomain,
      key_scope: result.keyScope,
    });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Erro inesperado." },
      500
    );
  }
});
