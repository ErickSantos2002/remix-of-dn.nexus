import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { useFlowsList, useFlowMutations } from "@/hooks/useFlows";
import { STATUS_LABELS, type FlowStatus } from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Copy, Archive, Info, GitBranch, Users, Pencil } from "lucide-react";
import { FlowRunsDrawer } from "@/components/crm/flows/FlowRunsDrawer";
import type { FlowListItem } from "@/hooks/useFlows";

const STATUS_BADGE: Record<FlowStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/30",
  paused: "bg-warning/10 text-warning border-warning/30",
  archived: "bg-muted text-muted-foreground border-border",
};

export default function CRMFlows() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspaceId, currentWorkspace } = useWorkspace();
  const { data: flows, isLoading } = useFlowsList();
  const { createFlow, duplicateFlow, setFlowStatus, saveFlow } = useFlowMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStage, setNewStage] = useState("");
  const [runsFlow, setRunsFlow] = useState<FlowListItem | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [duplicateFlowId, setDuplicateFlowId] = useState<string | null>(null);
  const [duplicateStageId, setDuplicateStageId] = useState("");



  const activeStageIds = new Set(
    (flows || []).filter((f) => f.status === "active").map((f) => f.stage_id),
  );

  const { data: stages } = useQuery({
    queryKey: ["crm-flow-stages", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name")
        .eq("workspace_id", workspaceId!)
        .order("order");
      return data || [];
    },
  });

  const handleCreate = async () => {
    try {
      const flow = await createFlow.mutateAsync({ name: newName.trim(), stage_id: newStage });
      setCreateOpen(false);
      setNewName("");
      setNewStage("");
      navigate(`/crm/settings/flows/${flow.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao criar fluxo", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleRename = async () => {
    if (!renameId || !renameName.trim()) return;
    try {
      await saveFlow.mutateAsync({ id: renameId, patch: { name: renameName.trim() } });
      toast({ title: "Fluxo renomeado" });
      setRenameId(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao renomear", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDuplicateOpen = (id: string) => {
    const flow = flows?.find((f) => f.id === id);
    if (!flow) return;
    setDuplicateFlowId(id);
    setDuplicateStageId(flow.stage_id);
  };

  const handleDuplicateConfirm = async () => {
    const flow = flows?.find((f) => f.id === duplicateFlowId);
    if (!flow) return;
    try {
      const copy = await duplicateFlow.mutateAsync({ flow, stage_id: duplicateStageId });
      toast({ title: "Fluxo duplicado como rascunho" });
      setDuplicateFlowId(null);
      setDuplicateStageId("");
      navigate(`/crm/settings/flows/${copy.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao duplicar", description: e instanceof Error ? e.message : String(e) });
    }
  };


  const handleArchive = async () => {
    if (!archiveId) return;
    try {
      await setFlowStatus.mutateAsync({ id: archiveId, status: "archived" });
      toast({ title: "Fluxo arquivado", description: "Leads que estavam no fluxo foram encerrados." });
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao arquivar", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setArchiveId(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Fluxos</h1>
          <p className="text-muted-foreground text-sm">
            Automações visuais disparadas pela entrada do lead em uma etapa do pipeline.
          </p>
          {currentWorkspace && (
            <p className="text-xs text-muted-foreground mt-1">
              Workspace: <span className="font-medium text-foreground">{currentWorkspace.name}</span>
            </p>
          )}
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo fluxo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !flows || flows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed rounded-md">
          <GitBranch className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm">Nenhum fluxo ainda. Clique em "Novo fluxo" para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((f) => (
            <Card key={f.id} className="hover:border-border transition-colors">
              <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => navigate(`/crm/settings/flows/${f.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{f.name}</span>
                    <Badge variant="outline" className={STATUS_BADGE[f.status]}>
                      {STATUS_LABELS[f.status]}
                    </Badge>
                    {f.v1_superseded && f.status === "active" && (
                      <span title="A régua v1 desta etapa foi suspensa por este fluxo — não recebe novos leads. As mensagens já agendadas continuam sendo enviadas.">
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Etapa: <span className="text-foreground">{f.stage_name}</span>
                    {" · "}{f.open_runs} lead{f.open_runs === 1 ? "" : "s"} no fluxo agora
                    {" · "}atualizado {new Date(f.updated_at).toLocaleDateString("pt-BR")}
                  </p>
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" title="Leads no fluxo e auditoria" onClick={() => setRunsFlow(f)}>
                    <Users className="h-4 w-4 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Renomear"
                    onClick={() => { setRenameId(f.id); setRenameName(f.name); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Duplicar" onClick={() => handleDuplicateOpen(f.id)}>
                    <Copy className="h-4 w-4" />
                  </Button>


                  {f.status !== "archived" && (
                    <Button variant="ghost" size="icon" title="Arquivar" onClick={() => setArchiveId(f.id)}>
                      <Archive className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Boas-vindas MQL" />
            </div>
            <div className="space-y-1.5">
              <Label>Etapa-gatilho</Label>
              <Select value={newStage} onValueChange={setNewStage}>
                <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                <SelectContent>
                  {(stages || []).filter((s) => !activeStageIds.has(s.id)).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                  {(stages || []).length > 0 && (stages || []).every((s) => activeStageIds.has(s.id)) && (
                    <div className="p-2 text-sm text-muted-foreground">Todas as etapas já têm fluxo ativo</div>
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                O fluxo dispara quando um lead entra nesta etapa. Só pode haver um fluxo ativo por etapa.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || !newStage || createFlow.isPending}>
              {createFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameId} onOpenChange={(o) => !o && setRenameId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Renomear fluxo</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameId(null)}>Cancelar</Button>
            <Button onClick={handleRename} disabled={!renameName.trim() || saveFlow.isPending}>
              {saveFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!duplicateFlowId} onOpenChange={(o) => { if (!o) { setDuplicateFlowId(null); setDuplicateStageId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Duplicar fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              O novo fluxo será criado como rascunho. Escolha a etapa-gatilho para a cópia.
            </p>
            <div className="space-y-1.5">
              <Label>Etapa-gatilho</Label>
              <Select value={duplicateStageId} onValueChange={setDuplicateStageId}>
                <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                <SelectContent>
                  {(stages || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDuplicateFlowId(null); setDuplicateStageId(""); }}>Cancelar</Button>
            <Button onClick={handleDuplicateConfirm} disabled={!duplicateStageId || duplicateFlow.isPending}>
              {duplicateFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Duplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(o) => !o && setArchiveId(null)}>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar este fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads que estiverem no meio do fluxo serão encerrados (motivo: fluxo arquivado) e nenhuma mensagem futura será enviada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleArchive}>
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FlowRunsDrawer
        flowId={runsFlow?.id}
        nodes={runsFlow?.nodes || []}
        flowName={runsFlow?.name}
        open={!!runsFlow}
        onOpenChange={(o) => !o && setRunsFlow(null)}
      />
    </div>
  );
}
