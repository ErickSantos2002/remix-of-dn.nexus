import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAnalyzeLeadPsychology, MIN_LEAD_MESSAGES } from "@/hooks/useAnalyzeLeadPsychology";
import {
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
  Info,
  Rocket,
  ShieldAlert,
  Clock,
  MessageCircle,
  CheckCircle2,
  ChevronDown
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface SalesStrategy {
  approach?: string;
  key_arguments?: string[];
  pain_leverage?: string;
  desire_fulfillment?: string;
  objection_handling?: Array<{ objection: string; response: string }>;
  closing_technique?: string;
  timing?: string;
  red_flags?: string[];
}

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
  sales_strategy?: SalesStrategy;
  selling_playbook?: SellingPlaybook;
  analyzed_at: string | null;
}

interface PsychologyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crmLeadId: string;
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

export function PsychologyModal({ open, onOpenChange, crmLeadId }: PsychologyModalProps) {
  const { currentWorkspace } = useWorkspace();

  // Fetch lead info
  const { data: lead, isLoading: isLoadingLead } = useQuery({
    queryKey: ["crm-lead-modal", crmLeadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select(`
          *,
          contact:crm_contacts(*)
        `)
        .eq("id", crmLeadId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!crmLeadId && open,
  });

  // Fetch psychology data
  const { data: psychology, isLoading } = useQuery({
    queryKey: ["lead-psychology-modal", crmLeadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_lead_psychology")
        .select("*")
        .eq("lead_id", crmLeadId)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;
      
      return {
        ...data,
        top_pains: (data.top_pains as unknown as Array<{ pain: string; intensity: number }>) || [],
        top_desires: (data.top_desires as unknown as Array<{ desire: string; motivation: number }>) || [],
        decision_process: (data.decision_process as unknown as PsychologyData["decision_process"]) || {},
        sales_strategy: (data.sales_strategy as unknown as SalesStrategy) || {},
        selling_playbook: (data.selling_playbook as unknown as SellingPlaybook) || null,
      } as PsychologyData;
    },
    enabled: !!crmLeadId && open,
  });

  // Count lead messages to know if analysis is allowed
  const inboxLeadId = lead?.contact?.lead_id;
  const { data: leadMessagesCount = 0 } = useQuery({
    queryKey: ["lead-message-count", inboxLeadId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", inboxLeadId!)
        .eq("sender_type", "lead");
      if (error) throw error;
      return count || 0;
    },
    enabled: !!inboxLeadId && open,
  });

  const hasEnoughMessages = leadMessagesCount >= MIN_LEAD_MESSAGES;
  const insufficientReason = `O lead precisa de pelo menos ${MIN_LEAD_MESSAGES} mensagens para gerar a análise (atual: ${leadMessagesCount}).`;

  // Analyze mutation (compartilhada com o sheet do pipeline e a página completa)
  const analyzeMutation = useAnalyzeLeadPsychology(crmLeadId, currentWorkspace?.id);

  const TempIcon = psychology?.temperatura 
    ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]?.icon || Sun
    : Sun;

  const tempConfig = psychology?.temperatura
    ? temperatureConfig[psychology.temperatura as keyof typeof temperatureConfig]
    : temperatureConfig.frio;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 flex flex-col">
        <DialogHeader className="shrink-0 p-6 pb-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Análise Psicológica DNIA
            </DialogTitle>
            <Button
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending || isLoadingLead || !hasEnoughMessages}
              size="sm"
              className="gap-2"
              title={!hasEnoughMessages ? insufficientReason : undefined}
            >
              {analyzeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Analisar
            </Button>
          </div>
          {lead && (
            <p className="text-sm text-muted-foreground">
              {lead.contact?.name || "Lead"} - {lead.contact?.company || "Sem empresa"}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isLoading || isLoadingLead ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !psychology || !psychology.analyzed_at ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Brain className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Nenhuma análise disponível
              </h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                {hasEnoughMessages
                  ? 'Clique em "Iniciar Análise" para gerar a análise psicológica deste lead com base no histórico de conversas.'
                  : insufficientReason + " Aguarde mais interações do lead para liberar a análise DNIA."}
              </p>
              <Button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending || !hasEnoughMessages}
                title={!hasEnoughMessages ? insufficientReason : undefined}
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Brain className="h-4 w-4 mr-2" />
                )}
                Iniciar Análise
              </Button>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
              {/* Column 1 - DNA & Dimensions */}
              <div className="space-y-4">
                {/* DNA Code */}
                <div className="glass-card p-4 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">DNIA Code</p>
                  <p className="font-mono text-lg text-gradient font-bold">
                    {psychology.dna_code || "N/A"}
                  </p>
                </div>

                {/* Temperature */}
                <div className="glass-card p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <TempIcon className={`h-4 w-4 ${tempConfig.textColor}`} />
                    <span className="text-xs text-muted-foreground">Temperatura</span>
                  </div>
                  <Badge className={`${tempConfig.color} text-foreground`}>
                    {tempConfig.label}
                  </Badge>
                </div>

                {/* Dimensions */}
                <div className="glass-card p-4 rounded-lg space-y-3">
                  <p className="text-xs text-muted-foreground">6 Dimensões DNIA</p>
                  {Object.entries(dimensionLabels).map(([key, { label }]) => {
                    const value = psychology[`dimension_${key}` as keyof PsychologyData] as number;
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{label}</span>
                          <span className="font-mono text-primary">{value}/5</span>
                        </div>
                        <Progress value={(value / 5) * 100} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Column 2 - Scores & Decision */}
              <div className="space-y-4">
                {/* Scores */}
                <div className="glass-card p-4 rounded-lg space-y-4">
                  <p className="text-xs text-muted-foreground">Scores</p>
                  
                  {/* Propensity */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <Target className="h-3 w-3 text-success" />
                        <span>Propensão</span>
                      </div>
                      <span className="font-mono text-lg text-success">{psychology.propensity_score}%</span>
                    </div>
                    <Progress value={psychology.propensity_score} className="h-2" />
                  </div>

                  {/* Risk */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                        <span>Risco</span>
                      </div>
                      <span className="font-mono text-lg text-destructive">{psychology.risk_score}%</span>
                    </div>
                    <Progress value={psychology.risk_score} className="h-2" />
                  </div>

                  {/* Opportunity */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-primary" />
                        <span>Oportunidade</span>
                      </div>
                      <span className="font-mono text-lg text-primary">{psychology.opportunity_score}%</span>
                    </div>
                    <Progress value={psychology.opportunity_score} className="h-2" />
                  </div>
                </div>

                {/* Decision Process */}
                {psychology.decision_process && Object.keys(psychology.decision_process).length > 0 && (
                  <div className="glass-card p-4 rounded-lg space-y-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lightbulb className="h-3 w-3" />
                      Processo de Decisão
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-primary"
                          style={{
                            width: `${Math.min(100, Math.max(0, psychology.decision_process.type_emotional || 0))}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex items-baseline gap-1">
                          <span className="font-mono text-base text-primary">
                            {psychology.decision_process.type_emotional || 0}%
                          </span>
                          <span className="text-[10px] text-muted-foreground">Emocional</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[10px] text-muted-foreground">Racional</span>
                          <span className="font-mono text-base text-foreground">
                            {psychology.decision_process.type_rational || 0}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 text-xs">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Velocidade
                      </span>
                      <span className="text-right text-foreground">
                        {psychology.decision_process.speed || "Não identificada"}
                      </span>
                    </div>
                    <div className="space-y-1 border-t border-border/50 pt-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Validação
                      </span>
                      <p className="text-xs leading-relaxed text-foreground">
                        {psychology.decision_process.validation || "Não identificada"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Emotional Keywords */}
                {psychology.emotional_keywords?.length > 0 && (
                  <div className="glass-card p-4 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <MessageSquare className="h-3 w-3" />
                      Palavras-chave
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {psychology.emotional_keywords.slice(0, 8).map((keyword, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Column 3 - Archaeology */}
              <div className="space-y-4">
                {/* Top Pains */}
                {psychology.top_pains?.length > 0 && (
                  <div className="glass-card p-4 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                      Top 5 Dores
                    </div>
                    <div className="space-y-2">
                      {psychology.top_pains.slice(0, 5).map((item, i) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-foreground truncate pr-2">{i + 1}. {item.pain}</span>
                            <span className="font-mono text-destructive shrink-0">{item.intensity}/10</span>
                          </div>
                          <Progress value={item.intensity * 10} className="h-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Desires */}
                {psychology.top_desires?.length > 0 && (
                  <div className="glass-card p-4 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <Heart className="h-3 w-3 text-success" />
                      Top 5 Desejos
                    </div>
                    <div className="space-y-2">
                      {psychology.top_desires.slice(0, 5).map((item, i) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-foreground truncate pr-2">{i + 1}. {item.desire}</span>
                            <span className="font-mono text-success shrink-0">{item.motivation}/10</span>
                          </div>
                          <Progress value={item.motivation * 10} className="h-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Self Sabotage */}
                {psychology.self_sabotage_patterns?.length > 0 && (
                  <div className="glass-card p-4 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <Zap className="h-3 w-3 text-warning" />
                      Autossabotagem
                    </div>
                    <ul className="space-y-1">
                      {psychology.self_sabotage_patterns.slice(0, 3).map((pattern, i) => (
                        <li key={i} className="flex items-start gap-1 text-xs">
                          <span className="text-warning">•</span>
                          <span className="text-foreground">{pattern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* AI Insights */}
                {psychology.ai_insights && (
                  <div className="glass-card p-4 rounded-lg">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                      <Brain className="h-3 w-3 text-primary" />
                      Insights da IA
                    </div>
                    <p className="text-xs text-foreground line-clamp-6">
                      {psychology.ai_insights}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Sales Strategy Section - Full Width - NEW COMPACT FORMAT */}
            {psychology.selling_playbook && (
              <div className="glass-card-glow p-5 rounded-lg mt-4">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    Como Vender para {lead?.contact?.name || "Este Lead"}
                  </h3>
                </div>

                {/* Quick Brief - Always Visible */}
                <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg mb-4">
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
                          <Badge variant="outline" className="capitalize text-xs">
                            {psychology.selling_playbook.approach.tone || "Consultivo"}
                          </Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                          <Badge variant="secondary" className="text-xs">{psychology.selling_playbook.key_arguments.length}</Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                          <Badge variant="secondary" className="text-xs">{psychology.selling_playbook.objection_handling.length}</Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
                          <Rocket className="h-4 w-4 text-success" />
                          <span className="text-sm font-medium text-foreground">Fechamento</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {psychology.selling_playbook.closing_technique.name || "Técnica"}
                          </Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
              </div>
            )}
            </>
          )}

          {psychology?.analyzed_at && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Última análise: {new Date(psychology.analyzed_at).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
