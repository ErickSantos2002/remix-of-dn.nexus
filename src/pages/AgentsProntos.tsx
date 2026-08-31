import { useState, useEffect } from "react";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { 
  ArrowLeft, 
  Store, 
  Star, 
  Download, 
  Search, 
  Filter, 
  Bot, 
  Loader2,
  Briefcase,
  HeadphonesIcon,
  Users,
  Megaphone,
  Globe,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type AgentCategory = "Vendas" | "Suporte" | "RH" | "Marketing" | "Geral";
type AgentTone = "friendly" | "professional" | "aggressive";
type SortOption = "popular" | "newest" | "rating";

interface AgentTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  tone: string;
  category: AgentCategory | null;
  icon: string | null;
  rating: number | null;
  usage_count: number | null;
  created_at: string | null;
  is_published: boolean | null;
}

// Icon mapping for categories
const categoryIcons: Record<AgentCategory, LucideIcon> = {
  Vendas: Briefcase,
  Suporte: HeadphonesIcon,
  RH: Users,
  Marketing: Megaphone,
  Geral: Globe,
};

// Mock data for templates (fallback only)
const mockTemplates: AgentTemplate[] = [
  {
    id: "mock-1",
    name: "Sales Pro",
    description: "Agente especializado em vendas B2B. Qualifica leads, apresenta produtos e fecha deals.",
    system_prompt: "Você é um agente de vendas B2B experiente. Seu objetivo é qualificar leads, entender suas necessidades e apresentar soluções que resolvam seus problemas. Sempre seja profissional, consultivo e focado em valor.",
    category: "Vendas",
    tone: "professional",
    icon: "Vendas",
    rating: 4.8,
    usage_count: 1250,
    created_at: new Date().toISOString(),
    is_published: true,
  },
  {
    id: "mock-2",
    name: "Support Hero",
    description: "Agente de suporte técnico que resolve problemas rapidamente e com empatia.",
    system_prompt: "Você é um agente de suporte técnico amigável e eficiente. Seu objetivo é resolver problemas dos clientes rapidamente, com empatia e clareza. Sempre explique em linguagem simples.",
    category: "Suporte",
    tone: "friendly",
    icon: "Suporte",
    rating: 4.6,
    usage_count: 890,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    is_published: true,
  },
  {
    id: "mock-3",
    name: "HR Recruiter",
    description: "Agente de RH que qualifica candidatos e responde perguntas sobre vagas.",
    system_prompt: "Você é um agente de RH profissional. Seu objetivo é qualificar candidatos, responder perguntas sobre vagas e processos de seleção. Seja acolhedor e informativo.",
    category: "RH",
    tone: "professional",
    icon: "RH",
    rating: 4.4,
    usage_count: 560,
    created_at: new Date(Date.now() - 172800000).toISOString(),
    is_published: true,
  },
  {
    id: "mock-4",
    name: "Marketing Guru",
    description: "Agente de marketing que promove produtos e responde sobre campanhas.",
    system_prompt: "Você é um agente de marketing criativo e entusiasmado. Seu objetivo é promover produtos, explicar campanhas e engajar clientes. Seja entusiasmado e inspirador.",
    category: "Marketing",
    tone: "friendly",
    icon: "Marketing",
    rating: 4.5,
    usage_count: 720,
    created_at: new Date(Date.now() - 259200000).toISOString(),
    is_published: true,
  },
  {
    id: "mock-5",
    name: "General Assistant",
    description: "Agente genérico para perguntas gerais e informações diversas.",
    system_prompt: "Você é um assistente geral amigável e prestativo. Seu objetivo é responder perguntas gerais, fornecer informações e ajudar com tarefas diversas. Seja útil e acessível.",
    category: "Geral",
    tone: "friendly",
    icon: "Geral",
    rating: 4.3,
    usage_count: 450,
    created_at: new Date(Date.now() - 345600000).toISOString(),
    is_published: true,
  },
];

const categoryConfig: Record<AgentCategory, { label: string; className: string }> = {
  Vendas: { label: "Vendas", className: "bg-success/20 text-success border-success/30" },
  Suporte: { label: "Suporte", className: "bg-primary/20 text-primary border-primary/30" },
  RH: { label: "RH", className: "bg-series-4/20 text-series-4 border-series-4/30" },
  Marketing: { label: "Marketing", className: "bg-series-3/20 text-series-3 border-series-3/30" },
  Geral: { label: "Geral", className: "bg-muted text-muted-foreground border-border" },
};

const toneLabels: Record<AgentTone, string> = {
  friendly: "Amigável",
  professional: "Profissional",
  aggressive: "Agressivo",
};

// Helper function to get icon component for a template
const getTemplateIcon = (template: AgentTemplate): LucideIcon => {
  // If the icon matches a category key, use the category icon
  if (template.icon && template.icon in categoryIcons) {
    return categoryIcons[template.icon as AgentCategory];
  }
  // Otherwise use the category icon or default to Bot
  if (template.category && template.category in categoryIcons) {
    return categoryIcons[template.category];
  }
  return Bot;
};

// Render category icon in badge
const renderCategoryBadge = (category: AgentCategory) => {
  const config = categoryConfig[category];
  const IconComponent = categoryIcons[category];
  if (!config || !IconComponent) {
    return null;
  }
  return (
    <Badge variant="outline" className={`${config.className} gap-1`}>
      <IconComponent className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};

const AgentsProntos = () => {
  const navigate = useNavigate();
  const { workspaces, workspaceId, refetchAgents } = useWorkspace();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("popular");
  const [searchQuery, setSearchQuery] = useState("");

  // Detail modal state
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Install dialog state
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [installName, setInstallName] = useState("");
  const [installWorkspaceId, setInstallWorkspaceId] = useState("");
  const [addKnowledgeBase, setAddKnowledgeBase] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // Fetch templates from database or use mock data
  useEffect(() => {
    const fetchTemplates = async () => {
      setIsLoading(true);
      
      const { data, error } = await supabase
        .from("agent_templates")
        .select("*")
        .eq("is_published", true)
        .order("usage_count", { ascending: false });

      if (error) {
        console.error("Error fetching templates:", error);
        // Use mock data if no real templates
        setTemplates(mockTemplates);
      } else if (data && data.length > 0) {
        setTemplates(data as AgentTemplate[]);
      } else {
        // Use mock data if empty
        setTemplates(mockTemplates);
      }
      
      setIsLoading(false);
    };

    fetchTemplates();
  }, []);

  // Set default workspace when workspaces load
  useEffect(() => {
    if (workspaces.length > 0 && !installWorkspaceId) {
      setInstallWorkspaceId(workspaceId || workspaces[0].id);
    }
  }, [workspaces, workspaceId, installWorkspaceId]);

  // Filter and sort templates
  const filteredTemplates = templates
    .filter((t) => {
      // Category filter
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          t.name.toLowerCase().includes(query) ||
          (t.description?.toLowerCase().includes(query) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "popular":
          return (b.usage_count || 0) - (a.usage_count || 0);
        case "newest":
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        case "rating":
          return (b.rating || 0) - (a.rating || 0);
        default:
          return 0;
      }
    });

  const handleViewDetails = (template: AgentTemplate) => {
    setSelectedTemplate(template);
    setIsDetailOpen(true);
  };

  const handleOpenInstall = () => {
    if (!selectedTemplate) return;
    setInstallName(selectedTemplate.name);
    setInstallWorkspaceId(workspaceId || workspaces[0]?.id || "");
    setAddKnowledgeBase(false);
    setIsDetailOpen(false);
    setIsInstallOpen(true);
  };

  const handleInstall = async () => {
    if (!selectedTemplate || !installWorkspaceId || !installName.trim()) {
      toast({
        variant: "destructive",
        title: "Dados incompletos",
        description: "Preencha todos os campos obrigatórios.",
      });
      return;
    }

    setIsInstalling(true);

    // Clone template to agent_instances table
    const templateId = selectedTemplate.id.startsWith("mock-") ? null : selectedTemplate.id;
    
    const { error } = await supabase.from("agent_instances").insert({
      name: installName.trim(),
      workspace_id: installWorkspaceId,
      template_id: templateId,
      system_prompt: selectedTemplate.system_prompt,
      tone: selectedTemplate.tone,
      icon: selectedTemplate.icon || selectedTemplate.category,
      is_customized: false,
      is_active: true,
      is_archived: false,
    });

    if (error) {
      console.error("Error activating agent to agent_instances:", error);
      toast({
        variant: "destructive",
        title: "Erro ao ativar",
        description: error.message,
      });
      setIsInstalling(false);
      return;
    }

    // Update usage count (only for real templates)
    if (templateId) {
      await supabase
        .from("agent_templates")
        .update({ usage_count: (selectedTemplate.usage_count || 0) + 1 })
        .eq("id", selectedTemplate.id);
    }

    toast({
      title: "Agente ativado com sucesso!",
      description: `O agente "${installName}" foi adicionado ao seu workspace.`,
    });

    setIsInstallOpen(false);
    setSelectedTemplate(null);
    await refetchAgents();
    
    // Navigate to agents page
    navigate("/agents");
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-warning text-warning" />
        <span className="text-sm font-medium text-foreground">{rating.toFixed(1)}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-6 pt-4">
        <Breadcrumbs />
      </div>
      {/* Header */}
      <header className="glass-card border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/agents")}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 glow-primary">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Agentes Prontos</h1>
              <p className="text-sm text-muted-foreground">
                Descubra e ative agentes prontos para usar
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-muted/50 border-border"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-48 bg-muted/50 border-border">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Categorias</SelectItem>
              <SelectItem value="Vendas">
                <span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Vendas</span>
              </SelectItem>
              <SelectItem value="Suporte">
                <span className="flex items-center gap-2"><HeadphonesIcon className="h-4 w-4" /> Suporte</span>
              </SelectItem>
              <SelectItem value="RH">
                <span className="flex items-center gap-2"><Users className="h-4 w-4" /> RH</span>
              </SelectItem>
              <SelectItem value="Marketing">
                <span className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Marketing</span>
              </SelectItem>
              <SelectItem value="Geral">
                <span className="flex items-center gap-2"><Globe className="h-4 w-4" /> Geral</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-44 bg-muted/50 border-border">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Mais Popular</SelectItem>
              <SelectItem value="newest">Mais Novo</SelectItem>
              <SelectItem value="rating">Melhor Avaliado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum template encontrado</h3>
            <p className="text-sm text-muted-foreground">
              Tente ajustar os filtros ou buscar por outro termo.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <Card
                key={template.id}
                className="glass-card hover:border-primary/30 transition-all duration-200 cursor-pointer group"
                onClick={() => handleViewDetails(template)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const IconComponent = getTemplateIcon(template);
                        return (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                            <IconComponent className="h-6 w-6 text-primary" />
                          </div>
                        );
                      })()}
                      <div>
                        <CardTitle className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                          {template.name}
                        </CardTitle>
                        {template.category && renderCategoryBadge(template.category)}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <CardDescription className="text-sm text-muted-foreground line-clamp-2">
                    {template.description || "Sem descrição disponível."}
                  </CardDescription>
                </CardContent>
                <CardFooter className="flex items-center justify-between pt-3 border-t border-border/50">
                  <div className="flex items-center gap-4">
                    {renderStars(template.rating || 0)}
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Download className="h-3.5 w-3.5" />
                      <span className="text-xs">{template.usage_count || 0}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-primary hover:text-primary hover:bg-primary/10">
                    Ver Detalhes
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto glass-card border-border">
          {selectedTemplate && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  {(() => {
                    const IconComponent = getTemplateIcon(selectedTemplate);
                    return (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                        <IconComponent className="h-8 w-8 text-primary" />
                      </div>
                    );
                  })()}
                  <div>
                    <DialogTitle className="text-xl font-bold text-foreground">
                      {selectedTemplate.name}
                    </DialogTitle>
                    <div className="flex items-center gap-3 mt-2">
                      {selectedTemplate.category && renderCategoryBadge(selectedTemplate.category)}
                      <Badge variant="secondary">
                        {toneLabels[selectedTemplate.tone as AgentTone] || selectedTemplate.tone}
                      </Badge>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Stats */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Star className="h-5 w-5 fill-warning text-warning" />
                    <span className="font-medium text-foreground">
                      {(selectedTemplate.rating || 0).toFixed(1)}/5
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Download className="h-5 w-5" />
                    <span>{selectedTemplate.usage_count || 0} instalações</span>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Descrição</Label>
                  <p className="mt-1 text-foreground">
                    {selectedTemplate.description || "Sem descrição disponível."}
                  </p>
                </div>

                {/* System Prompt */}
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">System Prompt</Label>
                  <Textarea
                    value={selectedTemplate.system_prompt}
                    readOnly
                    className="mt-1 h-32 resize-none bg-muted/50 border-border text-muted-foreground"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                  Fechar
                </Button>
                <Button onClick={handleOpenInstall} className="glow-primary">
                  <Download className="h-4 w-4 mr-2" />
                  Ativar neste Workspace
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Activate Dialog */}
      <Dialog open={isInstallOpen} onOpenChange={setIsInstallOpen}>
        <DialogContent className="glass-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Ativar Agente</DialogTitle>
            <DialogDescription>
              Configure o agente antes de ativar no seu workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Nome do Agente</Label>
              <Input
                id="agent-name"
                value={installName}
                onChange={(e) => setInstallName(e.target.value)}
                placeholder="Nome do agente"
                className="bg-muted/50 border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace">Workspace</Label>
              <Select value={installWorkspaceId} onValueChange={setInstallWorkspaceId}>
                <SelectTrigger className="bg-muted/50 border-border">
                  <SelectValue placeholder="Selecione um workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="add-kb"
                checked={addKnowledgeBase}
                onCheckedChange={(checked) => setAddKnowledgeBase(checked as boolean)}
              />
              <Label htmlFor="add-kb" className="text-sm text-muted-foreground cursor-pointer">
                Adicionar base de conhecimento agora?
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInstallOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleInstall} disabled={isInstalling} className="glow-primary">
              {isInstalling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentsProntos;
