import { useState } from "react";
import { Link } from "react-router-dom";
import { NODE_LABELS, type FlowNode } from "@/lib/flows";
import { useFlowRuns, useFlowRunAudit, type FlowRunRow } from "@/hooks/useFlowObservability";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, ChevronDown, ChevronRight, MessageSquare, Mail, GitBranch, Flag } from "lucide-react";

const STATE_LABELS: Record<string, string> = {
  active: "Em execução",
  waiting: "Aguardando",
  done: "Concluído",
  failed: "Falhou",
  exited: "Saiu",
};

const EXIT_LABELS: Record<string, string> = {
  stage_change: "mudou de etapa",
  won: "lead ganho",
  lost: "lead perdido",
  opted_out: "contato pediu para não receber",
  flow_archived: "fluxo arquivado",
  node_deleted: "passo removido",
};

const RESULT_LABELS: Record<string, string> = {
  sent: "Enviada",
  failed: "Falhou",
  skipped: "Pulada",
  rescheduled: "Reagendada",
};

function stateClass(state: string): string {
  if (state === "active" || state === "waiting") return "bg-primary/10 text-primary border-primary/30";
  if (state === "done") return "bg-success/10 text-success border-success/30";
  if (state === "failed") return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function resultClass(result: string): string {
  if (result === "sent") return "bg-success/10 text-success border-success/30";
  if (result === "failed") return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-warning/10 text-warning border-warning/30";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Comunicações do run (auditoria): carregadas só quando a linha expande. */
function RunAudit({ runId }: { runId: string }) {
  const { data: items, isLoading } = useFlowRunAudit(runId, true);

  if (isLoading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 pl-6">
        Nenhuma comunicação registrada neste fluxo para este lead.
      </p>
    );
  }
  return (
    <div className="space-y-1.5 pt-2 pl-6">
      {items.map((it) => (
        <div key={it.id} className="rounded-md border border-border/50 bg-background/50 p-2">
          <div className="flex items-center gap-2 flex-wrap">
            {it.node_type === "send_email" && <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            {it.node_type === "send_whatsapp" && <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            {it.node_type === "branch" && <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            {it.node_type === "close_lead" && <Flag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <span className="text-xs font-medium text-foreground">
              {it.node_type === "send_email" ? "E-mail"
                : it.node_type === "send_whatsapp" ? "WhatsApp"
                : it.node_type === "branch" ? "Condição"
                : "Fechar lead"}
            </span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${
              it.node_type === "branch"
                ? (it.result === "branch_true" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30")
                : resultClass(it.result)
            }`}>
              {it.node_type === "branch"
                ? (it.result === "branch_true" ? "Sim" : "Não — seguiu este ramo")
                : it.node_type === "close_lead" && it.result === "sent" ? "Aplicado"
                : RESULT_LABELS[it.result] || it.result}
            </Badge>
            {it.delivery_status && (
              <span className="text-[10px] text-muted-foreground">
                {it.delivery_status === "read" ? "lida" : it.delivery_status === "delivered" ? "entregue" : it.delivery_status === "sent" ? "enviada" : it.delivery_status}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground font-mono ml-auto">{fmtDate(it.occurred_at)}</span>
          </div>
          {it.message_content && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words line-clamp-4">
              {it.message_content}
            </p>
          )}
          {it.media_type && it.media_type !== "email" && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Mídia: {it.media_type}</p>
          )}
          {!it.message_content && it.reason && (
            <p className="text-[11px] text-warning mt-1">{it.reason}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function RunRow({ run, nodeById }: { run: FlowRunRow; nodeById: Map<string, FlowNode> }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = run.state === "active" || run.state === "waiting";
  const node = run.current_node_id ? nodeById.get(run.current_node_id) : null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/50">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setExpanded((e) => !e)}
          title="Ver comunicações enviadas"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {run.contact_name || run.lead_title || "Lead sem nome"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {isOpen && node && <>No passo: <span className="text-foreground">{NODE_LABELS[node.type]}</span></>}
            {isOpen && !node && <>Na entrada do fluxo</>}
            {isOpen && run.state === "waiting" && <> · retoma {fmtDate(run.wakeup_at)}</>}
            {!isOpen && run.exit_reason && <>Saiu: {EXIT_LABELS[run.exit_reason] || run.exit_reason}</>}
            {!isOpen && !run.exit_reason && <>Percorreu o fluxo até o fim</>}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-0.5">
            Entrou {fmtDate(run.entered_at)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={stateClass(run.state)}>
            {STATE_LABELS[run.state] || run.state}
          </Badge>
          <Link
            to={`/crm/pipeline?lead=${run.lead_id}`}
            className="text-primary hover:opacity-80"
            title="Abrir card no pipeline"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50">
          <RunAudit runId={run.id} />
        </div>
      )}
    </div>
  );
}

interface Props {
  flowId?: string;
  nodes: FlowNode[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowName?: string;
}

export function FlowRunsDrawer({ flowId, nodes, open, onOpenChange, flowName }: Props) {
  const { data: runs, isLoading } = useFlowRuns(flowId, open);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const active = (runs || []).filter((r) => r.state === "active" || r.state === "waiting");
  const finished = (runs || []).filter((r) => r.state !== "active" && r.state !== "waiting");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Leads no fluxo{flowName ? ` — ${flowName}` : ""}</SheetTitle>
          <SheetDescription>
            Expanda um lead para auditar as comunicações enviadas. Últimas 200 passagens.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !runs || runs.length === 0 ? (
          <div className="text-sm text-muted-foreground py-10 text-center">
            Nenhum lead entrou neste fluxo ainda.
          </div>
        ) : (
          <div className="space-y-5 mt-4">
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Ativos agora <span className="text-muted-foreground font-normal">({active.length})</span>
              </h3>
              {active.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum lead em execução neste momento.</p>
              ) : (
                <div className="space-y-1.5">
                  {active.map((r) => <RunRow key={r.id} run={r} nodeById={nodeById} />)}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Concluídos e saídas <span className="text-muted-foreground font-normal">({finished.length})</span>
              </h3>
              {finished.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém concluiu o fluxo ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {finished.map((r) => <RunRow key={r.id} run={r} nodeById={nodeById} />)}
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
