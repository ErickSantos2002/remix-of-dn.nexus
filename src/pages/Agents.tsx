import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Bot, Pencil, Archive, Loader2, RotateCcw, Sparkles, Clock, Tag, Store, Settings, GitCompare, AlertTriangle, Smile, Briefcase, TrendingUp, DollarSign, Wrench, Users, Megaphone, Globe, LucideIcon, MessageSquare, MessageCircle, UserCheck, Zap, Power, SplitSquareHorizontal, Calendar, FileText, Send, Bell, Calculator, Search, Database, Mail, Phone, MapPin, Image, Link, Code, Shield, Key, AlertCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUserRole } from "@/hooks/useUserRole";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { Enums } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import CompareTemplateDialog from "@/components/agents/CompareTemplateDialog";
import AgentWizard, { AgentWizardData } from "@/components/agents/AgentWizard";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import MascotAnim from "@/components/ui/MascotAnim";
import { useToolCatalog, ToolCatalogItem } from "@/hooks/useToolCatalog";
import AttendantPicker from "@/components/agents/AttendantPicker";

type AgentTone = Enums<"agent_tone">;
type AgentCategory = "VENDAS" | "SUPORTE" | "RH" | "MARKETING" | "GERAL";

interface KnowledgeBase {
  id: string;
  name: string;
}

interface AgentTemplate {
  id: string;
  name: string;
  system_prompt: string;
  tone: string;
  icon?: string | null;
  category?: string | null;
}

// Agent from agents table (legacy)
interface LegacyAgent {
  id: string;
  name: string;
  tone: AgentTone | null;
  persona_prompt: string | null;
  is_active: boolean | null;
  is_archived: boolean | null;
  workspace_id: string;
  created_at: string | null;
  template_id: string | null;
  category: AgentCategory | null;
  split_messages: boolean | null;
}

// Agent from agent_instances table (new cloned templates)
interface AgentInstance {
  id: string;
  name: string;
  tone: string;
  system_prompt: string;
  is_active: boolean | null;
  is_archived: boolean | null;
  workspace_id: string;
  created_at: string | null;
  template_id: string | null;
  icon: string | null;
  is_customized: boolean | null;
}

// Unified agent type for display
interface AgentWithTemplate {
  id: string;
  name: string;
  tone: AgentTone | null;
  persona_prompt: string | null;
  is_active: boolean | null;
  is_archived: boolean | null;
  workspace_id: string;
  created_at: string | null;
  template_id: string | null;
  category: AgentCategory | null;
  template?: AgentTemplate | null;
  is_customized?: boolean | null;
  source: 'agents' | 'agent_instances';
  split_messages?: boolean | null;
  live_chat_enabled?: boolean | null;
  message_debounce_seconds?: number | null;
}

interface AgentPerformance {
  agentId: string;
  leadsCount: number;
  messagesCount: number;
  conversionRate: number;
}

const toneConfig: Record<AgentTone, { label: string; className: string }> = {
  friendly: { label: "Amigável", className: "bg-success/20 text-success border-success/30" },
  professional: { label: "Profissional", className: "bg-primary/20 text-primary border-primary/30" },
  aggressive: { label: "Agressivo", className: "bg-destructive/20 text-destructive border-destructive/30" },
};

const categoryIcons: Record<AgentCategory, LucideIcon> = {
  VENDAS: DollarSign,
  SUPORTE: Wrench,
  RH: Users,
  MARKETING: Megaphone,
  GERAL: Globe,
};

const categoryConfig: Record<AgentCategory, { label: string; className: string }> = {
  VENDAS: { label: "Vendas", className: "bg-success/20 text-success border-success/30" },
  SUPORTE: { label: "Suporte", className: "bg-primary/20 text-primary border-primary/30" },
  RH: { label: "RH", className: "bg-series-4/20 text-series-4 border-series-4/30" },
  MARKETING: { label: "Marketing", className: "bg-series-3/20 text-series-3 border-series-3/30" },
  GERAL: { label: "Geral", className: "bg-muted text-muted-foreground border-border" },
};

// Tool icon mapping
const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  calendar: Calendar,
  "calendar-plus": Calendar,
  file: FileText,
  send: Send,
  bell: Bell,
  calculator: Calculator,
  search: Search,
  database: Database,
  mail: Mail,
  phone: Phone,
  "map-pin": MapPin,
  image: Image,
  link: Link,
  code: Code,
  shield: Shield,
  key: Key,
  settings: Settings,
  zap: Zap,
  wrench: Wrench,
  users: Users,
  globe: Globe,
  bot: Bot,
};

// Admin Templates Button Component
const AdminTemplatesButton = () => {
  const navigate = useNavigate();
  const { isSuperAdmin, isLoading } = useUserRole();
  
  if (isLoading || !isSuperAdmin) return null;
  
  return (
    <Button
      variant="outline"
      className="rounded-xl gap-2"
      onClick={() => navigate("/admin/templates")}
    >
      <Settings className="h-4 w-4" />
      Gerenciar Templates
    </Button>
  );
};

const Agents = () => {
  const navigate = useNavigate();
  const { 
    workspaces, 
    workspaceId, 
    isLoading: workspacesLoading,
    agents,
    isLoadingAgents,
    refetchAgents,
    refetchWorkspaces
  } = useWorkspace();
  const { toast } = useToast();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editingAgentSource, setEditingAgentSource] = useState<'agents' | 'agent_instances'>('agents');
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [agentToReset, setAgentToReset] = useState<AgentWithTemplate | null>(null);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
  const [agentToCompare, setAgentToCompare] = useState<AgentWithTemplate | null>(null);
  
  // Create workspace form
  const [workspaceName, setWorkspaceName] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  
  // Agent form
  const [agentName, setAgentName] = useState("");
  const [agentTone, setAgentTone] = useState<AgentTone>("professional");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<string[]>([]);
  const [editingAgentTemplate, setEditingAgentTemplate] = useState<AgentTemplate | null>(null);
  const [agentCategory, setAgentCategory] = useState<AgentCategory>("GERAL");
  const [agentIsCustomized, setAgentIsCustomized] = useState(false);
  const [agentSplitMessages, setAgentSplitMessages] = useState(true);
  const [agentLiveChatEnabled, setAgentLiveChatEnabled] = useState(true);
  const [agentDebounceSeconds, setAgentDebounceSeconds] = useState(5);
  const [selectedAgentTools, setSelectedAgentTools] = useState<string[]>([]);
  const [isLoadingAgentTools, setIsLoadingAgentTools] = useState(false);
  const [scheduleAllowedAttendants, setScheduleAllowedAttendants] = useState<string[]>([]);
  const [attendantOptions, setAttendantOptions] = useState<{ id: string; name: string; email: string }[]>([]);

  // Tool catalog
  const { tools: availableTools, loading: loadingTools } = useToolCatalog();

  // Knowledge bases
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [isLoadingKnowledgeBases, setIsLoadingKnowledgeBases] = useState(false);

  // Agents with templates (unified from both tables)
  const [agentsWithTemplates, setAgentsWithTemplates] = useState<AgentWithTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Agent performance data
  const [agentPerformance, setAgentPerformance] = useState<Record<string, AgentPerformance>>({});

  // Fetch agent performance metrics
  const fetchAgentPerformance = async (agentIds: string[]) => {
    if (!workspaceId || agentIds.length === 0) return;

    // Fetch leads per agent
    const { data: leadsData } = await supabase
      .from("leads")
      .select("id, assigned_agent_id, status")
      .eq("workspace_id", workspaceId)
      .in("assigned_agent_id", agentIds);

    // Fetch messages per agent
    const { data: messagesData } = await supabase
      .from("messages")
      .select("id, responding_agent_id")
      .eq("workspace_id", workspaceId)
      .in("responding_agent_id", agentIds);

    // Calculate performance metrics
    const performance: Record<string, AgentPerformance> = {};
    
    agentIds.forEach(agentId => {
      const agentLeads = leadsData?.filter(l => l.assigned_agent_id === agentId) || [];
      const agentMessages = messagesData?.filter(m => m.responding_agent_id === agentId) || [];
      const closedLeads = agentLeads.filter(l => l.status === 'closed').length;
      
      performance[agentId] = {
        agentId,
        leadsCount: agentLeads.length,
        messagesCount: agentMessages.length,
        conversionRate: agentLeads.length > 0 ? (closedLeads / agentLeads.length) * 100 : 0,
      };
    });

    setAgentPerformance(performance);
  };

  // Fetch agents from both tables with their template information
  const fetchAgentsWithTemplates = async () => {
    if (!workspaceId) {
      setAgentsWithTemplates([]);
      return;
    }

    setIsLoadingTemplates(true);

    // Fetch legacy agents from agents table (filtering by source from context)
    const legacyAgentIds = agents.filter(a => a.source === 'agents').map(a => a.id);
    const instanceAgentIds = agents.filter(a => a.source === 'agent_instances').map(a => a.id);
    
    // Fetch full data for legacy agents
    let legacyAgentsData: LegacyAgent[] = [];
    if (legacyAgentIds.length > 0) {
      const { data } = await supabase
        .from("agents")
        .select("*")
        .in("id", legacyAgentIds);
      legacyAgentsData = (data || []) as LegacyAgent[];
    }
    
    // Fetch full data for agent instances
    let instancesData: AgentInstance[] = [];
    if (instanceAgentIds.length > 0) {
      const { data } = await supabase
        .from("agent_instances")
        .select("*")
        .in("id", instanceAgentIds);
      instancesData = (data || []) as AgentInstance[];
    }

    const instances = instancesData;

    // Get all template IDs from both sources
    const templateIds = [
      ...legacyAgentsData.map((a) => a.template_id),
      ...instances.map((a) => a.template_id),
    ].filter((id): id is string => id !== null);

    let templates: AgentTemplate[] = [];
    
    if (templateIds.length > 0) {
      const { data: templatesData, error } = await supabase
        .from("agent_templates")
        .select("id, name, system_prompt, tone, icon, category")
        .in("id", templateIds);

      if (!error && templatesData) {
        templates = templatesData;
      }
    }

    // Map legacy agents
    const enrichedLegacyAgents: AgentWithTemplate[] = legacyAgentsData
      .filter((a) => !a.is_archived)
      .map((agent) => ({
        ...agent,
        template: templates.find((t) => t.id === agent.template_id) || null,
        source: 'agents' as const,
        split_messages: agent.split_messages,
        live_chat_enabled: (agent as any).live_chat_enabled,
        message_debounce_seconds: (agent as any).message_debounce_seconds,
      }));

    // Map instance agents
    const enrichedInstanceAgents: AgentWithTemplate[] = instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      tone: instance.tone as AgentTone,
      persona_prompt: instance.system_prompt,
      is_active: instance.is_active,
      is_archived: instance.is_archived,
      workspace_id: instance.workspace_id,
      created_at: instance.created_at,
      template_id: instance.template_id,
      category: (instance as any).category || null,
      split_messages: (instance as any).split_messages,
      live_chat_enabled: (instance as any).live_chat_enabled,
      message_debounce_seconds: (instance as any).message_debounce_seconds,
      template: templates.find((t) => t.id === instance.template_id) || null,
      is_customized: instance.is_customized,
      source: 'agent_instances' as const,
    }));


    // Combine and sort by created_at
    const allAgents = [...enrichedLegacyAgents, ...enrichedInstanceAgents].sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    setAgentsWithTemplates(allAgents);
    setIsLoadingTemplates(false);

    // Fetch performance data for all agents
    const allAgentIds = allAgents.map(a => a.id);
    if (allAgentIds.length > 0) {
      await fetchAgentPerformance(allAgentIds);
    }
  };

  useEffect(() => {
    fetchAgentsWithTemplates();
  }, [agents, workspaceId]);

  const fetchKnowledgeBases = async () => {
    if (!workspaceId) return;

    setIsLoadingKnowledgeBases(true);
    const { data, error } = await supabase
      .from("knowledge_bases")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name");

    if (error) {
      console.error("Error fetching knowledge bases:", error);
    } else {
      setKnowledgeBases(data || []);
    }
    setIsLoadingKnowledgeBases(false);
  };

  const fetchAgentKnowledgeBases = async (agentId: string) => {
    console.info("[AgentKB] Fetching knowledge bases for agent:", agentId);
    const { data, error } = await supabase
      .from("agent_knowledge_bases")
      .select("knowledge_base_id")
      .eq("agent_id", agentId);

    if (error) {
      console.error("[AgentKB] Error fetching agent knowledge bases:", error.code, error.message);
      toast({
        variant: "destructive",
        title: "Erro ao carregar bases de conhecimento",
        description: error.message,
      });
      return [];
    }
    console.info("[AgentKB] Found", data?.length || 0, "knowledge bases");
    return data?.map((item) => item.knowledge_base_id) || [];
  };

  useEffect(() => {
    fetchKnowledgeBases();
  }, [workspaceId]);

  // Load attendants (users that have a calendar configured in this workspace)
  useEffect(() => {
    const loadAttendants = async () => {
      if (!workspaceId) {
        setAttendantOptions([]);
        return;
      }
      const { data: cals } = await supabase
        .from("crm_agent_calendars")
        .select("agent_id")
        .eq("workspace_id", workspaceId);
      let agentIds = (cals || []).map((c: any) => c.agent_id).filter(Boolean);

      // Fallback: users with Google Calendar enabled
      if (agentIds.length === 0) {
        const { data: gcal } = await supabase
          .from("crm_google_calendar_integration")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("is_enabled", true);
        agentIds = (gcal || []).map((g: any) => g.user_id).filter(Boolean);
      }

      if (agentIds.length === 0) {
        setAttendantOptions([]);
        return;
      }

      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", agentIds);
      setAttendantOptions(
        (profs || []).map((p: any) => ({
          id: p.id,
          name: p.name || p.email || "Atendente",
          email: p.email || "",
        }))
      );
    };
    loadAttendants();
  }, [workspaceId]);

  const resetForm = () => {
    setAgentName("");
    setAgentTone("professional");
    setAgentPrompt("");
    setSelectedKnowledgeBases([]);
    setEditingAgentId(null);
    setEditingAgentSource('agents');
    setEditingAgentTemplate(null);
    setAgentCategory("GERAL");
    setAgentIsCustomized(false);
    setAgentSplitMessages(true);
    setAgentLiveChatEnabled(true);
    setAgentDebounceSeconds(5);
    setSelectedAgentTools([]);
    setScheduleAllowedAttendants([]);
  };

  const fetchAgentTools = async (agentId: string) => {
    setIsLoadingAgentTools(true);
    const { data, error } = await supabase
      .from("agent_tools")
      .select("tool_id, tool_name, config")
      .eq("agent_id", agentId)
      .eq("workspace_id", workspaceId || "")
      .eq("is_enabled", true);

    if (error) {
      console.error("[AgentTools] Fetch error:", error.message, error.code, { agentId, workspaceId });
      setIsLoadingAgentTools(false);
      return [];
    }

    // Extract schedule_appointment config (allowed_attendants)
    const scheduleRow = (data || []).find((r: any) => r.tool_name === "schedule_appointment");
    const allowed = (scheduleRow?.config as any)?.allowed_attendants;
    setScheduleAllowedAttendants(Array.isArray(allowed) ? allowed : []);

    console.info("[AgentTools] Fetched tools for agent:", agentId, "count:", data?.length || 0);
    setIsLoadingAgentTools(false);
    return data?.map((item: any) => item.tool_id).filter((id: any): id is string => id !== null) || [];
  };

  const handleOpenDialog = async (agentId?: string, source?: 'agents' | 'agent_instances') => {
    await fetchKnowledgeBases();
    
    if (agentId) {
      // Edit mode
      const agent = agentsWithTemplates.find((a) => a.id === agentId);
      if (agent) {
        setEditingAgentId(agentId);
        setEditingAgentSource(source || agent.source);
        setAgentName(agent.name);
        setAgentTone(agent.tone || "professional");
        setAgentPrompt(agent.persona_prompt || "");
        setEditingAgentTemplate(agent.template || null);
        setAgentCategory((agent.category as AgentCategory) || "GERAL");
        setAgentIsCustomized(agent.is_customized || false);
        setAgentSplitMessages(agent.split_messages !== false); // default true
        setAgentLiveChatEnabled((agent as any).live_chat_enabled !== false); // default true
        setAgentDebounceSeconds(
          typeof (agent as any).message_debounce_seconds === "number"
            ? (agent as any).message_debounce_seconds
            : 5
        );
        
        // Fetch knowledge bases for both legacy agents and instances
        const kbIds = await fetchAgentKnowledgeBases(agentId);
        setSelectedKnowledgeBases(kbIds);

        // Fetch agent tools
        const toolIds = await fetchAgentTools(agentId);
        setSelectedAgentTools(toolIds);
      }
    } else {
      resetForm();
    }
    
    setIsDialogOpen(true);
  };

  const handleResetToTemplate = async () => {
    if (!agentToReset || !agentToReset.template) return;

    const isInstance = agentToReset.source === 'agent_instances';
    
    if (isInstance) {
      // Update agent_instances table
      const { error } = await supabase
        .from("agent_instances")
        .update({
          system_prompt: agentToReset.template.system_prompt,
          tone: agentToReset.template.tone,
          is_customized: false,
        })
        .eq("id", agentToReset.id);

      if (error) {
        toast({
          variant: "destructive",
          title: "Erro ao resetar",
          description: error.message,
        });
      } else {
        toast({
          title: "Agente resetado!",
          description: `O agente foi restaurado para o template "${agentToReset.template.name}".`,
        });
        await fetchAgentsWithTemplates();
        
        // If editing, update the form
        if (editingAgentId === agentToReset.id) {
          setAgentPrompt(agentToReset.template.system_prompt);
          setAgentTone(agentToReset.template.tone as AgentTone);
          setAgentIsCustomized(false);
        }
      }
    } else {
      // Update legacy agents table
      const { error } = await supabase
        .from("agents")
        .update({
          persona_prompt: agentToReset.template.system_prompt,
          tone: agentToReset.template.tone as AgentTone,
        })
        .eq("id", agentToReset.id);

      if (error) {
        toast({
          variant: "destructive",
          title: "Erro ao resetar",
          description: error.message,
        });
      } else {
        toast({
          title: "Agente resetado!",
          description: `O agente foi restaurado para o template "${agentToReset.template.name}".`,
        });
        await refetchAgents();
        
        // If editing, update the form
        if (editingAgentId === agentToReset.id) {
          setAgentPrompt(agentToReset.template.system_prompt);
          setAgentTone(agentToReset.template.tone as AgentTone);
        }
      }
    }

    setIsResetDialogOpen(false);
    setAgentToReset(null);
  };

  const handleCreateWorkspace = async () => {
    if (!workspaceName.trim()) {
      toast({
        variant: "destructive",
        title: "Nome obrigatório",
        description: "Por favor, insira um nome para o workspace.",
      });
      return;
    }

    setIsCreatingWorkspace(true);
    
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast({
        variant: "destructive",
        title: "Erro de autenticação",
        description: "Você precisa estar logado para criar um workspace.",
      });
      setIsCreatingWorkspace(false);
      return;
    }

    const { error } = await supabase.from("workspaces").insert({
      name: workspaceName.trim(),
      owner_id: userData.user.id,
      icon: workspaceName.trim().charAt(0).toUpperCase(),
    });

    if (error) {
      console.error("Error creating workspace:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar workspace",
        description: error.message,
      });
    } else {
      toast({
        title: "Workspace criado!",
        description: "Seu workspace foi criado com sucesso.",
      });
      setWorkspaceName("");
      await refetchWorkspaces();
    }
    setIsCreatingWorkspace(false);
  };

  // Handle wizard completion
  const handleWizardComplete = async (data: AgentWizardData) => {
    if (!workspaceId) {
      toast({
        variant: "destructive",
        title: "Workspace não selecionado",
        description: "Selecione um workspace primeiro.",
      });
      throw new Error("No workspace selected");
    }

    const { data: newAgent, error } = await supabase
      .from("agents")
      .insert({
        name: data.name,
        tone: data.tone,
        persona_prompt: data.systemPrompt || null,
        workspace_id: workspaceId,
        category: data.category,
        split_messages: data.splitMessages,
        live_chat_enabled: data.liveChatEnabled,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error creating agent:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar agente",
        description: error.message,
      });
      throw error;
    }

    // Save selected tools for the agent
    if (newAgent && data.selectedTools && data.selectedTools.length > 0) {
      const toolInserts = data.selectedTools.map(toolId => ({
        agent_id: newAgent.id,
        tool_id: toolId,
        tool_name: "", // Will be populated by trigger or fetched later
        workspace_id: workspaceId,
        is_enabled: true,
      }));

      const { error: toolsError } = await supabase
        .from("agent_tools")
        .insert(toolInserts);

      if (toolsError) {
        console.error("Error saving agent tools:", toolsError);
        // Don't throw - agent was created successfully
      }
    }

    toast({
      title: "Agente criado com sucesso!",
      description: `O agente "${data.name}" foi criado e está pronto para uso.`,
    });

    await fetchAgentsWithTemplates();
    await refetchAgents();

    // If user wants to add knowledge base, open the edit dialog
    if (data.addKnowledgeBase && newAgent) {
      setTimeout(() => {
        handleOpenDialog(newAgent.id, 'agents');
      }, 500);
    }
  };

  // Save agent tools helper — incremental upsert to preserve config
  const saveAgentTools = async (agentId: string) => {
    if (!workspaceId) return;

    const uniqueTools = [...new Set(selectedAgentTools)];
    console.info("[AgentTools] Saving tools for agent:", agentId, "selected:", uniqueTools);

    // Fetch existing tool records for this agent
    const { data: existing, error: fetchError } = await supabase
      .from("agent_tools")
      .select("id, tool_id")
      .eq("agent_id", agentId)
      .eq("workspace_id", workspaceId);

    if (fetchError) {
      console.error("[AgentTools] Failed to fetch existing tools:", fetchError.message, fetchError.code);
      toast({ variant: "destructive", title: "Erro ao buscar ferramentas existentes" });
      return;
    }

    const existingMap = new Map(
      (existing || [])
        .filter((t): t is { id: string; tool_id: string } => t.tool_id !== null)
        .map((t) => [t.tool_id, t.id])
    );

    const scheduleToolId = availableTools.find((t) => t.name === "schedule_appointment")?.id;
    const buildConfigFor = (toolId: string): Record<string, any> | null => {
      if (toolId === scheduleToolId) {
        return { allowed_attendants: scheduleAllowedAttendants };
      }
      return null;
    };

    // Enable selected tools (update existing or insert new)
    for (const toolId of uniqueTools) {
      const extraConfig = buildConfigFor(toolId);
      if (existingMap.has(toolId)) {
        const updatePayload: any = { is_enabled: true };
        if (extraConfig) updatePayload.config = extraConfig;
        const { error } = await supabase
          .from("agent_tools")
          .update(updatePayload)
          .eq("id", existingMap.get(toolId)!);
        if (error) {
          console.error("[AgentTools] Update failed:", error.message, { toolId });
          toast({ variant: "destructive", title: "Erro ao ativar ferramenta", description: error.message });
          return;
        }
        existingMap.delete(toolId);
      } else {
        const toolName = availableTools.find((t) => t.id === toolId)?.name || "";
        const insertPayload: any = {
          agent_id: agentId,
          tool_id: toolId,
          tool_name: toolName,
          workspace_id: workspaceId,
          is_enabled: true,
        };
        if (extraConfig) insertPayload.config = extraConfig;
        const { error } = await supabase.from("agent_tools").insert(insertPayload);
        if (error) {
          console.error("[AgentTools] Insert failed:", error.message, { toolId, toolName });
          toast({ variant: "destructive", title: "Erro ao adicionar ferramenta", description: error.message });
          return;
        }
      }
    }

    // Disable tools that were deselected (preserve config)
    for (const [, existingId] of existingMap) {
      const { error } = await supabase
        .from("agent_tools")
        .update({ is_enabled: false })
        .eq("id", existingId);
      if (error) {
        console.error("[AgentTools] Disable failed:", error.message, { existingId });
      }
    }
    console.info("[AgentTools] Save completed for agent:", agentId);
  };

  const handleSaveAgent = async () => {
    if (!agentName.trim()) {
      toast({
        variant: "destructive",
        title: "Nome obrigatório",
        description: "Por favor, insira um nome para o agente.",
      });
      return;
    }

    if (!workspaceId) {
      toast({
        variant: "destructive",
        title: "Workspace não selecionado",
        description: "Selecione um workspace primeiro.",
      });
      return;
    }

    setIsCreating(true);

    if (editingAgentId) {
      // Check if we're editing an agent_instance or legacy agent
      if (editingAgentSource === 'agent_instances') {
        // Determine if customized by comparing with template
        let isNowCustomized = false;
        if (editingAgentTemplate) {
          isNowCustomized = 
            agentPrompt.trim() !== editingAgentTemplate.system_prompt ||
            agentTone !== editingAgentTemplate.tone;
        }

        // Update agent_instances table
        const { error: updateError } = await supabase
          .from("agent_instances")
          .update({
            name: agentName.trim(),
            tone: agentTone,
            system_prompt: agentPrompt.trim() || "",
            is_customized: isNowCustomized,
            category: agentCategory,
            split_messages: agentSplitMessages,
            live_chat_enabled: agentLiveChatEnabled,
            message_debounce_seconds: agentDebounceSeconds,
          })
          .eq("id", editingAgentId);

        if (updateError) {
          console.error("Error updating agent instance:", updateError);
          toast({
            variant: "destructive",
            title: "Erro ao atualizar agente",
            description: updateError.message,
          });
          setIsCreating(false);
          return;
        }

        toast({
          title: "Agente atualizado!",
          description: `O agente "${agentName}" foi atualizado com sucesso.`,
        });

        // Update knowledge base associations
        await supabase
          .from("agent_knowledge_bases")
          .delete()
          .eq("agent_id", editingAgentId);

        if (selectedKnowledgeBases.length > 0) {
          const { error: kbError } = await supabase.from("agent_knowledge_bases").insert(
            selectedKnowledgeBases.map((kbId) => ({
              agent_id: editingAgentId,
              knowledge_base_id: kbId,
            }))
          );
          if (kbError) {
            console.error("Error updating agent instance knowledge bases:", kbError);
          }
        }

        // Save tools for agent_instances
        await saveAgentTools(editingAgentId);
      } else {
        // Update legacy agents table
        const { error: updateError } = await supabase
          .from("agents")
          .update({
            name: agentName.trim(),
            tone: agentTone,
            persona_prompt: agentPrompt.trim() || null,
            category: agentCategory,
            split_messages: agentSplitMessages,
            live_chat_enabled: agentLiveChatEnabled,
            message_debounce_seconds: agentDebounceSeconds,
          })
          .eq("id", editingAgentId);

        if (updateError) {
          console.error("Error updating agent:", updateError);
          toast({
            variant: "destructive",
            title: "Erro ao atualizar agente",
            description: updateError.message,
          });
          setIsCreating(false);
          return;
        }

        // Update knowledge base associations (only for legacy agents)
        await supabase
          .from("agent_knowledge_bases")
          .delete()
          .eq("agent_id", editingAgentId);

        if (selectedKnowledgeBases.length > 0) {
          const { error: kbError } = await supabase.from("agent_knowledge_bases").insert(
            selectedKnowledgeBases.map((kbId) => ({
              agent_id: editingAgentId,
              knowledge_base_id: kbId,
            }))
          );

          if (kbError) {
            console.error("Error updating agent knowledge bases:", kbError);
          }
        }

        // Save tools for legacy agents
        await saveAgentTools(editingAgentId);

        toast({
          title: "Agente atualizado!",
          description: `O agente "${agentName}" foi atualizado com sucesso.`,
        });
      }
    } else {
      // Create new agent (legacy)
      const { data: newAgent, error } = await supabase
        .from("agents")
        .insert({
          name: agentName.trim(),
          tone: agentTone,
          persona_prompt: agentPrompt.trim() || null,
          workspace_id: workspaceId,
          category: agentCategory,
          split_messages: agentSplitMessages,
          live_chat_enabled: agentLiveChatEnabled,
          message_debounce_seconds: agentDebounceSeconds,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Error creating agent:", error);
        toast({
          variant: "destructive",
          title: "Erro ao criar agente",
          description: error.message,
        });
        setIsCreating(false);
        return;
      }

      // Insert knowledge base associations
      if (newAgent && selectedKnowledgeBases.length > 0) {
        const { error: kbError } = await supabase.from("agent_knowledge_bases").insert(
          selectedKnowledgeBases.map((kbId) => ({
            agent_id: newAgent.id,
            knowledge_base_id: kbId,
          }))
        );

        if (kbError) {
          console.error("Error inserting agent knowledge bases:", kbError);
        }
      }

      toast({
        title: "Agente criado!",
        description: `O agente "${agentName}" foi criado com sucesso.`,
      });
    }

    resetForm();
    setIsDialogOpen(false);
    await fetchAgentsWithTemplates();
    await refetchAgents();
    setIsCreating(false);
  };

  const handleArchiveAgent = async (agentId: string, agentNameToArchive: string, source: 'agents' | 'agent_instances') => {
    const table = source === 'agent_instances' ? 'agent_instances' : 'agents';
    
    const { error } = await supabase
      .from(table)
      .update({ is_archived: true })
      .eq("id", agentId);

    if (error) {
      console.error("Error archiving agent:", error);
      toast({
        variant: "destructive",
        title: "Erro ao arquivar agente",
        description: error.message,
      });
    } else {
      toast({
        title: "Agente arquivado",
        description: `O agente "${agentNameToArchive}" foi arquivado.`,
      });
      await fetchAgentsWithTemplates();
      await refetchAgents();
    }
  };

  const handleToggleAgentActive = async (agent: AgentWithTemplate) => {
    const newStatus = !agent.is_active;
    const table = agent.source === 'agent_instances' ? 'agent_instances' : 'agents';
    
    const { error } = await supabase
      .from(table)
      .update({ is_active: newStatus })
      .eq("id", agent.id);

    if (error) {
      console.error("Error toggling agent status:", error);
      toast({
        variant: "destructive",
        title: "Erro ao alterar status",
        description: error.message,
      });
    } else {
      toast({
        title: newStatus ? "Agente ativado" : "Agente desativado",
        description: `O agente "${agent.name}" foi ${newStatus ? 'ativado' : 'desativado'}.`,
      });
      await fetchAgentsWithTemplates();
      await refetchAgents();
    }
  };

  const handleOpenCompare = (agent: AgentWithTemplate) => {
    if (!agent.template) return;
    setAgentToCompare(agent);
    setIsCompareDialogOpen(true);
  };

  const toggleKnowledgeBase = (kbId: string) => {
    setSelectedKnowledgeBases((prev) =>
      prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]
    );
  };

  const formatLastUsed = (createdAt: string | null) => {
    if (!createdAt) return "Nunca usado";
    
    try {
      return formatDistanceToNow(new Date(createdAt), { 
        addSuffix: true, 
        locale: ptBR 
      });
    } catch {
      return "Nunca usado";
    }
  };

  // Loading state
  if (workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No workspaces - show create workspace form
  if (workspaces.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center p-6 bg-background">
        <div className="glass-card-glow w-full max-w-md p-8 animate-fade-in">
          <div className="text-center mb-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Criar seu primeiro workspace</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Para começar a usar os agentes de IA, você precisa criar um workspace primeiro.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Nome do Workspace</Label>
              <Input
                id="workspace-name"
                placeholder="Ex: Minha Empresa"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="bg-secondary border-border rounded-xl"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateWorkspace();
                  }
                }}
              />
            </div>
            <Button
              className="w-full rounded-xl glow-primary"
              onClick={handleCreateWorkspace}
              disabled={isCreatingWorkspace}
            >
              {isCreatingWorkspace ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Workspace"
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      {/* Breadcrumbs */}
      <Breadcrumbs />

      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agentes</h1>
          <p className="mt-1 text-muted-foreground">
            Configure e gerencie seus agentes de IA.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="rounded-xl gap-2"
            onClick={() => navigate("/agents/prontos")}
          >
            <Store className="h-4 w-4" />
            Agentes Prontos
          </Button>
          
          <AdminTemplatesButton />
          
          <Button 
            className="rounded-xl gap-2 glow-primary"
            onClick={() => setIsWizardOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Adicionar Novo Agente
          </Button>

          {/* Agent Wizard */}
          <AgentWizard
            open={isWizardOpen}
            onOpenChange={setIsWizardOpen}
            onComplete={handleWizardComplete}
            onGoToAgentsProntos={() => navigate("/agents/prontos")}
          />

          {/* Edit Dialog (for editing existing agents) */}
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            if (!open) resetForm();
            setIsDialogOpen(open);
          }}>
          <DialogContent className="sm:max-w-[1000px] glass-card border-border max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                {editingAgentId ? "Editar Agente" : "Novo Agente"}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Configure as informações do seu agente de IA.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              {/* Template Info Banner */}
              {editingAgentTemplate && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-xl">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-sm text-foreground">
                        Baseado em: <strong>{editingAgentTemplate.name}</strong>
                      </span>
                      {agentIsCustomized && (
                        <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30 gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Customizado
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {agentIsCustomized && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={() => {
                            const agent = agentsWithTemplates.find((a) => a.id === editingAgentId);
                            if (agent) {
                              handleOpenCompare(agent);
                            }
                          }}
                        >
                          <GitCompare className="h-3.5 w-3.5" />
                          Comparar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-primary hover:text-primary hover:bg-primary/20"
                        onClick={() => {
                          const agent = agentsWithTemplates.find((a) => a.id === editingAgentId);
                          if (agent) {
                            setAgentToReset(agent);
                            setIsResetDialogOpen(true);
                          }
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Resetar
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="agent-name">Nome do Agente</Label>
                <Input
                  id="agent-name"
                  placeholder="Ex: Alex (Vendas)"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="bg-secondary border-border rounded-xl"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agent-tone">Tom de Voz</Label>
                  <Select value={agentTone} onValueChange={(v) => setAgentTone(v as AgentTone)}>
                    <SelectTrigger className="bg-secondary border-border rounded-xl">
                      <SelectValue placeholder="Selecione o tom" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="friendly"><span className="flex items-center gap-2"><Smile className="h-4 w-4" /> Amigavel</span></SelectItem>
                      <SelectItem value="professional"><span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Profissional</span></SelectItem>
                      <SelectItem value="aggressive"><span className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Agressivo</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="agent-category">Categoria</Label>
                  <Select value={agentCategory} onValueChange={(v) => setAgentCategory(v as AgentCategory)}>
                    <SelectTrigger className="bg-secondary border-border rounded-xl">
                      <SelectValue placeholder="Selecione a categoria" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="VENDAS"><span className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> Vendas</span></SelectItem>
                      <SelectItem value="SUPORTE"><span className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Suporte</span></SelectItem>
                      <SelectItem value="RH"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> RH</span></SelectItem>
                      <SelectItem value="MARKETING"><span className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Marketing</span></SelectItem>
                      <SelectItem value="GERAL"><span className="flex items-center gap-2"><Globe className="h-4 w-4" /> Geral</span></SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground -mt-2">
                A categoria define para qual tipo de pergunta este agente será selecionado automaticamente.
              </p>
              
              <ExpandableTextarea
                id="agent-prompt"
                label="Prompt da Persona"
                placeholder="Instruções para o agente de IA. Ex: Você é um assistente de vendas amigável que ajuda clientes a encontrar o produto ideal..."
                value={agentPrompt}
                onChange={setAgentPrompt}
                description="Estas instruções definem como o agente deve se comportar nas conversas."
                minHeight="120px"
                modalTitle="Editar Prompt da Persona"
              />

              {/* Knowledge Bases Selection */}
              <div className="space-y-2">
                <Label>Bases de Conhecimento</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Selecione as bases que este agente deve usar para responder.
                </p>
                
                {isLoadingKnowledgeBases ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : knowledgeBases.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center bg-secondary/50 rounded-xl">
                    Nenhuma base de conhecimento disponível.
                    <br />
                    <span className="text-xs">Crie uma base na página de Conhecimento.</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[150px] overflow-y-auto p-3 bg-secondary/50 rounded-xl">
                    {knowledgeBases.map((kb) => (
                      <div key={kb.id} className="flex items-center space-x-3">
                        <Checkbox
                          id={`kb-${kb.id}`}
                          checked={selectedKnowledgeBases.includes(kb.id)}
                          onCheckedChange={() => toggleKnowledgeBase(kb.id)}
                        />
                        <label
                          htmlFor={`kb-${kb.id}`}
                          className="text-sm font-medium text-foreground cursor-pointer"
                        >
                          {kb.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tools Selection */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Ferramentas (Tools)
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Selecione as ferramentas que este agente pode usar.
                </p>
                
                {loadingTools || isLoadingAgentTools ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : availableTools.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center bg-secondary/50 rounded-xl">
                    Nenhuma ferramenta disponível no catálogo.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto overflow-x-hidden p-3 bg-secondary/50 rounded-xl">
                    {availableTools.map((tool) => {
                      const IconComponent = TOOL_ICON_MAP[tool.icon_name] || Zap;
                      const isSelected = selectedAgentTools.includes(tool.id);
                      
                      return (
                        <div key={tool.id} className="space-y-2">
                          <div
                            className={`flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                              isSelected
                                ? "border-primary/50 bg-primary/10"
                                : "border-border/50 bg-card/50 hover:border-border"
                            }`}
                            onClick={() => {
                              setSelectedAgentTools((prev) =>
                                prev.includes(tool.id)
                                  ? prev.filter((id) => id !== tool.id)
                                  : [...prev, tool.id]
                              );
                            }}
                          >
                            <div className={`p-2 rounded-lg shrink-0 ${isSelected ? "bg-primary/20" : "bg-muted"}`}>
                              <IconComponent className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                                  {tool.label}
                                </span>
                                {isSelected && (
                                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                                    Ativo
                                  </Badge>
                                )}
                              </div>
                              {tool.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
                                  {tool.description}
                                </p>
                              )}
                              {tool.requires_setup && tool.requires_setup.length > 0 && (
                                <p className="text-[10px] text-warning mt-1 flex items-center gap-1 flex-wrap break-all">
                                  <AlertCircle className="h-3 w-3 shrink-0" />
                                  <span className="break-all">Requer: {tool.requires_setup.join(", ")}</span>
                                </p>
                              )}
                            </div>
                            <Switch
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                setSelectedAgentTools((prev) =>
                                  checked
                                    ? [...prev, tool.id]
                                    : prev.filter((id) => id !== tool.id)
                                );
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                            />
                          </div>

                          {/* Attendant selector for schedule_appointment */}
                          {isSelected && tool.name === "schedule_appointment" && (
                            <AttendantPicker
                              options={attendantOptions}
                              selected={scheduleAllowedAttendants}
                              onChange={setScheduleAllowedAttendants}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Split Messages Toggle */}
              <div className="flex items-start space-x-3 p-4 rounded-xl bg-secondary/50 border border-border">
                <Checkbox
                  id="split-messages-edit"
                  checked={agentSplitMessages}
                  onCheckedChange={(checked) => setAgentSplitMessages(checked as boolean)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <label
                    htmlFor="split-messages-edit"
                    className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2"
                  >
                    <SplitSquareHorizontal className="h-4 w-4 text-primary" />
                    Quebrar mensagens
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Divide respostas longas em mensagens menores para parecer mais humano
                  </p>
                </div>
              </div>

              {/* Live Chat Enabled Toggle */}
              <div className="flex items-start space-x-3 p-4 rounded-xl bg-secondary/50 border border-border">
                <Checkbox
                  id="live-chat-enabled-edit"
                  checked={agentLiveChatEnabled}
                  onCheckedChange={(checked) => setAgentLiveChatEnabled(checked as boolean)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <label
                    htmlFor="live-chat-enabled-edit"
                    className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4 text-primary" />
                    Habilitado no chat ao vivo
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Quando desativado, este agente não será selecionado automaticamente para responder leads no chat ao vivo nem no widget
                  </p>
                </div>
              </div>

              {/* Message Debounce Seconds */}
              <div className="p-4 rounded-xl bg-secondary/50 border border-border space-y-2">
                <label
                  htmlFor="message-debounce-edit"
                  className="text-sm font-medium text-foreground flex items-center gap-2"
                >
                  <MessageCircle className="h-4 w-4 text-primary" />
                  Agrupar mensagens do lead (segundos)
                </label>
                <Input
                  id="message-debounce-edit"
                  type="number"
                  min={0}
                  max={60}
                  value={agentDebounceSeconds}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setAgentDebounceSeconds(Number.isFinite(v) ? Math.min(60, Math.max(0, v)) : 0);
                  }}
                  className="max-w-[140px]"
                />
                <p className="text-xs text-muted-foreground">
                  O agente aguarda este tempo após cada mensagem do lead. Se chegar uma nova mensagem dentro do intervalo, o timer reinicia e tudo é respondido em conjunto. Use 0 para responder imediatamente.
                </p>
              </div>

            </div>


            
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setIsDialogOpen(false);
                }}
                className="rounded-xl border-border"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveAgent}
                disabled={isCreating}
                className="rounded-xl"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : editingAgentId ? (
                  "Atualizar Agente"
                ) : (
                  "Salvar Agente"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              Resetar para Original?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai restaurar o prompt e tom de voz originais do template 
              <strong className="text-foreground"> "{agentToReset?.template?.name}"</strong>.
              <br /><br />
              As personalizações atuais serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl border-border">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleResetToTemplate}
              className="rounded-xl bg-primary text-primary-foreground"
            >
              Resetar para Original
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Agents Grid */}
      {isLoadingAgents || isLoadingTemplates ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : agentsWithTemplates.length === 0 ? (
        <div className="glass-card border-dashed animate-fade-in">
          <div className="flex flex-col items-center justify-center py-12">
            <MascotAnim className="mb-4" />
            <h3 className="font-semibold text-lg mb-1 text-foreground">Nenhum agente ainda</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Crie seu primeiro agente de IA para começar a automatizar suas conversas.
            </p>
            <Button
              className="mt-4 rounded-xl gap-2"
              onClick={() => handleOpenDialog()}
            >
              <Plus className="h-4 w-4" />
              Criar Primeiro Agente
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {agentsWithTemplates.map((agent, index) => (
            <div 
              key={agent.id} 
              className="glass-card p-4 sm:p-6 hover:border-primary/40 transition-all animate-fade-in"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {/* Header with switch */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                    <Bot className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">{agent.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full shrink-0 ${agent.is_active ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
                      <span className="text-[10px] sm:text-xs text-muted-foreground">
                        {agent.is_active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  </div>
                </div>
                <Switch
                  checked={agent.is_active ?? false}
                  onCheckedChange={() => handleToggleAgentActive(agent)}
                  className="data-[state=checked]:bg-success shrink-0"
                />
              </div>

              {/* Tone and Workload badges row */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {agent.tone && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] sm:text-[10px] uppercase ${toneConfig[agent.tone]?.className}`}
                  >
                    {toneConfig[agent.tone]?.label || agent.tone}
                  </Badge>
                )}
                {agentPerformance[agent.id] && agentPerformance[agent.id].leadsCount > 0 && (
                  <Badge 
                    variant="outline" 
                    className={`text-[9px] py-0 h-4 ${
                      agentPerformance[agent.id].leadsCount >= 10 
                        ? 'bg-destructive/10 text-destructive border-destructive/30' 
                        : agentPerformance[agent.id].leadsCount >= 5 
                          ? 'bg-warning/10 text-warning border-warning/30'
                          : 'bg-success/10 text-success border-success/30'
                    }`}
                  >
                    {agentPerformance[agent.id].leadsCount >= 10 ? 'Alta carga' : agentPerformance[agent.id].leadsCount >= 5 ? 'Moderada' : 'Baixa'}
                  </Badge>
                )}
              </div>

              {/* Category and Origin Badges */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {/* Category Badge */}
                {agent.category && categoryConfig[agent.category as AgentCategory] && (() => {
                  const CategoryIcon = categoryIcons[agent.category as AgentCategory];
                  return (
                    <Badge 
                      variant="outline" 
                      className={`text-[10px] gap-1 ${categoryConfig[agent.category as AgentCategory]?.className}`}
                    >
                      <CategoryIcon className="h-3 w-3" />
                      {categoryConfig[agent.category as AgentCategory]?.label}
                    </Badge>
                  );
                })()}
                
                {/* Origin Badge */}
                {agent.template ? (
                  <Badge 
                    variant="outline" 
                    className="text-[10px] bg-primary/10 text-primary border-primary/30 gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Baseado em: {agent.template.name}
                  </Badge>
                ) : (
                  <Badge 
                    variant="outline" 
                    className="text-[10px] bg-muted/50 text-muted-foreground border-border"
                  >
                    Criado do Zero
                  </Badge>
                )}

                {/* Customized Badge */}
                {agent.is_customized && agent.template && (
                  <Badge 
                    variant="outline" 
                    className="text-[10px] bg-warning/10 text-warning border-warning/30 gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Customizado
                  </Badge>
                )}
              </div>

              {/* Last Used */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                <Clock className="h-3 w-3" />
                <span>Criado {formatLastUsed(agent.created_at)}</span>
              </div>

              {/* Performance Indicators */}
              {agentPerformance[agent.id] && (
                <div className="flex items-center gap-3 mb-3 p-2 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-1.5" title="Leads atendidos">
                    <UserCheck className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-mono text-foreground">{agentPerformance[agent.id].leadsCount}</span>
                  </div>
                  <div className="h-3 w-px bg-border" />
                  <div className="flex items-center gap-1.5" title="Mensagens enviadas">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-mono text-foreground">{agentPerformance[agent.id].messagesCount}</span>
                  </div>
                  <div className="h-3 w-px bg-border" />
                  <div className="flex items-center gap-1.5" title="Taxa de conversao">
                    <Zap className={`h-3.5 w-3.5 ${agentPerformance[agent.id].conversionRate >= 50 ? 'text-success' : agentPerformance[agent.id].conversionRate >= 25 ? 'text-warning' : 'text-muted-foreground'}`} />
                    <span className="text-xs font-mono text-foreground">{agentPerformance[agent.id].conversionRate.toFixed(0)}%</span>
                  </div>
                </div>
              )}
              
              {agent.persona_prompt && (
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-3 sm:mb-4">
                  {agent.persona_prompt}
                </p>
              )}
              
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="flex-1 rounded-xl gap-1 sm:gap-2 border-border text-xs sm:text-sm"
                  onClick={() => handleOpenDialog(agent.id, agent.source)}
                >
                  <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden xs:inline">Editar</span>
                  <span className="xs:hidden">Edit</span>
                </Button>
                {agent.template && agent.is_customized && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl gap-1 border-border text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => handleOpenCompare(agent)}
                    title="Comparar com Original"
                  >
                    <GitCompare className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 rounded-xl gap-1 sm:gap-2 border-border text-destructive hover:text-destructive hover:bg-destructive/10 text-xs sm:text-sm"
                  onClick={() => handleArchiveAgent(agent.id, agent.name, agent.source)}
                >
                  <Archive className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden xs:inline">Arquivar</span>
                  <span className="xs:hidden">Arq</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compare Template Dialog */}
      {agentToCompare && agentToCompare.template && (
        <CompareTemplateDialog
          open={isCompareDialogOpen}
          onOpenChange={setIsCompareDialogOpen}
          originalPrompt={agentToCompare.template.system_prompt}
          originalTone={agentToCompare.template.tone}
          currentPrompt={agentToCompare.persona_prompt || ""}
          currentTone={agentToCompare.tone || "professional"}
          templateName={agentToCompare.template.name}
        />
      )}
    </div>
  );
};

export default Agents;
