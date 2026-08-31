import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSelectableAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import type { AnalysisActivityType } from "@/types/analysis";

/** Sentinela do Select — Radix não aceita SelectItem com valor vazio. */
const NONE_VALUE = "__none__";

interface Props {
  /** Tipo da atividade; null oculta o campo (atividade sem transcrição). */
  activityType: AnalysisActivityType | null;
  value: string;
  onChange: (playbookId: string) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Seleciona qual análise de atendimento avalia a transcrição desta atividade.
 *
 * Some quando não há análise aplicável ao tipo — workspaces que não usam a
 * funcionalidade não veem o campo. Sem análise selecionada, a transcrição segue
 * o fluxo de análise genérica que já existia.
 */
export function AnalysisPlaybookSelect({
  activityType,
  value,
  onChange,
  label = "Análise de atendimento",
  description = "Avalia a transcrição contra o playbook e gera score para o vendedor.",
  disabled,
}: Props) {
  const { data: playbooks } = useSelectableAnalysisPlaybooks(activityType ?? undefined);

  if (!activityType) return null;
  if (!playbooks || playbooks.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value || NONE_VALUE}
        onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Não avaliar</SelectItem>
          {playbooks.map((playbook) => (
            <SelectItem key={playbook.id} value={playbook.id}>
              {playbook.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
