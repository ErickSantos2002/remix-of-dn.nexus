import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CatalogOption {
  id: string;
  name: string;
}

interface MultiCatalogSelectProps {
  options: CatalogOption[];
  selected: CatalogOption[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

export function MultiCatalogSelect({
  options,
  selected,
  onToggle,
  onRemove,
  placeholder = "Selecione...",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Nenhuma opcao disponivel.",
  disabled,
}: MultiCatalogSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const filtered = useMemo(() => {
    const term = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!term) return options;
    return options.filter((o) =>
      o.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .includes(term)
    );
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "flex min-h-10 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-sm transition-colors hover:border-primary/40",
            disabled && "pointer-events-none opacity-60"
          )}
        >
          {selected.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              {item.name}
              <button
                type="button"
                aria-label={`Remover ${item.name}`}
                className="text-muted-foreground transition-colors hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            {selected.length === 0 ? placeholder : "+ adicionar"}
          </span>
          <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-7 border-0 bg-transparent px-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyMessage}</p>
          )}
          {filtered.map((option) => {
            const isSelected = selectedIds.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                  isSelected && "text-foreground"
                )}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    isSelected ? "text-primary opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{option.name}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
