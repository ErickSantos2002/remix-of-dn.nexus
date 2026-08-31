import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import type { PeriodFilter, CustomDateRange } from "./useAnalyticsData";
import type {
  ActivityAnalysisResult,
  SellerAchievement,
  SellerDevelopmentPoint,
  SellerScorePoint,
} from "@/types/analysis";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PerformanceSummary {
  results: ActivityAnalysisResult[];
  scoreSeries: SellerScorePoint[];
  averageScore: number | null;
  /** Diferença entre a média da segunda e da primeira metade do período, em pontos. */
  trend: number;
  analysesCount: number;
  /** Pontos cujo estado atual foi determinado dentro do período selecionado. */
  openPoints: SellerDevelopmentPoint[];
  recurrentPoints: SellerDevelopmentPoint[];
  correctedPoints: SellerDevelopmentPoint[];
  achievements: SellerAchievement[];
}

/**
 * Qual data situa o ponto no tempo depende do estado dele: um ponto corrigido
 * pertence ao período em que foi corrigido; um aberto ou recorrente, ao período
 * da última falha. Comparar `first_seen_at` esconderia do gestor uma falha que
 * voltou ontem só porque começou há três meses.
 */
function pointDate(point: SellerDevelopmentPoint): string | null {
  return point.status === "corrected" ? point.corrected_at : point.last_seen_at;
}

function periodStart(period: PeriodFilter, customRange?: CustomDateRange): Date {
  const now = new Date();
  if (period === "custom" && customRange?.from) return new Date(customRange.from);
  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return start;
}

function periodEnd(period: PeriodFilter, customRange?: CustomDateRange): Date {
  if (period === "custom" && customRange?.to) {
    const end = new Date(customRange.to);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Média por dia (yyyy-MM-dd), em ordem cronológica. */
function buildScoreSeries(results: ActivityAnalysisResult[]): SellerScorePoint[] {
  const byDay = new Map<string, { total: number; count: number }>();

  for (const result of results) {
    if (result.score === null || result.score === undefined) continue;
    const day = result.occurred_at.slice(0, 10);
    const current = byDay.get(day) ?? { total: 0, count: 0 };
    current.total += result.score;
    current.count += 1;
    byDay.set(day, current);
  }

  return [...byDay.entries()]
    .map(([date, { total, count }]) => ({ date, score: Math.round(total / count), count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Tendência = média da segunda metade menos a da primeira metade do período.
 * Em pontos de score (não percentual) — é a leitura que o vendedor espera.
 */
function computeTrend(results: ActivityAnalysisResult[]): number {
  const scored = results
    .filter((r) => r.score !== null && r.score !== undefined)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (scored.length < 2) return 0;

  const middle = Math.floor(scored.length / 2);
  const average = (items: ActivityAnalysisResult[]) =>
    items.reduce((sum, item) => sum + (item.score ?? 0), 0) / items.length;

  const first = average(scored.slice(0, middle));
  const second = average(scored.slice(middle));
  return Math.round(second - first);
}

/**
 * Dados de desempenho de um vendedor. Sem `sellerId`, usa o usuário logado.
 *
 * A RLS já garante que um member só enxerga os próprios resultados — o filtro
 * por seller_id aqui é para a visão individual do gestor.
 */
export function usePerformanceData(
  period: PeriodFilter,
  customRange?: CustomDateRange,
  sellerId?: string | null,
  playbookId?: string | null,
) {
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const range = useMemo(() => {
    const start = periodStart(period, customRange);
    const end = periodEnd(period, customRange);
    return { start: start.toISOString(), end: end.toISOString() };
    // Depende das datas em string, nao do objeto: um novo customRange a cada
    // render recalcularia o range e reexecutaria a query em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customRange?.from, customRange?.to]);

  return useQuery({
    queryKey: ["performance-data", companyId, workspaceId, sellerId ?? "me", playbookId ?? "all", range.start, range.end],
    enabled: !!companyId,
    queryFn: async (): Promise<PerformanceSummary> => {
      const { data: userData } = await supabase.auth.getUser();
      const targetSellerId = sellerId ?? userData.user?.id ?? null;

      let resultsQuery = (supabase.from("activity_analysis_results") as any)
        .select("*")
        .eq("company_id", companyId!)
        .eq("status", "done")
        // Período se refere a quando o atendimento aconteceu, não a quando a IA
        // avaliou — avaliar em lote um período passado não pode empilhar tudo hoje
        .gte("occurred_at", range.start)
        .lte("occurred_at", range.end)
        .order("occurred_at", { ascending: false });

      if (targetSellerId) resultsQuery = resultsQuery.eq("seller_id", targetSellerId);
      if (playbookId) resultsQuery = resultsQuery.eq("playbook_id", playbookId);

      const { data: resultRows, error: resultsError } = await resultsQuery;
      if (resultsError) throw resultsError;
      const results = (resultRows ?? []) as ActivityAnalysisResult[];

      let pointsQuery = (supabase.from("seller_development_points") as any)
        .select("*")
        .eq("company_id", companyId!)
        .order("last_seen_at", { ascending: false });
      if (targetSellerId) pointsQuery = pointsQuery.eq("seller_id", targetSellerId);

      const { data: pointRows, error: pointsError } = await pointsQuery;
      if (pointsError) throw pointsError;
      const points = (pointRows ?? []) as SellerDevelopmentPoint[];

      let achievementsQuery = (supabase.from("seller_achievements") as any)
        .select("*")
        .eq("company_id", companyId!)
        .order("earned_at", { ascending: false });
      if (targetSellerId) achievementsQuery = achievementsQuery.eq("seller_id", targetSellerId);

      const { data: achievementRows } = await achievementsQuery;

      // Desconsideradas continuam na lista (auditáveis) mas fora de toda métrica.
      // Os pontos de desenvolvimento que elas geraram já foram removidos pelo
      // replay disparado no descarte — aqui não há o que filtrar.
      const counted = results.filter((r) => !r.disregarded_at);
      const scored = counted.filter((r) => r.score !== null && r.score !== undefined);
      const averageScore =
        scored.length > 0
          ? Math.round(scored.reduce((sum, r) => sum + (r.score ?? 0), 0) / scored.length)
          : null;

      // Comparação numérica: o Postgres devolve o timestamp com offset (+00:00)
      // e o range vem de toISOString() (Z) — comparar as strings erraria no limite
      const startMs = Date.parse(range.start);
      const endMs = Date.parse(range.end);
      const inPeriod = (point: SellerDevelopmentPoint) => {
        const iso = pointDate(point);
        if (!iso) return false;
        const at = Date.parse(iso);
        return at >= startMs && at <= endMs;
      };
      const periodPoints = points.filter(inPeriod);

      return {
        results,
        scoreSeries: buildScoreSeries(counted),
        averageScore,
        trend: computeTrend(counted),
        analysesCount: counted.length,
        openPoints: periodPoints.filter((p) => p.status === "open"),
        recurrentPoints: periodPoints.filter((p) => p.status === "recurrent"),
        correctedPoints: periodPoints.filter((p) => p.status === "corrected"),
        achievements: (achievementRows ?? []) as SellerAchievement[],
      };
    },
    staleTime: 30_000,
  });
}

/** Resultado de análise vinculado a uma atividade — usado para abrir o modal do card. */
export function useActivityAnalysisResult(activityId: string | null | undefined) {
  return useQuery({
    queryKey: ["analysis-result", "activity", activityId],
    enabled: !!activityId,
    queryFn: async (): Promise<ActivityAnalysisResult | null> => {
      const { data, error } = await (supabase.from("activity_analysis_results") as any)
        .select("*")
        .eq("activity_id", activityId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as ActivityAnalysisResult) ?? null;
    },
    staleTime: 30_000,
  });
}

/**
 * Scores das avaliacoes de varias atividades de uma vez.
 *
 * Em lote de proposito: a lista de atividades do card renderiza N itens, e uma
 * query por item seria N+1 requisicoes para exibir um badge.
 */
export function useActivityAnalysisScores(activityIds: string[]) {
  const key = [...activityIds].sort().join(",");

  return useQuery({
    queryKey: ["analysis-result", "scores", key],
    enabled: activityIds.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await (supabase.from("activity_analysis_results") as any)
        .select("activity_id, score, created_at")
        .in("activity_id", activityIds)
        .eq("status", "done")
        // Descartada não exibe score: manter o badge contradiria o descarte e
        // levaria o vendedor a discutir uma nota que a gestão já invalidou
        .is("disregarded_at", null)
        .not("score", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // A ordem decrescente garante que o primeiro de cada atividade e o mais recente
      const byActivity = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ activity_id: string; score: number }>) {
        if (row.activity_id && !byActivity.has(row.activity_id)) {
          byActivity.set(row.activity_id, row.score);
        }
      }
      return byActivity;
    },
    staleTime: 30_000,
  });
}

/**
 * Uma avaliação específica pelo id.
 *
 * Existe para abrir o detalhe fora do painel do vendedor — a aba Operação lista
 * atendimentos de todo mundo e não carrega os resultados completos.
 */
export function useAnalysisResultById(resultId: string | null) {
  return useQuery({
    queryKey: ["analysis-result", "by-id", resultId],
    enabled: !!resultId,
    queryFn: async (): Promise<ActivityAnalysisResult | null> => {
      const { data, error } = await (supabase.from("activity_analysis_results") as any)
        .select("*")
        .eq("id", resultId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ActivityAnalysisResult) ?? null;
    },
    staleTime: 30_000,
  });
}

export interface AnalysisLeadContext {
  leadId: string;
  leadTitle: string | null;
  contactName: string | null;
  companyName: string | null;
}

/**
 * Empresa e contato do card avaliado.
 *
 * O resultado guarda só o lead_id; o painel de Desempenho é acessado longe do
 * pipeline, então sem esses dados o avaliador não sabe de qual atendimento se
 * trata.
 *
 * Em lote (`useAnalysisLeadContexts`) para a lista de avaliações — uma consulta
 * por linha seria N+1 só para escrever o título do card. A versão singular
 * serve ao modal, que abre um resultado por vez.
 */
export function useAnalysisLeadContexts(leadIds: Array<string | null>) {
  const unique = [...new Set(leadIds.filter(Boolean))] as string[];
  const key = [...unique].sort().join(",");

  return useQuery({
    queryKey: ["analysis-result", "lead-contexts", key],
    enabled: unique.length > 0,
    queryFn: async (): Promise<Map<string, AnalysisLeadContext>> => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, title, crm_contacts(name, company)")
        .in("id", unique);
      if (error) throw error;

      const byLead = new Map<string, AnalysisLeadContext>();
      for (const row of data ?? []) {
        const contact = row.crm_contacts as { name?: string; company?: string } | null;
        byLead.set(row.id as string, {
          leadId: row.id as string,
          leadTitle: (row.title as string) ?? null,
          contactName: contact?.name ?? null,
          companyName: contact?.company ?? null,
        });
      }
      return byLead;
    },
    staleTime: 60_000,
  });
}

export function useAnalysisLeadContext(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["analysis-result", "lead-context", leadId],
    enabled: !!leadId,
    queryFn: async (): Promise<AnalysisLeadContext | null> => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, title, crm_contacts(name, company)")
        .eq("id", leadId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const contact = data.crm_contacts as { name?: string; company?: string } | null;
      return {
        leadId: data.id as string,
        leadTitle: (data.title as string) ?? null,
        contactName: contact?.name ?? null,
        companyName: contact?.company ?? null,
      };
    },
    staleTime: 60_000,
  });
}

/**
 * Marca ou desmarca uma avaliação como desconsiderada.
 *
 * Passa por RPC porque a tabela não tem policy de UPDATE para usuários: score e
 * veredictos são gravados apenas pelo service role. A função confere o papel de
 * admin e altera só os campos de descarte.
 *
 * Descartar não é só ocultar: os pontos de desenvolvimento e as conquistas que a
 * avaliação gerou precisam sumir junto. Como a máquina de estados é sequencial e
 * não permite subtrair um elo do meio, a segunda chamada reconstrói a memória do
 * vendedor a partir das avaliações que restaram.
 */
export function useDisregardAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      resultId,
      disregarded,
      companyId,
      sellerId,
    }: {
      resultId: string;
      disregarded: boolean;
      companyId: string;
      sellerId: string | null;
    }) => {
      const { error } = await (supabase.rpc as any)("set_analysis_result_disregarded", {
        p_result_id: resultId,
        p_disregarded: disregarded,
      });
      if (error) throw error;

      // Sem vendedor não há memória a refazer (avaliação órfã)
      if (!sellerId) return;

      const { data, error: rebuildError } = await supabase.functions.invoke(
        "analyze-transcript-playbook",
        { body: { action: "rebuild-points", company_id: companyId, seller_id: sellerId } },
      );
      if (rebuildError) throw rebuildError;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["performance-data"] });
      queryClient.invalidateQueries({ queryKey: ["team-performance"] });
      queryClient.invalidateQueries({ queryKey: ["analysis-result"] });
      queryClient.invalidateQueries({ queryKey: ["activities-operations"] });
    },
  });
}
