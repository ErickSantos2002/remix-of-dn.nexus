import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hashPhone(phone: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phone);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 8).toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    // Check role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();

    const role = roleData?.role;
    if (role !== "super_admin" && role !== "admin") {
      // Check company admin
      const { data: memberData } = await adminClient
        .from("company_members")
        .select("role")
        .eq("user_id", userId)
        .eq("status", "active")
        .in("role", ["admin", "owner"]);

      if (!memberData || memberData.length === 0) {
        return new Response(JSON.stringify({ error: "Acesso negado. Apenas admin ou super_admin." }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    const body = await req.json();
    const { action, workspace_id, search_term, customer_phone } = body;

    if (!workspace_id) {
      return new Response(JSON.stringify({ error: "workspace_id obrigatorio" }), { status: 400, headers: corsHeaders });
    }

    // ========== SEARCH ==========
    if (action === "search") {
      if (!search_term) {
        return new Response(JSON.stringify({ error: "search_term obrigatorio" }), { status: 400, headers: corsHeaders });
      }

      const { data: contacts } = await adminClient
        .from("crm_contacts")
        .select("id, name, phone, email, lead_id, is_anonymized")
        .eq("workspace_id", workspace_id)
        .or(`name.ilike.%${search_term}%,phone.ilike.%${search_term}%,email.ilike.%${search_term}%`)
        .limit(20);

      if (!contacts || contacts.length === 0) {
        return new Response(JSON.stringify({ results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const results = [];
      for (const contact of contacts) {
        // Count leads
        const { count: leadsCount } = await adminClient
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace_id)
          .eq("phone", contact.phone || "");

        // Count messages via leads
        let messagesCount = 0;
        if (contact.phone) {
          const { data: leadIds } = await adminClient
            .from("leads")
            .select("id")
            .eq("workspace_id", workspace_id)
            .eq("phone", contact.phone);
          if (leadIds && leadIds.length > 0) {
            const ids = leadIds.map((l: { id: string }) => l.id);
            const { count } = await adminClient
              .from("messages")
              .select("id", { count: "exact", head: true })
              .in("lead_id", ids);
            messagesCount = count || 0;
          }
        }

        // Count CRM leads
        const { count: crmLeadsCount } = await adminClient
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace_id)
          .eq("contact_id", contact.id);

        // Count conversations
        let conversationsCount = 0;
        if (contact.phone) {
          const { count: zapiCount } = await adminClient
            .from("zapi_conversations")
            .select("id", { count: "exact", head: true })
            .eq("phone_number", contact.phone);
          conversationsCount = zapiCount || 0;
        }

        results.push({
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          is_anonymized: contact.is_anonymized,
          leads_count: leadsCount || 0,
          messages_count: messagesCount,
          crm_leads_count: crmLeadsCount || 0,
          conversations_count: conversationsCount,
        });
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== ANONYMIZE ==========
    if (action === "anonymize") {
      if (!customer_phone) {
        return new Response(JSON.stringify({ error: "customer_phone obrigatorio" }), { status: 400, headers: corsHeaders });
      }

      const hash = await hashPhone(customer_phone);
      const anonName = `Titular Anonimizado #${hash}`;
      const anonEmail = `anonimizado_${hash.toLowerCase()}@removed.local`;
      const anonPhone = `ANON_${hash}`;
      const tablesAffected: Record<string, number> = {};

      try {
        // 1. Anonymize crm_contacts
        const { data: updatedContacts } = await adminClient
          .from("crm_contacts")
          .update({
            name: anonName,
            phone: anonPhone,
            email: anonEmail,
            notes: null,
            tags: null,
            custom_fields: null,
            is_active: false,
            is_anonymized: true,
            anonymized_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspace_id)
          .eq("phone", customer_phone)
          .select("id");
        tablesAffected["crm_contacts"] = updatedContacts?.length || 0;

        // 1.1 Anonimizar a trilha de auditoria dos contatos.
        // crm_contact_field_history guarda old_value/new_value de name e email --
        // sem este passo, o dado pessoal sobreviveria a anonimizacao do contato.
        const anonymizedContactIds = (updatedContacts || []).map((c: { id: string }) => c.id);
        if (anonymizedContactIds.length > 0) {
          const { data: maskedHistory } = await adminClient
            .from("crm_contact_field_history")
            .update({ old_value: "[anonimizado]", new_value: "[anonimizado]" })
            .in("contact_id", anonymizedContactIds)
            .in("field_name", ["name", "email"])
            .select("id");
          tablesAffected["crm_contact_field_history"] = maskedHistory?.length || 0;
        }

        // 2. Find and anonymize leads
        const { data: leads } = await adminClient
          .from("leads")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("phone", customer_phone);

        const leadIds = leads?.map((l: { id: string }) => l.id) || [];

        if (leadIds.length > 0) {
          await adminClient
            .from("leads")
            .update({
              name: anonName,
              phone: anonPhone,
              notes: null,
              ai_summary: null,
              insights: null,
              is_anonymized: true,
              anonymized_at: new Date().toISOString(),
            })
            .eq("workspace_id", workspace_id)
            .eq("phone", customer_phone);
          tablesAffected["leads"] = leadIds.length;

          // 3. Delete messages content
          const { count: msgsDeleted } = await adminClient
            .from("messages")
            .delete()
            .in("lead_id", leadIds);
          tablesAffected["messages"] = msgsDeleted || 0;

          // 4. Delete lead psychology
          for (const lid of leadIds) {
            // Find crm_leads linked to this lead's contact
            const { data: crmLeadsForPsych } = await adminClient
              .from("crm_leads")
              .select("id")
              .eq("workspace_id", workspace_id)
              .in("contact_id", (updatedContacts || []).map((c: { id: string }) => c.id));
            
            if (crmLeadsForPsych && crmLeadsForPsych.length > 0) {
              const { count } = await adminClient
                .from("crm_lead_psychology")
                .delete()
                .in("lead_id", crmLeadsForPsych.map((cl: { id: string }) => cl.id));
              tablesAffected["crm_lead_psychology"] = (tablesAffected["crm_lead_psychology"] || 0) + (count || 0);
            }
          }
        }

        // 5. Anonymize CRM leads
        const contactIds = (updatedContacts || []).map((c: { id: string }) => c.id);
        if (contactIds.length > 0) {
          const { data: crmLeads } = await adminClient
            .from("crm_leads")
            .update({
              title: anonName,
              description: null,
              notes: null,
            })
            .eq("workspace_id", workspace_id)
            .in("contact_id", contactIds)
            .select("id");
          tablesAffected["crm_leads"] = crmLeads?.length || 0;

          // Anonymize appointments
          const { data: apts } = await adminClient
            .from("crm_appointments")
            .update({
              title: `Agendamento - ${anonName}`,
              description: null,
              notes: null,
            })
            .eq("workspace_id", workspace_id)
            .in("contact_id", contactIds)
            .select("id");
          tablesAffected["crm_appointments"] = apts?.length || 0;
        }

        // 6. Anonymize zapi_conversations
        const { data: zapiConvs } = await adminClient
          .from("zapi_conversations")
          .update({
            contact_name: anonName,
            phone_number: anonPhone,
          })
          .eq("phone_number", customer_phone)
          .select("id");
        tablesAffected["zapi_conversations"] = zapiConvs?.length || 0;

        // Delete zapi_messages
        if (zapiConvs && zapiConvs.length > 0) {
          const { count } = await adminClient
            .from("zapi_messages")
            .delete()
            .in("conversation_id", zapiConvs.map((c: { id: string }) => c.id));
          tablesAffected["zapi_messages"] = count || 0;
        }

        // 7. Anonymize whatsapp_conversations
        const { data: waConvs } = await adminClient
          .from("whatsapp_conversations")
          .update({
            contact_name: anonName,
            phone_number: anonPhone,
          })
          .eq("phone_number", customer_phone)
          .select("id");
        tablesAffected["whatsapp_conversations"] = waConvs?.length || 0;

        if (waConvs && waConvs.length > 0) {
          const { count } = await adminClient
            .from("whatsapp_messages")
            .delete()
            .in("conversation_id", waConvs.map((c: { id: string }) => c.id));
          tablesAffected["whatsapp_messages"] = count || 0;
        }

        const totalRecords = Object.values(tablesAffected).reduce((a, b) => a + b, 0);

        // Log
        await adminClient.from("data_deletion_log").insert({
          workspace_id,
          requested_by: userId,
          customer_identifier_hash: hash,
          action_type: "anonymization",
          tables_affected: tablesAffected,
          records_affected_count: totalRecords,
          status: "completed",
        });

        return new Response(
          JSON.stringify({
            success: true,
            action_type: "anonymization",
            hash,
            tables_affected: tablesAffected,
            records_affected_count: totalRecords,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await adminClient.from("data_deletion_log").insert({
          workspace_id,
          requested_by: userId,
          customer_identifier_hash: hash,
          action_type: "anonymization",
          tables_affected: tablesAffected,
          records_affected_count: 0,
          status: "failed",
          error_details: errorMsg,
        });
        throw err;
      }
    }

    // ========== DELETE ==========
    if (action === "delete") {
      if (!customer_phone) {
        return new Response(JSON.stringify({ error: "customer_phone obrigatorio" }), { status: 400, headers: corsHeaders });
      }

      const hash = await hashPhone(customer_phone);
      const tablesAffected: Record<string, number> = {};

      try {
        // Find leads
        const { data: leads } = await adminClient
          .from("leads")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("phone", customer_phone);
        const leadIds = leads?.map((l: { id: string }) => l.id) || [];

        // Find contacts
        const { data: contacts } = await adminClient
          .from("crm_contacts")
          .select("id")
          .eq("workspace_id", workspace_id)
          .eq("phone", customer_phone);
        const contactIds = contacts?.map((c: { id: string }) => c.id) || [];

        // Find CRM leads
        let crmLeadIds: string[] = [];
        if (contactIds.length > 0) {
          const { data: crmLeads } = await adminClient
            .from("crm_leads")
            .select("id")
            .eq("workspace_id", workspace_id)
            .in("contact_id", contactIds);
          crmLeadIds = crmLeads?.map((cl: { id: string }) => cl.id) || [];
        }

        // Delete in order respecting FK constraints
        if (leadIds.length > 0) {
          // Messages
          const { count: c1 } = await adminClient.from("messages").delete().in("lead_id", leadIds);
          tablesAffected["messages"] = c1 || 0;

          // Lead assignments
          const { count: c2 } = await adminClient.from("lead_assignments").delete().in("lead_id", leadIds);
          tablesAffected["lead_assignments"] = c2 || 0;

          // Lead queues
          const { count: c3 } = await adminClient.from("lead_queues").delete().in("lead_id", leadIds);
          tablesAffected["lead_queues"] = c3 || 0;

          // Lead history
          const { count: c4 } = await adminClient.from("lead_history").delete().in("lead_id", leadIds);
          tablesAffected["lead_history"] = c4 || 0;

          // Agent transfers
          const { count: c4b } = await adminClient.from("agent_transfers").delete().in("lead_id", leadIds);
          tablesAffected["agent_transfers"] = c4b || 0;
        }

        // Zapi conversations + messages
        const { data: zapiConvs } = await adminClient
          .from("zapi_conversations")
          .select("id")
          .eq("phone_number", customer_phone);
        if (zapiConvs && zapiConvs.length > 0) {
          const zapiConvIds = zapiConvs.map((c: { id: string }) => c.id);
          const { count: c5 } = await adminClient.from("zapi_messages").delete().in("conversation_id", zapiConvIds);
          tablesAffected["zapi_messages"] = c5 || 0;
          const { count: c6 } = await adminClient.from("zapi_conversations").delete().in("id", zapiConvIds);
          tablesAffected["zapi_conversations"] = c6 || 0;
        }

        // Whatsapp conversations + messages
        const { data: waConvs } = await adminClient
          .from("whatsapp_conversations")
          .select("id")
          .eq("phone_number", customer_phone);
        if (waConvs && waConvs.length > 0) {
          const waConvIds = waConvs.map((c: { id: string }) => c.id);
          const { count: c7 } = await adminClient.from("whatsapp_messages").delete().in("conversation_id", waConvIds);
          tablesAffected["whatsapp_messages"] = c7 || 0;
          const { count: c8 } = await adminClient.from("whatsapp_conversations").delete().in("id", waConvIds);
          tablesAffected["whatsapp_conversations"] = c8 || 0;
        }

        // CRM data
        if (crmLeadIds.length > 0) {
          const { count: c9 } = await adminClient.from("crm_lead_psychology").delete().in("lead_id", crmLeadIds);
          tablesAffected["crm_lead_psychology"] = c9 || 0;

          const { count: c10 } = await adminClient.from("crm_lead_history").delete().in("lead_id", crmLeadIds);
          tablesAffected["crm_lead_history"] = c10 || 0;

          const { count: c10b } = await adminClient.from("crm_lead_activities").delete().in("lead_id", crmLeadIds);
          tablesAffected["crm_lead_activities"] = c10b || 0;

          // Appointments
          if (contactIds.length > 0) {
            const { count: c11 } = await adminClient.from("crm_appointments").delete().eq("workspace_id", workspace_id).in("contact_id", contactIds);
            tablesAffected["crm_appointments"] = c11 || 0;
          }

          const { count: c12 } = await adminClient.from("crm_leads").delete().in("id", crmLeadIds);
          tablesAffected["crm_leads"] = c12 || 0;
        }

        // Delete leads
        if (leadIds.length > 0) {
          const { count: c13 } = await adminClient.from("leads").delete().in("id", leadIds);
          tablesAffected["leads"] = c13 || 0;
        }

        // Delete contacts
        if (contactIds.length > 0) {
          // A trilha de auditoria cai por ON DELETE CASCADE, mas a contagem
          // precisa constar no data_deletion_log antes da exclusao do contato.
          const { count: cAudit } = await adminClient
            .from("crm_contact_field_history")
            .select("id", { count: "exact", head: true })
            .in("contact_id", contactIds);
          tablesAffected["crm_contact_field_history"] = cAudit || 0;

          const { count: c14 } = await adminClient.from("crm_contacts").delete().in("id", contactIds);
          tablesAffected["crm_contacts"] = c14 || 0;
        }

        const totalRecords = Object.values(tablesAffected).reduce((a, b) => a + b, 0);

        await adminClient.from("data_deletion_log").insert({
          workspace_id,
          requested_by: userId,
          customer_identifier_hash: hash,
          action_type: "full_deletion",
          tables_affected: tablesAffected,
          records_affected_count: totalRecords,
          status: "completed",
        });

        return new Response(
          JSON.stringify({
            success: true,
            action_type: "full_deletion",
            hash,
            tables_affected: tablesAffected,
            records_affected_count: totalRecords,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await adminClient.from("data_deletion_log").insert({
          workspace_id,
          requested_by: userId,
          customer_identifier_hash: hash,
          action_type: "full_deletion",
          tables_affected: tablesAffected,
          records_affected_count: 0,
          status: "failed",
          error_details: errorMsg,
        });
        throw err;
      }
    }

    return new Response(JSON.stringify({ error: "Acao invalida. Use: search, anonymize, delete" }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("LGPD Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
