import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BookOpen, Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTeamPerformance, useCoachingBrief } from "@/hooks/useTeamPerformance";
import { SellerDashboard } from "./SellerDashboard";
import { BriefMarkdown } from "./BriefMarkdown";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";

const PREVIEW_LENGTH = 200;

/**
 * Primeiras linhas do brief em texto puro, para a prévia do card.
 *
 * Remove a marcação porque um recorte de 200 caracteres cortaria no meio de um
 * `**negrito**` ou começaria com `## Leitura geral` — ruído onde deveria haver
 * a primeira frase útil.
 */
function briefPreview(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|\*|_|`/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= PREVIEW_LENGTH) return plain;
  // Corta na última palavra inteira para não terminar no meio de uma
  const cut = plain.slice(0, PREVIEW_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

interface Props {
  period: PeriodFilter;
  customRange?: CustomDateRange;
  playbookId?: string | null;
  selectedSellerId: string | null;
  onSelectSeller: (sellerId: string | null) => void;
}

/**
 * Visão individual do gestor: o mesmo painel que o vendedor vê, mais o brief de
 * coaching gerado sob demanda (material de gestão — não exposto ao vendedor).
 */
export function IndividualTab({
  period,
  customRange,
  playbookId,
  selectedSellerId,
  onSelectSeller,
}: Props) {
  const { toast } = useToast();
  const { data: team, isLoading: isLoadingTeam } = useTeamPerformance(period, customRange, playbookId);
  const { data: brief, isLoading: isLoadingBrief, generate } = useCoachingBrief(selectedSellerId);
  const [isBriefOpen, setIsBriefOpen] = useState(false);

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync();
      toast({ title: "Orientação gerada" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível gerar a orientação.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    }
  };

  if (isLoadingTeam) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sellers = team?.ranking ?? [];
  const sellerName = sellers.find((s) => s.seller_id === selectedSellerId)?.seller_name ?? "Vendedor";

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardContent className="pt-6">
          <div className="space-y-2 max-w-sm">
            <Label>Vendedor</Label>
            <Select
              value={selectedSellerId ?? undefined}
              onValueChange={(value) => onSelectSeller(value)}
              disabled={sellers.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um vendedor" />
              </SelectTrigger>
              <SelectContent>
                {sellers.map((seller) => (
                  <SelectItem key={seller.seller_id} value={seller.seller_id}>
                    {seller.seller_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sellers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum vendedor com atendimentos avaliados neste período.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedSellerId && (
        <>
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    Orientação para o gestor
                  </CardTitle>
                  <CardDescription>
                    Como conduzir o desenvolvimento deste vendedor, a partir das avaliações e dos pontos ativos.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={generate.isPending}
                  className="shrink-0"
                >
                  {generate.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {brief ? "Atualizar orientação" : "Gerar orientação"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingBrief ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : brief ? (
                <div className="space-y-3">
                  {/* Prévia em vez do texto inteiro: o brief tem ~600 palavras e
                      empurrava os KPIs e o gráfico para fora da tela */}
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {briefPreview(brief.brief_md)}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => setIsBriefOpen(true)}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Ver orientação completa
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Gerada em{" "}
                      {format(new Date(brief.generated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  Nenhuma orientação gerada ainda para este vendedor.
                </p>
              )}
            </CardContent>
          </Card>

          <Dialog open={isBriefOpen && !!brief} onOpenChange={setIsBriefOpen}>
            <DialogContent className="glass-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Orientação para o gestor
                </DialogTitle>
                <DialogDescription>
                  {sellerName}
                  {brief && (
                    <>
                      {" · Gerada em "}
                      {format(new Date(brief.generated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              {brief && <BriefMarkdown content={brief.brief_md} />}
            </DialogContent>
          </Dialog>

          <SellerDashboard
            period={period}
            customRange={customRange}
            sellerId={selectedSellerId}
            playbookId={playbookId}
          />
        </>
      )}
    </div>
  );
}
