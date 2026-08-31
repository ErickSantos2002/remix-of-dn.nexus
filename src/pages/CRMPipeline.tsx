import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { canMoveToStage } from "@/lib/pipelineValidation";
import { useWorkspaceTags } from "@/hooks/useWorkspaceTags";
import { parseTags } from "@/types/tags";
import { PipelineAdvancedFilters } from "@/components/crm/PipelineAdvancedFilters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Settings, GripVertical, User, DollarSign, TrendingUp, Flame, ThermometerSun, Sun, Snowflake, Building2, SlidersHorizontal, X, Search, Tag, CalendarIcon, Info, Send, ArrowUpDown, Clock, Download, BellOff, Target } from "lucide-react";
import { usePipelineExport } from "@/hooks/usePipelineExport";
import { Separator } from "@/components/ui/separator";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Progress } from "@/components/ui/progress";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners, pointerWithin, rectIntersection, PointerSensor, useSensor, useSensors, useDroppable, CollisionDetection } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LeadDetailSheet } from "@/components/crm/LeadDetailSheet";
import { DNIABadge } from "@/components/crm/DNIABadge";
import { ContactTagList } from "@/components/crm/tags/ContactTagList";
import { NewLeadDialog } from "@/components/crm/NewLeadDialog";
import { cn } from "@/lib/utils";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { formatStageDuration, stageElapsedSeconds, stageBadgeTone } from "@/lib/stageDuration";

interface PipelineFilters {
  status: string;
  product: string; // legacy (mantido para retrocompat. na persistência)
  assignee: string; // legacy
  products: string[];
  assignees: string[];
  tags: string[];
  search: string;
  sortOrder: string;
  createdFrom?: string;
  createdTo?: string;
  positions: string[];
  employeeCounts: string[];
  revenues: string[];
  sources: string[];
  stages: string[];
  optedOut: "all" | "yes" | "no";
}

const defaultPipelineFilters: PipelineFilters = {
  status: "all",
  product: "all",
  assignee: "all",
  products: [],
  assignees: [],
  tags: [],
  search: "",
  sortOrder: "recent",
  createdFrom: undefined,
  createdTo: undefined,
  positions: [],
  employeeCounts: [],
  revenues: [],
  sources: [],
  stages: [],
  optedOut: "all",
};


const EMPTY_LEADS: Lead[] = [];

// Estratégia de colisão híbrida: pointerWithin é robusto com listas virtualizadas
// (usa posição do cursor, não geometria dos itens). Cai para rectIntersection
// quando o cursor está entre colunas, para ainda destacar a coluna mais próxima.
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
  warning_after_hours?: number | null;
  danger_after_hours?: number | null;
}


interface LeadPsychology {
  dna_code: string | null;
  temperatura: string | null;
  propensity_score: number | null;
  risk_score?: number | null;
  opportunity_score?: number | null;
  dimension_intencao: number | null;
}

interface Lead {
  id: string;
  title: string | null;
  description?: string | null;
  value: number;
  stage_id: string;
  contact_id: string;
  status: string | null;
  is_icp?: boolean | null;
  product_id: string | null;
  assigned_to: string | null;
  segment_id?: string | null;
  created_at: string | null;
  created_by?: string | null;
  moved_at: string | null;
  closed_at: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  contact?: {
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    tags?: unknown;
    position?: string | null;
    job_title?: string | null;
    employee_count?: string | null;
    revenue?: string | null;
    source?: string | null;
    scheduling_blocked?: boolean | null;
    opted_out?: boolean | null;
    opted_out_at?: string | null;
  } | null;
  psychology?: LeadPsychology | null;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

interface WorkspaceMember {
  user_id: string;
  profile: {
    name: string | null;
    email: string | null;
  } | null;
}

// Temperature config - same as DNIABadge
const temperatureConfig: Record<string, { 
  label: string; 
  fullLabel: string;
  icon: React.ElementType; 
  colorClass: string;
  badgeClass: string;
}> = {
  muito_quente: {
    label: "MQ",
    fullLabel: "Muito Quente",
    icon: Flame,
    colorClass: "text-destructive",
    badgeClass: "bg-destructive/20 text-destructive border-destructive/30"
  },
  quente: {
    label: "Q",
    fullLabel: "Quente",
    icon: ThermometerSun,
    colorClass: "text-warning",
    badgeClass: "bg-warning/20 text-warning border-warning/30"
  },
  morno: {
    label: "M",
    fullLabel: "Morno",
    icon: Sun,
    colorClass: "text-warning",
    badgeClass: "bg-warning/20 text-warning border-warning/30"
  },
  frio: {
    label: "F",
    fullLabel: "Frio",
    icon: Snowflake,
    colorClass: "text-primary",
    badgeClass: "bg-primary/20 text-primary border-primary/30"
  },
};

const StageDurationBadge = memo(function StageDurationBadge({
  movedAt,
  status,
  closedAt,
  warningAfterHours,
  dangerAfterHours,
}: {
  movedAt: string | null;
  status: string | null;
  closedAt: string | null;
  warningAfterHours?: number;
  dangerAfterHours?: number;
}) {
  const isClosed = status === "won" || status === "lost";
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isClosed) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isClosed]);

  if (!movedAt) return null;
  const seconds = stageElapsedSeconds(movedAt, status, closedAt);
  const tone = stageBadgeTone(seconds, status, warningAfterHours, dangerAfterHours);
  const toneClass =
    tone === "danger"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : tone === "warning"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-muted/40 text-muted-foreground border-border";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0 h-5 rounded-md border text-[10px] font-mono leading-none shrink-0",
        toneClass
      )}
      title={isClosed ? "Tempo final na etapa" : "Tempo nesta etapa"}
    >
      <Clock className="h-3 w-3" />
      {formatStageDuration(seconds)}
    </span>
  );
});


const LeadCard = memo(function LeadCard({
  lead, 
  isActive,
  products,
  members,
  hasNoFutureAppointment,
  warningAfterHours,
  dangerAfterHours,
  onOpenDetails 
}: { 
  lead: Lead; 
  isActive?: boolean;
  products: Product[];
  members: WorkspaceMember[];
  hasNoFutureAppointment?: boolean;
  warningAfterHours?: number;
  dangerAfterHours?: number;
  onOpenDetails: (lead: Lead) => void;
}) {

  const { toast } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: "lead", lead },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const tempConfig = lead.psychology?.temperatura 
    ? temperatureConfig[lead.psychology.temperatura] 
    : null;
  
  const TempIcon = tempConfig?.icon;
  const propensityScore = lead.psychology?.propensity_score;

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    onOpenDetails(lead);
  };

  const handleSendToDnMarketing = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!lead.contact_id) return;

    supabase.functions.invoke("dnmarketing-notify", {
      body: {
        contact_id: lead.contact_id,
        event_type: "sync_manual",
        title: `Sincronização manual do lead: ${lead.title || lead.contact?.name || "Sem título"}`,
        metadata: {
          lead_id: lead.id,
          source: "pipeline_card",
        },
      },
    });

    toast({
      title: "Contato enviado",
      description: "Sincronização com dnMarketing iniciada.",
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={cn(
        "glass-card p-3 cursor-grab active:cursor-grabbing transition-all duration-200 relative group",
        "hover:border-primary/30",
        isActive && "ring-2 ring-primary shadow-[0_0_15px_rgba(255,128,0,0.4)] z-50",
        hasNoFutureAppointment && "border-destructive/60 border shadow-[inset_0_0_12px_-4px_hsl(var(--destructive)/0.4),0_0_16px_-4px_hsl(var(--destructive)/0.35)]"
      )}
    >
      {/* Tempo na etapa - canto superior direito */}
      <div className="absolute top-1.5 right-1.5 z-10">
        <StageDurationBadge
          movedAt={lead.moved_at || lead.created_at}
          status={lead.status}
          closedAt={lead.closed_at}
          warningAfterHours={warningAfterHours}
          dangerAfterHours={dangerAfterHours}
        />

      </div>

      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        
        <div className="flex-1 min-w-0">
          {/* Header with title and temperature badge */}
          <div className="flex items-start justify-between gap-2 pr-14">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <p className="font-display font-medium text-sm text-foreground truncate">
                {lead.title || lead.contact?.name || "Sem titulo"}
              </p>
              {lead.is_icp === true && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0 h-4 rounded-full text-[9px] bg-primary/10 text-primary border border-primary/30 shrink-0"
                  title="Perfil de cliente ideal (ICP)"
                >
                  <Target className="h-2.5 w-2.5" />
                </span>
              )}
              {lead.contact?.opted_out && (
                <span
                  className="inline-flex items-center gap-0.5 px-1 py-0 h-4 rounded-full text-[9px] bg-destructive/10 text-destructive border border-destructive/30 shrink-0"
                  title="Contato pediu para nao receber mais interacoes"
                >
                  <BellOff className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            {tempConfig && TempIcon && (
              <Badge 
                variant="outline" 
                className={cn("gap-1 px-1.5 py-0 h-5 text-[10px] shrink-0", tempConfig.badgeClass)}
              >
                <TempIcon className="h-3 w-3" />
                <span>{tempConfig.fullLabel}</span>
              </Badge>
            )}
          </div>
          
          {/* Empresa - sempre mostrar se existir */}
          {lead.contact?.company && (
            <div className="flex items-center gap-1 mt-1">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">
                {lead.contact.company}
              </span>
            </div>
          )}
          
          {/* Contato - mostrar apenas se titulo existir E for diferente do nome */}
          {lead.contact && lead.title && lead.title !== lead.contact.name && (
            <div className="flex items-center gap-1 mt-1">
              <User className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">
                {lead.contact.name}
              </span>
            </div>
          )}
          {lead.value > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <DollarSign className="h-3 w-3 text-primary" />
              <span className="text-xs font-mono text-primary">
                R$ {lead.value.toLocaleString("pt-BR")}
              </span>
            </div>
          )}
          
          {/* Product Tag */}
          {lead.product_id && (
            <div className="flex items-center gap-1 mt-1">
              <Badge 
                variant="outline" 
                className="text-[10px] px-1.5 py-0 h-5 bg-primary/10 border-primary/30 text-primary"
              >
                {products.find(p => p.id === lead.product_id)?.name || "Produto"}
              </Badge>
            </div>
          )}

          {/* Contact Tags */}
          {lead.contact?.tags && parseTags(lead.contact.tags).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              <ContactTagList
                tags={parseTags(lead.contact.tags)}
                maxVisible={3}
                size="sm"
              />
            </div>
          )}

          {/* UTM Badges */}
          {(lead.utm_source || lead.utm_medium || lead.utm_campaign) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {lead.utm_source && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-primary/10 border-primary/30 text-primary">
                  {lead.utm_source}
                </Badge>
              )}
              {lead.utm_medium && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-series-4/10 border-series-4/30 text-series-4">
                  {lead.utm_medium}
                </Badge>
              )}
              {lead.utm_campaign && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-success/10 border-success/30 text-success">
                  {lead.utm_campaign}
                </Badge>
              )}
            </div>
          )}
          
          {/* Responsavel */}
          {lead.assigned_to && (
            <div className="flex items-center gap-1 mt-1">
              <User className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">
                {members.find(m => m.user_id === lead.assigned_to)?.profile?.name || "Sem atribuicao"}
              </span>
            </div>
          )}
          
          {/* DNIA Metrics - Purchase Intent */}
          {lead.psychology && (propensityScore !== null && propensityScore !== undefined) && (
            <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
              {/* Purchase Intent - same as LeadInsights */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Propensao
                  </span>
                  <span className={cn(
                    "text-xs font-mono font-semibold",
                    propensityScore >= 70 ? "text-success" :
                    propensityScore >= 40 ? "text-warning" : "text-destructive"
                  )}>
                    {propensityScore}%
                  </span>
                </div>
                <Progress 
                  value={propensityScore} 
                  className="h-1"
                />
              </div>
              
              {/* DNA Code + dnMarketing sync */}
              {lead.psychology.dna_code && (
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                    {lead.psychology.dna_code}
                  </div>
                  <button
                    onClick={handleSendToDnMarketing}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="shrink-0 p-1 rounded-md bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all"
                    title="Enviar para dnMarketing"
                  >
                    <Send className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* dnMarketing sync (fallback when no DNA code) */}
          {!lead.psychology?.dna_code && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleSendToDnMarketing}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1 rounded-md bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all"
                title="Enviar para dnMarketing"
              >
                <Send className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  // re-render apenas quando algo relevante muda
  const a = prev.lead, b = next.lead;
  return (
    a.id === b.id &&
    a.stage_id === b.stage_id &&
    a.moved_at === b.moved_at &&
    a.closed_at === b.closed_at &&
    a.status === b.status &&
    a.value === b.value &&
    a.assigned_to === b.assigned_to &&
    a.product_id === b.product_id &&
    a.title === b.title &&
    a.contact?.name === b.contact?.name &&
    a.contact?.company === b.contact?.company &&
    a.contact?.tags === b.contact?.tags &&
    a.contact?.opted_out === b.contact?.opted_out &&
    a.psychology?.propensity_score === b.psychology?.propensity_score &&
    a.psychology?.temperatura === b.psychology?.temperatura &&
    a.psychology?.dna_code === b.psychology?.dna_code &&
    prev.isActive === next.isActive &&
    prev.hasNoFutureAppointment === next.hasNoFutureAppointment &&
    prev.products === next.products &&
    prev.members === next.members &&
    prev.onOpenDetails === next.onOpenDetails
  );
});

function StageColumn({ 
  stage, 
  stageLeads,
  activeId,
  products,
  members,
  leadsWithFutureMeeting,
  onOpenDetails 
}: { 
  stage: Stage; 
  stageLeads: Lead[];
  activeId: string | null;
  products: Product[];
  members: WorkspaceMember[];
  leadsWithFutureMeeting: Set<string>;
  onOpenDetails: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage.id}`,
    data: { type: "stage", stageId: stage.id },
  });

  const totalValue = useMemo(
    () => stageLeads.reduce((sum, l) => sum + (l.value || 0), 0),
    [stageLeads]
  );

  const itemIds = useMemo(() => stageLeads.map((l) => l.id), [stageLeads]);

  const isMeetingStage = useMemo(() => {
    const n = stage.name.toLowerCase();
    return n.includes("reunião agendada") || n.includes("reuniao agendada");
  }, [stage.name]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: stageLeads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (index) => stageLeads[index]?.id ?? index,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="flex-shrink-0 w-72">
      <div 
        ref={setNodeRef}
        className={cn(
          "glass-card-glow h-full flex flex-col transition-all duration-200",
          isOver && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        style={{ borderTopColor: stage.color, borderTopWidth: "3px" }}
      >
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-sm text-foreground truncate">{stage.name}</h3>
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {stageLeads.length}
            </Badge>
          </div>
          {totalValue > 0 && (
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <span className="text-xs text-muted-foreground">Total na etapa:</span>
              <span className="text-xs font-mono font-semibold text-primary/80">
                R$ {totalValue.toLocaleString("pt-BR")}
              </span>
            </div>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-[200px]">
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {stageLeads.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs">
                Arraste leads aqui
              </div>
            ) : (
              <div className="relative px-2 pt-2" style={{ height: totalSize }}>
                {virtualItems.map((vi) => {
                  const lead = stageLeads[vi.index];
                  if (!lead) return null;
                  const hasNoFutureAppointment = isMeetingStage && !leadsWithFutureMeeting.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: vi.start,
                        left: 0,
                        right: 0,
                        padding: "0 8px 8px 8px",
                      }}
                    >
                      <LeadCard 
                        lead={lead} 
                        isActive={lead.id === activeId}
                        products={products}
                        members={members}
                        hasNoFutureAppointment={hasNoFutureAppointment}
                        warningAfterHours={stage.warning_after_hours ?? undefined}
                        dangerAfterHours={stage.danger_after_hours ?? undefined}
                        onOpenDetails={onOpenDetails}
                      />

                    </div>
                  );
                })}
              </div>
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}

export default function CRMPipeline() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [initialActivityId, setInitialActivityId] = useState<string | null>(null);
  
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Filters (persisted per user + workspace)
  const [pipelineFilters, setPipelineFilters, resetPipelineFilters] = usePersistedFilters<PipelineFilters>(
    "crm-pipeline",
    defaultPipelineFilters,
    currentWorkspace?.id ?? null,
  );
  const { status: filterStatus,
    products: filterProducts, assignees: filterAssignees,
    tags: filterTags, search: searchQuery, sortOrder,
    createdFrom: filterCreatedFrom, createdTo: filterCreatedTo,
    positions: filterPositions, employeeCounts: filterEmployeeCounts,
    revenues: filterRevenues, sources: filterSources,
    stages: filterStages, optedOut: filterOptedOut } = pipelineFilters;

  const makeSetter = <K extends keyof PipelineFilters>(key: K) =>
    (v: PipelineFilters[K] | ((prev: PipelineFilters[K]) => PipelineFilters[K])) =>
      setPipelineFilters(prev => ({
        ...prev,
        [key]: typeof v === "function" ? (v as (p: PipelineFilters[K]) => PipelineFilters[K])(prev[key]) : v,
      }));

  const setFilterStatus = makeSetter("status");
  const setFilterTags = makeSetter("tags");
  const setSearchQuery = makeSetter("search");
  const setSortOrder = makeSetter("sortOrder");
  const setFilterCreatedFrom = makeSetter("createdFrom");
  const setFilterCreatedTo = makeSetter("createdTo");


  // Tags do workspace para o filtro
  const { data: workspaceTags = [] } = useWorkspaceTags(currentWorkspace?.id);

  // Auto-open lead from query param
  useEffect(() => {
    const leadParam = searchParams.get("lead");
    const activityParam = searchParams.get("activity");
    if (leadParam) {
      setSelectedLeadId(leadParam);
      setInitialActivityId(activityParam);
      setIsDetailOpen(true);
    }
  }, [searchParams]);
  

  // Get current user ID on mount
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    };
    fetchUser();
  }, []);


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Fetch stages
  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ["crm-stages", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("order", { ascending: true });
      if (error) throw error;
      return data as Stage[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Create default stages if none exist
  useEffect(() => {
    const createDefaultStages = async () => {
      if (!currentWorkspace?.id || stagesLoading || stages.length > 0) return;
      
      const defaultStages = [
        { name: "Lead", color: "#FF8000", order: 0 },
        { name: "Qualificado", color: "#4A9EFF", order: 1 },
        { name: "Proposta", color: "#9B59B6", order: 2 },
        { name: "Negociacao", color: "#F39C12", order: 3 },
        { name: "Fechado", color: "#27AE60", order: 4 },
      ];

      for (const stage of defaultStages) {
        await supabase.from("crm_pipeline_stages").insert({
          workspace_id: currentWorkspace.id,
          name: stage.name,
          color: stage.color,
          order: stage.order,
          is_default: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["crm-stages"] });
    };

    createDefaultStages();
  }, [currentWorkspace?.id, stages.length, stagesLoading, queryClient]);

  // Fetch leads with contacts (paginated to bypass Supabase 1000 row limit)
  const { data: leads = [] } = useQuery({
    queryKey: ["crm-leads", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const PAGE = 1000;
      const all: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("crm_leads")
          .select(`
            *,
            contact:crm_contacts(name, phone, email, company, tags, position, job_title, employee_count, revenue, source, scheduling_blocked, opted_out, opted_out_at),
            psychology:crm_lead_psychology(dna_code, temperatura, propensity_score, risk_score, opportunity_score, dimension_intencao)
          `)
          .eq("workspace_id", currentWorkspace.id)
          .is("deleted_at", null)
          .order("position", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      // Map psychology - it's a direct object from the query, not an array
      const mappedLeads = all.map(lead => ({
        ...lead,
        psychology: lead.psychology || null
      })) as Lead[];

      return mappedLeads;
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["crm-products", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_products")
        .select("id, name, price")
        .eq("workspace_id", currentWorkspace.id)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch workspace members
  const { companyId } = useCompany();
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members-expanded", currentWorkspace?.id, companyId],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const membersMap = new Map<string, WorkspaceMember>();

      // 1. Workspace members
      const { data: wsMembers } = await supabase
        .from("workspace_members")
        .select("user_id, profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", currentWorkspace.id)
        .eq("status", "active");
      (wsMembers || []).forEach(m => {
        if (m.user_id && !membersMap.has(m.user_id)) {
          membersMap.set(m.user_id, { user_id: m.user_id, profile: m.profiles || null });
        }
      });

      // 2. Workspace owner
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("owner_id")
        .eq("id", currentWorkspace.id)
        .single();
      if (wsData?.owner_id && !membersMap.has(wsData.owner_id)) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", wsData.owner_id)
          .single();
        membersMap.set(wsData.owner_id, { user_id: wsData.owner_id, profile: ownerProfile || null });
      }

      // 3. Company admins/super_admins
      if (companyId) {
        const { data: admins } = await supabase
          .from("company_members")
          .select("user_id, profiles:user_id(name, email)")
          .eq("company_id", companyId)
          .eq("status", "active")
          .in("role", ["admin", "super_admin"]);
        type AdminRow = {
          user_id: string | null;
          profiles: { name: string | null; email: string | null } | null;
        };
        ((admins || []) as unknown as AdminRow[]).forEach((a) => {
          if (a.user_id && !membersMap.has(a.user_id)) {
            membersMap.set(a.user_id, { user_id: a.user_id, profile: a.profiles || null });
          }
        });
      }

      return Array.from(membersMap.values());
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch future appointments for meeting stage highlight
  const { data: futureAppointments = [] } = useQuery({
    queryKey: ["crm-future-appointments", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_appointments")
        .select("lead_id")
        .eq("workspace_id", currentWorkspace.id)
        .gt("end_time", new Date().toISOString())
        .in("status", ["scheduled", "confirmed"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentWorkspace?.id,
  });

  const leadsWithFutureMeeting = useMemo(
    () => new Set(futureAppointments.map(a => a.lead_id)),
    [futureAppointments]
  );

  const { data: contacts = [] } = useQuery({
    queryKey: ["crm-contacts", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .neq("is_active", false)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Update lead stage mutation with optimistic update
  const updateLeadStage = useMutation({
    mutationFn: async ({ leadId, stageId, fromStageId }: { leadId: string; stageId: string; fromStageId: string }) => {
      const { error } = await supabase
        .from("crm_leads")
        .update({ stage_id: stageId, moved_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;

      // Register history
      await supabase.from("crm_lead_history").insert({
        lead_id: leadId,
        from_stage_id: fromStageId,
        to_stage_id: stageId,
        moved_by: "user",
        reason: "stage_change",
      });
    },
    onMutate: async ({ leadId, stageId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["crm-leads", currentWorkspace?.id] });
      
      // Snapshot the previous value
      const previousLeads = queryClient.getQueryData<Lead[]>(["crm-leads", currentWorkspace?.id]);
      
      // Optimistically update to the new value
      queryClient.setQueryData<Lead[]>(["crm-leads", currentWorkspace?.id], (old) =>
        old?.map(lead => 
          lead.id === leadId ? { ...lead, stage_id: stageId } : lead
        ) || []
      );
      
      return { previousLeads };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousLeads) {
        queryClient.setQueryData(["crm-leads", currentWorkspace?.id], context.previousLeads);
      }
      toast({
        variant: "destructive",
        title: "Erro ao mover lead",
        description: "Tente novamente.",
      });
    },
    onSuccess: (_data, variables) => {
      // Fire-and-forget: notify dnMarketing about stage move
      const lead = leads.find((l) => l.id === variables.leadId);
      const targetStage = stages.find((s) => s.id === variables.stageId);
      if (lead?.contact_id) {
        supabase.functions.invoke("dnmarketing-notify", {
          body: {
            contact_id: lead.contact_id,
            event_type: "deal_moved",
            title: `Oportunidade movida para ${targetStage?.name || "etapa"}`,
            metadata: {
              lead_id: variables.leadId,
              stage_name: targetStage?.name,
              stage_id: variables.stageId,
              from_stage_id: variables.fromStageId,
              value: lead.value,
            },
          },
        });
        // Status sync to dnMarketing is handled by DB trigger notify_dnmarketing_on_stage_change
      }
    },
    onSettled: () => {
      // Sync with server after mutation settles
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const draggedLead = leads.find((l) => l.id === active.id);
    if (!draggedLead) return;

    let targetStageId: string | null = null;
    const overId = over.id as string;

    // Check if dropped over a stage column
    if (overId.startsWith("stage-")) {
      targetStageId = overId.replace("stage-", "");
    } else {
      // Dropped over a lead - get that lead's stage
      const overLead = leads.find((l) => l.id === overId);
      if (overLead) {
        targetStageId = overLead.stage_id;
      }
    }

    if (targetStageId && targetStageId !== draggedLead.stage_id) {
      const currentStage = stages.find((s) => s.id === draggedLead.stage_id);
      const targetStage = stages.find((s) => s.id === targetStageId);

      if (currentStage && targetStage && !canMoveToStage(currentStage.order, targetStage.order)) {
        toast({
          variant: "destructive",
          title: "Mova o lead apenas uma etapa por vez",
          description: `De "${currentStage.name}" voce so pode ir para a etapa anterior ou proxima.`,
        });
        return;
      }

      updateLeadStage.mutate({
        leadId: draggedLead.id,
        stageId: targetStageId,
        fromStageId: draggedLead.stage_id,
      });
    }
  };

  const handleOpenDetails = useCallback((lead: Lead) => {
    setSelectedLeadId(lead.id);
    setIsDetailOpen(true);
    setSearchParams({ lead: lead.id }, { replace: true });
  }, [setSearchParams]);

  // Filter leads
  const GENERIC_NAMES = ['Visitante Widget', 'Visitante', 'Contato', 'Anônimo', 'Lead'];
  const filteredLeads = leads.filter(lead => {
    // Gate: hide leads sem nome. Leads criados manualmente por um usuario sempre aparecem,
    // mesmo sem e-mail/telefone; o gate de canal vale apenas para leads automaticos (widget/chat).
    if (!lead.contact?.name) return false;
    const isManual = !!lead.created_by;
    if (!isManual && !lead.contact?.email && !lead.contact?.phone) return false;
    if (!isManual && GENERIC_NAMES.includes(lead.contact.name)) return false;

    // Por padrao (all ou open), esconder leads perdidos
    if (filterStatus === "all" || filterStatus === "open") {
      if (lead.status === "lost") return false;
      // Se for "open", filtrar apenas abertos
      if (filterStatus === "open" && lead.status !== "open") return false;
    } else if (filterStatus !== "all" && lead.status !== filterStatus) {
      // Se filtro especifico (won ou lost), mostrar apenas esses
      return false;
    }
    if (filterStages.length > 0 && !filterStages.includes(lead.stage_id)) return false;
    if (filterProducts.length > 0 && !filterProducts.includes(lead.product_id || "")) return false;
    if (filterAssignees.length > 0) {
      const hasValidAssignee = lead.assigned_to && members.some(m => m.user_id === lead.assigned_to);
      const key = hasValidAssignee ? (lead.assigned_to as string) : "unassigned";
      if (!filterAssignees.includes(key)) return false;
    }

    
    // Search filter (case-insensitive, accent-insensitive)
    if (searchQuery.trim()) {
      const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const query = normalize(searchQuery.trim());
      const matchesTitle = lead.title ? normalize(lead.title).includes(query) : false;
      const matchesName = lead.contact?.name ? normalize(lead.contact.name).includes(query) : false;
      const matchesCompany = lead.contact?.company ? normalize(lead.contact.company).includes(query) : false;
      const matchesPhone = lead.contact?.phone?.includes(query);
      const matchesEmail = lead.contact?.email ? normalize(lead.contact.email).includes(query) : false;

      if (!matchesTitle && !matchesName && !matchesCompany && !matchesPhone && !matchesEmail) {
        return false;
      }
    }

    // Tags filter
    if (filterTags.length > 0) {
      const leadTags = parseTags(lead.contact?.tags);
      const hasMatch = filterTags.some(tag =>
        leadTags.some(lt => lt.name.toLowerCase() === tag.toLowerCase())
      );
      if (!hasMatch) return false;
    }

    // Created date range filter (Brazil timezone UTC-3)
    if (filterCreatedFrom || filterCreatedTo) {
      if (!lead.created_at) return false;
      const ts = new Date(lead.created_at).getTime();
      if (filterCreatedFrom &&
          ts < new Date(`${filterCreatedFrom}T00:00:00-03:00`).getTime()) return false;
      if (filterCreatedTo &&
          ts > new Date(`${filterCreatedTo}T23:59:59.999-03:00`).getTime()) return false;
    }

    // Advanced filters (contato)
    if (filterPositions.length > 0) {
      const pos = (lead.contact?.position || lead.contact?.job_title || "").trim();
      if (!pos || !filterPositions.includes(pos)) return false;
    }
    if (filterEmployeeCounts.length > 0) {
      const ec = (lead.contact?.employee_count || "").trim();
      if (!ec || !filterEmployeeCounts.includes(ec)) return false;
    }
    if (filterRevenues.length > 0) {
      const rev = (lead.contact?.revenue || "").trim();
      if (!rev || !filterRevenues.includes(rev)) return false;
    }
    if (filterSources.length > 0) {
      const src = (lead.contact?.source || "").trim();
      if (!src || !filterSources.includes(src)) return false;
    }

    if (filterOptedOut === "yes" && lead.contact?.opted_out) return false;
    if (filterOptedOut === "no" && !lead.contact?.opted_out) return false;

    return true;
  });

  // Sort filtered leads
  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      switch (sortOrder) {
        case "recent":
          return (b.created_at || "").localeCompare(a.created_at || "");
        case "oldest":
          return (a.created_at || "").localeCompare(b.created_at || "");
        case "moved":
          return (b.moved_at || "0").localeCompare(a.moved_at || "0");
        case "value_high":
          return (b.value || 0) - (a.value || 0);
        case "value_low":
          return (a.value || 0) - (b.value || 0);
        case "name":
          return (a.contact?.name || "").localeCompare(b.contact?.name || "", "pt-BR");
        default:
          return 0;
      }
    });
  }, [filteredLeads, sortOrder]);

  const { exportToCsv } = usePipelineExport();

  // Agrupa por stage uma única vez para evitar N filter() por etapa a cada render
  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const lead of sortedLeads) {
      const arr = map.get(lead.stage_id);
      if (arr) arr.push(lead);
      else map.set(lead.stage_id, [lead]);
    }
    return map;
  }, [sortedLeads]);

  // Hidden leads breakdown — quando há filtro de datas ativo, calcula quantos leads
  // dentro do intervalo NÃO aparecem no pipeline (perdidos, sem contato, nome genérico).
  // Ajuda o usuário a entender por que a contagem diverge de outras telas (ex.: Cohort).
  const hiddenBreakdown = useMemo(() => {
    if (!filterCreatedFrom && !filterCreatedTo) return null;
    const fromTs = filterCreatedFrom ? new Date(`${filterCreatedFrom}T00:00:00-03:00`).getTime() : -Infinity;
    const toTs = filterCreatedTo ? new Date(`${filterCreatedTo}T23:59:59.999-03:00`).getTime() : Infinity;
    let totalInRange = 0;
    let lostHidden = 0;
    let incompleteContact = 0;
    let genericName = 0;
    for (const lead of leads) {
      if (!lead.created_at) continue;
      const ts = new Date(lead.created_at).getTime();
      if (ts < fromTs || ts > toTs) continue;
      totalInRange += 1;
      const name = lead.contact?.name;
      const hasChannel = !!(lead.contact?.email || lead.contact?.phone);
      if (!name || !hasChannel) { incompleteContact += 1; continue; }
      if (GENERIC_NAMES.includes(name)) { genericName += 1; continue; }
      if ((filterStatus === "all" || filterStatus === "open") && lead.status === "lost") { lostHidden += 1; continue; }
    }
    const hidden = lostHidden + incompleteContact + genericName;
    return { totalInRange, hidden, lostHidden, incompleteContact, genericName };
  }, [leads, filterCreatedFrom, filterCreatedTo, filterStatus]);

  const advancedFilterValues = useMemo(() => ({
    stages: filterStages,
    products: filterProducts,
    assignees: filterAssignees,
    tags: filterTags,
    positions: filterPositions,
    employeeCounts: filterEmployeeCounts,
    revenues: filterRevenues,
    sources: filterSources,
    optedOut: (filterOptedOut ?? "all") as "all" | "yes" | "no",
  }), [filterStages, filterProducts, filterAssignees, filterTags, filterPositions, filterEmployeeCounts, filterRevenues, filterSources, filterOptedOut]);

  const advancedActiveCount = filterStages.length + filterProducts.length + filterAssignees.length + filterTags.length + filterPositions.length + filterEmployeeCounts.length + filterRevenues.length + filterSources.length + (filterOptedOut && filterOptedOut !== "all" ? 1 : 0);

  const hasActiveFilters = filterStatus !== "all" || searchQuery.trim() !== "" || sortOrder !== "recent" || !!filterCreatedFrom || !!filterCreatedTo || advancedActiveCount > 0;



  // Friendly labels for "source" values
  const SOURCE_LABELS: Record<string, string> = {
    whatsapp: "WhatsApp",
    manual: "Manual",
    importacao: "Importação",
    widget: "Widget",
    api: "API",
    webhook: "Webhook",
    pipeline_card: "Pipeline",
  };

  const advancedOptions = useMemo(() => {
    const buildCounts = (getter: (l: Lead) => string | null | undefined) => {
      const counts = new Map<string, number>();
      for (const lead of leads) {
        const raw = getter(lead);
        const v = (raw || "").trim();
        if (!v) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    };

    const sourceOpts = (() => {
      const counts = new Map<string, number>();
      for (const lead of leads) {
        const v = (lead.contact?.source || "").trim();
        if (!v) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([value, count]) => ({
          value,
          label: SOURCE_LABELS[value] || value,
          count,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    })();

    const stageOpts: { value: string; label: string; count: number }[] = stages.map((s) => ({
      value: s.id,
      label: s.name,
      count: leads.filter((l) => l.stage_id === s.id).length,
    }));

    const tagOpts: { value: string; label: string; count: number }[] = workspaceTags
      .map((t) => ({
        value: t.name,
        label: t.name,
        count: leads.filter((l) => {
          const leadTags = parseTags(l.contact?.tags);
          return leadTags.some((lt) => lt.name.toLowerCase() === t.name.toLowerCase());
        }).length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    const productOpts: { value: string; label: string; count: number }[] = products.map((p) => ({
      value: p.id,
      label: p.name,
      count: leads.filter((l) => l.product_id === p.id).length,
    })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    const assigneeOpts: { value: string; label: string; count: number }[] = (() => {
      const memberOpts = members.map((m) => ({
        value: m.user_id,
        label: m.profile?.name || m.profile?.email || "Sem nome",
        count: leads.filter((l) => l.assigned_to === m.user_id).length,
      })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      const unassignedCount = leads.filter((l) => {
        const valid = l.assigned_to && members.some((m) => m.user_id === l.assigned_to);
        return !valid;
      }).length;
      return [
        { value: "unassigned", label: "Sem atribuição", count: unassignedCount },
        ...memberOpts,
      ];
    })();

    return {
      stages: stageOpts,
      products: productOpts,
      assignees: assigneeOpts,
      tags: tagOpts,
      positions: buildCounts((l) => l.contact?.position || l.contact?.job_title || null),
      employeeCounts: buildCounts((l) => l.contact?.employee_count || null),
      revenues: buildCounts((l) => l.contact?.revenue || null),
      sources: sourceOpts,
    };
  }, [leads, stages, workspaceTags, products, members]);


  const clearFilters = () => {
    resetPipelineFilters();
  };

  const toggleTag = (tagName: string) => {
    setFilterTags(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  return (
    <div className="h-full w-full min-w-0 overflow-x-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-border min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl font-display font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Arraste os leads entre os estagios
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap min-w-0">

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-[200px] h-8 pl-8 text-sm bg-secondary border-border rounded-xl"
            />
          </div>

          {/* Grupo de Filtros */}
          <div className="flex items-center gap-2 px-3 py-1.5 glass-card rounded-xl">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
            
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className={cn(
                "w-[140px] h-7 text-xs border-0 bg-transparent shadow-none justify-center",
                filterStatus !== "all" && "text-primary font-medium"
              )}>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Leads</SelectItem>
                <SelectItem value="open">Em andamento</SelectItem>
                <SelectItem value="won">Ganhos</SelectItem>
                <SelectItem value="lost">Perdidos</SelectItem>
              </SelectContent>
            </Select>

            <Separator orientation="vertical" className="h-4" />
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger
                title="Ordenar"
                className={cn(
                  "w-auto min-w-0 h-7 px-2 gap-1 text-xs border-0 bg-transparent shadow-none [&>svg:last-child]:hidden",
                  sortOrder !== "recent" && "text-primary font-medium"
                )}
              >
                <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Mais recentes</SelectItem>
                <SelectItem value="oldest">Mais antigos</SelectItem>
                <SelectItem value="moved">Última movimentação</SelectItem>
                <SelectItem value="value_high">Maior valor</SelectItem>
                <SelectItem value="value_low">Menor valor</SelectItem>
                <SelectItem value="name">Nome A-Z</SelectItem>
              </SelectContent>
            </Select>





            <Separator orientation="vertical" className="h-4" />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-xs gap-1.5",
                    (filterCreatedFrom || filterCreatedTo) && "text-primary font-medium"
                  )}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Data
                  {(filterCreatedFrom || filterCreatedTo) && (
                    <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                      {(filterCreatedFrom ? 1 : 0) + (filterCreatedTo ? 1 : 0)}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Data de criação</span>
                    {(filterCreatedFrom || filterCreatedTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFilterCreatedFrom(undefined);
                          setFilterCreatedTo(undefined);
                        }}
                        className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
                      >
                        Limpar
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full justify-start text-left font-normal bg-card",
                            !filterCreatedFrom && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                          {filterCreatedFrom
                            ? format(parseISO(filterCreatedFrom), "dd/MM/yyyy", { locale: ptBR })
                            : "De"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-border z-50" align="start">
                        <Calendar
                          mode="single"
                          selected={filterCreatedFrom ? parseISO(filterCreatedFrom) : undefined}
                          onSelect={(date) =>
                            setFilterCreatedFrom(date ? format(date, "yyyy-MM-dd") : undefined)
                          }
                          initialFocus
                          locale={ptBR}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full justify-start text-left font-normal bg-card",
                            !filterCreatedTo && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                          {filterCreatedTo
                            ? format(parseISO(filterCreatedTo), "dd/MM/yyyy", { locale: ptBR })
                            : "Até"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-card border-border z-50" align="start">
                        <Calendar
                          mode="single"
                          selected={filterCreatedTo ? parseISO(filterCreatedTo) : undefined}
                          onSelect={(date) =>
                            setFilterCreatedTo(date ? format(date, "yyyy-MM-dd") : undefined)
                          }
                          initialFocus
                          locale={ptBR}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>

                    {filterCreatedFrom && filterCreatedTo && filterCreatedTo < filterCreatedFrom && (
                      <p className="text-xs text-destructive">
                        A data final deve ser igual ou posterior à data inicial.
                      </p>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Separator orientation="vertical" className="h-5 mx-0.5" />

            <PipelineAdvancedFilters
              values={advancedFilterValues}
              onChange={(next) => setPipelineFilters(prev => ({ ...prev, ...next }))}
              options={advancedOptions}
            />

            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearFilters}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground ml-1"
              >
                <X className="h-3 w-3 mr-1" />
                Limpar
              </Button>
            )}
          </div>
          
          {/* Separador */}
          <Separator orientation="vertical" className="h-6" />
          
          {/* Acoes */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToCsv({
                leads: sortedLeads,
                stages,
                products,
                members,
                workspaceName: currentWorkspace?.name,
                workspaceId: currentWorkspace?.id,
              })
            }
            title="Exportar cards visíveis em CSV"
            aria-label="Exportar CSV"
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/crm/settings/pipeline")}
            title="Configurar"
            aria-label="Configurar"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setIsNewLeadOpen(true)} className="bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70">
            <Plus className="h-4 w-4 mr-2" />
            Novo Lead
          </Button>
          <NewLeadDialog
            isOpen={isNewLeadOpen}
            onClose={() => setIsNewLeadOpen(false)}
            onSuccess={() => queryClient.invalidateQueries({ queryKey: ["crm-leads"] })}
          />
        </div>
      </div>

      {/* Banner: leads ocultos no intervalo de datas */}
      {hiddenBreakdown && hiddenBreakdown.hidden > 0 && (
        <div className="px-4 pt-3">
          <div className="glass-card flex items-start gap-3 rounded-lg border border-border/40 px-3 py-2 text-xs">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 text-muted-foreground">
              Exibindo <span className="font-mono text-foreground">{sortedLeads.length}</span> de{" "}
              <span className="font-mono text-foreground">{hiddenBreakdown.totalInRange}</span> cards no intervalo selecionado.{" "}
              <span className="font-mono text-foreground">{hiddenBreakdown.hidden}</span> ocultos:
              {hiddenBreakdown.lostHidden > 0 && (
                <> <span className="font-mono text-foreground">{hiddenBreakdown.lostHidden}</span> perdidos (mude o filtro Status para "Perdidos" ou "Todos" para ver),</>
              )}
              {hiddenBreakdown.incompleteContact > 0 && (
                <> <span className="font-mono text-foreground">{hiddenBreakdown.incompleteContact}</span> sem nome ou contato (e-mail/telefone),</>
              )}
              {hiddenBreakdown.genericName > 0 && (
                <> <span className="font-mono text-foreground">{hiddenBreakdown.genericName}</span> com nome genérico (Visitante, Contato…),</>
              )}
              <span className="text-muted-foreground/70"> — esses leads aparecem nos relatórios de Cohort.</span>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full min-w-max">
            {stages
              .filter((stage) => filterStages.length === 0 || filterStages.includes(stage.id))
              .map((stage) => (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  stageLeads={leadsByStage.get(stage.id) || EMPTY_LEADS}
                  activeId={activeId}
                  products={products}
                  members={members}
                  leadsWithFutureMeeting={leadsWithFutureMeeting}
                  onOpenDetails={handleOpenDetails}
                />
              ))}
          </div>

          <DragOverlay>
            {activeLead && (
              <div className="glass-card-glow p-3 w-72 opacity-90 rotate-2 shadow-lg">
                <div className="flex items-start gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">
                      {activeLead.title || activeLead.contact?.name || "Sem titulo"}
                    </p>
                    {activeLead.contact?.company && (
                      <div className="flex items-center gap-1 mt-1">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate">
                          {activeLead.contact.company}
                        </span>
                      </div>
                    )}
                    {activeLead.contact && activeLead.title && activeLead.title !== activeLead.contact.name && (
                      <div className="flex items-center gap-1 mt-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate">
                          {activeLead.contact.name}
                        </span>
                      </div>
                    )}
                    {activeLead.value > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <DollarSign className="h-3 w-3 text-primary" />
                        <span className="text-xs font-mono text-primary">
                          R$ {activeLead.value.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Lead Detail Sheet */}
      <LeadDetailSheet
        open={isDetailOpen}
        onOpenChange={(open) => {
          setIsDetailOpen(open);
          if (!open) {
            searchParams.delete("lead");
            searchParams.delete("activity");
            setSearchParams(searchParams, { replace: true });
            setInitialActivityId(null);
          }
        }}
        leadId={selectedLeadId}
        workspaceId={currentWorkspace?.id || ""}
        initialActivityId={initialActivityId}
      />
    </div>
  );
}
