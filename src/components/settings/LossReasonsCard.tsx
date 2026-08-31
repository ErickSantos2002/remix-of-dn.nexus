import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Check, X, XCircle, Trash2 } from "lucide-react";

interface LossReason {
  id: string;
  name: string;
  is_active: boolean;
}

export function LossReasonsCard() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["crm-loss-reasons", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_loss_reasons")
        .select("id, name, is_active")
        .eq("workspace_id", currentWorkspace.id)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as LossReason[];
    },
    enabled: !!currentWorkspace?.id,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["crm-loss-reasons"] });

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || !currentWorkspace?.id) return;
    setIsAdding(true);
    const { error } = await supabase.from("crm_loss_reasons").insert({
      workspace_id: currentWorkspace.id,
      name,
      is_active: true,
    });
    setIsAdding(false);
    if (error) {
      toast({
        title: "Erro ao incluir motivo",
        description:
          error.code === "23505" ? "Já existe um motivo com esse nome." : error.message,
        variant: "destructive",
      });
      return;
    }
    setNewName("");
    invalidate();
    toast({ title: "Motivo adicionado" });
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    setSavingId(id);
    const { error } = await supabase
      .from("crm_loss_reasons")
      .update({ name })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast({
        title: "Erro ao salvar",
        description:
          error.code === "23505" ? "Já existe um motivo com esse nome." : error.message,
        variant: "destructive",
      });
      return;
    }
    setEditingId(null);
    setEditingName("");
    invalidate();
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setSavingId(id);
    const { error } = await supabase
      .from("crm_loss_reasons")
      .update({ is_active: !isActive })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    invalidate();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("crm_loss_reasons").delete().eq("id", id);
    if (error) {
      toast({
        title: "Erro ao excluir motivo",
        description: "O motivo pode estar vinculado a leads.",
        variant: "destructive",
      });
      return;
    }
    invalidate();
    toast({ title: "Motivo excluído" });
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-primary" />
          Motivos de Perda
        </CardTitle>
        <CardDescription>
          Gerencie os motivos de perda usados ao marcar leads como perdidos. Desabilitar
          remove a opção dos selects sem afetar leads já classificados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Novo motivo (ex.: Sem orçamento, Não é prioridade...)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            disabled={isAdding}
          />
          <Button onClick={handleAdd} disabled={isAdding || !newName.trim()}>
            {isAdding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-2">Incluir</span>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {reasons.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhum motivo cadastrado. Adicione o primeiro acima.
              </p>
            )}
            {reasons.map((reason) => {
              const isEditing = editingId === reason.id;
              const isSaving = savingId === reason.id;
              return (
                <div
                  key={reason.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  {isEditing ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(reason.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSaveEdit(reason.id)}
                        disabled={isSaving || !editingName.trim()}
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 text-success" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={isSaving}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium">{reason.name}</span>
                      {!reason.is_active && (
                        <Badge variant="secondary" className="text-xs">
                          Desabilitado
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(reason.id);
                          setEditingName(reason.name);
                        }}
                        disabled={isSaving}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={reason.is_active}
                        onCheckedChange={() => handleToggleActive(reason.id, reason.is_active)}
                        disabled={isSaving}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir motivo?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita. O motivo só pode ser excluído
                              se não houver leads vinculados a ele.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(reason.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
