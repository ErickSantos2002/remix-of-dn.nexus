import { useState, useEffect } from "react";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  BarChart3,
  Eye,
  EyeOff,
  Star,
  Loader2,
  Briefcase,
  HeadphonesIcon,
  Users,
  Megaphone,
  Globe,
  Bot,
  type LucideIcon,
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tone: string;
  icon: string | null;
  system_prompt: string;
  version: number | null;
  is_published: boolean | null;
  usage_count: number | null;
  rating: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TemplateAnalytics {
  totalClones: number;
  uniqueTenants: number;
  rating: number;
}

type AgentCategory = "Vendas" | "Suporte" | "RH" | "Marketing" | "Geral";

const CATEGORIES: AgentCategory[] = ["Vendas", "Suporte", "RH", "Marketing", "Geral"];
const TONES = [
  { value: "friendly", label: "Amigável" },
  { value: "professional", label: "Profissional" },
  { value: "aggressive", label: "Agressivo" },
];

// Icon mapping for categories
const categoryIcons: Record<AgentCategory, LucideIcon> = {
  Vendas: Briefcase,
  Suporte: HeadphonesIcon,
  RH: Users,
  Marketing: Megaphone,
  Geral: Globe,
};

const categoryConfig: Record<AgentCategory, { label: string; className: string }> = {
  Vendas: { label: "Vendas", className: "bg-success/20 text-success border-success/30" },
  Suporte: { label: "Suporte", className: "bg-primary/20 text-primary border-primary/30" },
  RH: { label: "RH", className: "bg-series-4/20 text-series-4 border-series-4/30" },
  Marketing: { label: "Marketing", className: "bg-series-3/20 text-series-3 border-series-3/30" },
  Geral: { label: "Geral", className: "bg-muted text-muted-foreground border-border" },
};

// Get icon component for a category
const getCategoryIcon = (category: string | null): LucideIcon => {
  if (category && category in categoryIcons) {
    return categoryIcons[category as AgentCategory];
  }
  return Bot;
};

export default function AdminTemplates() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userId } = useUserRole();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [analytics, setAnalytics] = useState<TemplateAnalytics | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "Geral",
    tone: "professional",
    icon: "Geral",
    system_prompt: "",
    is_published: false,
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_templates")
        .select("*")
        .order("name");

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os templates.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchAnalytics(templateId: string) {
    try {
      // Count clones (agent_instances with this template_id)
      const { data: instances, error: instancesError } = await supabase
        .from("agents")
        .select("id, workspace_id")
        .eq("template_id", templateId);

      if (instancesError) throw instancesError;

      const totalClones = instances?.length || 0;
      const uniqueTenants = new Set(instances?.map((i) => i.workspace_id)).size;

      // Get template rating
      const template = templates.find((t) => t.id === templateId);
      const rating = template?.rating || 0;

      setAnalytics({
        totalClones,
        uniqueTenants,
        rating: Number(rating),
      });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      setAnalytics({ totalClones: 0, uniqueTenants: 0, rating: 0 });
    }
  }

  function openCreateDialog() {
    setSelectedTemplate(null);
    setFormData({
      name: "",
      description: "",
      category: "Geral",
      tone: "professional",
      icon: "Geral",
      system_prompt: "",
      is_published: false,
    });
    setIsEditorOpen(true);
  }

  function openEditDialog(template: Template) {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      category: template.category || "Geral",
      tone: template.tone,
      icon: template.icon || template.category || "Geral",
      system_prompt: template.system_prompt,
      is_published: template.is_published || false,
    });
    setIsEditorOpen(true);
  }

  function openAnalyticsModal(template: Template) {
    setSelectedTemplate(template);
    fetchAnalytics(template.id);
    setIsAnalyticsOpen(true);
  }

  function openDeleteDialog(template: Template) {
    setSelectedTemplate(template);
    setIsDeleteDialogOpen(true);
  }

  async function handleSave() {
    if (!formData.name.trim() || !formData.system_prompt.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e System Prompt são obrigatórios.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      if (selectedTemplate) {
        // Update existing template - increment version
        const newVersion = (selectedTemplate.version || 1) + 1;
        const { error } = await supabase
          .from("agent_templates")
          .update({
            name: formData.name,
            description: formData.description,
            category: formData.category,
            tone: formData.tone,
            icon: formData.icon,
            system_prompt: formData.system_prompt,
            is_published: formData.is_published,
            version: newVersion,
            updated_at: new Date().toISOString(),
          })
          .eq("id", selectedTemplate.id);

        if (error) throw error;

        toast({
          title: "Template atualizado",
          description: `Versão ${newVersion} salva com sucesso!`,
        });
      } else {
        // Create new template
        const { error } = await supabase.from("agent_templates").insert({
          name: formData.name,
          description: formData.description,
          category: formData.category,
          tone: formData.tone,
          icon: formData.icon,
          system_prompt: formData.system_prompt,
          is_published: formData.is_published,
          version: 1,
          created_by: userId,
        });

        if (error) throw error;

        toast({
          title: "Template criado",
          description: "Template salvo com sucesso!",
        });
      }

      setIsEditorOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error("Error saving template:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar o template.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedTemplate) return;

    try {
      const { error } = await supabase
        .from("agent_templates")
        .delete()
        .eq("id", selectedTemplate.id);

      if (error) throw error;

      toast({
        title: "Template deletado",
        description: "Template removido com sucesso.",
      });

      setIsDeleteDialogOpen(false);
      fetchTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast({
        title: "Erro",
        description: "Não foi possível deletar o template.",
        variant: "destructive",
      });
    }
  }

  async function togglePublish(template: Template) {
    try {
      const { error } = await supabase
        .from("agent_templates")
        .update({
          is_published: !template.is_published,
          updated_at: new Date().toISOString(),
        })
        .eq("id", template.id);

      if (error) throw error;

      toast({
        title: "Status atualizado",
        description: template.is_published
          ? "Template despublicado."
          : "Template publicado!",
      });

      fetchTemplates();
    } catch (error) {
      console.error("Error toggling publish:", error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o status.",
        variant: "destructive",
      });
    }
  }

  function getCategoryLabel(category: string | null) {
    if (category && category in categoryConfig) {
      return categoryConfig[category as AgentCategory].label;
    }
    return category || "Geral";
  }

  function renderCategoryBadge(category: string | null) {
    const cat = (category || "Geral") as AgentCategory;
    const config = categoryConfig[cat];
    const IconComponent = categoryIcons[cat] || Bot;
    
    if (!config) {
      return <Badge variant="secondary">{category}</Badge>;
    }
    
    return (
      <Badge variant="outline" className={`${config.className} gap-1`}>
        <IconComponent className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="p-4 pb-0">
        <Breadcrumbs />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/agents")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              Gerenciamento de Templates
            </h1>
            <p className="text-sm text-muted-foreground">
              Gerencie templates globais de agentes
            </p>
          </div>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Criar Novo Template
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Nenhum template encontrado.
            </p>
            <Button onClick={openCreateDialog}>Criar Primeiro Template</Button>
          </div>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-center">Versão</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Clones</TableHead>
                  <TableHead className="text-center">Rating</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {(() => {
                          const IconComponent = getCategoryIcon(template.category);
                          return (
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                              <IconComponent className="h-4 w-4 text-primary" />
                            </div>
                          );
                        })()}
                        <span className="font-medium">{template.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {renderCategoryBadge(template.category)}
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      v{template.version || 1}
                    </TableCell>
                    <TableCell className="text-center">
                      {template.is_published ? (
                        <Badge className="bg-success/20 text-success border-success/30">
                          Publicado
                        </Badge>
                      ) : (
                        <Badge variant="outline">Rascunho</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      {template.usage_count || 0}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Star className="h-3 w-3 text-warning fill-warning" />
                        <span className="font-mono text-sm">
                          {Number(template.rating || 0).toFixed(1)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => togglePublish(template)}
                          title={
                            template.is_published ? "Despublicar" : "Publicar"
                          }
                        >
                          {template.is_published ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openAnalyticsModal(template)}
                          title="Ver Analytics"
                        >
                          <BarChart3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(template)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteDialog(template)}
                          title="Deletar"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedTemplate ? "Editar Template" : "Criar Novo Template"}
            </DialogTitle>
            <DialogDescription>
              {selectedTemplate
                ? `Editando versão ${selectedTemplate.version || 1}`
                : "Preencha os campos para criar um novo template de agente."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Nome *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="col-span-3"
                placeholder="Ex: Sales Pro"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">
                Descrição
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="col-span-3"
                placeholder="Breve descrição do template..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right">
                Categoria
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  setFormData({ ...formData, category: value, icon: value })
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => {
                    const IconComponent = categoryIcons[cat];
                    return (
                      <SelectItem key={cat} value={cat}>
                        <span className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4" />
                          {getCategoryLabel(cat)}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tone" className="text-right">
                Tom de Voz
              </Label>
              <Select
                value={formData.tone}
                onValueChange={(value) =>
                  setFormData({ ...formData, tone: value })
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((tone) => (
                    <SelectItem key={tone.value} value={tone.value}>
                      {tone.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="system_prompt" className="text-right pt-2">
                System Prompt *
              </Label>
              <Textarea
                id="system_prompt"
                value={formData.system_prompt}
                onChange={(e) =>
                  setFormData({ ...formData, system_prompt: e.target.value })
                }
                className="col-span-3"
                placeholder="Instruções detalhadas para o agente..."
                rows={6}
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Status</Label>
              <RadioGroup
                value={formData.is_published ? "published" : "draft"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    is_published: value === "published",
                  })
                }
                className="col-span-3 flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="draft" id="draft" />
                  <Label htmlFor="draft" className="font-normal">
                    Rascunho
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="published" id="published" />
                  <Label htmlFor="published" className="font-normal">
                    Publicado
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditorOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analytics Modal */}
      <Dialog open={isAnalyticsOpen} onOpenChange={setIsAnalyticsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Analytics: {selectedTemplate?.name}
            </DialogTitle>
          </DialogHeader>

          {analytics ? (
            <div className="grid gap-4 py-4">
              <div className="glass-card p-4 text-center">
                <p className="text-sm text-muted-foreground">Tenants Usando</p>
                <p className="text-3xl font-mono font-bold text-primary">
                  {analytics.uniqueTenants}
                </p>
              </div>

              <div className="glass-card p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Total de Clones
                </p>
                <p className="text-3xl font-mono font-bold text-foreground">
                  {analytics.totalClones}
                </p>
              </div>

              <div className="glass-card p-4 text-center">
                <p className="text-sm text-muted-foreground">Rating Médio</p>
                <div className="flex items-center justify-center gap-2">
                  <Star className="h-6 w-6 text-warning fill-warning" />
                  <p className="text-3xl font-mono font-bold text-foreground">
                    {analytics.rating.toFixed(1)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setIsAnalyticsOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar o template "
              {selectedTemplate?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
