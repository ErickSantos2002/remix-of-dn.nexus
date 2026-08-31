import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarDays, Plus, Copy, CopyPlus, Code, Pencil, Trash2, Users, Clock, ExternalLink, History, AlertTriangle, MessageSquare, Mail, ChevronDown, ChevronRight, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import SchedulingStyleDialog from "@/components/scheduling/SchedulingStyleDialog";
import type { SchedulingStyle } from "@/lib/schedulingStyle";
import { AnalysisPlaybookSelect } from "@/components/crm/AnalysisPlaybookSelect";

import { REVENUE_OPTIONS, JOB_TITLE_OPTIONS, EMPLOYEE_OPTIONS } from "@/lib/widgetVocabulary";


const DEFAULT_ICP_REVENUE = REVENUE_OPTIONS.slice(1);
const DEFAULT_ICP_JOBS = ["CEO / Fundador", "Diretor(a)"];
const DEFAULT_ICP_EMPLOYEES = ["11 - 25", "26 - 49", "Acima de 50"];
const DEFAULT_ICP_BLOCK_MSG =
  "Obrigado pelo interesse! No momento esta agenda está reservada para perfis específicos. Nossa equipe entrará em contato em breve.";

const DEFAULT_WA_TEMPLATE = `Olá {{nome}}! 👋

Seu agendamento foi confirmado com sucesso!

📅 Data: {{data}}
🕐 Horário: {{hora}}
👤 Responsável: {{responsavel}}

🔗 Link da reunião: {{link_reuniao}}

Nos vemos em breve!`;

const DEFAULT_CALENDAR_TITLE = "{{widget}} - {{nome}}";

const DEFAULT_CALENDAR_DESCRIPTION = `Agendamento via widget
Contato: {{nome}}
E-mail: {{email}}
WhatsApp: {{whatsapp}}
Link: {{link_reuniao}}`;

const TEMPLATE_VARS = [
  { key: "nome", label: "Nome do lead" },
  { key: "data", label: "Data" },
  { key: "hora", label: "Horário" },
  { key: "link_reuniao", label: "Link da reunião" },
  { key: "responsavel", label: "Responsável" },
  { key: "email", label: "E-mail do lead" },
  { key: "whatsapp", label: "WhatsApp do lead" },
  { key: "empresa", label: "Empresa do lead" },
  { key: "widget", label: "Nome do widget" },
];

interface GoogleAdsConversions {
  account?: string | null;
  lead?: string | null;
  qualified?: string | null;
  scheduled?: string | null;
  icp_blocked?: string | null;
  already_scheduled?: string | null;
}

interface SchedulingWidget {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  meta_pixel_id: string | null;
  google_ads_send_to: string | null;
  booking_window_days: number;
  icp_enabled: boolean;
  icp_revenue_ranges: string[];
  icp_job_titles: string[];
  icp_employee_counts: string[];
  icp_block_message: string;
  confirmation_whatsapp_enabled?: boolean;
  confirmation_whatsapp_template?: string | null;
  confirmation_email_enabled?: boolean;
  confirmation_email_subject?: string | null;
  confirmation_email_template?: string | null;
  calendar_event_title_template?: string | null;
  calendar_event_description_template?: string | null;
  style?: Partial<SchedulingStyle> | null;
  google_ads_conversions?: GoogleAdsConversions | null;
  analysis_playbook_id?: string | null;
}

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  hasCalendar: boolean;
}

export default function SchedulingWidgets() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [widgets, setWidgets] = useState<SchedulingWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchedulingWidget | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [calendarUserIds, setCalendarUserIds] = useState<Set<string>>(new Set());
  const [integrationCollapsed, setIntegrationCollapsed] = useState(true);
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [styleWidget, setStyleWidget] = useState<SchedulingWidget | null>(null);

  // Form
  const [formName, setFormName] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDuration, setFormDuration] = useState("30");
  const [formBookingWindowDays, setFormBookingWindowDays] = useState("30");
  const [formIcpEnabled, setFormIcpEnabled] = useState(true);
  const [formIcpRevenue, setFormIcpRevenue] = useState<string[]>(DEFAULT_ICP_REVENUE);
  const [formIcpJobs, setFormIcpJobs] = useState<string[]>(DEFAULT_ICP_JOBS);
  const [formIcpEmployees, setFormIcpEmployees] = useState<string[]>(DEFAULT_ICP_EMPLOYEES);
  const [formIcpBlockMsg, setFormIcpBlockMsg] = useState(DEFAULT_ICP_BLOCK_MSG);
  const [formGadsLabels, setFormGadsLabels] = useState({
    lead: "", qualified: "", scheduled: "", icp_blocked: "", already_scheduled: "",
  });

  // Confirmation message
  const [formWaEnabled, setFormWaEnabled] = useState(false);
  const [formWaTemplate, setFormWaTemplate] = useState(DEFAULT_WA_TEMPLATE);
  const [formEmailEnabled, setFormEmailEnabled] = useState(true);
  const [formEmailSubject, setFormEmailSubject] = useState("");
  const [formEmailTemplate, setFormEmailTemplate] = useState("");

  // Evento do Google Calendar
  const [formCalendarTitle, setFormCalendarTitle] = useState(DEFAULT_CALENDAR_TITLE);
  const [formCalendarDescription, setFormCalendarDescription] = useState(DEFAULT_CALENDAR_DESCRIPTION);

  // Analise aplicada as reunioes agendadas por este widget
  const [formAnalysisPlaybookId, setFormAnalysisPlaybookId] = useState("");



  
  

  const workspaceId = currentWorkspace?.id;

  const fetchWidgets = async () => {
    if (!workspaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from("scheduling_widgets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    const widgetList = (data as SchedulingWidget[]) || [];
    setWidgets(widgetList);
    setLoading(false);
    return widgetList;
  };

  const fetchMembers = async () => {
    if (!workspaceId) return;

    // Source of truth: who has Google Calendar connected & enabled in this workspace
    const { data: calendars } = await supabase
      .from("crm_google_calendar_integration")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("is_enabled", true);

    const calendarIds = (calendars || []).map((c: { user_id: string }) => c.user_id);
    const calSet = new Set(calendarIds);
    setCalendarUserIds(calSet);

    // Also include workspace members and owner (even sem calendar, para diagnóstico/seleção futura)
    const { data: wm } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);
    const memberIds = new Set<string>((wm || []).map((m: { user_id: string }) => m.user_id));

    const { data: ws } = await supabase.from("workspaces").select("owner_id").eq("id", workspaceId).single();
    if (ws?.owner_id) memberIds.add(ws.owner_id);

    // Union: members + everyone who has calendar in this workspace
    calendarIds.forEach((id) => memberIds.add(id));

    const allIds = Array.from(memberIds);
    if (allIds.length === 0) {
      setMembers([]);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", allIds);

    // Show all workspace members + owner; mark which ones have Google Calendar connected
    setMembers(
      (profiles || []).map((p: { id: string; name: string | null; email: string }) => ({
        id: p.id,
        name: p.name || p.email,
        email: p.email,
        hasCalendar: calSet.has(p.id),
      }))
    );
  };


  // Auto-deactivate widgets without valid members
  const autoDeactivateWidgets = async (widgetList: SchedulingWidget[]) => {
    if (!workspaceId || calendarUserIds.size === 0 && members.length === 0) return;

    const activeWidgets = widgetList.filter(w => w.is_active);
    if (activeWidgets.length === 0) return;

    for (const widget of activeWidgets) {
      const { data: widgetMembers } = await supabase
        .from("scheduling_widget_members")
        .select("user_id")
        .eq("widget_id", widget.id)
        .eq("is_active", true);

      const hasValidMember = (widgetMembers || []).some((m: { user_id: string }) => calendarUserIds.has(m.user_id));

      if (!hasValidMember) {
        await supabase.from("scheduling_widgets").update({ is_active: false }).eq("id", widget.id);
      }
    }

    // Re-fetch to reflect changes
    const { data } = await supabase
      .from("scheduling_widgets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    setWidgets((data as SchedulingWidget[]) || []);
  };

  useEffect(() => {
    const init = async () => {
      await fetchMembers();
    };
    init();
  }, [workspaceId]);

  useEffect(() => {
    const init = async () => {
      const widgetList = await fetchWidgets();
      if (widgetList && calendarUserIds.size > 0) {
        await autoDeactivateWidgets(widgetList);
      }
    };
    if (workspaceId && calendarUserIds.size >= 0) {
      init();
    }
  }, [workspaceId, calendarUserIds]);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormTitle("");
    setFormDescription("");
    setFormDuration("30");
    setFormBookingWindowDays("30");
    setFormIcpEnabled(true);
    setFormIcpRevenue(DEFAULT_ICP_REVENUE);
    setFormIcpJobs(DEFAULT_ICP_JOBS);
    setFormIcpEmployees(DEFAULT_ICP_EMPLOYEES);
    setFormIcpBlockMsg(DEFAULT_ICP_BLOCK_MSG);
    setFormGadsLabels({ lead: "", qualified: "", scheduled: "", icp_blocked: "", already_scheduled: "" });
    setFormWaEnabled(false);
    setFormWaTemplate(DEFAULT_WA_TEMPLATE);
    setFormEmailEnabled(true);
    setFormEmailSubject("");
    setFormEmailTemplate("");
    setFormCalendarTitle(DEFAULT_CALENDAR_TITLE);
    setFormCalendarDescription(DEFAULT_CALENDAR_DESCRIPTION);
    setFormAnalysisPlaybookId("");
    setSelectedMembers([]);
    setDialogOpen(true);
  };

  const openEdit = async (widget: SchedulingWidget) => {
    setEditing(widget);
    setFormName(widget.name);
    setFormTitle(widget.title || "");
    setFormDescription(widget.description || "");
    setFormDuration(String(widget.duration_minutes));
    setFormBookingWindowDays(String(widget.booking_window_days ?? 30));
    setFormIcpEnabled(widget.icp_enabled ?? true);
    setFormIcpRevenue(widget.icp_revenue_ranges?.length ? widget.icp_revenue_ranges : DEFAULT_ICP_REVENUE);
    setFormIcpJobs(widget.icp_job_titles?.length ? widget.icp_job_titles : DEFAULT_ICP_JOBS);
    setFormIcpEmployees(widget.icp_employee_counts?.length ? widget.icp_employee_counts : DEFAULT_ICP_EMPLOYEES);
    setFormIcpBlockMsg(widget.icp_block_message || DEFAULT_ICP_BLOCK_MSG);
    const conv = widget.google_ads_conversions ?? null;
    setFormGadsLabels({
      lead: conv?.lead || "",
      qualified: conv?.qualified || "",
      scheduled: conv?.scheduled || "",
      icp_blocked: conv?.icp_blocked || "",
      already_scheduled: conv?.already_scheduled || "",
    });
    setFormWaEnabled(widget.confirmation_whatsapp_enabled ?? false);
    setFormWaTemplate(widget.confirmation_whatsapp_template || DEFAULT_WA_TEMPLATE);
    setFormEmailEnabled(widget.confirmation_email_enabled ?? true);
    setFormEmailSubject(widget.confirmation_email_subject || "");
    setFormEmailTemplate(widget.confirmation_email_template || "");
    setFormCalendarTitle(widget.calendar_event_title_template || DEFAULT_CALENDAR_TITLE);
    setFormCalendarDescription(widget.calendar_event_description_template || DEFAULT_CALENDAR_DESCRIPTION);
    setFormAnalysisPlaybookId(widget.analysis_playbook_id || "");

    const { data } = await supabase
      .from("scheduling_widget_members")
      .select("user_id")
      .eq("widget_id", widget.id)
      .eq("is_active", true);
    // Pre-select all members linked to the widget (calendar status only used as visual hint)
    const linkedMembers = (data || []).map((m: { user_id: string }) => m.user_id);
    setSelectedMembers(linkedMembers);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!workspaceId || !formName.trim() || selectedMembers.length === 0) {
      toast({ variant: "destructive", title: "Selecione ao menos um membro com Google Calendar conectado." });
      return;
    }

    const windowDays = parseInt(formBookingWindowDays);
    if (!windowDays || windowDays < 1 || windowDays > 365) {
      toast({ variant: "destructive", title: "Janela de agendamento deve estar entre 1 e 365 dias." });
      return;
    }

    if (formIcpEnabled && (formIcpRevenue.length === 0 || formIcpJobs.length === 0 || formIcpEmployees.length === 0)) {
      toast({ variant: "destructive", title: "Selecione ao menos um faturamento, cargo e tamanho de empresa no ICP, ou desative o filtro." });
      return;
    }

    const hasAnyGadsLabel = Object.values(formGadsLabels).some((v) => v.trim());
    const google_ads_conversions = hasAnyGadsLabel
      ? {
          lead: formGadsLabels.lead.trim() || null,
          qualified: formGadsLabels.qualified.trim() || null,
          scheduled: formGadsLabels.scheduled.trim() || null,
          icp_blocked: formGadsLabels.icp_blocked.trim() || null,
          already_scheduled: formGadsLabels.already_scheduled.trim() || null,
        }
      : null;
    const trackingPayload = { google_ads_conversions };

    const { data: { user } } = await supabase.auth.getUser();

    const icpPayload = {
      icp_enabled: formIcpEnabled,
      icp_revenue_ranges: formIcpRevenue,
      icp_job_titles: formIcpJobs,
      icp_employee_counts: formIcpEmployees,
      icp_block_message: formIcpBlockMsg.trim() || DEFAULT_ICP_BLOCK_MSG,
      confirmation_whatsapp_enabled: formWaEnabled,
      confirmation_whatsapp_template: formWaTemplate.trim() || DEFAULT_WA_TEMPLATE,
      confirmation_email_enabled: formEmailEnabled,
      confirmation_email_subject: formEmailSubject.trim() || null,
      confirmation_email_template: formEmailTemplate.trim() || null,
      calendar_event_title_template: formCalendarTitle.trim() || null,
      calendar_event_description_template: formCalendarDescription.trim() || null,
    };

    if (editing) {
      await supabase.from("scheduling_widgets").update({
        name: formName,
        title: formTitle.trim() || null,
        description: formDescription || null,
        duration_minutes: parseInt(formDuration),
        booking_window_days: windowDays,
        analysis_playbook_id: formAnalysisPlaybookId || null,
        ...icpPayload,
        ...trackingPayload,
      } as never).eq("id", editing.id);

      await supabase.from("scheduling_widget_members").delete().eq("widget_id", editing.id);
      await supabase.from("scheduling_widget_members").insert(
        selectedMembers.map(uid => ({ widget_id: editing.id, user_id: uid }))
      );

      toast({ title: "Widget atualizado!" });
    } else {
      const { data, error } = await supabase.from("scheduling_widgets").insert({
        workspace_id: workspaceId,
        name: formName,
        title: formTitle.trim() || null,
        description: formDescription || null,
        duration_minutes: parseInt(formDuration),
        booking_window_days: windowDays,
        created_by: user?.id,
        analysis_playbook_id: formAnalysisPlaybookId || null,
        ...icpPayload,
        ...trackingPayload,
      } as never).select("id").single();

      if (error || !data) {
        toast({ variant: "destructive", title: "Erro ao criar widget", description: error?.message });
        return;
      }

      await supabase.from("scheduling_widget_members").insert(
        selectedMembers.map(uid => ({ widget_id: data.id, user_id: uid }))
      );

      toast({ title: "Widget criado!" });
    }

    setDialogOpen(false);
    fetchWidgets();
  };

  const handleDelete = async (widgetId: string) => {
    await supabase.from("scheduling_widgets").delete().eq("id", widgetId);
    toast({ title: "Widget removido." });
    fetchWidgets();
  };

  const handleDuplicate = async (widget: SchedulingWidget) => {
    if (!workspaceId) return;
    if (!confirm(`Duplicar o widget "${widget.name}"?`)) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Fetch full widget row to copy all fields
    const { data: full, error: fetchErr } = await supabase
      .from("scheduling_widgets")
      .select("*")
      .eq("id", widget.id)
      .single();

    if (fetchErr || !full) {
      toast({ variant: "destructive", title: "Erro ao carregar widget", description: fetchErr?.message });
      return;
    }

    const { id, created_at, updated_at, created_by, slug, workspace_id, ...rest } =
      full as SchedulingWidget & { updated_at?: string; created_by?: string; slug?: string; workspace_id?: string };

    const insertPayload = {
      ...rest,
      workspace_id: workspaceId,
      name: `${full.name} (cópia)`,
      is_active: false,
      created_by: user?.id,
    } as never;

    const { data: created, error: insertErr } = await supabase
      .from("scheduling_widgets")
      .insert(insertPayload)
      .select("id")
      .single();


    if (insertErr || !created) {
      toast({ variant: "destructive", title: "Erro ao duplicar widget", description: insertErr?.message });
      return;
    }

    // Copy members
    const { data: widgetMembers } = await supabase
      .from("scheduling_widget_members")
      .select("user_id, is_active")
      .eq("widget_id", widget.id);

    if (widgetMembers && widgetMembers.length > 0) {
      await supabase.from("scheduling_widget_members").insert(
        widgetMembers.map((m: { user_id: string; is_active: boolean }) => ({
          widget_id: created.id,
          user_id: m.user_id,
          is_active: m.is_active,
        }))
      );
    }

    toast({ title: "Widget duplicado!", description: "A cópia foi criada como inativa." });
    fetchWidgets();
  };

  const handleToggle = async (widgetId: string, active: boolean) => {
    if (active) {
      // Check if widget has valid members before activating
      const { data: widgetMembers } = await supabase
        .from("scheduling_widget_members")
        .select("user_id")
        .eq("widget_id", widgetId)
        .eq("is_active", true);

      const hasValidMember = (widgetMembers || []).some((m: { user_id: string }) => calendarUserIds.has(m.user_id));
      if (!hasValidMember) {
        toast({ variant: "destructive", title: "Este widget não possui membros com Google Calendar conectado." });
        return;
      }
    }
    await supabase.from("scheduling_widgets").update({ is_active: active }).eq("id", widgetId);
    fetchWidgets();
  };

  const getPublicUrl = (id: string) => `https://nexus.dnia.ai/schedule/${id}`;
  const getEmbedCode = (id: string) => `<iframe src="${getPublicUrl(id)}" width="100%" height="700" frameborder="0"></iframe>`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copiado!` });
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            Widgets de Agendamento
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crie links públicos para visitantes agendarem reuniões com sua equipe.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Novo Widget
        </Button>
      </div>

      {members.length === 0 && !loading && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Nenhum membro deste workspace possui Google Calendar conectado. Conecte o Google Calendar na página de Conexões para criar widgets de agendamento.
          </AlertDescription>
        </Alert>
      )}

      {/* Card informacional de integração */}
      <div className="glass-card p-5 space-y-3">
        <button
          type="button"
          onClick={() => setIntegrationCollapsed((c) => !c)}
          className="w-full flex items-center justify-between text-left cursor-pointer"
        >
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Code className="h-4 w-4 text-primary" />
            Integração com IA e Sistemas Externos
          </h3>
          {integrationCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {!integrationCollapsed && (
          <>
            <p className="text-xs text-muted-foreground">
              Seus agentes de IA ou sistemas externos podem direcionar leads diretamente para o agendamento passando os dados do cliente via URL. Quando todos os parâmetros são informados, o formulário de dados é pulado e o visitante vai direto para a seleção de horário.
            </p>
            <div className="bg-muted/30 rounded-lg p-3 font-mono text-xs text-muted-foreground break-all select-all">
              https://nexus.dnia.ai/schedule/<span className="text-primary">&#123;widgetId&#125;</span>?<span className="text-foreground">name</span>=João Silva&<span className="text-foreground">email</span>=joao@email.com&<span className="text-foreground">whatsapp</span>=5511999999999&<span className="text-foreground">tag</span>=programadeiaficacao&<span className="text-foreground">source</span>=landing-evento&<span className="text-foreground">utm_source</span>=meta&<span className="text-foreground">utm_medium</span>=cpc&<span className="text-foreground">utm_campaign</span>=lancamento&<span className="text-foreground">utm_term</span>=ia&<span className="text-foreground">utm_content</span>=criativo-01
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">name</span>
                <span className="text-muted-foreground ml-1">— Nome completo do lead</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">email</span>
                <span className="text-muted-foreground ml-1">— E-mail do lead</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">whatsapp</span>
                <span className="text-muted-foreground ml-1">— Telefone com DDI (ex: 5511...)</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">tag</span>
                <span className="text-muted-foreground ml-1">— Tag adicionada ao contato (ex: campanha atual). Pode repetir o parâmetro ou separar por vírgula.</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">source</span>
                <span className="text-muted-foreground ml-1">— Origem de negócio (ex: nome da landing/evento)</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">utm_source</span>
                <span className="text-muted-foreground ml-1">— Origem da campanha (ex: meta, google)</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">utm_medium</span>
                <span className="text-muted-foreground ml-1">— Mídia da campanha (ex: cpc, email)</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">utm_campaign</span>
                <span className="text-muted-foreground ml-1">— Nome da campanha</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">utm_term</span>
                <span className="text-muted-foreground ml-1">— Termo/palavra-chave da campanha</span>
              </div>
              <div className="bg-muted/20 rounded-md p-2">
                <span className="font-medium text-foreground">utm_content</span>
                <span className="text-muted-foreground ml-1">— Identificador do criativo/conteúdo</span>
              </div>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : widgets.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum widget criado</h3>
          <p className="text-muted-foreground mb-4">Crie seu primeiro widget de agendamento para compartilhar com visitantes.</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Criar Widget</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {widgets.map(w => (
            <div key={w.id} className="glass-card p-5 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground truncate">{w.name}</h3>
                  <Badge variant={w.is_active ? "default" : "secondary"} className="text-xs">
                    {w.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                {w.description && <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{w.description}</p>}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {w.duration_minutes} min</span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(getPublicUrl(w.id), "Link")}>
                    <Copy className="h-3 w-3 mr-1" /> Link
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(getEmbedCode(w.id), "Código embed")}>
                    <Code className="h-3 w-3 mr-1" /> Embed
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={getPublicUrl(w.id)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" /> Abrir
                    </a>
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch checked={w.is_active} onCheckedChange={v => handleToggle(w.id, v)} />
                <Button variant="ghost" size="icon" onClick={() => navigate(`/settings/scheduling/${w.id}/history`)} title="Historico de conversoes">
                  <History className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { setStyleWidget(w); setStyleDialogOpen(true); }} title="Aparência">
                  <Palette className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => openEdit(w)} title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDuplicate(w)} title="Duplicar">
                  <CopyPlus className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(w.id)} title="Excluir">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Widget" : "Novo Widget de Agendamento"}</DialogTitle>
            <DialogDescription>Configure o widget e selecione os membros participantes.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Seção: Informações básicas */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Informações básicas</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Nome</Label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Consultoria Comercial" />
                  <p className="text-xs text-muted-foreground mt-1">Identificador interno (uso administrativo).</p>
                </div>
                <div>
                  <Label>Título público</Label>
                  <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex: Agende sua reunião" />
                  <p className="text-xs text-muted-foreground mt-1">Exibido no topo do widget. Se vazio, usa o Nome.</p>
                </div>
              </div>

              <div>
                <Label>Descrição (opcional)</Label>
                <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Descreva o objetivo desta reunião" rows={2} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Duração da reunião</Label>
                  <Select value={formDuration} onValueChange={setFormDuration}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutos</SelectItem>
                      <SelectItem value="30">30 minutos</SelectItem>
                      <SelectItem value="45">45 minutos</SelectItem>
                      <SelectItem value="60">60 minutos</SelectItem>
                      <SelectItem value="90">90 minutos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Janela de agendamento (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={formBookingWindowDays}
                    onChange={e => setFormBookingWindowDays(e.target.value)}
                    placeholder="30"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Dias visíveis a partir de hoje no calendário público.</p>
                </div>
                <div>
                  <AnalysisPlaybookSelect
                    activityType="meeting"
                    value={formAnalysisPlaybookId}
                    onChange={setFormAnalysisPlaybookId}
                    description="Aplicada automaticamente às reuniões agendadas por este widget."
                  />
                </div>
              </div>
            </section>






            {/* Seção: Filtro de ICP */}
            <section className="space-y-4 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Filtro de ICP (perfil ideal)</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Bloqueia o agendamento de leads fora do faturamento, cargo ou tamanho desejado.
                    </p>
                  </div>
                </div>
                <Switch checked={formIcpEnabled} onCheckedChange={setFormIcpEnabled} />
              </div>

              {formIcpEnabled && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs">Faturamento mensal</Label>
                      <div className="space-y-1.5 mt-2 border border-border rounded-lg p-3 max-h-52 overflow-y-auto bg-muted/20">
                        {REVENUE_OPTIONS.map(opt => (
                          <label key={opt} className="flex items-start gap-2 cursor-pointer text-sm">
                            <Checkbox
                              className="mt-0.5"
                              checked={formIcpRevenue.includes(opt)}
                              onCheckedChange={checked => {
                                setFormIcpRevenue(prev => checked ? [...prev, opt] : prev.filter(o => o !== opt));
                              }}
                            />
                            <span className="text-foreground leading-tight">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Cargo (decisor)</Label>
                      <div className="space-y-1.5 mt-2 border border-border rounded-lg p-3 max-h-52 overflow-y-auto bg-muted/20">
                        {JOB_TITLE_OPTIONS.map(opt => (
                          <label key={opt} className="flex items-start gap-2 cursor-pointer text-sm">
                            <Checkbox
                              className="mt-0.5"
                              checked={formIcpJobs.includes(opt)}
                              onCheckedChange={checked => {
                                setFormIcpJobs(prev => checked ? [...prev, opt] : prev.filter(o => o !== opt));
                              }}
                            />
                            <span className="text-foreground leading-tight">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Tamanho da empresa</Label>
                      <div className="space-y-1.5 mt-2 border border-border rounded-lg p-3 max-h-52 overflow-y-auto bg-muted/20">
                        {EMPLOYEE_OPTIONS.map(opt => (
                          <label key={opt} className="flex items-start gap-2 cursor-pointer text-sm">
                            <Checkbox
                              className="mt-0.5"
                              checked={formIcpEmployees.includes(opt)}
                              onCheckedChange={checked => {
                                setFormIcpEmployees(prev => checked ? [...prev, opt] : prev.filter(o => o !== opt));
                              }}
                            />
                            <span className="text-foreground leading-tight">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Mensagem exibida quando o lead não atende ao ICP</Label>
                    <Textarea
                      value={formIcpBlockMsg}
                      onChange={e => setFormIcpBlockMsg(e.target.value)}
                      rows={3}
                      placeholder={DEFAULT_ICP_BLOCK_MSG}
                    />
                  </div>
                </>
              )}
            </section>

            {/* Seção: Conversões do Google Ads */}
            <section className="space-y-4 border-t border-border pt-5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Conversões do Google Ads</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Um rótulo (label) de conversão por etapa do funil. A conta (AW-…) é herdada de Configurações da empresa → Google Ads. Deixe em branco as etapas que não quer rastrear.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {([
                  ["lead", "Cadastro / Lead (etapa 1)"],
                  ["qualified", "Lead Qualificado (etapa 2)"],
                  ["scheduled", "Agendou (etapa 3)"],
                  ["icp_blocked", "Fora do ICP"],
                  ["already_scheduled", "Já agendado"],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={formGadsLabels[key]}
                      onChange={e => setFormGadsLabels(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="Label da conversão"
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Seção: Mensagem de confirmação */}
            <section className="space-y-5 border-t border-border pt-5">
              <div className="flex items-start gap-2">
                <MessageSquare className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Mensagem de confirmação</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Enviada automaticamente após o lead confirmar o agendamento. Use as variáveis abaixo no texto.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map(v => (
                  <Badge key={v.key} variant="secondary" className="font-mono text-[10px] cursor-default" title={v.label}>
                    {`{{${v.key}}}`}
                  </Badge>
                ))}
              </div>

              {/* WhatsApp */}
              <div className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-success" />
                    <Label className="text-sm font-semibold">WhatsApp</Label>
                  </div>
                  <Switch checked={formWaEnabled} onCheckedChange={setFormWaEnabled} />
                </div>
                {formWaEnabled && (
                  <div>
                    <Textarea
                      value={formWaTemplate}
                      onChange={e => setFormWaTemplate(e.target.value)}
                      rows={9}
                      placeholder={DEFAULT_WA_TEMPLATE}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Requer uma conexão WhatsApp (Z-API) ativa no workspace.
                    </p>
                  </div>
                )}
              </div>

              {/* Email */}
              <div className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-semibold">E-mail</Label>
                  </div>
                  <Switch checked={formEmailEnabled} onCheckedChange={setFormEmailEnabled} />
                </div>
                {formEmailEnabled && (
                  <>
                    <div>
                      <Label className="text-xs">Assunto (opcional)</Label>
                      <Input
                        value={formEmailSubject}
                        onChange={e => setFormEmailSubject(e.target.value)}
                        placeholder="Ex: Reunião confirmada com {{responsavel}}"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Deixe vazio para usar o padrão do sistema.</p>
                    </div>
                    <div>
                      <Label className="text-xs">Corpo do e-mail (opcional)</Label>
                      <Textarea
                        value={formEmailTemplate}
                        onChange={e => setFormEmailTemplate(e.target.value)}
                        rows={9}
                        placeholder="Deixe vazio para usar o template padrão do sistema."
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Quando preenchido, substitui o e-mail padrão enviado ao lead.
                      </p>
                    </div>
                  </>
                )}
                {!formEmailEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum e-mail será enviado ao lead. O responsável continuará sendo notificado.
                  </p>
                )}
              </div>
            </section>

            {/* Seção: Evento no Google Calendar */}
            <section className="space-y-5 border-t border-border pt-5">
              <div className="flex items-start gap-2">
                <CalendarDays className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Evento no Google Calendar</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Define como o compromisso aparece na agenda do responsável e no convite do lead. Use as variáveis abaixo no texto.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARS.map(v => (
                  <Badge key={v.key} variant="secondary" className="font-mono text-[10px] cursor-default" title={v.label}>
                    {`{{${v.key}}}`}
                  </Badge>
                ))}
              </div>

              <div className="glass-card p-4 space-y-3">
                <div>
                  <Label className="text-xs">Título do evento</Label>
                  <Input
                    value={formCalendarTitle}
                    onChange={e => setFormCalendarTitle(e.target.value)}
                    placeholder={DEFAULT_CALENDAR_TITLE}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Deixe vazio para usar o padrão do sistema.</p>
                </div>
                <div>
                  <Label className="text-xs">Descrição do evento</Label>
                  <Textarea
                    value={formCalendarDescription}
                    onChange={e => setFormCalendarDescription(e.target.value)}
                    rows={6}
                    placeholder={DEFAULT_CALENDAR_DESCRIPTION}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    O evento só é criado para responsáveis com Google Calendar conectado.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Membros participantes</h3>
                <span className="text-xs text-muted-foreground">(com Google Calendar conectado)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto border border-border rounded-lg p-3 bg-muted/20">
                {members.map(m => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors">
                    <Checkbox
                      checked={selectedMembers.includes(m.id)}
                      onCheckedChange={checked => {
                        setSelectedMembers(prev =>
                          checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                        );
                      }}
                    />
                    <span className="text-foreground text-sm">{m.name}</span>
                  </label>
                ))}
                {members.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-full">
                    Nenhum membro com Google Calendar conectado. Conecte o calendário na página de Conexões.
                  </p>
                )}
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!formName.trim() || selectedMembers.length === 0}>
              {editing ? "Salvar" : "Criar Widget"}
            </Button>
          </DialogFooter>
        </DialogContent>

      </Dialog>

      <SchedulingStyleDialog
        open={styleDialogOpen}
        onOpenChange={(v) => { setStyleDialogOpen(v); if (!v) setStyleWidget(null); }}
        widgetId={styleWidget?.id ?? null}
        widgetTitle={styleWidget?.title || styleWidget?.name}
        widgetDescription={styleWidget?.description}
        initialStyle={styleWidget?.style ?? null}
        onSaved={(newStyle) => {
          setWidgets((prev) => prev.map((w) => w.id === styleWidget?.id ? { ...w, style: newStyle } : w));
        }}
      />
    </div>
  );
}
