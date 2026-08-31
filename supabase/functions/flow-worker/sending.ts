// supabase/functions/flow-worker/sending.ts
// Envio WhatsApp (Z-API, com áudio) e e-mail (Resend) para nós de fluxo.
// Porte do cadence-dispatcher; a ordem das operações segue o spec §3.5:
// validações → reescrita IA → INSERT messages(sending) → zapi-send → external_id.
import type { ClaimedRun, FlowNode } from "./executor.ts";
import { computeNextValidSendTime, fitsPeriod, fitsWindow, type SendingWindow } from "./window.ts";
import { chatCompletionWithFallback } from "../_shared/geminiClient.ts";
import { getResendKey, resolveFromAddress, RESEND_FROM_NOT_CONFIGURED } from "../_shared/resendCredentials.ts";

export type SendOutcome =
  | { status: "sent"; messageId?: number | null; reason?: string }
  | { status: "skipped"; reason: string; messageId?: null }
  | { status: "retry"; reason: string; messageId?: null }
  | { status: "wait"; reason: string; until: string; messageId?: null }
  | { status: "exit"; reason: string; messageId?: null }
  | { status: "fail"; reason: string; messageId?: null };

const TTL_MS = 60_000;
const windowCache = new Map<string, { value: SendingWindow | null; expires: number }>();
const resendCache = new Map<string, { value: { apiKey: string; fromEmail: string | null } | null; expires: number }>();

async function getWindow(supabase: any, companyId: string): Promise<SendingWindow | null> {
  const hit = windowCache.get(companyId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { data } = await supabase.from("company_sending_window")
    .select("start_time,end_time,weekdays").eq("company_id", companyId).maybeSingle();
  windowCache.set(companyId, { value: data ?? null, expires: Date.now() + TTL_MS });
  return data ?? null;
}

function renderTemplate(content: string, vars: Record<string, string>) {
  return content.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function normalizePhone(raw: string): string {
  let p = String(raw).replace(/\D/g, "");
  if (p.length >= 10 && p.length <= 11 && !p.startsWith("55")) p = "55" + p;
  return p;
}

interface SendContext {
  lead: any; contact: any; vars: Record<string, string>;
}

async function loadSendContext(supabase: any, run: ClaimedRun): Promise<SendContext | null> {
  const { data: lead } = await supabase.from("crm_leads")
    .select("id, title, status, contact_id, workspace_id, assigned_to, contact:crm_contacts(id, name, phone, email, company, opted_out), assignee:profiles!crm_leads_assigned_to_fkey(name)")
    .eq("id", run.lead_id).maybeSingle();
  if (!lead || !lead.contact) return null;
  const leadName = lead.contact.name || lead.title || "Cliente";
  return {
    lead, contact: lead.contact,
    vars: {
      nome_lead: leadName,
      primeiro_nome: leadName.split(" ")[0],
      empresa: lead.contact.company || "",
      atendente: (lead as any)?.assignee?.name || "",
    },
  };
}

// Porte de rewriteWithAI (dispatcher linhas 7–102), com os mesmos safeguards
// (URLs/percentuais preservados, tamanho mínimo, truncamento).
async function rewriteWithAI(original: string, supabase: any, companyId: string | null): Promise<string> {
  const text = (original || "").trim();
  if (!text) return original;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const system = [
      "Voce reescreve mensagens de WhatsApp em portugues do Brasil mantendo a essencia.",
      "REGRAS OBRIGATORIAS:",
      "- NAO invente fatos, ofertas, datas, valores, prazos, nomes ou qualquer informacao nova.",
      "- Preserve EXATAMENTE: nomes proprios, URLs/links, numeros, datas, horarios, emojis e variaveis.",
      "- Faça uma reescrita perceptivel quando possivel; nao devolva texto identico salvo sem alternativa segura.",
      "- Mantenha tom natural de WhatsApp e tamanho similar ao original.",
      "- Responda APENAS com o texto reescrito.",
    ].join("\n");
    const resp = await chatCompletionWithFallback({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: system }, { role: "user", content: text }],
      temperature: 0.4,
      max_tokens: Math.min(8192, Math.max(1024, Math.ceil(text.length * 4))),
    }, { companyId, supabase, signal: ctrl.signal });
    if (!resp.ok) return original;
    const json: any = await resp.json();
    const out = json?.choices?.[0]?.message?.content;
    const rewritten = typeof out === "string" ? out.trim() : "";
    const urls = text.match(/https?:\/\/\S+/gi) || [];
    const missingUrl = urls.some((u) => !rewritten.includes(u));
    const missingPct = (text.match(/\d+\s*%/g) || []).length > (rewritten.match(/\d+\s*%/g) || []).length;
    const tooShort = rewritten.length > 0 && rewritten.length < Math.floor(text.length * 0.6);
    if (!rewritten || json?.choices?.[0]?.finish_reason === "length" || tooShort || missingUrl || missingPct) return original;
    return rewritten;
  } catch {
    return original;
  } finally {
    clearTimeout(timer);
  }
}

// Porte de resolveOrCreateInboxLead (dispatcher linhas 354–408).
// Spec §9 item 10: status do lead novo depende de haver agente configurado.
async function resolveOrCreateInboxLead(
  supabase: any, run: ClaimedRun, ctx: SendContext, hasAgent: boolean,
): Promise<{ id: string; workspace_id: string } | null> {
  let found: any = null;
  if (ctx.lead.contact_id) {
    const { data } = await supabase.from("leads").select("id, workspace_id")
      .eq("workspace_id", run.workspace_id).eq("contact_id", ctx.lead.contact_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    found = data;
  }
  if (!found && ctx.contact.phone) {
    const { data } = await supabase.from("leads").select("id, workspace_id")
      .eq("workspace_id", run.workspace_id).eq("phone", normalizePhone(ctx.contact.phone))
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    found = data;
  }
  if (found?.id) return found;
  if (!ctx.contact.phone) return null;
  const { data: created, error } = await supabase.from("leads").insert({
    workspace_id: run.workspace_id,
    contact_id: ctx.lead.contact_id ?? null,
    phone: normalizePhone(ctx.contact.phone),
    name: ctx.contact.name || ctx.vars.nome_lead,
    source: "Fluxo",
    status: hasAgent ? "ai_talking" : "new",
  }).select("id, workspace_id").single();
  if (error) throw error;
  return created;
}

export async function execSendWhatsApp(supabase: any, run: ClaimedRun, node: FlowNode): Promise<SendOutcome> {
  const cfg = node.config as Record<string, any>;
  const ctx = await loadSendContext(supabase, run);
  if (!ctx) return { status: "skipped", reason: "lead ou contato ausente" };
  if (ctx.contact.opted_out) return { status: "exit", reason: "contato opt-out" };
  if (!ctx.contact.phone) return { status: "skipped", reason: "sem telefone" };

  // Janela + período: reagenda para o próximo horário válido (spec §3.3)
  const now = new Date();
  const win = await getWindow(supabase, run.company_id);
  if (!fitsWindow(now, win) || !fitsPeriod(now, cfg.day_period)) {
    const next = computeNextValidSendTime(now, win, cfg.day_period);
    if (!next) return { status: "skipped", reason: "janela de envio sem horário válido nos próximos 8 dias" };
    return { status: "wait", reason: "fora da janela/período", until: next.toISOString() };
  }

  // Conexão Z-API: existir, conectada, sem pendência (porte dispatcher 446–516)
  const inboxLead = await resolveOrCreateInboxLead(supabase, run, ctx, !!cfg.agent_id);
  if (!inboxLead?.id) return { status: "skipped", reason: "não foi possível criar lead do inbox" };

  const { data: conv } = await supabase.from("zapi_conversations")
    .select("id, connection_id").eq("lead_id", inboxLead.id)
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  let connectionId: string | null = conv?.connection_id ?? null;
  if (!connectionId) {
    const { data: cw } = await supabase.from("connection_workspaces")
      .select("connection_id").eq("workspace_id", inboxLead.workspace_id)
      .eq("connection_type", "zapi").eq("is_active", true).limit(1).maybeSingle();
    connectionId = cw?.connection_id ?? null;
  }
  let unhealthy = connectionId ? "" : "sem conexão Z-API ativa";
  if (connectionId) {
    const { data: zconn } = await supabase.from("zapi_connections")
      .select("zapi_connected, zapi_payment_status").eq("id", connectionId).maybeSingle();
    const paymentBad = zconn?.zapi_payment_status &&
      ["OVERDUE", "CANCELED", "CANCELLED", "SUSPENDED"].includes(String(zconn.zapi_payment_status).toUpperCase());
    if (!zconn || zconn.zapi_connected !== true) unhealthy = "Z-API desconectada";
    else if (paymentBad) unhealthy = `Z-API com pendência (${zconn.zapi_payment_status})`;
  }
  if (unhealthy) {
    // Conexão fora: reagenda +15min por até 24h (spec §3.4). O executor limita
    // pelo contador de retries? Não — este caso usa "wait" com deadline no context.
    const firstWait = Number((run.context as any)?.conn_wait_started?.[node.id] ?? 0);
    const started = firstWait || Date.now();
    ((run.context as any).conn_wait_started ??= {})[node.id] = started;
    if (Date.now() - started >= 24 * 3600_000) {
      return { status: "fail", reason: `cancelado após 24h: ${unhealthy}` };
    }
    return { status: "wait", reason: unhealthy, until: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  // Reescrita IA — DEPOIS de todas as validações (spec §3.5)
  let rendered = renderTemplate(String(cfg.content || ""), ctx.vars);
  if (cfg.ai_rewrite_enabled === true && rendered.trim()) {
    rendered = await rewriteWithAI(rendered, supabase, run.company_id);
  }

  // INSERT com delivery_status='sending' suprime o trigger de envio assíncrono
  const { data: insertedMsg, error: msgErr } = await supabase.from("messages").insert({
    lead_id: inboxLead.id,
    workspace_id: inboxLead.workspace_id,
    content: rendered,
    sender_type: "ai",
    media_url: cfg.media_url || null,
    media_type: cfg.media_type || null,
    delivery_status: "sending",
  }).select("id").single();
  if (msgErr) return { status: "retry", reason: `insert messages: ${msgErr.message}` };

  const sendBody: Record<string, unknown> = {
    connection_id: connectionId,
    phone: normalizePhone(ctx.contact.phone),
    message: rendered,
  };
  if (cfg.media_url && cfg.media_type) {
    sendBody.media_url = cfg.media_url;
    sendBody.media_type = cfg.media_type;
    if (cfg.media_type === "audio" && cfg.audio_duration) sendBody.audio_duration = cfg.audio_duration;
  }

  let sendRes: Response, sendJson: any = {};
  try {
    sendRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/zapi-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(sendBody),
    });
    sendJson = await sendRes.json().catch(() => ({}));
  } catch (e) {
    await supabase.from("messages").update({ delivery_status: "failed" }).eq("id", insertedMsg.id);
    return { status: "retry", reason: `zapi-send fetch: ${e instanceof Error ? e.message : e}` };
  }
  if (!sendRes.ok) {
    await supabase.from("messages").update({ delivery_status: "failed" }).eq("id", insertedMsg.id);
    return { status: "retry", reason: `zapi-send ${sendRes.status}: ${JSON.stringify(sendJson).slice(0, 200)}` };
  }

  const externalId = sendJson?.zapiMessageId || sendJson?.messageId || sendJson?.message_id;
  await supabase.from("messages")
    .update({ external_message_id: externalId || null, delivery_status: "sent" })
    .eq("id", insertedMsg.id);

  // Agente IA assume o chat (porte dispatcher 577–601, com guarda de workspace)
  if (cfg.agent_id) {
    const sourceTable = cfg.agent_source === "agents" ? "agents" : "agent_instances";
    const { data: agentRow } = await supabase.from(sourceTable)
      .select("id, workspace_id").eq("id", cfg.agent_id).maybeSingle();
    if (agentRow?.id && agentRow.workspace_id === inboxLead.workspace_id) {
      await supabase.from("leads").update({
        status: "ai_talking",
        assigned_agent_id: cfg.agent_id,
        assigned_to_user_id: null,
        assigned_at: new Date().toISOString(),
      }).eq("id", inboxLead.id);
    } else {
      console.warn("[flow-worker] agente não pertence ao workspace do lead, atribuição ignorada");
    }
  }

  return { status: "sent", messageId: insertedMsg.id };
}

export async function execSendEmail(supabase: any, run: ClaimedRun, node: FlowNode): Promise<SendOutcome> {
  const cfg = node.config as Record<string, any>;
  const ctx = await loadSendContext(supabase, run);
  if (!ctx) return { status: "skipped", reason: "lead ou contato ausente" };
  if (ctx.contact.opted_out) return { status: "exit", reason: "contato opt-out" };
  if (!ctx.contact.email) return { status: "skipped", reason: "sem email" };

  const now = new Date();
  const win = await getWindow(supabase, run.company_id);
  if (!fitsWindow(now, win)) {
    const next = computeNextValidSendTime(now, win, null);
    if (!next) return { status: "skipped", reason: "janela de envio sem horário válido nos próximos 8 dias" };
    return { status: "wait", reason: "fora da janela", until: next.toISOString() };
  }

  const cached = resendCache.get(run.company_id);
  let creds = cached && cached.expires > Date.now() ? cached.value : undefined;
  if (creds === undefined) {
    try {
      const k = await getResendKey(run.company_id);
      creds = { apiKey: k.apiKey, fromEmail: k.fromEmail };
    } catch {
      creds = null;
    }
    resendCache.set(run.company_id, { value: creds, expires: Date.now() + TTL_MS });
  }
  if (!creds) return { status: "retry", reason: "Resend não configurada para esta empresa (Configurações > Empresa)" };

  const subject = renderTemplate(String(cfg.subject || ""), ctx.vars);
  const html = renderTemplate(String(cfg.html || ""), ctx.vars);
  const fromName = renderTemplate(String(cfg.from_name || ""), ctx.vars).trim()
    || (ctx.lead as any)?.assignee?.name || "Nexus";
  const fromHeader = resolveFromAddress(creds.fromEmail, fromName);
  if (!fromHeader) return { status: "retry", reason: RESEND_FROM_NOT_CONFIGURED };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromHeader, to: [ctx.contact.email], subject: subject || "Notificação", html }),
  });
  if (!res.ok) return { status: "retry", reason: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };

  // Log no chat do inbox (media_type='email' suprime o trigger de WhatsApp)
  let messageId: number | null = null;
  try {
    const inboxLead = await resolveOrCreateInboxLead(supabase, run, ctx, false);
    if (inboxLead?.id) {
      const { data: logMsg } = await supabase.from("messages").insert({
        lead_id: inboxLead.id,
        workspace_id: inboxLead.workspace_id,
        content: `[E-mail] ${subject || "(sem assunto)"}\n\n${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`,
        sender_type: "ai",
        media_type: "email",
        delivery_status: "sent",
      }).select("id").single();
      messageId = logMsg?.id ?? null;
    }
  } catch (e) {
    console.error("[flow-worker] email chat log error", e instanceof Error ? e.message : e);
  }
  return { status: "sent", messageId };
}
