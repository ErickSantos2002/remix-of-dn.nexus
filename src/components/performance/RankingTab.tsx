import { Loader2, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTeamPerformance } from "@/hooks/useTeamPerformance";
import { scoreTextClass } from "@/lib/analysisCatalog";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";

interface Props {
  period: PeriodFilter;
  customRange?: CustomDateRange;
  playbookId?: string | null;
  /** Abre a visão individual daquele vendedor. */
  onSelectSeller: (sellerId: string) => void;
}

function TrendCell({ trend }: { trend: number }) {
  if (trend === 0) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        <span className="font-mono text-xs">0</span>
      </span>
    );
  }
  const positive = trend > 0;
  return (
    <span className={`flex items-center gap-1 ${positive ? "text-success" : "text-destructive"}`}>
      {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      <span className="font-mono text-xs">
        {positive ? "+" : ""}
        {trend} pts
      </span>
    </span>
  );
}

/** Ranking de vendedores por score médio — visão de gestão. */
export function RankingTab({ period, customRange, playbookId, onSelectSeller }: Props) {
  const { data, isLoading } = useTeamPerformance(period, customRange, playbookId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.ranking.length === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-foreground">Ainda não há vendedores avaliados neste período.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Ranking de vendedores</CardTitle>
        <CardDescription>
          Ordenado pelo score médio do período. A tendência compara a segunda metade do período com a primeira.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Score médio</TableHead>
                <TableHead className="text-right">Atendimentos</TableHead>
                <TableHead>Tendência</TableHead>
                <TableHead className="text-right">Recorrentes</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ranking.map((row, index) => (
                <TableRow key={row.seller_id}>
                  <TableCell className="font-mono text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="font-medium text-foreground">{row.seller_name}</TableCell>
                  <TableCell className="text-right">
                    <span className={`font-bold font-display text-lg ${scoreTextClass(row.avg_score)}`}>
                      {row.avg_score}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {row.analyses_count}
                  </TableCell>
                  <TableCell>
                    <TrendCell trend={row.trend} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.recurrent_points > 0 ? (
                      <Badge className="badge-warning font-mono">{row.recurrent_points}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => onSelectSeller(row.seller_id)}>
                      Ver detalhe
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
