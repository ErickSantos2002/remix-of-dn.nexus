import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useChatPresence } from "@/hooks/useChatPresence";
import { PRESENCE_LABEL, PRESENCE_PILL } from "@/lib/routing/presence";
import { Pill } from "@/components/dn/Pill";
import { EmptyState } from "@/components/dn/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { 
  Settings, 
  Users, 
  Shuffle, 
  Scale, 
  Target, 
  TrendingUp,
  Tags,
  AlertTriangle,
  Loader2,
  Edit2,
  User,
  Clock,
  Save
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface WorkspaceRoutingConfig {
  id: string;
  workspace_id: string;
  strategy: string;
  fallback_strategy: string;
  auto_assign: boolean;
  category_matching: boolean;
  skill_matching: boolean;
  require_approval: boolean;
  max_leads_per_agent: number;
  queue_timeout_minutes: number;
  respect_card_owner: boolean;
  scheduling_strategy: string;
  scheduling_load_window_days: number;
}

interface HumanMember {
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  role: string;
  max_concurrent_leads: number;
  is_accepting_leads: boolean;
  categories: { id: string; name: string }[];
}

interface Category {
  id: string;
  name: string;
  color: string | null;
}

const STRATEGIES = [
  { value: "round_robin", label: "Distribuição Sequencial", icon: Shuffle, description: "Distribui leads um por vez para cada atendente na ordem" },
  { value: "least_loaded", label: "Menos Carregado", icon: Scale, description: "Atribui ao atendente com menos leads ativos" },
  { value: "skill_based", label: "Por Habilidade (em breve)", icon: Target, description: "Seleciona atendente baseado em especialidades", disabled: true },
  { value: "performance_based", label: "Por Performance (em breve)", icon: TrendingUp, description: "Prioriza atendentes com melhor taxa de resolução", disabled: true },
  { value: "category_based", label: "Por Categoria (em breve)", icon: Tags, description: "Roteia baseado na categoria do atendimento", disabled: true },
];

const FALLBACK_STRATEGIES = [
  { value: "least_loaded", label: "Menos Carregado" },
  { value: "round_robin", label: "Distribuição Sequencial" },
  { value: "queue", label: "Fila de Espera" },
];

export default function RoutingConfig() {
  const { currentWorkspace } = useWorkspace();
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceRoutingConfig | null>(null);
  const [members, setMembers] = useState<HumanMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  
  // Dialog state
  const [editingMember, setEditingMember] = useState<HumanMember | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSavingMember, setIsSavingMember] = useState(false);
  
  // Member edit form
  const [memberForm, setMemberForm] = useState({
    max_concurrent_leads: 10,
    is_accepting_leads: true,
    selectedCategories: [] as string[],
  });

  // Global config form
  const [globalForm, setGlobalForm] = useState({
    strategy: "least_loaded",
    fallback_strategy: "queue",
    auto_assign: true,
    category_matching: true,
    skill_matching: false,
    require_approval: false,
    max_leads_per_agent: 10,
    queue_timeout_minutes: 30,
    respect_card_owner: true,
    scheduling_strategy: "least_loaded",
    scheduling_load_window_days: 30,
  });

  const { presence } = useChatPresence(currentWorkspace?.id);

  const { data: waitingLeads } = useQuery({
    queryKey: ["routing-waiting-queue", currentWorkspace?.id],
    enabled: !!currentWorkspace,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("lead_queues")
        .select("id, lead_id, lead_name, lead_phone, priority, created_at")
        .eq("workspace_id", currentWorkspace!.id)
        .eq("status", "waiting")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (currentWorkspace) {
      fetchData();
    }
  }, [currentWorkspace]);

  const fetchData = async () => {
    if (!currentWorkspace) return;
    setIsLoading(true);

    try {
      // Fetch workspace routing config
      const { data: configData } = await supabase
        .from("workspace_routing_config")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle();

      if (configData) {
        // respect_card_owner/scheduling_strategy/scheduling_load_window_days ainda
        // fora do types.ts gerado — padrão do projeto (useFlows.ts)
        const config = configData as unknown as WorkspaceRoutingConfig;
        setWorkspaceConfig(config);
        setGlobalForm({
          strategy: config.strategy,
          fallback_strategy: config.fallback_strategy || "queue",
          auto_assign: config.auto_assign ?? true,
          category_matching: config.category_matching ?? true,
          skill_matching: config.skill_matching ?? false,
          require_approval: config.require_approval ?? false,
          max_leads_per_agent: config.max_leads_per_agent ?? 10,
          queue_timeout_minutes: config.queue_timeout_minutes ?? 30,
          respect_card_owner: config.respect_card_owner ?? true,
          scheduling_strategy: config.scheduling_strategy ?? "least_loaded",
          scheduling_load_window_days: config.scheduling_load_window_days ?? 30,
        });
      }

      // Fetch workspace members
      const { data: membersData } = await supabase
        .from("workspace_members")
        .select("id, user_id, role")
        .eq("workspace_id", currentWorkspace.id)
        .eq("status", "active");

      // Fetch profiles for members
      const memberUserIds = membersData?.map(m => m.user_id) || [];
      const { data: memberProfiles } = memberUserIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, name, email")
            .in("id", memberUserIds)
        : { data: null };

      // Fetch owner
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("owner_id, profiles:owner_id (id, name, email)")
        .eq("id", currentWorkspace.id)
        .single();

      // Fetch availability data
      const { data: availabilityData } = await supabase
        .from("agent_availability")
        .select("*")
        .eq("workspace_id", currentWorkspace.id);

      // Fetch categories
      const { data: categoriesData } = await supabase
        .from("chat_categories")
        .select("id, name, color")
        .eq("workspace_id", currentWorkspace.id)
        .eq("is_active", true);

      setCategories(categoriesData || []);

      // Fetch category assignments
      const { data: categoryAssignments } = await supabase
        .from("category_agent_assignments")
        .select("agent_id, category_id, chat_categories:category_id (id, name)")
        .eq("workspace_id", currentWorkspace.id);

      // Build members list
      const allMembers: HumanMember[] = [];

      // Add owner first
      if (workspace?.profiles) {
        const ownerProfile = workspace.profiles as { id: string; name: string | null; email: string };
        const ownerAvailability = availabilityData?.find(a => a.user_id === workspace.owner_id);
        const ownerCategories = categoryAssignments
          ?.filter(ca => ca.agent_id === workspace.owner_id)
          .map(ca => ca.chat_categories)
          .filter(Boolean) as { id: string; name: string }[] || [];

        allMembers.push({
          id: workspace.owner_id!,
          user_id: workspace.owner_id!,
          name: ownerProfile.name,
          email: ownerProfile.email,
          role: "owner",
          max_concurrent_leads: ownerAvailability?.max_concurrent_leads || 10,
          is_accepting_leads: ownerAvailability?.is_accepting_leads ?? true,
          categories: ownerCategories,
        });
      }

      // Add other members
      if (membersData) {
        for (const member of membersData) {
          if (member.user_id === workspace?.owner_id) continue;
          const profile = memberProfiles?.find(p => p.id === member.user_id);
          if (!profile) continue;

          const availability = availabilityData?.find(a => a.user_id === member.user_id);
          const memberCategories = categoryAssignments
            ?.filter(ca => ca.agent_id === member.user_id)
            .map(ca => ca.chat_categories)
            .filter(Boolean) as { id: string; name: string }[] || [];

          allMembers.push({
            id: member.id,
            user_id: member.user_id,
            name: profile.name,
            email: profile.email,
            role: member.role,
            max_concurrent_leads: availability?.max_concurrent_leads || 10,
            is_accepting_leads: availability?.is_accepting_leads ?? true,
            categories: memberCategories,
          });
        }
      }

      setMembers(allMembers);
    } catch (error) {
      console.error("Error fetching routing data:", error);
      toast.error("Erro ao carregar configurações");
    } finally {
      setIsLoading(false);
    }
  };

  const saveGlobalConfig = async () => {
    if (!currentWorkspace) return;
    setIsSavingGlobal(true);

    try {
      if (workspaceConfig) {
        // respect_card_owner/scheduling_strategy/scheduling_load_window_days ainda
        // fora do types.ts gerado — padrão do projeto (useFlows.ts)
        const { error } = await supabase
          .from("workspace_routing_config")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(globalForm as any)
          .eq("id", workspaceConfig.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("workspace_routing_config")
          .insert({
            workspace_id: currentWorkspace.id,
            ...globalForm,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);

        if (error) throw error;
      }

      toast.success("Configuração global salva");
      fetchData();
    } catch (error) {
      console.error("Error saving global config:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const openMemberDialog = (member: HumanMember) => {
    setEditingMember(member);
    setMemberForm({
      max_concurrent_leads: member.max_concurrent_leads,
      is_accepting_leads: member.is_accepting_leads,
      selectedCategories: member.categories.map(c => c.id),
    });
    setDialogOpen(true);
  };

  const saveMemberConfig = async () => {
    if (!editingMember || !currentWorkspace) return;
    setIsSavingMember(true);

    try {
      // Update or create availability
      const { data: existing } = await supabase
        .from("agent_availability")
        .select("id")
        .eq("user_id", editingMember.user_id)
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("agent_availability")
          .update({
            max_concurrent_leads: memberForm.max_concurrent_leads,
            is_accepting_leads: memberForm.is_accepting_leads,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("agent_availability")
          .insert({
            user_id: editingMember.user_id,
            workspace_id: currentWorkspace.id,
            max_concurrent_leads: memberForm.max_concurrent_leads,
            is_accepting_leads: memberForm.is_accepting_leads,
          });
      }

      // Update category assignments
      // First, remove existing assignments for this user
      await supabase
        .from("category_agent_assignments")
        .delete()
        .eq("agent_id", editingMember.user_id)
        .eq("workspace_id", currentWorkspace.id);

      // Then, add new assignments
      if (memberForm.selectedCategories.length > 0) {
        const assignments = memberForm.selectedCategories.map(categoryId => ({
          agent_id: editingMember.user_id,
          category_id: categoryId,
          workspace_id: currentWorkspace.id,
        }));

        await supabase
          .from("category_agent_assignments")
          .insert(assignments);
      }

      toast.success("Configuração do membro salva");
      setDialogOpen(false);
      setEditingMember(null);
      fetchData();
    } catch (error) {
      console.error("Error saving member config:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setIsSavingMember(false);
    }
  };

  const getStrategyInfo = (strategy: string) => {
    return STRATEGIES.find(s => s.value === strategy) || STRATEGIES[1];
  };

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Selecione um workspace para configurar roteamento</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentStrategy = getStrategyInfo(globalForm.strategy);
  const StrategyIcon = currentStrategy.icon;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuração de Roteamento</h1>
        <p className="text-muted-foreground">Configure como leads são distribuídos para atendentes humanos</p>
      </div>

      {/* Global Configuration Section */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Configuração Global
              </CardTitle>
              <CardDescription>
                Regras de distribuição aplicadas a todos os atendentes
              </CardDescription>
            </div>
            <Button onClick={saveGlobalConfig} disabled={isSavingGlobal}>
              {isSavingGlobal ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Strategy Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Estratégia de Distribuição</Label>
              <Select
                value={globalForm.strategy}
                onValueChange={(value) => setGlobalForm(prev => ({ ...prev, strategy: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map(strategy => {
                    const Icon = strategy.icon;
                    return (
                      <SelectItem key={strategy.value} value={strategy.value} disabled={strategy.disabled}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{strategy.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{currentStrategy.description}</p>
            </div>

            <div className="space-y-2">
              <Label>Fallback (quando não há atendente disponível)</Label>
              <Select
                value={globalForm.fallback_strategy}
                onValueChange={(value) => setGlobalForm(prev => ({ ...prev, fallback_strategy: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FALLBACK_STRATEGIES.map(strategy => (
                    <SelectItem key={strategy.value} value={strategy.value}>
                      {strategy.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Numeric settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Máximo de Leads por Atendente</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={globalForm.max_leads_per_agent}
                onChange={(e) => setGlobalForm(prev => ({ 
                  ...prev, 
                  max_leads_per_agent: Math.max(1, Math.min(50, parseInt(e.target.value) || 10))
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Timeout de Fila (minutos)</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={globalForm.queue_timeout_minutes}
                disabled
                onChange={(e) => setGlobalForm(prev => ({
                  ...prev,
                  queue_timeout_minutes: Math.max(5, Math.min(120, parseInt(e.target.value) || 30))
                }))}
              />
              <p className="text-xs text-muted-foreground">Em breve — a fila é esvaziada automaticamente quando um atendente fica disponível.</p>
            </div>
          </div>

          {/* Toggle options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Auto-atribuir Leads</Label>
                <p className="text-xs text-muted-foreground">Distribuir automaticamente</p>
              </div>
              <Switch
                checked={globalForm.auto_assign}
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, auto_assign: checked }))}
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Matching por Categoria</Label>
                <p className="text-xs text-muted-foreground">Considerar categoria do lead</p>
              </div>
              <Switch
                checked={globalForm.category_matching}
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, category_matching: checked }))}
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Requer Aprovação</Label>
                <p className="text-xs text-muted-foreground">Atendente deve aceitar lead (em breve)</p>
              </div>
              <Switch
                checked={globalForm.require_approval}
                disabled
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, require_approval: checked }))}
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Matching por Habilidade</Label>
                <p className="text-xs text-muted-foreground">Considerar especialidades (em breve)</p>
              </div>
              <Switch
                checked={globalForm.skill_matching}
                disabled
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, skill_matching: checked }))}
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Respeitar responsável do card</Label>
                <p className="text-xs text-muted-foreground">Contato com card no CRM volta para o dono dele, sem rodízio</p>
              </div>
              <Switch
                checked={globalForm.respect_card_owner}
                onCheckedChange={(checked) => setGlobalForm(prev => ({ ...prev, respect_card_owner: checked }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {STRATEGIES.map(strategy => {
          const Icon = strategy.icon;
          const isActive = globalForm.strategy === strategy.value;
          return (
            <Card 
              key={strategy.value} 
              className={cn(
                "glass-card cursor-pointer transition-all",
                isActive && "border-primary bg-primary/5"
              )}
              onClick={() => setGlobalForm(prev => ({ ...prev, strategy: strategy.value }))}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    isActive ? "bg-primary/20" : "bg-muted"
                  )}>
                    <Icon className={cn(
                      "h-4 w-4",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{strategy.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Scheduling Distribution Section */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Distribuição de agendamentos
          </CardTitle>
          <CardDescription>
            Regras aplicadas quando uma reunião é marcada pelo widget ou pelo WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Estratégia de distribuição</Label>
              <Select
                value={globalForm.scheduling_strategy}
                onValueChange={(value) => setGlobalForm(prev => ({ ...prev, scheduling_strategy: value }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="least_loaded">Menos carregado</SelectItem>
                  <SelectItem value="round_robin">Distribuição sequencial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Janela de cálculo de carga (dias)</Label>
              <Input
                type="number"
                min={7}
                max={90}
                value={globalForm.scheduling_load_window_days}
                onChange={(e) => setGlobalForm(prev => ({
                  ...prev,
                  scheduling_load_window_days: Math.max(7, Math.min(90, parseInt(e.target.value) || 30)),
                }))}
              />
              <p className="text-xs text-muted-foreground">Reuniões neste período contam como carga, incluindo as já realizadas</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O <strong>time</strong> de cada widget é definido em{" "}
            <Link to="/settings/scheduling-widgets" className="text-primary underline-offset-2 hover:underline">Widgets de agendamento</Link>;
            o time do agendamento por WhatsApp, na configuração do agente de IA. Esta página governa as regras.
          </p>
        </CardContent>
      </Card>

      {/* Human Members Section */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Atendentes Humanos
          </CardTitle>
          <CardDescription>
            Configure capacidade e categorias de cada atendente — disponibilidade vale para o chat; agendamentos seguem o time de cada widget
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {members.length > 0 && ![...presence.values()].some(p => p.state === "available") && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--dn-amber)]/30 bg-[var(--dn-amber)]/10 p-3 text-sm text-[var(--dn-amber)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Nenhum atendente disponível agora — novos leads de chat vão para a fila de espera.
            </div>
          )}

          {members.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Nenhum membro encontrado no workspace</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map(member => {
                const p = presence.get(member.user_id);
                const state = p?.state ?? "available";
                const load = p?.load ?? 0;
                const loadPercentage = (load / member.max_concurrent_leads) * 100;

                return (
                  <Card
                    key={member.user_id}
                    className={cn(
                      "hover:border-primary/50 transition-all",
                      !member.is_accepting_leads && "opacity-60"
                    )}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-muted">
                            <User className="h-5 w-5 text-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {member.name || member.email}
                            </p>
                            <div className="flex items-center gap-2">
                              <Pill status={PRESENCE_PILL[state]}>
                                {PRESENCE_LABEL[state]}
                                {state === "outside_hours" && p ? ` · ${p.workWindow}` : ""}
                              </Pill>
                              {member.role === "owner" && (
                                <Badge variant="outline" className="text-xs">Owner</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openMemberDialog(member)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Workload indicator */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Carga atual</span>
                          <span className="font-mono">
                            {load}/{member.max_concurrent_leads}
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              loadPercentage < 50 ? "bg-success" :
                              loadPercentage < 80 ? "bg-warning" : "bg-destructive"
                            )}
                            style={{ width: `${Math.min(100, loadPercentage)}%` }}
                          />
                        </div>
                      </div>

                      {/* Categories */}
                      {member.categories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {member.categories.slice(0, 3).map(cat => (
                            <Badge key={cat.id} variant="secondary" className="text-xs">
                              {cat.name}
                            </Badge>
                          ))}
                          {member.categories.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{member.categories.length - 3}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sem categorias atribuídas</p>
                      )}

                      {/* Accepting leads indicator */}
                      {!member.is_accepting_leads && (
                        <Badge variant="outline" className="text-xs text-warning border-warning">
                          Não recebendo leads
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Waiting queue */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Fila de espera</h3>
              <Pill status={(waitingLeads?.length ?? 0) > 0 ? "warning" : "neutral"}>
                {waitingLeads?.length ?? 0}
              </Pill>
            </div>
            {(waitingLeads?.length ?? 0) === 0 ? (
              <EmptyState icon={Users} title="Fila vazia" description="Nenhum lead aguardando atendente" />
            ) : (
              <div className="space-y-2">
                {waitingLeads!.map((q) => (
                  <div key={q.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
                    <div>
                      <p className="font-medium">{q.lead_name || q.lead_phone}</p>
                      <p className="text-xs text-muted-foreground">
                        Aguardando desde {new Date(q.created_at!).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/?lead=${q.lead_id}`}>Abrir no Inbox</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Member Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Configurar Atendente - {editingMember?.name || editingMember?.email}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Max leads */}
            <div className="space-y-2">
              <Label>Capacidade Maxima de Leads</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={memberForm.max_concurrent_leads}
                onChange={(e) => setMemberForm(prev => ({ 
                  ...prev, 
                  max_concurrent_leads: Math.max(1, Math.min(50, parseInt(e.target.value) || 10))
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Quantidade máxima de leads simultâneos
              </p>
            </div>

            {/* Accepting leads toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>Receber Leads</Label>
                <p className="text-xs text-muted-foreground">
                  Permitir que leads sejam atribuídos automaticamente
                </p>
              </div>
              <Switch
                checked={memberForm.is_accepting_leads}
                onCheckedChange={(checked) => setMemberForm(prev => ({ ...prev, is_accepting_leads: checked }))}
              />
            </div>

            {/* Categories selection */}
            <div className="space-y-3">
              <Label>Categorias Atendidas</Label>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma categoria criada. Crie categorias em Configurações para Categorias.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(category => (
                    <label
                      key={category.id}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all",
                        memberForm.selectedCategories.includes(category.id)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <Checkbox
                        checked={memberForm.selectedCategories.includes(category.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setMemberForm(prev => ({
                              ...prev,
                              selectedCategories: [...prev.selectedCategories, category.id]
                            }));
                          } else {
                            setMemberForm(prev => ({
                              ...prev,
                              selectedCategories: prev.selectedCategories.filter(id => id !== category.id)
                            }));
                          }
                        }}
                      />
                      <span className="text-sm">{category.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveMemberConfig} disabled={isSavingMember}>
              {isSavingMember ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
