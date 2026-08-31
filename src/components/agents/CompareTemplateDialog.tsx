import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitCompare, ArrowRight, Check, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CompareTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalPrompt: string;
  originalTone: string;
  currentPrompt: string;
  currentTone: string;
  templateName: string;
}

const toneLabels: Record<string, string> = {
  friendly: "Amigável",
  professional: "Profissional",
  aggressive: "Agressivo",
};

const CompareTemplateDialog = ({
  open,
  onOpenChange,
  originalPrompt,
  originalTone,
  currentPrompt,
  currentTone,
  templateName,
}: CompareTemplateDialogProps) => {
  const isPromptDifferent = originalPrompt !== currentPrompt;
  const isToneDifferent = originalTone !== currentTone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] glass-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <GitCompare className="h-5 w-5 text-primary" />
            Comparar com Original
          </DialogTitle>
          <DialogDescription>
            Compare as diferenças entre o template original e sua versão customizada.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 py-4">
            {/* Tone Comparison */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">Tom de Voz</span>
                {isToneDifferent ? (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Modificado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                    <Check className="h-3 w-3 mr-1" />
                    Igual ao Original
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-muted/50 border border-border">
                  <div className="text-xs text-muted-foreground mb-1">Original ({templateName})</div>
                  <span className="text-sm text-foreground font-medium">
                    {toneLabels[originalTone] || originalTone}
                  </span>
                </div>
                <div className={`p-3 rounded-xl border ${isToneDifferent ? 'bg-primary/5 border-primary/30' : 'bg-muted/50 border-border'}`}>
                  <div className="text-xs text-muted-foreground mb-1">Sua Versão</div>
                  <span className={`text-sm font-medium ${isToneDifferent ? 'text-primary' : 'text-foreground'}`}>
                    {toneLabels[currentTone] || currentTone}
                  </span>
                </div>
              </div>
            </div>

            {/* Prompt Comparison */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">System Prompt</span>
                {isPromptDifferent ? (
                  <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Modificado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                    <Check className="h-3 w-3 mr-1" />
                    Igual ao Original
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-muted/50 border border-border">
                  <div className="text-xs text-muted-foreground mb-2">Original ({templateName})</div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {originalPrompt || "Sem prompt definido."}
                  </p>
                </div>
                <div className={`p-3 rounded-xl border ${isPromptDifferent ? 'bg-primary/5 border-primary/30' : 'bg-muted/50 border-border'}`}>
                  <div className="text-xs text-muted-foreground mb-2">Sua Versão</div>
                  <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isPromptDifferent ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {currentPrompt || "Sem prompt definido."}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary */}
            {(isPromptDifferent || isToneDifferent) && (
              <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Campos Customizados</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {isPromptDifferent && <li>• System Prompt foi modificado</li>}
                      {isToneDifferent && <li>• Tom de Voz foi modificado</li>}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompareTemplateDialog;
