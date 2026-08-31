import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Target, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KPICard } from "@/components/shared/KPICard";
import { ScoreEvolutionChart, type ScorePoint } from "./ScoreEvolutionChart";
import { useTeamPerformance } from "@/hooks/useTeamPerformance";
import { scoreTextClass } from "@/lib/analysisCatalog";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";
import { groupScoreSeries, type ScoreGrouping } from "@/lib/scoreSeriesGrouping";



interface Props {
  period: PeriodFilter;
  customRange?: CustomDateRange;
  playbookId?: string | null;
}

type Grouping = ScoreGrouping;

const groupSeries = (series: Array<{ date: string; score: number }>, grouping: Grouping): ScorePoint[] =>
  groupScoreSeries(series, grouping);


/** Visão agregada da empresa: como o time está performando no período. */
export function TeamOverviewTab({ period, customRange, playbookId }: Props) {
  const { data, isLoading } = useTeamPerformance(period, customRange, playbookId);
  const [grouping, setGrouping] = useState<Grouping>("day");

  const groupedSeries = useMemo(
    () => groupSeries(data?.scoreSeries ?? [], grouping),
    [data?.scoreSeries, grouping],
  );


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.totalAnalyses === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center space-y-2">
          <p className="text-sm text-foreground">Nenhum atendimento avaliado neste período.</p>
          <p className="text-xs text-muted-foreground">
            Vincule uma análise às reuniões e ligações para que as avaliações comecem a aparecer aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Score médio da empresa"
          value={data.companyAverage ?? "-"}
          description="Média de todos os atendimentos avaliados"
          trend={0}
          trendLabel=""
          icon={<Target className="h-4 w-4 text-primary" />}
          colorClass="bg-primary/10"
          valueClassName={scoreTextClass(data.companyAverage)}
        />
        <KPICard
          title="Atendimentos avaliados"
          value={data.totalAnalyses}
          description="No período selecionado"
          trend={0}
          trendLabel=""
          icon={<ClipboardCheck className="h-4 w-4 text-primary" />}
          colorClass="bg-primary/10"
        />
        <KPICard
          title="Vendedores avaliados"
          value={data.ranking.length}
          description="Com ao menos um atendimento"
          trend={0}
          trendLabel=""
          icon={<Users className="h-4 w-4 text-success" />}
          colorClass="bg-success/10"
        />
      </div>

      {data.scoreSeries.length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Evolução do time</CardTitle>
                <CardDescription>
                  Score médio da empresa por{" "}
                  {grouping === "day" ? "dia" : grouping === "week" ? "semana" : "mês"} (média simples)
                </CardDescription>
              </div>
              <ToggleGroup
                type="single"
                size="sm"
                value={grouping}
                onValueChange={(value) => value && setGrouping(value as Grouping)}
              >
                <ToggleGroupItem value="day">Dia</ToggleGroupItem>
                <ToggleGroupItem value="week">Semana</ToggleGroupItem>
                <ToggleGroupItem value="month">Mês</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </CardHeader>
          <CardContent>
            <ScoreEvolutionChart data={groupedSeries} />
          </CardContent>

        </Card>
      )}


      {data.byPlaybook.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Desempenho por tipo de análise</CardTitle>
            <CardDescription>Onde o time vai melhor e onde precisa de apoio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.byPlaybook.map((item) => (
                <div
                  key={item.playbook_id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {item.count} atendimento{item.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className={`text-2xl font-bold font-display shrink-0 ${scoreTextClass(item.avg_score)}`}>
                    {item.avg_score}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
