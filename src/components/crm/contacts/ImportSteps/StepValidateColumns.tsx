import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepValidateColumnsProps {
  headers: string[];
  validateColumns: () => { valid: boolean; missingColumns: string[] };
  onBack: () => void;
  onNext: () => void;
}

const EXPECTED_COLUMNS = [
  { key: "nome", label: "Nome", required: true },
  { key: "telefone", label: "Telefone", required: true },
  { key: "email", label: "Email", required: false },
  { key: "empresa", label: "Empresa", required: false },
  { key: "cargo", label: "Cargo", required: false },
  { key: "posicao", label: "Posição", required: false },
  { key: "tamanho_empresa", label: "Tamanho Empresa", required: false },
  { key: "faturamento", label: "Faturamento", required: false },
  { key: "observacoes", label: "Observações", required: false },
  { key: "tags", label: "Tags", required: false },
];

export function StepValidateColumns({
  headers,
  validateColumns,
  onBack,
  onNext,
}: StepValidateColumnsProps) {
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    missingColumns: string[];
  } | null>(null);

  useEffect(() => {
    const result = validateColumns();
    setValidationResult(result);
  }, [validateColumns]);

  const isColumnPresent = (column: string) => {
    return headers.includes(column.toLowerCase());
  };

  const canProceed = validationResult?.valid ?? false;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium">Validação de colunas</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Verifique se as colunas do arquivo correspondem aos campos esperados
        </p>
      </div>

      {/* Validation status */}
      {validationResult && !validationResult.valid && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-destructive">Colunas obrigatórias ausentes</p>
              <p className="text-sm text-muted-foreground mt-1">
                As seguintes colunas são obrigatórias:{" "}
                <span className="font-medium">{validationResult.missingColumns.join(", ")}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {validationResult?.valid && (
        <div className="p-4 rounded-lg bg-success/10 border border-success/20">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-success mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-success">Colunas validadas</p>
              <p className="text-sm text-muted-foreground mt-1">
                Todas as colunas obrigatorias foram encontradas
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Column mapping table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Campo esperado</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Obrigatorio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {EXPECTED_COLUMNS.map((col) => {
              const present = isColumnPresent(col.key);
              return (
                <tr key={col.key} className={cn(!present && col.required && "bg-destructive/5")}>
                  <td className="px-4 py-3">{col.label}</td>
                  <td className="px-4 py-3">
                    {present ? (
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle className="h-4 w-4" />
                        Encontrado
                      </span>
                    ) : col.required ? (
                      <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="h-4 w-4" />
                        Ausente
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MinusCircle className="h-4 w-4" />
                        Ignorado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {col.required ? (
                      <span className="text-destructive">Sim</span>
                    ) : (
                      <span className="text-muted-foreground">Não</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Extra columns from file */}
      {headers.some((h) => !EXPECTED_COLUMNS.some((c) => c.key === h)) && (
        <div className="text-sm text-muted-foreground">
          <p className="font-medium mb-1">Colunas extras no arquivo (serão ignoradas):</p>
          <p>
            {headers
              .filter((h) => !EXPECTED_COLUMNS.some((c) => c.key === h))
              .join(", ")}
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Voltar
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
