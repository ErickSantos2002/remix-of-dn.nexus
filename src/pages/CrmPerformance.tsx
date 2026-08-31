import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Gauge } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";
import { useCompany } from "@/contexts/CompanyContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useSelectableAnalysisPlaybooks } from "@/hooks/useAnalysisPlaybooks";
import { SellerDashboard } from "@/components/performance/SellerDashboard";
import { TeamOverviewTab } from "@/components/performance/TeamOverviewTab";
import { RankingTab } from "@/components/performance/RankingTab";
import { IndividualTab } from "@/components/performance/IndividualTab";
import { OperationsTab } from "@/components/performance/OperationsTab";
import type { PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "custom", label: "Personalizado" },
];

const ALL_PLAYBOOKS = "__all__";

/**
 * Desempenho no atendimento.
 *
 * Vendedor vê a própria evolução; admin/super_admin/dono da empresa veem também
 * a visão do time, o ranking e a orientação individual. A RLS garante o recorte
 * mesmo que a UI mude — aqui a decisão é só de o que renderizar.
 */
export default function CrmPerformance() {
  const { role, isAdmin, isSuperAdmin } = useUserRole();
  const { isAdmin: isCompanyAdmin, isOwner } = useCompany();
  const { workspaceId } = useWorkspace();
  // Membro vê apenas o próprio desempenho, mesmo que seja dono/admin de empresa.
  const isMember = role === "member";
  const isManager = !isMember && (isAdmin || isSuperAdmin || isCompanyAdmin || isOwner);

  const [period, setPeriod] = usePersistedFilters<PeriodFilter>("crm:performance:period", "30d", workspaceId);
  const [playbookFilter, setPlaybookFilter] = usePersistedFilters<string>(
    "crm:performance:playbook",
    ALL_PLAYBOOKS,
    workspaceId,
  );
  // Datas não são persistidas: um intervalo salvo em localStorage volta obsoleto
  // e confunde mais do que ajuda.
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const [pendingFrom, setPendingFrom] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("visao-geral");

  const { data: playbooks } = useSelectableAnalysisPlaybooks();
  const playbookId = playbookFilter === ALL_PLAYBOOKS ? null : playbookFilter;

  // Enquanto o intervalo personalizado não estiver completo, mantemos o último
  // período válido em vez de consultar uma janela indefinida.
  const effectivePeriod: PeriodFilter = period === "custom" && !customRange ? "30d" : period;

  const handleSelectSeller = (sellerId: string) => {
    setSelectedSellerId(sellerId);
    setActiveTab("individual");
  };

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="block text-xs">Período</Label>
        <Select
          value={period}
          onValueChange={(value) => {
            setPeriod(value as PeriodFilter);
            if (value !== "custom") {
              setCustomRange(undefined);
              setPendingFrom(undefined);
            }
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="block text-xs">Início</Label>
            <Popover
              open={fromOpen}
              onOpenChange={(open) => {
                setFromOpen(open);
                if (open) setPendingFrom(undefined);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[150px] justify-start text-left font-normal",
                    !(pendingFrom || customRange?.from) && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {pendingFrom || customRange?.from
                    ? format((pendingFrom || customRange!.from) as Date, "dd/MM/yyyy")
                    : "Início"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={pendingFrom || customRange?.from}
                  onSelect={(date) => {
                    if (!date) return;
                    setPendingFrom(date);
                    setCustomRange(undefined);
                    setFromOpen(false);
                    setTimeout(() => setToOpen(true), 150);
                  }}
                  disabled={(date) => date > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="block text-xs">Fim</Label>
            <Popover open={toOpen} onOpenChange={setToOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[150px] justify-start text-left font-normal",
                    !customRange?.to && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {customRange?.to ? format(customRange.to, "dd/MM/yyyy") : "Fim"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={customRange?.to}
                  onSelect={(date) => {
                    if (!date) return;
                    const fromDate = pendingFrom || customRange?.from || date;
                    const validFrom = fromDate <= date ? fromDate : date;
                    setCustomRange({ from: validFrom, to: date });
                    setPendingFrom(undefined);
                    setToOpen(false);
                  }}
                  disabled={(date) =>
                    date > new Date() ||
                    ((pendingFrom || customRange?.from) ? date < ((pendingFrom || customRange!.from) as Date) : false)
                  }
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {playbooks && playbooks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="block text-xs">Tipo de análise</Label>
          <Select value={playbookFilter} onValueChange={setPlaybookFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PLAYBOOKS}>Todas</SelectItem>
              {playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Gauge className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Desempenho</h1>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? "Evolução do time no atendimento, ranking e orientação por vendedor."
              : "Sua evolução no atendimento, com base nas avaliações dos seus atendimentos."}
          </p>
        </div>
      </div>

      {filters}

      {isManager ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
            <TabsTrigger value="ranking">Ranking</TabsTrigger>
            <TabsTrigger value="individual">Individual</TabsTrigger>
            <TabsTrigger value="meu-desempenho">Meu desempenho</TabsTrigger>
            {/* Age sobre atividades de todos e consome cota do Daily */}
            {isSuperAdmin && <TabsTrigger value="operacao">Operação</TabsTrigger>}
          </TabsList>

          <TabsContent value="visao-geral" className="mt-6">
            <TeamOverviewTab period={effectivePeriod} customRange={customRange} playbookId={playbookId} />
          </TabsContent>

          <TabsContent value="ranking" className="mt-6">
            <RankingTab
              period={effectivePeriod}
              customRange={customRange}
              playbookId={playbookId}
              onSelectSeller={handleSelectSeller}
            />
          </TabsContent>

          <TabsContent value="individual" className="mt-6">
            <IndividualTab
              period={effectivePeriod}
              customRange={customRange}
              playbookId={playbookId}
              selectedSellerId={selectedSellerId}
              onSelectSeller={setSelectedSellerId}
            />
          </TabsContent>

          <TabsContent value="meu-desempenho" className="mt-6">
            <SellerDashboard period={effectivePeriod} customRange={customRange} playbookId={playbookId} />
          </TabsContent>

          {isSuperAdmin && (
            <TabsContent value="operacao" className="mt-6">
              <OperationsTab />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <SellerDashboard period={effectivePeriod} customRange={customRange} playbookId={playbookId} />
      )}
    </div>
  );
}
