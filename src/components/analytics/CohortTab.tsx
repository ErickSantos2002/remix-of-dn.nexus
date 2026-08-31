import { useState, useMemo } from "react";
import { Loader2, Clock, DollarSign, Users, TrendingUp, Info, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useCohortAnalytics, CohortFilters } from "@/hooks/useCohortAnalytics";
import { FunnelStageLeadsDialog } from "./FunnelStageLeadsDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function CohortTab() {
  const [filters, setFilters] = useState<CohortFilters>({
    monthsBack: 6,
  });
  const [selectedCell, setSelectedCell] = useState<{ title: string; leadIds: string[]; contextLabel?: string } | null>(null);

  const { data, isLoading, excludedLeadIds, refetch } = useCohortAnalytics(filters);

  // Max M index for evolution matrix
  const maxMIndex = useMemo(() => {
    if (!data) return 0;
    let max = 0;
    for (const c of data.cohorts) {
      for (const key of Object.keys(c.evolutionMatrix)) {
        const n = parseInt(key);
        if (n > max) max = n;
      }
    }
    return Math.min(max, 11); // Cap at M11
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasData = !!data && data.cohorts.length > 0;
  const cohorts = data?.cohorts ?? [];
  const stages = data?.stages ?? [];
  const avgConversionDays = data?.avgConversionDays ?? {};

  const clickableCell = "cursor-pointer hover:bg-muted/30 transition-colors";

  function openDialog(title: string, leadIds: string[], contextLabel?: string) {
    if (leadIds.length > 0) {
      setSelectedCell({ title, leadIds, contextLabel });
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={String(filters.monthsBack)}
          onValueChange={(v) => setFilters(prev => ({ ...prev, monthsBack: parseInt(v) }))}
        >
          <SelectTrigger className="w-[180px] bg-secondary border-border rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
             <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Últimos 12 meses</SelectItem>
          </SelectContent>
        </Select>

        {(data?.availableUtmSources?.length ?? 0) > 0 && (
          <Select
            value={filters.utmSource || "__all__"}
            onValueChange={(v) => setFilters(prev => ({ ...prev, utmSource: v === "__all__" ? undefined : v }))}
          >
            <SelectTrigger className="w-[180px] bg-secondary border-border rounded-xl">
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="__all__">Todos os canais</SelectItem>
              {data!.availableUtmSources.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(data?.availableSources?.length ?? 0) > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-[180px] justify-between bg-secondary border-border rounded-xl font-normal"
              >
                <span className="truncate">
                  {!filters.sources || filters.sources.length === 0
                    ? "Todas as origens"
                    : filters.sources.length === 1
                      ? filters.sources[0]
                      : `${filters.sources.length} origens`}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 ml-2 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-2 bg-popover border-border" align="start">
              <div className="flex items-center justify-between px-2 pb-2 border-b border-border mb-1">
                <span className="text-xs font-medium text-muted-foreground">Origem</span>
                {filters.sources && filters.sources.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters(prev => ({ ...prev, sources: undefined }))}
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {data!.availableSources.map(s => {
                  const checked = filters.sources?.includes(s.name) ?? false;
                  return (
                    <label
                      key={s.name}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          setFilters(prev => {
                            const curr = new Set(prev.sources || []);
                            if (c) curr.add(s.name); else curr.delete(s.name);
                            const arr = Array.from(curr);
                            return { ...prev, sources: arr.length > 0 ? arr : undefined };
                          });
                        }}
                      />
                      <span className="text-sm">{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {(data?.availableUtmCampaigns?.length ?? 0) > 0 && (
          <Select
            value={filters.utmCampaign || "__all__"}
            onValueChange={(v) => setFilters(prev => ({ ...prev, utmCampaign: v === "__all__" ? undefined : v }))}
          >
            <SelectTrigger className="w-[180px] bg-secondary border-border rounded-xl">
              <SelectValue placeholder="Campanha" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="__all__">Todas as campanhas</SelectItem>
              {data!.availableUtmCampaigns.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!hasData && (
        <div className="text-center py-12 text-muted-foreground">
          Sem dados de cohort para exibir.
        </div>
      )}

      {hasData && <>
      {/* Avg conversion time cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stages.map((stage) => {
          const days = avgConversionDays[stage.id];
          return (
            <div key={stage.id} className="glass-card-glow glow-accent">
              <div className="glass-card-glow-effect"></div>
              <div className="glass-card-glow-content p-4 text-center">
                <Clock className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                <p className="font-display text-xl font-bold text-primary">
                  {days !== null ? `${days}d` : "--"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                  Lead &rarr; {stage.name}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Cohort Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40"><Users className="h-4 w-4 text-foreground" /></div>
            Tabela de Cohort
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-sm">
                  <p className="text-sm">
                    <strong>Como ler esta tabela:</strong> os números mostram quantos leads do cohort{" "}
                    <strong>passaram</strong> por cada etapa em algum momento (cumulativo).
                    Um lead atualmente em "MQL" também é contado em "Lead" e "Lead Qualificado".
                    Por isso, o total aqui pode ser maior do que a contagem instantânea de cada coluna no Pipeline.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Valores cumulativos: cada coluna conta leads que passaram pela etapa em algum momento.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10">Cohort</TableHead>
                  {stages.map(s => (
                    <TableHead key={s.id} className="text-right">{s.name}</TableHead>
                  ))}
                  <TableHead className="text-right text-warning">WIP</TableHead>
                  <TableHead className="text-right text-success">Won</TableHead>
                  <TableHead className="text-right text-destructive">Lost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohorts.map((c) => (
                  <TableRow key={c.cohortKey}>
                    <TableCell className="font-medium sticky left-0 bg-card z-10">
                      {c.cohortLabel}
                    </TableCell>
                    {stages.map(s => (
                      <TableCell
                        key={s.id}
                        className={cn("text-right font-mono", (c.stageLeadIds[s.id]?.length || 0) > 0 && clickableCell)}
                        onClick={() => openDialog(`${c.cohortLabel} — ${s.name}`, c.stageLeadIds[s.id] || [], s.name)}
                      >
                        {c.stageCounts[s.id] || 0}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn("text-right font-mono text-warning font-semibold", c.wip > 0 && clickableCell)}
                      onClick={() => openDialog(`${c.cohortLabel} — WIP`, c.wipLeadIds, "WIP")}
                    >
                      {c.wip}
                    </TableCell>
                    <TableCell
                      className={cn("text-right font-mono text-success font-semibold", c.won > 0 && clickableCell)}
                      onClick={() => openDialog(`${c.cohortLabel} — Won`, c.wonLeadIds, "Ganho")}
                    >
                      {c.won}
                    </TableCell>
                    <TableCell
                      className={cn("text-right font-mono text-destructive", c.lost > 0 && clickableCell)}
                      onClick={() => openDialog(`${c.cohortLabel} — Lost`, c.lostLeadIds, "Perdido")}
                    >
                      {c.lost}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>


      {/* Stage-to-stage evolution rates */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40"><TrendingUp className="h-4 w-4 text-foreground" /></div>
            Evolução entre Etapas (%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10">Cohort</TableHead>
                  {stages.map(s => (
                    <TableHead key={s.id} className="text-right">{s.name}</TableHead>
                  ))}
                  <TableHead className="text-right text-warning">WIP%</TableHead>
                  <TableHead className="text-right">Won%</TableHead>
                  <TableHead className="text-right">Lost%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohorts.map((c) => (
                  <TableRow key={c.cohortKey}>
                    <TableCell className="font-medium sticky left-0 bg-card z-10">
                      {c.cohortLabel}
                    </TableCell>
                    {stages.map((s, idx) => {
                      if (idx === 0) {
                        return (
                          <TableCell key={s.id} className="text-right">
                            <RateBadge value={100} />
                          </TableCell>
                        );
                      }
                      const prevStage = stages[idx - 1];
                      const prevCount = c.stageCounts[prevStage.id] || 0;
                      const currCount = c.stageCounts[s.id] || 0;
                      const rate = prevCount > 0 ? (currCount / prevCount) * 100 : null;
                      return (
                        <TableCell key={s.id} className="text-right">
                          {rate !== null ? <RateBadge value={rate} /> : <span className="text-muted-foreground font-mono text-sm">--</span>}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-warning">{c.wipRate.toFixed(1)}%</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-success">{c.wonRate.toFixed(1)}%</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-destructive">{c.lostRate.toFixed(1)}%</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Evolution Matrix */}
      {maxMIndex >= 0 && cohorts.some(c => Object.keys(c.evolutionMatrix).length > 0) && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg font-display">Matriz de Evolução (vendas por mês após criação)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card z-10">Cohort</TableHead>
                    {Array.from({ length: maxMIndex + 1 }, (_, i) => (
                      <TableHead key={i} className="text-center">M{i}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((c) => (
                    <TableRow key={c.cohortKey}>
                      <TableCell className="font-medium sticky left-0 bg-card z-10">
                        {c.cohortLabel}
                      </TableCell>
                      {Array.from({ length: maxMIndex + 1 }, (_, i) => {
                        const val = c.evolutionMatrix[i] || 0;
                        const ids = c.evolutionLeadIds[i] || [];
                        return (
                          <TableCell
                            key={i}
                            className={cn("text-center", val > 0 && clickableCell)}
                            onClick={() => openDialog(`${c.cohortLabel} — M${i}`, ids, `M${i}`)}
                          >
                            <span
                              className={cn(
                                "font-mono text-sm inline-flex items-center justify-center w-8 h-8 rounded-md",
                                val > 0 && "bg-primary/20 text-primary font-semibold",
                                val === 0 && "text-muted-foreground"
                              )}
                            >
                              {val}
                            </span>
                          </TableCell>
                        );
                      })}
                      <TableCell
                        className={cn("text-right font-mono font-semibold text-success", c.won > 0 && clickableCell)}
                        onClick={() => openDialog(`${c.cohortLabel} — Won`, c.wonLeadIds, "Ganho")}
                      >
                        {c.won}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue per cohort */}
      {cohorts.some(c => c.revenue > 0) && (
        <Card className="glass-card">
          <CardHeader>
          <CardTitle className="text-lg font-display flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-success/80 to-success/40"><DollarSign className="h-4 w-4 text-foreground" /></div>
              Receita por Cohort
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Ticket médio</TableHead>
                    <TableHead className="text-right">Receita/Lead</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((c) => (
                    <TableRow key={c.cohortKey}>
                      <TableCell className="font-medium">{c.cohortLabel}</TableCell>
                      <TableCell
                        className={cn("text-right font-mono", clickableCell)}
                        onClick={() => openDialog(`${c.cohortLabel} — Todos os leads`, c.leadIds)}
                      >
                        {c.totalLeads}
                      </TableCell>
                      <TableCell
                        className={cn("text-right font-mono text-success", c.won > 0 && clickableCell)}
                        onClick={() => openDialog(`${c.cohortLabel} — Clientes`, c.wonLeadIds, "Ganho")}
                      >
                        {c.won}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {c.revenue > 0 ? `R$ ${c.revenue.toLocaleString("pt-BR")}` : "--"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {c.avgTicket > 0 ? `R$ ${c.avgTicket.toLocaleString("pt-BR")}` : "--"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {c.revenuePerLead > 0 ? `R$ ${c.revenuePerLead.toLocaleString("pt-BR")}` : "--"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      </>}

      {/* Leads Dialog */}
      {selectedCell && (
        <FunnelStageLeadsDialog
          open={!!selectedCell}
          onOpenChange={(open) => !open && setSelectedCell(null)}
          stageId=""
          stageName=""
          mode="period"
          leadIds={selectedCell.leadIds}
          customTitle={selectedCell.title}
          contextLabel={selectedCell.contextLabel}
          excludedLeadIds={excludedLeadIds}
          onExclusionChange={refetch}
        />
      )}
    </div>
  );
}

function RateBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-mono text-sm",
        value >= 50 && "text-success",
        value >= 20 && value < 50 && "text-primary",
        value > 0 && value < 20 && "text-warning",
        value === 0 && "text-muted-foreground"
      )}
    >
      {value.toFixed(1)}%
    </span>
  );
}
