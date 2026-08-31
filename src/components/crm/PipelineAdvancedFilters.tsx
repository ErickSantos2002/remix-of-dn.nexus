import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Filter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AdvancedFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface PipelineAdvancedFilterValues {
  stages: string[];
  products: string[];
  assignees: string[];
  tags: string[];
  positions: string[];
  employeeCounts: string[];
  revenues: string[];
  sources: string[];
  optedOut: "all" | "yes" | "no";
}

interface PipelineAdvancedFiltersProps {
  values: PipelineAdvancedFilterValues;
  onChange: (next: PipelineAdvancedFilterValues) => void;
  options: {
    stages: AdvancedFilterOption[];
    products: AdvancedFilterOption[];
    assignees: AdvancedFilterOption[];
    tags: AdvancedFilterOption[];
    positions: AdvancedFilterOption[];
    employeeCounts: AdvancedFilterOption[];
    revenues: AdvancedFilterOption[];
    sources: AdvancedFilterOption[];
  };
}

type ArrayFilterKey =
  | "stages"
  | "products"
  | "assignees"
  | "tags"
  | "sources"
  | "positions"
  | "employeeCounts"
  | "revenues";

const SECTION_LABELS: Record<ArrayFilterKey, string> = {
  stages: "Etapa",
  products: "Produtos",
  assignees: "Vendedores",
  tags: "Tags",
  sources: "Origem",
  positions: "Cargo",
  employeeCounts: "Tamanho da empresa",
  revenues: "Faturamento",
};


function FilterSection({
  title,
  selected,
  options,
  onToggle,
  onClear,
  searchable,
}: {
  title: string;
  selected: string[];
  options: AdvancedFilterOption[];
  onToggle: (value: string) => void;
  onClear: () => void;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {title}
          {selected.length > 0 && (
            <span className="ml-1.5 text-muted-foreground font-normal">
              ({selected.length})
            </span>
          )}
        </label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {searchable && options.length > 8 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      )}

      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center">
          Sem dados disponíveis
        </p>
      ) : (
        <ScrollArea className="h-32 rounded-md border border-border bg-card/40 p-2">
          <div className="space-y-1.5">
            {filtered.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center justify-between gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Checkbox
                    checked={selected.includes(opt.value)}
                    onCheckedChange={() => onToggle(opt.value)}
                  />
                  <span className="text-xs text-foreground truncate">
                    {opt.label}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                  {opt.count}
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Nenhum resultado
              </p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function PipelineAdvancedFilters({
  values,
  onChange,
  options,
}: PipelineAdvancedFiltersProps) {
  const [open, setOpen] = useState(false);

  const activeCount =
    values.stages.length +
    values.products.length +
    values.assignees.length +
    values.tags.length +
    values.positions.length +
    values.employeeCounts.length +
    values.revenues.length +
    values.sources.length +
    (values.optedOut && values.optedOut !== "all" ? 1 : 0);

  const toggleIn = (key: ArrayFilterKey, value: string) => {
    const current = values[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...values, [key]: next });
  };

  const clearKey = (key: ArrayFilterKey) => {
    onChange({ ...values, [key]: [] });
  };

  const clearAll = () => {
    onChange({
      stages: [],
      products: [],
      assignees: [],
      tags: [],
      positions: [],
      employeeCounts: [],
      revenues: [],
      sources: [],
      optedOut: "all",
    });
  };


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-2 rounded-xl",
            activeCount > 0 && "border-primary/40 text-primary"
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Mais filtros
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="h-4 min-w-4 px-1 text-[10px] font-mono"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0 bg-card border-border z-50 flex flex-col max-h-[70vh]"
        align="end"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              Filtros avançados
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Refine pelos dados do contato
            </p>
          </div>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Limpar tudo
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
          <div className="p-4 space-y-5">
            {/* Opt-out (aceita contato) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">
                Aceita receber contato
              </label>
              <Select
                value={values.optedOut}
                onValueChange={(v: "all" | "yes" | "no") =>
                  onChange({ ...values, optedOut: v })
                }
              >
                <SelectTrigger className="h-8 text-xs bg-card/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="yes">Apenas aceitam contato</SelectItem>
                  <SelectItem value="no">Apenas nao aceitam mais contato</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(Object.keys(SECTION_LABELS) as ArrayFilterKey[]).map((key) => (
              <FilterSection
                key={key}
                title={SECTION_LABELS[key]}
                selected={values[key]}
                options={options[key]}
                onToggle={(v) => toggleIn(key, v)}
                onClear={() => clearKey(key)}
                searchable={key === "positions" || key === "tags" || key === "products" || key === "assignees"}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
