import { TrendingUp, TrendingDown, AlertTriangle, Target, Lightbulb, Activity, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface Objection {
  type: string;
  description: string;
  suggested_response: string;
  severity: number;
}

export interface ConversationInsights {
  sentiment_score: number;
  sentiment_label: string;
  objections: Objection[];
  purchase_intent: number;
  urgency_level: string;
  suggested_specialist: string | null;
  suggested_action: string;
  conversation_summary: string;
}

interface LeadInsightsProps {
  insights: ConversationInsights | null;
  status: string | null;
}

const sentimentConfig = {
  frustrado: { color: "text-destructive", bg: "bg-destructive/20", icon: TrendingDown },
  neutro: { color: "text-muted-foreground", bg: "bg-muted", icon: Activity },
  satisfeito: { color: "text-success", bg: "bg-success/20", icon: TrendingUp },
  entusiasmado: { color: "text-primary", bg: "bg-primary/20", icon: TrendingUp },
};

const urgencyConfig = {
  baixa: { label: "Baixa", color: "text-muted-foreground", bg: "bg-muted" },
  media: { label: "Média", color: "text-warning", bg: "bg-warning/20" },
  alta: { label: "Alta", color: "text-primary", bg: "bg-primary/20" },
  critica: { label: "Crítica", color: "text-destructive", bg: "bg-destructive/20" },
};

const objectionTypeLabels: Record<string, string> = {
  preco: "Preço",
  tempo: "Tempo",
  confianca: "Confiança",
  concorrencia: "Concorrência",
  funcionalidade: "Funcionalidade",
  outro: "Outro",
};

export function LeadInsights({ insights, status }: LeadInsightsProps) {
  if (!insights) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Insights em tempo real
        </h4>
        <p className="text-xs text-muted-foreground italic bg-background/50 p-2 rounded-lg">
          Nenhum insight disponível ainda. A análise será gerada conforme a conversa avança.
        </p>
      </div>
    );
  }

  const sentimentStyle = sentimentConfig[insights.sentiment_label as keyof typeof sentimentConfig] || sentimentConfig.neutro;
  const urgencyStyle = urgencyConfig[insights.urgency_level as keyof typeof urgencyConfig] || urgencyConfig.media;
  const SentimentIcon = sentimentStyle.icon;

  return (
    <div className="space-y-3">
      {/* Header */}
      <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        Insights em tempo real
      </h4>

      {/* Sentiment Score */}
      <div className="bg-background/50 p-2.5 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase">Sentimento</span>
          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", sentimentStyle.bg, sentimentStyle.color)}>
            <SentimentIcon className="h-2.5 w-2.5 mr-1" />
            {insights.sentiment_score}/10
          </Badge>
        </div>
        <Progress 
          value={insights.sentiment_score * 10} 
          className="h-1.5"
        />
        <p className="text-[10px] text-muted-foreground capitalize">{insights.sentiment_label}</p>
      </div>

      {/* Purchase Intent */}
      <div className="bg-background/50 p-2.5 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <ShoppingCart className="h-3 w-3" />
            Intenção de Compra
          </span>
          <span className={cn(
            "text-xs font-mono font-semibold",
            insights.purchase_intent >= 70 ? "text-success" :
            insights.purchase_intent >= 40 ? "text-warning" : "text-destructive"
          )}>
            {insights.purchase_intent}%
          </span>
        </div>
        <Progress 
          value={insights.purchase_intent} 
          className="h-1.5"
        />
      </div>

      {/* Urgency */}
      <div className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg">
        <span className="text-[10px] text-muted-foreground uppercase">Urgência</span>
        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", urgencyStyle.bg, urgencyStyle.color)}>
          {urgencyStyle.label}
        </Badge>
      </div>

      {/* Objections */}
      {insights.objections.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-warning" />
            <span className="text-[10px] text-warning uppercase font-medium">
              Objeções Detectadas ({insights.objections.length})
            </span>
          </div>
          <div className="space-y-2">
            {insights.objections.map((objection, idx) => (
              <div key={idx} className="bg-warning/5 border border-warning/20 p-2 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-warning/10 text-warning border-warning/30">
                    {objectionTypeLabels[objection.type] || objection.type}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground">
                    Severidade: {objection.severity}/5
                  </span>
                </div>
                <p className="text-[10px] text-foreground">{objection.description}</p>
                <div className="flex items-start gap-1 pt-1">
                  <Lightbulb className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-[10px] text-primary">{objection.suggested_response}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Action */}
      <div className="bg-primary/5 border border-primary/20 p-2.5 rounded-lg">
        <div className="flex items-center gap-1.5 mb-1">
          <Target className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-primary uppercase font-medium">Próxima Ação</span>
        </div>
        <p className="text-[10px] text-foreground">{insights.suggested_action}</p>
      </div>

      {/* Specialist Suggestion */}
      {insights.suggested_specialist && (
        <div className="bg-primary/10 border border-primary/20 p-2.5 rounded-lg">
          <span className="text-[10px] text-primary uppercase font-medium">
            Sugestão: Transferir para {insights.suggested_specialist}
          </span>
        </div>
      )}

      {/* Show enriched briefing for needs_human status */}
      {status === "needs_human" && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-warning" />
              <span className="text-[10px] text-warning uppercase font-medium">
                HANDOFF ATIVO
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Este lead foi marcado para atendimento humano. Verifique a seção "Análise da IA" para o briefing completo.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
