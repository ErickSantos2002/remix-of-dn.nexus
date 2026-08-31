import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";

export interface ToolCatalogItem {
  id: string;
  name: string;
  label: string;
  description: string | null;
  icon_name: string;
  category: string;
  default_config: Json;
  function_schema: Json;
  requires_setup: string[];
  is_active: boolean;
  display_order: number;
}

export function useToolCatalog() {
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("tool_catalog")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (fetchError) throw fetchError;
      setTools(data || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching tool catalog:", err);
      setError(err instanceof Error ? err.message : "Erro ao carregar catálogo");
    } finally {
      setLoading(false);
    }
  };

  return { tools, loading, error, refetch: fetchTools };
}
