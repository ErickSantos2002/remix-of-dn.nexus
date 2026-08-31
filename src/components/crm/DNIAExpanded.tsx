import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  ChevronUp,
  Flame,
  ThermometerSun,
  Sun,
  Snowflake,
  Target,
  AlertTriangle,
  TrendingUp,
  Brain,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAnalyzeLeadPsychology } from "@/hooks/useAnalyzeLeadPsychology";
import { ScoreExplanationBlock } from "@/components/crm/ScoreExplanationBlock";
import { TemperatureExplanationBlock } from "@/components/crm/TemperatureExplanationBlock";
import {
  explainPropensity,
  explainRisk,
  explainOpportunity,
  explainTemperature,
  type DniaDimensions,
} from "@/lib/dniaScoreExplain";

interface PsychologyData {
  id: string;
  lead_id: string;
  dimension_inteligencia: number | null;
  dimension_investimento: number | null;
  dimension_intencao: number | null;
  dimension_engajamento: number | null;
  dimension_potencial: number | null;
  dimension_decisao: number | null;
  dna_code: string | null;
  propensity_score: number | null;
  risk_score: number | null;
  opportunity_score: number | null;
  temperatura: string | null;
  analyzed_at: string | null;
}

interface DNIAExpandedProps {
  psychology: PsychologyData | null;
  leadId: string;
  workspaceId: string;
  defaultExpanded?: boolean;
}

const temperatureConfig = {
  muito_quente: { label: "Muito Quente", color: "bg-destructive", icon: Flame, textColor: "text-destructive" },
  quente: { label: "Quente", color: "bg-warning", icon: ThermometerSun, textColor: "text-warning" },
  morno: { label: "Morno", color: "bg-warning", icon: Sun, textColor: "text-warning" },
  frio: { label: "Frio", color: "bg-primary", icon: Snowflake, textColor: "text-primary" },
};

const dimensionLabels = {
  inteligencia: { label: "Inteligência (I)", short: "I" },
  investimento: { label: "Investimento (I)", short: "I" },
  intencao: { label: "Intenção (I)", short: "I" },
  engajamento: { label: "Engajamento (E)", short: "E" },
  potencial: { label: "Potencial (P)", short: "P" },
  decisao: { label: "Decisão (D)", short: "D" },
};

export function DNIAExpanded({ psychology, leadId, workspaceId, defaultExpanded = false }: DNIAExpandedProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const navigate = useNavigate();
  const analyzeMutation = useAnalyzeLeadPsychology(leadId, workspaceId);

  if (!psychology || !psychology.analyzed_at) {
    return (
      <div className="bg-background/50 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">DNIA não analisado</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
          >
            {analyzeMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {analyzeMutation.isPending ? "Analisando..." : "Analisar"}
          </Button>
        </div>
      </div>
    );
  }

  const tempConfig = psychology.temperatura 
    ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]
    : temperatureConfig.frio;
  const TempIcon = tempConfig.icon;

  // Memoria de calculo: os scores derivam das 6 dimensoes (mesma formula da edge function)
  const dims: DniaDimensions = {
    inteligencia: psychology.dimension_inteligencia ?? 0,
    investimento: psychology.dimension_investimento ?? 0,
    intencao: psychology.dimension_intencao ?? 0,
    engajamento: psychology.dimension_engajamento ?? 0,
    potencial: psychology.dimension_potencial ?? 0,
    decisao: psychology.dimension_decisao ?? 0,
  };
  const propensity = psychology.propensity_score ?? 0;
  const risk = psychology.risk_score ?? 0;
  const opportunity = psychology.opportunity_score ?? 0;
  const tempExplanation = explainTemperature(dims, propensity, psychology.temperatura);



  return (
    <div className="bg-background/50 rounded-lg p-3 space-y-3">
      {/* Header - Always visible */}
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            DNIA do lead
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            title="Atualizar análise"
            disabled={analyzeMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 gap-1">
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                <span className="text-xs">Recolher</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                <span className="text-xs">Expandir</span>
              </>
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atualizar análise DNIA?</AlertDialogTitle>
            <AlertDialogDescription>
              A análise atual será substituída pela nova. Dependendo do resultado, o lead pode ser
              movido de estágio automaticamente pelas regras de auto-move.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => analyzeMutation.mutate()}>
              Atualizar análise
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Summary - Always visible */}
      <div className="space-y-2">
        {/* DNA Code */}
        {psychology.dna_code && (
          <div className="font-mono text-sm text-foreground">
            {psychology.dna_code}
          </div>
        )}

        {/* Última análise */}
        <p className="text-[10px] text-muted-foreground">
          Analisado em{" "}
          {new Date(psychology.analyzed_at).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        {/* Temperature and Scores Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={`gap-1 ${tempConfig.textColor} border-current/30 bg-current/10`}
          >
            <TempIcon className="h-3.5 w-3.5" />
            {tempConfig.label}
          </Badge>

          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3 text-success" />
              <span className="text-muted-foreground">Propensão:</span>
              <span className="font-mono text-success">{psychology.propensity_score || 0}%</span>
            </span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-muted-foreground">Risco:</span>
              <span className="font-mono text-destructive">{psychology.risk_score || 0}%</span>
            </span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground">Oportunidade:</span>
              <span className="font-mono text-primary">{psychology.opportunity_score || 0}%</span>
            </span>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-4 pt-2 border-t border-border/50">
          {/* Dimensions */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Dimensões
            </span>
            <div className="space-y-1.5">
              {Object.entries(dimensionLabels).map(([key, config]) => {
                const value = psychology[`dimension_${key}` as keyof PsychologyData] as number || 0;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-28 truncate">
                      {config.label}
                    </span>
                    <Progress value={value * 20} className="h-2 flex-1" />
                    <span className="text-xs font-mono text-foreground w-6 text-right">
                      {value}/5
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scores */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Scores
            </span>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 flex items-center gap-1">
                    <Target className="h-3 w-3 text-success" />
                    Propensão
                  </span>
                  <Progress value={propensity} className="h-1.5 flex-1 [&>div]:bg-success" />
                  <span className="text-xs font-mono text-success w-10 text-right">
                    {propensity}%
                  </span>
                </div>
                <ScoreExplanationBlock explanation={explainPropensity(dims, propensity)} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    Risco
                  </span>
                  <Progress value={risk} className="h-1.5 flex-1 [&>div]:bg-destructive" />
                  <span className="text-xs font-mono text-destructive w-10 text-right">
                    {risk}%
                  </span>
                </div>
                <ScoreExplanationBlock explanation={explainRisk(dims, risk)} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-primary" />
                    Oportunidade
                  </span>
                  <Progress value={opportunity} className="h-1.5 flex-1 [&>div]:bg-primary" />
                  <span className="text-xs font-mono text-primary w-10 text-right">
                    {opportunity}%
                  </span>
                </div>
                <ScoreExplanationBlock explanation={explainOpportunity(dims, opportunity)} />
              </div>
            </div>
          </div>

          {/* Por que esta temperatura */}
          <TemperatureExplanationBlock explanation={tempExplanation} label={tempConfig.label} />




          {/* Link to full analysis */}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => navigate(`/crm/leads/${leadId}/psychology`)}
          >
            <Brain className="h-3.5 w-3.5" />
            Ver análise completa
          </Button>
        </div>
      )}
    </div>
  );
}
