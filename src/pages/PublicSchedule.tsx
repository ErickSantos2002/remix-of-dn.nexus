import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Native <select> used instead of shadcn Select to keep the critical bundle small.
import { ChevronLeft, ChevronRight, Clock, CalendarDays, CheckCircle2, Video, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadClarity, clarityEvent, claritySet, clarityIdentify } from "@/lib/clarity";
import { ensureFontLoaded, mergeStyle, toCssVars, type SchedulingStyle } from "@/lib/schedulingStyle";
import { ensureGoogleAdsTag, fireGoogleAdsConversion } from "@/lib/googleAds";
import { isRealBrazilianMobile } from "@/lib/phone";

interface SlotData {
  date: string;
  time: string;
  datetime: string;
}

interface GoogleAdsConversions {
  account?: string | null;
  lead?: string | null;
  qualified?: string | null;
  scheduled?: string | null;
  icp_blocked?: string | null;
  already_scheduled?: string | null;
}

interface WidgetInfo {
  id: string;
  name: string;
  title?: string | null;
  description: string;
  duration_minutes: number;
  meta_pixel_id?: string | null;
  clarity_project_id?: string | null;
  booking_window_days?: number;
  style?: Partial<SchedulingStyle> | null;
  google_ads_send_to?: string | null;
  gtm_container_id?: string | null;
  google_ads_conversions?: GoogleAdsConversions | null;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    __nexus_meta_pixels_initialized?: Record<string, boolean>;
    __nexusSchedulePrefetch?: Record<string, Promise<unknown> | undefined>;
    __nexusScheduleData?: Record<string, { widget: WidgetInfo; slots: SlotData[]; error?: string } | undefined>;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __nexus_gads_initialized?: Record<string, boolean>;
    __nexus_gtm_initialized?: Record<string, boolean>;
    
  }
}


interface BookingResult {
  success: boolean;
  meeting_link: string | null;
  date: string;
  time: string;
  duration_minutes: number;
}

type Step = "basic" | "qualify" | "calendar" | "icp_blocked" | "already_scheduled" | "success";

interface ExistingAppointment {
  id: string;
  title?: string | null;
  start_time: string;
  duration_minutes?: number | null;
  meeting_link?: string | null;
  assignee_name?: string | null;
}

const JOB_TITLE_OPTIONS = ["CEO / Fundador", "Diretor(a)", "Gerente / Coordenador(a)", "Analista / Especialista", "Consultor(a)", "Outro"];
const EMPLOYEE_OPTIONS = ["Individual", "2 - 10", "11 - 25", "26 - 49", "Acima de 50"];
const REVENUE_OPTIONS = [
  "Até R$ 100 mil por mês",
  "Entre R$ 100 mil e R$ 500 mil por mês",
  "Entre R$ 500 mil e R$ 1 milhão por mês",
  "Entre R$ 1 milhão e R$ 3 milhões por mês",
  "Entre R$ 3 milhões e R$ 5 milhões por mês",
  "Acima de R$ 5 milhões por mês",
];

const STEP_INDEX: Record<Exclude<Step, "success">, number> = { basic: 1, qualify: 2, calendar: 3, icp_blocked: 4, already_scheduled: 4 };

type GadsStep = "lead" | "qualified" | "scheduled" | "icp_blocked" | "already_scheduled";
// Backward-compat: sem config por-widget, só estas 2 etapas usavam o label único da empresa.
const GADS_LEGACY_EVENT: Partial<Record<GadsStep, string>> = { lead: "sign_up", scheduled: "schedule" };

function shouldSkipMetaEvents(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith("@dnia.ai");
}

function pushDataLayer(event: string, params: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...params });
    console.log(`[GTM] dataLayer push: ${event}`, params);
  } catch (e) {
    console.error("[GTM] dataLayer push error", e);
  }
}

export default function PublicSchedule() {
  const { widgetId } = useParams<{ widgetId: string }>();
  const [searchParams] = useSearchParams();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Hydrate from the index.html prefetch cache when available — skips the
  // "loading" flicker on first render.
  const initialCacheKey = `${widgetId}|${currentMonth}`;
  const initialCached =
    typeof window !== "undefined" ? window.__nexusScheduleData?.[initialCacheKey] : undefined;

  const [widget, setWidget] = useState<WidgetInfo | null>(initialCached?.widget ?? null);
  const [slots, setSlots] = useState<SlotData[]>(initialCached?.slots ?? []);
  const [loading, setLoading] = useState(!initialCached);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("basic");

  const isEmbed = searchParams.get("embed") === "1";
  const containerRef = useRef<HTMLDivElement>(null);
  const timesRef = useRef<HTMLDivElement>(null);

  const swStyle = useMemo(() => mergeStyle(widget?.style), [widget?.style]);
  const swCssVars = useMemo(() => toCssVars(swStyle), [swStyle]);

  useEffect(() => {
    ensureFontLoaded(swStyle.titleFont);
    ensureFontLoaded(swStyle.bodyFont);
  }, [swStyle.titleFont, swStyle.bodyFont]);

  // Auto-resize parent iframe when embedded
  useEffect(() => {
    if (!isEmbed || typeof window === "undefined") return;
    const post = () => {
      const h = containerRef.current?.scrollHeight ?? document.documentElement.scrollHeight;
      try { window.parent.postMessage({ type: "nexus:schedule:resize", height: h }, "*"); } catch { /* noop */ }
    };
    post();
    const ro = new ResizeObserver(post);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("load", post);
    const t = setInterval(post, 800);
    return () => { ro.disconnect(); window.removeEventListener("load", post); clearInterval(t); };
  }, [isEmbed, step]);

  // Smooth-scroll para horários ao selecionar uma data (mobile)
  useEffect(() => {
    if (!selectedDate) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    requestAnimationFrame(() => {
      timesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedDate]);

  const maskBrazilianPhone = (value: string): string => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length === 0) return "";
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const isValidBRPhone = (masked: string): boolean => isRealBrazilianMobile(masked);

  // Mensagem especifica: formato incompleto vs numero claramente ficticio
  const phoneErrorMessage = (masked: string): string => {
    const digits = masked.replace(/\D/g, "");
    if (digits.length !== 11 || digits[2] !== "9") {
      return "Informe um WhatsApp válido: DDD + 9 dígitos começando com 9.";
    }
    return "Este número parece inválido. Informe seu WhatsApp real.";
  };

  // Tags from URL: ?tag=foo or ?tag=foo&tag=bar or ?tag=foo,bar
  const urlTags = useMemo(() => {
    const raw = searchParams.getAll("tag");
    const all = raw.flatMap((v) => v.split(","));
    const cleaned = all.map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(cleaned));
  }, [searchParams]);

  // UTMs + source from URL (source vai para crm_contacts.source — Origem)
  const utmFromUrl = useMemo(() => ({
    utm_source: searchParams.get("utm_source") || undefined,
    utm_medium: searchParams.get("utm_medium") || undefined,
    utm_campaign: searchParams.get("utm_campaign") || undefined,
    utm_term: searchParams.get("utm_term") || undefined,
    utm_content: searchParams.get("utm_content") || undefined,
    source: searchParams.get("source") || undefined,
  }), [searchParams]);

  // A/B testing params injetados pelo dn.marketing na URL do iframe.
  // Persistidos em crm_contacts para propagação ao coletor do dnmkt.
  const abFromUrl = useMemo(() => ({
    ab_vid: searchParams.get("ab_vid") || undefined,
    ab_test: searchParams.get("ab_test") || undefined,
    ab_var: searchParams.get("ab_var") || undefined,
  }), [searchParams]);

  // Fire-and-forget: envia evento de avanço de etapa ao coletor do dn.marketing.
  // Nunca lança / bloqueia navegação. Só dispara quando ab_vid existe.
  const trackScheduleStep = (step: 2 | 3) => {
    try {
      const { ab_vid, ab_test, ab_var } = abFromUrl;
      if (!ab_vid) return;
      const payload = {
        ab_vid,
        ab_test,
        ab_var,
        event_type: "schedule_step",
        event_name: String(step),
        metadata: { step },
      };
      const url = "https://go.dnia.ai/e";
      const body = JSON.stringify(payload);
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon(url, blob)) return;
        } catch { /* fallback abaixo */ }
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        mode: "no-cors",
      }).catch(() => { /* silencioso */ });
    } catch { /* nunca quebra o form */ }
  };

  const [name, setName] = useState(searchParams.get("name") || "");
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [whatsapp, setWhatsapp] = useState(maskBrazilianPhone(searchParams.get("whatsapp") || ""));
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [revenue, setRevenue] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");

  const [leadId, setLeadId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailValidating, setEmailValidating] = useState(false);


  const [result, setResult] = useState<BookingResult | null>(null);
  const [icpBlockedMessage, setIcpBlockedMessage] = useState<string | null>(null);
  const [existingAppointment, setExistingAppointment] = useState<ExistingAppointment | null>(null);
  const [existingMessage, setExistingMessage] = useState<string | null>(null);

  // Fetch slots (consume prefetch cache from index.html when available)
  useEffect(() => {
    if (!widgetId) return;
    const cacheKey = `${widgetId}|${currentMonth}`;
    // Already hydrated from index.html cache — skip refetch.
    if (typeof window !== "undefined" && window.__nexusScheduleData?.[cacheKey]) {
      return;
    }
    setLoading(true);
    setError(null);

    const fetchSlots = async () => {
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const cacheKey = `${widgetId}|${currentMonth}`;
        const prefetched = typeof window !== "undefined" ? window.__nexusSchedulePrefetch?.[cacheKey] : undefined;
        let data: { widget: WidgetInfo; slots: SlotData[]; error?: string } | null = null;
        if (prefetched) {
          data = (await prefetched) as typeof data;
          if (typeof window !== "undefined" && window.__nexusSchedulePrefetch) {
            delete window.__nexusSchedulePrefetch[cacheKey];
          }
        }
        if (!data) {
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/schedule-widget?widget_id=${widgetId}&month=${currentMonth}`,
            { headers: { "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
          );
          data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Failed to load");
        }
        setWidget(data!.widget);
        setSlots(data!.slots || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erro ao carregar agenda");
      } finally {
        setLoading(false);
      }
    };
    fetchSlots();
  }, [widgetId, currentMonth]);

  // Load Meta Pixel dynamically — fire PageView on load; re-init with userData once available
  useEffect(() => {
    const pixelId = widget?.meta_pixel_id;
    if (!pixelId || typeof window === "undefined") return;
    if (shouldSkipMetaEvents(email)) return;
    const initializedPixels = window.__nexus_meta_pixels_initialized ?? (window.__nexus_meta_pixels_initialized = {});

    const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const userData: Record<string, string> = {};
    if (email.trim()) userData.em = email.trim().toLowerCase();
    if (whatsapp.replace(/\D/g, "")) userData.ph = whatsapp.replace(/\D/g, "");
    if (parts[0]) userData.fn = parts[0];
    if (parts.length > 1) userData.ln = parts.slice(1).join(" ");

    if (window.fbq) {
      if (!initializedPixels[pixelId]) {
        window.fbq("init", pixelId, Object.keys(userData).length ? userData : undefined);
        initializedPixels[pixelId] = true;
      }
      window.fbq("track", "PageView");
      return;
    }
    /* eslint-disable */
    (function (f: any, b: Document, e: string, v: string) {
      let n: any, t: HTMLScriptElement, s: HTMLScriptElement | null;
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e) as HTMLScriptElement; t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0] as HTMLScriptElement;
      s?.parentNode?.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq?.("init", pixelId, Object.keys(userData).length ? userData : undefined);
    initializedPixels[pixelId] = true;
    window.fbq?.("track", "PageView");
  }, [widget?.meta_pixel_id, name, email, whatsapp, leadId]);

  // Load Google Ads gtag.js when widget exposes google_ads_send_to (format: AW-XXXX/LABEL)
  useEffect(() => {
    void ensureGoogleAdsTag(widget?.google_ads_send_to);
  }, [widget?.google_ads_send_to]);

  // Load Google Tag Manager when widget exposes gtm_container_id (company-level)
  useEffect(() => {
    const gtmId = widget?.gtm_container_id?.trim();
    if (!gtmId || typeof window === "undefined") return;
    if (!/^GTM-[A-Z0-9]+$/i.test(gtmId)) return;
    const initialized = window.__nexus_gtm_initialized ?? (window.__nexus_gtm_initialized = {});
    if (initialized[gtmId]) return;
    initialized[gtmId] = true;

    window.dataLayer = window.dataLayer || [];
    (window.dataLayer as unknown[]).push({ "gtm.start": Date.now(), event: "gtm.js" });

    if (!document.querySelector(`script[data-nexus-gtm="${gtmId}"]`)) {
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
      s.setAttribute("data-nexus-gtm", gtmId);
      document.head.appendChild(s);
    }
    // <noscript> iframe fallback
    if (!document.querySelector(`iframe[data-nexus-gtm="${gtmId}"]`)) {
      const ns = document.createElement("noscript");
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(gtmId)}`;
      iframe.height = "0";
      iframe.width = "0";
      iframe.style.display = "none";
      iframe.style.visibility = "hidden";
      iframe.setAttribute("data-nexus-gtm", gtmId);
      ns.appendChild(iframe);
      document.body.insertBefore(ns, document.body.firstChild);
    }
  }, [widget?.gtm_container_id]);





  // Load Microsoft Clarity when widget exposes clarity_project_id (deferred to idle)
  useEffect(() => {
    const projectId = widget?.clarity_project_id;
    if (!projectId) return;
    if (shouldSkipMetaEvents(email)) return;
    const run = () => {
      const loaded = loadClarity(projectId);
      if (!loaded) return;
      claritySet("widget_name", widget?.name || "");
      claritySet("widget_id", widget?.id || "");
      claritySet("widget_kind", "scheduling");
      clarityEvent("PageView");
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => { try { w.cancelIdleCallback?.(id); } catch { /* noop */ } };
    }
    const t = window.setTimeout(run, 2000);
    return () => window.clearTimeout(t);
  }, [widget?.clarity_project_id, widget?.name, widget?.id, email]);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const endpoint = `https://${projectId}.supabase.co/functions/v1/schedule-widget`;

  const userDataForPixel = () => {
    const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return {
      em: email.trim().toLowerCase() || undefined,
      ph: whatsapp.replace(/\D/g, "") || undefined,
      fn: parts[0] || undefined,
      ln: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
    };
  };

  // Dispara a conversão do Google Ads correspondente à etapa do funil.
  // Precedência: se o widget tem google_ads_conversions (account + label da etapa), usa esse label;
  // caso contrário, backward-compat com o label único da empresa (só para lead/scheduled).
  const fireGadsStep = (step: GadsStep, transactionId: string) => {
    const conv = widget?.google_ads_conversions;
    // Conta AW herdada da config da empresa (google_ads_send_to = AW-XXXX/LABEL); override opcional em conv.account.
    const account = conv?.account?.trim() || widget?.google_ads_send_to?.split("/")[0]?.trim();
    const label = conv?.[step];
    if (account && label) {
      void fireGoogleAdsConversion({ sendTo: `${account}/${label}`, eventName: step, transactionId });
      return;
    }
    // Backward-compat: sem label por-etapa, usa o send_to completo da empresa em lead/scheduled.
    const legacyEvent = GADS_LEGACY_EVENT[step];
    if (legacyEvent && widget?.google_ads_send_to) {
      void fireGoogleAdsConversion({ sendTo: widget.google_ads_send_to, eventName: legacyEvent, transactionId });
    }
  };

  // Evento custom do Meta para estados terminais (respeita pixel configurado e skip interno).
  const fireMetaCustom = (eventName: string) => {
    if (typeof window === "undefined" || !window.fbq || !widget?.meta_pixel_id || shouldSkipMetaEvents(email)) return;
    const payload = { content_name: widget?.name, content_category: "agendamento", ...userDataForPixel() };
    try { window.fbq("trackCustom", eventName, payload); }
    catch (e) { console.error(`[MetaPixel] ${eventName} error`, e); }
  };

  const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


  const validateEmail = async (value: string): Promise<boolean> => {
    const v = value.trim();
    if (!v) { setEmailError(null); return false; }
    if (!EMAIL_FORMAT.test(v)) { setEmailError("Formato de email inválido"); return false; }
    setEmailValidating(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ action: "validate-email", email: v }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setEmailError(data.error || "Este domínio de email não recebe mensagens.");
        return false;
      }
      setEmailError(null);
      return true;
    } catch {
      setEmailError(null); // não bloqueia em erro de rede
      return true;
    } finally {
      setEmailValidating(false);
    }
  };

  // Etapa 1 → register-lead
  const handleSubmitBasic = async () => {
    if (!name.trim() || !email.trim() || !whatsapp.trim()) return;
    if (!isValidBRPhone(whatsapp)) {
      setWhatsappError(phoneErrorMessage(whatsapp));
      return;
    }
    setWhatsappError(null);
    const emailOk = await validateEmail(email);
    if (!emailOk) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ action: "register-lead", widget_id: widgetId, name, email, whatsapp, tags: urlTags, utm: utmFromUrl, ...abFromUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao registrar lead");
      setLeadId(data.lead_id);
      setContactId(data.contact_id);

      // Meta Pixel Lead + CompleteRegistration (final da etapa 1)
      if (typeof window !== "undefined" && window.fbq && widget?.meta_pixel_id && !shouldSkipMetaEvents(email)) {
        const payload = { content_name: widget.name, content_category: "agendamento", ...userDataForPixel() };
        try { window.fbq("track", "Lead", payload); } catch (e) { console.error("[MetaPixel] Lead error", e); }
        try { window.fbq("track", "CompleteRegistration", { ...payload, status: true }); } catch (e) { console.error("[MetaPixel] CompleteRegistration error", e); }
      }

      // Google (GTM/GA4/Ads) — cadastro (final da etapa 1)
      if (!shouldSkipMetaEvents(email)) {
        const gParams = {
          widget_name: widget?.name,
          widget_slug: widget?.id,
          content_category: "agendamento",
          lead_id: data.lead_id,
          contact_id: data.contact_id,
        };
        pushDataLayer("sign_up", gParams);
        pushDataLayer("generate_lead", gParams);
        fireGadsStep("lead", `lead_${data.lead_id}`);
      }

      // Microsoft Clarity Lead + CompleteRegistration (final da etapa 1)
      if (widget?.clarity_project_id && !shouldSkipMetaEvents(email)) {
        clarityIdentify(email.trim().toLowerCase());
        claritySet("lead_email", email.trim().toLowerCase());
        clarityEvent("Lead");
        clarityEvent("CompleteRegistration");
      }


      // Evento fire-and-forget de avanço para etapa 2 (dn.marketing A/B)
      trackScheduleStep(2);

      setStep("qualify");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao registrar dados");
    } finally {
      setSubmitting(false);
    }
  };

  // Etapa 2 → qualify-lead
  const handleSubmitQualify = async () => {
    if (!jobTitle.trim() || !company.trim() || !revenue || !employeeCount || !leadId || !contactId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          action: "qualify-lead",
          widget_id: widgetId,
          lead_id: leadId,
          contact_id: contactId,
          job_title: jobTitle,
          company,
          revenue,
          employee_count: employeeCount,
          ...abFromUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.icp_blocked) {
          setIcpBlockedMessage(data.error || "Lead fora do perfil desejado para esta agenda.");
          fireMetaCustom("Fora do ICP");
          fireGadsStep("icp_blocked", `icpblock_${leadId}`);
          setStep("icp_blocked");
          return;
        }
        if (data?.already_scheduled) {
          if (data.appointment) setExistingAppointment(data.appointment as ExistingAppointment);
          setExistingMessage(data.message || "Você já possui uma reunião agendada. Se precisar reagendar, fale com nosso time.");
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
          setStep("already_scheduled");
          return;
        }
        throw new Error(data.error || "Erro ao qualificar");
      }

      // Meta Pixel + Clarity "Leads Qualificados" (final da etapa 2)
      if (!shouldSkipMetaEvents(email)) {
        if (typeof window !== "undefined" && window.fbq && widget?.meta_pixel_id) {
          const payload = {
            content_name: widget.name,
            content_category: "agendamento",
            job_title: jobTitle,
            company_name: company,
            revenue,
            employee_count: employeeCount,
            currency: "BRL",
            value: 0,
            ...userDataForPixel(),
          };
          try { window.fbq("trackCustom", "Leads Qualificados", payload); } catch (e) { console.error("[MetaPixel] Leads Qualificados error", e); }
        }
        if (widget?.clarity_project_id) {
          claritySet("job_title", jobTitle);
          claritySet("company", company);
          claritySet("revenue", revenue);
          claritySet("employee_count", employeeCount);
          clarityEvent("Leads Qualificados");
        }
      }

      // Google (GTM/GA4) — qualificação (final da etapa 2)
      if (!shouldSkipMetaEvents(email)) {
        const gParams = {
          widget_name: widget?.name,
          widget_slug: widget?.id,
          content_category: "agendamento",
          lead_id: leadId,
          contact_id: contactId,
          job_title: jobTitle,
          company_name: company,
          revenue,
          employee_count: employeeCount,
        };
        pushDataLayer("qualified_lead", gParams);
        fireGadsStep("qualified", `qualified_${leadId}`);
      }

      // Evento fire-and-forget de avanço para etapa 3 (dn.marketing A/B)
      trackScheduleStep(3);

      setStep("calendar");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao qualificar lead");
    } finally {
      setSubmitting(false);
    }
  };

  // Etapa 3 → book
  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          action: "book",
          widget_id: widgetId,
          name, email, whatsapp,
          date: selectedDate,
          time: selectedTime,
          lead_id: leadId,
          contact_id: contactId,
          job_title: jobTitle,
          company,
          revenue,
          employee_count: employeeCount,
          utm: utmFromUrl,
          ...abFromUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.already_scheduled) {
          if (data.appointment) setExistingAppointment(data.appointment as ExistingAppointment);
          setExistingMessage(data.message || "Você já possui uma reunião agendada. Se precisar reagendar, fale com nosso time.");
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
          setStep("already_scheduled");
          return;
        }
        throw new Error(data.error || "Booking failed");
      }

      if (typeof window !== "undefined" && window.fbq && widget?.meta_pixel_id && !shouldSkipMetaEvents(email)) {
        const payload = { content_name: widget.name, content_category: "agendamento", ...userDataForPixel() };
        try { window.fbq("track", "Schedule", payload); } catch (e) { console.error("[MetaPixel] Schedule error", e); }
        try { window.fbq("trackCustom", "Agendamento", payload); } catch (e) { console.error("[MetaPixel] Agendamento error", e); }
      }

      // Google (GTM/GA4/Ads) — agendamento (final da etapa 3)
      if (!shouldSkipMetaEvents(email)) {
        const gParams = {
          widget_name: widget?.name,
          widget_slug: widget?.id,
          content_category: "agendamento",
          lead_id: leadId,
          contact_id: contactId,
          meeting_date: selectedDate,
          meeting_time: selectedTime,
        };
        pushDataLayer("schedule", gParams);
        pushDataLayer("conversion_schedule", gParams);
        fireGadsStep("scheduled", `schedule_${leadId}_${selectedDate}_${selectedTime}`);
      }


      // Microsoft Clarity Schedule + Agendamento
      if (widget?.clarity_project_id && !shouldSkipMetaEvents(email)) {
        claritySet("meeting_date", selectedDate || "");
        claritySet("meeting_time", selectedTime || "");
        clarityEvent("Schedule");
        clarityEvent("Agendamento");
      }

      setResult(data);
      setStep("success");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao confirmar agendamento");
    } finally {
      setSubmitting(false);
    }
  };

  // Calendar helpers
  const [year, month] = currentMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA");
  const maxDateStr = useMemo(() => {
    const windowDays = widget?.booking_window_days ?? 30;
    const max = new Date(today.getFullYear(), today.getMonth(), today.getDate() + windowDays - 1);
    return max.toLocaleDateString("en-CA");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget?.booking_window_days]);

  const availableDates = useMemo(() => new Set(slots.map(s => s.date)), [slots]);
  const timesForDate = useMemo(
    () => selectedDate ? slots.filter(s => s.date === selectedDate).map(s => s.time) : [],
    [selectedDate, slots]
  );

  const navigateMonth = (dir: number) => {
    const d = new Date(year, month - 1 + dir, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDate(null);
    setSelectedTime(null);
  };

  const nextMonthFirstDay = `${new Date(year, month, 1).getFullYear()}-${String(new Date(year, month, 1).getMonth() + 1).padStart(2, "0")}-01`;
  const prevMonthLastDay = (() => {
    const d = new Date(year, month - 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const canGoNext = nextMonthFirstDay <= maxDateStr;
  const canGoPrev = prevMonthLastDay >= todayStr;

  const monthLabel = new Date(year, month - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (error && !widget) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card p-8 max-w-md text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Widget indisponível</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // Skeleton neutro enquanto o widget não carregou — evita o "flash" de cores
  // padrão (vermelho) antes das CSS vars customizadas chegarem do backend.
  // Usa as mesmas classes/estilos do skeleton em index.html para continuidade visual.
  if (!widget) {
    return (
      <div
        className={cn(
          isEmbed ? "bg-transparent p-3 sm:p-4" : "min-h-screen flex items-start justify-center p-3 sm:p-4"
        )}
        style={isEmbed ? undefined : { background: "var(--canvas)" }}
      >
        <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-5 pt-6">
          <div
            style={{
              height: 42,
              width: 160,
              borderRadius: 6,
              background:
                "linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.08),rgba(255,255,255,.04))",
              animation: "nx-pulse 1.4s ease-in-out infinite",
            }}
          />
          <h1
            style={{
              fontSize: 22,
              lineHeight: 1.25,
              fontWeight: 600,
              color: "var(--text)",
              margin: "8px 0 0",
              letterSpacing: "-.01em",
              textAlign: "center",
            }}
          >
            Agende sua reunião
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted-ink)", margin: 0, textAlign: "center" }}>
            Carregando horários disponíveis…
          </p>
          <div
            style={{
              width: "100%",
              background: "rgba(22,19,17,.6)",
              border: "1px solid rgba(255,255,255,.06)",
              borderRadius: 12,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {[40, 30, 35].map((w, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    height: 14,
                    width: `${w}%`,
                    borderRadius: 6,
                    background:
                      "linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.08),rgba(255,255,255,.04))",
                    animation: "nx-pulse 1.4s ease-in-out infinite",
                  }}
                />
                <div
                  style={{
                    height: 44,
                    borderRadius: 8,
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(255,255,255,.06)",
                  }}
                />
              </div>
            ))}
            <div
              style={{
                height: 44,
                borderRadius: 8,
                background: "rgba(61,97,255,.20)",
                marginTop: 4,
              }}
            />
          </div>
          <style>{`@keyframes nx-pulse{0%,100%{opacity:.6}50%{opacity:1}}`}</style>
        </div>
      </div>
    );
  }

  const renderStepper = () => {
    if (step === "success") return null;
    const idx = STEP_INDEX[step];
    const isBlocked = step === "icp_blocked";
    const totalSteps = 3;
    const progressPct = isBlocked ? 100 : Math.min(100, (idx / totalSteps) * 100);
    return (
      <>
        {/* Mobile: barra de progresso slim */}
        <div className="sm:hidden mb-5" aria-label={`Etapa ${idx} de ${totalSteps}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium sw-muted uppercase tracking-wide">
              {isBlocked ? "Finalizado" : `Etapa ${idx} de ${totalSteps}`}
            </span>
            <span className="text-xs sw-muted">{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1 rounded-full sw-step-track overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 sw-step-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        {/* Desktop: stepper visual */}
        <div className="hidden sm:flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                aria-current={n === idx ? "step" : undefined}
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  n === idx ? "sw-step-active" :
                  n < idx ? "sw-step-done" :
                  "sw-step-pending"
                )}
              >{n}</div>
              {n < 4 && <div className={cn("h-px w-6", n < idx ? "sw-step-fill" : "sw-step-track")} />}
            </div>
          ))}
        </div>
      </>
    );
  };

  const headerAlignClass =
    swStyle.headerAlign === "left" ? "text-left items-start" : "text-center items-center";

  return (
    <div
      ref={containerRef}
      style={{
        ...swCssVars,
        ...(isEmbed ? {} : { background: "var(--sw-page-bg)" }),
      }}
      className={cn(
        isEmbed
          ? "bg-transparent p-3 sm:p-4"
          : "min-h-screen flex items-center justify-center p-3 sm:p-4"
      )}
    >
      {/* Sobrescritas finas de cor/fonte usando as CSS vars */}
      <style>{`
        [data-sw-root] { font-family: var(--sw-font-body); color: var(--sw-text); }
        [data-sw-root] .sw-title { font-family: var(--sw-font-title); font-weight: var(--sw-title-weight) !important; color: var(--sw-text); }
        [data-sw-root] .sw-card { background: var(--sw-card-bg) !important; border-radius: var(--sw-radius-card) !important; padding: var(--sw-card-padding) !important; border: 1px solid var(--sw-input-border) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }
        [data-sw-root] .sw-step-active { background: var(--sw-primary) !important; color: var(--sw-primary-text) !important; }
        [data-sw-root] .sw-step-done { background: color-mix(in srgb, var(--sw-primary) 35%, transparent) !important; color: var(--sw-text) !important; }
        [data-sw-root] .sw-step-pending { background: color-mix(in srgb, var(--sw-text) 10%, transparent) !important; color: var(--sw-muted) !important; }
        [data-sw-root] .sw-step-track { background: color-mix(in srgb, var(--sw-text) 12%, transparent) !important; }
        [data-sw-root] .sw-step-fill { background: var(--sw-primary) !important; }
        [data-sw-root] .sw-cta { background: var(--sw-primary); color: var(--sw-primary-text); border-radius: var(--sw-radius-button); height: var(--sw-cta-height); font-size: var(--sw-cta-size); }
        [data-sw-root] .sw-cta:hover { filter: brightness(1.08); }
        [data-sw-root] .sw-label { color: var(--sw-input-text); font-size: var(--sw-label-size); }
        [data-sw-root] .sw-muted { color: var(--sw-muted); }
        [data-sw-root] .sw-input { height: var(--sw-input-height); background: var(--sw-input-bg); border-color: var(--sw-input-border); border-radius: var(--sw-radius-input); font-size: 16px; color: var(--sw-input-text); }
        [data-sw-root] .sw-input::placeholder { color: color-mix(in srgb, var(--sw-input-text) 45%, transparent); }
        [data-sw-root] .sw-input:focus-visible { outline: none; border-color: var(--sw-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sw-primary) 30%, transparent); }
        [data-sw-root] .sw-dot-active { background: var(--sw-primary) !important; }
        [data-sw-root] .sw-day-selected { background: var(--sw-primary) !important; color: var(--sw-primary-text) !important; }
        [data-sw-root] .sw-time-btn { background: var(--sw-time-button-bg); color: var(--sw-time-button-text); border-color: var(--sw-time-button-border); }
        [data-sw-root] .sw-time-btn:hover { background: color-mix(in srgb, var(--sw-primary) 10%, var(--sw-time-button-bg)); border-color: var(--sw-primary); }
        [data-sw-root] .sw-time-btn-selected { background: var(--sw-primary) !important; color: var(--sw-primary-text) !important; border-color: var(--sw-primary) !important; }
        [data-sw-root] select.sw-input { appearance: none; -webkit-appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--sw-input-text) 50%), linear-gradient(135deg, var(--sw-input-text) 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; padding-right: 32px; }
        [data-sw-root] select.sw-input option { background: var(--sw-card-bg); color: var(--sw-input-text); }

        /* Calendar step 3 tokens */
        [data-sw-root] .sw-cal-weekday { color: var(--sw-muted); }
        [data-sw-root] .sw-cal-day { color: var(--sw-text); background: color-mix(in srgb, var(--sw-text) 8%, transparent); }
        [data-sw-root] .sw-cal-day:hover { background: color-mix(in srgb, var(--sw-primary) 20%, transparent); }
        [data-sw-root] .sw-cal-day-disabled { color: color-mix(in srgb, var(--sw-muted) 35%, transparent); cursor: not-allowed; }
        [data-sw-root] .sw-cal-today { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sw-primary) 40%, transparent); }
        [data-sw-root] .sw-cal-nav { color: var(--sw-text); background: transparent; }
        [data-sw-root] .sw-cal-nav:hover { background: color-mix(in srgb, var(--sw-text) 10%, transparent); }
        [data-sw-root] .sw-cal-month { color: var(--sw-text); }
        [data-sw-root] .sw-cal-date-label { color: var(--sw-text); }
        [data-sw-root] .sw-cal-empty { color: var(--sw-muted); }
        [data-sw-root] .sw-sticky-bg { background: linear-gradient(to top, var(--sw-card-bg), color-mix(in srgb, var(--sw-card-bg) 95%, transparent), transparent); border-color: var(--sw-input-border); }
      `}</style>
      <div className="w-full max-w-2xl mx-auto" data-sw-root>
        {widget && (
          <div className={cn("flex flex-col gap-1", headerAlignClass, isEmbed ? "mb-4 sm:mb-5" : "mb-5 sm:mb-8")}>
            {swStyle.showLogo && swStyle.logoUrl ? (
              <img
                src={swStyle.logoUrl}
                alt=""
                width={240}
                height={swStyle.logoHeight}
                decoding="async"
                fetchPriority="high"
                style={{ height: `${swStyle.logoHeight}px`, width: "auto" }}
                className="mb-2"
                onError={(e) => ((e.currentTarget.style.display = "none"))}
              />
            ) : swStyle.showLogo && !isEmbed ? (
              <div className="flex items-center justify-center gap-2 mb-3">
                <img
                  src="/dn-nexus-dark.png"
                  alt="dn.nexus"
                  width={160}
                  height={42}
                  decoding="async"
                  fetchPriority="high"
                  className="h-7 sm:h-[2.6rem] w-auto"
                />
              </div>
            ) : null}
            <h1
              className="sw-title leading-tight px-2"
              style={{ fontSize: `var(--sw-title-size-mobile)` }}
            >
              <span className="hidden sm:inline" style={{ fontSize: `var(--sw-title-size-desktop)` }}>
                {widget.title || widget.name}
              </span>
              <span className="sm:hidden">{widget.title || widget.name}</span>
            </h1>
            {widget.description && (
              <p className="hidden sm:block sw-muted mt-2 max-w-md" style={{ fontSize: `var(--sw-description-size)` }}>
                {widget.description}
              </p>
            )}
            <div className="flex items-center gap-3 sm:gap-4 mt-2 sm:mt-3 text-xs sm:text-sm sw-muted">
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> {widget.duration_minutes} min</span>
              <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Videochamada</span>
            </div>
          </div>
        )}


        {/* Success */}
        {step === "success" && result && (
          <div className="sw-card text-center animate-fade-in">
            <CheckCircle2 className="h-16 w-16 text-success mx-auto mb-4" />
            <h2 className="sw-title text-xl mb-2">Reunião agendada!</h2>
            <p className="sw-muted mb-6">
              Sua reunião foi confirmada para {result.date} às {result.time} ({result.duration_minutes} min).
            </p>
            {result.meeting_link && (
              <div className="sw-card mb-4" style={{ padding: "1rem" }}>
                <p className="text-sm sw-muted mb-2">Link da reunião:</p>
                <a href={result.meeting_link} target="_blank" rel="noopener noreferrer" className="underline break-all text-sm" style={{ color: "var(--sw-primary)" }}>
                  {result.meeting_link}
                </a>
              </div>
            )}
            <p className="text-sm sw-muted">Você receberá uma confirmação por e-mail e WhatsApp.</p>
          </div>
        )}

        {/* Step 1: Dados básicos */}
        {step === "basic" && (
          <div className="sw-card animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--sw-field-gap)" }}>
            {renderStepper()}
            <div>
              <h2 className="sw-title text-lg mb-1">Seus dados</h2>
              <p className="sw-muted text-sm">Comece se apresentando para nós.</p>
            </div>
            <div>
              <Label className="sw-label">Nome</Label>
              <Input
                className="sw-input mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome completo"
                autoComplete="name"
              />
            </div>
            <div>
              <Label className="sw-label">E-mail</Label>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
                onBlur={() => { if (email.trim()) validateEmail(email); }}
                placeholder="seu@email.com"
                className={cn("sw-input mt-1", emailError && "border-destructive")}
              />
              {emailValidating && <p className="sw-muted text-xs mt-1">Verificando email...</p>}
              {emailError && <p className="text-destructive text-xs mt-1" aria-live="polite">{emailError}</p>}
            </div>
            <div>
              <Label className="sw-label">WhatsApp</Label>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(maskBrazilianPhone(e.target.value));
                  if (whatsappError) setWhatsappError(null);
                }}
                onBlur={() => {
                  if (whatsapp.trim() && !isValidBRPhone(whatsapp)) {
                    setWhatsappError(phoneErrorMessage(whatsapp));
                  }
                }}
                placeholder="(11) 98765-4321"
                maxLength={16}
                className={cn("sw-input mt-1", whatsappError && "border-destructive")}
              />
              {whatsappError && <p className="text-destructive text-xs mt-1" aria-live="polite">{whatsappError}</p>}
            </div>
            {error && <p className="text-destructive text-sm" aria-live="polite">{error}</p>}
            <Button
              className="sw-cta w-full"
              onClick={handleSubmitBasic}
              disabled={submitting || emailValidating || !!emailError || !name.trim() || !email.trim() || !isValidBRPhone(whatsapp)}
            >
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</> : "Continuar"}
            </Button>
          </div>
        )}

        {/* Step 2: Qualificação */}
        {step === "qualify" && (
          <div className="sw-card animate-fade-in">
            {renderStepper()}
            <button type="button" className="mb-2 -ml-1 inline-flex items-center text-sm sw-muted hover:opacity-80 transition-opacity" onClick={() => setStep("basic")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </button>
            <h2 className="sw-title text-lg mb-1">Sua empresa agora</h2>
            <p className="sw-muted text-sm mb-4">Para a conversa ser sobre o seu negócio, não só sobre IA.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sw-field-gap)" }}>
              <div>
                <Label className="sw-label">Cargo</Label>
                <select
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="sw-input mt-1 flex w-full border px-3 focus:outline-none"
                >
                  <option value="">Selecione seu cargo</option>
                  {JOB_TITLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="sw-label">Empresa</Label>
                <Input
                  className="sw-input mt-1"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Nome da sua empresa"
                  autoComplete="organization"
                />
              </div>
              <div>
                <Label className="sw-label">Faturamento mensal</Label>
                <select
                  value={revenue}
                  onChange={(e) => setRevenue(e.target.value)}
                  className="sw-input mt-1 flex w-full border px-3 focus:outline-none"
                >
                  <option value="">Selecione uma faixa</option>
                  {REVENUE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="sw-label">Número de funcionários</Label>
                <select
                  value={employeeCount}
                  onChange={(e) => setEmployeeCount(e.target.value)}
                  className="sw-input mt-1 flex w-full border px-3 focus:outline-none"
                >
                  <option value="">Selecione</option>
                  {EMPLOYEE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              {error && <p className="text-destructive text-sm" aria-live="polite">{error}</p>}
              <Button
                className="sw-cta w-full"
                onClick={handleSubmitQualify}
                disabled={submitting || !jobTitle.trim() || !company.trim() || !revenue || !employeeCount}
              >
                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</> : "Continuar"}
              </Button>
            </div>
          </div>
        )}



        {/* Step 3: Calendar */}
        {step === "calendar" && (
          <div className="sw-card pb-24 lg:pb-6">
            {renderStepper()}
            <button type="button" className="mb-2 -ml-1 inline-flex items-center text-sm sw-muted hover:opacity-80 transition-opacity" onClick={() => setStep("qualify")}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </button>
            <h2 className="sw-title text-lg mb-1">Escolha o melhor horário para você.</h2>
            <p className="sw-muted text-sm mb-4 sm:mb-6">Ao confirmar, um especialista da dn.ia bloqueia esse horário exclusivamente para você. Venha preparado(a).</p>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin sw-cal-month" />
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-3">
                    <Button variant="ghost" size="icon" className="h-10 w-10 sw-cal-nav" onClick={() => navigateMonth(-1)} disabled={!canGoPrev} aria-label="Mês anterior">
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <span className="text-sm sm:text-base font-medium sw-cal-month capitalize">{monthLabel}</span>
                    <Button variant="ghost" size="icon" className="h-10 w-10 sw-cal-nav" onClick={() => navigateMonth(1)} disabled={!canGoNext} aria-label="Próximo mês">
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[11px] sm:text-xs sw-cal-weekday mb-1">
                    {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map(d => (
                      <div key={d} className="py-1 font-medium">{d}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`empty-${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const isAvailable = availableDates.has(dateStr);
                      const isSelected = selectedDate === dateStr;
                      const isPast = dateStr < todayStr;
                      const isBeyondWindow = dateStr > maxDateStr;
                      const isToday = dateStr === todayStr;
                      const isDisabled = !isAvailable || isPast || isBeyondWindow;
                      return (
                        <button
                          key={day}
                          disabled={isDisabled}
                          onClick={() => { setSelectedDate(dateStr); setSelectedTime(null); }}
                          aria-pressed={isSelected}
                          className={cn(
                            "aspect-square w-full rounded-lg text-sm font-medium transition-all relative",
                            isSelected ? "sw-day-selected shadow-md" :
                            !isDisabled ? "sw-cal-day active:scale-95 cursor-pointer" :
                            "sw-cal-day-disabled",
                            isToday && !isSelected && "sw-cal-today"
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] sw-muted mt-3 text-center">Horário de Brasília (UTC-3)</p>
                </div>

                <div ref={timesRef} className="lg:w-52 lg:border-l lg:pl-6 scroll-mt-4" style={{ borderColor: "var(--sw-input-border)" }}>
                  {selectedDate ? (
                    <>
                      <p className="text-sm font-medium sw-cal-date-label mb-3">
                        <CalendarDays className="h-4 w-4 inline mr-1" />
                        {new Date(selectedDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                      </p>
                      {timesForDate.length === 0 ? (
                        <p className="text-sm sw-cal-empty py-4 text-center">Sem horários disponíveis neste dia.</p>
                      ) : (
                        <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 lg:max-h-80 lg:overflow-y-auto lg:pr-1">
                          {timesForDate.map(time => (
                            <button
                              key={time}
                              onClick={() => setSelectedTime(time)}
                              aria-pressed={selectedTime === time}
                              className={cn(
                                "h-11 px-2 rounded-lg text-sm font-medium border transition-all active:scale-95",
                                selectedTime === time
                                  ? "sw-time-btn-selected"
                                  : "sw-time-btn"
                              )}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedTime && (
                        <Button id="schedule-confirm-button" className="sw-cta hidden lg:flex w-full mt-4" onClick={handleConfirm} disabled={submitting}>
                          {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Agendando...</> : "Confirmar"}
                        </Button>

                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center text-sm sw-cal-empty py-6 lg:py-8">
                      Selecione um dia no calendário
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <p className="text-destructive text-sm mt-4 text-center" aria-live="polite">{error}</p>}

            {/* Sticky CTA mobile */}
            {selectedTime && (
              <div
                className="lg:hidden fixed inset-x-0 bottom-0 z-50 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm border-t sw-sticky-bg"
              >
                <Button id="schedule-confirm-button" className="sw-cta w-full" onClick={handleConfirm} disabled={submitting}>
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Agendando...</> : `Confirmar ${selectedTime}`}
                </Button>

              </div>
            )}
          </div>
        )}



        {/* Step 4: ICP bloqueado (sem voltar) */}
        {step === "icp_blocked" && (
          <div className="sw-card text-center animate-fade-in">
            {renderStepper()}
            <h2 className="sw-title text-xl mb-3">Obrigado pelo seu interesse</h2>
            <p className="sw-muted whitespace-pre-line">
              {icpBlockedMessage}
            </p>

          </div>
        )}

        {/* Step 4b: Lead já possui reunião agendada */}
        {step === "already_scheduled" && (
          <div className="sw-card animate-fade-in">
            {renderStepper()}
            <div className="text-center mb-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3" style={{ background: "var(--sw-primary)", color: "var(--sw-primary-text)" }}>
                <CalendarDays className="h-6 w-6" />
              </div>
              <h2 className="sw-title text-xl mb-2">Você já tem uma reunião agendada</h2>
            </div>
            <p className="sw-muted whitespace-pre-line text-center mb-4">
              {existingMessage}
            </p>
            {existingAppointment && (
              <>
                <div className="rounded-lg p-4 mb-3" style={{ background: "var(--sw-input-bg)", border: "1px solid var(--sw-input-border)" }}>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <CalendarDays className="h-4 w-4" style={{ color: "var(--sw-primary)" }} />
                    <span className="sw-muted">Data e hora</span>
                  </div>
                  <div className="font-medium mb-3" style={{ color: "var(--sw-input-text)" }}>
                    {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(existingAppointment.start_time))}
                    {existingAppointment.duration_minutes ? ` · ${existingAppointment.duration_minutes} min` : ""}
                  </div>
                  {existingAppointment.assignee_name && (
                    <>
                      <div className="flex items-center gap-2 text-sm mb-1">
                        <Clock className="h-4 w-4" style={{ color: "var(--sw-primary)" }} />
                        <span className="sw-muted">Consultor</span>
                      </div>
                      <div className="font-medium" style={{ color: "var(--sw-input-text)" }}>{existingAppointment.assignee_name}</div>
                    </>
                  )}
                </div>
                {existingAppointment.meeting_link && (
                  <a href={existingAppointment.meeting_link} target="_blank" rel="noopener noreferrer" className="block">
                    <Button className="sw-cta w-full">
                      <Video className="h-4 w-4 mr-2" /> Abrir sala da reunião
                    </Button>
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
