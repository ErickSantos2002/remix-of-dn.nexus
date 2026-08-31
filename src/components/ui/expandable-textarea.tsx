import * as React from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ExpandableTextareaProps {
  id?: string;
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  minHeight?: string;
  modalTitle?: string;
  className?: string;
}

const ExpandableTextarea = React.forwardRef<HTMLTextAreaElement, ExpandableTextareaProps>(
  ({ id, label, placeholder, value, onChange, description, minHeight = "120px", modalTitle, className }, ref) => {
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [tempValue, setTempValue] = React.useState(value);

    const handleOpenModal = () => {
      setTempValue(value);
      setIsModalOpen(true);
    };

    const handleConfirm = () => {
      onChange(tempValue);
      setIsModalOpen(false);
    };

    const handleCancel = () => {
      setTempValue(value);
      setIsModalOpen(false);
    };

    return (
      <div className={cn("space-y-2", className)}>
        {label && <Label htmlFor={id}>{label}</Label>}
        
        <div className="relative">
          <Textarea
            id={id}
            ref={ref}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-secondary border-border rounded-xl resize-none pr-10"
            style={{ minHeight }}
          />
          <button
            type="button"
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleOpenModal}
            title="Expandir"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-4xl glass-card border-border">
            <DialogHeader>
              <DialogTitle>{modalTitle || label || "Editar Texto"}</DialogTitle>
            </DialogHeader>
            
            <div className="py-4">
              <Textarea
                placeholder={placeholder}
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="min-h-[400px] bg-secondary border-border rounded-xl resize-y"
              />
            </div>
            
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleCancel} className="rounded-xl">
                Cancelar
              </Button>
              <Button onClick={handleConfirm} className="rounded-xl">
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
);

ExpandableTextarea.displayName = "ExpandableTextarea";

export { ExpandableTextarea };
