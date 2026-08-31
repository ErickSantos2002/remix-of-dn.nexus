import { useMemo, useState } from "react";
import { Check, ChevronDown, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface Attendant {
  id: string;
  name: string;
  email: string;
}

interface Props {
  options: Attendant[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export default function AttendantPicker({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);

  // Empty selected = "all attendants" (backend default)
  const isAll = selected.length === 0;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedAttendants = useMemo(
    () => (isAll ? options : options.filter((o) => selectedSet.has(o.id))),
    [isAll, options, selectedSet]
  );
  const previewAvatars = selectedAttendants.slice(0, 3);
  const extraCount = Math.max(0, selectedAttendants.length - previewAvatars.length);

  const toggle = (id: string) => {
    if (isAll) {
      // Switch from "all" to explicit selection minus this one
      onChange(options.filter((o) => o.id !== id).map((o) => o.id));
      return;
    }
    const has = selectedSet.has(id);
    const next = has ? selected.filter((s) => s !== id) : [...selected, id];
    // If user re-selects everyone, collapse to "all" (empty array)
    onChange(next.length === options.length ? [] : next);
  };

  const summary = isAll
    ? `Todos os atendentes (${options.length})`
    : selectedAttendants.length === 0
      ? "Nenhum atendente"
      : `${selectedAttendants.length} de ${options.length} atendentes`;

  if (options.length === 0) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="ml-11 mt-1 text-xs text-muted-foreground bg-card/40 rounded-lg px-3 py-2 border border-dashed border-border/60"
      >
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Nenhum atendente com calendário configurado.
        </span>
        <span className="block mt-0.5 text-[10px]">
          Configure em <span className="text-foreground">CRM › Configurações › Calendário dos Agentes</span>.
        </span>
      </div>
    );
  }

  return (
    <div className="ml-11 mt-1" onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full justify-between gap-2 bg-card/50 hover:bg-card border-border/60"
          >
            <span className="flex items-center gap-2 min-w-0">
              <div className="flex -space-x-1.5">
                {previewAvatars.map((a) => (
                  <Avatar
                    key={a.id}
                    className="h-5 w-5 ring-2 ring-background"
                  >
                    <AvatarFallback className="text-[9px] bg-primary/15 text-primary font-medium">
                      {initials(a.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {extraCount > 0 && (
                  <div className="h-5 w-5 rounded-full bg-muted text-muted-foreground text-[9px] font-medium flex items-center justify-center ring-2 ring-background">
                    +{extraCount}
                  </div>
                )}
              </div>
              <span className="text-xs text-foreground truncate">{summary}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[320px]"
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <Command>
            <CommandInput placeholder="Buscar atendente..." className="h-9" />
            <CommandList>
              <CommandEmpty>Nenhum atendente encontrado.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => onChange([])}
                  className="cursor-pointer"
                >
                  <div className="flex h-4 w-4 items-center justify-center mr-2">
                    {isAll && <Check className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <Users className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <span className="flex-1 text-sm">Todos os atendentes</span>
                  <span className="text-[10px] text-muted-foreground">{options.length}</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Atendentes">
                {options.map((att) => {
                  const checked = isAll || selectedSet.has(att.id);
                  return (
                    <CommandItem
                      key={att.id}
                      value={`${att.name} ${att.email}`}
                      onSelect={() => toggle(att.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex h-4 w-4 items-center justify-center mr-2">
                        {checked && !isAll && <Check className="h-3.5 w-3.5 text-primary" />}
                        {isAll && <Check className="h-3.5 w-3.5 text-muted-foreground/40" />}
                      </div>
                      <Avatar className="h-6 w-6 mr-2">
                        <AvatarFallback className="text-[10px] bg-primary/15 text-primary font-medium">
                          {initials(att.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground truncate">{att.name}</div>
                        {att.email && (
                          <div className="text-[10px] text-muted-foreground truncate">{att.email}</div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Chips of explicitly selected attendants (only when not 'all') */}
      {!isAll && selectedAttendants.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedAttendants.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] text-foreground"
            >
              <Avatar className="h-4 w-4">
                <AvatarFallback className="text-[8px] bg-primary/20 text-primary">
                  {initials(a.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[140px]">{a.name}</span>
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className="hover:bg-primary/20 rounded-full p-0.5"
                aria-label={`Remover ${a.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
