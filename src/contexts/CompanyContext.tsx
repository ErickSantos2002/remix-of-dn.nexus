import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const COMPANY_STORAGE_KEY = "nexus-selected-company";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  owner_id: string | null;
  created_at: string | null;
  zapi_account_token: string | null;
  zapi_token_status: string | null;
  zapi_token_validated_at: string | null;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  status: string;
  joined_at: string;
  invited_by: string | null;
}

interface CompanyContextType {
  companies: Company[];
  currentCompany: Company | null;
  companyId: string | null;
  setCompanyId: (id: string) => void;
  isLoading: boolean;
  refetchCompanies: () => Promise<void>;
  isOwner: boolean;
  isAdmin: boolean;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const { toast } = useToast();

  const currentCompany = companies.find((c) => c.id === companyId) || null;

  const fetchCompanies = async () => {
    try {
      setIsLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCompanies([]);
        setCompanyIdState(null);
        setIsLoading(false);
        return;
      }

      // Buscar empresas onde o usuário é owner ou membro ativo
      // RLS já filtra para mostrar apenas empresas onde o usuário tem acesso
      const { data: companiesData, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;

      // NÃO criar empresa automaticamente!
      // Se o usuário foi convidado, ele deve aceitar o convite primeiro
      // Se não tem empresas, pode aceitar convite pendente
      setCompanies(companiesData || []);

      if (companiesData && companiesData.length > 0) {
        // Recuperar empresa selecionada do localStorage
        const savedCompanyId = localStorage.getItem(COMPANY_STORAGE_KEY);
        const validCompany = companiesData.find((c) => c.id === savedCompanyId);
        
        if (validCompany) {
          setCompanyIdState(validCompany.id);
        } else {
          setCompanyIdState(companiesData[0].id);
          localStorage.setItem(COMPANY_STORAGE_KEY, companiesData[0].id);
        }
      } else {
        // Usuário não tem empresas - deixar null
        // Ele pode ter um convite pendente ou precisar ser convidado
        setCompanyIdState(null);
        localStorage.removeItem(COMPANY_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Erro ao carregar empresas:", error);
      toast({
        title: "Erro",
        description: "Falha ao carregar empresas",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const setCompanyId = (id: string) => {
    setCompanyIdState(id);
    localStorage.setItem(COMPANY_STORAGE_KEY, id);
  };

  // Verificar permissões do usuário na empresa atual
  useEffect(() => {
    const checkPermissions = async () => {
      if (!companyId) {
        setIsOwner(false);
        setIsAdmin(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Verificar se é super_admin global
      // Filtrar pela role: user_roles admite mais de uma linha por usuário e
      // maybeSingle() falha quando o usuário tem várias.
      const { data: userRoleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "super_admin")
        .maybeSingle();

      if (userRoleData?.role === "super_admin") {
        setIsOwner(true);  // Super admin tem poderes de owner
        setIsAdmin(true);
        return;
      }

      // Verificar se é owner
      const company = companies.find((c) => c.id === companyId);
      if (company?.owner_id === user.id) {
        setIsOwner(true);
        setIsAdmin(true);
        return;
      }

      // Verificar se é admin
      const { data: membership } = await supabase
        .from("company_members")
        .select("role")
        .eq("company_id", companyId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      setIsOwner(false);
      setIsAdmin(membership?.role === "admin");
    };

    checkPermissions();
  }, [companyId, companies]);

  useEffect(() => {
    fetchCompanies();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchCompanies();
    });

    return () => subscription.unsubscribe();
  }, []);

  // Realtime subscription para atualizações de empresas
  useEffect(() => {
    const channel = supabase
      .channel('companies-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'companies'
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setCompanies((prev) =>
              prev.map((c) =>
                c.id === payload.new.id ? { ...c, ...payload.new } : c
              )
            );
          } else if (payload.eventType === 'INSERT') {
            setCompanies((prev) => [...prev, payload.new as Company]);
          } else if (payload.eventType === 'DELETE') {
            setCompanies((prev) => prev.filter((c) => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <CompanyContext.Provider
      value={{
        companies,
        currentCompany,
        companyId,
        setCompanyId,
        isLoading,
        refetchCompanies: fetchCompanies,
        isOwner,
        isAdmin,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return context;
}
