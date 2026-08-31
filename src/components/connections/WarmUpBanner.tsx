import { AlertTriangle, CheckCircle2, Shield } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface WarmUpBannerProps {
  connectionCreatedAt: string;
}

const WARM_UP_DAYS = 7;

const warmUpLimits = [
  { maxDay: 2, limit: 5, label: "5 msgs/hora" },
  { maxDay: 4, limit: 15, label: "15 msgs/hora" },
  { maxDay: 6, limit: 30, label: "30 msgs/hora" },
  { maxDay: WARM_UP_DAYS, limit: 1200, label: "Normal" },
];

export function WarmUpBanner({ connectionCreatedAt }: WarmUpBannerProps) {
  const daysSinceCreation = (Date.now() - new Date(connectionCreatedAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation >= WARM_UP_DAYS) {
    return null;
  }

  const daysRemaining = Math.ceil(WARM_UP_DAYS - daysSinceCreation);
  const currentDay = Math.floor(daysSinceCreation) + 1;
  const progress = Math.min((daysSinceCreation / WARM_UP_DAYS) * 100, 100);

  const currentLimit = warmUpLimits.find(l => daysSinceCreation < l.maxDay) || warmUpLimits[warmUpLimits.length - 1];

  return (
    <Alert className="border-warning/30 bg-warning/5">
      <Shield className="h-4 w-4 text-warning" />
      <AlertTitle className="text-warning flex items-center gap-2">
        Warm-Up Ativo — Dia {currentDay} de {WARM_UP_DAYS}
      </AlertTitle>
      <AlertDescription className="space-y-3 mt-2">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Progresso do warm-up</span>
            <span>{daysRemaining} dia{daysRemaining > 1 ? "s" : ""} restante{daysRemaining > 1 ? "s" : ""}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
          <span>Limite atual: <strong className="text-foreground">{currentLimit.label}</strong></span>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-sm">Boas praticas para proteger o numero:</p>
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
            <span>Use o numero pessoalmente por 24h antes de conectar</span>
          </div>
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
            <span>Configure foto de perfil e descricao</span>
          </div>
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
            <span>Comece respondendo contatos que ja te conhecem</span>
          </div>
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
            <span>Evite enviar a mesma mensagem para muitas pessoas</span>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
