import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export interface Holiday {
  id: string;
  workspace_id: string;
  date: string; // YYYY-MM-DD
  name: string;
  created_at: string;
}

export function useWorkspaceHolidays() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["crm_holidays", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_holidays" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Holiday[];
    },
  });

  const holidays = query.data ?? [];
  const holidaySet = new Set(holidays.map((h) => h.date));

  const isHoliday = (date: Date | string) => {
    const key =
      typeof date === "string"
        ? date.slice(0, 10)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return holidaySet.has(key);
  };

  const getHolidayName = (date: Date | string) => {
    const key =
      typeof date === "string"
        ? date.slice(0, 10)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return holidays.find((h) => h.date === key)?.name ?? null;
  };

  const addMutation = useMutation({
    mutationFn: async ({ date, name }: { date: string; name: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("crm_holidays" as any)
        .insert({ workspace_id: workspaceId, date, name, created_by: userData.user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm_holidays", workspaceId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crm_holidays" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm_holidays", workspaceId] }),
  });

  return {
    holidays,
    isLoading: query.isLoading,
    isHoliday,
    getHolidayName,
    addHoliday: addMutation.mutateAsync,
    removeHoliday: removeMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
  };
}
