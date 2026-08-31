import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Upload, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContactsImport } from "@/hooks/useContactsImport";
import { StepMethod } from "./ImportSteps/StepMethod";
import { StepUpload } from "./ImportSteps/StepUpload";
import { StepValidateColumns } from "./ImportSteps/StepValidateColumns";
import { StepValidateData } from "./ImportSteps/StepValidateData";
import { StepProgress } from "./ImportSteps/StepProgress";

interface ImportContactsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string | undefined;
}

const STEP_LABELS = ["Método", "Upload", "Colunas", "Dados", "Importar"];

export function ImportContactsDialog({
  isOpen,
  onClose,
  workspaceId,
}: ImportContactsDialogProps) {
  const importHook = useContactsImport(workspaceId);
  const { state, reset } = importHook;

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  const handleClose = () => {
    if (state.step === 5 && !state.importProgress.isComplete) {
      // Don't allow closing during import
      return;
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header with progress */}
        <div className="flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Upload className="h-6 w-6 text-primary" />
              Importar Contatos
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Passo {state.step} de 5</span>
              <span className="text-primary font-medium">{STEP_LABELS[state.step - 1]}</span>
            </div>
            <Progress value={(state.step / 5) * 100} className="h-2" />
          </div>

          {/* Step Indicators */}
          <div className="flex items-center justify-between mt-4 px-2">
            {STEP_LABELS.map((label, index) => (
              <div
                key={index}
                className={cn(
                  "flex flex-col items-center gap-1",
                  index + 1 <= state.step ? "text-primary" : "text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                    index + 1 < state.step && "bg-primary text-primary-foreground",
                    index + 1 === state.step && "bg-primary/20 text-primary border-2 border-primary",
                    index + 1 > state.step && "bg-muted text-muted-foreground"
                  )}
                >
                  {index + 1 < state.step ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="text-[10px] hidden sm:block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto py-4 min-h-[300px]">
          {state.step === 1 && (
            <StepMethod
              method={state.method}
              onMethodChange={importHook.setMethod}
              onNext={() => importHook.setStep(2)}
            />
          )}

          {state.step === 2 && (
            <StepUpload
              file={state.file}
              onFileSelect={importHook.parseCSVFile}
              onDownloadTemplate={importHook.downloadTemplate}
              onBack={() => importHook.setStep(1)}
              onNext={() => importHook.setStep(3)}
            />
          )}

          {state.step === 3 && (
            <StepValidateColumns
              headers={state.headers}
              validateColumns={importHook.validateColumns}
              onBack={() => importHook.setStep(2)}
              onNext={() => importHook.setStep(4)}
            />
          )}

          {state.step === 4 && (
            <StepValidateData
              validationResult={state.validationResult}
              validateData={importHook.validateData}
              duplicateAction={state.duplicateAction}
              onDuplicateActionChange={importHook.setDuplicateAction}
              commonTag={state.commonTag}
              onCommonTagChange={importHook.setCommonTag}
              onBack={() => importHook.setStep(3)}
              onNext={() => importHook.setStep(5)}
            />
          )}

          {state.step === 5 && (
            <StepProgress
              progress={state.importProgress}
              onStartImport={importHook.startImport}
              onCancel={importHook.cancelImport}
              onClose={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
