import { ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { Loader2, Plus, Pencil, Check, X, Trash2, Star } from "lucide-react";
import {
  LeadAttributeSectionKey,
  useLeadAttributeSections,
} from "@/hooks/useLeadAttributeSections";

interface CatalogItem {
  id: string;
  name: string;
  is_active: boolean;
  is_default?: boolean;
}

interface CatalogCrudCardProps {
  table: "crm_pains" | "crm_objections" | "crm_segments";
  queryKey: string;
  title: string;
  icon: ReactNode;
  description: string;
  placeholder: string;
  emptyMessage: string;
  singularLabel: string;
  /** Chave da secao correspondente no detalhe do card do pipeline. */
  sectionKey: LeadAttributeSectionKey;
  /** Habilita a marcacao de item padrao (fallback). */
  supportsDefault?: boolean;
  /** Exige um item padrao para permitir ativar a secao. */
  requireDefault?: boolean;
}

export function CatalogCrudCard({
  table,
  queryKey,
  title,
  icon,
  description,
  placeholder,
  emptyMessage,
  singularLabel,
  sectionKey,
  supportsDefault = false,
  requireDefault = false,
}: CatalogCrudCardProps) {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sections = useLeadAttributeSections(currentWorkspace?.id);

  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: [queryKey, currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const columns = supportsDefault ? "id, name, is_active, is_default" : "id, name, is_active";
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq("workspace_id", currentWorkspace.id)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CatalogItem[];
    },
    enabled: !!currentWorkspace?.id,
  });

  const defaultItem = items.find((i) => i.is_default);
  const sectionActive = sections.isActive(sectionKey);
  const blockedByDefault = requireDefault && !defaultItem;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [queryKey] });

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || !currentWorkspace?.id) return;
    setIsAdding(true);
    const { error } = await supabase.from(table).insert({
      workspace_id: currentWorkspace.id,
      name,
      is_active: true,
    });
    setIsAdding(false);
    if (error) {
      toast({
        title: `Erro ao incluir ${singularLabel.toLowerCase()}`,
        description:
          error.code === "23505" ? "Já existe um registro com esse nome." : error.message,
        variant: "destructive",
      });
      return;
    }
    setNewName("");
    invalidate();
    toast({ title: `${singularLabel} adicionada` });
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    setSavingId(id);
    const { error } = await supabase.from(table).update({ name }).eq("id", id);
    setSavingId(null);
    if (error) {
      toast({
        title: "Erro ao salvar",
        description:
          error.code === "23505" ? "Já existe um registro com esse nome." : error.message,
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
    const { error } = await supabase.from(table).update({ is_active: !isActive }).eq("id", id);
    setSavingId(null);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    invalidate();
  };

  const handleSetDefault = async (id: string) => {
    if (!currentWorkspace?.id) return;
    setSavingId(id);
    // Cliente sem tipos: `is_default` so existe em crm_segments, o que estoura a inferencia.
    const db = supabase as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: unknown) => {
            eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
          } & Promise<{ error: { message: string } | null }>;
        };
      };
    };
    // Remove o padrao anterior antes de marcar o novo (indice unico parcial).
    const { error: clearError } = await db
      .from(table)
      .update({ is_default: false })
      .eq("workspace_id", currentWorkspace.id)
      .eq("is_default", true);
    if (clearError) {
      setSavingId(null);
      toast({ title: "Erro ao definir padrão", description: clearError.message, variant: "destructive" });
      return;
    }
    const { error } = await db
      .from(table)
      .update({ is_default: true, is_active: true })
      .eq("id", id);

    setSavingId(null);
    if (error) {
      toast({ title: "Erro ao definir padrão", description: error.message, variant: "destructive" });
      return;
    }
    invalidate();
    toast({ title: `${singularLabel} definida como padrão` });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) {
      toast({
        title: "Erro ao excluir",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    invalidate();
    toast({ title: `${singularLabel} excluída` });
  };

  const sectionSwitch = (
    <div className="flex items-center gap-2">
      <Label htmlFor={`section-${sectionKey}`} className="text-xs text-muted-foreground">
        Exibir no card do pipeline
      </Label>
      <Switch
        id={`section-${sectionKey}`}
        checked={sectionActive}
        disabled={sections.isLoading || sections.isSaving || (blockedByDefault && !sectionActive)}
        onCheckedChange={(value) => sections.setActive(sectionKey, value)}
      />
    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          {blockedByDefault && !sectionActive ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{sectionSwitch}</span>
                </TooltipTrigger>
                <TooltipContent>
                  Marque um item como padrão para ativar esta seção.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            sectionSwitch
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sectionActive && (
          <p className="text-xs text-warning">
            Seção desativada: não aparece no detalhe do card do pipeline.
          </p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
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
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">{emptyMessage}</p>
            )}
            {items.map((item) => {
              const isEditing = editingId === item.id;
              const isSaving = savingId === item.id;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  {isEditing ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(item.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSaveEdit(item.id)}
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
                      <span className="flex-1 text-sm font-medium">{item.name}</span>
                      {item.is_default && (
                        <Badge className="badge-primary text-xs">Padrão</Badge>
                      )}
                      {!item.is_active && (
                        <Badge variant="secondary" className="text-xs">
                          Desabilitado
                        </Badge>
                      )}
                      {supportsDefault && !item.is_default && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleSetDefault(item.id)}
                                disabled={isSaving}
                              >
                                <Star className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Definir como padrão (fallback)</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingName(item.name);
                        }}
                        disabled={isSaving}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={item.is_active}
                        onCheckedChange={() => handleToggleActive(item.id, item.is_active)}
                        disabled={isSaving || item.is_default}
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(item.id)}
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
