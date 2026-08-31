import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { ImportProgress } from "@/hooks/useContactsImport";

interface StepProgressProps {
  progress: ImportProgress;
  onStartImport: () => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

export function StepProgress({
  progress,
  onStartImport,
  onCancel,
  onClose,
}: StepProgressProps) {
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (!hasStarted && progress.total === 0) {
      setHasStarted(true);
      onStartImport();
    }
  }, [hasStarted, progress.total, onStartImport]);

  const percentage = progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  const isRunning = !progress.isComplete && !progress.isCancelled && progress.total > 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium">
          {progress.isComplete
            ? progress.isCancelled
              ? "Importação cancelada"
              : "Importação concluída"
            : "Importando contatos..."}
        </h3>
      </div>

      {/* Progress indicator */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Processando {progress.processed} de {progress.total}
          </span>
          <span className="font-medium">{percentage}%</span>
        </div>
        <Progress value={percentage} className="h-3" />
      </div>

      {/* Status icon */}
      <div className="flex justify-center py-4">
        {isRunning && (
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
        )}
        {progress.isComplete && !progress.isCancelled && (
          <CheckCircle className="h-16 w-16 text-success" />
        )}
        {progress.isCancelled && (
          <AlertTriangle className="h-16 w-16 text-warning" />
        )}
      </div>

      {/* Results summary */}
      {progress.isComplete && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-success/10 text-center">
            <p className="text-2xl font-bold text-success">{progress.inserted}</p>
            <p className="text-xs text-muted-foreground">Inseridos</p>
          </div>
          <div className="p-3 rounded-lg bg-primary/10 text-center">
            <p className="text-2xl font-bold text-primary">{progress.updated}</p>
            <p className="text-xs text-muted-foreground">Atualizados</p>
          </div>
          <div className="p-3 rounded-lg bg-warning/10 text-center">
            <p className="text-2xl font-bold text-warning">{progress.skipped}</p>
            <p className="text-xs text-muted-foreground">Ignorados</p>
          </div>
          <div className="p-3 rounded-lg bg-destructive/10 text-center">
            <p className="text-2xl font-bold text-destructive">{progress.errors}</p>
            <p className="text-xs text-muted-foreground">Erros</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-center pt-4">
        {isRunning ? (
          <Button variant="destructive" onClick={onCancel}>
            <XCircle className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        ) : (
          <Button onClick={onClose}>
            {progress.isComplete ? "Concluir" : "Fechar"}
          </Button>
        )}
      </div>
    </div>
  );
}
