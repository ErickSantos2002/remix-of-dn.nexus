import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const MIN_LEAD_MESSAGES = 10;

interface AnalyzeErrorBody {
  error?: string;
  message?: string;
  min_messages_required?: number;
  current_lead_messages?: number;
}

/**
 * Extrai o corpo estruturado do erro retornado pela edge function.
 * O supabase-js embrulha respostas 4xx em FunctionsHttpError, escondendo o body em `context`.
 */
async function parseFunctionError(error: unknown): Promise<AnalyzeErrorBody | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } })?.context;
  if (!ctx) return null;

  try {
    if (typeof ctx.json === "function") {
      return (await ctx.json()) as AnalyzeErrorBody;
    }
    if (typeof ctx.text === "function") {
      return JSON.parse(await ctx.text()) as AnalyzeErrorBody;
    }
  } catch {
    /* corpo nao e JSON — cai no fallback do chamador */
  }
  return null;
}

/**
 * Dispara a análise psicológica DNIA de um lead.
 *
 * Invalida as três query keys usadas pelas telas de DNIA (sheet do pipeline, modal do Inbox
 * e página completa) — sem isso, uma análise feita em uma tela deixa as outras desatualizadas.
 * Invalida também as queries do card, porque a análise pode mover o lead de estágio via
 * regras de auto-move.
 */
export function useAnalyzeLeadPsychology(leadId: string | undefined, workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!leadId || !workspaceId) {
        throw new Error("Lead ou workspace não identificado");
      }

      const response = await supabase.functions.invoke("analyze-lead-psychology", {
        body: { leadId, workspaceId },
      });

      if (response.error) {
        const body = await parseFunctionError(response.error);

        if (body?.min_messages_required !== undefined) {
          throw new Error(
            `Análise indisponível: o lead precisa de pelo menos ${body.min_messages_required} mensagens ` +
              `(atual: ${body.current_lead_messages ?? 0}). Aguarde mais interações para gerar o DNIA.`
          );
        }

        throw new Error(body?.message || body?.error || response.error.message);
      }

      return response.data;
    },
    onSuccess: () => {
      toast.success("Análise psicológica concluída");
      queryClient.invalidateQueries({ queryKey: ["lead-psychology", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-psychology-sheet", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-psychology-modal", leadId] });
      // A análise pode ter movido o lead de estágio (crm_automove_rules)
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail", leadId] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
