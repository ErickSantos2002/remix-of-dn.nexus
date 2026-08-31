import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export interface AgentCategoryOption {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
}

export function useAgentCategories() {
  const { workspaceId } = useWorkspace();
  const [categories, setCategories] = useState<AgentCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (workspaceId) {
      fetchCategories();
    }
  }, [workspaceId]);

  const fetchCategories = async () => {
    if (!workspaceId) return;

    try {
      const { data, error } = await supabase
        .from("agent_categories")
        .select("id, name, slug, icon, color")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error("Error fetching agent categories:", error);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  return { categories, loading, refetch: fetchCategories };
}
