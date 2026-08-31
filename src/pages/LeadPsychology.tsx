import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LeadInsights, type ConversationInsights } from "@/components/chat/LeadInsights";
import { useAnalyzeLeadPsychology } from "@/hooks/useAnalyzeLeadPsychology";
import { DNIASourcesCard, type DNIASourcesUsed } from "@/components/crm/DNIASourcesCard";
import { ScoreExplanationBlock } from "@/components/crm/ScoreExplanationBlock";
import { TemperatureExplanationBlock } from "@/components/crm/TemperatureExplanationBlock";
import {
  explainPropensity,
  explainRisk,
  explainOpportunity,
  explainTemperature,
  type DniaDimensions,
} from "@/lib/dniaScoreExplain";
import { 
  ArrowLeft, 
  Brain, 
  Flame, 
  Snowflake, 
  Sun, 
  ThermometerSun,
  Target,
  AlertTriangle,
  TrendingUp,
  Loader2,
  RefreshCw,
  MessageSquare,
  Lightbulb,
  Heart,
  Zap,
  User,
  Info,
  FileText,
  CheckCircle2,
  ChevronDown,
  MessageCircle,
  ShieldAlert
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface SellingPlaybook {
  quick_brief?: string;
  approach?: {
    tone?: string;
    opening_line?: string;
  };
  key_arguments?: string[];
  objection_handling?: Array<{ objection: string; response: string }>;
  closing_technique?: {
    name?: string;
    script?: string;
  };
  caution?: string;
}

interface PsychologyData {
  id: string;
  lead_id: string;
  workspace_id: string;
  dimension_inteligencia: number;
  dimension_investimento: number;
  dimension_intencao: number;
  dimension_engajamento: number;
  dimension_potencial: number;
  dimension_decisao: number;
  dna_code: string | null;
  propensity_score: number;
  risk_score: number;
  opportunity_score: number;
  temperatura: string;
  emotional_keywords: string[];
  top_pains: Array<{ pain: string; intensity: number }>;
  top_desires: Array<{ desire: string; motivation: number }>;
  decision_process: {
    type_emotional: number;
    type_rational: number;
    speed: string;
    validation: string;
  };
  self_sabotage_patterns: string[];
  analysis_text: string | null;
  ai_insights: string | null;
  selling_playbook?: SellingPlaybook;
  analyzed_at: string | null;
  sources_used?: unknown;
}

const temperatureConfig = {
  muito_quente: { label: "Muito Quente", color: "bg-destructive", icon: Flame, textColor: "text-destructive" },
  quente: { label: "Quente", color: "bg-warning", icon: ThermometerSun, textColor: "text-warning" },
  morno: { label: "Morno", color: "bg-warning", icon: Sun, textColor: "text-warning" },
  frio: { label: "Frio", color: "bg-primary", icon: Snowflake, textColor: "text-primary" },
};

const dimensionLabels = {
  inteligencia: { label: "Inteligência (I)", description: "Familiaridade com IA e termos técnicos" },
  investimento: { label: "Investimento (I)", description: "Capacidade e disposição para investir" },
  intencao: { label: "Intenção (I)", description: "Urgência e timeline" },
  engajamento: { label: "Engajamento (E)", description: "Frequência e qualidade de interação" },
  potencial: { label: "Potencial (P)", description: "Valor e possibilidade de upsell" },
  decisao: { label: "Decisão (D)", description: "Velocidade e tipo de decisão" },
};

export default function LeadPsychology() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();

  // Fetch lead info
  const { data: lead, isLoading: isLoadingLead, error: leadError } = useQuery({
    queryKey: ["crm-lead", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select(`
          *,
          contact:crm_contacts(*)
        `)
        .eq("id", leadId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!leadId,
    retry: false,
  });

  // Fetch original lead data for insights (from leads table via contact.lead_id)
  const { data: originalLead } = useQuery({
    queryKey: ["crm-original-lead-psychology", lead?.contact?.lead_id],
    queryFn: async () => {
      if (!lead?.contact?.lead_id) return null;
      
      const { data, error } = await supabase
        .from("leads")
        .select("id, status, insights, ai_summary")
        .eq("id", lead.contact.lead_id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!lead?.contact?.lead_id,
  });

  // Fetch psychology data
  const { data: psychology, isLoading } = useQuery({
    queryKey: ["lead-psychology", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_psychology")
        .select("*")
        .eq("lead_id", leadId)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;
      
      return {
        ...data,
        top_pains: (data.top_pains as unknown as Array<{ pain: string; intensity: number }>) || [],
        top_desires: (data.top_desires as unknown as Array<{ desire: string; motivation: number }>) || [],
        decision_process: (data.decision_process as unknown as PsychologyData["decision_process"]) || {},
        selling_playbook: (data.selling_playbook as unknown as SellingPlaybook) || null,
      } as PsychologyData;
    },
    enabled: !!leadId,
  });

  // Analyze mutation (compartilhada com o sheet do pipeline e o modal do Inbox)
  const analyzeMutation = useAnalyzeLeadPsychology(leadId, currentWorkspace?.id);

  const TempIcon = psychology?.temperatura 
    ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]?.icon || Sun
    : Sun;

  const tempConfig = psychology?.temperatura
    ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]
    : temperatureConfig.frio;

  // Memoria de calculo dos scores: derivada das dimensoes, mesma formula da edge function
  const dims: DniaDimensions | null = psychology
    ? {
        inteligencia: psychology.dimension_inteligencia,
        investimento: psychology.dimension_investimento,
        intencao: psychology.dimension_intencao,
        engajamento: psychology.dimension_engajamento,
        potencial: psychology.dimension_potencial,
        decisao: psychology.dimension_decisao,
      }
    : null;
  const tempExplanation = dims
    ? explainTemperature(dims, psychology!.propensity_score, psychology!.temperatura)
    : null;



  // Show error state if lead not found
  if (leadError || (!isLoadingLead && !lead)) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Analise Psicologica DNIA
            </h1>
          </div>
        </div>
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Lead nao encontrado
            </h3>
            <p className="text-muted-foreground text-center mb-6">
              Este lead nao existe ou voce nao tem permissao para visualiza-lo.
            </p>
            <Button onClick={() => navigate("/crm/pipeline")}>
              Voltar ao Pipeline
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Analise Psicologica DNIA
            </h1>
            <p className="text-muted-foreground">
              {lead?.contact?.name || "Lead"} - {lead?.contact?.company || "Sem empresa"}
            </p>
          </div>
        </div>
        <Button 
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending || isLoadingLead}
          className="gap-2"
        >
          {analyzeMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Analisar Agora
        </Button>
      </div>

      {isLoading || isLoadingLead ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !psychology || !psychology.analyzed_at ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Brain className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Nenhuma análise disponível
            </h3>
            <p className="text-muted-foreground text-center mb-6">
              Clique em "Analisar Agora" para gerar a análise psicológica deste lead
              com base no histórico de conversas.
            </p>
            <Button onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
              {analyzeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Brain className="h-4 w-4 mr-2" />
              )}
              Iniciar Análise
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - DNA Code & Dimensions */}
          <div className="space-y-6">
            {/* DNA Code */}
            <Card className="glass-card-glow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">DNIA code do Lead</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-xl text-gradient font-bold">
                  {psychology.dna_code || "Não analisado"}
                </p>
              </CardContent>
            </Card>

            {/* Temperature */}
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <TempIcon className={`h-4 w-4 ${tempConfig.textColor}`} />
                  Temperatura DNIA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge className={`${tempConfig.color} text-white text-lg px-4 py-2`}>
                  {tempConfig.label}
                </Badge>
                {tempExplanation && (
                  <TemperatureExplanationBlock
                    explanation={tempExplanation}
                    label={tempConfig.label}
                  />
                )}


              </CardContent>

            </Card>

            {/* Dimensions */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  6 Dimensões DNIA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(dimensionLabels).map(([key, { label, description }]) => {
                  const value = psychology[`dimension_${key}` as keyof PsychologyData] as number;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{label}</span>
                        <span className="font-mono text-primary">{value}/5</span>
                      </div>
                      <Progress value={(value / 5) * 100} className="h-2" />
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Middle Column - Scores & Decision Process */}
          <div className="space-y-6">
            {/* Scores */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Scores Principais
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Propensity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-success" />
                      <span className="text-foreground">Propensão</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">Probabilidade do lead converter em cliente. Quanto maior, mais provável a conversão.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <span className="font-mono text-2xl text-success">
                      {psychology.propensity_score}%
                    </span>
                  </div>
                  <Progress value={psychology.propensity_score} className="h-3 bg-muted" />
                  {dims && (
                    <ScoreExplanationBlock
                      explanation={explainPropensity(dims, psychology.propensity_score)}
                    />
                  )}
                </div>

                {/* Risk */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-foreground">Risco</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">Probabilidade de perder o lead ou não fechar negócio. Quanto menor, melhor.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <span className="font-mono text-2xl text-destructive">
                      {psychology.risk_score}%
                    </span>
                  </div>
                  <Progress value={psychology.risk_score} className="h-3 bg-muted" />
                  {dims && (
                    <ScoreExplanationBlock explanation={explainRisk(dims, psychology.risk_score)} />
                  )}
                </div>

                {/* Opportunity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      <span className="text-foreground">Oportunidade</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">Potencial de valor e crescimento do negócio com este lead. Quanto maior, melhor.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <span className="font-mono text-2xl text-primary">
                      {psychology.opportunity_score}%
                    </span>
                  </div>
                  <Progress value={psychology.opportunity_score} className="h-3 bg-muted" />
                  {dims && (
                    <ScoreExplanationBlock
                      explanation={explainOpportunity(dims, psychology.opportunity_score)}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Decision Process */}
            {psychology.decision_process && Object.keys(psychology.decision_process).length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    Processo de Decisão
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Emocional x Racional sao duas metades do mesmo 100%, entao
                      uma barra proporcional comunica melhor que dois numeros soltos */}
                  <div className="space-y-2">
                    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="bg-primary"
                        style={{
                          width: `${Math.min(100, Math.max(0, psychology.decision_process.type_emotional || 0))}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-xl text-primary">
                          {psychology.decision_process.type_emotional || 0}%
                        </span>
                        <span className="text-xs text-muted-foreground">Emocional</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs text-muted-foreground">Racional</span>
                        <span className="font-mono text-xl text-foreground">
                          {psychology.decision_process.type_rational || 0}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between gap-4 border-t border-border/50 pt-4">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Velocidade
                    </span>
                    <span className="text-sm text-right text-foreground">
                      {psychology.decision_process.speed || "Não identificada"}
                    </span>
                  </div>

                  {/* Texto longo: rotulo acima para o parágrafo ocupar a largura toda */}
                  <div className="space-y-1.5 border-t border-border/50 pt-4">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Validação
                    </span>
                    <p className="text-sm leading-relaxed text-foreground">
                      {psychology.decision_process.validation || "Não identificada"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Emotional Keywords */}
            {psychology.emotional_keywords?.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Palavras-chave Emocionais
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {psychology.emotional_keywords.map((keyword, i) => (
                      <Badge key={i} variant="secondary">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Archaeology */}
          <div className="space-y-6">
            {/* Top Pains */}
            {psychology.top_pains?.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Top 5 Dores
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-3">
                      {psychology.top_pains.slice(0, 5).map((item, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{i + 1}. {item.pain}</span>
                            <span className="font-mono text-destructive">{item.intensity}/10</span>
                          </div>
                          <Progress value={item.intensity * 10} className="h-1" />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Top Desires */}
            {psychology.top_desires?.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Heart className="h-4 w-4 text-success" />
                    Top 5 Desejos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-3">
                      {psychology.top_desires.slice(0, 5).map((item, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{i + 1}. {item.desire}</span>
                            <span className="font-mono text-success">{item.motivation}/10</span>
                          </div>
                          <Progress value={item.motivation * 10} className="h-1" />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Self Sabotage Patterns */}
            {psychology.self_sabotage_patterns?.length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4 text-warning" />
                    Padrões de Autossabotagem
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {psychology.self_sabotage_patterns.map((pattern, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-warning">•</span>
                        <span className="text-foreground">{pattern}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* AI Insights from Psychology */}
            {psychology.ai_insights && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Insights da IA (Psicologia)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {psychology.ai_insights}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Real-time Conversation Insights */}
            {originalLead?.insights && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Insights da Conversa
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LeadInsights 
                    insights={originalLead.insights as unknown as ConversationInsights | null}
                    status={originalLead.status} 
                  />
                </CardContent>
              </Card>
            )}

            {/* AI Summary */}
            {originalLead?.ai_summary && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Resumo da IA
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {originalLead.ai_summary}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Como Vender para Este Lead - Full Width Section */}
        {psychology.selling_playbook && (
          <Card className="glass-card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Como Vender para {lead?.contact?.name || "Este Lead"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Quick Brief - Always Visible */}
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg">
                <p className="text-sm text-foreground">
                  {psychology.selling_playbook.quick_brief}
                </p>
                {psychology.selling_playbook.caution && (
                  <div className="mt-3 flex items-start gap-2 text-xs text-warning bg-warning/10 p-2 rounded">
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{psychology.selling_playbook.caution}</span>
                  </div>
                )}
              </div>

              {/* Collapsible Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Abordagem Ideal */}
                {psychology.selling_playbook.approach && (
                  <Collapsible className="glass-card rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between text-left">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">Abordagem Ideal</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {psychology.selling_playbook.approach.tone || "Consultivo"}
                        </Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3">
                      <div className="bg-muted/50 p-3 rounded-lg">
                        <p className="text-sm italic text-muted-foreground">
                          "{psychology.selling_playbook.approach.opening_line}"
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Argumentos-Chave */}
                {psychology.selling_playbook.key_arguments && psychology.selling_playbook.key_arguments.length > 0 && (
                  <Collapsible className="glass-card rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between text-left">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">Argumentos-Chave</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{psychology.selling_playbook.key_arguments.length}</Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3">
                      <div className="space-y-2">
                        {psychology.selling_playbook.key_arguments.map((arg, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                            <span className="text-foreground">{arg}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Objecoes Provaveis */}
                {psychology.selling_playbook.objection_handling && psychology.selling_playbook.objection_handling.length > 0 && (
                  <Collapsible className="glass-card rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between text-left">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        <span className="text-sm font-medium text-foreground">Objecoes Provaveis</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{psychology.selling_playbook.objection_handling.length}</Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3">
                      <div className="space-y-3">
                        {psychology.selling_playbook.objection_handling.map((obj, i) => (
                          <div key={i} className="space-y-1">
                            <p className="text-sm font-medium text-destructive">"{obj.objection}"</p>
                            <p className="text-sm text-success pl-4 flex items-start gap-1">
                              <span className="shrink-0">→</span> {obj.response}
                            </p>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Tecnica de Fechamento */}
                {psychology.selling_playbook.closing_technique && (
                  <Collapsible className="glass-card rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between text-left">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-success" />
                        <span className="text-sm font-medium text-foreground">Fechamento</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {psychology.selling_playbook.closing_technique.name || "Técnica"}
                        </Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="px-3 pb-3">
                      <div className="bg-success/10 border border-success/20 p-3 rounded-lg">
                        <p className="text-sm italic text-foreground">
                          "{psychology.selling_playbook.closing_technique.script}"
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fontes usadas na análise */}
        <DNIASourcesCard
          sourcesUsed={(psychology.sources_used as unknown as DNIASourcesUsed) ?? null}
          leadId={leadId}
          inboxLeadId={lead?.contact?.lead_id}
        />
        </>
      )}

      {psychology?.analyzed_at && (
        <p className="text-xs text-muted-foreground text-center">
          Última análise: {new Date(psychology.analyzed_at).toLocaleString("pt-BR")}
        </p>
      )}
    </div>
  );
}
