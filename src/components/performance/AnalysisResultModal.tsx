import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Ban, Building2, CheckCircle2, ExternalLink, Loader2, Quote, RotateCcw, Sparkles, Undo2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { useAnalysisLeadContext, useDisregardAnalysis } from "@/hooks/usePerformanceData";
import {
  VERDICT_BADGE_CLASS,
  VERDICT_LABELS,
  habitLabel,
  humanizeKey,
  scoreTextClass,
} from "@/lib/analysisCatalog";
import type { ActivityAnalysisResult, CriterionResult } from "@/types/analysis";

interface Props {
  result: ActivityAnalysisResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Agrupa critérios por etapa preservando a ordem em que aparecem na rubrica. */
function groupByStage(criteria: CriterionResult[]): Array<{ stage: string; items: CriterionResult[] }> {
  const groups: Array<{ stage: string; items: CriterionResult[] }> = [];
  for (const criterion of criteria) {
    const stage = criterion.stage?.trim() || "Geral";
    const existing = groups.find((group) => group.stage === stage);
    if (existing) existing.items.push(criterion);
    else groups.push({ stage, items: [criterion] });
  }
  return groups;
}

/**
 * Detalhe completo de uma avaliação: score, quebra por critério com a evidência
 * citada da transcrição, pontos fortes, ajustes, hábitos e os alertas de
 * recorrência/correção.
 */
export function AnalysisResultModal({ result, open, onOpenChange }: Props) {
  const groups = useMemo(() => groupByStage(result?.criteria_results ?? []), [result]);
  const { data: leadContext } = useAnalysisLeadContext(result?.lead_id);
  const { toast } = useToast();
  const { isAdmin, isSuperAdmin } = useUserRole();
  const disregard = useDisregardAnalysis();

  // Só papel admin ou super_admin. Descartar tira a avaliação da média, do
  // ranking e da evolução do vendedor — é decisão de gestão, não de quem
  // apenas administra o workspace ou é dono da empresa no cadastro.
  const canDisregard = isAdmin || isSuperAdmin;
  const isDisregarded = !!result?.disregarded_at;

  const handleToggleDisregard = async () => {
    if (!result) return;
    try {
      await disregard.mutateAsync({
        resultId: result.id,
        disregarded: !isDisregarded,
        companyId: result.company_id,
        sellerId: result.seller_id,
      });
      toast({
        title: isDisregarded ? "Avaliação reconsiderada" : "Avaliação desconsiderada",
        description: isDisregarded
          ? "Ela volta a contar na média, no ranking e na evolução do vendedor."
          : "Ela continua visível, mas saiu da média, do ranking e da evolução do vendedor.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível alterar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    }
  };

  if (!result) return null;

  const summary = {
    met: result.criteria_results.filter((c) => c.verdict === "met").length,
    partial: result.criteria_results.filter((c) => c.verdict === "partial").length,
    missed: result.criteria_results.filter((c) => c.verdict === "missed").length,
    notApplicable: result.criteria_results.filter((c) => c.verdict === "not_applicable").length,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Avaliação do atendimento</DialogTitle>
          <DialogDescription>
            {format(new Date(result.occurred_at), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
            {/* Quando avaliação e atendimento não são do mesmo dia (lote,
                reprocessamento), esconder isso faria a data parecer errada */}
            {result.occurred_at.slice(0, 10) !== result.created_at.slice(0, 10) && (
              <span className="block text-xs">
                Avaliada em {format(new Date(result.created_at), "dd/MM/yyyy", { locale: ptBR })}
              </span>
            )}
            {result.source_type === "meeting_chunks" && (
              <span className="block mt-1 text-warning">
                Avaliado a partir da transcrição ao vivo — o Daily não guardou o arquivo desta reunião.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isDisregarded && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm text-foreground flex items-center gap-2">
              <Ban className="h-4 w-4 text-warning" />
              Avaliação desconsiderada
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Fora da média, do ranking e da evolução do vendedor. O registro é mantido para consulta.
            </p>
          </div>
        )}

        {/* De qual atendimento se trata: o painel fica longe do pipeline */}
        {(leadContext || result.lead_id) && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border bg-background/40 p-3">
            <div className="min-w-0 space-y-1">
              {leadContext?.companyName && (
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  {leadContext.companyName}
                </p>
              )}
              {leadContext?.contactName && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <User className="h-3 w-3 shrink-0" />
                  {leadContext.contactName}
                </p>
              )}
              {!leadContext?.companyName && !leadContext?.contactName && leadContext?.leadTitle && (
                <p className="text-sm font-medium text-foreground">{leadContext.leadTitle}</p>
              )}
            </div>
            {result.lead_id && (
              <a
                href={`/crm/pipeline?lead=${result.lead_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
              >
                Abrir card
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {result.status === "failed" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-sm text-foreground">Esta avaliação falhou.</p>
            <p className="text-xs text-muted-foreground mt-1">{result.error_message}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Score */}
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Score</p>
                <p className={`text-5xl font-bold font-display ${scoreTextClass(result.score)}`}>
                  {result.score ?? "-"}
                  <span className="text-xl text-muted-foreground font-normal">/100</span>
                </p>
              </div>
              <div className="flex items-center gap-2 pb-2 flex-wrap">
                <Badge variant="outline" className="badge-success">{summary.met} atendidos</Badge>
                <Badge variant="outline" className="badge-warning">{summary.partial} parciais</Badge>
                <Badge variant="outline" className="badge-accent">{summary.missed} não atendidos</Badge>
                {summary.notApplicable > 0 && (
                  // Fora do score: etapas que não aconteceram nesta reunião
                  <Badge variant="outline" className="badge-neutral">{summary.notApplicable} não se aplicam</Badge>

                )}
              </div>
            </div>

            {/* Alertas de evolução */}
            {(result.corrected.length > 0 || result.recurrences.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {result.corrected.length > 0 && (
                  <div className="rounded-lg border border-success/40 bg-success/10 p-3 space-y-2">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      Pontos corrigidos
                    </p>
                    <ul className="space-y-1">
                      {result.corrected.map((item) => (
                        <li key={item.point_key} className="text-xs text-muted-foreground">
                          {item.point_type === "habit" ? habitLabel(item.point_key) : item.label || humanizeKey(item.point_key)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.recurrences.length > 0 && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-warning" />
                      Falhas recorrentes
                    </p>
                    <ul className="space-y-1">
                      {result.recurrences.map((item) => (
                        <li key={item.point_key} className="text-xs text-muted-foreground">
                          {item.point_type === "habit" ? habitLabel(item.point_key) : item.label || humanizeKey(item.point_key)}
                          <span className="font-mono"> · {item.occurrences}x</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {result.summary_md && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Resumo</p>
                  <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {result.summary_md}
                  </div>
                </div>
              </>
            )}

            {/* Critérios */}
            <Separator />
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Critérios avaliados</p>
              {groups.map((group) => (
                <div key={group.stage} className="space-y-2">
                  <p className="text-sm font-medium text-foreground">{group.stage}</p>
                  {group.items.map((criterion) => (
                    <div
                      key={criterion.criterion_key}
                      className="rounded-lg border border-border bg-background/40 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground">{criterion.name ?? criterion.criterion_key}</p>
                        <Badge variant="outline" className={`${VERDICT_BADGE_CLASS[criterion.verdict]} shrink-0`}>
                          {VERDICT_LABELS[criterion.verdict]}
                        </Badge>
                      </div>
                      {criterion.feedback && (
                        <p className="text-xs text-muted-foreground">{criterion.feedback}</p>
                      )}
                      {criterion.evidence && (
                        <div
                          className={`flex gap-2 rounded border-l-2 p-2 ${
                            criterion.evidence_verified === false
                              ? "border-warning/50 bg-warning/5"
                              : "border-primary/40 bg-primary/5"
                          }`}
                        >
                          <Quote
                            className={`h-3 w-3 shrink-0 mt-0.5 ${
                              criterion.evidence_verified === false ? "text-warning" : "text-primary"
                            }`}
                          />
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground italic">{criterion.evidence}</p>
                            {criterion.evidence_verified === false && (
                              <p className="text-[10px] text-warning">
                                Citação não conferida: este trecho não foi encontrado literalmente na
                                transcrição. O veredicto acima não depende dele.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Pontos fortes */}
            {result.strengths.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Pontos fortes</p>
                  {result.strengths.map((strength, index) => (
                    <div key={index} className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1">
                      <p className="text-sm text-foreground flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-success" />
                        {strength.title}
                      </p>
                      {strength.evidence && (
                        <p className="text-xs text-muted-foreground italic">{strength.evidence}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Ajustes */}
            {result.improvements.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">O que ajustar</p>
                  {result.improvements.map((improvement, index) => (
                    <div key={index} className="rounded-lg border border-border bg-background/40 p-3 space-y-1">
                      <p className="text-sm text-foreground flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        {improvement.title}
                      </p>
                      {improvement.suggestion && (
                        <p className="text-xs text-muted-foreground">{improvement.suggestion}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {canDisregard && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    {isDisregarded
                      ? "Esta avaliação está fora das métricas."
                      : "Se este atendimento não representa o desempenho do vendedor, descarte-o das métricas."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleDisregard}
                    disabled={disregard.isPending}
                    className="gap-2"
                  >
                    {disregard.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isDisregarded ? (
                      <Undo2 className="h-3.5 w-3.5" />
                    ) : (
                      <Ban className="h-3.5 w-3.5" />
                    )}
                    {isDisregarded ? "Reconsiderar avaliação" : "Desconsiderar avaliação"}
                  </Button>
                </div>
              </>
            )}

            {/* Hábitos */}
            {result.habits.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Hábitos observados</p>
                  <div className="flex flex-wrap gap-2">
                    {result.habits.map((habit) => (
                      <Badge
                        key={habit.habit_key}
                        variant="outline"
                        className={habit.observed === "positive" ? "badge-success" : "badge-warning"}

                      >
                        {habitLabel(habit.habit_key)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
