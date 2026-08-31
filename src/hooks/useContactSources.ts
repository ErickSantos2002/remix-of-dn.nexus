import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";

export interface ContactSource {
  id: string;
  company_id: string;
  name: string;
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
}

/**
 * Retorna as origens de contato selecionáveis pelo usuário no dropdown
 * (ativas + não-system) da empresa atual.
 */
export function useContactSources() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  return useQuery({
    queryKey: ["contact-sources", "ui", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ContactSource[]> => {
      const { data, error } = await supabase
        .from("crm_contact_sources")
        .select("*")
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .eq("is_system", false)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ContactSource[];
    },
    staleTime: 60_000,
  });
}

/**
 * Retorna TODAS as origens (incluindo system e inativas) da empresa atual.
 * Usado na tela de gerenciamento.
 */
export function useAllContactSources() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  return useQuery({
    queryKey: ["contact-sources", "all", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ContactSource[]> => {
      const { data, error } = await supabase
        .from("crm_contact_sources")
        .select("*")
        .eq("company_id", companyId!)
        .order("is_system", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ContactSource[];
    },
    staleTime: 30_000,
  });
}
