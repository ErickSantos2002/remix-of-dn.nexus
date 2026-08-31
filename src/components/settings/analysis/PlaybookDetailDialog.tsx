import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAllAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import {
  ANALYSIS_ACTIVITY_TYPES,
  ANALYSIS_ACTIVITY_TYPE_LABELS,
  type AnalysisActivityType,
} from "@/types/analysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Save } from "lucide-react";
import { PlaybookMarkdownReview } from "./PlaybookMarkdownReview";
import { RubricEditor } from "./RubricEditor";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Modelos disponíveis para a avaliação. O default acompanha o mais capaz em produção. */
const AI_MODEL_OPTIONS = [
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (recomendado)" },
  { value: "google/gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (mais rápido)" },
];

interface Props {
  playbookId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function PlaybookDetailDialog({ playbookId, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: playbooks } = useAllAnalysisPlaybooks();
  const playbook = playbooks?.find((p) => p.id === playbookId) ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activityTypes, setActivityTypes] = useState<AnalysisActivityType[]>([]);
  const [guidelines, setGuidelines] = useState("");
  const [aiModel, setAiModel] = useState(AI_MODEL_OPTIONS[0].value);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!playbook) return;
    setName(playbook.name);
    setDescription(playbook.description ?? "");
    setActivityTypes(playbook.activity_types ?? []);
    setGuidelines(playbook.guidelines ?? "");
    setAiModel(playbook.ai_model || AI_MODEL_OPTIONS[0].value);
    // Só re-hidrata ao trocar de análise: reagir ao objeto inteiro descartaria
    // edições em andamento a cada refetch da lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbook?.id]);

  const toggleActivityType = (type: AnalysisActivityType, checked: boolean) => {
    setActivityTypes((current) => (checked ? [...current, type] : current.filter((t) => t !== type)));
  };

  const handleSaveDetails = async () => {
    if (!playbook) return;
    if (!name.trim()) {
      toast({ title: "Informe um nome", variant: "destructive" });
      return;
    }
    if (activityTypes.length === 0) {
      toast({ title: "Selecione ao menos um tipo de atividade", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await (supabase.from("analysis_playbooks") as any)
        .update({
          name: name.trim(),
          description: description.trim() || null,
          activity_types: activityTypes,
          guidelines: guidelines.trim() || null,
          ai_model: aiModel,
        })
        .eq("id", playbook.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
      toast({ title: "Dados salvos" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!playbook) return;
    const nextStatus = playbook.status === "archived" ? "draft" : "archived";
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("analysis_playbooks") as any)
        .update({ status: nextStatus })
        .eq("id", playbook.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
      toast({
        title: nextStatus === "archived" ? "Análise arquivada" : "Análise reativada",
        description:
          nextStatus === "archived"
            ? "Ela não aparece mais para seleção em novas atividades."
            : "Ative a rubrica para voltar a avaliar atendimentos.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível alterar o status.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={!!playbookId} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {!playbook ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {playbook.name}
                {playbook.status === "active" && <Badge className="badge-success">Ativa</Badge>}
              </DialogTitle>
              <DialogDescription>
                Configure o playbook e a rubrica usados para avaliar os atendimentos desta análise.
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="dados" className="w-full">
              <TabsList>
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="playbook">Playbook</TabsTrigger>
                <TabsTrigger value="rubrica">Rubrica</TabsTrigger>
              </TabsList>

              <TabsContent value="dados" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="detail-name">Nome</Label>
                  <Input id="detail-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="detail-description">Descrição</Label>
                  <Textarea
                    id="detail-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tipos de atividade</Label>
                  <div className="flex flex-wrap gap-4">
                    {ANALYSIS_ACTIVITY_TYPES.map((type) => (
                      <div key={type} className="flex items-center gap-2">
                        <Checkbox
                          id={`detail-type-${type}`}
                          checked={activityTypes.includes(type)}
                          onCheckedChange={(checked) => toggleActivityType(type, checked === true)}
                        />
                        <Label htmlFor={`detail-type-${type}`} className="font-normal cursor-pointer">
                          {ANALYSIS_ACTIVITY_TYPE_LABELS[type]}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="detail-guidelines">Diretrizes desta análise</Label>
                  <Textarea
                    id="detail-guidelines"
                    value={guidelines}
                    onChange={(e) => setGuidelines(e.target.value)}
                    rows={4}
                    placeholder="Orientações específicas para avaliar este tipo de atendimento. Somam às diretrizes gerais da empresa."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="detail-model">Modelo de IA</Label>
                  <select
                    id="detail-model"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {AI_MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Usa a chave Gemini da empresa quando configurada, com retorno automático ao provedor padrão.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={handleSaveDetails} disabled={isSaving}>
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Salvar dados
                  </Button>
                  <Button variant="outline" onClick={handleToggleStatus} disabled={isSaving}>
                    {playbook.status === "archived" ? "Reativar análise" : "Arquivar análise"}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="playbook">
                <PlaybookMarkdownReview playbook={playbook} />
              </TabsContent>

              <TabsContent value="rubrica">
                <RubricEditor playbook={playbook} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
