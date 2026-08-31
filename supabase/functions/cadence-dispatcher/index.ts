import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatCompletionWithFallback } from "../_shared/geminiClient.ts";
import { getResendKey, resolveFromAddress, RESEND_FROM_NOT_CONFIGURED } from "../_shared/resendCredentials.ts";


async function rewriteWithAI(
  original: string,
  supabase: any,
  companyId: string | null,
  context: { scheduledMessageId?: string; templateId?: string; leadId?: string } = {},
): Promise<string> {
  const text = (original || "").trim();
  if (!text) return original;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const system = [
      "Voce reescreve mensagens de WhatsApp em portugues do Brasil mantendo a essencia.",
      "REGRAS OBRIGATORIAS:",
      "- NAO invente fatos, ofertas, datas, valores, prazos, nomes ou qualquer informacao nova.",
      "- Preserve EXATAMENTE: nomes proprios, URLs/links, numeros, datas, horarios, emojis e variaveis (qualquer texto entre chaves ou ja interpolado).",
      "- Faça uma reescrita perceptivel da redacao quando possivel; nao devolva o texto identico salvo se nao houver alternativa segura.",
      "- Mantenha tom natural e cordial de WhatsApp, sem formalidade excessiva.",
      "- Mantenha tamanho similar ao original (nao alongar, nao resumir agressivamente).",
      "- Nao adicione saudacoes, assinaturas ou comentarios que nao existiam.",
      "- Responda APENAS com o texto reescrito, sem aspas, sem prefixo, sem explicacao.",
    ].join("\n");
    const resp = await chatCompletionWithFallback(
      {
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        temperature: 0.4,
        max_tokens: Math.min(8192, Math.max(1024, Math.ceil(text.length * 4))),
      },
      { companyId, supabase, signal: ctrl.signal },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn("[cadence-dispatcher] AI rewrite non-ok:", {
        ...context,
        status: resp.status,
        latency_ms: Date.now() - started,
        error: body.slice(0, 300),
      });
      return original;
    }
    const json: any = await resp.json();
    const out = json?.choices?.[0]?.message?.content;
    const rewritten = typeof out === "string" ? out.trim() : "";
    const finishReason = json?.choices?.[0]?.finish_reason;

    // Safeguards: discard rewrite if it truncated or lost critical content
    const urlRegex = /https?:\/\/\S+/gi;
    const pctRegex = /\d+\s*%/g;
    const origUrls = text.match(urlRegex) || [];
    const newUrls = rewritten.match(urlRegex) || [];
    const origPcts = text.match(pctRegex) || [];
    const newPcts = rewritten.match(pctRegex) || [];
    const missingUrl = origUrls.some((u) => !rewritten.includes(u));
    const missingPct = origPcts.length > newPcts.length;
    const tooShort = rewritten.length > 0 && rewritten.length < Math.floor(text.length * 0.6);
    const truncated = finishReason === "length";

    if (!rewritten || truncated || tooShort || missingUrl || missingPct) {
      console.warn("[cadence-dispatcher] AI rewrite discarded", {
        ...context,
        reason: !rewritten ? "empty" : truncated ? "truncated" : tooShort ? "too_short" : missingUrl ? "missing_url" : "missing_pct",
        finish_reason: finishReason,
        input_chars: text.length,
        output_chars: rewritten.length,
        usage: json?.usage,
      });
      return original;
    }

    console.info("[cadence-dispatcher] AI rewrite result", {
      ...context,
      model: "google/gemini-2.5-flash-lite",
      latency_ms: Date.now() - started,
      input_chars: text.length,
      output_chars: rewritten.length,
      finish_reason: finishReason,
      changed: rewritten !== text,
    });
    return rewritten;

  } catch (e) {
    console.warn("[cadence-dispatcher] AI rewrite failed:", {
      ...context,
      latency_ms: Date.now() - started,
      error: e instanceof Error ? e.message : e,
    });
    return original;
  } finally {
    clearTimeout(timer);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "America/Sao_Paulo";
const BATCH_LIMIT = 100;

// Períodos do dia (hora local SP)
const PERIODS: Record<string, [number, number]> = {
  manha: [6, 11],   // 06:00–11:59
  tarde: [12, 17],  // 12:00–17:59
  noite: [18, 22],  // 18:00–22:00
};

function getSpDateParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dow: dowMap[parts.weekday] ?? 0,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

function timeStrToMinutes(t: string) {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

function fitsWindow(now: Date, win: { start_time: string; end_time: string; weekdays: number[] } | null) {
  if (!win) return true;
  const { dow, hour, minute } = getSpDateParts(now);
  if (!win.weekdays.includes(dow)) return false;
  const cur = hour * 60 + minute;
  return cur >= timeStrToMinutes(win.start_time) && cur <= timeStrToMinutes(win.end_time);
}

function fitsPeriod(now: Date, period: string) {
  if (!period || period === "qualquer") return true;
  const range = PERIODS[period];
  if (!range) return true;
  const { hour } = getSpDateParts(now);
  return hour >= range[0] && hour <= range[1];
}

function fmtDateBR(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short" }).format(d);
}
function fmtTimeBR(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, timeStyle: "short" }).format(d);
}

function renderTemplate(content: string, vars: Record<string, string>) {
  return content.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

const resendCredsCache = new Map<string, { apiKey: string; fromEmail: string | null } | null>();

async function getResendCredsCached(companyId: string | null): Promise<{ apiKey: string; fromEmail: string | null } | null> {
  if (!companyId) return null;
  if (resendCredsCache.has(companyId)) return resendCredsCache.get(companyId) ?? null;
  try {
    const creds = await getResendKey(companyId);
    const entry = { apiKey: creds.apiKey, fromEmail: creds.fromEmail };
    resendCredsCache.set(companyId, entry);
    return entry;
  } catch {
    resendCredsCache.set(companyId, null);
    return null;
  }
}

async function sendEmail(to: string, subject: string, html: string, from: string, apiKey: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: subject || "Notificação",
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  try {
    const { data: pending, error } = await supabase
      .from("cadence_scheduled_messages")
      .select(`
        id, template_id, rule_id, company_id, workspace_id, lead_id, activity_id, channel, send_at,
        template:cadence_templates(id, channel, subject, from_name, content, day_period, media_url, media_type, agent_id, agent_source, ai_rewrite_enabled),
        rule:cadence_rules(id, trigger_type),
        activity:crm_lead_activities(id, title, scheduled_at, type, status, appointment_id)
      `)
      .eq("status", "pending")
      .lte("send_at", now.toISOString())
      .order("send_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw error;
    if (!pending?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache da janela por company
    const winCache = new Map<string, any>();
    async function getWindow(companyId: string) {
      if (winCache.has(companyId)) return winCache.get(companyId);
      const { data } = await supabase
        .from("company_sending_window")
        .select("start_time,end_time,weekdays")
        .eq("company_id", companyId)
        .maybeSingle();
      winCache.set(companyId, data);
      return data;
    }

    for (const item of pending) {
      processed++;
      const tpl: any = (item as any).template;
      const rule: any = (item as any).rule;
      const activity: any = (item as any).activity;

      if (!tpl || !rule) {
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "skipped", error: "template/rule ausente" }).eq("id", item.id);
        skipped++; continue;
      }

      // Atividade cancelada/concluída → skip (não enviar lembrete)
      if (rule.trigger_type === "activity") {
        if (!activity || (activity.status && ["completed","done","cancelled","no_show"].includes(activity.status))) {
          await supabase.from("cadence_scheduled_messages")
            .update({ status: "skipped" }).eq("id", item.id);
          skipped++; continue;
        }
      }

      const window = await getWindow(item.company_id);
      if (!fitsWindow(now, window) || !fitsPeriod(now, tpl.day_period)) {
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "skipped" }).eq("id", item.id);
        skipped++; continue;
      }

      // Carrega lead + contato + atendente
      const { data: lead, error: leadError } = await supabase
        .from("crm_leads")
        .select("id, title, status, contact_id, workspace_id, assigned_to, contact:crm_contacts(name, phone, email, company, opted_out), assignee:profiles!crm_leads_assigned_to_fkey(name)")
        .eq("id", item.lead_id)
        .maybeSingle();

      const contact: any = lead?.contact;
      if (leadError) {
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "skipped", error: `erro ao carregar lead: ${leadError.message}`.slice(0, 500) }).eq("id", item.id);
        skipped++; continue;
      }
      if (!lead || !contact || contact.opted_out) {
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "skipped", error: !lead ? "lead ausente" : !contact ? "contato ausente" : "contato opt-out" }).eq("id", item.id);
        skipped++; continue;
      }

      // Lead fechado (perdido/ganho) → cancela envio das próximas mensagens da régua
      const leadStatus = String((lead as any).status || "").toLowerCase();
      if (leadStatus === "lost" || leadStatus === "won") {
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "cancelled", error: `lead ${leadStatus}` }).eq("id", item.id);
        skipped++; continue;
      }

      // Link de reunião (somente para meeting/demo via appointment vinculado)
      let meetingLink = "";
      if (activity?.appointment_id && (activity.type === "meeting" || activity.type === "demo")) {
        const { data: appt } = await supabase
          .from("crm_appointments")
          .select("id, meeting_link, daily_room_url, daily_room_name")
          .eq("id", activity.appointment_id)
          .maybeSingle();
        if ((appt as any)?.daily_room_name || (appt as any)?.daily_room_url) {
          meetingLink = `https://nexus.dnia.ai/m/${(appt as any).id}`;
        } else {
          meetingLink = (appt as any)?.meeting_link || "";
        }
      }

      const leadName = contact.name || lead.title || "Cliente";
      const assigneeName = (lead as any)?.assignee?.name || "";
      const activityDate = activity?.scheduled_at ? new Date(activity.scheduled_at) : null;
      const vars: Record<string, string> = {
        nome_lead: leadName,
        primeiro_nome: leadName.split(" ")[0],
        empresa: contact.company || "",
        titulo_atividade: activity?.title || "",
        data_atividade: activityDate ? fmtDateBR(activityDate) : "",
        hora_atividade: activityDate ? fmtTimeBR(activityDate) : "",
        atendente: assigneeName,
        link_reuniao: meetingLink,
      };

      let rendered = renderTemplate(tpl.content || "", vars);
      const renderedSubject = renderTemplate(tpl.subject || "", vars);

      if (tpl.channel === "whatsapp" && tpl.ai_rewrite_enabled === true) {
        console.info("[cadence-dispatcher] AI rewrite enabled", {
          scheduledMessageId: item.id,
          templateId: tpl.id,
          leadId: item.lead_id,
        });
        rendered = await rewriteWithAI(rendered, supabase, item.company_id || null, {
          scheduledMessageId: item.id,
          templateId: tpl.id,
          leadId: item.lead_id,
        });
      }


      // Helper: localizar ou criar lead do inbox vinculado ao contato
      async function resolveOrCreateInboxLead(opts: { requirePhone: boolean }): Promise<{ id: string; workspace_id: string } | null> {
        let found: any = null;
        if (lead.contact_id) {
          const { data } = await supabase
            .from("leads")
            .select("id, workspace_id")
            .eq("workspace_id", item.workspace_id)
            .eq("contact_id", lead.contact_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          found = data;
        }
        if (!found && contact.phone) {
          let normalizedPhone = String(contact.phone).replace(/\D/g, "");
          if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11 && !normalizedPhone.startsWith("55")) {
            normalizedPhone = "55" + normalizedPhone;
          }
          const { data } = await supabase
            .from("leads")
            .select("id, workspace_id")
            .eq("workspace_id", item.workspace_id)
            .eq("phone", normalizedPhone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          found = data;
        }
        if (found?.id) return found;

        if (opts.requirePhone && !contact.phone) return null;

        let normalizedPhone: string | null = null;
        if (contact.phone) {
          normalizedPhone = String(contact.phone).replace(/\D/g, "");
          if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11 && !normalizedPhone.startsWith("55")) {
            normalizedPhone = "55" + normalizedPhone;
          }
        }

        const { data: created, error: createErr } = await supabase
          .from("leads")
          .insert({
            workspace_id: item.workspace_id,
            contact_id: lead.contact_id ?? null,
            phone: normalizedPhone,
            name: contact.name || leadName,
            source: "Cadência",
            status: "ai_talking",
          })
          .select("id, workspace_id")
          .single();
        if (createErr) throw createErr;
        return created;
      }

      try {
        let sentMessageId: number | null = null;
        if (tpl.channel === "whatsapp") {

          if (!contact.phone) {
            await supabase.from("cadence_scheduled_messages")
              .update({ status: "skipped", error: "sem telefone" }).eq("id", item.id);
            skipped++; continue;
          }
          const chatLead = await resolveOrCreateInboxLead({ requirePhone: true });
          if (!chatLead?.id) {
            await supabase.from("cadence_scheduled_messages")
              .update({ status: "skipped", error: "não foi possível criar lead do inbox" }).eq("id", item.id);
            skipped++; continue;
          }

          // Insere a mensagem JÁ com delivery_status='sending' para que o trigger
          // notify_whatsapp_on_outbound_message NÃO dispare o envio assíncrono via pg_net.
          // Quem envia (e atualiza external_message_id/delivery_status) é o próprio
          // dispatcher, de forma SÍNCRONA, garantindo que cadence_scheduled_messages.status
          // reflita o resultado real da entrega na Z-API.
          const { data: insertedMsg, error: msgErr } = await supabase
            .from("messages")
            .insert({
              lead_id: chatLead.id,
              workspace_id: chatLead.workspace_id || item.workspace_id,
              content: rendered,
              sender_type: "ai",
              media_url: tpl.media_url || null,
              media_type: tpl.media_type || null,
              delivery_status: "sending",
            })
            .select("id")
            .single();
          if (msgErr) throw msgErr;

          // Resolve a conexão Z-API e o telefone normalizado
          const { data: conv } = await supabase
            .from("zapi_conversations")
            .select("id, connection_id")
            .eq("lead_id", chatLead.id)
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          let connectionId: string | null = (conv as any)?.connection_id || null;
          if (!connectionId) {
            const { data: cw } = await supabase
              .from("connection_workspaces")
              .select("connection_id")
              .eq("workspace_id", chatLead.workspace_id || item.workspace_id)
              .eq("connection_type", "zapi")
              .eq("is_active", true)
              .limit(1)
              .maybeSingle();
            connectionId = (cw as any)?.connection_id || null;
          }

          // Verifica saúde da conexão Z-API: precisa existir, estar conectada e sem pendência de pagamento.
          // Se não estiver saudável, reagenda a mensagem para +15min (até 24h após o send_at original).
          let connectionHealthy = !!connectionId;
          let unhealthyReason = connectionId ? "" : "sem conexão Z-API ativa";
          if (connectionId) {
            const { data: zconn } = await supabase
              .from("zapi_connections")
              .select("zapi_connected, zapi_payment_status")
              .eq("id", connectionId)
              .maybeSingle();
            const paymentBad = (zconn as any)?.zapi_payment_status &&
              ["OVERDUE", "CANCELED", "CANCELLED", "SUSPENDED"].includes(
                String((zconn as any).zapi_payment_status).toUpperCase(),
              );
            if (!zconn || (zconn as any).zapi_connected !== true) {
              connectionHealthy = false;
              unhealthyReason = "Z-API desconectada";
            } else if (paymentBad) {
              connectionHealthy = false;
              unhealthyReason = `Z-API com pendência (${(zconn as any).zapi_payment_status})`;
            }
          }

          if (!connectionHealthy) {
            // Remove a mensagem recém-inserida (não foi enviada) para não poluir o chat
            if (insertedMsg?.id) {
              await supabase.from("messages").delete().eq("id", insertedMsg.id);
            }
            const originalSendAt = new Date(item.send_at as string).getTime();
            const ageHours = (Date.now() - originalSendAt) / 36e5;
            if (ageHours >= 24) {
              await supabase.from("cadence_scheduled_messages")
                .update({ status: "skipped", error: `cancelado após 24h: ${unhealthyReason}` })
                .eq("id", item.id);
              skipped++;
            } else {
              const next = new Date(Date.now() + 15 * 60 * 1000).toISOString();
              await supabase.from("cadence_scheduled_messages")
                .update({ send_at: next, error: `aguardando: ${unhealthyReason}` })
                .eq("id", item.id);
              skipped++;
              console.info("[cadence-dispatcher] reagendado por conexão indisponível", {
                scheduledMessageId: item.id,
                reason: unhealthyReason,
                next,
              });
            }
            continue;
          }

          let normalizedPhone = String(contact.phone).replace(/\D/g, "");
          if (normalizedPhone.length >= 10 && normalizedPhone.length <= 11 && !normalizedPhone.startsWith("55")) {
            normalizedPhone = "55" + normalizedPhone;
          }

          const sendBody: Record<string, unknown> = {
            connection_id: connectionId,
            phone: normalizedPhone,
            message: rendered,
          };
          if (tpl.media_url && tpl.media_type) {
            sendBody.media_url = tpl.media_url;
            sendBody.media_type = tpl.media_type;
          }

          let sendRes: Response;
          let sendJson: any = {};
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
          } catch (fetchErr: any) {
            if (insertedMsg?.id) {
              await supabase.from("messages")
                .update({ delivery_status: "failed" })
                .eq("id", insertedMsg.id);
            }
            throw new Error(`zapi-send fetch falhou: ${fetchErr?.message || fetchErr}`);
          }

          if (!sendRes.ok) {
            if (insertedMsg?.id) {
              await supabase.from("messages")
                .update({ delivery_status: "failed" })
                .eq("id", insertedMsg.id);
            }
            throw new Error(`zapi-send ${sendRes.status}: ${JSON.stringify(sendJson).slice(0, 300)}`);
          }

          const externalId = sendJson?.zapiMessageId || sendJson?.messageId || sendJson?.message_id;
          if (insertedMsg?.id) {
            await supabase
              .from("messages")
              .update({
                external_message_id: externalId || null,
                delivery_status: "sent",
              })
              .eq("id", insertedMsg.id);
            sentMessageId = insertedMsg.id;
          }


          // Reatribui o chat para o agente IA configurado na mensagem
          if (tpl.agent_id) {
            try {
              const sourceTable = tpl.agent_source === "agents" ? "agents" : "agent_instances";
              const { data: agentRow } = await supabase
                .from(sourceTable)
                .select("id, workspace_id")
                .eq("id", tpl.agent_id)
                .maybeSingle();
              if (agentRow?.id && agentRow.workspace_id === (chatLead.workspace_id || item.workspace_id)) {
                await supabase
                  .from("leads")
                  .update({
                    status: "ai_talking",
                    assigned_agent_id: tpl.agent_id,
                    assigned_to_user_id: null,
                    assigned_at: new Date().toISOString(),
                  })
                  .eq("id", chatLead.id);
              } else {
                console.warn("[cadence-dispatcher] agente não pertence ao workspace do lead, atribuição ignorada");
              }
            } catch (assignErr: any) {
              console.error("[cadence-dispatcher] erro ao reatribuir agente IA", assignErr?.message);
            }
          }
        } else if (tpl.channel === "email") {
          if (!contact.email) {
            await supabase.from("cadence_scheduled_messages")
              .update({ status: "skipped", error: "sem email" }).eq("id", item.id);
            skipped++; continue;
          }
          let html = rendered.replace(/\n/g, "<br>");
          if (tpl.media_url && tpl.media_type === "image") {
            html = `<img src="${tpl.media_url}" style="max-width:100%;height:auto;display:block;margin-bottom:12px"><br>${html}`;
          } else if (tpl.media_url && tpl.media_type === "video") {
            html = `${html}<br><br><a href="${tpl.media_url}">Assistir vídeo</a>`;
          }
          const renderedFromName = tpl.from_name
            ? renderTemplate(tpl.from_name, vars).trim()
            : "";
          const fromName = renderedFromName || (lead as any)?.assignee?.name;
          const creds = await getResendCredsCached(item.company_id || null);
          if (!creds) {
            throw new Error("Resend não configurada para esta empresa. Cadastre em Configurações > Empresa.");
          }
          const fromHeader = resolveFromAddress(creds.fromEmail, fromName || "Nexus");
          if (!fromHeader) {
            throw new Error(RESEND_FROM_NOT_CONFIGURED);
          }
          await sendEmail(contact.email, renderedSubject, html, fromHeader, creds.apiKey);



          // Registra no chat ao vivo como log (media_type='email' impede o trigger de WhatsApp)
          try {
            const chatLead = await resolveOrCreateInboxLead({ requirePhone: false });
            if (chatLead?.id) {
              const mediaLine = tpl.media_url ? `\n[${tpl.media_type === "video" ? "Vídeo" : "Imagem"}: ${tpl.media_url}]\n` : "";
              const logContent = `[E-mail] ${renderedSubject || "(sem assunto)"}${mediaLine}\n\n${rendered}`;
              const { data: emailLogMsg } = await supabase.from("messages").insert({
                lead_id: chatLead.id,
                workspace_id: chatLead.workspace_id || item.workspace_id,
                content: logContent,
                sender_type: "ai",
                media_type: "email",
                delivery_status: "sent",
              }).select("id").single();
              if (emailLogMsg?.id) sentMessageId = emailLogMsg.id;
            }
          } catch (logErr: any) {
            console.error("[cadence-dispatcher] email chat log error", logErr?.message);
          }

        }

        await supabase.from("cadence_scheduled_messages")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            message_id: sentMessageId,
          })
          .eq("id", item.id);

        sent++;

      } catch (err: any) {
        console.error("[cadence-dispatcher] send error", err?.message);
        await supabase.from("cadence_scheduled_messages")
          .update({ status: "skipped", error: String(err?.message || err).slice(0, 500) })
          .eq("id", item.id);
        skipped++;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, sent, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cadence-dispatcher] fatal", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
