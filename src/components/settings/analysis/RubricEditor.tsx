import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRubricVersions } from "@/hooks/useAnalysisPlaybooks";
import type { AnalysisPlaybook, AnalysisRubricCriterion } from "@/types/analysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, CopyPlus, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  playbook: AnalysisPlaybook;
}

/** Linha editável da rubrica — espelha analysis_rubric_criteria. */
interface CriterionDraft {
  criterion_key: string;
  stage: string;
  name: string;
  description: string;
  weight: number;
  is_active: boolean;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function toDraft(criterion: AnalysisRubricCriterion): CriterionDraft {
  return {
    criterion_key: criterion.criterion_key,
    stage: criterion.stage ?? "",
    name: criterion.name,
    description: criterion.description ?? "",
    weight: Number(criterion.weight) || 1,
    is_active: criterion.is_active,
  };
}

export function RubricEditor({ playbook }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: versions, isLoading } = useRubricVersions(playbook.id);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CriterionDraft[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Seleciona por padrão a versão mais recente (a query já vem ordenada desc)
  useEffect(() => {
    if (!versions || versions.length === 0) {
      setSelectedVersionId(null);
      setDrafts([]);
      return;
    }
    setSelectedVersionId((current) => {
      const stillExists = current && versions.some((v) => v.id === current);
      return stillExists ? current : versions[0].id;
    });
  }, [versions]);

  const selectedVersion = versions?.find((v) => v.id === selectedVersionId) ?? null;

  useEffect(() => {
    setDrafts(selectedVersion ? selectedVersion.criteria.map(toDraft) : []);
  }, [selectedVersion]);

  const isEditable = selectedVersion?.status === "draft";
  const totalWeight = drafts.filter((d) => d.is_active).reduce((sum, d) => sum + (Number(d.weight) || 0), 0);

  /** Resolve depois do refetch — dá para selecionar uma versão recém-criada em seguida. */
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["analysis-rubric-versions", playbook.id] }),
      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] }),
    ]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("playbook-extract-rubric", {
        body: { playbook_id: playbook.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      refresh();
      const failedNote =
        data.coverage?.sections_failed > 0
          ? ` ${data.coverage.sections_failed} trecho(s) do playbook falharam — veja a cobertura da extração.`
          : "";
      toast({
        title: "Rubrica gerada",
        description: `${data.criteria_count ?? 0} critérios propostos. Revise antes de ativar.${failedNote}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível gerar a rubrica.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Copia a versão em uso para um novo rascunho editável, sem passar pela IA.
   * Mantém `criterion_key` de cada critério — é a chave estável entre versões que
   * sustenta o rastreio de recorrência dos pontos de desenvolvimento do vendedor.
   */
  const handleClone = async () => {
    if (!selectedVersion || selectedVersion.status !== "active") return;

    setIsCloning(true);
    try {
      // Proxima versao = maior existente + 1 (consulta fresca: outra aba pode ter criado uma)
      const { data: lastVersion, error: lastVersionError } = await supabase
        .from("analysis_rubric_versions")
        .select("version")
        .eq("playbook_id", playbook.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastVersionError) throw lastVersionError;

      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const { data: created, error: versionError } = await supabase
        .from("analysis_rubric_versions")
        .insert({
          playbook_id: playbook.id,
          company_id: playbook.company_id,
          version: nextVersion,
          status: "draft",
          // O relatório descreve a extração que originou estes mesmos critérios.
          coverage_report: (selectedVersion.coverage_report ?? null) as unknown as Json,
        })
        .select("id")
        .single();

      if (versionError) {
        // UNIQUE (playbook_id, version): alguém criou a versão N+1 entre a leitura e o insert.
        if (versionError.code === "23505") {
          toast({
            title: "Versão já existe",
            description: "Outra versão foi criada agora há pouco. Tente novamente.",
            variant: "destructive",
          });
          return;
        }
        throw versionError;
      }

      if (selectedVersion.criteria.length > 0) {
        const { error: criteriaError } = await supabase.from("analysis_rubric_criteria").insert(
          selectedVersion.criteria.map((criterion, index) => ({
            version_id: created.id,
            company_id: playbook.company_id,
            criterion_key: criterion.criterion_key,
            stage: criterion.stage,
            name: criterion.name,
            description: criterion.description,
            weight: criterion.weight,
            sort_order: index,
            is_active: criterion.is_active,
          })),
        );

        if (criteriaError) {
          // Sem criterios a versao nao serve para nada
          await supabase.from("analysis_rubric_versions").delete().eq("id", created.id);
          throw criteriaError;
        }
      }

      await refresh();
      setSelectedVersionId(created.id);
      toast({
        title: "Rascunho criado",
        description: `Versão ${nextVersion} copiada da versão ${selectedVersion.version}. Ajuste os critérios e ative quando estiver pronta.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível duplicar a versão.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsCloning(false);
    }
  };

  const updateDraft = (index: number, patch: Partial<CriterionDraft>) => {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const addDraft = () => {
    setDrafts((current) => [
      ...current,
      { criterion_key: "", stage: "", name: "", description: "", weight: 1, is_active: true },
    ]);
  };

  const removeDraft = (index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index));
  };

  /** Regrava os critérios da versão em rascunho (delete + insert mantém as chaves informadas). */
  const persistDrafts = async (): Promise<boolean> => {
    if (!selectedVersion) return false;

    const invalid = drafts.find((d) => !d.name.trim());
    if (invalid) {
      toast({
        title: "Critério sem nome",
        description: "Todo critério precisa de um nome.",
        variant: "destructive",
      });
      return false;
    }

    const prepared = drafts.map((draft, index) => ({
      version_id: selectedVersion.id,
      company_id: playbook.company_id,
      criterion_key: (draft.criterion_key.trim() || slugify(draft.name)) || `criterio_${index + 1}`,
      stage: draft.stage.trim() || null,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      weight: Number(draft.weight) || 1,
      sort_order: index,
      is_active: draft.is_active,
    }));

    const keys = new Set(prepared.map((p) => p.criterion_key));
    if (keys.size !== prepared.length) {
      toast({
        title: "Chaves duplicadas",
        description: "Dois critérios têm a mesma chave. Ajuste os nomes ou as chaves.",
        variant: "destructive",
      });
      return false;
    }

    const { error: deleteError } = await (supabase.from("analysis_rubric_criteria") as any)
      .delete()
      .eq("version_id", selectedVersion.id);
    if (deleteError) throw deleteError;

    if (prepared.length > 0) {
      const { error: insertError } = await (supabase.from("analysis_rubric_criteria") as any).insert(prepared);
      if (insertError) throw insertError;
    }
    return true;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (await persistDrafts()) {
        refresh();
        toast({ title: "Rubrica salva" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar a rubrica.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedVersion) return;
    if (drafts.filter((d) => d.is_active).length === 0) {
      toast({
        title: "Nenhum critério ativo",
        description: "Ative ao menos um critério antes de publicar a rubrica.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      if (!(await persistDrafts())) return;

      // Aposenta a versão ativa anterior antes de publicar a nova
      // (índice parcial garante no máximo uma ativa por playbook).
      const { error: supersedeError } = await (supabase.from("analysis_rubric_versions") as any)
        .update({ status: "superseded" })
        .eq("playbook_id", playbook.id)
        .eq("status", "active");
      if (supersedeError) throw supersedeError;

      const { error: activateError } = await (supabase.from("analysis_rubric_versions") as any)
        .update({ status: "active" })
        .eq("id", selectedVersion.id);
      if (activateError) throw activateError;

      const { error: playbookError } = await (supabase.from("analysis_playbooks") as any)
        .update({ status: "active" })
        .eq("id", playbook.id);
      if (playbookError) throw playbookError;

      refresh();
      toast({
        title: "Análise ativada",
        description: "A partir de agora as atividades vinculadas serão avaliadas por esta rubrica.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível ativar a rubrica.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!playbook.md_approved_at) {
    return (
      <div className="rounded-lg border border-border bg-background/40 p-6 text-center space-y-2">
        <p className="text-sm text-foreground">Aprove o playbook antes de gerar a rubrica.</p>
        <p className="text-xs text-muted-foreground">
          A rubrica é extraída do conteúdo aprovado na aba Playbook.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <Label>Versão da rubrica</Label>
          {versions && versions.length > 0 ? (
            <Select value={selectedVersionId ?? undefined} onValueChange={setSelectedVersionId}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    Versão {version.version} — {version.status === "active"
                      ? "ativa"
                      : version.status === "draft"
                        ? "rascunho"
                        : "substituída"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma rubrica gerada ainda.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedVersion?.status === "active" && (
            <Button variant="outline" onClick={handleClone} disabled={isCloning || isGenerating}>
              {isCloning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CopyPlus className="h-4 w-4 mr-2" />
              )}
              Duplicar como rascunho
            </Button>
          )}

          <Button variant="outline" onClick={handleGenerate} disabled={isGenerating || isCloning}>
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {versions && versions.length > 0 ? "Gerar nova versão" : "Gerar rubrica"}
          </Button>
        </div>
      </div>

      {selectedVersion && (
        <>
          <Separator />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge className={selectedVersion.status === "active" ? "badge-success" : "badge-warning"}>
                {selectedVersion.status === "active"
                  ? "Em uso"
                  : selectedVersion.status === "draft"
                    ? "Rascunho"
                    : "Substituída"}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">
                {drafts.filter((d) => d.is_active).length} critérios ativos · peso total {totalWeight}
              </span>
            </div>
            {isEditable && (
              <Button variant="ghost" size="sm" onClick={addDraft}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar critério
              </Button>
            )}
          </div>

          {!isEditable && (
            <p className="text-xs text-muted-foreground">
              Versões ativas e substituídas não são editáveis — os resultados já registrados apontam para elas.
              Gere uma nova versão para alterar os critérios.
            </p>
          )}

          {selectedVersion.coverage_report && (
            <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">Cobertura da extração</p>
              <p className="text-xs text-muted-foreground font-mono">
                {selectedVersion.coverage_report.sections_total} trechos do playbook processados ·{" "}
                {selectedVersion.coverage_report.sections_total -
                  selectedVersion.coverage_report.sections_no_criteria -
                  selectedVersion.coverage_report.sections_failed}{" "}
                geraram critérios
                {selectedVersion.coverage_report.homologation_total > 0 &&
                  ` · homologação ${selectedVersion.coverage_report.homologation_covered}/${selectedVersion.coverage_report.homologation_total}`}
              </p>

              {selectedVersion.coverage_report.criteria_truncated > 0 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {selectedVersion.coverage_report.criteria_truncated} critérios foram descartados pelo limite
                  global — considere dividir a análise em playbooks menores.
                </p>
              )}

              {selectedVersion.coverage_report.sections
                .filter((section) => section.status !== "covered")
                .map((section) => (
                  <div key={section.index} className="flex items-start gap-2 text-xs">
                    {section.status === "failed" ? (
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-destructive" />
                    ) : (
                      <span className="h-3 w-3 shrink-0 mt-0.5 rounded-full border border-border" />
                    )}
                    <span className="text-muted-foreground">
                      <span className="text-foreground">{section.label}</span>
                      {section.status === "failed"
                        ? " — falha no processamento; gere uma nova versão para reprocessar."
                        : ` — sem critérios extraídos${section.note ? `: ${section.note}` : "."}`}
                    </span>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-3">
            {drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Esta versão não tem critérios.
              </p>
            ) : (
              drafts.map((draft, index) => (
                <div
                  key={`${selectedVersion.id}-${index}`}
                  className="rounded-lg border border-border bg-background/40 p-3 space-y-3"
                >
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
                    <div className="space-y-1">
                      <Label className="text-xs">Etapa</Label>
                      <Input
                        value={draft.stage}
                        onChange={(e) => updateDraft(index, { stage: e.target.value })}
                        disabled={!isEditable}
                        placeholder="Ex.: Diagnóstico"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Critério</Label>
                      <Input
                        value={draft.name}
                        onChange={(e) => updateDraft(index, { name: e.target.value })}
                        disabled={!isEditable}
                        placeholder="O que deve ser observado"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Peso</Label>
                      <Input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={draft.weight}
                        onChange={(e) => updateDraft(index, { weight: Number(e.target.value) })}
                        disabled={!isEditable}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Como avaliar</Label>
                    <Textarea
                      value={draft.description}
                      onChange={(e) => updateDraft(index, { description: e.target.value })}
                      disabled={!isEditable}
                      rows={2}
                      placeholder="Descrição objetiva do que caracteriza o critério atendido"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={draft.is_active}
                        onCheckedChange={(checked) => updateDraft(index, { is_active: checked })}
                        disabled={!isEditable}
                        id={`criterion-active-${index}`}
                      />
                      <Label htmlFor={`criterion-active-${index}`} className="text-xs font-normal">
                        Considerar no score
                      </Label>
                      <span className="text-xs text-muted-foreground font-mono">
                        {draft.criterion_key || slugify(draft.name) || "—"}
                      </span>
                    </div>
                    {isEditable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeDraft(index)}
                        aria-label="Remover critério"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {isEditable && (
            <div className="flex items-center gap-2">
              <Button onClick={handleActivate} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Ativar rubrica
              </Button>
              <Button variant="outline" onClick={handleSave} disabled={isSaving}>
                Salvar rascunho
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
