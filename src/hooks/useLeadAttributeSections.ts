import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";

export type LeadAttributeSectionKey = "segments" | "pains" | "objections";

interface SectionRow {
  section_key: string;
  is_active: boolean;
}

/**
 * Controla a exibicao das secoes de atributos (Segmentos, Dores, Objecoes)
 * no detalhe do card do pipeline. Ausencia de registro = secao ativa.
 */
export function useLeadAttributeSections(workspaceId?: string) {
  const { currentWorkspace } = useWorkspace();
  const wsId = workspaceId ?? currentWorkspace?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["crm-lead-attribute-sections", wsId],
    queryFn: async (): Promise<Record<string, boolean>> => {
      if (!wsId) return {};
      const { data, error } = await supabase
        .from("crm_lead_attribute_sections")
        .select("section_key, is_active")
        .eq("workspace_id", wsId);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const row of (data ?? []) as SectionRow[]) {
        map[row.section_key] = row.is_active;
      }
      return map;
    },
    enabled: !!wsId,
  });

  const isActive = (key: LeadAttributeSectionKey) => data?.[key] ?? true;

  const setActive = useMutation({
    mutationFn: async ({ key, value }: { key: LeadAttributeSectionKey; value: boolean }) => {
      if (!wsId) throw new Error("Workspace nao selecionado");
      const { error } = await supabase
        .from("crm_lead_attribute_sections")
        .upsert(
          { workspace_id: wsId, section_key: key, is_active: value },
          { onConflict: "workspace_id,section_key" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-lead-attribute-sections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar secao", description: error.message, variant: "destructive" });
    },
  });

  return {
    isLoading,
    isActive,
    setActive: (key: LeadAttributeSectionKey, value: boolean) => setActive.mutate({ key, value }),
    isSaving: setActive.isPending,
  };
}
