import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, getDnMarketingConfig } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const company_id: string | undefined = body?.company_id;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id obrigatório no body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Garantir que a empresa tem config ativa antes de iniciar
    const cfg = await getDnMarketingConfig(supabase, company_id);
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: "dn.marketing não está ativo para esta empresa" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Workspaces da empresa
    const { data: workspaces, error: wsError } = await supabase
      .from("workspaces")
      .select("id")
      .eq("company_id", company_id);

    if (wsError) throw new Error(`Workspace query error: ${wsError.message}`);
    const workspaceIds = (workspaces ?? []).map((w: { id: string }) => w.id);
    if (workspaceIds.length === 0) {
      return new Response(JSON.stringify({ done: true, remaining: 0, message: "Empresa sem workspaces" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { count } = await supabase
      .from("crm_contacts")
      .select("id", { count: "exact", head: true })
      .in("workspace_id", workspaceIds)
      .is("dnia_id", null)
      .eq("is_active", true)
      .or("phone.not.is.null,email.not.is.null");

    const { data: contacts, error } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email")
      .in("workspace_id", workspaceIds)
      .is("dnia_id", null)
      .eq("is_active", true)
      .or("phone.not.is.null,email.not.is.null")
      .order("created_at", { ascending: true })
      .range(0, BATCH_SIZE - 1);

    if (error) throw new Error(`Query error: ${error.message}`);
    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ done: true, remaining: 0, message: "Todos os contatos sincronizados" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const contact of contacts) {
      const validPhone = contact.phone && contact.phone.length >= 10 && !contact.phone.includes("-group") && /^\d+$/.test(contact.phone);
      const validEmail = contact.email && contact.email !== "null" && contact.email.includes("@");

      if (!validPhone && !validEmail) {
        console.log(`[BACKFILL-DNIA] Skipping ${contact.id} (${contact.name}): invalid phone/email`);
        skipped++;
        continue;
      }

      try {
        const upsertBody: Record<string, string> = { source_app: "nexus", local_id: contact.id };
        if (validPhone) upsertBody.phone = contact.phone;
        if (validEmail) upsertBody.email = contact.email;
        if (contact.name) upsertBody.nome = contact.name;

        const res = await dnFetch(supabase, company_id, {
          method: "POST",
          path: "/identity-upsert",
          body: upsertBody,
        });

        if (!res) {
          return new Response(JSON.stringify({ error: "Config dn.marketing ficou indisponível durante o backfill" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (res.status === 429) {
          console.log(`[BACKFILL-DNIA] Rate limited após ${synced} syncs, parando o batch`);
          break;
        }

        if (!res.ok) {
          console.error(`[BACKFILL-DNIA] Falhou ${contact.id} (${contact.name}): ${res.status} ${res.raw?.substring(0, 150)}`);
          errors++;
          continue;
        }

        const result = res.data as { dnia_id?: string };
        if (result?.dnia_id) {
          const { error: updateError } = await supabase
            .from("crm_contacts")
            .update({ dnia_id: result.dnia_id })
            .eq("id", contact.id);
          if (updateError) errors++;
          else synced++;
        } else {
          skipped++;
        }

        await new Promise((r) => setTimeout(r, 1500));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BACKFILL-DNIA] Exception ${contact.id} (${contact.name}):`, msg);
        errors++;
        if (msg.includes("Rate limit")) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    const remaining = Math.max(0, (count || 0) - synced);

    return new Response(JSON.stringify({
      done: remaining <= 0,
      company_id,
      batch_size: contacts.length,
      synced,
      skipped,
      errors,
      remaining,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
