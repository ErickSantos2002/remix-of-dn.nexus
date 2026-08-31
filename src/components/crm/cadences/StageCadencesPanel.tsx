import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, BarChart3, ArrowUpRight } from "lucide-react";
import { CadenceTemplateEditor } from "@/components/crm/cadences/CadenceTemplateEditor";
import { CadenceStatsDialog, type CadenceStatsRule } from "@/components/crm/cadences/CadenceStatsDialog";
import { CadenceOverviewDialog } from "@/components/crm/cadences/CadenceOverviewDialog";


interface StageRule {
  id: string;
  stage_id: string;
  name: string | null;
  is_active: boolean;
}

interface PipelineStage {
  id: string;
  name: string;
}

interface ActiveFlow {
  id: string;
  name: string;
}

export function StageCadencesPanel() {
  const { currentCompany } = useCompany();
  const { currentWorkspace, workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<StageRule[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [newStage, setNewStage] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statsRule, setStatsRule] = useState<CadenceStatsRule | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  // Etapas migradas: stage_id -> fluxo v2 que assumiu a etapa.
  const [activeFlows, setActiveFlows] = useState<Record<string, ActiveFlow>>({});


  const fetchData = async () => {
    if (!currentCompany?.id || !workspaceId) return;
    setLoading(true);
    const { data: stageList } = await supabase
      .from("crm_pipeline_stages")
      .select("id, name, workspace_id")
      .eq("workspace_id", workspaceId)
      .order("order");
    setStages((stageList as PipelineStage[]) || []);
    const { data: rs } = await supabase
      .from("cadence_rules" as any)
      .select("*")
      .eq("company_id", currentCompany.id)
      .eq("trigger_type", "stage")
      .order("created_at");
    setRules((rs as unknown as StageRule[]) || []);

    // Mesma condição da guarda em enqueue_stage_cadence: fluxo ativo e com nó de
    // entrada bloqueia a entrada de novos leads na régua v1 daquela etapa.
    const { data: flows } = await supabase
      .from("crm_flows" as any)
      .select("id, name, stage_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .not("entry_node_id", "is", null);
    const flowRows = (flows as unknown as Array<ActiveFlow & { stage_id: string | null }>) || [];
    const flowMap: Record<string, ActiveFlow> = {};
    for (const f of flowRows) {
      if (f.stage_id) flowMap[f.stage_id] = { id: f.id, name: f.name };
    }
    setActiveFlows(flowMap);

    setLoading(false);
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [currentCompany?.id, workspaceId]);

  const createRule = async () => {
    if (!newStage || !currentCompany?.id) return;
    const stage = stages.find((s) => s.id === newStage);
    const { error } = await supabase.from("cadence_rules" as any).insert({
      company_id: currentCompany.id,
      trigger_type: "stage",
      stage_id: newStage,
      name: stage ? stage.name : null,
    });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    setNewStage("");
    fetchData();
  };

  const toggleActive = async (id: string, val: boolean) => {
    await supabase.from("cadence_rules" as any).update({ is_active: val }).eq("id", id);
    fetchData();
  };

  const deleteRule = async (id: string) => {
    if (!confirm("Excluir esta régua e todas suas mensagens?")) return;
    await supabase.from("cadence_rules" as any).delete().eq("id", id);
    fetchData();
  };

  const availableStages = stages.filter(
    (s) => !rules.some((r) => r.stage_id === s.id) && !activeFlows[s.id],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-muted-foreground text-sm">
            Mensagens automáticas enviadas após um lead entrar em uma etapa do pipeline.
          </p>
          {currentWorkspace && (
            <p className="text-xs text-muted-foreground mt-1">
              Workspace: <span className="font-medium text-foreground">{currentWorkspace.name}</span>
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOverviewOpen(true)}>
          <BarChart3 className="h-4 w-4 mr-1" /> Estatísticas gerais
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova régua</CardTitle>
          <CardDescription>Escolha a etapa. Uma régua por etapa.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Select value={newStage} onValueChange={setNewStage}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
            <SelectContent>
              {availableStages.length === 0 && (
                <div className="p-2 text-sm text-muted-foreground">
                  Nenhuma etapa disponível — as demais já têm régua ou foram migradas para Fluxos.
                </div>
              )}
              {availableStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={createRule} disabled={!newStage}>
            <Plus className="h-4 w-4 mr-1" /> Criar
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        rules.map((r) => {
          const isOpen = expanded === r.id;
          const stage = stages.find((s) => s.id === r.stage_id);
          const migratedFlow = activeFlows[r.stage_id];
          return (
            <Card key={r.id} className={migratedFlow ? "opacity-70" : undefined}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.id)}>
                <div className="flex items-center gap-2 flex-wrap">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <CardTitle className="text-base">
                    {stage ? stage.name : r.name || r.stage_id}
                  </CardTitle>
                  {migratedFlow && (
                    <Badge variant="secondary" className="badge-neutral">
                      Inativa — migrada para Fluxos
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  {migratedFlow && (
                    <Button variant="ghost" size="sm" asChild title={`Abrir fluxo ${migratedFlow.name}`}>
                      <Link to={`/crm/settings/flows/${migratedFlow.id}`}>
                        Abrir fluxo <ArrowUpRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  )}
                  <Switch
                    checked={migratedFlow ? false : r.is_active}
                    disabled={!!migratedFlow}
                    onCheckedChange={(v) => toggleActive(r.id, v)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Estatísticas"
                    onClick={() => setStatsRule({ id: r.id, name: stage?.name || r.name, trigger_type: "stage", stage_id: r.stage_id })}
                  >
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteRule(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>

                </div>
              </CardHeader>
              {isOpen && (
                <CardContent>
                  <CadenceTemplateEditor
                    ruleId={r.id}
                    triggerType="stage"
                    readOnly={!!migratedFlow}
                    readOnlyFlowName={migratedFlow?.name}
                  />
                </CardContent>
              )}
            </Card>
          );
        })
      )}
      <CadenceStatsDialog
        rule={statsRule}
        open={!!statsRule}
        onOpenChange={(o) => !o && setStatsRule(null)}
      />
      <CadenceOverviewDialog
        triggerType="stage"
        open={overviewOpen}
        onOpenChange={setOverviewOpen}
      />
    </div>

  );
}
