import { createClient } from "npm:@supabase/supabase-js@2";
import { dnFetch, resolveCompanyId } from "../_shared/dnmarketing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { contact_id, register_conversion, conversion } = body as {
      contact_id?: string;
      register_conversion?: boolean;
      conversion?: {
        tipo?: string;
        page_slug?: string;
        session_id?: string;
        converted_at?: string;
        apply_tag?: boolean;
        utm?: Record<string, string | undefined>;
      };
    };
    if (!contact_id) {
      return new Response(JSON.stringify({ error: "contact_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: contact, error: contactError } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email, dnia_id, workspace_id, job_title, company, revenue, employee_count, source, tags, ab_vid, ab_test, ab_var")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      console.error("[DNMARKETING-SYNC] Contact not found:", contact_id, contactError);
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!contact.phone && !contact.email) {
      console.log("[DNMARKETING-SYNC] No phone or email, skipping:", contact_id);
      return new Response(JSON.stringify({ skipped: true, reason: "no_identifiers" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = await resolveCompanyId(supabase, { workspaceId: contact.workspace_id });

    // Buscar UTMs do lead CRM mais recente deste contato
    const { data: crmLead } = await supabase
      .from("crm_leads")
      .select("utm_source, utm_medium, utm_campaign, utm_term, utm_content")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Resolver "source" como origem de negócio: ÚLTIMA tag não-vazia (mais recente = campanha atual);
    // fallback para crm_contacts.source. Conforme doc /identity-upsert v2: source = "Origem de negócio".
    // Tags são appendadas a cada conversão, então a última representa a origem atual da conversão.
    let businessSource: string | null = null;
    const tags = Array.isArray(contact.tags) ? contact.tags : [];
    for (let i = tags.length - 1; i >= 0; i--) {
      const t = tags[i];
      if (t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") {
        const n = (t as { name: string }).name.trim();
        if (n) { businessSource = n; break; }
      } else if (typeof t === "string" && t.trim()) {
        businessSource = t.trim(); break;
      }
    }
    if (!businessSource && contact.source && contact.source.trim()) {
      businessSource = contact.source.trim();
    }

    // Always upsert: garante cadastro novo OU atualização de campos (nome, qualificação)
    console.log("[DNMARKETING-SYNC] Upserting identity for contact:", contact_id);

    const upsertBody: Record<string, string> = {
      source_app: "nexus",
      local_id: contact.id,
    };
    if (contact.phone) upsertBody.phone = contact.phone;
    if (contact.email) upsertBody.email = contact.email;
    if (contact.name) upsertBody.nome = contact.name;
    if (contact.job_title) upsertBody.job_title = contact.job_title;
    if (contact.company) upsertBody.company = contact.company;
    if (contact.revenue) upsertBody.revenue = contact.revenue;
    if (contact.employee_count) upsertBody.employee_count = contact.employee_count;
    // Aquisição (root) — conforme nova doc /identity-upsert
    if (businessSource) upsertBody.source = businessSource;
    if (crmLead?.utm_source) upsertBody.utm_source = crmLead.utm_source;
    if (crmLead?.utm_medium) upsertBody.utm_medium = crmLead.utm_medium;
    if (crmLead?.utm_campaign) upsertBody.utm_campaign = crmLead.utm_campaign;
    if (crmLead?.utm_term) upsertBody.utm_term = crmLead.utm_term;
    if (crmLead?.utm_content) upsertBody.utm_content = crmLead.utm_content;

    // A/B testing (root) — permite fechar atribuição de conversão à variante no dn.marketing
    if ((contact as { ab_vid?: string | null }).ab_vid) upsertBody.ab_vid = (contact as { ab_vid: string }).ab_vid;
    if ((contact as { ab_test?: string | null }).ab_test) upsertBody.ab_test = (contact as { ab_test: string }).ab_test;
    if ((contact as { ab_var?: string | null }).ab_var) upsertBody.ab_var = (contact as { ab_var: string }).ab_var;

    // contact_fields: apenas enriquecimento de perfil (sem aquisição)
    const contactFields: Record<string, string> = {};
    if (contact.job_title) contactFields.cargo = contact.job_title;
    if (contact.company) contactFields.empresa = contact.company;
    if (contact.revenue) contactFields.faturamento = contact.revenue;
    if (contact.employee_count) contactFields.funcionarios = contact.employee_count;
    if (Object.keys(contactFields).length > 0) {
      (upsertBody as Record<string, unknown>).contact_fields = contactFields;
    }

    console.log("[DNMARKETING-SYNC] Upsert payload keys:", Object.keys(upsertBody), {
      has_utm_source: !!upsertBody.utm_source,
      has_utm_medium: !!upsertBody.utm_medium,
      has_utm_campaign: !!upsertBody.utm_campaign,
      has_utm_term: !!upsertBody.utm_term,
      has_utm_content: !!upsertBody.utm_content,
      source: upsertBody.source ?? null,
    });

    const upsertRes = await dnFetch(supabase, companyId, {
      method: "POST",
      path: "/identity-upsert",
      body: upsertBody,
    });

    if (!upsertRes) {
      return new Response(JSON.stringify({ skipped: true, reason: "no_active_config" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!upsertRes.ok) {
      console.error("[DNMARKETING-SYNC] Upsert failed:", upsertRes.status, upsertRes.raw?.substring(0, 200));
      return new Response(JSON.stringify({ error: "Upsert failed", status: upsertRes.status }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upsertData = upsertRes.data as { dnia_id?: string; merged?: boolean; merged_from?: string; is_new?: boolean };
    const dniaId: string | null = upsertData?.dnia_id ?? null;

    if (upsertData?.merged) {
      console.log(`[DNMARKETING-SYNC] Merge detected! Kept: ${upsertData.dnia_id}, Discarded: ${upsertData.merged_from}`);
    }
    console.log("[DNMARKETING-SYNC] Upsert result - dnia_id:", dniaId, "is_new:", upsertData?.is_new, "fields:", Object.keys(upsertBody));


    if (dniaId && dniaId !== contact.dnia_id) {
      const { error: updateError } = await supabase
        .from("crm_contacts")
        .update({ dnia_id: dniaId })
        .eq("id", contact.id);

      if (updateError) {
        console.error("[DNMARKETING-SYNC] Failed to update dnia_id:", updateError);
        return new Response(JSON.stringify({ error: "Update failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("[DNMARKETING-SYNC] Updated contact", contact.id, "with dnia_id:", dniaId);
    }

    // Optional: register a conversion on dn.marketing (etapa 1 do widget, etc.)
    let conversionResult: { status: number; ok: boolean } | null = null;
    if (register_conversion) {
      const utmIn = (conversion?.utm || {}) as Record<string, string | undefined>;
      const convBody: Record<string, unknown> = {
        tipo: conversion?.tipo || "lead",
        page_slug: conversion?.page_slug || "widget-agendamento",
        converted_at: conversion?.converted_at || new Date().toISOString(),
        apply_tag: conversion?.apply_tag !== false,
      };
      if (contact.email) convBody.email = contact.email;
      if (contact.phone) convBody.phone = contact.phone;
      if (conversion?.session_id) convBody.session_id = conversion.session_id;
      // Origem de negócio (mesma lógica do /identity-upsert): última tag ou crm_contacts.source
      if (businessSource) convBody.source = businessSource;
      // UTMs vindos da URL — chave de aquisição
      const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
      for (const k of utmKeys) {
        const v = utmIn[k] ?? (crmLead as Record<string, string | null> | null)?.[k];
        if (v) convBody[k] = v;
      }

      try {
        const convRes = await dnFetch(supabase, companyId, {
          method: "POST",
          path: "/register-conversion",
          body: convBody,
        });
        if (convRes) {
          conversionResult = { status: convRes.status, ok: convRes.ok };
          console.log(
            `[DNMARKETING-SYNC][register-conversion] contact=${contact.id} tipo=${convBody.tipo} page_slug=${convBody.page_slug} session_id=${convBody.session_id ?? "n/a"} status=${convRes.status} ok=${convRes.ok}`,
          );
          if (!convRes.ok) {
            console.warn(`[DNMARKETING-SYNC][register-conversion] body=${convRes.raw?.substring(0, 200)}`);
          }
        } else {
          console.log("[DNMARKETING-SYNC][register-conversion] skipped — no active dn.marketing config");
        }
      } catch (e) {
        console.error("[DNMARKETING-SYNC][register-conversion] error:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, dnia_id: dniaId, conversion: conversionResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[DNMARKETING-SYNC] Fatal error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
