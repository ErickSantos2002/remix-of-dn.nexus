import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, FileSpreadsheet, Filter, Loader2 } from "lucide-react";
import { useContactsExport } from "@/hooks/useContactsExport";
import type { ContactFilters } from "@/components/crm/ContactsFilter";

interface ExportContactsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string | undefined;
  hasActiveFilters: boolean;
  filters: ContactFilters;
}

export function ExportContactsDialog({
  isOpen,
  onClose,
  workspaceId,
  hasActiveFilters,
  filters,
}: ExportContactsDialogProps) {
  const { exportContacts, isExporting } = useContactsExport(workspaceId);
  const [exportOption, setExportOption] = useState<"filtered" | "all">("filtered");
  const hasExportedRef = useRef(false);

  const handleExport = async () => {
    if (hasActiveFilters) {
      await exportContacts({
        filters: exportOption === "filtered" ? filters : undefined,
        exportAll: exportOption === "all",
      });
    } else {
      await exportContacts({ exportAll: true });
    }
    onClose();
  };

  // If no active filters, export directly without showing the dialog
  useEffect(() => {
    if (!hasActiveFilters && isOpen && !hasExportedRef.current) {
      hasExportedRef.current = true;
      handleExport();
    }
    // Reset flag when dialog closes
    if (!isOpen) {
      hasExportedRef.current = false;
    }
  }, [isOpen, hasActiveFilters]);

  // Don't render dialog if no filters (export happens via useEffect)
  if (!hasActiveFilters) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Exportar Contatos
          </DialogTitle>
          <DialogDescription>
            Você possui filtros ativos. Escolha quais contatos deseja exportar.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup
            value={exportOption}
            onValueChange={(value) => setExportOption(value as "filtered" | "all")}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer">
              <RadioGroupItem value="filtered" id="filtered" className="mt-0.5" />
              <Label htmlFor="filtered" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2 font-medium">
                  <Filter className="h-4 w-4 text-primary" />
                  Exportar apenas filtrados
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Exporta somente os contatos que correspondem aos filtros aplicados
                </p>
              </Label>
            </div>

            <div className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer">
              <RadioGroupItem value="all" id="all" className="mt-0.5" />
              <Label htmlFor="all" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2 font-medium">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  Exportar todos os contatos
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Ignora os filtros e exporta todos os contatos do workspace
                </p>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
