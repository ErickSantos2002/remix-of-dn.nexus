import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LeadInsights, type ConversationInsights } from "@/components/chat/LeadInsights";
import { LeadActivities } from "./LeadActivities";
import { LeadNotes } from "./LeadNotes";
import { triggerConfetti, triggerFireworks } from "@/components/ui/confetti";
import { LeadConversation } from "./LeadConversation";
import { DNIAExpanded } from "./DNIAExpanded";
import { ContactTagEditor } from "@/components/crm/tags";
import { LeadPainsObjectionsSection } from "@/components/crm/LeadPainsObjectionsSection";
import { DNIASummaryBadges } from "@/components/crm/DNIASummaryBadges";
import { LeadSection } from "@/components/crm/LeadSection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceTags } from "@/hooks/useWorkspaceTags";
import { parseTags } from "@/types/tags";
import type { ContactTag } from "@/types/tags";
import { useToast } from "@/hooks/use-toast";
import { getAdjacentStages } from "@/lib/pipelineValidation";
import { 
  User, 
  Phone, 
  Mail, 
  Building2, 
  Briefcase,
  DollarSign,
  Calendar,
  Tag,
  ExternalLink,
  Edit,
  Users,
  TrendingUp,
  Trash2,
  Trophy,
  XCircle,
  Loader2,
  RotateCcw,
  RefreshCw,
  MessageCircle,
  ArrowRightLeft,
  Send,
  Copy,
  CalendarOff,
  Clock,
  MoreVertical,
  Megaphone,
  Sparkles,
  ChevronDown,
  ChevronRight,
  BellOff,
  Target,
} from "lucide-react";
import { formatStageDuration } from "@/lib/stageDuration";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useContactSources } from "@/hooks/useContactSources";
import { useUserRole } from "@/hooks/useUserRole";
import { LeadCadencesSection } from "@/components/crm/cadences/LeadCadencesSection";

function EditableSourceBadge({
  contactId,
  value,
  options,
  onSaved,
}: {
  contactId: string;
  value: string | null;
  options: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async (newValue: string) => {
    setSaving(true);
    const { error } = await supabase
      .from("crm_contacts")
      .update({ source: newValue })
      .eq("id", contactId);
    setSaving(false);
    setEditing(false);
    if (error) {
      toast({ title: "Erro ao salvar origem", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Origem atualizada" });
    onSaved();
  };

  if (editing) {
    return (
      <Select
        defaultValue={value || undefined}
        defaultOpen
        onValueChange={handleChange}
        onOpenChange={(o) => {
          if (!o && !saving) setEditing(false);
        }}
      >
        <SelectTrigger className="h-6 w-[180px] text-xs" disabled={saving}>
          <SelectValue placeholder="Selecionar origem" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.name} className="text-xs">{opt.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
      title="Editar origem"
    >
      <Badge variant="secondary" className="text-xs cursor-pointer">{value || "Sem origem"}</Badge>
      <Edit className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

function EditableChannelBadge({
  leadId,
  value,
  onSaved,
}: {
  leadId: string;
  value: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = async () => {
    setEditing(false);
    const normalized = draft.trim();
    if ((normalized || null) === (value || null)) return;
    setSaving(true);
    const { error } = await supabase
      .from("crm_leads")
      .update({ utm_source: normalized || null })
      .eq("id", leadId);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar canal", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Canal atualizado" });
    onSaved();
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value || "");
            setEditing(false);
          }
        }}
        className="h-6 w-[160px] text-xs"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
      title="Editar canal"
    >
      <Badge variant="secondary" className="text-xs cursor-pointer">{value || "Sem canal"}</Badge>
      <Edit className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

interface LeadDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  workspaceId: string;
  initialActivityId?: string | null;
}

interface CRMLead {
  id: string;
  workspace_id: string;
  title: string | null;
  value: number | null;
  description: string | null;
  stage_id: string;
  status: string | null;
  is_icp: boolean | null;
  created_at: string;
  product_id: string | null;
  assigned_to: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    job_title: string | null;
    position: string | null;
    employee_count: string | null;
    revenue: string | null;
    lead_id: string | null;
    tags: unknown; // JSONB from database
    source: string | null;
    dnia_id: string | null;
    scheduling_blocked: boolean | null;
    opted_out?: boolean | null;
    opted_out_at?: string | null;
  };
  stage: {
    id: string;
    name: string;
    color: string;
  };
}

interface LeadData {
  id: string;
  status: string | null;
  insights: ConversationInsights | null;
  ai_summary: string | null;
}

interface CompanyAdminRow {
  user_id: string | null;
  profiles: { id: string; name: string | null; email: string | null } | null;
}

interface LossReason {
  id: string;
  name: string;
  description?: string | null;
}

interface EditData {
  // Lead fields
  title: string;
  description: string;
  value: string;
  product_id: string;
  assigned_to: string;
  stage_id: string;
  // Contact fields
  name: string;
  phone: string;
  email: string;
  company: string;
  job_title: string;
  employee_count: string;
  revenue: string;
  source: string;
}

const EMPLOYEE_COUNT_OPTIONS = [
  { value: "Eu S.A.", label: "Eu S.A." },
  { value: "1-10 funcionarios", label: "1-10 funcionários" },
  { value: "11-50 funcionarios", label: "11-50 funcionários" },
  { value: "51-200 funcionarios", label: "51-200 funcionários" },
  { value: "+200 funcionarios", label: "+200 funcionários" },
];

const REVENUE_OPTIONS = [
  { value: "Ate 100k/mes", label: "Até 100k/mês" },
  { value: "Entre 100k e 500k/mes", label: "Entre 100k e 500k/mês" },
  { value: "Entre 500k e 1MM/mes", label: "Entre 500k e 1MM/mês" },
  { value: "Entre 1MM e 3MM/mes", label: "Entre 1MM e 3MM/mês" },
  { value: "Acima de 5MM/mes", label: "Acima de 5MM/mês" },
];

interface StageDurationRow {
  lead_id: string;
  stage_id: string;
  entered_at: string;
  exited_at: string | null;
  seconds: number;
  is_current: boolean;
  moved_by: string | null;
  reason: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rótulos dos gatilhos gravados em crm_lead_history.moved_by. Um UUID significa
 * movimentação manual e é resolvido para o nome da pessoa (ver useQuery abaixo);
 * "user" e "system" são genéricos e só aparecem quando nenhuma origem melhor foi
 * registrada naquela movimentação.
 */
const MOVED_BY_LABELS: Record<string, string> = {
  "user": "Manual",
  "system": "Automático",
  "api": "API",
  "auto-move": "Automove (regra de score)",
  "auto-schedule-widget": "Widget de agendamento",
  "auto-schedule": "Agendamento pela IA",
  "auto-guest-joined-meeting": "Convidado entrou na reunião",
  "orchestrator": "Agente de IA",
  "auto-reactivation": "Reativação automática",
  "auto-requalification": "Requalificação automática",
  "manual-reactivation": "Reativação manual",
  "correcao-rebaixamento-widget": "Correção manual",
};

function describeMovedBy(movedBy: string | null, profileNames: Map<string, string>): string | null {
  if (!movedBy) return null;
  if (UUID_REGEX.test(movedBy)) {
    const name = profileNames.get(movedBy.toLowerCase());
    return name ? `Manual · ${name}` : "Manual";
  }
  return MOVED_BY_LABELS[movedBy] ?? movedBy;
}

function StageDurationTimeline({
  leadId,
  stages,
}: {
  leadId: string;
  stages: { id: string; name: string; color: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: durations = [], isLoading } = useQuery({
    queryKey: ["crm-lead-stage-durations", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_stage_durations")
        .select("*")
        .eq("lead_id", leadId)
        .order("entered_at", { ascending: true });
      if (error) throw error;
      return (data || []) as StageDurationRow[];
    },
    enabled: !!leadId,
    refetchOnWindowFocus: false,
  });

  // Resolve os UUIDs de moved_by para nomes. Busca por id (e nao pela lista de
  // membros do workspace) para que quem saiu da equipe continue identificado.
  const authorIds = Array.from(
    new Set(
      durations
        .map((d) => d.moved_by)
        .filter((m): m is string => !!m && UUID_REGEX.test(m))
        .map((m) => m.toLowerCase()),
    ),
  );

  const { data: profileNames = new Map<string, string>() } = useQuery({
    queryKey: ["crm-lead-stage-authors", leadId, authorIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", authorIds);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const p of data || []) {
        map.set(String(p.id).toLowerCase(), p.name || p.email || "Sem nome");
      }
      return map;
    },
    enabled: authorIds.length > 0,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return null;
  if (durations.length === 0) return null;

  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-3">
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-left group">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-medium text-foreground">Tempo por etapa</h3>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2">
          {durations.map((d, idx) => {
            const stage = stageMap.get(d.stage_id);
            const trigger = describeMovedBy(d.moved_by, profileNames);
            return (
              <div
                key={`${d.stage_id}-${d.entered_at}-${idx}`}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-muted/30 border border-border"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: stage?.color || "hsl(var(--muted-foreground))" }}
                  />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground truncate">
                        {stage?.name || "Etapa removida"}
                      </span>
                      {d.is_current && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-primary/40 text-primary">
                          atual
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Entrou em{" "}
                      {new Date(d.entered_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {trigger && (
                      <span className="text-[11px] text-muted-foreground/80 truncate" title={d.reason || undefined}>
                        Por: {trigger}
                        {d.reason ? ` — ${d.reason}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {formatStageDuration(d.seconds)}
                </span>

              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}


export function LeadDetailSheet({ open, onOpenChange, leadId, workspaceId: workspaceIdProp, initialActivityId }: LeadDetailSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: contactSources = [] } = useContactSources();
  const { isSuperAdmin, isAdmin } = useUserRole();
  const [isLossDialogOpen, setIsLossDialogOpen] = useState(false);
  const [selectedLossReason, setSelectedLossReason] = useState("");
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [selectedReopenStage, setSelectedReopenStage] = useState("");
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedTransferMember, setSelectedTransferMember] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [isSyncingDnia, setIsSyncingDnia] = useState(false);
  const [isOptOutConfirmOpen, setIsOptOutConfirmOpen] = useState(false);
  const [editData, setEditData] = useState<EditData>({
    title: "",
    description: "",
    value: "",
    product_id: "",
    assigned_to: "",
    stage_id: "",
    name: "",
    phone: "",
    email: "",
    company: "",
    job_title: "",
    employee_count: "",
    revenue: "",
    source: "",
  });

  // Fetch CRM lead with contact and stage
  const { data: crmLead, isLoading: crmLoading } = useQuery({
    queryKey: ["crm-lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      
      const { data, error } = await supabase
        .from("crm_leads")
        .select(`
          id, workspace_id, title, value, description, stage_id, status, is_icp, created_at, product_id, assigned_to, utm_source, utm_medium, utm_campaign, utm_term, utm_content, deleted_at, deleted_by,
          contact:crm_contacts(id, name, phone, email, company, job_title, position, employee_count, revenue, lead_id, tags, source, dnia_id, scheduling_blocked, opted_out, opted_out_at),
          stage:crm_pipeline_stages(id, name, color)
        `)
        .eq("id", leadId)
        .single();
      
      if (error) throw error;
      return data as CRMLead;
    },
    enabled: !!leadId && open,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // O workspace efetivo e SEMPRE o do proprio lead. Isso impede que registros
  // (reunioes, atividades, notas) sejam criados no workspace/empresa selecionado
  // na barra lateral quando o lead pertence a outra empresa.
  const workspaceId = crmLead?.workspace_id || workspaceIdProp;

  // Fetch original lead data for insights
  const { data: originalLead } = useQuery({
    queryKey: ["crm-original-lead", crmLead?.contact?.lead_id],
    queryFn: async () => {
      if (!crmLead?.contact?.lead_id) return null;
      
      const { data, error } = await supabase
        .from("leads")
        .select("id, status, insights, ai_summary")
        .eq("id", crmLead.contact.lead_id)
        .single();
      
      if (error) throw error;
      return data as unknown as LeadData;
    },
    enabled: !!crmLead?.contact?.lead_id && open,
  });

  // Fetch psychology data
  const { data: psychology } = useQuery({
    queryKey: ["lead-psychology-sheet", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      
      const { data, error } = await supabase
        .from("crm_lead_psychology")
        .select("*")
        .eq("lead_id", leadId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!leadId && open,
  });

  // Fetch assignee info
  const { data: assignee, isLoading: isLoadingAssignee } = useQuery({
    queryKey: ["crm-assignee", crmLead?.assigned_to],
    queryFn: async () => {
      if (!crmLead?.assigned_to) return null;
      const { data } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", crmLead.assigned_to)
        .maybeSingle();
      return data;
    },
    enabled: !!crmLead?.assigned_to,
  });

  const assigneeLabel = isLoadingAssignee
    ? "Carregando..."
    : assignee?.name || assignee?.email || "Responsável não identificado";


  // Fetch loss reasons (filtered by stage if the stage has specific ones configured)
  const { data: lossReasons = [] } = useQuery({
    queryKey: ["crm-loss-reasons", workspaceId, crmLead?.stage_id],
    queryFn: async () => {
      if (!workspaceId) return [];

      // Check if current stage has specific loss reasons configured
      let allowedReasonIds: string[] | null = null;
      if (crmLead?.stage_id) {
        const { data: stageLinks, error: linkErr } = await supabase
          .from("crm_stage_loss_reasons")
          .select("loss_reason_id")
          .eq("stage_id", crmLead.stage_id);
        if (linkErr) throw linkErr;
        if (stageLinks && stageLinks.length > 0) {
          allowedReasonIds = stageLinks.map((l) => l.loss_reason_id);
        }
      }

      let query = supabase
        .from("crm_loss_reasons")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name");

      if (allowedReasonIds) {
        query = query.in("id", allowedReasonIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as LossReason[];
    },
    enabled: !!workspaceId && open,
  });

  // Fetch products for edit dialog
  const { data: products = [] } = useQuery({
    queryKey: ["crm-products-edit", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("crm_products")
        .select("id, name, price")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId && isEditDialogOpen,
  });

  // Fetch workspace members for edit/transfer dialog
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members-edit", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      
      // 1. Workspace members
      const { data: wsMembers } = await supabase
        .from("workspace_members")
        .select("user_id, profiles:user_id(id, name, email)")
        .eq("workspace_id", workspaceId);
      
      // 2. Workspace owner
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("owner_id, company_id")
        .eq("id", workspaceId)
        .single();
      
      // 3. Company admins/super_admins
      let companyAdmins: CompanyAdminRow[] = [];
      if (workspace?.company_id) {
        const { data: admins } = await supabase
          .from("company_members")
          .select("user_id, profiles:user_id(id, name, email)")
          .eq("company_id", workspace.company_id)
          .eq("status", "active")
          .in("role", ["admin", "super_admin"]);
        companyAdmins = (admins || []) as unknown as CompanyAdminRow[];
      }
      
      // Combine and deduplicate
      const allMembers = new Map<string, { id: string; name: string }>();
      
      // Add workspace members
      ((wsMembers || []) as unknown as CompanyAdminRow[]).forEach((m) => {
        if (m.user_id && !allMembers.has(m.user_id)) {
          allMembers.set(m.user_id, {
            id: m.user_id,
            name: m.profiles?.name || m.profiles?.email || "Sem nome",
          });
        }
      });
      
      // Add workspace owner
      if (workspace?.owner_id && !allMembers.has(workspace.owner_id)) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("id, name, email")
          .eq("id", workspace.owner_id)
          .single();
        if (ownerProfile) {
          allMembers.set(workspace.owner_id, {
            id: workspace.owner_id,
            name: ownerProfile.name || ownerProfile.email || "Sem nome",
          });
        }
      }
      
      // Add company admins
      companyAdmins.forEach((m) => {
        if (m.user_id && !allMembers.has(m.user_id)) {
          allMembers.set(m.user_id, {
            id: m.user_id,
            name: m.profiles?.name || m.profiles?.email || "Sem nome",
          });
        }
      });
      
      return Array.from(allMembers.values());
    },
    enabled: !!workspaceId && open && (isAdmin || isEditDialogOpen || isTransferDialogOpen),
  });

  // Fetch stages for edit/reopen dialog
  const { data: stages = [] } = useQuery({
    queryKey: ["crm-stages-edit", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name, color, order")
        .eq("workspace_id", workspaceId)
        .order("order");
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  // Fetch workspace tags for autocomplete
  const { data: workspaceTags = [] } = useWorkspaceTags(workspaceId);

  // Update contact tags mutation
  const updateContactTags = useMutation({
    mutationFn: async (tags: ContactTag[]) => {
      if (!crmLead?.contact?.id) throw new Error("Contact ID is required");

      const { error } = await supabase
        .from("crm_contacts")
        .update({ tags: tags as unknown as Json })
        .eq("id", crmLead.contact.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-tags", workspaceId] });
      toast({ title: "Tags atualizadas" });
      // Fire-and-forget sync to dnMarketing
      const contactId = crmLead?.contact?.id;
      if (contactId) {
        supabase.functions
          .invoke("dnmarketing-tags-sync", { body: { contact_id: contactId } })
          .catch((err) => console.error("[dnmarketing-tags-sync] failed:", err));
      }
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar tags"
      });
    },
  });

  // Toggle scheduling_blocked on contact
  const updateSchedulingBlocked = useMutation({
    mutationFn: async (blocked: boolean) => {
      if (!crmLead?.contact?.id) throw new Error("Contact ID is required");
      const { error } = await supabase
        .from("crm_contacts")
        .update({ scheduling_blocked: blocked })
        .eq("id", crmLead.contact.id);
      if (error) throw error;
    },
    onSuccess: (_, blocked) => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      toast({ title: blocked ? "Agendamentos bloqueados" : "Agendamentos liberados" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao atualizar bloqueio de agendamento" });
    },
  });

  // Toggle opted_out on contact ("não deseja mais receber contato")
  const updateOptedOut = useMutation({
    mutationFn: async (nextOptedOut: boolean) => {
      if (!crmLead?.contact?.id) throw new Error("Contact ID is required");
      const { error } = await supabase
        .from("crm_contacts")
        .update({
          opted_out: nextOptedOut,
          opted_out_at: nextOptedOut ? new Date().toISOString() : null,
        })
        .eq("id", crmLead.contact.id);
      if (error) throw error;
    },
    onSuccess: (_, nextOptedOut) => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      toast({
        title: nextOptedOut
          ? "Contato marcado como 'não deseja receber contato'"
          : "Contato pode receber interações novamente",
      });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao atualizar preferência de contato" });
    },
  });

  // Toggle manual do atributo ICP no card (também marcado automaticamente pelo widget)
  const updateIcp = useMutation({
    mutationFn: async (checked: boolean) => {
      if (!leadId) throw new Error("Lead ID is required");
      const { error } = await supabase
        .from("crm_leads")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ is_icp: checked } as any) // coluna nova; types.ts regenerado pelo Lovable
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: (_, checked) => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      toast({ title: checked ? "Marcado como ICP" : "Desmarcado como ICP" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao atualizar ICP" });
    },
  });

  // Mark as won
  const markAsWon = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error("Lead ID is required");
      
      const { error } = await supabase
        .from("crm_leads")
        .update({ 
          status: "won", 
          closed_at: new Date().toISOString() 
        })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      triggerConfetti();
      setTimeout(() => triggerFireworks(), 500);
      
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      toast({ title: "Lead marcado como ganho!" });

      if (crmLead?.contact?.id) {
        supabase.functions.invoke("dnmarketing-notify", {
          body: {
            contact_id: crmLead.contact.id,
            event_type: "deal_won",
            title: `Negócio fechado — ${crmLead?.title || "Lead"}`,
            metadata: { lead_id: leadId, value: crmLead?.value },
          },
        }).catch(() => {});
      }
    },
  });

  // Mark as lost
  const markAsLost = useMutation({
    mutationFn: async () => {
      if (!leadId || !selectedLossReason) throw new Error("Dados incompletos");
      const { error } = await supabase
        .from("crm_leads")
        .update({ 
          status: "lost", 
          closed_at: new Date().toISOString(),
          loss_reason_id: selectedLossReason 
        })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      setIsLossDialogOpen(false);
      setSelectedLossReason("");
      toast({ title: "Lead marcado como perdido" });

      // Fire-and-forget: notify dnMarketing
      if (crmLead?.contact?.id) {
        const reason = lossReasons.find((r) => r.id === selectedLossReason);
        const reasonName = reason?.name ?? null;
        const reasonDescription = reason?.description ?? null;
        supabase.functions.invoke("dnmarketing-notify", {
          body: {
            contact_id: crmLead.contact.id,
            event_type: "deal_lost",
            title: `Negócio perdido — ${crmLead?.title || "Lead"}`,
            description: reasonName ? `Motivo: ${reasonName}` : undefined,
            metadata: {
              lead_id: leadId,
              loss_reason_id: selectedLossReason,
              loss_reason_name: reasonName,
              loss_reason_description: reasonDescription,
            },
          },
        }).catch(() => {});
      }
    },
  });

  // Reopen lost lead
  const reopenLead = useMutation({
    mutationFn: async () => {
      if (!leadId || !selectedReopenStage) throw new Error("Dados incompletos");
      
      const { error } = await supabase
        .from("crm_leads")
        .update({ 
          status: "open", 
          closed_at: null,
          loss_reason_id: null,
          stage_id: selectedReopenStage
        })
        .eq("id", leadId);
      if (error) throw error;
      
      // Registrar histórico
      await supabase.from("crm_lead_history").insert({
        lead_id: leadId,
        from_stage_id: crmLead?.stage_id,
        to_stage_id: selectedReopenStage,
        moved_by: "system",
        reason: "reopened",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      setIsReopenDialogOpen(false);
      setSelectedReopenStage("");
      toast({ title: "Lead reaberto com sucesso!" });
    },
  });

  // Soft delete do card (não toca em contato nem em chat)
  const deleteLead = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error("Lead ID is required");

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("crm_leads")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        })
        .eq("id", leadId);

      if (error) {
        console.error("Erro ao excluir card:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      onOpenChange(false);
      toast({ title: "Card excluído" });
    },
    onError: (error: { message?: string; code?: string }) => {
      console.error("Falha ao excluir card:", error?.message, error?.code, error);
      toast({ variant: "destructive", title: `Erro ao excluir card: ${error?.message || 'Erro desconhecido'}` });
    },
  });


  // Update lead mutation
  const updateLead = useMutation({
    mutationFn: async (data: EditData) => {
      if (!leadId || !crmLead?.contact?.id) throw new Error("Lead ID is required");

      // 1. Update contact
      const { error: contactError } = await supabase
        .from("crm_contacts")
        .update({
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          company: data.company || null,
          job_title: data.job_title || null,
          position: data.job_title || null,
          employee_count: data.employee_count || null,
          revenue: data.revenue || null,
          // source (origem) é definido apenas no cadastro e não pode ser editado
        })
        .eq("id", crmLead.contact.id);

      if (contactError) throw contactError;

      // 2. Update lead — sync title with contact name if title was derived from it
      const previousStageId = crmLead.stage_id;
      const oldTitle = crmLead.title;
      const oldContactName = crmLead.contact?.name;
      const titleChanged = (data.title || null) !== (oldTitle || null);
      const shouldSyncTitle = !titleChanged && (!oldTitle || oldTitle === oldContactName);
      const newTitle = shouldSyncTitle ? data.name : (data.title || null);

      const { data: updatedRows, error: leadError } = await supabase
        .from("crm_leads")
        .update({
          title: newTitle,
          description: data.description || null,
          value: data.value ? parseFloat(data.value) : null,
          product_id: data.product_id || null,
          ...(isAdmin ? { assigned_to: data.assigned_to || null } : {}),
          stage_id: data.stage_id,
        })
        .eq("id", leadId)
        .select("id, title");

      console.log("[LeadDetailSheet] update crm_leads result:", { updatedRows, leadError, sentTitle: newTitle });
      if (leadError) throw leadError;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("Nenhuma linha atualizada — verifique permissões (RLS).");
      }

      // 3. Record stage change history if changed
      if (previousStageId !== data.stage_id) {
        await supabase.from("crm_lead_history").insert({
          lead_id: leadId,
          from_stage_id: previousStageId,
          to_stage_id: data.stage_id,
          moved_by: "user",
          reason: "stage_change",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      setIsEditDialogOpen(false);
      toast({ title: "Lead atualizado com sucesso" });
    },
    onError: (error: Error) => {
      if (error.message?.includes("Contato duplicado")) {
        toast({ variant: "destructive", title: "Contato duplicado", description: error.message });
      } else {
        toast({ variant: "destructive", title: "Erro ao atualizar lead" });
      }
    },
  });

  const handleOpenEditDialog = () => {
    if (!crmLead) return;
    setEditData({
      title: crmLead.title || "",
      description: crmLead.description || "",
      value: crmLead.value?.toString() || "",
      product_id: crmLead.product_id || "",
      assigned_to: crmLead.assigned_to || "",
      stage_id: crmLead.stage_id,
      name: crmLead.contact?.name || "",
      phone: crmLead.contact?.phone || "",
      email: crmLead.contact?.email || "",
      company: crmLead.contact?.company || "",
      job_title: crmLead.contact?.job_title || crmLead.contact?.position || "",
      employee_count: crmLead.contact?.employee_count || "",
      revenue: crmLead.contact?.revenue || "",
      source: crmLead.contact?.source || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editData.name.trim()) {
      toast({ variant: "destructive", title: "Nome é obrigatório" });
      return;
    }
    updateLead.mutate(editData);
  };

  const handleTransfer = async () => {
    if (!isAdmin) {
      toast({ variant: "destructive", title: "Apenas administradores podem transferir o card" });
      return;
    }
    if (!selectedTransferMember || !leadId) {
      toast({ variant: "destructive", title: "Selecione um membro" });
      return;
    }

    setIsTransferring(true);
    try {
      // 1. Atualizar crm_leads.assigned_to
      const { error: crmError } = await supabase
        .from("crm_leads")
        .update({ 
          assigned_to: selectedTransferMember,
          updated_at: new Date().toISOString()
        })
        .eq("id", leadId);

      if (crmError) throw crmError;

      // 2. Se tiver conversa vinculada, tambem atualizar leads.assigned_to_user_id
      if (crmLead?.contact?.lead_id) {
        await supabase
          .from("leads")
          .update({ 
            assigned_to_user_id: selectedTransferMember,
            assigned_at: new Date().toISOString()
          })
          .eq("id", crmLead.contact.lead_id);
      }

      // 3. Invalidar queries
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      
      setIsTransferDialogOpen(false);
      setSelectedTransferMember("");
      setTransferReason("");
      
      toast({ title: "Lead transferido com sucesso" });
    } catch (error) {
      console.error("Transfer error:", error);
      toast({ variant: "destructive", title: "Erro ao transferir lead" });
    } finally {
      setIsTransferring(false);
    }
  };

  const [isSavingAssignee, setIsSavingAssignee] = useState(false);
  const handleAssigneeChange = async (userId: string) => {
    if (!isAdmin) {
      toast({ variant: "destructive", title: "Apenas administradores podem alterar o responsável" });
      return;
    }
    if (!leadId || !userId) return;
    setIsSavingAssignee(true);
    try {
      const { error } = await supabase
        .from("crm_leads")
        .update({ assigned_to: userId, updated_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;

      if (crmLead?.contact?.lead_id) {
        await supabase
          .from("leads")
          .update({ assigned_to_user_id: userId, assigned_at: new Date().toISOString() })
          .eq("id", crmLead.contact.lead_id);
      }

      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-assignee"] });
      toast({ title: "Responsável atualizado" });
    } catch (error) {
      console.error("Assignee update error:", error);
      toast({ variant: "destructive", title: "Erro ao alterar responsável" });
    } finally {
      setIsSavingAssignee(false);
    }
  };


  const handlePhoneClick = () => {
    if (crmLead?.contact?.phone) {
      window.open(`tel:${crmLead.contact.phone}`, "_blank");
    }
  };

  const [isDialing, setIsDialing] = useState(false);
  const handleApi4comDial = async () => {
    if (!crmLead?.contact?.phone || !leadId) return;
    setIsDialing(true);
    try {
      // Resolve recipient so notification trigger fires
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id ?? null;
      const activityAssignedTo = (crmLead as { assigned_to?: string | null })?.assigned_to ?? currentUserId;

      // Create scheduled call activity
      const { data: activity, error: actErr } = await supabase
        .from("crm_lead_activities")
        .insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          type: "call",
          title: `Ligação para ${crmLead.contact.name}`,
          scheduled_at: new Date().toISOString(),
          status: "pending",
          created_by: currentUserId,
          assigned_to: activityAssignedTo,
        })
        .select("id")
        .single();
      if (actErr) throw actErr;


      const { data, error } = await supabase.functions.invoke("api4com-dial", {
        body: {
          workspace_id: workspaceId,
          lead_id: leadId,
          contact_id: crmLead.contact.id,
          activity_id: activity?.id,
          phone: crmLead.contact.phone,
        },
      });

      // Extract error message from either thrown error (FunctionsHttpError) or data.error
      let errMsg = "";
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try { const body = await ctx.json(); errMsg = body?.error || ""; } catch { /* ignore */ }
        }
        if (!errMsg) errMsg = error.message || "";
      } else if (!data?.success) {
        errMsg = typeof data?.error === "string" ? data.error : JSON.stringify(data?.error || "");
      }

      if (errMsg) {
        if (/user not registered/i.test(errMsg) || (/ramal/i.test(errMsg) && /(registr|logad|online)/i.test(errMsg))) {
          toast({
            variant: "destructive",
            title: "Ramal não está logado no webphone",
            description: "Abra a extensão api4com no Chrome e faça login com o seu ramal antes de ligar. O ramal precisa estar online (verde) na extensão.",
          });
        } else if (/[Rr]amal/.test(errMsg) && /configur/i.test(errMsg)) {
          toast({
            variant: "destructive",
            title: "Ramal não configurado",
            description: "Configure seu ramal api4com em Time > Editar Membro para fazer ligações.",
          });
        } else if (/api4com/i.test(errMsg) && /configur/i.test(errMsg)) {
          toast({
            variant: "destructive",
            title: "Integração api4com pendente",
            description: "Configure a integração em Empresa > Integração api4com.",
          });
        } else {
          toast({ variant: "destructive", title: "Falha ao discar", description: errMsg });
        }
        return;
      }

      toast({ title: "Chamada iniciada", description: "Atenda no seu ramal/webphone." });
      queryClient.invalidateQueries({ queryKey: ["crm-activities", leadId] });
    } catch (e) {
      toast({ variant: "destructive", title: "Erro", description: e instanceof Error ? e.message : "Falha" });
    } finally {
      setIsDialing(false);
    }
  };

  const handleEmailClick = () => {
    if (crmLead?.contact?.email) {
      window.open(`mailto:${crmLead.contact.email}`, "_blank");
    }
  };

  const handleDniaSync = async () => {
    if (!crmLead?.contact?.id) return;
    setIsSyncingDnia(true);
    try {
      const { data, error } = await supabase.functions.invoke('dnmarketing-sync', {
        body: { contact_id: crmLead.contact.id }
      });
      if (error) throw error;
      const dniaId = data?.dnia_id;
      toast({ title: "DNIA sincronizado com sucesso", description: dniaId ? `ID: ${dniaId}` : undefined });
      await queryClient.invalidateQueries({ queryKey: ['crm-lead-detail', leadId] });
      await queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
    } catch (err) {
      console.error('[DNIA Sync]', err);
      toast({ variant: "destructive", title: "Falha ao sincronizar DNIA" });
    } finally {
      setIsSyncingDnia(false);
    }
  };

  const handleOpenChat = async () => {
    if (!crmLead?.contact?.phone) {
      toast({
        variant: "destructive",
        title: "Telefone obrigatório",
        description: "O contato precisa ter um telefone para iniciar uma conversa.",
      });
      return;
    }

    // Se ja tem lead_id, redireciona para o Inbox
    if (crmLead.contact.lead_id) {
      onOpenChange(false);
      navigate(`/?lead=${crmLead.contact.lead_id}`);
      return;
    }

    // Caso contrario, cria novo lead
    setIsCreatingChat(true);
    try {
      // Verifica se existe lead com este telefone
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("phone", crmLead.contact.phone)
        .maybeSingle();

      if (existingLead) {
        // Atualiza contato com lead_id
        await supabase
          .from("crm_contacts")
          .update({ lead_id: existingLead.id })
          .eq("id", crmLead.contact.id);
        
        queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
        onOpenChange(false);
        navigate(`/?lead=${existingLead.id}`);
        return;
      }

      // Cria novo lead
      const { data: newLead, error } = await supabase
        .from("leads")
        .insert({
          workspace_id: workspaceId,
          phone: crmLead.contact.phone,
          name: crmLead.contact.name,
          status: "new",
        })
        .select("id")
        .single();

      if (error) throw error;

      // Atualiza contato com lead_id
      await supabase
        .from("crm_contacts")
        .update({ lead_id: newLead.id })
        .eq("id", crmLead.contact.id);

      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      toast({ title: "Conversa criada com sucesso" });
      onOpenChange(false);
      navigate(`/?lead=${newLead.id}`);
    } catch (error) {
      console.error("Error creating lead:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar conversa",
      });
    } finally {
      setIsCreatingChat(false);
    }
  };

  const isDeleted = !!crmLead?.deleted_at;
  const isOpen = !isDeleted && (crmLead?.status === "open" || !crmLead?.status);

  const reactivateLead = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error("Lead ID is required");
      const { error } = await supabase
        .from("crm_leads")
        .update({ deleted_at: null, deleted_by: null, status: "open", updated_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      toast({ title: "Card reativado" });
    },
    onError: (error: { message?: string }) => {
      toast({ variant: "destructive", title: `Erro ao reativar card: ${error?.message || 'Erro desconhecido'}` });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-none sm:max-w-none glass-card border-0 p-0 flex flex-col [&>button]:top-3 [&>button]:right-4 [&>button]:h-9 [&>button]:w-9 [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:rounded-md [&>button]:border [&>button]:border-border">
        {crmLoading || !crmLead ? (
          <div className="p-6">
            <div className="text-muted-foreground text-sm">Carregando...</div>
          </div>
        ) : (
          <>
            {/* Header - largura total, fixo acima do grid */}
            <SheetHeader className="shrink-0 space-y-0 text-left px-4 py-3 pr-16 border-b border-border">
              <div className="relative flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 xl:max-w-sm">
                  <SheetTitle className="text-xl font-semibold text-foreground truncate">
                    {crmLead.title || "Sem título"}
                  </SheetTitle>
                  {crmLead.status === "won" && (
                    <Badge className="bg-success/20 text-success border-success/30 shrink-0">Ganho</Badge>
                  )}
                  {crmLead.status === "lost" && (
                    <Badge className="bg-destructive/20 text-destructive border-destructive/30 shrink-0">Perdido</Badge>
                  )}
                  <Badge
                    style={{ backgroundColor: crmLead.stage?.color + "20", color: crmLead.stage?.color, borderColor: crmLead.stage?.color }}
                    variant="outline"
                    className="text-xs shrink-0"
                  >
                    {crmLead.stage?.name}
                  </Badge>
                </div>

                {/* Resumo do DNIA - centralizado de forma absoluta no desktop (some quando não há análise) */}
                <DNIASummaryBadges
                  psychology={psychology}
                  className="order-last w-full min-w-0 xl:order-none xl:w-auto xl:absolute xl:left-1/2 xl:-translate-x-1/2 xl:pointer-events-none"
                />

                {/* Barra de ações */}
                <div className="flex items-center gap-2 shrink-0">
                  {isDeleted && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-primary text-primary hover:bg-primary/10"
                      onClick={() => reactivateLead.mutate()}
                      disabled={reactivateLead.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Reativar card
                    </Button>
                  )}

                  {crmLead.status === "won" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => setIsLossDialogOpen(true)}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Alterar para Perdido
                    </Button>
                  )}

                  {crmLead.status === "lost" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-primary text-primary hover:bg-primary/10"
                        onClick={() => setIsReopenDialogOpen(true)}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reabrir Lead
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-success text-success hover:bg-success/10"
                        onClick={() => markAsWon.mutate()}
                        disabled={markAsWon.isPending}
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        Marcar Ganho
                      </Button>
                    </>
                  )}

                  {isOpen && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-success text-success hover:bg-success/10"
                        onClick={() => markAsWon.mutate()}
                        disabled={markAsWon.isPending}
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        Ganho
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive text-destructive hover:bg-destructive/10"
                        onClick={() => setIsLossDialogOpen(true)}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Perdido
                      </Button>

                      {/* Ações secundárias agrupadas no menu de contexto */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="ml-1 h-9 w-9 border-border text-muted-foreground hover:text-foreground"
                            title="Mais ações"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {isAdmin && (
                            <DropdownMenuItem onSelect={() => setIsTransferDialogOpen(true)}>
                              <ArrowRightLeft className="h-4 w-4 mr-2" />
                              Transferir lead
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={handleOpenEditDialog}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar card
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setIsDeleteConfirmOpen(true)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir lead
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </div>
            </SheetHeader>

            {/* Corpo - grid de 3 colunas com scroll independente a partir de xl */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1.3fr_1fr] xl:grid-rows-1 overflow-y-auto xl:overflow-hidden">
              {/* Coluna 1 - Cadastro do lead */}
              <div className="min-w-0 p-4 space-y-5 lg:row-span-2 xl:row-span-1 xl:h-full xl:min-h-0 xl:overflow-y-auto scrollbar-thin border-b lg:border-b-0 lg:border-r border-border">
                {/* Contact Info */}
                <LeadSection icon={User} title="Informações de contato" collapsible>
                  <div className="bg-background/50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <User className="h-4 w-4 text-primary" />
                      {crmLead.contact?.name || "Sem nome"}
                    </div>
                    {crmLead.contact?.phone && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={handlePhoneClick}
                          className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors flex-1 text-left"
                        >
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          {crmLead.contact.phone}
                          <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-primary/10 flex-shrink-0"
                          onClick={handleApi4comDial}
                          disabled={isDialing}
                          title="Ligar via api4com"
                        >
                          {isDialing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Phone className="h-4 w-4 text-primary" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-primary/10 flex-shrink-0"
                          onClick={handleOpenChat}
                          disabled={isCreatingChat}
                          title="Abrir conversa"
                        >
                          {isCreatingChat ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageCircle className="h-4 w-4 text-primary" />
                          )}
                        </Button>
                      </div>
                    )}
                    {crmLead.contact?.email && (
                      <button 
                        onClick={handleEmailClick}
                        className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors w-full text-left"
                      >
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {crmLead.contact.email}
                        <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
                      </button>
                    )}
                    {crmLead.contact?.company && (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {crmLead.contact.company}
                      </div>
                    )}
                    {(crmLead.contact?.job_title || crmLead.contact?.position) && (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        {crmLead.contact.job_title || crmLead.contact.position}
                      </div>
                    )}
                    {crmLead.contact?.employee_count && (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {crmLead.contact.employee_count}
                      </div>
                    )}
                    {crmLead.contact?.revenue && (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        {crmLead.contact.revenue}
                      </div>
                    )}
                    {(isSuperAdmin || (crmLead.contact?.source && crmLead.contact.source !== "pipeline")) && (
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground uppercase mr-1">Origem</span>
                        {isSuperAdmin && crmLead.contact?.id ? (
                          <EditableSourceBadge
                            contactId={crmLead.contact.id}
                            value={crmLead.contact.source}
                            options={contactSources}
                            onSaved={() => queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] })}
                          />
                        ) : (
                          <Badge variant="secondary" className="text-xs">{crmLead.contact?.source}</Badge>
                        )}
                      </div>
                    )}
                    {crmLead.contact?.dnia_id ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 gap-1 text-[10px] font-mono pr-1">
                          <ExternalLink className="h-3 w-3" />
                          DNIA: {crmLead.contact.dnia_id.substring(0, 8)}...
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!crmLead.contact?.dnia_id) return;
                              navigator.clipboard.writeText(crmLead.contact.dnia_id);
                              toast({ title: "Código DNIA copiado" });
                            }}
                            className="ml-1 p-0.5 rounded hover:bg-primary/20 transition-colors"
                            title="Copiar código DNIA"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => {
                            if (!crmLead.contact?.id) return;
                            const contactId = crmLead.contact.id;
                            supabase.functions.invoke("dnmarketing-notify", {
                              body: {
                                contact_id: contactId,
                                event_type: "sync_manual",
                                title: `Sincronização manual do lead: ${crmLead.title || crmLead.contact?.name || "Sem título"}`,
                                metadata: { lead_id: crmLead.id, source: "lead_detail" },
                              },
                            });
                            supabase.functions
                              .invoke("dnmarketing-tags-sync", { body: { contact_id: contactId } })
                              .catch((err) => console.error("[dnmarketing-tags-sync] failed:", err));
                            toast({ title: "Contato enviado", description: "Sincronização com dnMarketing iniciada." });
                          }}
                        >
                          <Send className="h-3 w-3" />
                          Enviar para dnMarketing
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                          disabled={isSyncingDnia || (!crmLead.contact?.phone && !crmLead.contact?.email)}
                          onClick={handleDniaSync}
                        >
                          <RefreshCw className={`h-3 w-3 ${isSyncingDnia ? "animate-spin" : ""}`} />
                          {isSyncingDnia ? "Sincronizando..." : "Sincronizar DNIA"}
                        </Button>
                      </div>
                    )}
                  </div>
                </LeadSection>

                {/* Responsável */}
                {(crmLead.assigned_to || isAdmin) && (
                  <LeadSection icon={User} title="Responsável" collapsible>
                    <div className="bg-background/50 rounded-lg p-3">
                      {isAdmin ? (
                        <Select
                          value={crmLead.assigned_to || ""}
                          disabled={isSavingAssignee}
                          onValueChange={handleAssigneeChange}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Selecione o responsável" />
                          </SelectTrigger>
                          <SelectContent>
                            {members.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-foreground">{assigneeLabel}</p>
                      )}
                    </div>
                  </LeadSection>
                )}


                {/* Traffic Source / UTM */}
                {(isSuperAdmin || crmLead.contact?.source || crmLead.utm_source || crmLead.utm_medium || crmLead.utm_campaign || crmLead.utm_term || crmLead.utm_content) && (
                  <LeadSection icon={Megaphone} title="Origem do tráfego" collapsible>
                    <div className="bg-background/50 rounded-lg p-3 space-y-2">
                      {(isSuperAdmin || crmLead.utm_source) && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground uppercase">Canal</span>
                          {isSuperAdmin ? (
                            <EditableChannelBadge
                              leadId={crmLead.id}
                              value={crmLead.utm_source}
                              onSaved={() => queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] })}
                            />
                          ) : (
                            <Badge variant="secondary" className="text-xs">{crmLead.utm_source}</Badge>
                          )}
                        </div>
                      )}
                      {(crmLead.utm_source || crmLead.utm_medium || crmLead.utm_campaign || crmLead.utm_term || crmLead.utm_content) && (
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                          {crmLead.utm_source && (
                            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                              source: {crmLead.utm_source}
                            </Badge>
                          )}
                          {crmLead.utm_medium && (
                            <Badge variant="secondary" className="text-[10px] bg-series-4/10 text-series-4 border-series-4/20">
                              medium: {crmLead.utm_medium}
                            </Badge>
                          )}
                          {crmLead.utm_campaign && (
                            <Badge variant="secondary" className="text-[10px] bg-success/10 text-success border-success/20">
                              campaign: {crmLead.utm_campaign}
                            </Badge>
                          )}
                          {crmLead.utm_term && (
                            <Badge variant="secondary" className="text-[10px] bg-warning/10 text-warning border-warning/20">
                              term: {crmLead.utm_term}
                            </Badge>
                          )}
                          {crmLead.utm_content && (
                            <Badge variant="secondary" className="text-[10px] bg-series-2/10 text-series-2 border-series-2/20">
                              content: {crmLead.utm_content}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </LeadSection>
                )}

                {/* Business Info */}
                <LeadSection
                  icon={Briefcase}
                  title="Dados do negócio"
                  collapsible
                  contentClassName="space-y-2"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-background/50 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span className="text-[10px] text-muted-foreground uppercase">Valor</span>
                      </div>
                      <p className="text-lg font-mono font-semibold text-foreground mt-1">
                        {crmLead.value ? `R$ ${crmLead.value.toLocaleString("pt-BR")}` : "-"}
                      </p>
                    </div>
                    <div className="bg-background/50 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground uppercase">Criado em</span>
                      </div>
                      <p className="text-sm text-foreground mt-1">
                        {format(new Date(crmLead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>

                  {/* Tags - Editable */}


                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Tags</span>
                    </div>
                    <ContactTagEditor
                      tags={parseTags(crmLead.contact?.tags)}
                      onChange={(tags) => updateContactTags.mutate(tags)}
                      workspaceTags={workspaceTags}
                      disabled={updateContactTags.isPending}
                    />
                  </div>

                  {/* Dores e Objecoes */}
                  <LeadPainsObjectionsSection leadId={crmLead.id} workspaceId={workspaceId} />



                  {/* ICP Toggle */}
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <Target className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground block">Perfil de cliente ideal (ICP)</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {isAdmin
                              ? "Marcado automaticamente pelo widget de agendamento ou manualmente aqui."
                              : "Marcado automaticamente pelo widget de agendamento. Somente administradores podem alterar."}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={crmLead.is_icp === true}
                        onCheckedChange={(checked) => updateIcp.mutate(checked)}
                        disabled={updateIcp.isPending || !isAdmin}
                      />
                    </div>
                  </div>

                  {/* Scheduling Block Toggle */}
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <CalendarOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground block">Bloquear agendamentos</span>
                          <p className="text-xs text-muted-foreground mt-0.5">Quando ativo, este contato não consegue agendar pelo widget nem pela IA.</p>
                        </div>
                      </div>
                      <Switch
                        checked={!!crmLead.contact?.scheduling_blocked}
                        onCheckedChange={(checked) => updateSchedulingBlocked.mutate(checked)}
                        disabled={updateSchedulingBlocked.isPending}
                      />
                    </div>
                  </div>

                  {/* Opt-out toggle - "Nao deseja mais receber contato" */}
                  <div className="bg-background/50 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <BellOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground block">Não deseja mais receber contato</span>
                          <p className="text-xs text-muted-foreground mt-0.5">Quando ativo, este contato não será mais contatado por nenhum canal (WhatsApp, IA, cadências).</p>
                          {crmLead.contact?.opted_out && crmLead.contact?.opted_out_at && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Marcado em {format(new Date(crmLead.contact.opted_out_at), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}
                            </p>
                          )}
                        </div>
                      </div>
                      <Switch
                        checked={!!crmLead.contact?.opted_out}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setIsOptOutConfirmOpen(true);
                          } else {
                            updateOptedOut.mutate(false);
                          }
                        }}
                        disabled={updateOptedOut.isPending}
                      />
                    </div>
                    <AlertDialog open={isOptOutConfirmOpen} onOpenChange={setIsOptOutConfirmOpen}>
                      <AlertDialogContent className="glass-card border-border">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Marcar como "não deseja receber contato"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Este contato deixará de receber qualquer interação automática (WhatsApp, IA e cadências). Você poderá reverter a qualquer momento.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => {
                              setIsOptOutConfirmOpen(false);
                              updateOptedOut.mutate(true);
                            }}
                          >
                            Confirmar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>





                  {crmLead.description && (
                    <div className="bg-background/50 rounded-lg p-3">
                      <span className="text-[10px] text-muted-foreground uppercase">Descrição</span>
                      <p className="text-sm text-foreground mt-1">{crmLead.description}</p>
                    </div>
                  )}

                </LeadSection>
              </div>

              {/* Coluna 2 - Histórico operacional */}
              <div className="min-w-0 p-4 space-y-5 xl:h-full xl:min-h-0 xl:overflow-y-auto scrollbar-thin border-b lg:border-b xl:border-b-0 xl:border-r border-border">
                {/* DNIA Psychology Section */}
                <DNIAExpanded
                  psychology={psychology}
                  leadId={crmLead.id}
                  workspaceId={workspaceId}
                />

                <Separator />

                {/* Régua */}
                <LeadCadencesSection leadId={crmLead.id} />

                <Separator />

                {/* Activities */}
                <LeadActivities 
                  leadId={crmLead.id} 
                  workspaceId={workspaceId}
                  stages={stages}
                  lossReasons={lossReasons}
                  initialActivityId={initialActivityId ?? null}
                  onMoveLead={(stageId, reason) => {
                    if (!leadId) return;
                    supabase
                      .from("crm_leads")
                      .update({ stage_id: stageId, moved_at: new Date().toISOString() })
                      .eq("id", leadId)
                      .then(() => {
                        supabase.from("crm_lead_history").insert({
                          lead_id: leadId,
                          from_stage_id: crmLead.stage_id,
                          to_stage_id: stageId,
                          moved_by: "user",
                          reason: reason || "Avançado via atividade",
                        });
                        queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
                        queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
                      });
                  }}
                  onMarkLost={(lossReasonId) => {
                    if (!leadId) return;
                    supabase
                      .from("crm_leads")
                      .update({ 
                        status: "lost", 
                        closed_at: new Date().toISOString(),
                        loss_reason_id: lossReasonId 
                      })
                      .eq("id", leadId)
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
                        queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
                        toast({ title: "Lead marcado como perdido" });
                      });
                  }}
                />

                <Separator />

                {/* Tempo por etapa */}
                <StageDurationTimeline leadId={crmLead.id} stages={stages} />
              </div>

              {/* Coluna 3 - IA e conversa */}
              <div className="min-w-0 p-4 space-y-5 xl:h-full xl:min-h-0 xl:overflow-y-auto scrollbar-thin">
                {/* Notes and Updates */}
                <LeadNotes leadId={crmLead.id} />

                <Separator />

                {/* AI Insights */}
                {originalLead?.insights && (
                  <>
                    <LeadInsights 
                      insights={originalLead.insights} 
                      status={originalLead.status} 
                    />
                    <Separator />
                  </>
                )}

                {/* AI Summary */}
                {originalLead?.ai_summary && (
                  <>
                    <LeadSection icon={Sparkles} title="Resumo da IA">
                      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                        <p className="text-xs text-foreground whitespace-pre-wrap">
                          {originalLead.ai_summary}
                        </p>
                      </div>
                    </LeadSection>
                    <Separator />
                  </>
                )}

                {/* Conversation History */}
                <LeadConversation leadId={crmLead.contact?.lead_id || null} />
              </div>
            </div>
          </>
        )}
      </SheetContent>

      {/* Confirmação de exclusão (acionada pelo menu de contexto) */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O lead será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteLead.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Loss Dialog */}
      <Dialog open={isLossDialogOpen} onOpenChange={setIsLossDialogOpen}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle>Registrar Perda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Motivo da Perda *</Label>
              <Select value={selectedLossReason} onValueChange={setSelectedLossReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {lossReasons.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lossReasons.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum motivo cadastrado. Configure em CRM &gt; Motivos de Perda.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsLossDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={() => markAsLost.mutate()}
                disabled={!selectedLossReason || markAsLost.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Confirmar Perda
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="glass-card border-border sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 pt-4">
            {/* Contact Section */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-primary uppercase tracking-wider">
                Dados do Contato
              </h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome *</Label>
                  <Input
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    placeholder="Nome do contato"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Telefone</Label>
                    <Input
                      value={editData.phone}
                      onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email</Label>
                    <Input
                      type="email"
                      value={editData.email}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      placeholder="email@exemplo.com"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Empresa</Label>
                    <Input
                      value={editData.company}
                      onChange={(e) => setEditData({ ...editData, company: e.target.value })}
                      placeholder="Nome da empresa"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cargo</Label>
                    <Input
                      value={editData.job_title}
                      onChange={(e) => setEditData({ ...editData, job_title: e.target.value })}
                      placeholder="Cargo do contato"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tamanho da Empresa</Label>
                    <Select
                      value={editData.employee_count}
                      onValueChange={(value) => setEditData({ ...editData, employee_count: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {EMPLOYEE_COUNT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Faturamento</Label>
                    <Select
                      value={editData.revenue}
                      onValueChange={(value) => setEditData({ ...editData, revenue: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {REVENUE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Origem</Label>
                  <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/30">
                    {crmLead?.contact?.source ? (
                      <Badge variant="secondary" className="text-xs">{crmLead.contact.source}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem origem</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">Definida no cadastro · não editável</span>
                  </div>
                </div>
              </div>
            </div>



            {/* Business Section */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-primary uppercase tracking-wider">
                Dados do Negócio
              </h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Titulo do Lead</Label>
                  <Input
                    value={editData.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    placeholder="Ex: Proposta Comercial"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Descrição</Label>
                  <Textarea
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    placeholder="Observações sobre o lead..."
                    className="min-h-[80px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input
                    type="number"
                    value={editData.value}
                    onChange={(e) => setEditData({ ...editData, value: e.target.value })}
                    placeholder="0"
                    className="font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Produto</Label>
                    <Select
                      value={editData.product_id}
                      onValueChange={(value) => setEditData({ ...editData, product_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Responsável</Label>
                    <Select
                      value={editData.assigned_to}
                      disabled={!isAdmin}
                      onValueChange={(value) => setEditData({ ...editData, assigned_to: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Estágio</Label>
                  <Select
                    value={editData.stage_id}
                    onValueChange={(value) => setEditData({ ...editData, stage_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {getAdjacentStages(stages, crmLead?.stage_id || editData.stage_id).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-2 h-2 rounded-full" 
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveEdit} disabled={updateLead.isPending}>
                {updateLead.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar Alterações
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reopen Lead Dialog */}
      <Dialog open={isReopenDialogOpen} onOpenChange={setIsReopenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reabrir Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecione o estágio para onde o lead deve voltar:
            </p>
            <Select value={selectedReopenStage} onValueChange={setSelectedReopenStage}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um estágio" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsReopenDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={() => reopenLead.mutate()} 
                disabled={!selectedReopenStage || reopenLead.isPending}
              >
                {reopenLead.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reabrir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Lead Dialog */}
      <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Transferir para</Label>
              <Select
                value={selectedTransferMember}
                onValueChange={setSelectedTransferMember}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um membro" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.id !== crmLead?.assigned_to)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Textarea
                placeholder="Ex: Cliente solicitou outro vendedor"
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsTransferDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={handleTransfer} 
                disabled={!selectedTransferMember || isTransferring}
              >
                {isTransferring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Transferir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
