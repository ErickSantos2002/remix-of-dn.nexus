import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showBrowserNotification } from "@/lib/notificationSound";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function useAppointmentReminders() {
  const { workspaceId } = useWorkspace();
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [userId, setUserId] = useState<string | null>(null);
  const notified5min = useRef(new Set<string>());
  const notified1min = useRef(new Set<string>());
  const notifiedNew = useRef(new Set<string>());

  // Get user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // Request permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // Don't auto-request, let the banner handle it
    }
    setPermissionStatus(
      typeof Notification !== "undefined" ? Notification.permission : "denied"
    );
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermissionStatus(result);
  }, []);

  const insertNotification = useCallback(
    async (type: string, title: string, message: string, appointmentId?: string) => {
      if (!userId || !workspaceId) return;
      await supabase.from("user_notifications").insert({
        user_id: userId,
        workspace_id: workspaceId,
        type,
        title,
        message,
        action_url: appointmentId
          ? `/crm/appointments?appointment=${appointmentId}`
          : "/crm/appointments",
        is_read: false,
      });
    },
    [userId, workspaceId]
  );

  // Polling every 30s for upcoming appointments
  useEffect(() => {
    if (!userId || !workspaceId) return;

    const checkReminders = async () => {
      const now = new Date();
      const in10min = new Date(now.getTime() + 10 * 60 * 1000);

      const { data: appointments } = await supabase
        .from("crm_appointments")
        .select("id, title, start_time, assigned_to")
        .eq("workspace_id", workspaceId)
        .eq("assigned_to", userId)
        .eq("status", "scheduled")
        .gte("start_time", now.toISOString())
        .lte("start_time", in10min.toISOString());

      if (!appointments) return;

      for (const apt of appointments) {
        const startTime = new Date(apt.start_time);
        const diffMs = startTime.getTime() - now.getTime();
        const diffMin = diffMs / 60000;
        const timeStr = format(startTime, "HH:mm", { locale: ptBR });

        // 1-minute alert
        if (diffMin <= 1 && diffMin > 0 && !notified1min.current.has(apt.id)) {
          notified1min.current.add(apt.id);
          showBrowserNotification(
            "Reuniao em 1 minuto",
            `${apt.title} - ${timeStr}`,
            () => { window.location.href = `/crm/appointments?appointment=${apt.id}`; }
          );
          insertNotification(
            "appointment_reminder_1min",
            "Reuniao em 1 minuto",
            `${apt.title} comeca as ${timeStr}`,
            apt.id
          );
        }
        // 5-minute alert
        else if (diffMin <= 5 && diffMin > 1 && !notified5min.current.has(apt.id)) {
          notified5min.current.add(apt.id);
          showBrowserNotification(
            "Reuniao em 5 minutos",
            `${apt.title} - ${timeStr}`,
            () => { window.location.href = `/crm/appointments?appointment=${apt.id}`; }
          );
          insertNotification(
            "appointment_reminder_5min",
            "Reuniao em 5 minutos",
            `${apt.title} comeca as ${timeStr}`,
            apt.id
          );
        }
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [userId, workspaceId, insertNotification]);

  // Realtime: new appointments assigned to user
  useEffect(() => {
    if (!userId || !workspaceId) return;

    const channel = supabase
      .channel(`appointment-reminders-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_appointments",
          filter: `assigned_to=eq.${userId}`,
        },
        (payload) => {
          const apt = payload.new as any;
          if (notifiedNew.current.has(apt.id)) return;
          notifiedNew.current.add(apt.id);

          const startTime = new Date(apt.start_time);
          const timeStr = format(startTime, "dd/MM HH:mm", { locale: ptBR });

          showBrowserNotification(
            "Nova reuniao agendada",
            `${apt.title} - ${timeStr}`,
            () => { window.location.href = `/crm/appointments?appointment=${apt.id}`; }
          );
          insertNotification(
            "new_appointment",
            "Nova reuniao agendada",
            `${apt.title} em ${timeStr}`,
            apt.id
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, workspaceId, insertNotification]);

  return { permissionStatus, requestPermission };
}
