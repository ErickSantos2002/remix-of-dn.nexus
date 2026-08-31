import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImportMethod } from "@/hooks/useContactsImport";

interface StepMethodProps {
  method: ImportMethod;
  onMethodChange: (method: ImportMethod) => void;
  onNext: () => void;
}

export function StepMethod({ method, onMethodChange, onNext }: StepMethodProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium">Escolha o método de importação</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Selecione como você deseja importar seus contatos
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* CSV Option */}
        <button
          onClick={() => onMethodChange("csv")}
          className={cn(
            "p-6 rounded-lg border-2 transition-all text-left",
            "hover:border-primary/50 hover:bg-accent/50",
            method === "csv"
              ? "border-primary bg-primary/10"
              : "border-border"
          )}
        >
          <FileSpreadsheet className={cn(
            "h-10 w-10 mb-3",
            method === "csv" ? "text-primary" : "text-muted-foreground"
          )} />
          <h4 className="font-medium">Arquivo CSV</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Importe contatos de um arquivo CSV
          </p>
        </button>

        {/* Google Sheets Option (disabled) */}
        <button
          disabled
          className={cn(
            "p-6 rounded-lg border-2 transition-all text-left opacity-50 cursor-not-allowed",
            "border-border"
          )}
        >
          <Sheet className="h-10 w-10 mb-3 text-muted-foreground" />
          <h4 className="font-medium">Google Sheets</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Em breve - Importe diretamente do Google Sheets
          </p>
        </button>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onNext} disabled={!method}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
