import { useState } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Loader2, 
  Plus, 
  Pencil, 
  Trash2, 
  Layers, 
  Star,
  Building2
} from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_default: boolean;
  created_at: string;
}

const WorkspacesSettings = () => {
  const { currentCompany, companyId, isOwner, isAdmin } = useCompany();
  const { workspaces, workspaceId, setWorkspaceId, refetchWorkspaces, isLoading } = useWorkspace();
  const { toast } = useToast();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");

  const canManage = isOwner || isAdmin;

  const handleCreate = async () => {
    if (!name.trim() || !companyId) return;

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario nao autenticado");

      const { data, error } = await supabase
        .from("workspaces")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
          company_id: companyId,
          owner_id: user.id,
          is_default: false,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Workspace criado",
        description: `"${name}" foi criado com sucesso.`,
      });

      resetForm();
      setShowCreateDialog(false);
      await refetchWorkspaces();
      
      if (data) {
        setWorkspaceId(data.id);
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar workspace",
        description: err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingWorkspace || !name.trim()) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("workspaces")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
        })
        .eq("id", editingWorkspace.id);

      if (error) throw error;

      toast({
        title: "Workspace atualizado",
        description: "As alteracoes foram salvas.",
      });

      resetForm();
      setEditingWorkspace(null);
      await refetchWorkspaces();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar workspace",
        description: err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingWorkspace) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("workspaces")
        .delete()
        .eq("id", deletingWorkspace.id);

      if (error) throw error;

      toast({
        title: "Workspace excluido",
        description: `"${deletingWorkspace.name}" foi removido.`,
      });

      setDeletingWorkspace(null);
      await refetchWorkspaces();

      // If deleted current workspace, switch to another
      if (deletingWorkspace.id === workspaceId && workspaces.length > 1) {
        const remaining = workspaces.filter(w => w.id !== deletingWorkspace.id);
        if (remaining.length > 0) {
          setWorkspaceId(remaining[0].id);
        }
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir workspace",
        description: err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (workspace: Workspace) => {
    try {
      // Remove default from all workspaces of this company
      await supabase
        .from("workspaces")
        .update({ is_default: false })
        .eq("company_id", companyId);

      // Set new default
      const { error } = await supabase
        .from("workspaces")
        .update({ is_default: true })
        .eq("id", workspace.id);

      if (error) throw error;

      toast({
        title: "Workspace padrao definido",
        description: `"${workspace.name}" agora e o workspace padrao.`,
      });

      await refetchWorkspaces();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: err.message,
      });
    }
  };

  const openEditDialog = (workspace: Workspace) => {
    setName(workspace.name);
    setDescription(workspace.description || "");
    setIcon(workspace.icon || "");
    setEditingWorkspace(workspace);
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setIcon("");
  };

  const handleCloseDialog = () => {
    resetForm();
    setShowCreateDialog(false);
    setEditingWorkspace(null);
  };

  if (!currentCompany) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Nenhuma empresa selecionada</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Workspaces</h1>
          <p className="text-muted-foreground">
            Gerencie os workspaces da empresa "{currentCompany.name}"
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Workspace
          </Button>
        )}
      </div>

      {/* Workspaces List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : workspaces.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Nenhum workspace
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              Crie um workspace para organizar seus agentes e leads.
            </p>
            {canManage && (
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Workspace
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {workspaces.map((workspace) => (
            <Card 
              key={workspace.id} 
              className={`glass-card transition-all ${
                workspace.id === workspaceId ? "ring-2 ring-primary" : ""
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold">
                      {workspace.icon || workspace.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {workspace.name}
                        {workspace.is_default && (
                          <Badge variant="secondary" className="text-xs">
                            <Star className="h-3 w-3 mr-1" />
                            Padrao
                          </Badge>
                        )}
                        {workspace.id === workspaceId && (
                          <Badge className="text-xs">Ativo</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {workspace.description || "Sem descricao"}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {workspace.id !== workspaceId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWorkspaceId(workspace.id)}
                      >
                        Selecionar
                      </Button>
                    )}
                    {canManage && (
                      <>
                        {!workspace.is_default && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSetDefault(workspace)}
                            title="Definir como padrao"
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(workspace)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {workspaces.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeletingWorkspace(workspace)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog 
        open={showCreateDialog || !!editingWorkspace} 
        onOpenChange={handleCloseDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingWorkspace ? "Editar Workspace" : "Novo Workspace"}
            </DialogTitle>
            <DialogDescription>
              {editingWorkspace 
                ? "Atualize as informacoes do workspace."
                : "Crie um novo workspace para organizar seus agentes."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">Nome *</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Vendas, Suporte, Marketing..."
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-icon">Icone (opcional)</Label>
              <Input
                id="ws-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="Ex: B, S, M ou emoji..."
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ws-description">Descricao (opcional)</Label>
              <Textarea
                id="ws-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o proposito deste workspace..."
                className="bg-background resize-none"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
              Cancelar
            </Button>
            <Button 
              onClick={editingWorkspace ? handleUpdate : handleCreate} 
              disabled={isSaving || !name.trim()}
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingWorkspace ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog 
        open={!!deletingWorkspace} 
        onOpenChange={() => setDeletingWorkspace(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deletingWorkspace?.name}"? 
              Todos os agentes, leads e dados associados serao perdidos. 
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isSaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WorkspacesSettings;
