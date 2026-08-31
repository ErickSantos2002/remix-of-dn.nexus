import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AES-GCM + PBKDF2 (mirror of src/lib/crypto.ts)
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function decryptToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const company_id: string | undefined = body?.company_id;
    const rawToken: string | undefined = body?.token;
    const rawBaseUrl: string | undefined = body?.base_url;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id obrigatorio" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let token = rawToken?.trim();
    let baseUrl = rawBaseUrl?.trim();

    if (!token || !baseUrl) {
      const { data: company, error } = await admin
        .from("companies")
        .select("dnmarketing_token_encrypted, dnmarketing_base_url")
        .eq("id", company_id)
        .single();
      if (error || !company) {
        return new Response(JSON.stringify({ success: false, error: "Empresa nao encontrada" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!token) {
        if (!company.dnmarketing_token_encrypted) {
          return new Response(JSON.stringify({ success: false, error: "Token nao configurado" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        token = await decryptToken(company.dnmarketing_token_encrypted, company_id);
      }
      if (!baseUrl) {
        baseUrl = company.dnmarketing_base_url || "";
      }
    }

    if (!baseUrl) {
      return new Response(JSON.stringify({ success: false, error: "URL base nao configurada" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = normalizeBaseUrl(baseUrl) + "/identity-status?dnia_id=__nexus_validation__";

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Falha de rede" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 401/403 = token rejeitado pelo servidor. Qualquer outro status indica que o servidor
    // aceitou a autenticacao (200/404/400 sao normais para um dnia_id de teste inexistente).
    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => "");
      return new Response(JSON.stringify({ success: false, status: res.status, error: text || "Token invalido para esta URL" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persistir validacao bem-sucedida
    await admin
      .from("companies")
      .update({ dnmarketing_validated_at: new Date().toISOString() })
      .eq("id", company_id);

    return new Response(JSON.stringify({ success: true, status: res.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[dnmarketing-test-connection] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
