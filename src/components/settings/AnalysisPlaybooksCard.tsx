import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAllAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import {
  ANALYSIS_ACTIVITY_TYPES,
  ANALYSIS_ACTIVITY_TYPE_LABELS,
  type AnalysisActivityType,
  type AnalysisPlaybook,
} from "@/types/analysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
import { ClipboardCheck, Loader2, Plus, Save, Settings2, Star, Trash2 } from "lucide-react";
import { PlaybookDetailDialog } from "./analysis/PlaybookDetailDialog";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  companyId: string;
}

const STATUS_LABELS: Record<AnalysisPlaybook["status"], string> = {
  draft: "Rascunho",
  active: "Ativa",
  archived: "Arquivada",
};

function StatusBadge({ status }: { status: AnalysisPlaybook["status"] }) {
  if (status === "active") return <Badge className="badge-success">{STATUS_LABELS.active}</Badge>;
  if (status === "archived") return <Badge className="badge-neutral">{STATUS_LABELS.archived}</Badge>;
  return <Badge className="badge-warning">{STATUS_LABELS.draft}</Badge>;
}

export function AnalysisPlaybooksCard({ companyId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: playbooks, isLoading } = useAllAnalysisPlaybooks();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savingDefaultId, setSavingDefaultId] = useState<string | null>(null);
  const [detailPlaybookId, setDetailPlaybookId] = useState<string | null>(null);
  const [playbookToDelete, setPlaybookToDelete] = useState<AnalysisPlaybook | null>(null);

  // Formulário de criação
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formActivityTypes, setFormActivityTypes] = useState<AnalysisActivityType[]>(["meeting"]);

  // Diretriz geral da empresa
  const [companyGuidelines, setCompanyGuidelines] = useState("");
  const [isSavingGuidelines, setIsSavingGuidelines] = useState(false);

  useEffect(() => {
    const loadGuidelines = async () => {
      const { data } = await (supabase.from("companies") as any)
        .select("analysis_guidelines")
        .eq("id", companyId)
        .maybeSingle();
      if (data?.analysis_guidelines) setCompanyGuidelines(data.analysis_guidelines as string);
    };
    loadGuidelines();
  }, [companyId]);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormActivityTypes(["meeting"]);
  };

  const toggleActivityType = (type: AnalysisActivityType, checked: boolean) => {
    setFormActivityTypes((current) =>
      checked ? [...current, type] : current.filter((t) => t !== type),
    );
  };

  const handleCreate = async () => {
    const name = formName.trim();
    if (!name) {
      toast({ title: "Informe um nome", description: "A análise precisa de um nome.", variant: "destructive" });
      return;
    }
    if (formActivityTypes.length === 0) {
      toast({
        title: "Selecione ao menos um tipo",
        description: "Escolha em quais tipos de atividade esta análise pode ser usada.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await (supabase.from("analysis_playbooks") as any)
        .insert({
          company_id: companyId,
          name,
          description: formDescription.trim() || null,
          activity_types: formActivityTypes,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;

      toast({ title: "Análise criada", description: "Agora envie o playbook para gerar a rubrica." });
      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
      setIsCreateOpen(false);
      resetForm();
      // Leva direto ao próximo passo do fluxo
      setDetailPlaybookId(data.id as string);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível criar a análise.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!playbookToDelete) return;
    try {
      const { error } = await (supabase.from("analysis_playbooks") as any)
        .delete()
        .eq("id", playbookToDelete.id);
      if (error) throw error;
      toast({ title: "Análise excluída" });
      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível excluir.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setPlaybookToDelete(null);
    }
  };

  /**
   * Marca ou desmarca a análise padrão dos tipos que ela cobre.
   *
   * Duas queries em vez de índice único: `activity_types` é array, e "um padrão
   * por tipo" é restrição sobre sobreposição — o banco não expressa isso. Limpa
   * o padrão anterior dos tipos sobrepostos (`overlaps`) antes de marcar o novo,
   * senão duas análises de "meeting" ficariam ambas padrão e a pré-seleção do
   * card dependeria da ordem alfabética.
   */
  const handleToggleDefault = async (playbook: AnalysisPlaybook) => {
    setSavingDefaultId(playbook.id);
    try {
      // Um builder novo por query: o do supabase-js acumula filtros no mesmo
      // objeto, e reusá-lo fazia o segundo update herdar `is_default=eq.true`
      // do primeiro — que acabara de zerar o campo, então casava com 0 linhas
      // e devolvia 204 sem alterar nada
      const playbooks = () => supabase.from("analysis_playbooks") as any;

      if (playbook.is_default) {
        const { error } = await playbooks().update({ is_default: false }).eq("id", playbook.id);
        if (error) throw error;
        toast({
          title: "Padrão removido",
          description: "Sem análise padrão, a seleção fica livre em toda atividade nova.",
        });
      } else {
        const types = playbook.activity_types ?? [];
        const { data: replaced, error: clearError } = await playbooks()
          .update({ is_default: false })
          .eq("company_id", companyId)
          .eq("is_default", true)
          .overlaps("activity_types", types)
          .select("name");
        if (clearError) throw clearError;

        const { error } = await playbooks().update({ is_default: true }).eq("id", playbook.id);
        if (error) throw error;

        const previous = ((replaced ?? []) as Array<{ name: string }>).filter(
          (row) => row.name !== playbook.name,
        );
        toast({
          title: "Análise padrão definida",
          description: previous.length
            ? `Substituiu "${previous.map((row) => row.name).join('", "')}".`
            : "Será aplicada automaticamente no primeiro atendimento de cada card.",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setSavingDefaultId(null);
    }
  };

  const handleSaveGuidelines = async () => {
    setIsSavingGuidelines(true);
    try {
      const { error } = await (supabase.from("companies") as any)
        .update({ analysis_guidelines: companyGuidelines.trim() || null })
        .eq("id", companyId);
      if (error) throw error;
      toast({ title: "Diretrizes salvas" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSavingGuidelines(false);
    }
  };

  return (
    <>
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Análises de Atendimento
              </CardTitle>
              <CardDescription>
                Cadastre os playbooks usados para avaliar reuniões, demonstrações e ligações. Cada análise gera
                score e feedback para o vendedor.
              </CardDescription>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-2" />
              Nova análise
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !playbooks || playbooks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma análise cadastrada. Crie a primeira para começar a avaliar os atendimentos.
            </p>
          ) : (
            <div className="space-y-2">
              {playbooks.map((playbook) => (
                <div
                  key={playbook.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate">{playbook.name}</span>
                      <StatusBadge status={playbook.status} />
                      {/* A estrela vai no badge do tipo, não em um badge próprio:
                          o padrão é por tipo de atividade, então "★ Reunião" diz
                          de qual padrão se trata — "Padrão" sozinho não dizia */}
                      {(playbook.activity_types ?? []).map((type) => {
                        const label = ANALYSIS_ACTIVITY_TYPE_LABELS[type] ?? type;
                        return (
                          <Badge
                            key={type}
                            className={playbook.is_default ? "badge-primary gap-1" : "badge-neutral"}
                            title={playbook.is_default ? `Análise padrão para ${label}` : undefined}
                          >
                            {playbook.is_default && <Star className="h-3 w-3 fill-current" />}
                            {label}
                          </Badge>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {playbook.description || "Sem descrição"}
                      {playbook.playbook_filename ? ` · ${playbook.playbook_filename}` : " · playbook não enviado"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Só análise ativa pode ser padrão: o select do card filtra
                        rascunhos, e travar a atividade num playbook invisível
                        deixaria o campo vazio e bloqueado */}
                    {playbook.status === "active" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleDefault(playbook)}
                        disabled={savingDefaultId === playbook.id}
                        aria-label={
                          playbook.is_default
                            ? `Remover ${playbook.name} como análise padrão`
                            : `Definir ${playbook.name} como análise padrão`
                        }
                        title={
                          playbook.is_default
                            ? "Remover como padrão"
                            : `Definir como padrão para: ${(playbook.activity_types ?? [])
                                .map((type) => ANALYSIS_ACTIVITY_TYPE_LABELS[type] ?? type)
                                .join(", ")}`
                        }
                      >
                        {savingDefaultId === playbook.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Star
                            className={`h-4 w-4 ${
                              playbook.is_default ? "fill-primary text-primary" : "text-muted-foreground"
                            }`}
                          />
                        )}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setDetailPlaybookId(playbook.id)}>
                      <Settings2 className="h-4 w-4 mr-2" />
                      Configurar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPlaybookToDelete(playbook)}
                      aria-label={`Excluir análise ${playbook.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label>Diretrizes gerais de avaliação</Label>
            <Textarea
              value={companyGuidelines}
              onChange={(e) => setCompanyGuidelines(e.target.value)}
              rows={4}
              placeholder="Orientações que valem para todas as análises desta empresa. Ex.: tom do feedback, o que priorizar, o que ignorar."
            />
            <p className="text-xs text-muted-foreground">
              Aplicadas a todas as análises. Cada análise pode ter diretrizes próprias, que somam a estas.
            </p>
            <Button onClick={handleSaveGuidelines} disabled={isSavingGuidelines} size="sm">
              {isSavingGuidelines ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar diretrizes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="glass-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova análise</DialogTitle>
            <DialogDescription>
              Defina o nome e onde ela poderá ser selecionada. O playbook é enviado no passo seguinte.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="analysis-name">Nome</Label>
              <Input
                id="analysis-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex.: Apresentação comercial"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="analysis-description">Descrição</Label>
              <Textarea
                id="analysis-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
                placeholder="Quando esta análise deve ser usada"
              />
            </div>

            <div className="space-y-2">
              <Label>Tipos de atividade</Label>
              <div className="space-y-2">
                {ANALYSIS_ACTIVITY_TYPES.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={`activity-type-${type}`}
                      checked={formActivityTypes.includes(type)}
                      onCheckedChange={(checked) => toggleActivityType(type, checked === true)}
                    />
                    <Label htmlFor={`activity-type-${type}`} className="font-normal cursor-pointer">
                      {ANALYSIS_ACTIVITY_TYPE_LABELS[type]}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                A análise só aparece para seleção nos tipos marcados.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlaybookDetailDialog
        playbookId={detailPlaybookId}
        onOpenChange={(open) => !open && setDetailPlaybookId(null)}
      />

      <AlertDialog open={!!playbookToDelete} onOpenChange={(open) => !open && setPlaybookToDelete(null)}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir análise</AlertDialogTitle>
            <AlertDialogDescription>
              A análise "{playbookToDelete?.name}" e suas rubricas serão removidas. As avaliações já realizadas
              são preservadas, mas perdem o vínculo com a análise. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
