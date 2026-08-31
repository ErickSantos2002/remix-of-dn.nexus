import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Award, Ban, ClipboardCheck, Loader2, RotateCcw, Target, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/shared/KPICard";
import { ScoreEvolutionChart } from "./ScoreEvolutionChart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { groupScoreSeries, type ScoreGrouping } from "@/lib/scoreSeriesGrouping";

import { AnalysisResultModal } from "./AnalysisResultModal";
import { DevelopmentPointsInfo } from "./DevelopmentPointsInfo";

import { usePerformanceData, useAnalysisLeadContexts } from "@/hooks/usePerformanceData";
import { achievementLabel, habitLabel, humanizeKey, scoreTextClass } from "@/lib/analysisCatalog";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";
import type { ActivityAnalysisResult, SellerDevelopmentPoint } from "@/types/analysis";

interface Props {
  period: PeriodFilter;
  customRange?: CustomDateRange;
  /** Sem valor, mostra o desempenho do usuário logado. */
  sellerId?: string | null;
  playbookId?: string | null;
}

function pointLabel(point: SellerDevelopmentPoint): string {
  if (point.label) return point.label;
  // Registros anteriores à persistência do rótulo caem no catálogo (hábitos) ou
  // na conversão da chave (critérios)
  return point.point_type === "habit" ? habitLabel(point.point_key) : humanizeKey(point.point_key);
}

function PointList({
  points,
  emptyMessage,
  tone,
}: {
  points: SellerDevelopmentPoint[];
  emptyMessage: string;
  tone: "neutral" | "warning" | "success";
}) {
  if (points.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">{emptyMessage}</p>;
  }

  const badgeClass =
    tone === "success" ? "badge-success" : tone === "warning" ? "badge-warning" : "badge-neutral";

  return (
    <ul className="space-y-2">
      {points.map((point) => (
        <li key={point.id} className="flex items-center justify-between gap-2">
          <span className="text-sm text-foreground line-clamp-2" title={pointLabel(point)}>
            {pointLabel(point)}
          </span>
          <Badge className={`${badgeClass} shrink-0 font-mono`}>{point.occurrences}x</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Painel individual do vendedor: evolução, pontos de desenvolvimento e conquistas.
 * Reutilizado pela visão do gestor passando `sellerId`.
 */
export function SellerDashboard({ period, customRange, sellerId, playbookId }: Props) {
  const { data, isLoading } = usePerformanceData(period, customRange, sellerId, playbookId);
  const [selectedResult, setSelectedResult] = useState<ActivityAnalysisResult | null>(null);
  const [grouping, setGrouping] = useState<ScoreGrouping>("day");
  const groupedSeries = useMemo(
    () => groupScoreSeries(data?.scoreSeries ?? [], grouping),
    [data?.scoreSeries, grouping],
  );


  // A avaliação aberta vive na URL: o link pode ser compartilhado e o botão
  // voltar do navegador fecha o modal em vez de sair da página.
  const [searchParams, setSearchParams] = useSearchParams();
  const openResultId = searchParams.get("avaliacao");

  useEffect(() => {
    if (!openResultId) {
      setSelectedResult(null);
      return;
    }
    const match = data?.results.find((r) => r.id === openResultId);
    if (match) setSelectedResult(match);
  }, [openResultId, data?.results]);

  // Título do card e contato de cada avaliação listada, em uma consulta só
  const recentResults = useMemo(() => data?.results.slice(0, 20) ?? [], [data?.results]);
  const { data: leadContexts } = useAnalysisLeadContexts(recentResults.map((r) => r.lead_id));

  const openResult = (result: ActivityAnalysisResult) => {
    const next = new URLSearchParams(searchParams);
    next.set("avaliacao", result.id);
    setSearchParams(next);
  };

  const closeResult = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("avaliacao");
    setSearchParams(next, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.analysesCount === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center space-y-2">
          <p className="text-sm text-foreground">Nenhum atendimento avaliado neste período.</p>
          <p className="text-xs text-muted-foreground">
            As avaliações aparecem aqui automaticamente depois que a transcrição de uma reunião, demonstração
            ou ligação com análise vinculada é processada.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Score médio"
          value={data.averageScore ?? "-"}
          description="Média das avaliações do período"
          trend={data.trend}
          trendLabel="vs. início do período"
          trendSuffix=" pts"
          icon={<Target className="h-4 w-4 text-primary" />}
          colorClass="bg-primary/10"
        />
        <KPICard
          title="Atendimentos avaliados"
          value={data.analysesCount}
          description="Reuniões, demos e ligações"
          trend={0}
          trendLabel=""
          icon={<ClipboardCheck className="h-4 w-4 text-primary" />}
          colorClass="bg-primary/10"
        />
        <KPICard
          title="Pontos corrigidos"
          value={data.correctedPoints.length}
          description="Falhas resolvidas no período"
          trend={0}
          trendLabel=""
          icon={<TrendingUp className="h-4 w-4 text-success" />}
          colorClass="bg-success/10"
        />
        <KPICard
          title="Falhas recorrentes"
          value={data.recurrentPoints.length}
          description="Voltaram a ocorrer no período"
          trend={0}
          trendLabel=""
          icon={<RotateCcw className="h-4 w-4 text-warning" />}
          colorClass="bg-warning/10"
        />
      </div>

      {data.scoreSeries.length > 1 && (
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Evolução do score</CardTitle>
              <CardDescription>
                {grouping === "day"
                  ? "Média por dia no período selecionado"
                  : grouping === "week"
                    ? "Média simples por semana no período selecionado"
                    : "Média simples por mês no período selecionado"}
              </CardDescription>
            </div>
            <ToggleGroup
              type="single"
              size="sm"
              value={grouping}
              onValueChange={(value) => value && setGrouping(value as ScoreGrouping)}
            >
              <ToggleGroupItem value="day">Dia</ToggleGroupItem>
              <ToggleGroupItem value="week">Semana</ToggleGroupItem>
              <ToggleGroupItem value="month">Mês</ToggleGroupItem>
            </ToggleGroup>
          </CardHeader>
          <CardContent>
            <ScoreEvolutionChart data={groupedSeries} />
          </CardContent>

        </Card>
      )}


      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">Em aberto</CardTitle>
              <DevelopmentPointsInfo kind="open" />
            </div>
            <CardDescription>Apontados uma vez no período, ainda sem correção</CardDescription>
          </CardHeader>
          <CardContent>
            <PointList
              points={data.openPoints}
              emptyMessage="Nenhum ponto em aberto no período."
              tone="neutral"
            />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">Recorrentes</CardTitle>
              <DevelopmentPointsInfo kind="recurrent" />
            </div>
            <CardDescription>Voltaram a ocorrer no período selecionado</CardDescription>
          </CardHeader>
          <CardContent>
            <PointList
              points={data.recurrentPoints}
              emptyMessage="Nenhuma falha recorrente no período. Bom sinal."
              tone="warning"
            />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">Corrigidos</CardTitle>
              <DevelopmentPointsInfo kind="corrected" />
            </div>
            <CardDescription>Deixaram de aparecer no período selecionado</CardDescription>
          </CardHeader>
          <CardContent>
            <PointList
              points={data.correctedPoints}
              emptyMessage="Nenhum ponto corrigido no período."
              tone="success"
            />
          </CardContent>
        </Card>
      </div>

      {data.achievements.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-primary" />
              Conquistas
            </CardTitle>
            <CardDescription>
              Marcos acumulados na evolução — não dependem do período selecionado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.achievements.map((achievement) => (
                <Badge key={achievement.id} className="badge-accent">
                  {achievementLabel(achievement.achievement_key)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Últimas avaliações</CardTitle>
          <CardDescription>Clique para ver o detalhe com as evidências</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentResults.map((result) => {
              const context = result.lead_id ? leadContexts?.get(result.lead_id) : undefined;
              // Contato identifica melhor que a empresa quando o card tem nome
              // genérico; a empresa entra como reserva
              const subject = context?.contactName ?? context?.companyName ?? null;

              return (
                <button
                  key={result.id}
                  onClick={() => openResult(result)}
                  className="w-full flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-foreground truncate">
                        {context?.leadTitle || subject || "Atendimento avaliado"}
                      </p>
                      {result.disregarded_at && (
                        <Badge className="badge-warning gap-1">
                          <Ban className="h-3 w-3" />
                          Desconsiderada
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[subject, format(new Date(result.occurred_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {result.recurrences.length > 0
                        ? `${result.recurrences.length} ponto(s) recorrente(s)`
                        : result.corrected.length > 0
                          ? `${result.corrected.length} ponto(s) corrigido(s)`
                          : "Sem alertas de recorrência"}
                    </p>
                  </div>
                  <span
                    className={`text-2xl font-bold font-display shrink-0 ${
                      result.disregarded_at ? "text-muted-foreground line-through" : scoreTextClass(result.score)
                    }`}
                  >
                    {result.score ?? "-"}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AnalysisResultModal
        result={selectedResult}
        open={!!selectedResult}
        onOpenChange={(open) => !open && closeResult()}
      />
    </div>
  );
}
