import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildTenantGuard, sanitizeExtractedContactData } from "../_shared/contactDataGuard.ts";
import type { TenantGuard } from "../_shared/contactDataGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Employee count mapping (same as orchestrator/intent-analyzer.ts)
function mapEmployeeCount(extracted: string | null): string | null {
  if (!extracted) return null;
  const normalized = extracted.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("solo") || normalized.includes("eus.a") || normalized === "1" || normalized.includes("sozinho")) return "Eu S.A.";
  const numbers = extracted.match(/\d+/g)?.map(Number) || [];
  const maxNum = Math.max(...numbers, 0);
  if (maxNum === 0 && numbers.length === 0) {
    if (normalized.includes("pequen") || normalized.includes("micro")) return "1-10 funcionarios";
    if (normalized.includes("medi")) return "51-200 funcionarios";
    if (normalized.includes("grand")) return "+200 funcionarios";
    return null;
  }
  if (maxNum <= 1) return "Eu S.A.";
  if (maxNum <= 10) return "1-10 funcionarios";
  if (maxNum <= 50) return "11-50 funcionarios";
  if (maxNum <= 200) return "51-200 funcionarios";
  return "+200 funcionarios";
}

// Revenue mapping (same as orchestrator/intent-analyzer.ts)
function mapRevenue(extracted: string | null): string | null {
  if (!extracted) return null;
  const normalized = extracted.toLowerCase().replace(/\s+/g, "");
  let monthlyValue = 0;
  const millionMatch = extracted.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|m(?:ilh[oõ](?:es|ao)?)?)/i);
  if (millionMatch) {
    const value = parseFloat(millionMatch[1].replace(",", "."));
    monthlyValue = (normalized.includes("ano") || normalized.includes("anual")) ? (value * 1000000) / 12 : value * 1000000;
  }
  if (monthlyValue === 0) {
    const thousandMatch = extracted.match(/(\d+(?:[.,]\d+)?)\s*(?:k|mil)/i);
    if (thousandMatch) {
      const value = parseFloat(thousandMatch[1].replace(",", "."));
      monthlyValue = (normalized.includes("ano") || normalized.includes("anual")) ? (value * 1000) / 12 : value * 1000;
    }
  }
  if (monthlyValue === 0) {
    const plainMatch = extracted.match(/r?\$?\s*(\d+(?:[.,]\d+)?)/i);
    if (plainMatch) {
      const value = parseFloat(plainMatch[1].replace(",", "."));
      monthlyValue = (value >= 1000000 && !normalized.includes("mes") && !normalized.includes("mensal")) ? value / 12 : value;
    }
  }
  if (monthlyValue === 0) return null;
  if (monthlyValue < 100000) return "Ate 100k/mes";
  if (monthlyValue < 500000) return "Entre 100k e 500k/mes";
  if (monthlyValue < 1000000) return "Entre 500k e 1MM/mes";
  if (monthlyValue < 3000000) return "Entre 1MM e 3MM/mes";
  if (monthlyValue < 5000000) return "Entre 3MM e 5MM/mes";
  return "Acima de 5MM/mes";
}

async function extractContactDataFromHistory(
  messages: { role: string; content: string }[],
  apiKey: string,
  guard: TenantGuard,
  tenantNames: string[]
): Promise<Record<string, string>> {
  // Linhas do atendente marcadas explicitamente: e delas que vinha a contaminacao
  // (agente se apresentando com o nome da empresa, links do proprio produto).
  const historyText = messages.map((m) =>
    m.role === "user"
      ? `[LEAD] ${m.content}`
      : `[ATENDENTE - NAO EXTRAIA DADOS DESTA LINHA] ${m.content}`
  ).join("\n");

  const blockedList = tenantNames.length > 0
    ? tenantNames.map((n) => `"${n}"`).join(", ")
    : "(nenhum nome adicional)";

  const extractPrompt = `Analise esta conversa e extraia informações de contato/empresa mencionadas.

HISTÓRICO DA CONVERSA:
${historyText}

REGRA CRÍTICA DE ORIGEM:
- Extraia SOMENTE dados ditos pelo próprio LEAD (linhas [LEAD]).
- As linhas [ATENDENTE] são da empresa que PRESTA o atendimento. NUNCA extraia nome, empresa, email, telefone ou links delas.
- "company" é a empresa ONDE O LEAD TRABALHA, nunca a empresa que o está atendendo.
- Se a empresa aparecer apenas em linha [ATENDENTE], em um link, em assinatura ou em saudação ("aqui é a Ana da X"), retorne null em "company".
- NUNCA extraia como dado do lead: ${blockedList}, "Nexus", "dn.ia", "dnia.ai", "nexus.dnia.ai".

Extraia APENAS informações que foram EXPLICITAMENTE mencionadas na conversa.
Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com esta estrutura:
{
  "name": "<nome do lead se mencionado, ou null>",
  "email": "<email se mencionado, ou null>",
  "phone": "<telefone se mencionado em qualquer formato, ou null>",
  "company": "<nome da empresa se mencionado, ou null>",
  "employee_count": "<número aproximado de funcionários se mencionado (ex: '1', '15', '150', '500'), ou null>",
  "revenue": "<faturamento se mencionado com indicação se é mensal ou anual (ex: 'R$ 1M/mes', 'R$ 10M/ano', '500k mensal'), ou null>"
}

IMPORTANTE: 
- Retorne null para campos NÃO mencionados. Não invente dados.
- Para phone, extraia qualquer formato de telefone mencionado.
- Para employee_count, extraia o número aproximado mencionado.
- Para revenue, mantenha a indicação de período (mes/ano) se mencionada.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: extractPrompt }],
        max_tokens: 200,
      }),
    });

    if (!response.ok) return {};

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const cleanedContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const extracted = JSON.parse(cleanedContent);

    const result: Record<string, string> = {};
    if (extracted.name) result.name = extracted.name;
    if (extracted.email) result.email = extracted.email;
    if (extracted.phone) result.phone = extracted.phone;
    if (extracted.company) result.company = extracted.company;
    const mappedEc = mapEmployeeCount(extracted.employee_count);
    if (mappedEc) result.employee_count = mappedEc;
    const mappedRev = mapRevenue(extracted.revenue);
    if (mappedRev) result.revenue = mappedRev;

    // Guarda deterministica: o prompt acima e apenas mitigacao.
    const { clean, rejected } = sanitizeExtractedContactData({
      extracted: result,
      history: messages,
      guard,
    });
    for (const r of rejected) {
      console.warn(`[BACKFILL] REJEITADO field=${r.field} value="${r.value}" reason=${r.reason}`);
    }

    return clean;
  } catch (error) {
    console.error("[BACKFILL] AI extraction error:", error);
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Find contacts with missing data that have lead messages
    const { data: contacts, error: contactsError } = await supabase
      .from("crm_contacts")
      .select("id, name, phone, email, company, employee_count, revenue, lead_id, workspace_id")
      .is("company", null)
      .is("employee_count", null)
      .not("name", "eq", "Visitante Widget")
      .not("lead_id", "is", null);

    if (contactsError) {
      throw new Error(`Error fetching contacts: ${contactsError.message}`);
    }

    console.log(`[BACKFILL] Found ${contacts?.length || 0} contacts with missing data`);

    const report: Array<{ contact_id: string; name: string; updated_fields: string[]; extracted: Record<string, string> }> = [];
    let updatedCount = 0;
    let skippedCount = 0;

    // Blocklist por workspace (empresa dona da conta, workspace e agentes).
    // O loop percorre varios workspaces, entao resolve-se sob demanda e guarda.
    const guardCache = new Map<string, { guard: TenantGuard; names: string[] }>();
    async function getGuard(workspaceId: string | null) {
      if (!workspaceId) return { guard: buildTenantGuard([]), names: [] as string[] };
      const hit = guardCache.get(workspaceId);
      if (hit) return hit;

      const names: string[] = [];
      try {
        const { data: ws } = await supabase
          .from("workspaces")
          .select("name, company_id")
          .eq("id", workspaceId)
          .maybeSingle();
        if (ws?.name) names.push(ws.name);
        if (ws?.company_id) {
          const { data: comp } = await supabase
            .from("companies")
            .select("name")
            .eq("id", ws.company_id)
            .maybeSingle();
          if (comp?.name) names.push(comp.name);
        }
        const [inst, legacy] = await Promise.all([
          supabase.from("agent_instances").select("name").eq("workspace_id", workspaceId),
          supabase.from("agents").select("name").eq("workspace_id", workspaceId),
        ]);
        for (const row of [...(inst.data || []), ...(legacy.data || [])]) {
          if (row?.name) names.push(row.name);
        }
      } catch (e) {
        console.error("[BACKFILL] Erro ao montar blocklist:", e);
      }

      const unique = Array.from(new Set(names));
      const entry = { guard: buildTenantGuard(unique), names: unique };
      guardCache.set(workspaceId, entry);
      return entry;
    }

    for (const contact of contacts || []) {
      console.log(`[BACKFILL] Processing: ${contact.name} (lead_id: ${contact.lead_id})`);

      // 2. Get messages for this lead
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("content, sender_type")
        .eq("lead_id", contact.lead_id)
        .not("content", "is", null)
        .order("created_at", { ascending: true })
        .limit(20);

      if (msgError || !messages || messages.length === 0) {
        console.log(`[BACKFILL] No messages for ${contact.name}, skipping`);
        skippedCount++;
        continue;
      }

      // Filter only text messages with content
      const textMessages = messages
        .filter((m: { content: string | null }) => m.content && m.content.trim().length > 5)
        .map((m: { content: string; sender_type: string }) => ({
          role: m.sender_type === "lead" ? "user" : "assistant",
          content: m.content,
        }));

      if (textMessages.length < 2) {
        console.log(`[BACKFILL] Too few messages for ${contact.name}, skipping`);
        skippedCount++;
        continue;
      }

      // 3. Extract data via AI
      const { guard, names: tenantNames } = await getGuard(contact.workspace_id);
      const extracted = await extractContactDataFromHistory(textMessages, apiKey, guard, tenantNames);

      if (Object.keys(extracted).length === 0) {
        console.log(`[BACKFILL] No data extracted for ${contact.name}`);
        skippedCount++;
        continue;
      }

      // 4. Update only NULL fields
      const updateData: Record<string, string> = {};
      const updatedFields: string[] = [];

      if (extracted.company && !contact.company) { updateData.company = extracted.company; updatedFields.push("company"); }
      if (extracted.employee_count && !contact.employee_count) { updateData.employee_count = extracted.employee_count; updatedFields.push("employee_count"); }
      if (extracted.revenue && !contact.revenue) { updateData.revenue = extracted.revenue; updatedFields.push("revenue"); }
      if (extracted.email && !contact.email) { updateData.email = extracted.email; updatedFields.push("email"); }

      if (Object.keys(updateData).length === 0) {
        console.log(`[BACKFILL] All fields already filled for ${contact.name}`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("crm_contacts")
        .update(updateData)
        .eq("id", contact.id);

      if (updateError) {
        console.error(`[BACKFILL] Error updating ${contact.name}:`, updateError);
        continue;
      }

      console.log(`[BACKFILL] Updated ${contact.name}: ${updatedFields.join(", ")}`);
      updatedCount++;
      report.push({ contact_id: contact.id, name: contact.name, updated_fields: updatedFields, extracted });

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    }

    const summary = {
      total_contacts: contacts?.length || 0,
      updated: updatedCount,
      skipped: skippedCount,
      details: report,
    };

    console.log(`[BACKFILL] Complete. Updated: ${updatedCount}, Skipped: ${skippedCount}`);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[BACKFILL] Fatal error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
