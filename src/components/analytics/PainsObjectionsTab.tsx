import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  Filter,
  Download,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Users,
  ListChecks,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";
import {
  usePainsObjectionsReport,
  applyPainsObjectionsFilters,
  CatalogKind,
  PainsObjectionsFilters,
  PainObjectionRow,
  FilterOption,
} from "@/hooks/usePainsObjectionsReport";

const LABELS: Record<CatalogKind, { singular: string; plural: string; column: string; empty: string }> = {
  pains: {
    singular: "Dor",
    plural: "Dores",
    column: "Dor",
    empty: "Nenhuma dor registrada no período com os filtros atuais.",
  },
  objections: {
    singular: "Objeção",
    plural: "Objeções",
    column: "Objeção",
    empty: "Nenhuma objeção registrada no período com os filtros atuais.",
  },
};

const STATUS_LABELS: Record<string, string> = {
  open: "Em andamento",
  won: "Ganho",
  lost: "Perda",
};

type SortKey = "company" | "leadName" | "itemName" | "assigneeName" | "stageName" | "status";
const PAGE_SIZE = 25;

function MultiFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-2 rounded-lg text-xs bg-secondary border-border",
            selected.length > 0 && "border-primary/40 text-primary",
          )}
        >
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-mono">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-3 bg-popover border-border z-50" align="start">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
        {options.length > 8 && (
          <div className="relative mb-2">
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
          <p className="text-xs text-muted-foreground py-2 text-center">Sem dados disponíveis</p>
        ) : (
          <ScrollArea className="h-40 pr-2">
            <div className="space-y-1.5">
              {filtered.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center justify-between gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={selected.includes(opt.value)}
                      onCheckedChange={() => toggle(opt.value)}
                    />
                    <span className="text-xs text-foreground truncate">{opt.label}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono shrink-0">{opt.count}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Nenhum resultado</p>
              )}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

function KpiCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">{icon}</div>
      </div>
      <div className="text-2xl font-bold font-display text-foreground truncate" title={String(value)}>
        {value}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{description}</p>
    </div>
  );
}

const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground">{item.name}</p>
      <p className="text-xs text-muted-foreground">
        {item.value} registro{item.value === 1 ? "" : "s"} · {item.pct}%
      </p>
    </div>
  );
};

interface PainsObjectionsTabProps {
  kind: CatalogKind;
  period: PeriodFilter;
  customRange?: CustomDateRange;
}

export function PainsObjectionsTab({ kind, period, customRange }: PainsObjectionsTabProps) {
  const navigate = useNavigate();
  const labels = LABELS[kind];
  const { rows, isLoading, availableFilters } = usePainsObjectionsReport(kind, period, customRange);

  const [filters, setFilters] = useState<PainsObjectionsFilters>({
    stages: [],
    status: "all",
    assignees: [],
  });
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "itemName",
    dir: "asc",
  });
  const [page, setPage] = useState(0);

  const filteredRows = useMemo(
    () => applyPainsObjectionsFilters(rows, filters),
    [rows, filters],
  );

  const chartData = useMemo(() => {
    const map = new Map<string, { id: string; name: string; value: number }>();
    filteredRows.forEach((r) => {
      const existing = map.get(r.itemId);
      if (existing) existing.value++;
      else map.set(r.itemId, { id: r.itemId, name: r.itemName, value: 1 });
    });
    const total = filteredRows.length || 1;
    return [...map.values()]
      .sort((a, b) => b.value - a.value)
      .map((d) => ({ ...d, pct: Math.round((d.value / total) * 100) }));
  }, [filteredRows]);

  const tableRows = useMemo(() => {
    let out = filteredRows;
    if (selectedItem) out = out.filter((r) => r.itemId === selectedItem);
    if (search.trim()) {
      const q = search
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const norm = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      out = out.filter(
        (r) =>
          norm(r.company).includes(q) ||
          norm(r.leadName).includes(q) ||
          norm(r.itemName).includes(q) ||
          norm(r.assigneeName).includes(q) ||
          norm(r.stageName).includes(q),
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = sort.key === "status" ? STATUS_LABELS[a.status] : a[sort.key];
      const bv = sort.key === "status" ? STATUS_LABELS[b.status] : b[sort.key];
      return String(av).localeCompare(String(bv), "pt-BR") * dir;
    });
  }, [filteredRows, selectedItem, search, sort]);

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = tableRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const uniqueLeads = useMemo(
    () => new Set(filteredRows.map((r) => r.leadId)).size,
    [filteredRows],
  );

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(0);
  };

  const activeChips: { label: string; onRemove: () => void }[] = [
    ...filters.stages.map((id) => ({
      label: `Etapa: ${availableFilters.stages.find((s) => s.value === id)?.label ?? id}`,
      onRemove: () => setFilters((f) => ({ ...f, stages: f.stages.filter((v) => v !== id) })),
    })),
    ...filters.assignees.map((id) => ({
      label: `Responsável: ${availableFilters.assignees.find((s) => s.value === id)?.label ?? id}`,
      onRemove: () => setFilters((f) => ({ ...f, assignees: f.assignees.filter((v) => v !== id) })),
    })),
    ...(filters.status !== "all"
      ? [
          {
            label: `Status: ${STATUS_LABELS[filters.status]}`,
            onRemove: () => setFilters((f) => ({ ...f, status: "all" as const })),
          },
        ]
      : []),
    ...(selectedItem
      ? [
          {
            label: `${labels.column}: ${chartData.find((c) => c.id === selectedItem)?.name ?? ""}`,
            onRemove: () => setSelectedItem(null),
          },
        ]
      : []),
  ];

  const exportCsv = () => {
    const header = ["Empresa", "Nome do lead", labels.column, "Responsável", "Etapa", "Status"];
    const lines = tableRows.map((r) =>
      [r.company, r.leadName, r.itemName, r.assigneeName, r.stageName, STATUS_LABELS[r.status]]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const csv = "\uFEFF" + [header.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <TableHead>
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
        {sort.key === sortKey ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <MultiFilter
          label="Etapa"
          options={availableFilters.stages}
          selected={filters.stages}
          onChange={(stages) => {
            setFilters((f) => ({ ...f, stages }));
            setPage(0);
          }}
        />
        <Select
          value={filters.status}
          onValueChange={(v) => {
            setFilters((f) => ({ ...f, status: v as PainsObjectionsFilters["status"] }));
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs bg-secondary border-border rounded-lg">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border z-50">
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="open">Em andamento</SelectItem>
            <SelectItem value="won">Ganho</SelectItem>
            <SelectItem value="lost">Perda</SelectItem>
          </SelectContent>
        </Select>
        <MultiFilter
          label="Responsável"
          options={availableFilters.assignees}
          selected={filters.assignees}
          onChange={(assignees) => {
            setFilters((f) => ({ ...f, assignees }));
            setPage(0);
          }}
        />
        {activeChips.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setFilters({ stages: [], status: "all", assignees: [] });
              setSelectedItem(null);
              setPage(0);
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Limpar tudo
          </button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip, i) => (
            <Badge
              key={`${chip.label}-${i}`}
              variant="secondary"
              className="gap-1 text-[11px] font-normal"
            >
              {chip.label}
              <button type="button" onClick={chip.onRemove} className="hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          title="Leads impactados"
          value={uniqueLeads}
          description={`Leads com ao menos uma ${labels.singular.toLowerCase()} registrada`}
          icon={<Users className="h-4 w-4" />}
        />
        <KpiCard
          title="Registros"
          value={filteredRows.length}
          description={`Total de ${labels.plural.toLowerCase()} vinculadas`}
          icon={<ListChecks className="h-4 w-4" />}
        />
        <KpiCard
          title={`${labels.singular} mais frequente`}
          value={chartData[0]?.name ?? "—"}
          description={chartData[0] ? `${chartData[0].value} registros · ${chartData[0].pct}%` : "Sem dados"}
          icon={<Flame className="h-4 w-4" />}
        />
      </div>

      {/* Grafico */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{labels.plural} por volume</h3>
            <p className="text-[11px] text-muted-foreground">
              Clique em uma barra para filtrar a tabela
            </p>
          </div>
        </div>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">{labels.empty}</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 38)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" stroke="var(--chart-axis)" fontSize={11} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={170}
                stroke="var(--chart-axis)"
                fontSize={11}
                tickLine={false}
              />
              <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
              <Bar
                dataKey="value"
                radius={[0, 6, 6, 0]}
                onClick={(d: any) => {
                  setSelectedItem((cur) => (cur === d.id ? null : d.id));
                  setPage(0);
                }}
                className="cursor-pointer"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.id}
                    fill="hsl(var(--primary))"
                    fillOpacity={!selectedItem || selectedItem === entry.id ? 1 : 0.25}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Tabela */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar por empresa, lead, responsável..."
              className="h-8 pl-8 text-xs bg-secondary border-border"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground font-mono">
              {tableRows.length} registro{tableRows.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs rounded-lg"
              onClick={exportCsv}
              disabled={tableRows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeader label="Empresa" sortKey="company" />
                <SortHeader label="Nome do lead" sortKey="leadName" />
                <SortHeader label={labels.column} sortKey="itemName" />
                <SortHeader label="Responsável" sortKey="assigneeName" />
                <SortHeader label="Etapa" sortKey="stageName" />
                <SortHeader label="Status" sortKey="status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    {labels.empty}
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((r: PainObjectionRow) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/crm/pipeline?lead=${r.leadId}`)}
                  >
                    <TableCell className="text-sm text-foreground">{r.company}</TableCell>
                    <TableCell className="text-sm text-foreground">{r.leadName}</TableCell>
                    <TableCell className="text-sm text-foreground">{r.itemName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.assigneeName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[11px] font-normal"
                        style={{ borderColor: r.stageColor, color: r.stageColor }}
                      >
                        {r.stageName}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "text-[11px] font-normal",
                          r.status === "won" && "bg-success/15 text-success hover:bg-success/15",
                          r.status === "lost" && "bg-destructive/15 text-destructive hover:bg-destructive/15",
                          r.status === "open" && "bg-muted text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={currentPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-[11px] text-muted-foreground font-mono">
              {currentPage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Próxima
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
