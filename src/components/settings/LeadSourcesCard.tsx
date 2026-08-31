import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Check, X, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAllContactSources } from "@/hooks/useContactSources";

interface Props {
  companyId: string;
}

export function LeadSourcesCard({ companyId }: Props) {
  const { data: sources = [], isLoading } = useAllContactSources();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["contact-sources"] });
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setIsAdding(true);
    const nextOrder =
      Math.max(0, ...sources.filter((s) => !s.is_system).map((s) => s.sort_order)) + 10;
    const { error } = await supabase.from("crm_contact_sources").insert({
      company_id: companyId,
      name,
      is_active: true,
      is_system: false,
      sort_order: nextOrder,
    });
    setIsAdding(false);
    if (error) {
      toast({
        title: "Erro ao incluir origem",
        description:
          error.code === "23505" ? "Já existe uma origem com esse nome." : error.message,
        variant: "destructive",
      });
      return;
    }
    setNewName("");
    invalidate();
    toast({ title: "Origem adicionada" });
  };

  const handleStartEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    setSavingId(id);
    const { error } = await supabase
      .from("crm_contact_sources")
      .update({ name })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast({
        title: "Erro ao salvar",
        description:
          error.code === "23505" ? "Já existe uma origem com esse nome." : error.message,
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
      .from("crm_contact_sources")
      .update({ is_active: !isActive })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    invalidate();
  };

  const userSources = sources.filter((s) => !s.is_system);
  const systemSources = sources.filter((s) => s.is_system);

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          Origens do Lead
        </CardTitle>
        <CardDescription>
          Gerencie as opções do campo "Origem" usadas no cadastro de leads. Desabilitar
          remove a opção dos selects sem afetar leads já cadastrados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new */}
        <div className="flex gap-2">
          <Input
            placeholder="Nova origem (ex.: Evento, LinkedIn...)"
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

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {userSources.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhuma origem cadastrada. Adicione a primeira acima.
              </p>
            )}
            {userSources.map((src) => {
              const isEditing = editingId === src.id;
              const isSaving = savingId === src.id;
              return (
                <div
                  key={src.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  {isEditing ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(src.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSaveEdit(src.id)}
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
                      <span className="flex-1 text-sm font-medium">{src.name}</span>
                      {!src.is_active && (
                        <Badge variant="secondary" className="text-xs">
                          Desabilitada
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleStartEdit(src.id, src.name)}
                        disabled={isSaving}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={src.is_active}
                        onCheckedChange={() => handleToggleActive(src.id, src.is_active)}
                        disabled={isSaving}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {systemSources.length > 0 && (
              <div className="pt-3 mt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">
                  Origens internas do sistema (não editáveis, geradas automaticamente):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {systemSources.map((src) => (
                    <Badge key={src.id} variant="outline" className="text-xs font-mono">
                      {src.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
