import { useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Ban, CheckCircle2, Download, ExternalLink, Eye, Loader2, Play, RotateCcw, XCircle } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useActivitiesOperations, type ActivityOperationRow } from "@/hooks/useActivitiesOperations";
import { useAnalysisResultById } from "@/hooks/usePerformanceData";
import { AnalysisResultModal } from "./AnalysisResultModal";
import { useSelectableAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import { activityTypeToAnalysisType } from "@/types/analysis";
import { scoreTextClass } from "@/lib/analysisCatalog";

// crm_lead_activities ainda não expõe analysis_playbook_id em types.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE_VALUE = "__none__";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Painel operacional das atividades: quais têm transcrição, quais têm análise
 * vinculada e quais já foram avaliadas — com as ações para destravar cada uma.
 *
 * Restrito ao super admin porque age sobre atividades de todos os vendedores e
 * dispara recuperação de gravação no Daily, que consome cota externa.
 */
export function OperationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: rows, isLoading } = useActivitiesOperations(startDate, endDate);
  const { data: playbooks } = useSelectableAnalysisPlaybooks();

  const [savingId, setSavingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ total: number; done: number; failed: number } | null>(null);
  // Ref, não state: o laço roda numa closure e não enxergaria a atualização
  const cancelBatchRef = useRef(false);
  const [queueing, setQueueing] = useState<{ total: number; done: number } | null>(null);

  // Detalhe da avaliação sem sair da aba: aqui o operador decide se reavalia ou
  // descarta, e essa decisão depende de ler os veredictos
  const [viewResultId, setViewResultId] = useState<string | null>(null);
  const { data: viewResult } = useAnalysisResultById(viewResultId);

  // Prontos para avaliar: têm transcrição e análise, e ainda não foram avaliados
  const pendingCount = (rows ?? []).filter(
    (r) => r.transcriptionSource && r.analysisPlaybookId && !r.resultId,
  ).length;

  // Reavaliáveis: já avaliados e ainda dentro das métricas. Desconsideradas
  // ficam de fora — a gestão já as invalidou, reavaliar só gastaria IA.
  const reevaluableCount = (rows ?? []).filter(
    (r) => r.transcriptionSource && r.analysisPlaybookId && r.resultId && !r.disregarded,
  ).length;

  // Recuperáveis: têm sala no Daily e ainda não têm transcrição alguma
  const recoverableRows = (rows ?? []).filter(
    (r) => r.hasDailyRoom && !r.transcriptionSource && !r.recoveryFailed,
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["activities-operations"] });
  };

  const handleChangePlaybook = async (row: ActivityOperationRow, value: string) => {
    const playbookId = value === NONE_VALUE ? null : value;
    setSavingId(row.activityId);
    try {
      const { error } = await (supabase.from("crm_lead_activities") as any)
        .update({ analysis_playbook_id: playbookId })
        .eq("id", row.activityId);
      if (error) throw error;
      refresh();
      toast({ title: playbookId ? "Análise vinculada" : "Análise removida" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  /** Recuperação no Daily é assíncrona: cria job e acompanha até concluir. */
  const handleFetchTranscription = async (row: ActivityOperationRow) => {
    // Sem sala no Daily a funcao responde 500: nao ha gravacao a buscar
    if (!row.appointmentId || !row.hasDailyRoom) return;
    setFetchingId(row.activityId);
    try {
      const { data, error } = await supabase.functions.invoke("daily-room", {
        body: {
          action: "fetch-recordings",
          appointment_id: row.appointmentId,
          recovery_type: "transcription",
        },
      });
      if (error) throw error;

      const jobId = data?.job_id;
      if (!jobId) throw new Error("Falha ao criar job de recuperação");

      toast({ title: "Recuperação iniciada", description: "Buscando a transcrição no Daily..." });

      const startedAt = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(poll);
          setFetchingId(null);
          toast({
            variant: "destructive",
            title: "Recuperação demorou demais",
            description: "Consulte os logs da função daily-recording-worker.",
          });
          return;
        }

        let status: { status?: string; error?: string } | null = null;
        try {
          const { data } = await supabase.functions.invoke("daily-room", {
            body: { action: "fetch-recordings-status", job_id: jobId },
          });
          status = data;
        } catch (pollError) {
          // Falha pontual de rede nao encerra o acompanhamento
          console.warn("[OperationsTab] falha ao consultar job, tentando de novo:", pollError);
          return;
        }

        if (status?.status === "completed") {
          clearInterval(poll);
          setFetchingId(null);
          refresh();
          toast({ title: "Recuperação concluída", description: "Confira se a transcrição apareceu." });
        } else if (status?.status === "failed") {
          clearInterval(poll);
          setFetchingId(null);
          toast({
            variant: "destructive",
            title: "Não foi possível recuperar",
            description: status?.error ?? "O Daily não tem transcrição para esta reunião.",
          });
        }
      }, POLL_INTERVAL_MS);
    } catch (err: unknown) {
      setFetchingId(null);
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ variant: "destructive", title: "Erro ao recuperar", description: message });
    }
  };

  /**
   * Enfileira a recuperação de todas as transcrições faltantes.
   *
   * Só enfileira — não acompanha. Os jobs são independentes entre si e o worker
   * os processa em segundo plano; esperar aqui prenderia a tela por vários
   * minutos sem ganho. O daily-room ignora appointment que já tem job em
   * andamento, então clicar duas vezes não duplica.
   */
  const handleBatchFetch = async () => {
    if (recoverableRows.length === 0) return;

    setQueueing({ total: recoverableRows.length, done: 0 });
    let queued = 0;
    let failed = 0;

    for (const row of recoverableRows) {
      try {
        const { error } = await supabase.functions.invoke("daily-room", {
          body: {
            action: "fetch-recordings",
            appointment_id: row.appointmentId,
            recovery_type: "transcription",
          },
        });
        if (error) throw error;
        queued++;
      } catch (err) {
        console.error("[OperationsTab] falha ao enfileirar", row.appointmentId, err);
        failed++;
      }
      setQueueing({ total: recoverableRows.length, done: queued + failed });
    }

    setQueueing(null);
    toast({
      title: "Recuperação enfileirada",
      description:
        `${queued} na fila${failed > 0 ? `, ${failed} com falha` : ""}. ` +
        "O processamento roda em segundo plano — atualize o período em alguns minutos.",
    });
  };

  /** Executa uma avaliação. Devolve true quando gerou resultado. */
  const runAnalysis = async (row: ActivityOperationRow): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke("analyze-transcript-playbook", {
      body: {
        action: "evaluate",
        source_type: row.transcriptionSource,
        source_id: row.transcriptionSourceId,
        workspace_id: workspaceId,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return !data?.skipped;
  };

  /**
   * Refaz a memória de evolução dos vendedores destas linhas.
   *
   * A reavaliação preserva points_applied (não duplica pontos), mas por isso
   * grava os alertas de recorrência/correção vazios no resultado novo. O
   * rebuild reconstrói a memória a partir dos veredictos atualizados e
   * reescreve os alertas de cada avaliação.
   */
  const rebuildSellersMemory = async (list: ActivityOperationRow[]) => {
    if (!companyId) return;
    const sellerIds = [...new Set(list.map((r) => r.assignedTo).filter(Boolean))] as string[];
    for (const sellerId of sellerIds) {
      try {
        const { data, error } = await supabase.functions.invoke("analyze-transcript-playbook", {
          body: { action: "rebuild-points", company_id: companyId, seller_id: sellerId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      } catch (err) {
        console.error("[OperationsTab] falha ao reconstruir memoria do vendedor", sellerId, err);
      }
    }
  };

  /**
   * Executa avaliações em sequência, da mais antiga para a mais recente.
   *
   * A ordem importa: a memória de evolução é sequencial — cada avaliação
   * compara com o acumulado até ali. Fora de ordem, uma falha antiga vira
   * "recorrência" de uma recente. E sequencial, não paralelo, porque duas
   * avaliações simultâneas do mesmo vendedor disputariam o mesmo ponto.
   */
  const runSequentialBatch = async (list: ActivityOperationRow[]) => {
    const ordered = [...list].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    cancelBatchRef.current = false;
    setBatch({ total: ordered.length, done: 0, failed: 0 });

    let done = 0;
    let failed = 0;
    const succeeded: ActivityOperationRow[] = [];

    for (const row of ordered) {
      if (cancelBatchRef.current) break;
      setAnalyzingId(row.activityId);
      try {
        await runAnalysis(row);
        succeeded.push(row);
        done++;
      } catch (err) {
        console.error("[OperationsTab] falha ao avaliar", row.activityId, err);
        failed++;
      }
      setBatch({ total: ordered.length, done, failed });
    }

    setAnalyzingId(null);
    return { done, failed, total: ordered.length, succeeded };
  };

  const handleBatchAnalyze = async () => {
    const pending = (rows ?? []).filter(
      (r) => r.transcriptionSource && r.analysisPlaybookId && !r.resultId,
    );

    if (pending.length === 0) {
      toast({ title: "Nada a avaliar", description: "Todas as pendentes já foram avaliadas." });
      return;
    }

    const { done, failed, total } = await runSequentialBatch(pending);
    refresh();
    toast({
      title: cancelBatchRef.current ? "Avaliação interrompida" : "Avaliação em lote concluída",
      description: `${done} de ${total} avaliada(s)${failed > 0 ? `, ${failed} com falha` : ""}.`,
    });
    setBatch(null);
  };

  /** Reavalia os já avaliados do período — substitui cada resultado existente. */
  const handleBatchReevaluate = async () => {
    const evaluated = (rows ?? []).filter(
      (r) => r.transcriptionSource && r.analysisPlaybookId && r.resultId && !r.disregarded,
    );

    if (evaluated.length === 0) {
      toast({ title: "Nada a reavaliar", description: "Nenhum atendimento avaliado no período." });
      return;
    }

    const { done, failed, total, succeeded } = await runSequentialBatch(evaluated);

    // Mesmo interrompido, os que ja foram substituidos precisam da memoria refeita
    await rebuildSellersMemory(succeeded);

    refresh();
    toast({
      title: cancelBatchRef.current ? "Reavaliação interrompida" : "Reavaliação em lote concluída",
      description: `${done} de ${total} reavaliada(s)${failed > 0 ? `, ${failed} com falha` : ""}.`,
    });
    setBatch(null);
  };

  const handleAnalyze = async (row: ActivityOperationRow) => {
    // Em falhas anteriores a origem da transcrição pode não estar visível na
    // listagem: reaproveitamos a origem gravada no resultado que falhou
    const sourceType = row.transcriptionSource ?? row.resultSourceType;
    const sourceId = row.transcriptionSourceId ?? row.resultSourceId;
    if (!sourceType || !sourceId) return;

    setAnalyzingId(row.activityId);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-transcript-playbook", {
        body: {
          action: "evaluate",
          source_type: sourceType,
          source_id: sourceId,
          workspace_id: workspaceId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.skipped) {
        toast({
          variant: "destructive",
          title: "Avaliação não aplicada",
          description:
            data.reason === "no_active_rubric"
              ? "A análise vinculada ainda não tem rubrica ativa."
              : "Não foi possível avaliar este atendimento.",
        });
        return;
      }

      // Reavaliacao substitui o resultado: a memoria precisa ser refeita a
      // partir dos veredictos novos (ver rebuildSellersMemory)
      if (row.resultId) await rebuildSellersMemory([row]);

      refresh();
      toast({ title: "Atendimento avaliado", description: `Score ${data?.score ?? "-"}/100.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ variant: "destructive", title: "Erro ao analisar", description: message });
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Início</Label>
              <Input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fim</Label>
              <Input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
              />
            </div>
            {rows && (
              <p className="text-xs text-muted-foreground pb-2">
                {rows.length} atendimento{rows.length === 1 ? "" : "s"} ·{" "}
                {rows.filter((r) => r.transcriptionSource).length} com transcrição ·{" "}
                {rows.filter((r) => r.resultId).length} avaliada
                {rows.filter((r) => r.resultId).length === 1 ? "" : "s"}
              </p>
            )}

            <div className="ml-auto flex items-center gap-2 pb-1">
              {queueing ? (
                <span className="text-xs text-muted-foreground font-mono">
                  Enfileirando {queueing.done}/{queueing.total}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBatchFetch}
                  disabled={recoverableRows.length === 0 || !!batch}
                  title={
                    recoverableRows.length
                      ? "Enfileira a busca no Daily; o processamento roda em segundo plano"
                      : "Nenhuma reunião com sala do Daily aguardando transcrição"
                  }
                  className="gap-2"
                >
                  <Download className="h-3.5 w-3.5" />
                  Recuperar {recoverableRows.length || ""} transcriç
                  {recoverableRows.length === 1 ? "ão" : "ões"}
                </Button>
              )}

              {batch ? (
                <>
                  <span className="text-xs text-muted-foreground font-mono">
                    {batch.done + batch.failed}/{batch.total}
                    {batch.failed > 0 ? ` · ${batch.failed} falha(s)` : ""}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => { cancelBatchRef.current = true; }}>
                    Interromper
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBatchAnalyze}
                    disabled={!pendingCount}
                    title={
                      pendingCount
                        ? "Avalia da mais antiga para a mais recente, uma de cada vez"
                        : "Nenhum atendimento com transcrição e análise aguardando avaliação"
                    }
                    className="gap-2"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Avaliar {pendingCount || ""} pendente{pendingCount === 1 ? "" : "s"}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBatchReevaluate}
                    disabled={!reevaluableCount}
                    title={
                      reevaluableCount
                        ? "Substitui as avaliações existentes do período e refaz a memória de evolução dos vendedores. Desconsideradas ficam de fora."
                        : "Nenhum atendimento avaliado no período"
                    }
                    className="gap-2"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reavaliar {reevaluableCount || ""} avaliada{reevaluableCount === 1 ? "" : "s"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Atendimentos concluídos no período</CardTitle>
          <CardDescription>
            Reuniões, demonstrações e ligações já realizadas. Recupere transcrições pendentes, vincule a
            análise e dispare a avaliação — que só habilita quando há transcrição e análise vinculada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nenhum atendimento concluído neste período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Atendimento</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Transcrição</TableHead>
                    <TableHead className="min-w-52">Análise</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="w-40"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const analysisType = activityTypeToAnalysisType(row.type);
                    const options = (playbooks ?? []).filter(
                      (p) => !analysisType || (p.activity_types ?? []).includes(analysisType),
                    );
                    // Uma avaliação que falhou sempre pode ser tentada de novo
                    const retryFailed =
                      row.resultStatus === "failed" && !!row.resultSourceType && !!row.resultSourceId;
                    const canAnalyze =
                      (!!row.transcriptionSource || retryFailed) && !!row.analysisPlaybookId;

                    return (
                      <TableRow key={row.activityId}>
                        <TableCell className="min-w-56">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-foreground line-clamp-1">{row.title}</span>
                              {row.leadId && (
                                <a
                                  href={`/crm/pipeline?lead=${row.leadId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary shrink-0"
                                  aria-label="Abrir card"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-mono">
                              {format(new Date(row.scheduledAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground">
                          {row.assigneeName ?? "—"}
                        </TableCell>

                        <TableCell>
                          {row.transcriptionSource ? (
                            <Badge className="badge-success gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {row.transcriptionSource === "meeting_chunks" ? "Ao vivo" : "Salva"}
                            </Badge>
                          ) : row.appointmentId && row.hasDailyRoom && !row.recoveryFailed ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleFetchTranscription(row)}
                              disabled={fetchingId === row.activityId}
                              className="gap-1.5 h-7 text-xs"
                            >
                              {fetchingId === row.activityId ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              Recuperar
                            </Button>
                          ) : row.recoveryFailed ? (
                            <span
                              className="text-xs text-muted-foreground flex items-center gap-1"
                              title="A recuperação já foi tentada e o Daily não tem o arquivo desta reunião"
                            >
                              <XCircle className="h-3 w-3" />
                              Sem gravação no Daily
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              {row.appointmentId ? "Sem sala online" : "Sem reunião"}
                            </span>
                          )}
                        </TableCell>

                        <TableCell>
                          {options.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Não aplicável</span>
                          ) : (
                            <Select
                              value={row.analysisPlaybookId ?? NONE_VALUE}
                              onValueChange={(value) => handleChangePlaybook(row, value)}
                              disabled={savingId === row.activityId}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>Sem análise</SelectItem>
                                {options.map((playbook) => (
                                  <SelectItem key={playbook.id} value={playbook.id}>
                                    {playbook.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          {row.score !== null ? (
                            <button
                              type="button"
                              onClick={() => setViewResultId(row.resultId)}
                              title="Ver a avaliação com as evidências"
                              className="flex items-center justify-end gap-1.5 ml-auto rounded px-1.5 py-0.5 transition-colors hover:bg-muted/50"
                            >
                              {row.disregarded && <Ban className="h-3 w-3 text-warning" />}
                              <span
                                className={`font-bold font-display ${
                                  row.disregarded
                                    ? "text-muted-foreground line-through"
                                    : scoreTextClass(row.score)
                                }`}
                              >
                                {row.score}
                              </span>
                              <Eye className="h-3 w-3 text-muted-foreground" />
                            </button>
                          ) : row.resultStatus === "failed" ? (
                            <Badge className="badge-primary text-[10px]">Falhou</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAnalyze(row)}
                            disabled={!canAnalyze || !!analyzingId || !!batch}
                            title={
                              canAnalyze
                                ? undefined
                                : !row.transcriptionSource
                                  ? "Sem transcrição disponível"
                                  : "Vincule uma análise primeiro"
                            }
                            className="gap-1.5 h-7 text-xs"
                          >
                            {analyzingId === row.activityId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            {row.resultStatus === "failed"
                              ? "Tentar de novo"
                              : row.resultId
                                ? "Reavaliar"
                                : "Avaliar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AnalysisResultModal
        result={viewResult ?? null}
        open={!!viewResultId && !!viewResult}
        onOpenChange={(open) => !open && setViewResultId(null)}
      />
    </div>
  );
}
