// playbook-ingest
//
// Recebe o .docx do playbook comercial (base64) e grava a versao Markdown
// canonica em analysis_playbooks.playbook_md.
//
// O arquivo NAO e persistido em storage: ele e parseado em memoria e apenas o
// Markdown resultante fica no banco. Para re-extrair, o admin reenvia o arquivo.
//
// O Markdown gravado nasce como NAO aprovado (md_approved_at = null). O admin
// revisa/edita e aprova na UI antes da extracao da rubrica.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { docxToMarkdown } from "./docxToMarkdown.ts";

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

// ~12MB de base64 (~9MB de arquivo). Playbooks reais ficam bem abaixo disso.
const MAX_BASE64_LENGTH = 12 * 1024 * 1024;

function base64ToBytes(base64: string): Uint8Array {
  // Aceita data URL ("data:application/...;base64,XXXX") ou base64 puro
  const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
    const { playbook_id, filename, file_base64 } = body as {
      playbook_id?: string;
      filename?: string;
      file_base64?: string;
    };

    if (!playbook_id) return json({ error: "playbook_id obrigatorio." }, 400);
    if (!file_base64) return json({ error: "file_base64 obrigatorio." }, 400);
    if (file_base64.length > MAX_BASE64_LENGTH) {
      return json({ error: "Arquivo muito grande. Limite aproximado: 9 MB." }, 413);
    }
    if (filename && !filename.toLowerCase().endsWith(".docx")) {
      return json({ error: "Formato nao suportado. Envie um arquivo .docx." }, 400);
    }

    const { data: playbook, error: playbookErr } = await admin
      .from("analysis_playbooks")
      .select("id, company_id")
      .eq("id", playbook_id)
      .maybeSingle();

    if (playbookErr) return json({ error: playbookErr.message }, 500);
    if (!playbook) return json({ error: "Analise nao encontrada." }, 404);

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "super_admin" });
    const { data: isCompanyAdmin } = await admin.rpc("is_company_admin", {
      _user_id: userId,
      _company_id: playbook.company_id,
    });
    if (!isSuper && !isCompanyAdmin) {
      return json({ error: "Sem permissao para editar analises desta empresa." }, 403);
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(file_base64);
    } catch {
      return json({ error: "Conteudo do arquivo invalido (base64 malformado)." }, 400);
    }

    // Assinatura de ZIP: todo .docx comeca com PK\x03\x04
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return json({ error: "O arquivo nao parece ser um .docx valido." }, 400);
    }

    const markdown = await docxToMarkdown(bytes);
    if (!markdown) {
      return json(
        { error: "Nao foi possivel extrair o conteudo do documento. Verifique se o arquivo nao esta corrompido." },
        422,
      );
    }

    const { error: updateErr } = await admin
      .from("analysis_playbooks")
      .update({
        playbook_md: markdown,
        playbook_filename: filename ?? null,
        // Novo conteudo precisa ser reaprovado antes de gerar rubrica
        md_approved_at: null,
      })
      .eq("id", playbook_id);

    if (updateErr) return json({ error: updateErr.message }, 500);

    console.log(
      `[playbook-ingest] playbook=${playbook_id} chars=${markdown.length} headings=${
        (markdown.match(/^#{1,6} /gm) || []).length
      }`,
    );

    return json({
      success: true,
      playbook_md: markdown,
      stats: {
        characters: markdown.length,
        headings: (markdown.match(/^#{1,6} /gm) || []).length,
        lines: markdown.split("\n").length,
      },
    });
  } catch (e) {
    console.error("[playbook-ingest] erro inesperado:", e);
    return json({ error: e instanceof Error ? e.message : "Erro inesperado." }, 500);
  }
});
