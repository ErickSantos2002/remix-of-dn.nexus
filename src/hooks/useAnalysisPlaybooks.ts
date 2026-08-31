import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import type {
  AnalysisActivityType,
  AnalysisPlaybook,
  AnalysisRubricCriterion,
  AnalysisRubricVersion,
} from "@/types/analysis";

// As tabelas de análise ainda não existem em types.ts (auto-gerado).
// Os casts abaixo saem quando o Lovable regenerar os tipos do Supabase.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Análises ATIVAS que podem ser vinculadas a uma atividade do tipo informado.
 * Usado nos selects (atividade, appointment, widget, configurações do workspace).
 */
export function useSelectableAnalysisPlaybooks(activityType?: AnalysisActivityType) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  return useQuery({
    queryKey: ["analysis-playbooks", "selectable", companyId, activityType ?? "all"],
    enabled: !!companyId,
    queryFn: async (): Promise<AnalysisPlaybook[]> => {
      const { data, error } = await (supabase.from("analysis_playbooks") as any)
        .select("*")
        .eq("company_id", companyId!)
        .eq("status", "active")
        .order("name", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as AnalysisPlaybook[];
      if (!activityType) return rows;
      return rows.filter((p) => (p.activity_types ?? []).includes(activityType));
    },
    staleTime: 60_000,
  });
}

/**
 * TODAS as análises da empresa (inclusive rascunhos e arquivadas).
 * Usado na tela de gerenciamento em /settings/company.
 */
export function useAllAnalysisPlaybooks() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  return useQuery({
    queryKey: ["analysis-playbooks", "all", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AnalysisPlaybook[]> => {
      const { data, error } = await (supabase.from("analysis_playbooks") as any)
        .select("*")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AnalysisPlaybook[];
    },
    staleTime: 30_000,
  });
}

export interface RubricVersionWithCriteria extends AnalysisRubricVersion {
  criteria: AnalysisRubricCriterion[];
}

/**
 * Versões de rubrica de uma análise, cada uma com seus critérios já agregados.
 * Ordenadas da mais recente para a mais antiga.
 */
export function useRubricVersions(playbookId: string | null | undefined) {
  return useQuery({
    queryKey: ["analysis-rubric-versions", playbookId],
    enabled: !!playbookId,
    queryFn: async (): Promise<RubricVersionWithCriteria[]> => {
      const { data: versions, error: versionsError } = await (
        supabase.from("analysis_rubric_versions") as any
      )
        .select("*")
        .eq("playbook_id", playbookId!)
        .order("version", { ascending: false });
      if (versionsError) throw versionsError;

      const versionRows = (versions ?? []) as AnalysisRubricVersion[];
      if (versionRows.length === 0) return [];

      const { data: criteria, error: criteriaError } = await (
        supabase.from("analysis_rubric_criteria") as any
      )
        .select("*")
        .in(
          "version_id",
          versionRows.map((v) => v.id),
        )
        .order("sort_order", { ascending: true });
      if (criteriaError) throw criteriaError;

      const criteriaRows = (criteria ?? []) as AnalysisRubricCriterion[];
      return versionRows.map((version) => ({
        ...version,
        criteria: criteriaRows.filter((c) => c.version_id === version.id),
      }));
    },
    staleTime: 30_000,
  });
}
