import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Calendar as CalendarIcon, 
  Plus, 
  ChevronLeft, 
  ChevronRight,
  Clock,
  MapPin,
  Video,
  User,
  Filter,
  Search,
  CalendarX,
  FileText
} from "lucide-react";
import { HolidaysDialog } from "@/components/appointments/HolidaysDialog";
import { ExportTranscriptsDialog } from "@/components/appointments/ExportTranscriptsDialog";
import { useWorkspaceHolidays } from "@/hooks/useWorkspaceHolidays";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, setHours, setMinutes, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppointmentDialog } from "@/components/appointments/AppointmentDialog";
import { AppointmentDetailSheet } from "@/components/appointments/AppointmentDetailSheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "day" | "week" | "month";

interface Appointment {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  location: string | null;
  meeting_link: string | null;
  status: string;
  google_event_id: string | null;
  is_synced_to_google: boolean;
  notes: string | null;
  lead_id: string;
  contact_id: string;
  assigned_to: string | null;
  workspace_id: string;
  reminder_1_hours: number | null;
  reminder_2_hours: number | null;
  reminder_1_sent: boolean;
  reminder_2_sent: boolean;
  contact?: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };
  lead?: {
    id: string;
    title: string | null;
  };
  assignee?: {
    id: string;
    name: string | null;
    email: string;
  };
}

export default function CRMAppointments() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [dayAppointmentsOpen, setDayAppointmentsOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [exportTranscriptsOpen, setExportTranscriptsOpen] = useState(false);
  const { isHoliday, getHolidayName } = useWorkspaceHolidays();
  const [searchParams, setSearchParams] = useSearchParams();
  const appointmentIdFromUrl = searchParams.get("appointment");
  // Open appointment detail when URL has ?appointment=ID
  useEffect(() => {
    if (!appointmentIdFromUrl) return;
    if (selectedAppointment?.id === appointmentIdFromUrl && isDetailOpen) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("crm_appointments")
        .select("*")
        .eq("id", appointmentIdFromUrl)
        .maybeSingle();
      if (!cancelled && data) {
        setSelectedAppointment(data as Appointment);
        setIsDetailOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, [appointmentIdFromUrl]);


  // Fetch appointments
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["crm-appointments", workspaceId, currentDate, viewMode],
    queryFn: async () => {
      if (!workspaceId) return [];
      
      let startDate: Date, endDate: Date;
      
      if (viewMode === "month") {
        startDate = startOfMonth(currentDate);
        endDate = endOfMonth(currentDate);
      } else if (viewMode === "week") {
        startDate = startOfWeek(currentDate, { locale: ptBR });
        endDate = endOfWeek(currentDate, { locale: ptBR });
      } else {
        startDate = new Date(currentDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(currentDate);
        endDate.setHours(23, 59, 59, 999);
      }
      
      const { data, error } = await supabase
        .from("crm_appointments")
        .select(`
          *,
          contact:crm_contacts(id, name, phone, email),
          lead:crm_leads(id, title),
          assignee:profiles!crm_appointments_assigned_to_fkey(id, name, email)
        `)
        .eq("workspace_id", workspaceId)
        .gte("start_time", startDate.toISOString())
        .lte("start_time", endDate.toISOString())
        .order("start_time", { ascending: true });
        
      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !!workspaceId,
  });

  // Fetch team members for filter
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      
      const { data, error } = await supabase
        .from("workspace_members")
        .select("user_id, profiles:profiles!workspace_members_user_id_fkey(id, name, email)")
        .eq("workspace_id", workspaceId);
        
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  // Filter appointments
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const matchesSearch = !searchTerm || 
        apt.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        apt.contact?.name?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || apt.status === statusFilter;
      const matchesAssignee = assigneeFilter === "all" || apt.assigned_to === assigneeFilter;
      
      return matchesSearch && matchesStatus && matchesAssignee;
    });
  }, [appointments, searchTerm, statusFilter, assigneeFilter]);

  // Navigation handlers
  const navigatePrevious = () => {
    if (viewMode === "month") {
      setCurrentDate(subMonths(currentDate, 1));
    } else if (viewMode === "week") {
      setCurrentDate(subWeeks(currentDate, 1));
    } else {
      setCurrentDate(subDays(currentDate, 1));
    }
  };

  const navigateNext = () => {
    if (viewMode === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else if (viewMode === "week") {
      setCurrentDate(addWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Get appointments for a specific day
  const getAppointmentsForDay = (day: Date) => {
    return filteredAppointments.filter(apt => 
      isSameDay(parseISO(apt.start_time), day)
    );
  };

  // Status badge color - considers past meetings as successful
  const getStatusColor = (status: string, endTime?: string) => {
    const isPastMeeting = endTime && new Date(endTime) < new Date();
    const wasSuccessful = isPastMeeting && (status === "scheduled" || status === "confirmed");
    
    if (wasSuccessful) {
      return "bg-success/20 text-success border-success/30";
    }
    
    switch (status) {
      case "scheduled": return "bg-primary/20 text-primary border-primary/30";
      case "confirmed": return "bg-success/20 text-success border-success/30";
      case "completed": return "bg-success/20 text-success border-success/30";
      case "cancelled": return "bg-destructive/20 text-destructive border-destructive/30";
      case "no_show": return "bg-warning/20 text-warning border-warning/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string, endTime?: string) => {
    const isPastMeeting = endTime && new Date(endTime) < new Date();
    const wasSuccessful = isPastMeeting && (status === "scheduled" || status === "confirmed");
    
    if (wasSuccessful) {
      return "Realizada";
    }
    
    switch (status) {
      case "scheduled": return "Agendado";
      case "confirmed": return "Confirmado";
      case "completed": return "Concluído";
      case "cancelled": return "Cancelado";
      case "no_show": return "Não compareceu";
      default: return status;
    }
  };

  // Render month view
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { locale: ptBR });
    const calendarEnd = endOfWeek(monthEnd, { locale: ptBR });
    
    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    
    return (
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Week day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {weekDays.map(day => (
            <div key={day} className="p-2 text-center text-xs font-medium text-muted-foreground bg-muted/30">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const dayAppointments = getAppointmentsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isToday = isSameDay(day, new Date());
            const dayIsHoliday = isHoliday(day);
            const holidayName = dayIsHoliday ? getHolidayName(day) : null;
            
            return (
              <div
                key={index}
                title={holidayName ? `Feriado: ${holidayName}` : undefined}
                className={cn(
                  "min-h-[100px] border-b border-r border-border p-1 transition-colors",
                  !isCurrentMonth && "bg-muted/20",
                  isToday && "bg-primary/5",
                  dayIsHoliday && "bg-destructive/10"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={cn(
                    "text-xs font-medium h-6 w-6 flex items-center justify-center rounded-full",
                    isToday && "bg-primary text-primary-foreground",
                    !isToday && !isCurrentMonth && "text-muted-foreground",
                    !isToday && isCurrentMonth && "text-foreground"
                  )}>
                    {format(day, "d")}
                  </div>
                  {dayIsHoliday && (
                    <span className="text-[9px] uppercase font-semibold text-destructive px-1 rounded bg-destructive/15 truncate max-w-[70%]">
                      {holidayName}
                    </span>
                  )}
                </div>
                
                
                <div className="space-y-0.5">
                  {dayAppointments.slice(0, 3).map(apt => (
                    <button
                      key={apt.id}
                      onClick={() => {
                        setSelectedAppointment(apt);
                        setIsDetailOpen(true);
                      }}
                      className={cn(
                        "w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate transition-all hover:ring-1 ring-primary",
                        getStatusColor(apt.status, apt.end_time)
                      )}
                    >
                      {format(parseISO(apt.start_time), "HH:mm")} {apt.contact?.name || apt.title}
                    </button>
                  ))}
                  {dayAppointments.length > 3 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDay(day);
                        setDayAppointmentsOpen(true);
                      }}
                      className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted/40 transition-colors"
                    >
                      +{dayAppointments.length - 3} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render week view
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { locale: ptBR });
    const days = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
    const hours = Array.from({ length: 12 }, (_, i) => i + 8); // 8:00 - 19:00
    
    return (
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Header with days */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
          <div className="p-2 bg-muted/30" />
          {days.map(day => (
            <div 
              key={day.toISOString()} 
              className={cn(
                "p-2 text-center border-l border-border bg-muted/30",
                isSameDay(day, new Date()) && "bg-primary/10"
              )}
            >
              <div className="text-xs text-muted-foreground">
                {format(day, "EEE", { locale: ptBR })}
              </div>
              <div className={cn(
                "text-sm font-medium",
                isSameDay(day, new Date()) && "text-primary"
              )}>
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
        
        {/* Time slots */}
        <div className="max-h-[600px] overflow-y-auto">
          {hours.map(hour => (
            <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
              <div className="p-2 text-xs text-muted-foreground text-right pr-3 bg-muted/10">
                {String(hour).padStart(2, "0")}:00
              </div>
              {days.map(day => {
                const hourAppointments = filteredAppointments.filter(apt => {
                  const aptDate = parseISO(apt.start_time);
                  return isSameDay(aptDate, day) && aptDate.getHours() === hour;
                });
                
                return (
                  <div 
                    key={`${day.toISOString()}-${hour}`} 
                    className="min-h-[50px] border-l border-border p-0.5 relative"
                  >
                    {hourAppointments.map(apt => (
                      <button
                        key={apt.id}
                        onClick={() => {
                          setSelectedAppointment(apt);
                          setIsDetailOpen(true);
                        }}
                      className={cn(
                          "absolute left-0.5 right-0.5 text-[10px] px-1.5 py-1 rounded text-left truncate transition-all hover:ring-1 ring-primary z-10",
                          getStatusColor(apt.status, apt.end_time)
                        )}
                        style={{
                          top: `${(parseISO(apt.start_time).getMinutes() / 60) * 100}%`,
                          height: `${Math.min((apt.duration_minutes / 60) * 100, 100)}%`,
                          minHeight: "20px"
                        }}
                      >
                        {apt.contact?.name || apt.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render day view
  const renderDayView = () => {
    const hours = Array.from({ length: 12 }, (_, i) => i + 8); // 8:00 - 19:00
    
    return (
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          {hours.map(hour => {
            const hourAppointments = filteredAppointments.filter(apt => {
              const aptDate = parseISO(apt.start_time);
              return isSameDay(aptDate, currentDate) && aptDate.getHours() === hour;
            });
            
            return (
              <div key={hour} className="flex border-b border-border">
                <div className="w-16 p-3 text-sm text-muted-foreground text-right bg-muted/10 flex-shrink-0">
                  {String(hour).padStart(2, "0")}:00
                </div>
                <div className="flex-1 min-h-[60px] p-1 relative">
                  {hourAppointments.map(apt => (
                    <button
                      key={apt.id}
                      onClick={() => {
                        setSelectedAppointment(apt);
                        setIsDetailOpen(true);
                      }}
                      className={cn(
                        "w-full text-left p-2 rounded-lg mb-1 transition-all hover:ring-2 ring-primary",
                        getStatusColor(apt.status, apt.end_time)
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="text-xs font-medium">
                          {format(parseISO(apt.start_time), "HH:mm")} - {format(parseISO(apt.end_time), "HH:mm")}
                        </span>
                      </div>
                      <div className="font-medium text-sm mt-1">{apt.contact?.name || apt.title}</div>
                      <div className="text-xs opacity-80">{apt.title}</div>
                      {apt.meeting_link && (
                        <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                          <Video className="h-3 w-3" />
                          <span>Reunião online</span>
                        </div>
                      )}
                      {apt.location && (
                        <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                          <MapPin className="h-3 w-3" />
                          <span>{apt.location}</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Get current date display
  const getDateDisplay = () => {
    if (viewMode === "month") {
      return format(currentDate, "MMMM yyyy", { locale: ptBR });
    } else if (viewMode === "week") {
      const weekStart = startOfWeek(currentDate, { locale: ptBR });
      const weekEnd = endOfWeek(currentDate, { locale: ptBR });
      return `${format(weekStart, "d MMM", { locale: ptBR })} - ${format(weekEnd, "d MMM yyyy", { locale: ptBR })}`;
    } else {
      return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" />
            Agendamentos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie seus agendamentos e reuniões
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setExportTranscriptsOpen(true)} className="gap-2">
            <FileText className="h-4 w-4" />
            Exportar transcrições
          </Button>
          <Button variant="outline" onClick={() => setHolidaysOpen(true)} className="gap-2">
            <CalendarX className="h-4 w-4" />
            Feriados
          </Button>
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Novo Agendamento
          </Button>
        </div>
      </div>

      {/* Filters and View Toggle */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={navigatePrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <Button variant="outline" size="icon" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold capitalize ml-2">
            {getDateDisplay()}
          </span>
        </div>

        {/* View Mode */}
        <div className="flex items-center gap-4">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="day" className="text-xs px-3">Dia</TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-3">Semana</TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-3">Mês</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar agendamento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="scheduled">Agendado</SelectItem>
            <SelectItem value="confirmed">Confirmado</SelectItem>
            <SelectItem value="completed">Concluído</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
            <SelectItem value="no_show">Não compareceu</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[180px]">
            <User className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {teamMembers.map((member: any) => (
              <SelectItem key={member.user_id} value={member.user_id}>
                {member.profiles?.name || member.profiles?.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Calendar View */}
      {isLoading ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground mt-4">Carregando agendamentos...</p>
        </div>
      ) : (
        <>
          {viewMode === "month" && renderMonthView()}
          {viewMode === "week" && renderWeekView()}
          {viewMode === "day" && renderDayView()}
        </>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold font-mono text-foreground">
              {filteredAppointments.length}
            </div>
            <div className="text-xs text-muted-foreground">Total no período</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold font-mono text-primary">
              {filteredAppointments.filter(a => a.status === "scheduled").length}
            </div>
            <div className="text-xs text-muted-foreground">Agendados</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold font-mono text-success">
              {filteredAppointments.filter(a => a.status === "confirmed").length}
            </div>
            <div className="text-xs text-muted-foreground">Confirmados</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="text-2xl font-bold font-mono text-muted-foreground">
              {filteredAppointments.filter(a => a.status === "completed").length}
            </div>
            <div className="text-xs text-muted-foreground">Concluídos</div>
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <HolidaysDialog open={holidaysOpen} onOpenChange={setHolidaysOpen} />
      <ExportTranscriptsDialog open={exportTranscriptsOpen} onOpenChange={setExportTranscriptsOpen} />

      <AppointmentDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        appointment={null}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
        }}
      />

      {selectedAppointment && (
        <AppointmentDetailSheet
          open={isDetailOpen}
          onOpenChange={(open) => {
            setIsDetailOpen(open);
            if (!open && appointmentIdFromUrl) {
              searchParams.delete("appointment");
              setSearchParams(searchParams, { replace: true });
            }
          }}
          appointment={selectedAppointment}
          onEdit={() => {
            setIsDetailOpen(false);
            setIsDialogOpen(true);
          }}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ["crm-appointments"] });
          }}
        />
      )}

      <Dialog open={dayAppointmentsOpen} onOpenChange={setDayAppointmentsOpen}>
        <DialogContent className="max-w-2xl glass-card">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {selectedDay
                ? format(selectedDay, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
                : "Agendamentos do dia"}
            </DialogTitle>
            {selectedDay && (
              <p className="text-sm text-muted-foreground">
                {getAppointmentsForDay(selectedDay).length} agendamento(s)
              </p>
            )}
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-2 pr-1">
            {selectedDay &&
              getAppointmentsForDay(selectedDay)
                .sort((a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime())
                .map((apt) => (
                  <button
                    key={apt.id}
                    onClick={() => {
                      setDayAppointmentsOpen(false);
                      setSelectedAppointment(apt);
                      setIsDetailOpen(true);
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all hover:ring-2 ring-primary",
                      getStatusColor(apt.status, apt.end_time)
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="text-xs font-medium font-mono">
                          {format(parseISO(apt.start_time), "HH:mm")} - {format(parseISO(apt.end_time), "HH:mm")}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wide opacity-80">
                        {getStatusLabel(apt.status, apt.end_time)}
                      </span>
                    </div>
                    <div className="font-medium text-sm mt-1">
                      {apt.contact?.name || apt.title}
                    </div>
                    {apt.contact?.name && (
                      <div className="text-xs opacity-80">{apt.title}</div>
                    )}
                    {apt.meeting_link && (
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                        <Video className="h-3 w-3" />
                        <span>Reunião online</span>
                      </div>
                    )}
                    {apt.location && (
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                        <MapPin className="h-3 w-3" />
                        <span>{apt.location}</span>
                      </div>
                    )}
                    {apt.assignee?.name && (
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                        <User className="h-3 w-3" />
                        <span>{apt.assignee.name}</span>
                      </div>
                    )}
                  </button>
                ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}