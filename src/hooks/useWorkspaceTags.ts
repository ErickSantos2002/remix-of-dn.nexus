import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseTags } from "@/types/tags";
import type { ContactTag } from "@/types/tags";

/**
 * Hook to fetch all unique tags used in a workspace
 * Useful for autocomplete/suggestions when adding tags
 */
export function useWorkspaceTags(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-tags", workspaceId],
    queryFn: async (): Promise<ContactTag[]> => {
      if (!workspaceId) return [];

      const { data, error } = await supabase
        .from("crm_contacts")
        .select("tags")
        .eq("workspace_id", workspaceId)
        .not("tags", "is", null);

      if (error) throw error;

      // Extract unique tags by name
      const tagMap = new Map<string, ContactTag>();
      data?.forEach((contact) => {
        const contactTags = parseTags(contact.tags);
        contactTags.forEach((tag) => {
          // Keep first occurrence of each tag name
          if (!tagMap.has(tag.name.toLowerCase())) {
            tagMap.set(tag.name.toLowerCase(), tag);
          }
        });
      });

      return Array.from(tagMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    },
    enabled: !!workspaceId,
    staleTime: 1000 * 30, // 30 seconds
  });
}
