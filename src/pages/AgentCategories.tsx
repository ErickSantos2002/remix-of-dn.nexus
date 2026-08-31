import { useState, useEffect } from "react";
import {
  Plus, Search, Pencil, Trash2, Loader2, Shield, FolderOpen,
  DollarSign, Headphones, Users, Megaphone, Globe, Calendar,
  Scale, CreditCard, Wrench, Handshake, Tag
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";

interface AgentCategory {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  agent_count?: number;
}

const ICON_OPTIONS = [
  { id: "dollar-sign", Icon: DollarSign, label: "Vendas" },
  { id: "headphones", Icon: Headphones, label: "Suporte" },
  { id: "users", Icon: Users, label: "RH" },
  { id: "megaphone", Icon: Megaphone, label: "Marketing" },
  { id: "globe", Icon: Globe, label: "Geral" },
  { id: "calendar", Icon: Calendar, label: "Eventos" },
  { id: "scale", Icon: Scale, label: "Jurídico" },
  { id: "credit-card", Icon: CreditCard, label: "Financeiro" },
  { id: "wrench", Icon: Wrench, label: "Técnico" },
  { id: "handshake", Icon: Handshake, label: "Parcerias" },
  { id: "tag", Icon: Tag, label: "Outro" },
];

const COLOR_OPTIONS = [
  // excecao DS: cor e dado do usuario, nao token de tema
  "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#6B7280",
  "#F59E0B", "#14B8A6", "#EF4444", "#64748B", "#A855F7",
];

const getIconComponent = (iconId: string) => {
  const found = ICON_OPTIONS.find(i => i.id === iconId);
  return found?.Icon || FolderOpen;
};

export default function AgentCategories() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [categories, setCategories] = useState<AgentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AgentCategory | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<AgentCategory | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form states
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIcon, setFormIcon] = useState("folder");
  const [formColor, setFormColor] = useState("#FF8000");

  useEffect(() => {
    if (workspaceId) {
      fetchCategories();
    }
  }, [workspaceId]);

  const fetchCategories = async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      // Fetch categories
      const { data: cats, error } = await supabase
        .from("agent_categories")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("is_system", { ascending: false })
        .order("name");

      if (error) throw error;

      // Count agents per category
      const { data: legacyAgents } = await supabase
        .from("agents")
        .select("category_id")
        .eq("workspace_id", workspaceId);

      const { data: instanceAgents } = await supabase
        .from("agent_instances")
        .select("category_id")
        .eq("workspace_id", workspaceId);

      const agentCounts: Record<string, number> = {};
      [...(legacyAgents || []), ...(instanceAgents || [])].forEach((a) => {
        if (a.category_id) {
          agentCounts[a.category_id] = (agentCounts[a.category_id] || 0) + 1;
        }
      });

      setCategories(
        (cats || []).map((c) => ({
          ...c,
          agent_count: agentCounts[c.id] || 0,
        }))
      );
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar categorias",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingCategory(null);
    setFormName("");
    setFormSlug("");
    setFormDescription("");
    setFormIcon("folder");
    setFormColor("#FF8000");
    setDialogOpen(true);
  };

  const openEditDialog = (category: AgentCategory) => {
    setEditingCategory(category);
    setFormName(category.name);
    setFormSlug(category.slug);
    setFormDescription(category.description || "");
    setFormIcon(category.icon);
    setFormColor(category.color);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!workspaceId || !formName.trim() || !formSlug.trim()) return;

    setSaving(true);
    try {
      const slug = formSlug.toUpperCase().replace(/\s+/g, "_");

      if (editingCategory) {
        const { error } = await supabase
          .from("agent_categories")
          .update({
            name: formName.trim(),
            slug,
            description: formDescription.trim() || null,
            icon: formIcon,
            color: formColor,
          })
          .eq("id", editingCategory.id);

        if (error) throw error;
        toast({ title: "Categoria atualizada" });
      } else {
        const { error } = await supabase.from("agent_categories").insert({
          workspace_id: workspaceId,
          name: formName.trim(),
          slug,
          description: formDescription.trim() || null,
          icon: formIcon,
          color: formColor,
          is_system: false,
        });

        if (error) throw error;
        toast({ title: "Categoria criada" });
      }

      setDialogOpen(false);
      fetchCategories();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!categoryToDelete) return;

    try {
      const { error } = await supabase
        .from("agent_categories")
        .delete()
        .eq("id", categoryToDelete.id);

      if (error) throw error;
      toast({ title: "Categoria excluída" });
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
      fetchCategories();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error.message,
      });
    }
  };

  const filteredCategories = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const generateSlug = (name: string) => {
    return name.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
  };

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Categorias de Agentes</h1>
          <p className="text-muted-foreground text-sm">
            Gerencie as categorias que definem a especialização dos agentes
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Categoria
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar categorias..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-secondary border-border"
        />
      </div>

      {/* Categories Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma categoria encontrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCategories.map((category) => {
            const IconComp = getIconComponent(category.icon);
            return (
              <div
                key={category.id}
                className="glass-card p-4 rounded-xl border border-border hover:border-primary/30 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${category.color}20` }}
                  >
                    <IconComp className="h-5 w-5" style={{ color: category.color }} />
                  </div>
                  <div className="flex items-center gap-1">
                    {category.is_system && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Shield className="h-3 w-3" />
                        Sistema
                      </Badge>
                    )}
                  </div>
                </div>

                <h3 className="font-semibold text-foreground mb-1">{category.name}</h3>
                <p className="text-xs text-muted-foreground mb-2 font-mono">{category.slug}</p>
                {category.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {category.description}
                  </p>
                )}

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">
                    {category.agent_count || 0} agente{(category.agent_count || 0) !== 1 ? "s" : ""}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(category)}
                      className="h-8 w-8 p-0"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!category.is_system && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCategoryToDelete(category);
                          setDeleteDialogOpen(true);
                        }}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px] glass-card">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Editar Categoria" : "Nova Categoria"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Atualize as informações da categoria"
                : "Crie uma nova categoria para organizar seus agentes"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  if (!editingCategory) {
                    setFormSlug(generateSlug(e.target.value));
                  }
                }}
                placeholder="Ex: Eventos Premium"
                className="bg-secondary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Slug (identificador) *</Label>
              <Input
                id="slug"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value.toUpperCase())}
                placeholder="Ex: EVENTOS_PREMIUM"
                className="bg-secondary font-mono"
                disabled={editingCategory?.is_system}
              />
              <p className="text-xs text-muted-foreground">
                Usado internamente para identificação
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descrição da categoria..."
                className="bg-secondary"
              />
            </div>

            <div className="space-y-2">
              <Label>Ícone</Label>
              <div className="grid grid-cols-6 gap-2">
                {ICON_OPTIONS.map(({ id, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFormIcon(id)}
                    className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center transition-all",
                      formIcon === id
                        ? "bg-primary/20 border-2 border-primary"
                        : "bg-secondary hover:bg-muted border-2 border-transparent"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        formIcon === id ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormColor(color)}
                    className={cn(
                      "h-8 w-8 rounded-full transition-all",
                      formColor === color
                        ? "ring-2 ring-offset-2 ring-offset-background ring-primary"
                        : "hover:scale-110"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formName.trim() || !formSlug.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="glass-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Categoria</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a categoria "{categoryToDelete?.name}"?
              {(categoryToDelete?.agent_count || 0) > 0 && (
                <span className="block mt-2 text-warning">
                  Atenção: Esta categoria possui {categoryToDelete?.agent_count} agente(s) associado(s).
                  Eles ficarão sem categoria.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
