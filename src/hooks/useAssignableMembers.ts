import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type MemberRow = {
  user_id: string;
  profiles: { id: string; name: string | null; email: string | null } | null;
};

export interface AssignableMember {
  id: string;
  name: string;
}

/**
 * Membros elegiveis para atribuicao dentro do workspace:
 * membros do workspace + dono do workspace + admins/super admins da empresa.
 */
export function useAssignableMembers(workspaceId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["assignable-members", workspaceId],
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<AssignableMember[]> => {
      if (!workspaceId) return [];

      const { data: wsMembers } = await supabase
        .from("workspace_members")
        .select("user_id, profiles:user_id(id, name, email)")
        .eq("workspace_id", workspaceId);

      const { data: workspace } = await supabase
        .from("workspaces")
        .select("owner_id, company_id")
        .eq("id", workspaceId)
        .maybeSingle();

      let companyAdmins: MemberRow[] = [];
      if (workspace?.company_id) {
        const { data: admins } = await supabase
          .from("company_members")
          .select("user_id, profiles:user_id(id, name, email)")
          .eq("company_id", workspace.company_id)
          .eq("status", "active")
          .in("role", ["admin", "super_admin"]);
        companyAdmins = (admins || []) as unknown as MemberRow[];
      }

      const all = new Map<string, AssignableMember>();
      const add = (m: MemberRow) => {
        if (m.user_id && !all.has(m.user_id)) {
          all.set(m.user_id, { id: m.user_id, name: m.profiles?.name || m.profiles?.email || "Sem nome" });
        }
      };

      ((wsMembers || []) as unknown as MemberRow[]).forEach(add);
      companyAdmins.forEach(add);

      if (workspace?.owner_id && !all.has(workspace.owner_id)) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("id, name, email")
          .eq("id", workspace.owner_id)
          .maybeSingle();
        all.set(workspace.owner_id, {
          id: workspace.owner_id,
          name: ownerProfile?.name || ownerProfile?.email || "Sem nome",
        });
      }

      return Array.from(all.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });
}
