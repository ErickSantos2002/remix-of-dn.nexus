// Responsável do card aberto do contato — o "dono fixo" (spec §6 passo 3, §7 passo 3).
export async function getCardOwner(
  supabase: any, workspaceId: string, contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null;
  const { data, error } = await supabase
    .from("crm_leads")
    .select("assigned_to")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[ROUTING] getCardOwner:", error.message);
  return (data as { assigned_to: string | null } | null)?.assigned_to ?? null;
}
