import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import type { Flow, FlowNode, FlowStatus } from "@/lib/flows";

export interface FlowListItem extends Flow {
  stage_name: string;
  open_runs: number;
  /** A etapa tem régua v1 ativa que este fluxo suspendeu (não recebe mais novos leads). */
  v1_superseded: boolean;
}

export function useFlowsList() {
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  return useQuery({
    queryKey: ["crm-flows", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<FlowListItem[]> => {
      const { data: flows, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = ((flows as unknown) as Flow[]) || [];

      const { data: stages } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name")
        .eq("workspace_id", workspaceId!);
      const stageName = new Map((stages || []).map((s) => [s.id, s.name]));

      const runCount = new Map<string, number>();
      const ids = list.map((f) => f.id);
      if (ids.length > 0) {
        const { data: runs } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("crm_flow_runs" as any)
          .select("flow_id")
          .in("flow_id", ids)
          .in("state", ["active", "waiting"]);
        for (const r of ((runs as unknown) as { flow_id: string }[]) || []) {
          runCount.set(r.flow_id, (runCount.get(r.flow_id) || 0) + 1);
        }
      }

      // Régua v1 de etapa da empresa na mesma etapa: suspensa pela guarda em
      // enqueue_stage_cadence enquanto este fluxo estiver ativo.
      const v1Stages = new Set<string>();
      if (currentCompany?.id) {
        const { data: rules } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("cadence_rules" as any)
          .select("stage_id")
          .eq("company_id", currentCompany.id)
          .eq("trigger_type", "stage")
          .eq("is_active", true);
        for (const r of ((rules as unknown) as { stage_id: string | null }[]) || []) {
          if (r.stage_id) v1Stages.add(r.stage_id);
        }
      }

      return list.map((f) => ({
        ...f,
        stage_name: stageName.get(f.stage_id) || "—",
        open_runs: runCount.get(f.id) || 0,
        v1_superseded: v1Stages.has(f.stage_id),
      }));
    },
  });
}

export function useFlow(id?: string) {
  return useQuery({
    queryKey: ["crm-flow", id],
    enabled: !!id,
    queryFn: async (): Promise<Flow | null> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return ((data as unknown) as Flow) || null;
    },
  });
}

export interface SaveFlowPatch {
  name?: string;
  nodes?: FlowNode[];
  entry_node_id?: string | null;
  exit_on_stage_change?: boolean;
  reentry?: "once" | "allowed";
  reentry_cooldown_hours?: number;
}

export function useFlowMutations() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ["crm-flows"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["crm-flow", id] });
  };

  const createFlow = useMutation({
    mutationFn: async (input: { name: string; stage_id: string }): Promise<Flow> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .insert({
          workspace_id: workspaceId,
          company_id: currentCompany?.id, // o banco força a company do workspace
          stage_id: input.stage_id,
          name: input.name,
          status: "draft",
          nodes: [],
        })
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as Flow;
    },
    onSuccess: () => invalidate(),
  });

  const saveFlow = useMutation({
    mutationFn: async (input: { id: string; patch: SaveFlowPatch }): Promise<void> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .update(input.patch)
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || (data as unknown[]).length === 0) {
        throw new Error("Sem permissão para alterar este fluxo (ou o fluxo foi removido).");
      }
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const setFlowStatus = useMutation({
    mutationFn: async (input: { id: string; status: FlowStatus }): Promise<void> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .update({ status: input.status })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || (data as unknown[]).length === 0) {
        throw new Error("Sem permissão para alterar este fluxo (ou o fluxo foi removido).");
      }
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const duplicateFlow = useMutation({
    mutationFn: async (input: { flow: Flow; stage_id?: string }): Promise<Flow> => {
      const { flow, stage_id } = input;
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("crm_flows" as any)
        .insert({
          workspace_id: flow.workspace_id,
          company_id: flow.company_id,
          stage_id: stage_id || flow.stage_id,
          name: `${flow.name} (cópia)`,
          status: "draft",
          entry_node_id: flow.entry_node_id,
          nodes: flow.nodes,
          exit_on_stage_change: flow.exit_on_stage_change,
          reentry: flow.reentry,
          reentry_cooldown_hours: flow.reentry_cooldown_hours,
        })
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as Flow;
    },
    onSuccess: () => invalidate(),
  });


  return { createFlow, saveFlow, setFlowStatus, duplicateFlow };
}
