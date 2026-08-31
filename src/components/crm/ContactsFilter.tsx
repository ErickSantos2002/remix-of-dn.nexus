import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Search, Filter, X, SlidersHorizontal, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useWorkspaceTags } from "@/hooks/useWorkspaceTags";
import type { ContactTag } from "@/types/tags";

export interface ContactFilters {
  search: string;
  source: "all" | "whatsapp" | "manual";
  hasConversation: "all" | "active" | "none";
  tags: string[];
  company: string;
  ddds: string[];
  createdFrom?: string; // yyyy-MM-dd
  createdTo?: string;   // yyyy-MM-dd
  sortBy: "name" | "created_at";
  sortOrder: "asc" | "desc";
  deletedStatus: "active" | "deleted" | "all";
  optedOut: "all" | "yes" | "no";
}

interface ContactsFilterProps {
  workspaceId: string | undefined;
  filters: ContactFilters;
  onFiltersChange: (filters: ContactFilters) => void;
  companies: string[];
  availableDdds: { ddd: string; count: number }[];
}

export const defaultFilters: ContactFilters = {
  search: "",
  source: "all",
  hasConversation: "all",
  tags: [],
  company: "",
  ddds: [],
  createdFrom: undefined,
  createdTo: undefined,
  sortBy: "name",
  sortOrder: "asc",
  deletedStatus: "active",
  optedOut: "all",
};

export function ContactsFilter({
  workspaceId,
  filters,
  onFiltersChange,
  companies,
  availableDdds,
}: ContactsFilterProps) {
  const { data: workspaceTags = [] } = useWorkspaceTags(workspaceId);
  const [isOpen, setIsOpen] = useState(false);

  const hasDateRange = !!(filters.createdFrom || filters.createdTo);
  const dateRangeInvalid = !!(
    filters.createdFrom &&
    filters.createdTo &&
    filters.createdTo < filters.createdFrom
  );

  const activeFilterCount = [
    filters.source !== "all",
    filters.hasConversation !== "all",
    filters.tags.length > 0,
    filters.company !== "",
    filters.ddds.length > 0,
    hasDateRange,
    filters.sortBy !== "name" || filters.sortOrder !== "asc",
    filters.deletedStatus !== "active",
    filters.optedOut !== "all",
  ].filter(Boolean).length;

  const [dddSearch, setDddSearch] = useState("");

  const handleReset = () => {
    onFiltersChange(defaultFilters);
  };

  const toggleTag = (tagName: string) => {
    const newTags = filters.tags.includes(tagName)
      ? filters.tags.filter((t) => t !== tagName)
      : [...filters.tags, tagName];
    onFiltersChange({ ...filters, tags: newTags });
  };

  const toggleDDD = (ddd: string) => {
    const newDdds = filters.ddds.includes(ddd)
      ? filters.ddds.filter((d) => d !== ddd)
      : [...filters.ddds, ddd];
    onFiltersChange({ ...filters, ddds: newDdds });
  };

  const filteredDdds = dddSearch
    ? availableDdds.filter((d) => d.ddd.includes(dddSearch.replace(/\D/g, "")))
    : availableDdds;

  return (
    <div className="flex flex-col gap-3">
      {/* Search + Filter Button Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            placeholder="Buscar por nome, email, telefone ou empresa..."
            className="pl-10"
          />
        </div>

        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="gap-2"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 !p-0 max-h-[min(calc(100vh-8rem),600px)] overflow-hidden flex flex-col"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            avoidCollisions
          >
            <ScrollArea className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Filtros</h4>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="h-auto px-2 py-1 text-xs text-muted-foreground"
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>

              {/* Source Filter */}
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Origem</label>
                <Select
                  value={filters.source}
                  onValueChange={(value: "all" | "whatsapp" | "manual") =>
                    onFiltersChange({ ...filters, source: value })
                  }
                >
                  <SelectTrigger className="bg-card">
                    <SelectValue placeholder="Todas origens" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    <SelectItem value="all">Todas origens</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Deleted Status Filter */}
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Status do contato</label>
                <Select
                  value={filters.deletedStatus}
                  onValueChange={(value: "active" | "deleted" | "all") =>
                    onFiltersChange({ ...filters, deletedStatus: value })
                  }
                >
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    <SelectItem value="active">Apenas ativos</SelectItem>
                    <SelectItem value="deleted">Apenas excluidos</SelectItem>
                    <SelectItem value="all">Todos (ativos e excluidos)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Opt-out Filter */}
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Aceita receber contato</label>
                <Select
                  value={filters.optedOut}
                  onValueChange={(value: "all" | "yes" | "no") =>
                    onFiltersChange({ ...filters, optedOut: value })
                  }
                >
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="yes">Apenas aceitam contato</SelectItem>
                    <SelectItem value="no">Apenas nao aceitam mais contato</SelectItem>
                  </SelectContent>
                </Select>
              </div>




              {/* Conversation Status Filter */}
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Conversa</label>
                <Select
                  value={filters.hasConversation}
                  onValueChange={(value: "all" | "active" | "none") =>
                    onFiltersChange({ ...filters, hasConversation: value })
                  }
                >
                  <SelectTrigger className="bg-card">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="active">Com conversa ativa</SelectItem>
                    <SelectItem value="none">Sem conversa</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Company Filter */}
              {companies.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Empresa</label>
                  <Select
                    value={filters.company}
                    onValueChange={(value) =>
                      onFiltersChange({ ...filters, company: value === "all" ? "" : value })
                    }
                  >
                    <SelectTrigger className="bg-card">
                      <SelectValue placeholder="Todas empresas" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="all">Todas empresas</SelectItem>
                      {companies.map((company) => (
                        <SelectItem key={company} value={company}>
                          {company}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Tags Filter */}
              {workspaceTags.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Tags</label>
                  <ScrollArea className="h-32 rounded-md border border-border p-2">
                    <div className="space-y-2">
                      {workspaceTags.map((tag) => (
                        <label
                          key={tag.name}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Checkbox
                            checked={filters.tags.includes(tag.name)}
                            onCheckedChange={() => toggleTag(tag.name)}
                          />
                          <span
                            className="inline-flex items-center gap-1.5 text-sm"
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            {tag.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* DDD Filter */}
              {availableDdds.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-muted-foreground">DDD</label>
                    {filters.ddds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onFiltersChange({ ...filters, ddds: [] })}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  {availableDdds.length > 12 && (
                    <Input
                      value={dddSearch}
                      onChange={(e) => setDddSearch(e.target.value)}
                      placeholder="Buscar DDD..."
                      className="h-8 text-sm"
                    />
                  )}
                  <ScrollArea className="h-32 rounded-md border border-border p-2">
                    <div className="space-y-2">
                      {filteredDdds.map(({ ddd, count }) => (
                        <label
                          key={ddd}
                          className="flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <Checkbox
                              checked={filters.ddds.includes(ddd)}
                              onCheckedChange={() => toggleDDD(ddd)}
                            />
                            <span className="text-sm font-mono">{ddd}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({count})
                          </span>
                        </label>
                      ))}
                      {filteredDdds.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          Nenhum DDD encontrado
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">Data de criação</label>
                  {hasDateRange && (
                    <button
                      type="button"
                      onClick={() =>
                        onFiltersChange({ ...filters, createdFrom: undefined, createdTo: undefined })
                      }
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal bg-card",
                          !filters.createdFrom && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.createdFrom
                          ? format(parseISO(filters.createdFrom), "dd/MM/yyyy", { locale: ptBR })
                          : "De"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-card border-border z-50" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.createdFrom ? parseISO(filters.createdFrom) : undefined}
                        onSelect={(date) =>
                          onFiltersChange({
                            ...filters,
                            createdFrom: date ? format(date, "yyyy-MM-dd") : undefined,
                          })
                        }
                        initialFocus
                        locale={ptBR}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal bg-card",
                          !filters.createdTo && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.createdTo
                          ? format(parseISO(filters.createdTo), "dd/MM/yyyy", { locale: ptBR })
                          : "Até"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-card border-border z-50" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.createdTo ? parseISO(filters.createdTo) : undefined}
                        onSelect={(date) =>
                          onFiltersChange({
                            ...filters,
                            createdTo: date ? format(date, "yyyy-MM-dd") : undefined,
                          })
                        }
                        initialFocus
                        locale={ptBR}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                {dateRangeInvalid && (
                  <p className="text-xs text-destructive">
                    A data final deve ser igual ou posterior à data inicial.
                  </p>
                )}
              </div>

              {/* Sort Options */}
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Ordenar por</label>
                <div className="flex gap-2">
                  <Select
                    value={filters.sortBy}
                    onValueChange={(value: "name" | "created_at") =>
                      onFiltersChange({ ...filters, sortBy: value })
                    }
                  >
                    <SelectTrigger className="bg-card flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="name">Nome</SelectItem>
                      <SelectItem value="created_at">Data de criacao</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={filters.sortOrder}
                    onValueChange={(value: "asc" | "desc") =>
                      onFiltersChange({ ...filters, sortOrder: value })
                    }
                  >
                    <SelectTrigger className="bg-card w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      <SelectItem value="asc">A-Z</SelectItem>
                      <SelectItem value="desc">Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Active Filters Display */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtros ativos:</span>

          {filters.deletedStatus !== "active" && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.deletedStatus === "deleted" ? "Apenas excluidos" : "Ativos e excluidos"}
              <button
                onClick={() => onFiltersChange({ ...filters, deletedStatus: "active" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.source !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.source === "whatsapp" ? "WhatsApp" : "Manual"}
              <button
                onClick={() => onFiltersChange({ ...filters, source: "all" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.optedOut !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.optedOut === "yes" ? "Aceita contato" : "Nao aceita contato"}
              <button
                onClick={() => onFiltersChange({ ...filters, optedOut: "all" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}



          {filters.hasConversation !== "all" && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.hasConversation === "active" ? "Com conversa" : "Sem conversa"}
              <button
                onClick={() => onFiltersChange({ ...filters, hasConversation: "all" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.company && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.company}
              <button
                onClick={() => onFiltersChange({ ...filters, company: "" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.tags.map((tag) => {
            const tagData = workspaceTags.find((t) => t.name === tag);
            return (
              <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tagData?.color || "#6B7280" }}
                />
                {tag}
                <button
                  onClick={() => toggleTag(tag)}
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}

          {filters.ddds.map((ddd) => (
            <Badge key={`ddd-${ddd}`} variant="secondary" className="gap-1 pr-1">
              <span className="font-mono text-xs">DDD {ddd}</span>
              <button
                onClick={() => toggleDDD(ddd)}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}

          {hasDateRange && (
            <Badge variant="secondary" className="gap-1 pr-1">
              <CalendarIcon className="h-3 w-3" />
              {filters.createdFrom
                ? format(parseISO(filters.createdFrom), "dd/MM/yyyy", { locale: ptBR })
                : "..."}
              {" – "}
              {filters.createdTo
                ? format(parseISO(filters.createdTo), "dd/MM/yyyy", { locale: ptBR })
                : "..."}
              <button
                onClick={() =>
                  onFiltersChange({ ...filters, createdFrom: undefined, createdTo: undefined })
                }
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {(filters.sortBy !== "name" || filters.sortOrder !== "asc") && (
            <Badge variant="secondary" className="gap-1 pr-1">
              {filters.sortBy === "name" ? "Nome" : "Data"} {filters.sortOrder === "asc" ? "A-Z" : "Z-A"}
              <button
                onClick={() => onFiltersChange({ ...filters, sortBy: "name", sortOrder: "asc" })}
                className="ml-1 hover:bg-muted rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
