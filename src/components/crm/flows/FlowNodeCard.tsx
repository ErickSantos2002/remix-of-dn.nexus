import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, GitBranch, MessageSquare, Flag, Mail, Pencil, Trash2 } from "lucide-react";
import { NODE_LABELS, type FlowNode, type FlowNodeType } from "@/lib/flows";
import type { NodeMetrics } from "@/hooks/useFlowObservability";

const NODE_ICONS: Record<FlowNodeType, typeof Clock> = {
  delay: Clock,
  branch: GitBranch,
  send_whatsapp: MessageSquare,
  send_email: Mail,
  close_lead: Flag,
};

interface Props {
  node: FlowNode;
  summary: string;
  metrics?: NodeMetrics;
  onEdit: () => void;
  onDelete: () => void;
}

export function FlowNodeCard({ node, summary, metrics, onEdit, onDelete }: Props) {
  const Icon = NODE_ICONS[node.type];
  return (
    <Card className="w-72 border-border/70">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{NODE_LABELS[node.type]}</p>
              <p className="text-xs text-muted-foreground truncate" title={summary}>{summary}</p>
            </div>
          </div>
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Excluir">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>

        {metrics && metrics.entered > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-3 text-[11px] font-mono">
            <span className="text-muted-foreground" title="Leads que passaram por este passo">
              {metrics.entered} passaram
            </span>
            {node.type === "branch" ? (
              <span className="text-muted-foreground" title="Resultado das avaliações">
                {metrics.branchTrue} sim · {metrics.branchFalse} não
              </span>
            ) : (
              metrics.sent > 0 && (
                <span className="text-success" title="Envios concluídos / ações aplicadas">
                  {metrics.sent} ok
                </span>
              )
            )}
            {metrics.failed > 0 && (
              <span className="text-destructive" title="Falhas após as retentativas">
                {metrics.failed} falhas
              </span>
            )}
            {metrics.skipped > 0 && (
              <span className="text-warning" title="Pulados (sem telefone/e-mail, etc.)">
                {metrics.skipped} pulados
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
