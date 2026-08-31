import { supabase } from "@/integrations/supabase/client";

interface LinkedWorkspace {
  workspace_id: string;
  keywords: string[];
  is_default: boolean;
  priority: number;
}

export async function saveConnectionWorkspaces(
  connectionId: string,
  connectionType: "zapi" | "whatsapp_official" | "instagram",
  linkedWorkspaces: LinkedWorkspace[]
) {
  // Primeiro, deletar TODOS os vínculos existentes dessa connection
  const { error: deleteError } = await supabase
    .from("connection_workspaces")
    .delete()
    .eq("connection_id", connectionId)
    .eq("connection_type", connectionType);

  if (deleteError) {
    console.error("[saveConnectionWorkspaces] Delete error:", deleteError);
    throw deleteError;
  }

  // Se não há workspaces para vincular, já terminamos
  if (linkedWorkspaces.length === 0) {
    return;
  }

  // Deduplicate by workspace_id (keep last occurrence)
  const deduped = linkedWorkspaces.reduce((acc, lw) => {
    acc.set(lw.workspace_id, lw);
    return acc;
  }, new Map<string, LinkedWorkspace>());
  const uniqueWorkspaces = Array.from(deduped.values());

  // Inserir os novos vínculos
  const inserts = uniqueWorkspaces.map((lw, idx) => ({
    connection_id: connectionId,
    connection_type: connectionType,
    workspace_id: lw.workspace_id,
    keywords: lw.keywords,
    is_default: lw.is_default,
    priority: lw.priority ?? idx,
    is_active: true,
  }));

  const { error: insertError } = await supabase
    .from("connection_workspaces")
    .insert(inserts);

  if (insertError) {
    console.error("[saveConnectionWorkspaces] Insert error:", insertError);
    throw insertError;
  }
}

export async function loadConnectionWorkspaces(
  connectionId: string,
  connectionType: "zapi" | "whatsapp_official" | "instagram"
): Promise<LinkedWorkspace[]> {
  const { data, error } = await supabase
    .from("connection_workspaces")
    .select("workspace_id, keywords, is_default, priority")
    .eq("connection_id", connectionId)
    .eq("connection_type", connectionType)
    .eq("is_active", true)
    .order("priority");

  if (error) {
    console.error("Error loading connection_workspaces:", error);
    return [];
  }

  return (data || []).map(d => ({
    workspace_id: d.workspace_id,
    keywords: d.keywords || [],
    is_default: d.is_default || false,
    priority: d.priority || 0,
  }));
}
