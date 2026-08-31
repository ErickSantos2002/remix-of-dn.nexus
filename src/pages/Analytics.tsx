import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { 
  Users, 
  TrendingUp, 
  TrendingDown, 
  MessageSquare, 
  Clock, 
  Download, 
  Calendar,
  ChevronDown,
  Star,
  Loader2,
  Target,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  Filter,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  FunnelChart,
  Funnel,
  LabelList,
} from "recharts";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAnalyticsData, PeriodFilter, CustomDateRange } from "@/hooks/useAnalyticsData";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useCRMAnalytics, CRMFunnelFilters } from "@/hooks/useCRMAnalytics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppHealthTab } from "@/components/analytics/WhatsAppHealthTab";
import { FunnelStageLeadsDialog } from "@/components/analytics/FunnelStageLeadsDialog";
import { CohortTab } from "@/components/analytics/CohortTab";
import { MeetingsTab } from "@/components/analytics/MeetingsTab";
import { PainsObjectionsTab } from "@/components/analytics/PainsObjectionsTab";
import { SalesCycleCard } from "@/components/analytics/SalesCycleCard";

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  "today": "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  "custom": "Personalizado",
};

interface KPICardProps {
  title: string;
  value: string | number;
  description: string | React.ReactNode;
  trend: number;
  trendLabel: string;
  icon: React.ReactNode;
  colorClass: string;
  invertTrend?: boolean;
  onValueClick?: () => void;
}

const KPICard = ({ title, value, description, trend, trendLabel, icon, colorClass, invertTrend, onValueClick }: KPICardProps) => {
  const isPositive = invertTrend ? trend < 0 : trend > 0;
  
  return (
    <div className="glass-card-glow">
      <div className="glass-card-glow-effect"></div>
      <div className="glass-card-glow-content p-5">
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <div className={cn("p-2 rounded-lg", colorClass)}>
            {icon}
          </div>
        </div>
        {onValueClick ? (
          <button
            onClick={onValueClick}
            className="text-3xl font-bold font-display text-foreground hover:text-primary transition-colors cursor-pointer hover:underline"
          >
            {value}
          </button>
        ) : (
          <div className="text-3xl font-bold font-display text-foreground">{value}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
        <div className="flex items-center gap-1 mt-2">
          {trend !== 0 ? (
            <>
              {isPositive ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className={cn(
                "text-sm font-medium",
                isPositive ? "text-success" : "text-destructive"
              )}>
                {trend > 0 ? "+" : ""}{trend}%
              </span>
              <span className="text-xs text-muted-foreground">{trendLabel}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Sem dados anteriores</span>
          )}
        </div>
      </div>
    </div>
  );
};


const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const Analytics = () => {
  const { toast } = useToast();
  const [period, setPeriod] = useState<PeriodFilter>("7d");
  const [activeTab, setActiveTab] = useState("geral");
  const [selectedStage, setSelectedStage] = useState<{ id: string; name: string; mode: "current" | "period"; leadIds: string[] } | null>(null);
  const [selectedLossReason, setSelectedLossReason] = useState<{ reason: string; leadIds: string[] } | null>(null);
  const [kpiDialog, setKpiDialog] = useState<{ title: string; leadIds: string[] } | null>(null);
  const [crmSubTab, setCrmSubTab] = useState<"pipeline" | "cohort" | "pains" | "objections">("pipeline");
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const [pendingFrom, setPendingFrom] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [funnelFilters, setFunnelFilters] = useState<CRMFunnelFilters>({});
  const [lossStageFilter, setLossStageFilter] = useState<string[]>([]);
  const [lossStageOpen, setLossStageOpen] = useState(false);
  
  const { data, isLoading } = useAnalyticsData(period, customRange);
  const { data: crmData, isLoading: crmLoading, availableFilters: crmAvailableFilters } = useCRMAnalytics(period, customRange, funnelFilters);

  const hasActiveFilters = !!(funnelFilters.utmSource || funnelFilters.utmCampaign || funnelFilters.source || funnelFilters.tag);

  // Ranking de motivos de perda com filtro interno por etapa
  const lossStageOptions = crmData?.stages ?? [];
  const filteredLossReasons = useMemo(() => {
    if (!crmData) return [];
    if (lossStageFilter.length === 0) return crmData.lossReasons;
    const selected = new Set(lossStageFilter);
    const filtered = crmData.lostLeadsDetail.filter(
      (l) => l.stageId && selected.has(l.stageId)
    );
    const groups: Record<string, string[]> = {};
    filtered.forEach((l) => {
      if (!groups[l.reason]) groups[l.reason] = [];
      groups[l.reason].push(l.id);
    });
    const total = filtered.length;
    return Object.entries(groups)
      .map(([reason, ids]) => ({
        reason,
        count: ids.length,
        percentage: total > 0 ? Math.round((ids.length / total) * 100) : 0,
        leadIds: ids,
      }))
      .sort((a, b) => b.count - a.count);
  }, [crmData, lossStageFilter]);

  const periodStartDate = useMemo(() => {
    if (period === "custom" && customRange) {
      return customRange.from.toISOString();
    }
    const now = new Date();
    const start = new Date();
    if (period === "today") start.setHours(0, 0, 0, 0);
    else if (period === "7d") start.setDate(now.getDate() - 7);
    else if (period === "30d") start.setDate(now.getDate() - 30);
    else if (period === "90d") start.setDate(now.getDate() - 90);
    return start.toISOString();
  }, [period, customRange]);

  const periodEndDate = useMemo(() => {
    if (period === "custom" && customRange) {
      const end = new Date(customRange.to);
      end.setDate(end.getDate() + 1);
      return end.toISOString();
    }
    return new Date().toISOString();
  }, [period, customRange]);

  const handlePeriodChange = (v: string) => {
    const newPeriod = v as PeriodFilter;
    setPeriod(newPeriod);
    if (newPeriod !== "custom") {
      setCustomRange(undefined);
      setPendingFrom(undefined);
    }
  };

  const handleExport = (format: "csv" | "pdf") => {
    toast({
      title: "Exportação iniciada",
      description: `Gerando arquivo ${format.toUpperCase()}...`,
    });
    
    setTimeout(() => {
      toast({
        title: "Download concluído",
        description: `Arquivo analytics_${period}.${format} baixado com sucesso.`,
      });
    }, 1500);
  };

  const showNoData = !isLoading && !data;

  return (
    <div className="flex-1 flex flex-col h-full overflow-auto">
      <div className="p-4 pb-0">
        <Breadcrumbs />
      </div>
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Visualize métricas e performance dos seus agentes
          </p>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-full sm:w-[180px] bg-secondary border-border rounded-xl">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>

          {period === "custom" && (
            <div className="flex items-center gap-2">
              <Popover open={fromOpen} onOpenChange={(open) => {
                setFromOpen(open);
                if (open) {
                  setPendingFrom(undefined);
                }
              }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal rounded-xl", !(pendingFrom || customRange?.from) && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {(pendingFrom || customRange?.from) ? format(pendingFrom || customRange!.from, "dd/MM/yyyy") : "Inicio"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                    mode="single"
                    selected={pendingFrom || customRange?.from}
                    onSelect={(date) => {
                      if (date) {
                        setPendingFrom(date);
                        setCustomRange(undefined);
                        setFromOpen(false);
                        setTimeout(() => setToOpen(true), 150);
                      }
                    }}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">até</span>
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal rounded-xl", !customRange?.to && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {customRange?.to ? format(customRange.to, "dd/MM/yyyy") : "Fim"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customRange?.to}
                    onSelect={(date) => {
                      if (date) {
                        const fromDate = pendingFrom || customRange?.from || date;
                        const validFrom = fromDate <= date ? fromDate : date;
                        setCustomRange({ from: validFrom, to: date });
                        setPendingFrom(undefined);
                        setToOpen(false);
                      }
                    }}
                    disabled={(date) => date > new Date() || ((pendingFrom || customRange?.from) ? date < (pendingFrom || customRange!.from) : false)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-xl gap-2">
                <Download className="h-4 w-4" />
                Exportar
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border">
              <DropdownMenuItem onClick={() => handleExport("csv")}>
                Exportar CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                Exportar PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="geral">Geral</TabsTrigger>
            <TabsTrigger value="crm-funil">CRM / Funil</TabsTrigger>
            <TabsTrigger value="reunioes">Reuniões</TabsTrigger>
            <TabsTrigger value="whatsapp-health">Saúde WhatsApp</TabsTrigger>
          </TabsList>

          <TabsContent value="reunioes" className="mt-4">
            <MeetingsTab />
          </TabsContent>

          <TabsContent value="whatsapp-health" className="mt-4">
            <WhatsAppHealthTab />
          </TabsContent>

          {/* CRM / Funil Tab */}
          <TabsContent value="crm-funil" className="mt-4 space-y-4">
            {/* Sub-tabs: Pipeline / Cohort */}
            <div className="flex gap-1 p-1.5 bg-secondary rounded-xl w-fit border border-border">
              <button
                onClick={() => setCrmSubTab("pipeline")}
                className={cn(
                  "px-5 py-2 text-sm font-semibold rounded-lg transition-all",
                  crmSubTab === "pipeline" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Pipeline
              </button>
              <button
                onClick={() => setCrmSubTab("cohort")}
                className={cn(
                  "px-5 py-2 text-sm font-semibold rounded-lg transition-all",
                  crmSubTab === "cohort" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Cohort
              </button>
              <button
                onClick={() => setCrmSubTab("pains")}
                className={cn(
                  "px-5 py-2 text-sm font-semibold rounded-lg transition-all",
                  crmSubTab === "pains" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Dores
              </button>
              <button
                onClick={() => setCrmSubTab("objections")}
                className={cn(
                  "px-5 py-2 text-sm font-semibold rounded-lg transition-all",
                  crmSubTab === "objections" ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Objeções
              </button>
            </div>

            {crmSubTab === "cohort" ? (
              <CohortTab />
            ) : crmSubTab === "pains" || crmSubTab === "objections" ? (
              <PainsObjectionsTab kind={crmSubTab} period={period} customRange={customRange} />
            ) : (
              <>
                {/* Funnel Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  
                  {/* Tag filter */}
                  {crmAvailableFilters.tags.length > 0 && (
                    <Select value={funnelFilters.tag || "__all__"} onValueChange={(v) => setFunnelFilters(f => ({ ...f, tag: v === "__all__" ? undefined : v }))}>
                      <SelectTrigger className="w-[150px] h-8 text-xs bg-secondary border-border rounded-lg">
                        <SelectValue placeholder="Tag" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="__all__">Todas as tags</SelectItem>
                        {crmAvailableFilters.tags.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Source filter */}
                  {crmAvailableFilters.sources.length > 0 && (
                    <Select value={funnelFilters.source || "__all__"} onValueChange={(v) => setFunnelFilters(f => ({ ...f, source: v === "__all__" ? undefined : v }))}>
                      <SelectTrigger className="w-[150px] h-8 text-xs bg-secondary border-border rounded-lg">
                        <SelectValue placeholder="Origem" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="__all__">Todas as origens</SelectItem>
                        {crmAvailableFilters.sources.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* UTM Source filter */}
                  {crmAvailableFilters.utmSources.length > 0 && (
                    <Select value={funnelFilters.utmSource || "__all__"} onValueChange={(v) => setFunnelFilters(f => ({ ...f, utmSource: v === "__all__" ? undefined : v }))}>
                      <SelectTrigger className="w-[160px] h-8 text-xs bg-secondary border-border rounded-lg">
                        <SelectValue placeholder="UTM Source" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="__all__">Todos UTM Source</SelectItem>
                        {crmAvailableFilters.utmSources.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* UTM Campaign filter */}
                  {crmAvailableFilters.utmCampaigns.length > 0 && (
                    <Select value={funnelFilters.utmCampaign || "__all__"} onValueChange={(v) => setFunnelFilters(f => ({ ...f, utmCampaign: v === "__all__" ? undefined : v }))}>
                      <SelectTrigger className="w-[170px] h-8 text-xs bg-secondary border-border rounded-lg">
                        <SelectValue placeholder="UTM Campaign" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="__all__">Todas UTM Campaign</SelectItem>
                        {crmAvailableFilters.utmCampaigns.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Clear filters */}
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setFunnelFilters({})}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Limpar filtros
                    </Button>
                  )}
                </div>

                {/* Active filter badges */}
                {hasActiveFilters && (
                  <div className="flex flex-wrap gap-1.5">
                    {funnelFilters.tag && (
                      <Badge variant="outline" className="text-xs bg-primary/10 border-primary/30 text-primary gap-1">
                        Tag: {funnelFilters.tag}
                        <button onClick={() => setFunnelFilters(f => ({ ...f, tag: undefined }))}><X className="h-3 w-3" /></button>
                      </Badge>
                    )}
                    {funnelFilters.source && (
                      <Badge variant="outline" className="text-xs bg-chart-1/10 border-chart-1/30 text-chart-1 gap-1">
                        Origem: {funnelFilters.source}
                        <button onClick={() => setFunnelFilters(f => ({ ...f, source: undefined }))}><X className="h-3 w-3" /></button>
                      </Badge>
                    )}
                    {funnelFilters.utmSource && (
                      <Badge variant="outline" className="text-xs bg-chart-2/10 border-chart-2/30 text-chart-2 gap-1">
                        UTM Source: {funnelFilters.utmSource}
                        <button onClick={() => setFunnelFilters(f => ({ ...f, utmSource: undefined }))}><X className="h-3 w-3" /></button>
                      </Badge>
                    )}
                    {funnelFilters.utmCampaign && (
                      <Badge variant="outline" className="text-xs bg-chart-3/10 border-chart-3/30 text-chart-3 gap-1">
                        UTM Campaign: {funnelFilters.utmCampaign}
                        <button onClick={() => setFunnelFilters(f => ({ ...f, utmCampaign: undefined }))}><X className="h-3 w-3" /></button>
                      </Badge>
                    )}
                  </div>
                )}

              <SalesCycleCard period={period} customRange={customRange} />

              {crmLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : crmData ? (
              <div className="space-y-6">
                {/* CRM KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard
                    title="Leads no período"
                    value={crmData.kpis.totalCRMLeads.toLocaleString()}
                    description="Novos leads criados"
                    trend={crmData.kpis.trends.leads}
                    trendLabel="vs período anterior"
                    icon={<Users className="h-5 w-5 text-foreground" />}
                    colorClass="bg-primary/10"
                    onValueClick={crmData.kpis.createdLeadIds.length > 0 ? () => setKpiDialog({ title: "Leads no período", leadIds: crmData.kpis.createdLeadIds }) : undefined}
                  />
                  <KPICard
                    title="Reuniões no período"
                    value={crmData.kpis.meetingsScheduled.toLocaleString()}
                    description={
                      <span className="flex items-center gap-1 flex-wrap">
                        <button
                          onClick={() => crmData.kpis.meetingCompletedLeadIds.length > 0 && setKpiDialog({ title: "Reuniões realizadas", leadIds: crmData.kpis.meetingCompletedLeadIds })}
                          className={cn("hover:underline transition-colors", crmData.kpis.meetingCompletedLeadIds.length > 0 ? "hover:text-foreground cursor-pointer" : "")}
                        >
                          {crmData.kpis.meetingsCompleted} realizadas
                        </button>
                        <span>/</span>
                        <button
                          onClick={() => crmData.kpis.meetingNoShowLeadIds.length > 0 && setKpiDialog({ title: "Reuniões no-show", leadIds: crmData.kpis.meetingNoShowLeadIds })}
                          className={cn("hover:underline transition-colors", crmData.kpis.meetingNoShowLeadIds.length > 0 ? "hover:text-foreground cursor-pointer" : "")}
                        >
                          {crmData.kpis.meetingsNoShow} no-show
                        </button>
                      </span>
                    }
                    trend={crmData.kpis.trends.meetings}
                    trendLabel="vs período anterior"
                    icon={<Calendar className="h-5 w-5 text-foreground" />}
                    colorClass="bg-primary/10"
                    onValueClick={crmData.kpis.meetingLeadIds.length > 0 ? () => setKpiDialog({ title: "Reuniões no período", leadIds: crmData.kpis.meetingLeadIds }) : undefined}
                  />
                  <KPICard
                    title="Vendas realizadas"
                    value={crmData.kpis.totalWon.toLocaleString()}
                    description={`Conversão Lead→Venda: ${crmData.kpis.conversionLeadToSale}%`}
                    trend={crmData.kpis.trends.won}
                    trendLabel="vs período anterior"
                    icon={<CheckCircle2 className="h-5 w-5 text-foreground" />}
                    colorClass="bg-primary/10"
                    onValueClick={crmData.kpis.wonLeadIds.length > 0 ? () => setKpiDialog({ title: "Vendas realizadas", leadIds: crmData.kpis.wonLeadIds }) : undefined}
                  />
                  <KPICard
                    title="Leads perdidos"
                    value={crmData.kpis.totalLost.toLocaleString()}
                    description="Total no período"
                    trend={crmData.kpis.trends.lost}
                    trendLabel="vs período anterior"
                    icon={<XCircle className="h-5 w-5 text-foreground" />}
                    colorClass="bg-primary/10"
                    invertTrend
                    onValueClick={crmData.kpis.lostLeadIds.length > 0 ? () => setKpiDialog({ title: "Leads perdidos", leadIds: crmData.kpis.lostLeadIds }) : undefined}
                  />
                </div>

                {/* Charts Grid */}
                {/* Funnel Cards + Rates */}
                {/* Funnel + Rates */}
                <div className="space-y-6">
                  {/* CRM Funnel - horizontal blocks */}
                  <Card className="glass-card">
                    <CardHeader>
                    <CardTitle className="text-lg font-display">Funil de Vendas</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {crmData.funnelData.some(d => d.periodValue > 0 || d.currentValue > 0) ? (
                        <div className="space-y-4">
                          {/* Funnel bars */}
                          <div className="flex items-end gap-3 overflow-x-auto pb-2">
                            {(() => {
                              const maxValue = Math.max(...crmData.funnelData.map(d => d.periodValue), 1);
                              return crmData.funnelData.map((stage, i) => {
                                const heightPx = Math.max((stage.periodValue / maxValue) * 160, 40);
                                return (
                                  <div key={i} className="flex flex-col items-center flex-1 min-w-[90px]">
                                    <div
                                      className="glass-card-glow w-full rounded-lg transition-all duration-500 relative overflow-hidden"
                                      style={{ height: `${heightPx}px` }}
                                    >
                                      <div
                                        className="absolute inset-0 rounded-lg opacity-25"
                                        style={{ backgroundColor: stage.fill }}
                                      />
                                      <div
                                        className="absolute inset-0 rounded-lg"
                                        style={{
                                          background: `linear-gradient(to top, ${stage.fill}44, ${stage.fill}11)`,
                                          boxShadow: `inset 0 -2px 12px ${stage.fill}33, 0 0 20px ${stage.fill}15`,
                                        }}
                                      />
                                      <div
                                        className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg"
                                        style={{ backgroundColor: stage.fill, opacity: 0.8 }}
                                      />
                                    </div>
                                    <button
                                      onClick={() => setSelectedStage({ id: stage.stageId, name: stage.name, mode: "period", leadIds: stage.periodLeadIds })}
                                      className="font-display text-lg font-bold mt-2 cursor-pointer hover:underline transition-all"
                                      style={{ color: stage.fill }}
                                    >
                                      {stage.periodValue.toLocaleString()}
                                    </button>
                                    <button
                                      onClick={() => setSelectedStage({ id: stage.stageId, name: stage.name, mode: "current", leadIds: stage.currentLeadIds })}
                                      className="text-[10px] text-muted-foreground cursor-pointer hover:underline hover:text-foreground transition-colors"
                                    >
                                      Atual: {stage.currentValue}
                                    </button>
                                    <span className="text-xs text-muted-foreground mt-0.5 text-center truncate w-full">
                                      {stage.name}
                                    </span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                          {/* Conversion rates between stages */}
                          <div className="flex items-center gap-1 overflow-x-auto">
                            {crmData.funnelData.map((stage, i) => {
                              const nextStage = crmData.funnelData[i + 1];
                              if (!nextStage) return null;
                              const conversionRate = stage.periodValue > 0
                                ? Math.round((nextStage.periodValue / stage.periodValue) * 100)
                                : null;
                              return (
                                <div key={i} className="flex-1 min-w-[90px]">
                                  <div className="glass-card rounded-lg px-3 py-2 text-center">
                                    <p className="text-[10px] text-muted-foreground truncate">
                                      {stage.name.split(' ')[0]} &rarr; {nextStage.name.split(' ')[0]}
                                    </p>
                                    <p className="font-display text-sm font-bold text-primary mt-0.5">
                                      {conversionRate !== null ? `${conversionRate}%` : '\u2014'}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                          Sem leads no funil
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Rates row */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {(() => {
                      const fd = crmData.funnelData;
                      const kpis = crmData.kpis;
                      const leadToSale = fd.length >= 2 && fd[0].periodValue > 0
                        ? Math.round((fd[fd.length - 1].periodValue / fd[0].periodValue) * 100) : 0;
                      const mqlStage = fd.find(s => s.name.toLowerCase().includes("mql"));
                      const mqlToSale = mqlStage && mqlStage.periodValue > 0
                        ? Math.round((fd[fd.length - 1].periodValue / mqlStage.periodValue) * 100) : 0;
                      const noShowRate = kpis.meetingsScheduled > 0
                        ? Math.round((kpis.meetingsNoShow / kpis.meetingsScheduled) * 100) : 0;
                      const rescheduleRate = kpis.meetingsScheduled > 0
                        ? Math.round((kpis.meetingsRescheduled / kpis.meetingsScheduled) * 100) : 0;
                      return [
                        { label: "Lead para Venda", value: leadToSale, color: "text-success" },
                        { label: "MQL para Venda", value: mqlToSale, color: "text-chart-1" },
                        { label: "Taxa de No-show", value: noShowRate, color: "text-warning" },
                        { label: "Taxa de Reagendamento", value: rescheduleRate, color: "text-chart-3" },
                      ];
                    })().map((item, i) => (
                      <div key={i} className="glass-card-glow">
                        <div className="glass-card-glow-effect"></div>
                        <div className="glass-card-glow-content p-4 text-center">
                          <p className={`font-display text-2xl font-bold ${item.color}`}>{item.value}%</p>
                          <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Activity Breakdown */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg font-display">Atividades por tipo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="min-h-[200px]">
                        {crmData.activityBreakdown.length > 0 ? (() => {
                          const segments = [
                            { key: 'completed', label: 'Concluídas', fill: 'hsl(var(--success))' },
                            { key: 'pending', label: 'Pendentes', fill: 'hsl(var(--primary))' },
                            { key: 'no_show', label: 'No-show', fill: 'hsl(var(--warning))' },
                            { key: 'cancelled', label: 'Canceladas', fill: 'hsl(var(--destructive))' },
                          ];
                          const maxTotal = Math.max(
                            ...crmData.activityBreakdown.map((a: any) =>
                              (a.completed || 0) + (a.pending || 0) + (a.no_show || 0) + (a.cancelled || 0)
                            ), 1
                          );
                          return (
                            <div className="space-y-6">
                              {crmData.activityBreakdown.map((item: any, idx: number) => {
                                const total = (item.completed || 0) + (item.pending || 0) + (item.no_show || 0) + (item.cancelled || 0);
                                const barWidthPct = Math.max((total / maxTotal) * 100, 10);
                                return (
                                  <div key={idx}>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-sm text-muted-foreground">{item.label}</span>
                                      <span className="font-display text-sm font-bold text-foreground">{total}</span>
                                    </div>
                                    <div
                                      className="glass-card-glow rounded-lg relative overflow-hidden h-10 transition-all duration-500"
                                      style={{ width: `${barWidthPct}%` }}
                                    >
                                      <div className="glass-card-glow-effect" />
                                      <div className="relative flex h-full rounded-lg overflow-hidden z-[1]">
                                        {segments.map((seg) => {
                                          const val = item[seg.key] || 0;
                                          if (val === 0) return null;
                                          const pct = (val / total) * 100;
                                          return (
                                            <div
                                              key={seg.key}
                                              className="relative flex items-center justify-center text-xs font-bold"
                                              style={{
                                                width: `${pct}%`,
                                                minWidth: '24px',
                                              }}
                                              title={`${seg.label}: ${val}`}
                                            >
                                              <div
                                                className="absolute inset-0 opacity-25"
                                                style={{ backgroundColor: seg.fill }}
                                              />
                                              <div
                                                className="absolute inset-0"
                                                style={{
                                                  background: `linear-gradient(to right, ${seg.fill}44, ${seg.fill}22)`,
                                                  boxShadow: `inset 0 -2px 12px ${seg.fill}33, 0 0 20px ${seg.fill}15`,
                                                }}
                                              />
                                              <div
                                                className="absolute bottom-0 left-0 right-0 h-1"
                                                style={{ backgroundColor: seg.fill, opacity: 0.8 }}
                                              />
                                              <span className="relative z-[1]" style={{ color: seg.fill }}>
                                                {pct > 12 ? val : ''}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              {/* Legend */}
                              <div className="flex flex-wrap gap-4 pt-2">
                                {segments.map((seg) => (
                                  <div key={seg.key} className="flex items-center gap-1.5">
                                    <div
                                      className="w-3 h-3 rounded-sm"
                                      style={{
                                        backgroundColor: seg.fill,
                                        boxShadow: `0 0 8px ${seg.fill}66`,
                                      }}
                                    />
                                    <span className="text-xs text-muted-foreground">{seg.label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="flex items-center justify-center h-full text-muted-foreground">
                            Sem atividades no período
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Loss Reasons */}
                  <Card className="glass-card flex flex-col" style={{ height: 'auto' }}>
                    <CardHeader>
                      <CardTitle className="text-lg font-display">Motivos de perda</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-0">
                      <div className="h-[300px] overflow-y-auto">
                        {crmData.lossReasons.length > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="sticky top-0 bg-card z-10">Motivo</TableHead>
                                <TableHead className="text-right sticky top-0 bg-card z-10">Qtd</TableHead>
                                <TableHead className="text-right sticky top-0 bg-card z-10">%</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {crmData.lossReasons.map((lr) => (
                                <TableRow 
                                  key={lr.reason} 
                                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                                  onClick={() => setSelectedLossReason({ reason: lr.reason, leadIds: lr.leadIds })}
                                >
                                  <TableCell className="font-medium text-sm">{lr.reason}</TableCell>
                                  <TableCell className="text-right font-mono">{lr.count}</TableCell>
                                  <TableCell className="text-right">
                                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                                      {lr.percentage}%
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <div className="flex items-center justify-center h-full text-muted-foreground">
                            Nenhum lead perdido no período
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Timeline */}
                  <Card className="glass-card col-span-1 lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-lg font-display">Evolução do funil</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        {crmData.timeline.some(d => d.leads > 0 || d.mql > 0 || d.reunioes > 0) ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={crmData.timeline}>
                              <defs>
                                <linearGradient id="colorCrmLeads" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorCrmMql" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis dataKey="name" stroke="var(--chart-axis)" fontSize={12} tickLine={false} />
                              <YAxis stroke="var(--chart-axis)" fontSize={12} tickLine={false} axisLine={false} />
                              <Tooltip content={<CustomTooltip />} />
                              <Legend />
                              <Area type="monotone" dataKey="leads" name="Leads" stroke="hsl(var(--primary))" fill="url(#colorCrmLeads)" strokeWidth={2} />
                              <Area type="monotone" dataKey="mql" name="MQL" stroke="hsl(var(--chart-2))" fill="url(#colorCrmMql)" strokeWidth={2} />
                               <Area type="monotone" dataKey="reunioes" name="Reuniões" stroke="hsl(var(--chart-3))" fill="transparent" strokeWidth={2} />
                               <Area type="monotone" dataKey="negociacao" name="Negociação" stroke="hsl(var(--chart-4))" fill="transparent" strokeWidth={2} />
                              <Area type="monotone" dataKey="vendas" name="Vendas" stroke="hsl(var(--chart-5))" fill="transparent" strokeWidth={2} />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex items-center justify-center h-full text-muted-foreground">
                             Sem dados para o período selecionado
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Selecione um workspace para ver os dados do CRM.
              </div>
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="geral" className="mt-4 space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : showNoData ? (
              <div className="text-center py-12 text-muted-foreground">
                Selecione um workspace para ver os dados.
              </div>
            ) : data ? (
              <>
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total de Leads"
            value={data.kpis.totalLeads.toLocaleString()}
            description="Total de leads neste período"
            trend={data.kpis.trends.leads}
            trendLabel="vs período anterior"
            icon={<Users className="h-5 w-5 text-[var(--accent-ink)]" />}
            colorClass="bg-primary/10"
          />
          <KPICard
            title="Taxa de Conversão"
            value={`${data.kpis.conversionRate.toFixed(1)}%`}
            description="Leads fechados"
            trend={data.kpis.trends.conversion}
            trendLabel="vs período anterior"
            icon={<TrendingUp className="h-5 w-5 text-[var(--accent-ink)]" />}
            colorClass="bg-primary/10"
          />
          <KPICard
            title="Mensagens Trocadas"
            value={data.kpis.totalMessages.toLocaleString()}
            description="Total de mensagens"
            trend={data.kpis.trends.messages}
            trendLabel="vs período anterior"
            icon={<MessageSquare className="h-5 w-5 text-[var(--accent-ink)]" />}
            colorClass="bg-primary/10"
          />
          <KPICard
            title="Tempo Médio de Resposta"
            value={data.kpis.avgResponseTime > 0 ? `${data.kpis.avgResponseTime.toFixed(1)}s` : "-"}
            description="Tempo médio da IA"
            trend={data.kpis.trends.responseTime}
            trendLabel="vs período anterior"
            icon={<Clock className="h-5 w-5 text-[var(--accent-ink)]" />}
            colorClass="bg-primary/10"
            invertTrend
          />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Volume Chart */}
          <Card className="glass-card col-span-1 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Volume de Interações</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {data.volumeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.volumeData}>
                      <defs>
                        <linearGradient id="colorMensagens" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis 
                        dataKey="name" 
                        stroke="var(--chart-axis)"
                        fontSize={12}
                        tickLine={false}
                      />
                      <YAxis 
                        stroke="var(--chart-axis)"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="mensagens"
                        name="Mensagens"
                        stroke="hsl(var(--primary))"
                        fill="url(#colorMensagens)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="leads"
                        name="Leads"
                        stroke="hsl(var(--chart-2))"
                        fill="url(#colorLeads)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Sem dados para o período selecionado
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Funnel Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Funil de Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {data.funnelData.some(d => d.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <FunnelChart>
                      <Tooltip content={<CustomTooltip />} />
                      <Funnel
                        dataKey="value"
                        data={data.funnelData}
                        isAnimationActive
                      >
                        <LabelList 
                          position="right" 
                          fill="hsl(var(--foreground))" 
                          stroke="none" 
                          dataKey="name" 
                          fontSize={12}
                        />
                        <LabelList 
                          position="center" 
                          fill="hsl(var(--foreground))" 
                          stroke="none" 
                          dataKey="value" 
                          fontSize={14}
                          fontWeight="bold"
                          formatter={(value: number) => value.toLocaleString()}
                        />
                      </Funnel>
                    </FunnelChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                   Sem leads no período
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Sentiment Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Status dos Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex items-center justify-center">
                {data.sentimentData.some(d => d.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                       <Pie
                         data={data.sentimentData}
                         cx="50%"
                         cy="50%"
                         innerRadius={60}
                         outerRadius={100}
                         paddingAngle={5}
                         dataKey="value"
                         labelLine={false}
                       >
                         {data.sentimentData.map((entry, index) => (
                           <Cell key={`cell-${index}`} fill={entry.color} />
                         ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number) => `${value}%`}
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-muted-foreground">Sem leads no período</div>
                )}
              </div>
              <div className="flex justify-center gap-4 mt-4">
                {data.sentimentData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {entry.name} ({entry.value}%)
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agents Ranking Table */}
          <Card className="glass-card col-span-1 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Ranking de Agentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                {data.agentsRanking.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agente</TableHead>
                        <TableHead className="text-right">Mensagens</TableHead>
                        <TableHead className="text-right">Conversão</TableHead>
                        <TableHead className="text-right">Rating</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.agentsRanking.map((agent, index) => (
                        <TableRow key={agent.name}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center p-0",
                                  index === 0 && "bg-warning/20 text-warning border-warning/30",
                                  index === 1 && "bg-muted text-muted-foreground border-border",
                                  index === 2 && "bg-warning/20 text-warning border-warning/30",
                                  index > 2 && "bg-muted text-muted-foreground"
                                )}
                              >
                                {index + 1}
                              </Badge>
                              {agent.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {agent.messages.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                agent.conversion >= 40 && "bg-success/20 text-success border-success/30",
                                agent.conversion >= 25 && agent.conversion < 40 && "bg-warning/20 text-warning border-warning/30",
                                agent.conversion < 25 && "bg-muted text-muted-foreground"
                              )}
                            >
                              {agent.conversion}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-4 w-4 text-warning fill-warning" />
                              <span className="font-mono">{agent.rating.toFixed(1)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum agente encontrado
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Loss Reasons Ranking */}
          <Card className="glass-card col-span-1 lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-lg">Ranking de Motivos de Perda</CardTitle>
              <div className="flex items-center gap-2">
                {lossStageFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLossStageFilter([])}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Limpar
                  </button>
                )}
                <Popover open={lossStageOpen} onOpenChange={setLossStageOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 gap-2 rounded-xl",
                        lossStageFilter.length > 0 && "border-primary/40 text-primary"
                      )}
                    >
                      Etapas
                      {lossStageFilter.length > 0 && (
                        <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-mono">
                          {lossStageFilter.length}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2 bg-card border-border z-50" align="end">
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {lossStageOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">
                          Sem etapas disponíveis
                        </p>
                      ) : (
                        lossStageOptions.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/40 transition-colors"
                          >
                            <Checkbox
                              checked={lossStageFilter.includes(s.id)}
                              onCheckedChange={() =>
                                setLossStageFilter((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((v) => v !== s.id)
                                    : [...prev, s.id]
                                )
                              }
                            />
                            <span className="text-xs text-foreground truncate">{s.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                {crmLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : crmData && filteredLossReasons.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Motivo</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLossReasons.map((lr, index) => (
                        <TableRow
                          key={lr.reason}
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setSelectedLossReason({ reason: lr.reason, leadIds: lr.leadIds })}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center p-0",
                                  index === 0 && "bg-destructive/20 text-destructive border-destructive/30",
                                  index === 1 && "bg-warning/20 text-warning border-warning/30",
                                  index === 2 && "bg-warning/20 text-warning border-warning/30",
                                  index > 2 && "bg-muted text-muted-foreground"
                                )}
                              >
                                {index + 1}
                              </Badge>
                              {lr.reason}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{lr.count}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                              {lr.percentage}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum lead perdido no período
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      {selectedStage && (
        <FunnelStageLeadsDialog
          open={!!selectedStage}
          onOpenChange={(open) => !open && setSelectedStage(null)}
          stageId={selectedStage.id}
          stageName={selectedStage.name}
          mode={selectedStage.mode}
          leadIds={selectedStage.leadIds}
          contextLabel={selectedStage.name}
        />
      )}

      {selectedLossReason && (
        <FunnelStageLeadsDialog
          open={!!selectedLossReason}
          onOpenChange={(open) => !open && setSelectedLossReason(null)}
          stageId=""
          stageName={selectedLossReason.reason}
          mode="period"
          leadIds={selectedLossReason.leadIds}
          customTitle={`${selectedLossReason.reason} — Leads perdidos`}
          contextLabel="Perdido"
        />
      )}

      {kpiDialog && (
        <FunnelStageLeadsDialog
          open={!!kpiDialog}
          onOpenChange={(open) => !open && setKpiDialog(null)}
          stageId=""
          stageName=""
          mode="period"
          leadIds={kpiDialog.leadIds}
          customTitle={kpiDialog.title}
        />
      )}
    </div>
  );
};

export default Analytics;
