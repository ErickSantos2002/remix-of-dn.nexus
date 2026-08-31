import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Loader2, Play, RefreshCw, Trash2 } from "lucide-react";
import { useSelectableAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import { useActivityAnalysisResult } from "@/hooks/usePerformanceData";
import { useUserRole } from "@/hooks/useUserRole";
import { AnalysisResultModal } from "@/components/performance/AnalysisResultModal";
import { activityTypeToAnalysisType } from "@/types/analysis";
import { scoreTextClass } from "@/lib/analysisCatalog";

// A tabela crm_lead_activities ainda não expõe analysis_playbook_id em types.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE_VALUE = "__none__";

export interface AnalyzableSource {
  id: string;
  /**
   * `daily_recording` é o arquivo entregue pelo Daily depois da reunião;
   * `meeting_chunks` é a transcrição capturada ao vivo, usada quando o Daily
   * não guardou arquivo (transcrição ao vivo não é armazenada por padrão).
   */
  sourceType: "daily_recording" | "meeting_chunks";
  /** Sufixo quando a reunião tem mais de uma gravação (" · parte 2"). */
  label: string;
  hasAnalysis: boolean;
}

interface Props {
  activityId: string;
  activityType: string;
  workspaceId: string;
  /** Vínculo atual da atividade; `null` faz cair na análise genérica. */
  analysisPlaybookId: string | null;
  sources: AnalyzableSource[];
  /** Invalida as queries do diálogo depois de avaliar. */
  onAnalyzed: () => void;
}

/**
 * Bloco de avaliação dentro do detalhe da atividade.
 *
 * Permite escolher a análise e rodá-la sobre a transcrição sem precisar recriar
 * a atividade — o select de análise só existe no momento da criação, e reuniões
 * antigas (ou criadas antes do cadastro da análise) ficariam sem como avaliar.
 *
 * A escolha é persistida na atividade, então também passa a valer para as
 * execuções automáticas seguintes daquela reunião.
 */
export function ActivityAnalysisSection({
  activityId,
  activityType,
  workspaceId,
  analysisPlaybookId,
  sources,
  onAnalyzed,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analysisType = activityTypeToAnalysisType(activityType);
  const { data: playbooks } = useSelectableAnalysisPlaybooks(analysisType ?? undefined);
  const { data: result } = useActivityAnalysisResult(activityId);
  const { isAdmin, isSuperAdmin } = useUserRole();

  // Na primeira atividade do tipo dentro do card, o membro só pode pedir a
  // avaliação uma vez: não troca a análise aplicada nem reavalia.
  const { data: isFirstOfType } = useQuery({
    queryKey: ["activity-first-of-type", activityId],
    queryFn: async () => {
      const { data: current } = await (supabase.from("crm_lead_activities") as any)
        .select("lead_id, type, created_at")
        .eq("id", activityId)
        .maybeSingle();
      if (!current?.lead_id) return false;
      const { data: first } = await (supabase.from("crm_lead_activities") as any)
        .select("id")
        .eq("lead_id", current.lead_id)
        .eq("type", current.type)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return first?.id === activityId;
    },
  });

  const [selected, setSelected] = useState(analysisPlaybookId ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (sources.length === 0) return null;

  const hasPlaybooks = !!playbooks && playbooks.length > 0;

  // Membro na primeira atividade do tipo: leitura da análise, sem reavaliar
  const isRestrictedMember = !isAdmin && !isSuperAdmin && isFirstOfType === true;

  // Avaliação já existente é imutável: só volta a ser editável se for excluída
  // (ação exclusiva de super admin).
  const hasResult = !!result;
  const isLocked = hasResult || (isRestrictedMember && sources.some((s) => s.hasAnalysis));

  const handleDelete = async () => {
    if (!result?.id) return;
    setIsDeleting(true);
    try {
      const { error } = await (supabase.from("activity_analysis_results") as any)
        .delete()
        .eq("id", result.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["analysis-result", "activity", activityId] });
      queryClient.invalidateQueries({ queryKey: ["performance-data"] });
      onAnalyzed();
      toast({ title: "Avaliação excluída", description: "O atendimento pode ser avaliado novamente." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível excluir a avaliação.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };


  const handleSelect = async (value: string) => {
    const playbookId = value === NONE_VALUE ? null : value;
    setSelected(playbookId ?? "");
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("crm_lead_activities") as any)
        .update({ analysis_playbook_id: playbookId })
        .eq("id", activityId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["crm-activities"] });
      toast({
        title: playbookId ? "Análise vinculada" : "Análise removida",
        description: playbookId
          ? "Clique em Avaliar atendimento para gerar o score."
          : "Este atendimento voltará a usar a análise geral.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível vincular a análise.";
      toast({ title: "Erro", description: message, variant: "destructive" });
      setSelected(analysisPlaybookId ?? "");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async (source: AnalyzableSource) => {
    const recordingId = source.id;
    setRunningId(recordingId);
    try {
      // A análise genérica só sabe ler gravação do Daily; para transcrição ao
      // vivo a avaliação por playbook é o único caminho.
      const genericAvailable = source.sourceType === "daily_recording";

      const { data, error } = selected || !genericAvailable
        ? await supabase.functions.invoke("analyze-transcript-playbook", {
            body: {
              action: "evaluate",
              source_type: source.sourceType,
              source_id: recordingId,
              workspace_id: workspaceId,
            },
          })
        : await supabase.functions.invoke("analyze-meeting", {
            body: { recording_id: recordingId, workspace_id: workspaceId },
          });

      if (error) throw error;
      if (data?.error) {
        toast({ variant: "destructive", title: "Erro na análise", description: data.error });
        return;
      }

      if (data?.skipped) {
        if (!genericAvailable) {
          toast({
            variant: "destructive",
            title: "Avaliação não aplicada",
            description:
              data.reason === "no_active_rubric"
                ? "A análise selecionada ainda não tem rubrica ativa. Ative-a em Configurações da Empresa."
                : "Selecione uma análise para avaliar esta transcrição.",
          });
          return;
        }
        // Playbook vinculado mas sem rubrica ativa: não deixa o usuário sem retorno
        const fallback = await supabase.functions.invoke("analyze-meeting", {
          body: { recording_id: recordingId, workspace_id: workspaceId },
        });
        if (fallback.error) throw fallback.error;
        toast({
          title: "Análise geral concluída",
          description:
            data.reason === "no_active_rubric"
              ? "A análise selecionada ainda não tem rubrica ativa. Ative-a em Configurações da Empresa."
              : "A avaliação por playbook não se aplica a este atendimento.",
        });
      } else {
        toast({
          title: "Atendimento avaliado",
          description: selected ? `Score ${data?.score ?? "-"}/100.` : "Transcrição analisada com sucesso.",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["analysis-result", "activity", activityId] });
      queryClient.invalidateQueries({ queryKey: ["performance-data"] });
      onAnalyzed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ variant: "destructive", title: "Erro ao analisar", description: message });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Avaliação do atendimento</p>
        {result?.score !== null && result?.score !== undefined && (
          <Badge className="badge-neutral font-mono">
            <span className={scoreTextClass(result.score)}>{result.score}</span>
            <span className="text-muted-foreground">/100</span>
          </Badge>
        )}
      </div>

      {analysisType && hasPlaybooks ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Análise aplicada</Label>
          <Select
            value={selected || NONE_VALUE}
            onValueChange={handleSelect}
            disabled={isSaving || !!runningId || isLocked}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Análise geral (sem playbook)</SelectItem>
              {playbooks!.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {analysisType
            ? "Nenhuma análise ativa para este tipo de atendimento. Cadastre em Configurações da Empresa."
            : "Este tipo de atividade não é avaliado por playbook."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {sources.map((source) => (
          <Button
            key={`${source.sourceType}-${source.id}`}
            variant="outline"
            size="sm"
            onClick={() => handleRun(source)}
            disabled={!!runningId || isSaving || isLocked}
            className="gap-2"
          >
            {runningId === source.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : source.hasAnalysis ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {source.hasAnalysis ? "Reavaliar" : "Avaliar atendimento"}
            {source.label}
          </Button>
        ))}

        {result && (
          <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)} className="gap-2">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Ver avaliação
          </Button>
        )}

        {result && isSuperAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={isDeleting || !!runningId}
            className="gap-2 text-destructive hover:text-destructive"
          >
            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Excluir avaliação
          </Button>
        )}
      </div>

      {hasResult && (
        <p className="text-xs text-muted-foreground">
          {isSuperAdmin
            ? "Este atendimento já foi avaliado. Para trocar a análise ou reavaliar, exclua a avaliação atual."
            : "Este atendimento já foi avaliado e não pode ser alterado. Peça a um super administrador para excluir a avaliação."}
        </p>
      )}

      {!hasResult && isRestrictedMember && (
        <p className="text-xs text-muted-foreground">
          Você pode solicitar a avaliação uma única vez neste atendimento.
        </p>
      )}


      {sources.every((source) => source.sourceType === "meeting_chunks") && (
        <p className="text-xs text-muted-foreground">
          O Daily não guardou o arquivo desta reunião. A avaliação usa a transcrição capturada ao vivo,
          que pode não cobrir trechos anteriores à entrada do host.
        </p>
      )}

      <AnalysisResultModal result={result ?? null} open={isModalOpen} onOpenChange={setIsModalOpen} />
    </div>
  );
}
