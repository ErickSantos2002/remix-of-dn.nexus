import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, Clock, MapPin, Video, User, Bell, AlertTriangle, Calendar as CalendarCheck } from "lucide-react";
import { format, addMinutes, setHours, setMinutes, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceHolidays } from "@/hooks/useWorkspaceHolidays";
import { AnalysisPlaybookSelect } from "@/components/crm/AnalysisPlaybookSelect";

const formSchema = z.object({
  lead_id: z.string().min(1, "Selecione um lead"),
  contact_id: z.string().min(1, "Selecione um contato"),
  title: z.string().min(1, "Título é obrigatório"),
  description: z.string().optional(),
  date: z.date({ required_error: "Selecione uma data" }),
  time: z.string().min(1, "Selecione um horário"),
  duration_minutes: z.number().min(15).max(480),
  location: z.string().optional(),
  meeting_link: z.string().optional(),
  assigned_to: z.string().optional(),
  calendar_owner_id: z.string().optional(),
  reminder_1_hours: z.number().optional(),
  reminder_2_hours: z.number().optional(),
  analysis_playbook_id: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: { id: string } | null;
  onSuccess: () => void;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  onSuccess,
}: AppointmentDialogProps) {
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isHoliday, getHolidayName } = useWorkspaceHolidays();
  const [enableReminder1, setEnableReminder1] = useState(true);
  const [notifyAttendees, setNotifyAttendees] = useState(true);
  const [enableReminder2, setEnableReminder2] = useState(true);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lead_id: "",
      contact_id: "",
      title: "",
      description: "",
      time: "09:00",
      duration_minutes: 30,
      location: "",
      meeting_link: "",
      assigned_to: "",
      calendar_owner_id: "",
      reminder_1_hours: 24,
      reminder_2_hours: 1,
      analysis_playbook_id: "",
    },
  });

  // Fetch leads
  const { data: leads = [] } = useQuery({
    queryKey: ["crm-leads-simple", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, title, contact:crm_contacts(id, name, phone)")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId && open,
  });

  // Fetch contacts
  const { data: contacts = [] } = useQuery({
    queryKey: ["crm-contacts-simple", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("id, name, phone, email")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId && open,
  });

  // Fetch team members
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
    enabled: !!workspaceId && open,
  });

  // Fetch Google Calendar integrations for this workspace
  const { data: calendarIntegrations = [] } = useQuery({
    queryKey: ["calendar-integrations", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from("crm_google_calendar_integration")
        .select("user_id, google_email, is_enabled")
        .eq("workspace_id", workspaceId)
        .eq("is_enabled", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!workspaceId && open,
  });

  // Check if selected assignee has Google Calendar connected
  const selectedAssignee = form.watch("assigned_to");
  const hasCalendarConnected = calendarIntegrations.some(
    (integration) => integration.user_id === selectedAssignee
  );

  // Get members with calendar integration for the calendar_owner selector
  const membersWithCalendar = teamMembers.filter((member) =>
    calendarIntegrations.some((integration) => integration.user_id === member.user_id)
  );

  // Auto-select calendar owner when assignee changes (if they have calendar)
  useEffect(() => {
    if (selectedAssignee && hasCalendarConnected) {
      form.setValue("calendar_owner_id", selectedAssignee);
    }
  }, [selectedAssignee, hasCalendarConnected, form]);

  // Create appointment mutation
  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;
      
      // Combine date and time
      const [hours, minutes] = data.time.split(":").map(Number);
      const startTime = setMinutes(setHours(data.date, hours), minutes);
      const endTime = addMinutes(startTime, data.duration_minutes);

      // Get contact info for email/calendar
      const selectedContact = contacts.find((c) => c.id === data.contact_id);
      const contactEmail = selectedContact?.email || null;
      const contactName = selectedContact?.name || "Cliente";

      // Get assignee info
      const assignee = teamMembers.find((m) => m.user_id === data.assigned_to);
      const assigneeName = assignee?.profiles?.name || assignee?.profiles?.email || null;
      const assigneeEmail = assignee?.profiles?.email || null;

      // Get creator info
      const creator = teamMembers.find((m) => m.user_id === currentUserId);
      const creatorName = creator?.profiles?.name || creator?.profiles?.email || null;
      const creatorEmail = creator?.profiles?.email || null;

      // Company name
      const companyName = currentCompany?.name || null;

      // Calendar owner (who will have the event in their calendar)
      const calendarOwnerId = data.calendar_owner_id || data.assigned_to;

      const appointmentData = {
        workspace_id: workspaceId,
        lead_id: data.lead_id,
        contact_id: data.contact_id,
        title: data.title,
        description: data.description || null,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration_minutes: data.duration_minutes,
        location: data.location || null,
        meeting_link: data.meeting_link || null,
        assigned_to: data.assigned_to || null,
        reminder_1_hours: enableReminder1 ? data.reminder_1_hours : null,
        reminder_2_hours: enableReminder2 ? data.reminder_2_hours : null,
        status: "scheduled",
        created_by: currentUserId,
        analysis_playbook_id: data.analysis_playbook_id || null,
      };

      // 1. Insert appointment in database
      const { data: result, error } = await supabase
        .from("crm_appointments")
        .insert(appointmentData)
        .select()
        .single();

      if (error) throw error;

      // Track success status for Google Calendar and Email
      let googleCalendarSuccess = false;
      const emailsSent: string[] = [];
      let meetingLink = data.meeting_link || null;

      // 2. Call Google Calendar (if calendar owner has integration)
      if (calendarOwnerId) {
        try {
          console.log("[AppointmentDialog] Calling google-calendar-create-event for calendar owner:", calendarOwnerId);
          
          // Build additional attendees list
          const additionalAttendees: string[] = [];
          
          // Add assignee if different from calendar owner
          if (assigneeEmail && data.assigned_to !== calendarOwnerId) {
            additionalAttendees.push(assigneeEmail);
          }
          
          // Add creator if different from calendar owner
          if (creatorEmail && currentUserId !== calendarOwnerId && !additionalAttendees.includes(creatorEmail)) {
            additionalAttendees.push(creatorEmail);
          }

          const calendarResponse = await supabase.functions.invoke('google-calendar-create-event', {
            body: {
              workspace_id: workspaceId,
              appointment_id: result.id,
              title: data.title,
              description: data.description || '',
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              attendee_email: contactEmail,
              additional_attendees: additionalAttendees,
              calendar_owner_id: calendarOwnerId,
              create_meet_link: true,
              notify_attendees: notifyAttendees
            }
          });

          if (calendarResponse.data?.success) {
            googleCalendarSuccess = true;
            console.log("[AppointmentDialog] Google Calendar event created:", calendarResponse.data);
            
            // Update meeting_link if Google returned one
            if (calendarResponse.data.meeting_link) {
              meetingLink = calendarResponse.data.meeting_link;
              await supabase
                .from('crm_appointments')
                .update({ meeting_link: meetingLink })
                .eq('id', result.id);
            }
          } else {
            console.log("[AppointmentDialog] Google Calendar not configured or error:", calendarResponse.data?.error);
          }
        } catch (e) {
          console.error('[AppointmentDialog] Error creating Google Calendar event:', e);
        }
      }

      // 3. Send confirmation emails to all involved parties
      const emailRecipients: Array<{ email: string; name: string; recipientType: string }> = [];

      // Contact/Lead
      if (contactEmail) {
        emailRecipients.push({
          email: contactEmail,
          name: contactName,
          recipientType: "contact"
        });
      }

      // Assignee (if has email)
      if (assigneeEmail && assigneeEmail !== contactEmail) {
        emailRecipients.push({
          email: assigneeEmail,
          name: assigneeName || "Vendedor",
          recipientType: "assignee"
        });
      }

      // Creator (if different from assignee and has email)
      if (creatorEmail && creatorEmail !== assigneeEmail && creatorEmail !== contactEmail) {
        emailRecipients.push({
          email: creatorEmail,
          name: creatorName || "Gestor",
          recipientType: "creator"
        });
      }

      // Send emails to each recipient
      for (const recipient of emailRecipients) {
        try {
          console.log(`[AppointmentDialog] Sending email to ${recipient.recipientType}:`, recipient.email);
          const emailResponse = await supabase.functions.invoke('send-appointment-email', {
            body: {
              type: 'confirmation',
              email: recipient.email,
              contactName: recipient.name,
              recipientType: recipient.recipientType,
              appointmentTitle: data.title,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              meetingLink: meetingLink,
              assigneeName: assigneeName,
              companyName: companyName,
              company_id: currentCompany?.id,
              // Additional context for internal recipients
              leadName: contactName,
              creatorName: creatorName
            }
          });

          if (!emailResponse.error) {
            emailsSent.push(recipient.recipientType);
            console.log(`[AppointmentDialog] Email sent to ${recipient.recipientType}`);
          } else {
            console.error(`[AppointmentDialog] Email error for ${recipient.recipientType}:`, emailResponse.error);
          }
        } catch (e) {
          console.error(`[AppointmentDialog] Error sending email to ${recipient.recipientType}:`, e);
        }
      }

      // 4. Create reminders ONLY if Google Calendar or Email was successful
      if ((googleCalendarSuccess || emailsSent.length > 0) && (enableReminder1 || enableReminder2)) {
        const reminders = [];
        if (enableReminder1 && data.reminder_1_hours) {
          reminders.push({
            appointment_id: result.id,
            reminder_type: "notification",
            scheduled_time: addMinutes(startTime, -data.reminder_1_hours * 60).toISOString(),
            status: "pending",
          });
        }
        if (enableReminder2 && data.reminder_2_hours) {
          reminders.push({
            appointment_id: result.id,
            reminder_type: "notification",
            scheduled_time: addMinutes(startTime, -data.reminder_2_hours * 60).toISOString(),
            status: "pending",
          });
        }

        if (reminders.length > 0) {
          await supabase.from("crm_appointment_reminders").insert(reminders);
        }
      }

      return { 
        result, 
        googleCalendarSuccess, 
        emailsSent,
        contactEmail 
      };
    },
    onSuccess: (data) => {
      // Build descriptive message
      let description = "O agendamento foi criado com sucesso.";
      const statusParts: string[] = [];
      
      if (data.googleCalendarSuccess) {
        statusParts.push("evento criado no calendario");
      }
      if (data.emailsSent.length > 0) {
        const emailCount = data.emailsSent.length;
        statusParts.push(`${emailCount} email${emailCount > 1 ? 's' : ''} enviado${emailCount > 1 ? 's' : ''}`);
      }
      
      if (statusParts.length > 0) {
        description = `Agendamento criado! ${statusParts.join(" e ").charAt(0).toUpperCase() + statusParts.join(" e ").slice(1)}.`;
      } else {
        // Explain why no notifications were sent
        const warnings: string[] = [];
        if (!data.googleCalendarSuccess) {
          warnings.push("Google Calendar nao configurado");
        }
        if (data.emailsSent.length === 0 && data.contactEmail) {
          warnings.push("erro ao enviar email");
        } else if (!data.contactEmail) {
          warnings.push("contato sem email");
        }
        
        if (warnings.length > 0) {
          description = `Agendamento criado. (${warnings.join(", ")})`;
        }
      }

      toast({
        title: "Agendamento criado",
        description,
      });
      form.reset();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: "Erro ao criar agendamento",
        description: error instanceof Error ? error.message : "Erro inesperado",
      });
    },
  });

  // Update lead selection to auto-select contact
  const handleLeadChange = (leadId: string) => {
    form.setValue("lead_id", leadId);
    const lead = leads.find((l) => l.id === leadId);
    if (lead?.contact?.id) {
      form.setValue("contact_id", lead.contact.id);
    }
  };

  const onSubmit = (data: FormData) => {
    if (isHoliday(data.date)) {
      toast({
        title: "Data bloqueada",
        description: `${getHolidayName(data.date) ?? "Feriado"} — não é possível agendar nesta data.`,
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(data);
  };


  const timeOptions = Array.from({ length: 24 }, (_, i) => {
    const hour = String(i).padStart(2, "0");
    return [`${hour}:00`, `${hour}:30`];
  }).flat();

  const durationOptions = [
    { value: 15, label: "15 minutos" },
    { value: 30, label: "30 minutos" },
    { value: 45, label: "45 minutos" },
    { value: 60, label: "1 hora" },
    { value: 90, label: "1h 30min" },
    { value: 120, label: "2 horas" },
  ];

  const reminderOptions = [
    { value: 1, label: "1 hora antes" },
    { value: 2, label: "2 horas antes" },
    { value: 24, label: "1 dia antes" },
    { value: 48, label: "2 dias antes" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Novo Agendamento
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Lead */}
            <FormField
              control={form.control}
              name="lead_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead</FormLabel>
                  <Select onValueChange={handleLeadChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um lead" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {leads.map((lead) => (
                        <SelectItem key={lead.id} value={lead.id}>
                          {lead.contact?.name || lead.title || "Lead sem nome"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Contact */}
            <FormField
              control={form.control}
              name="contact_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contato</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um contato" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {contacts.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.name} - {contact.phone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Reuniao de Alinhamento" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descricao (opcional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Detalhes do agendamento..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date and Time */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "dd/MM/yyyy", { locale: ptBR })
                            ) : (
                              <span>Selecione</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Horario</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <Clock className="h-4 w-4 mr-2" />
                          <SelectValue placeholder="Horario" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[200px]">
                        {timeOptions.map((time) => (
                          <SelectItem key={time} value={time}>
                            {time}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Duration */}
            <FormField
              control={form.control}
              name="duration_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duração</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Duracao" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {durationOptions.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Análise de atendimento aplicada à transcrição da reunião */}
            <FormField
              control={form.control}
              name="analysis_playbook_id"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <AnalysisPlaybookSelect
                      activityType="meeting"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Location / Meeting Link */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5" />
                      Local
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Endereco..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="meeting_link"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Video className="h-3.5 w-3.5" />
                      Link da reuniao
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="https://meet..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Assigned To */}
            <FormField
              control={form.control}
              name="assigned_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5" />
                    Atribuir a
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um responsavel" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teamMembers.map((member) => (
                        <SelectItem key={member.user_id} value={member.user_id}>
                          <div className="flex items-center gap-2">
                            {member.profiles?.name || member.profiles?.email}
                            {calendarIntegrations.some((i) => i.user_id === member.user_id) && (
                              <CalendarCheck className="h-3 w-3 text-success" />
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Calendar Connection Warning */}
            {selectedAssignee && !hasCalendarConnected && (
              <Alert className="border-warning/30 bg-warning/5">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription className="text-sm text-muted-foreground">
                  Este vendedor nao possui Google Calendar conectado. O evento nao sera criado automaticamente na agenda.
                </AlertDescription>
              </Alert>
            )}

            {/* Calendar Owner Selection (only show if there are calendars available) */}
            {membersWithCalendar.length > 0 && (
              <FormField
                control={form.control}
                name="calendar_owner_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <CalendarCheck className="h-3.5 w-3.5" />
                      Criar evento na agenda de
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma agenda" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {membersWithCalendar.map((member) => {
                          const integration = calendarIntegrations.find(
                            (i) => i.user_id === member.user_id
                          );
                          return (
                            <SelectItem key={member.user_id} value={member.user_id}>
                              {member.profiles?.name || member.profiles?.email}
                              {integration?.google_email && (
                                <span className="text-muted-foreground ml-2">
                                  ({integration.google_email})
                                </span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <CalendarCheck className="h-3.5 w-3.5 text-primary" />
                Notificar convidados por e-mail
              </div>
              <Switch checked={notifyAttendees} onCheckedChange={setNotifyAttendees} />
            </div>



            {/* Reminders */}
            <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4 text-primary" />
                Lembretes
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">1o Lembrete</span>
                <div className="flex items-center gap-2">
                  <Switch checked={enableReminder1} onCheckedChange={setEnableReminder1} />
                  {enableReminder1 && (
                    <FormField
                      control={form.control}
                      name="reminder_1_hours"
                      render={({ field }) => (
                        <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {reminderOptions.map((opt) => (
                              <SelectItem key={opt.value} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">2o Lembrete</span>
                <div className="flex items-center gap-2">
                  <Switch checked={enableReminder2} onCheckedChange={setEnableReminder2} />
                  {enableReminder2 && (
                    <FormField
                      control={form.control}
                      name="reminder_2_hours"
                      render={({ field }) => (
                        <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                          <SelectTrigger className="w-[140px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {reminderOptions.map((opt) => (
                              <SelectItem key={opt.value} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Salvando..." : "Criar Agendamento"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
