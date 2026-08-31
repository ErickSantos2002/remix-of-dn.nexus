import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, FileText, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface StepUploadProps {
  file: File | null;
  onFileSelect: (file: File) => Promise<boolean>;
  onDownloadTemplate: () => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepUpload({
  file,
  onFileSelect,
  onDownloadTemplate,
  onBack,
  onNext,
}: StepUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      toast({
        title: "Formato inválido",
        description: "Por favor, selecione um arquivo CSV",
        variant: "destructive",
      });
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "O arquivo deve ter no máximo 10MB",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    const success = await onFileSelect(selectedFile);
    setIsProcessing(false);

    if (!success) {
      // Error already handled by the hook
    }
  }, [onFileSelect, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFile(selectedFile);
    }
  }, [handleFile]);

  return (
    <div className="space-y-6">
      {/* Format info */}
      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-primary">Formato esperado do CSV</p>
            <ul className="mt-1 text-muted-foreground space-y-0.5">
              <li>Separador de colunas: ponto-e-virgula (;)</li>
              <li>Codificação: UTF-8</li>
              <li>Tags separadas por virgula na mesma celula</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Download template button */}
      <div className="flex justify-center">
        <Button variant="outline" onClick={onDownloadTemplate} className="gap-2">
          <Download className="h-4 w-4" />
          Baixar modelo CSV
        </Button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-all",
          isDragging && "border-primary bg-primary/10",
          !isDragging && !file && "border-border hover:border-primary/50",
          file && "border-success bg-success/10"
        )}
      >
        {isProcessing ? (
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm text-muted-foreground">Processando arquivo...</p>
          </div>
        ) : file ? (
          <div className="flex flex-col items-center gap-2">
            <FileText className="h-10 w-10 text-success" />
            <p className="font-medium">{file.name}</p>
            <p className="text-sm text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Reset by re-rendering with no file - handled by parent
                const input = document.getElementById("csv-input") as HTMLInputElement;
                if (input) input.value = "";
              }}
              className="text-destructive hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              Remover
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Arraste o arquivo CSV aqui</p>
            <p className="text-sm text-muted-foreground">ou</p>
            <label htmlFor="csv-input">
              <Button variant="outline" asChild>
                <span className="cursor-pointer">Selecionar arquivo</span>
              </Button>
            </label>
          </div>
        )}

        <input
          id="csv-input"
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Voltar
        </Button>
        <Button onClick={onNext} disabled={!file}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
