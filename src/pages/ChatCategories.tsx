import { useState, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, Clock, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { CategoryDialog, type CategoryFormData } from "@/components/categories/CategoryDialog";
import { getCategoryIcon } from "@/components/categories/categoryIcons";

interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  priority: number | null;
  sla_minutes: number | null;
  is_active: boolean | null;
  workspace_id: string;
  assigned_agents: { id: string; name: string }[];
}

interface WorkspaceMember {
  id: string;
  name: string | null;
  email: string;
}

export default function ChatCategories() {
  const { currentWorkspace: selectedWorkspace } = useWorkspace();
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  useEffect(() => {
    if (selectedWorkspace) {
      fetchCategories();
      fetchMembers();
    }
  }, [selectedWorkspace]);

  const fetchCategories = async () => {
    if (!selectedWorkspace) return;
    
    try {
      const { data: categoriesData, error: categoriesError } = await supabase
        .from("chat_categories")
        .select("*")
        .eq("workspace_id", selectedWorkspace.id)
        .order("priority", { ascending: false });

      if (categoriesError) throw categoriesError;

      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from("category_agent_assignments")
        .select("category_id, agent_id, profiles:agent_id(id, name)")
        .eq("workspace_id", selectedWorkspace.id);

      if (assignmentsError) throw assignmentsError;

      const categoriesWithAgents = (categoriesData || []).map(cat => ({
        ...cat,
        assigned_agents: (assignmentsData || [])
          .filter(a => a.category_id === cat.id)
          .map(a => ({
            id: (a.profiles as any)?.id || a.agent_id,
            name: (a.profiles as any)?.name || "Sem nome"
          }))
      }));

      setCategories(categoriesWithAgents);
    } catch (error) {
      console.error("Error fetching categories:", error);
      toast.error("Erro ao carregar categorias");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMembers = async () => {
    if (!selectedWorkspace) return;

    try {
      const { data: membersData, error: membersError } = await supabase
        .from("workspace_members")
        .select("user_id, profiles:user_id(id, name, email)")
        .eq("workspace_id", selectedWorkspace.id)
        .eq("status", "active");

      if (membersError) throw membersError;

      const { data: workspaceData } = await supabase
        .from("workspaces")
        .select("owner_id, profiles:owner_id(id, name, email)")
        .eq("id", selectedWorkspace.id)
        .single();

      const membersList: WorkspaceMember[] = (membersData || []).map(m => ({
        id: (m.profiles as any)?.id || m.user_id,
        name: (m.profiles as any)?.name,
        email: (m.profiles as any)?.email || ""
      }));

      if (workspaceData?.owner_id) {
        const ownerExists = membersList.some(m => m.id === workspaceData.owner_id);
        if (!ownerExists) {
          membersList.unshift({
            id: (workspaceData.profiles as any)?.id || workspaceData.owner_id,
            name: (workspaceData.profiles as any)?.name,
            email: (workspaceData.profiles as any)?.email || ""
          });
        }
      }

      setMembers(membersList);
    } catch (error) {
      console.error("Error fetching members:", error);
    }
  };

  const handleSaveCategory = async (formData: CategoryFormData) => {
    if (!selectedWorkspace) return;

    try {
      if (editingCategory) {
        const { error: updateError } = await supabase
          .from("chat_categories")
          .update({
            name: formData.name,
            description: formData.description || null,
            icon: formData.icon,
            color: formData.color,
            priority: formData.priority,
            sla_minutes: formData.sla_minutes,
            is_active: formData.is_active,
          })
          .eq("id", editingCategory.id);

        if (updateError) throw updateError;

        await supabase
          .from("category_agent_assignments")
          .delete()
          .eq("category_id", editingCategory.id);

        if (formData.agent_ids.length > 0) {
          const assignments = formData.agent_ids.map((agentId, index) => ({
            category_id: editingCategory.id,
            agent_id: agentId,
            workspace_id: selectedWorkspace.id,
            is_primary: index === 0
          }));

          const { error: assignError } = await supabase
            .from("category_agent_assignments")
            .insert(assignments);

          if (assignError) throw assignError;
        }

        toast.success("Categoria atualizada com sucesso");
      } else {
        const { data: newCategory, error: insertError } = await supabase
          .from("chat_categories")
          .insert({
            name: formData.name,
            description: formData.description || null,
            icon: formData.icon,
            color: formData.color,
            priority: formData.priority,
            sla_minutes: formData.sla_minutes,
            is_active: formData.is_active,
            workspace_id: selectedWorkspace.id,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        if (formData.agent_ids.length > 0 && newCategory) {
          const assignments = formData.agent_ids.map((agentId, index) => ({
            category_id: newCategory.id,
            agent_id: agentId,
            workspace_id: selectedWorkspace.id,
            is_primary: index === 0
          }));

          const { error: assignError } = await supabase
            .from("category_agent_assignments")
            .insert(assignments);

          if (assignError) throw assignError;
        }

        toast.success("Categoria criada com sucesso");
      }

      setDialogOpen(false);
      setEditingCategory(null);
      fetchCategories();
    } catch (error) {
      console.error("Error saving category:", error);
      toast.error("Erro ao salvar categoria");
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;

    try {
      await supabase
        .from("category_agent_assignments")
        .delete()
        .eq("category_id", categoryToDelete.id);

      const { error } = await supabase
        .from("chat_categories")
        .delete()
        .eq("id", categoryToDelete.id);

      if (error) throw error;

      toast.success("Categoria excluída com sucesso");
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
      fetchCategories();
    } catch (error) {
      console.error("Error deleting category:", error);
      toast.error("Erro ao excluir categoria");
    }
  };

  const openEditDialog = (category: Category) => {
    setEditingCategory(category);
    setDialogOpen(true);
  };

  const openDeleteDialog = (category: Category) => {
    setCategoryToDelete(category);
    setDeleteDialogOpen(true);
  };

  const getPriorityLabel = (priority: number | null) => {
    switch (priority) {
      case 3: return { label: "Urgente", className: "bg-destructive/20 text-destructive" };
      case 2: return { label: "Alta", className: "bg-warning/20 text-warning" };
      case 1: return { label: "Normal", className: "bg-primary/20 text-primary" };
      default: return { label: "Baixa", className: "bg-muted text-muted-foreground" };
    }
  };

  const formatSLA = (minutes: number | null) => {
    if (!minutes) return "Sem SLA";
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  };

  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Selecione um workspace para gerenciar categorias</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Categorias de Atendimento</h1>
          <p className="text-muted-foreground">Configure categorias e atribua agentes humanos</p>
        </div>
        <Button onClick={() => { setEditingCategory(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Categoria
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="glass-card animate-pulse">
              <CardHeader className="h-24 bg-muted/20 rounded-t-lg" />
              <CardContent className="h-32" />
            </Card>
          ))}
        </div>
      ) : categories.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhuma categoria criada</h3>
            <p className="text-muted-foreground text-center mb-4">
              Crie categorias para organizar e rotear atendimentos
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeira Categoria
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map(category => {
            const IconComponent = getCategoryIcon(category.icon);
            const priority = getPriorityLabel(category.priority);
            
            return (
              <Card 
                key={category.id} 
                className={`glass-card hover:border-primary/50 transition-all ${!category.is_active ? 'opacity-60' : ''}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div 
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${category.color}20` }}
                      >
                        <IconComponent 
                          className="h-5 w-5" 
                          style={{ color: category.color || 'var(--primary)' }}
                        />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{category.name}</CardTitle>
                        {!category.is_active && (
                          <Badge variant="secondary" className="mt-1 text-xs">Inativo</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => openEditDialog(category)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => openDeleteDialog(category)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {category.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {category.description}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={priority.className}>
                      {priority.label}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Clock className="h-3 w-3" />
                      {formatSLA(category.sla_minutes)}
                    </Badge>
                  </div>

                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      {category.assigned_agents.length > 0 ? (
                        <span>
                          {category.assigned_agents.slice(0, 3).map(a => a.name || "Sem nome").join(", ")}
                          {category.assigned_agents.length > 3 && ` +${category.assigned_agents.length - 3}`}
                        </span>
                      ) : (
                        <span className="italic">Sem membros designados</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingCategory(null);
        }}
        onSave={handleSaveCategory}
        category={editingCategory}
        members={members}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Categoria</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a categoria "{categoryToDelete?.name}"? 
              Esta ação não pode ser desfeita e removerá todas as atribuições de agentes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteCategory}
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
