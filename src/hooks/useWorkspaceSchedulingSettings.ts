import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export const DEFAULT_SLOT_STEP_MINUTES = 15;

export const SLOT_STEP_OPTIONS = [5, 10, 15, 20, 30, 40, 50, 60];

export function useWorkspaceSchedulingSettings() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["workspace-scheduling-settings", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_meeting_settings" as any)
        .select("workspace_id, slot_step_minutes")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as {
        workspace_id: string;
        slot_step_minutes: number;
      } | null;
    },
  });

  const slotStepMinutes =
    query.data?.slot_step_minutes && query.data.slot_step_minutes > 0
      ? query.data.slot_step_minutes
      : DEFAULT_SLOT_STEP_MINUTES;

  const updateSlotStep = useMutation({
    mutationFn: async (value: number) => {
      if (!workspaceId) return;
      const { error } = await supabase
        .from("workspace_meeting_settings" as any)
        .upsert(
          { workspace_id: workspaceId, slot_step_minutes: value },
          { onConflict: "workspace_id" }
        );
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["workspace-scheduling-settings", workspaceId],
      }),
  });

  return {
    slotStepMinutes,
    isLoading: query.isLoading,
    updateSlotStep: updateSlotStep.mutateAsync,
    isUpdating: updateSlotStep.isPending,
  };
}
