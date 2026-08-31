// WorkspaceContext - Multi-tenant workspace management with super_admin support
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { useCompany } from "./CompanyContext";

type Workspace = Tables<"workspaces"> & {
  icon?: string | null;
  is_default?: boolean;
  description?: string | null;
  company_id?: string | null;
};
type Agent = Tables<"agents">;
type AgentInstance = Tables<"agent_instances">;

// Unified agent type that can come from either table
interface UnifiedAgent {
  id: string;
  name: string;
  is_active: boolean | null;
  is_archived: boolean | null;
  workspace_id: string;
  created_at: string | null;
  source: 'agents' | 'agent_instances';
}

interface WorkspaceContextType {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  isLoading: boolean;
  agents: UnifiedAgent[];
  isLoadingAgents: boolean;
  refetchAgents: () => Promise<void>;
  refetchWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

const WORKSPACE_STORAGE_KEY = "nexus_selected_workspace_id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { companyId, isLoading: isLoadingCompany } = useCompany();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(() => {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY);
  });
  const [isLoading, setIsLoading] = useState(true);
  const [agents, setAgents] = useState<UnifiedAgent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  }, []);

  const createDefaultWorkspace = async (companyId: string, userId: string) => {
    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        name: "Principal",
        company_id: companyId,
        owner_id: userId,
        is_default: true,
        icon: "Star",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating default workspace:", error);
      return null;
    }

    return data;
  };

  const fetchWorkspaces = useCallback(async () => {
    if (!companyId || isLoadingCompany) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

    // Check if user is global super_admin
    // Filtrar pela role: user_roles admite mais de uma linha por usuário e
    // maybeSingle() falha quando o usuário tem várias.
    const { data: userRoleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle();

    const isGlobalSuperAdmin = userRoleData?.role === "super_admin";

    // Check if user is company owner or admin
    const { data: companyData } = await supabase
      .from("companies")
      .select("owner_id")
      .eq("id", companyId)
      .single();

    const isCompanyOwner = companyData?.owner_id === user.id;

    // Check if user is company admin
    const { data: adminCheck } = await supabase
      .from("company_members")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    const isCompanyAdmin = adminCheck?.role === "admin" || adminCheck?.role === "super_admin";

    let workspacesData: Workspace[] = [];

    if (isGlobalSuperAdmin || isCompanyOwner || isCompanyAdmin) {
      // Owner/Admin: fetch all workspaces in the company
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .eq("company_id", companyId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching workspaces:", error);
        setIsLoading(false);
        return;
      }
      
      workspacesData = (data || []) as Workspace[];
    } else {
      // Regular member: fetch only workspaces where user is a member
      const { data: membershipData, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(*)")
        .eq("user_id", user.id)
        .eq("status", "active");

      if (membershipError) {
        console.error("Error fetching workspace memberships:", membershipError);
        setIsLoading(false);
        return;
      }

      // Extract workspaces from membership data and filter by company
      workspacesData = (membershipData || [])
        .map((m) => (m as { workspace: Workspace | null }).workspace)
        .filter((w): w is Workspace => w != null && w.company_id === companyId);
      
      // Sort workspaces
      workspacesData.sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
    }

    // If no workspaces and user is owner, create a default one
    if (workspacesData.length === 0 && isCompanyOwner) {
      const newWorkspace = await createDefaultWorkspace(companyId, user.id);
      if (newWorkspace) {
        setWorkspaces([newWorkspace as Workspace]);
        setWorkspaceId(newWorkspace.id);
      }
      setIsLoading(false);
      return;
    }

    setWorkspaces(workspacesData);
    
    // Auto-select workspace
    const storedId = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const storedWorkspaceExists = storedId && workspacesData.some((w) => w.id === storedId);
    
    if (!storedWorkspaceExists && workspacesData.length > 0) {
      const defaultWorkspace = workspacesData.find((w) => w.is_default);
      const selectedId = defaultWorkspace?.id || workspacesData[0].id;
      setWorkspaceId(selectedId);
    } else if (!workspaceId && storedId) {
      setWorkspaceIdState(storedId);
    }
    
    setIsLoading(false);
  }, [companyId, isLoadingCompany, workspaceId]);

  const fetchAgents = useCallback(async () => {
    if (!workspaceId) {
      setAgents([]);
      return;
    }

    setIsLoadingAgents(true);
    
    const [agentsResult, instancesResult] = await Promise.all([
      supabase
        .from("agents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("agent_instances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_archived", false)
        .order("created_at", { ascending: false })
    ]);

    if (agentsResult.error) {
      console.error("Error fetching agents:", agentsResult.error);
    }
    if (instancesResult.error) {
      console.error("Error fetching agent instances:", instancesResult.error);
    }

    const legacyAgents: UnifiedAgent[] = (agentsResult.data || []).map(a => ({
      id: a.id,
      name: a.name,
      is_active: a.is_active,
      is_archived: a.is_archived,
      workspace_id: a.workspace_id,
      created_at: a.created_at,
      source: 'agents' as const
    }));

    const instanceAgents: UnifiedAgent[] = (instancesResult.data || []).map(a => ({
      id: a.id,
      name: a.name,
      is_active: a.is_active,
      is_archived: a.is_archived,
      workspace_id: a.workspace_id,
      created_at: a.created_at,
      source: 'agent_instances' as const
    }));

    const allAgents = [...legacyAgents, ...instanceAgents].sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    setAgents(allAgents);
    setIsLoadingAgents(false);
  }, [workspaceId]);

  // Refetch workspaces quando a empresa mudar
  useEffect(() => {
    if (companyId && !isLoadingCompany) {
      fetchWorkspaces();
    }
  }, [companyId, isLoadingCompany]);

  // Realtime subscription para atualizações de workspaces
  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel('workspaces-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspaces',
          filter: `company_id=eq.${companyId}`
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setWorkspaces((prev) =>
              prev.map((w) =>
                w.id === payload.new.id ? { ...w, ...payload.new } : w
              )
            );
          } else if (payload.eventType === 'INSERT') {
            setWorkspaces((prev) => [...prev, payload.new as Workspace]);
          } else if (payload.eventType === 'DELETE') {
            setWorkspaces((prev) => prev.filter((w) => w.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  useEffect(() => {
    fetchAgents();
  }, [workspaceId, fetchAgents]);

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId) || null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        workspaceId,
        setWorkspaceId,
        isLoading,
        agents,
        isLoadingAgents,
        refetchAgents: fetchAgents,
        refetchWorkspaces: fetchWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
