import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { 
  Calendar, 
  Clock, 
  User,
  Save
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceSchedulingSettings, SLOT_STEP_OPTIONS } from "@/hooks/useWorkspaceSchedulingSettings";

const DAYS_OF_WEEK = [
  { value: "SUN", label: "Domingo" },
  { value: "MON", label: "Segunda" },
  { value: "TUE", label: "Terça" },
  { value: "WED", label: "Quarta" },
  { value: "THU", label: "Quinta" },
  { value: "FRI", label: "Sexta" },
  { value: "SAT", label: "Sábado" },
];

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
];

const DURATION_OPTIONS = [
  { value: 15, label: "15 minutos" },
  { value: 30, label: "30 minutos" },
  { value: 45, label: "45 minutos" },
  { value: 60, label: "1 hora" },
  { value: 90, label: "1h 30min" },
  { value: 120, label: "2 horas" },
];

const INTERVAL_OPTIONS = [
  { value: 0, label: "Sem intervalo" },
  { value: 5, label: "5 minutos" },
  { value: 10, label: "10 minutos" },
  { value: 15, label: "15 minutos" },
  { value: 30, label: "30 minutos" },
];

export default function CRMAgentCalendarSettings() {
  const { workspaceId } = useWorkspace();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    slotStepMinutes,
    isLoading: isLoadingScheduling,
    updateSlotStep,
    isUpdating: isUpdatingSlotStep,
  } = useWorkspaceSchedulingSettings();

  const handleSlotStepChange = async (value: string) => {
    try {
      await updateSlotStep(Number(value));
      toast({
        title: "Configuração salva",
        description: `Tamanho do slot definido em ${value} minutos.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message,
      });
    }
  };

  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [workStartTime, setWorkStartTime] = useState("09:00");
  const [workEndTime, setWorkEndTime] = useState("18:00");
  const [workDays, setWorkDays] = useState<string[]>(["MON", "TUE", "WED", "THU", "FRI"]);
  const [defaultDuration, setDefaultDuration] = useState(30);
  const [minInterval, setMinInterval] = useState(0);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");

  // Fetch company members
  const { data: companyMembers = [] } = useQuery({
    queryKey: ["company-members-calendar", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      
      const { data, error } = await supabase
        .from("company_members")
        .select("user_id, profiles:profiles!company_members_user_id_fkey(id, name, email)")
        .eq("company_id", companyId)
        .eq("status", "active");
        
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  // Fetch company owner
  const { data: companyData } = useQuery({
    queryKey: ["company-owner-calendar", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      
      const { data, error } = await supabase
        .from("companies")
        .select("owner_id, profiles:profiles!companies_owner_id_fkey(id, name, email)")
        .eq("id", companyId)
        .single();
        
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  // Combine owner + members
  const allAgents = useMemo(() => {
    const agents: { user_id: string; profiles: { id: string; name: string | null; email: string } | null }[] = [];
    
    // Add owner first
    if (companyData?.owner_id && companyData?.profiles) {
      const ownerProfile = Array.isArray(companyData.profiles) 
        ? companyData.profiles[0] 
        : companyData.profiles;
      agents.push({
        user_id: companyData.owner_id,
        profiles: ownerProfile,
      });
    }
    
    // Add active members (avoid duplicates with owner)
    companyMembers.forEach((member: any) => {
      if (!agents.find(a => a.user_id === member.user_id)) {
        agents.push(member);
      }
    });
    
    return agents;
  }, [companyMembers, companyData]);

  // Fetch agent calendar settings
  const { data: agentCalendar, isLoading: isLoadingCalendar } = useQuery({
    queryKey: ["agent-calendar", workspaceId, selectedAgent],
    queryFn: async () => {
      if (!workspaceId || !selectedAgent) return null;
      
      const { data, error } = await supabase
        .from("crm_agent_calendars")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("agent_id", selectedAgent)
        .maybeSingle();
        
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId && !!selectedAgent,
  });

  // Update form when agent calendar data loads
  useEffect(() => {
    if (agentCalendar) {
      setWorkStartTime(agentCalendar.work_start_time || "09:00");
      setWorkEndTime(agentCalendar.work_end_time || "18:00");
      setWorkDays(agentCalendar.work_days || ["MON", "TUE", "WED", "THU", "FRI"]);
      setDefaultDuration(agentCalendar.default_appointment_duration || 30);
      setMinInterval(agentCalendar.min_interval_between_appointments || 0);
      setTimezone(agentCalendar.timezone || "America/Sao_Paulo");
    }
  }, [agentCalendar]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !selectedAgent) return;
      
      const calendarData = {
        workspace_id: workspaceId,
        agent_id: selectedAgent,
        work_start_time: workStartTime,
        work_end_time: workEndTime,
        work_days: workDays,
        default_appointment_duration: defaultDuration,
        min_interval_between_appointments: minInterval,
        timezone: timezone,
      };

      const { error } = await supabase
        .from("crm_agent_calendars")
        .upsert(calendarData, { onConflict: "workspace_id,agent_id" });
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-calendar"] });
      toast({
        title: "Configurações salvas",
        description: "As configurações do calendário foram atualizadas.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message,
      });
    },
  });

  const handleDayToggle = (day: string) => {
    setWorkDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const handleAgentChange = (agentId: string) => {
    setSelectedAgent(agentId);
    // Reset form to defaults when changing agent
    setWorkStartTime("09:00");
    setWorkEndTime("18:00");
    setWorkDays(["MON", "TUE", "WED", "THU", "FRI"]);
    setDefaultDuration(30);
    setMinInterval(0);
    setTimezone("America/Sao_Paulo");
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Calendário dos Agentes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure o horário de trabalho e disponibilidade dos agentes
        </p>
      </div>

      {/* General workspace scheduling settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Configurações gerais de agendamento
          </CardTitle>
          <CardDescription>
            Aplicadas a todo o workspace — valem para o widget público e para os agendamentos feitos pela IA
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-xs">
            <Label>Tamanho do slot (passo entre horários)</Label>
            <Select
              value={String(slotStepMinutes)}
              onValueChange={handleSlotStepChange}
              disabled={isLoadingScheduling || isUpdatingSlotStep}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLOT_STEP_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Define de quanto em quanto tempo os horários disponíveis são oferecidos (ex.: 09:00, 09:15, 09:30).
            </p>
          </div>
        </CardContent>
      </Card>


      {/* Agent Selector */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Selecionar Agente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedAgent} onValueChange={handleAgentChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um agente para configurar" />
            </SelectTrigger>
            <SelectContent>
              {allAgents.map((member: any) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.profiles?.name || member.profiles?.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Settings */}
      {selectedAgent && (
        <>
          {/* Work Hours */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Horário de Trabalho
              </CardTitle>
              <CardDescription>
                Defina o horário em que o agente está disponível
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Time Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Início</Label>
                  <Input
                    type="time"
                    value={workStartTime}
                    onChange={(e) => setWorkStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fim</Label>
                  <Input
                    type="time"
                    value={workEndTime}
                    onChange={(e) => setWorkEndTime(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              {/* Work Days */}
              <div className="space-y-3">
                <Label>Dias de Trabalho</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <label
                      key={day.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        workDays.includes(day.value)
                          ? "bg-primary/10 border-primary text-primary"
                          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Checkbox
                        checked={workDays.includes(day.value)}
                        onCheckedChange={() => handleDayToggle(day.value)}
                        className="hidden"
                      />
                      <span className="text-sm font-medium">{day.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Appointment Settings */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Configurações de Agendamento</CardTitle>
              <CardDescription>
                Defina as preferências padrão para agendamentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duração padrão</Label>
                  <Select 
                    value={String(defaultDuration)} 
                    onValueChange={(v) => setDefaultDuration(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Intervalo entre agendamentos</Label>
                  <Select 
                    value={String(minInterval)} 
                    onValueChange={(v) => setMinInterval(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Fuso horário</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button 
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </div>
        </>
      )}

      {/* Empty State */}
      {!selectedAgent && (
        <Card className="glass-card">
          <CardContent className="py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium text-foreground mt-4">Selecione um agente</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Escolha um agente acima para configurar seu calendário
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}