import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  Tag,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValidationResult, DuplicateAction } from "@/hooks/useContactsImport";

interface StepValidateDataProps {
  validationResult: ValidationResult | null;
  validateData: () => Promise<ValidationResult>;
  duplicateAction: DuplicateAction;
  onDuplicateActionChange: (action: DuplicateAction) => void;
  commonTag: string;
  onCommonTagChange: (tag: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepValidateData({
  validationResult,
  validateData,
  duplicateAction,
  onDuplicateActionChange,
  commonTag,
  onCommonTagChange,
  onBack,
  onNext,
}: StepValidateDataProps) {
  const [isValidating, setIsValidating] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [fileDuplicatesOpen, setFileDuplicatesOpen] = useState(false);

  useEffect(() => {
    if (!validationResult) {
      setIsValidating(true);
      validateData().finally(() => setIsValidating(false));
    }
  }, [validationResult, validateData]);

  if (isValidating || !validationResult) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Validando dados...</p>
      </div>
    );
  }

  const {
    validRows,
    errorRows,
    duplicatesInFile,
    duplicatesInDb,
    totalRows,
  } = validationResult;

  const canProceed = validRows.length > 0 || (duplicatesInDb.length > 0 && duplicateAction === "overwrite");

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium">Validação de dados</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Revise os dados antes de importar
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-muted/50 text-center">
          <p className="text-2xl font-bold">{totalRows}</p>
          <p className="text-xs text-muted-foreground">Total de linhas</p>
        </div>
        <div className="p-3 rounded-lg bg-success/10 text-center">
          <p className="text-2xl font-bold text-success">{validRows.length}</p>
          <p className="text-xs text-muted-foreground">Válidas</p>
        </div>
        <div className="p-3 rounded-lg bg-warning/10 text-center">
          <p className="text-2xl font-bold text-warning">{duplicatesInDb.length}</p>
          <p className="text-xs text-muted-foreground">Já existem</p>
        </div>
        <div className="p-3 rounded-lg bg-destructive/10 text-center">
          <p className="text-2xl font-bold text-destructive">
            {errorRows.length + duplicatesInFile.length}
          </p>
          <p className="text-xs text-muted-foreground">Com erro</p>
        </div>
      </div>

      {/* Error details */}
      {errorRows.length > 0 && (
        <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-destructive">
              <span className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                {errorRows.length} linha(s) com erro
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", errorsOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="h-32 rounded-lg border p-2">
              <div className="space-y-1 text-sm">
                {errorRows.map((error, i) => (
                  <p key={i} className="text-destructive">
                    Linha {error.row}: {error.message} ({error.field})
                  </p>
                ))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* File duplicates */}
      {duplicatesInFile.length > 0 && (
        <Collapsible open={fileDuplicatesOpen} onOpenChange={setFileDuplicatesOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-warning">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {duplicatesInFile.length} telefone(s) duplicado(s) no arquivo
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", fileDuplicatesOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="h-32 rounded-lg border p-2">
              <div className="space-y-1 text-sm">
                {duplicatesInFile.map((dup, i) => (
                  <p key={i} className="text-warning">
                    Linha {dup.row}: {dup.name} ({dup.phone}) - será ignorado
                  </p>
                ))}
              </div>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Database duplicates */}
      {duplicatesInDb.length > 0 && (
        <div className="space-y-3">
          <Collapsible open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-warning">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {duplicatesInDb.length} contato(s) já existem no sistema
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", duplicatesOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-32 rounded-lg border p-2">
                <div className="space-y-1 text-sm">
                  {duplicatesInDb.map((dup, i) => (
                    <p key={i} className="text-warning">
                      Linha {dup.row}: {dup.name} ({dup.phone})
                    </p>
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>

          {/* Duplicate action */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <Label className="text-sm font-medium">O que fazer com contatos duplicados?</Label>
            <RadioGroup
              value={duplicateAction}
              onValueChange={(v) => onDuplicateActionChange(v as DuplicateAction)}
              className="mt-3 space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="ignore" id="ignore" />
                <Label htmlFor="ignore" className="font-normal cursor-pointer">
                  Ignorar - manter os dados existentes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="overwrite" id="overwrite" />
                <Label htmlFor="overwrite" className="font-normal cursor-pointer">
                  Sobrescrever - atualizar com os dados da importação
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      )}

      {/* Common tag */}
      <div className="p-4 rounded-lg border bg-muted/30">
        <Label htmlFor="common-tag" className="text-sm font-medium flex items-center gap-2">
          <Tag className="h-4 w-4" />
          Adicionar tag a todos os contatos importados (opcional)
        </Label>
        <Input
          id="common-tag"
          value={commonTag}
          onChange={(e) => onCommonTagChange(e.target.value)}
          placeholder="Ex: Importação Fev 2026"
          className="mt-2"
        />
      </div>

      {/* Summary */}
      {canProceed && (
        <div className="p-4 rounded-lg bg-success/10 border border-success/20">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-success mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-success">Pronto para importar</p>
              <p className="text-sm text-muted-foreground mt-1">
                {validRows.length} contato(s) serão inseridos
                {duplicateAction === "overwrite" && duplicatesInDb.length > 0 && (
                  <>, {duplicatesInDb.length} serão atualizados</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {!canProceed && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-destructive">Não é possível importar</p>
              <p className="text-sm text-muted-foreground mt-1">
                Nenhum contato válido encontrado para importação
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Voltar
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Iniciar importação
        </Button>
      </div>
    </div>
  );
}
