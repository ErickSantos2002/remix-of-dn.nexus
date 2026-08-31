import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useFlow, useFlowMutations, useFlowsList } from "@/hooks/useFlows";
import {
  NODE_LABELS, STATUS_LABELS, OPERATOR_LABELS, branchFieldDef, minutesToLabel,
  newNodeId, computePruned, type FlowNode, type FlowNodeType, type BranchRule,
} from "@/lib/flows";
import { FlowNodeCard } from "@/components/crm/flows/FlowNodeCard";
import { FlowNodeConfigDialog } from "@/components/crm/flows/FlowNodeConfigDialog";
import { FlowRunsDrawer } from "@/components/crm/flows/FlowRunsDrawer";
import { useFlowMetrics } from "@/hooks/useFlowObservability";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Play, Pause, Archive, Save, GitBranch, Info, Users } from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";

type BranchKey = "next" | "next_false";

const ADD_MENU: { label: string; type: FlowNodeType }[] = [
  { label: NODE_LABELS.send_whatsapp, type: "send_whatsapp" },
  { label: NODE_LABELS.send_email, type: "send_email" },
  { label: NODE_LABELS.delay, type: "delay" },
  { label: NODE_LABELS.branch, type: "branch" },
  { label: NODE_LABELS.close_lead, type: "close_lead" },
];

export default function CRMFlowBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: flow, isLoading, refetch } = useFlow(id);
  const { data: flowsList } = useFlowsList();
  const { saveFlow, setFlowStatus } = useFlowMutations();

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(null);
  const [exitOnStageChange, setExitOnStageChange] = useState(true);
  const [reentry, setReentry] = useState<"once" | "allowed">("once");
  const [cooldownDays, setCooldownDays] = useState(7);
  const [dirty, setDirty] = useState(false);
  const [originalNodeIds, setOriginalNodeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [pendingInsert, setPendingInsert] = useState<{ parentId: string | null; branchKey: BranchKey } | null>(null);
  const [addType, setAddType] = useState<FlowNodeType | null>(null);
  const [editingNode, setEditingNode] = useState<FlowNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeId: string; finalNodes: FlowNode[]; newEntryId: string | null; prunedLabels: string[] } | null>(null);
  const [confirmActiveEdit, setConfirmActiveEdit] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [showRunsDrawer, setShowRunsDrawer] = useState(false);
  const [draggingNode, setDraggingNode] = useState<FlowNode | null>(null);

  // distance: 8 — cliques nos botões do card (editar/excluir) não viram arraste
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (!flow) return;
    setNodes(flow.nodes || []);
    setEntryNodeId(flow.entry_node_id ?? null);
    setExitOnStageChange(flow.exit_on_stage_change);
    setReentry(flow.reentry);
    setCooldownDays(Math.max(1, Math.round((flow.reentry_cooldown_hours ?? 168) / 24)));
    setOriginalNodeIds(new Set((flow.nodes || []).map((n) => n.id)));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.id, flow?.updated_at]);

  const { data: stage } = useQuery({
    queryKey: ["flow-stage", flow?.stage_id],
    enabled: !!flow?.stage_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_pipeline_stages").select("id, name").eq("id", flow!.stage_id).maybeSingle();
      return data;
    },
  });

  const v1Superseded = useMemo(
    () => !!flowsList?.find((f) => f.id === id)?.v1_superseded,
    [flowsList, id],
  );

  // Métricas por nó: só faz sentido depois que o fluxo já rodou (rascunho não tem log)
  const { data: metrics } = useFlowMetrics(id, flow?.status !== "draft");

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const summaryFor = (node: FlowNode): string => {
    switch (node.type) {
      case "delay":
        return `Esperar ${minutesToLabel(Number(node.config.minutes) || 0)}`;
      case "branch": {
        const rules = ((node.config.rules as BranchRule[] | undefined) || []);
        const sep = node.config.logic === "or" ? " OU " : " E ";
        return rules
          .map((r) => `${branchFieldDef(r.field)?.label || r.field} ${OPERATOR_LABELS[r.operator] || r.operator}${r.value !== undefined && r.value !== null && r.value !== "" ? ` ${r.value}` : ""}`)
          .join(sep) || "sem condições";
      }
      case "send_whatsapp": {
        const content = typeof node.config.content === "string" ? node.config.content : "";
        const extras: string[] = [];
        if (node.config.media_type) extras.push(String(node.config.media_type));
        if (node.config.agent_id) extras.push("agente IA");
        if (node.config.ai_rewrite_enabled) extras.push("reescrita IA");
        return `${content.slice(0, 50) || "(sem texto)"}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
      }
      case "send_email": {
        const subject = typeof node.config.subject === "string" ? node.config.subject : "";
        return subject ? `"${subject.slice(0, 60)}"` : "(sem assunto)";
      }
      case "close_lead":
        return node.config.outcome === "lost" ? "Marcar como perdido" : "Marcar como ganho";
      default:
        return "";
    }
  };

  const openAddMenu = (parentId: string | null, branchKey: BranchKey, type: FlowNodeType) => {
    // close_lead é terminal: só pode ser inserido no FIM de um ramo
    const parent = parentId ? byId.get(parentId) : null;
    const currentTarget = parentId === null ? entryNodeId : (parent ? parent[branchKey] : null);
    if (type === "close_lead" && currentTarget !== null) {
      toast({ variant: "destructive", title: "Passo terminal", description: '"Fechar lead" encerra o fluxo — adicione-o no fim de um ramo.' });
      return;
    }
    setPendingInsert({ parentId, branchKey });
    setAddType(type);
  };

  const handleCreateNode = (config: Record<string, unknown>) => {
    if (!pendingInsert || !addType) return;
    setDirty(true);
    const nid = newNodeId();
    const { parentId, branchKey } = pendingInsert;
    const newNode: FlowNode = { id: nid, type: addType, config, next: null, next_false: null };
    if (parentId === null) {
      newNode.next = addType === "close_lead" ? null : entryNodeId;
      setEntryNodeId(nid);
      setNodes((prev) => [...prev, newNode]);
    } else {
      setNodes((prev) => {
        const parent = prev.find((n) => n.id === parentId);
        const currentTarget = parent ? parent[branchKey] ?? null : null;
        newNode.next = addType === "close_lead" ? null : currentTarget;
        return [...prev.map((n) => (n.id === parentId ? { ...n, [branchKey]: nid } : n)), newNode];
      });
    }
    setPendingInsert(null);
    setAddType(null);
  };

  const handleEditSave = (config: Record<string, unknown>) => {
    if (!editingNode) return;
    setNodes((prev) => prev.map((n) => (n.id === editingNode.id ? { ...n, config } : n)));
    setEditingNode(null);
    setDirty(true);
  };

  const requestDeleteNode = (nodeId: string) => {
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const fallback = target.next ?? null;
    const repointed = nodes
      .map((n) => {
        const patch: Partial<FlowNode> = {};
        if (n.next === nodeId) patch.next = fallback;
        if (n.next_false === nodeId) patch.next_false = fallback;
        return Object.keys(patch).length ? { ...n, ...patch } : n;
      })
      .filter((n) => n.id !== nodeId);
    const newEntryId = entryNodeId === nodeId ? fallback : entryNodeId;
    const prunedIds = computePruned(repointed, newEntryId);
    const finalNodes = repointed.filter((n) => !prunedIds.includes(n.id));
    if (prunedIds.length > 0) {
      const prunedLabels = prunedIds.map((pid) => {
        const n = nodes.find((x) => x.id === pid);
        return n ? NODE_LABELS[n.type] : pid;
      });
      setConfirmDelete({ nodeId, finalNodes, newEntryId, prunedLabels });
    } else {
      setNodes(finalNodes);
      setEntryNodeId(newEntryId);
      setDirty(true);
    }
  };

  const doSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await saveFlow.mutateAsync({
        id,
        patch: {
          nodes,
          entry_node_id: entryNodeId,
          exit_on_stage_change: exitOnStageChange,
          reentry,
          reentry_cooldown_hours: Math.max(1, Math.round(cooldownDays * 24)),
        },
      });
      toast({ title: "Fluxo salvo" });
      setConfirmActiveEdit(false);
      setDirty(false);
      await refetch();
    } catch (e) {
      // A mensagem do banco (ciclo, config faltando) É a mensagem útil — nunca mascarar
      toast({ variant: "destructive", title: "Erro ao salvar fluxo", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    const currentIds = new Set(nodes.map((n) => n.id));
    const deletedSomething = [...originalNodeIds].some((oid) => !currentIds.has(oid));
    if (flow?.status === "active" && deletedSomething) {
      setConfirmActiveEdit(true);
      return;
    }
    doSave();
  };

  const doSetStatus = async (status: "active" | "paused" | "archived") => {
    if (!id) return;
    if (dirty) {
      toast({ variant: "destructive", title: "Alterações não salvas", description: 'Clique em "Salvar" antes de mudar o status do fluxo.' });
      return;
    }
    try {
      await setFlowStatus.mutateAsync({ id, status });
      toast({ title: status === "active" ? "Fluxo ativado" : status === "paused" ? "Fluxo pausado" : "Fluxo arquivado" });
      await refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Erro", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleActivateClick = () => {
    if (dirty) {
      toast({ variant: "destructive", title: "Alterações não salvas", description: 'Clique em "Salvar" antes de ativar.' });
      return;
    }
    if (nodes.length === 0 || !entryNodeId) {
      toast({ variant: "destructive", title: "Fluxo vazio", description: "Adicione ao menos um passo antes de ativar." });
      return;
    }
    setConfirmActivate(true);
  };

  // ---- Arrastar blocos: religa os ponteiros do grafo (spec do plano) ----

  /** Ids do nó e de tudo alcançável a partir dele (next/next_false). */
  const subtreeIds = (rootId: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      const n = byId.get(cur);
      if (!n) continue;
      seen.add(cur);
      if (n.next) queue.push(n.next);
      if (n.next_false) queue.push(n.next_false);
    }
    return seen;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingNode(byId.get(String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const dragged = draggingNode;
    setDraggingNode(null);
    if (!dragged || !event.over) return;

    // Slot droppable: `slot:${parentId|root}:${branchKey}`
    const [tag, rawParent, rawKey] = String(event.over.id).split(":");
    if (tag !== "slot") return;
    const targetParentId = rawParent === "root" ? null : rawParent;
    const targetKey = (rawKey === "next_false" ? "next_false" : "next") as BranchKey;

    // Slot logo abaixo do próprio nó → no-op (nó ficaria órfão)
    if (targetParentId === dragged.id) return;

    // branch leva a subárvore junto: soltar dentro dela criaria ciclo.
    // Nós lineares saem sozinhos — mover para baixo na corrente é válido.
    if (dragged.type === "branch" && targetParentId && subtreeIds(dragged.id).has(targetParentId)) {
      toast({ variant: "destructive", title: "Movimento inválido", description: "Não é possível soltar a condição dentro dos próprios ramos." });
      return;
    }

    const targetParent = targetParentId ? byId.get(targetParentId) : null;
    if (targetParentId && !targetParent) return;
    const currentTarget = targetParentId === null ? entryNodeId : targetParent![targetKey] ?? null;

    // Soltar no lugar onde já está → no-op
    if (currentTarget === dragged.id) return;

    // branch (leva a subárvore) e close_lead (terminal) só entram no fim de um ramo
    const carriesSubtree = dragged.type === "branch" || dragged.type === "close_lead";
    if (carriesSubtree && currentTarget !== null) {
      toast({ variant: "destructive", title: "Solte no fim de um ramo", description: dragged.type === "branch" ? "A condição leva os ramos Sim/Não junto — solte-a num ponto final." : '"Fechar lead" encerra o fluxo — solte-o num ponto final.' });
      return;
    }

    // Religa em uma única passada: desconecta da origem e conecta no destino
    const detachedNext = carriesSubtree ? null : dragged.next; // o que fecha a corrente na origem
    setNodes((prev) => {
      let next = prev.map((n) => {
        const patch: Partial<FlowNode> = {};
        if (n.next === dragged.id) patch.next = detachedNext;
        if (n.next_false === dragged.id) patch.next_false = detachedNext;
        return Object.keys(patch).length ? { ...n, ...patch } : n;
      });
      next = next.map((n) => {
        if (n.id === dragged.id) {
          return { ...n, next: carriesSubtree ? n.next : currentTarget };
        }
        if (targetParentId && n.id === targetParentId) {
          return { ...n, [targetKey]: dragged.id };
        }
        return n;
      });
      return next;
    });
    setEntryNodeId((prevEntry) => {
      let e = prevEntry === dragged.id ? detachedNext : prevEntry;
      if (targetParentId === null) e = dragged.id;
      return e;
    });
    setDirty(true);
  };

  const DraggableNode = ({ node, children }: { node: FlowNode; children: React.ReactNode }) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id });
    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={isDragging ? "opacity-40 cursor-grabbing" : "cursor-grab"}
      >
        {children}
      </div>
    );
  };

  const AddButton = ({ parentId, branchKey }: { parentId: string | null; branchKey: BranchKey }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `slot:${parentId ?? "root"}:${branchKey}` });
    // Enquanto arrasta, o "+" vira alvo de soltura; destaque válido/inválido
    const currentTarget = parentId === null ? entryNodeId : byId.get(parentId)?.[branchKey] ?? null;
    const dropInvalid = !!draggingNode && (
      (draggingNode.type === "branch" || draggingNode.type === "close_lead")
        ? (currentTarget !== null && currentTarget !== draggingNode.id)
        : false
    );
    const dropClass = !draggingNode
      ? "border-border/60 hover:border-primary hover:text-primary"
      : isOver
        ? (dropInvalid ? "border-destructive text-destructive bg-destructive/10 scale-125" : "border-primary text-primary bg-primary/10 scale-125")
        : (dropInvalid ? "border-border/40 text-muted-foreground/40" : "border-primary/60 text-primary/70");
    return (
      <div ref={setNodeRef}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`w-7 h-7 rounded-full border border-dashed flex items-center justify-center text-muted-foreground transition-all my-1 ${dropClass}`}
              aria-label="Adicionar passo"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {ADD_MENU.map((item) => (
              <DropdownMenuItem key={item.type} onClick={() => openAddMenu(parentId, branchKey, item.type)}>
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const renderChain = (
    startId: string | null,
    renderedIds: Set<string>,
    parentForInsert: string | null,
    branchKeyForInsert: BranchKey,
  ): JSX.Element => {
    const items: JSX.Element[] = [];
    items.push(<AddButton key={`add-${parentForInsert}-${branchKeyForInsert}-head`} parentId={parentForInsert} branchKey={branchKeyForInsert} />);

    let currentId = startId;
    while (currentId) {
      if (renderedIds.has(currentId)) {
        const n = byId.get(currentId);
        items.push(
          <div key={`ref-${currentId}`} className="text-[11px] text-muted-foreground italic border border-dashed border-border/50 rounded-md px-3 py-1.5">
            continua em "{n ? NODE_LABELS[n.type] : currentId}"
          </div>,
        );
        break;
      }
      const node = byId.get(currentId);
      if (!node) break;
      renderedIds.add(currentId);

      items.push(
        <DraggableNode key={node.id} node={node}>
          <FlowNodeCard
            node={node}
            summary={summaryFor(node)}
            metrics={metrics?.[node.id]}
            onEdit={() => setEditingNode(node)}
            onDelete={() => requestDeleteNode(node.id)}
          />
        </DraggableNode>,
      );

      if (node.type === "branch") {
        items.push(
          <div key={`branches-${node.id}`} className="flex gap-8 items-start justify-center w-full">
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Sim</Badge>
              {renderChain(node.next ?? null, renderedIds, node.id, "next")}
            </div>
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Não</Badge>
              {renderChain(node.next_false ?? null, renderedIds, node.id, "next_false")}
            </div>
          </div>,
        );
        currentId = null;
      } else if (node.type === "close_lead") {
        items.push(
          <div key={`end-${node.id}`} className="text-[11px] text-muted-foreground border border-border/50 rounded-full px-3 py-1">
            fim do fluxo
          </div>,
        );
        currentId = null;
      } else {
        items.push(<AddButton key={`add-${node.id}`} parentId={node.id} branchKey="next" />);
        currentId = node.next ?? null;
      }
    }
    return <div className="flex flex-col items-center gap-1.5">{items}</div>;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p>Fluxo não encontrado.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate("/crm/settings/flows")}>Voltar</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/crm/settings/flows")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{flow.name}</h1>
              <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[flow.status]}</Badge>
              {v1Superseded && flow.status === "active" && (
                <span title="A régua v1 desta etapa foi suspensa por este fluxo — não recebe novos leads. As mensagens já agendadas continuam sendo enviadas.">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Etapa-gatilho: {stage?.name || "…"}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {flow.status !== "draft" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowRunsDrawer(true)}>
              <Users className="h-3.5 w-3.5" /> Leads no fluxo
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSaveClick} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
          {flow.status !== "active" && flow.status !== "archived" && (
            <Button size="sm" className="gap-1.5" onClick={handleActivateClick}>
              <Play className="h-3.5 w-3.5" /> Ativar
            </Button>
          )}
          {flow.status === "active" && (
            <Button size="sm" variant="outline" className="gap-1.5 text-warning" onClick={() => doSetStatus("paused")}>
              <Pause className="h-3.5 w-3.5" /> Pausar
            </Button>
          )}
          {flow.status !== "archived" && flow.status !== "draft" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => doSetStatus("archived")}>
              <Archive className="h-3.5 w-3.5" /> Arquivar
            </Button>
          )}
        </div>
      </div>

      <Card className="max-w-md mx-auto border-primary/30 bg-primary/[0.03]">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada</p>
            <p className="text-sm font-medium truncate">Lead entra em "{stage?.name || "…"}"</p>
            <p className="text-[11px] text-muted-foreground">
              {exitOnStageChange ? "Sai do fluxo ao trocar de etapa" : "Continua mesmo trocando de etapa"}
              {" · "}
              {reentry === "once" ? "uma vez por lead" : `pode reentrar após ${cooldownDays}d`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowEntryDialog(true)}>Editar</Button>
        </CardContent>
      </Card>

      <DndContext
        sensors={dndSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingNode(null)}
      >
        <div className="overflow-x-auto pt-2">
          <div className="flex justify-center min-w-fit px-4">
            {renderChain(entryNodeId, new Set(), null, "next")}
          </div>
        </div>
        <DragOverlay>
          {draggingNode && (
            <FlowNodeCard
              node={draggingNode}
              summary={summaryFor(draggingNode)}
              onEdit={() => {}}
              onDelete={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>

      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <GitBranch className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm">Clique no "+" acima para adicionar o primeiro passo</p>
        </div>
      )}

      <FlowRunsDrawer
        flowId={id}
        nodes={nodes}
        open={showRunsDrawer}
        onOpenChange={setShowRunsDrawer}
      />

      <FlowNodeConfigDialog
        open={!!addType}
        onOpenChange={(o) => { if (!o) { setAddType(null); setPendingInsert(null); } }}
        type={addType}
        initialConfig={addType === "delay" ? { minutes: 60 } : addType === "branch" ? { logic: "and", rules: [] } : {}}
        onSave={handleCreateNode}
        workspaceId={flow.workspace_id}
        companyId={flow.company_id}
      />
      <FlowNodeConfigDialog
        open={!!editingNode}
        onOpenChange={(o) => { if (!o) setEditingNode(null); }}
        type={editingNode?.type ?? null}
        initialConfig={editingNode?.config ?? {}}
        onSave={handleEditSave}
        workspaceId={flow.workspace_id}
        companyId={flow.company_id}
      />

      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Entrada do fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs">Encerrar ao sair da etapa</Label>
                <p className="text-[11px] text-muted-foreground">
                  Se o lead trocar de etapa no meio do fluxo, as mensagens restantes são canceladas.
                </p>
              </div>
              <Switch checked={exitOnStageChange} onCheckedChange={(v) => { setExitOnStageChange(v); setDirty(true); }} />
            </div>
            <Select value={reentry} onValueChange={(v) => { setReentry(v as "once" | "allowed"); setDirty(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Uma vez por lead</SelectItem>
                <SelectItem value="allowed">Pode entrar de novo</SelectItem>
              </SelectContent>
            </Select>
            {reentry === "allowed" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Intervalo mínimo antes de reentrar</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} className="w-24"
                    value={cooldownDays}
                    onChange={(e) => { setCooldownDays(Math.max(1, Number(e.target.value))); setDirty(true); }}
                  />
                  <span className="text-sm text-muted-foreground">dia(s)</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Evita que um lead que oscila entre etapas receba as mesmas mensagens repetidamente.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowEntryDialog(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este passo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso também removerá {confirmDelete?.prunedLabels.length} passo(s) que só existiam a partir daqui: {confirmDelete?.prunedLabels.join(", ")}. Essa parte do fluxo será perdida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (!confirmDelete) return;
                setNodes(confirmDelete.finalNodes);
                setEntryNodeId(confirmDelete.newEntryId);
                setConfirmDelete(null);
                setDirty(true);
              }}
            >
              Excluir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmActiveEdit} onOpenChange={(o) => !o && setConfirmActiveEdit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este fluxo está ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Você removeu passo(s) de um fluxo em execução. Leads parados exatamente nesses passos serão movidos para o passo seguinte (ou encerrados, se não houver). Deseja salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={doSave}>
              {saving ? "Salvando..." : "Salvar mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmActivate} onOpenChange={(o) => !o && setConfirmActivate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar "{flow.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads que entrarem na etapa "{stage?.name}" a partir de agora serão inscritos no fluxo. Quem já está na etapa NÃO é inscrito retroativamente.
              {v1Superseded && (
                <>
                  {" "}A régua v1 desta etapa deixa de receber novos leads assim que este fluxo for ativado. As mensagens já agendadas para quem está nela continuam sendo enviadas até o fim.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmActivate(false); doSetStatus("active"); }}>
              Ativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
