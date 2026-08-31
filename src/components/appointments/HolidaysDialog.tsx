import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Plus, Trash2, CalendarX } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceHolidays } from "@/hooks/useWorkspaceHolidays";

interface HolidaysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HolidaysDialog({ open, onOpenChange }: HolidaysDialogProps) {
  const { toast } = useToast();
  const { holidays, isLoading, addHoliday, removeHoliday, isAdding, isRemoving } = useWorkspaceHolidays();
  const [date, setDate] = useState<Date | undefined>();
  const [name, setName] = useState("");

  const handleAdd = async () => {
    if (!date || !name.trim()) {
      toast({ title: "Preencha data e nome", variant: "destructive" });
      return;
    }
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    try {
      await addHoliday({ date: dateStr, name: name.trim() });
      toast({ title: "Feriado adicionado" });
      setName("");
      setDate(undefined);
    } catch (e: any) {
      toast({
        title: "Erro ao adicionar feriado",
        description: e?.message?.includes("duplicate") ? "Já existe um feriado nesta data." : e?.message,
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeHoliday(id);
      toast({ title: "Feriado removido" });
    } catch (e: any) {
      toast({ title: "Erro ao remover", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5 text-primary" />
            Feriados e bloqueios
          </DialogTitle>
          <DialogDescription>
            Datas adicionadas aqui ficarão bloqueadas para novos agendamentos (manuais e via widget público).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="glass-card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Data</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      initialFocus
                      locale={ptBR}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  placeholder="Ex.: Natal"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                />
              </div>
            </div>
            <Button onClick={handleAdd} disabled={isAdding} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Adicionar feriado
            </Button>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
            ) : holidays.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum feriado cadastrado.
              </p>
            ) : (
              holidays.map((h) => {
                const [y, m, d] = h.date.split("-").map(Number);
                const display = format(new Date(y, m - 1, d), "dd/MM/yyyy (EEEE)", { locale: ptBR });
                return (
                  <div
                    key={h.id}
                    className="flex items-center justify-between glass-card p-3 rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{h.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{display}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(h.id)}
                      disabled={isRemoving}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
