import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Polls crm_lead_activities every 30s for activities assigned to the current user
 * whose scheduled_at is within the next 10 minutes. Inserts a user_notifications
 * row (type=activity_reminder_10min) once per activity, which then triggers the
 * realtime browser notification flow in NotificationBell.
 */
export function useActivityReminders() {
  const [userId, setUserId] = useState<string | null>(null);
  const notified10min = useRef(new Set<string>());

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;

    const check = async () => {
      const now = new Date();
      const in11min = new Date(now.getTime() + 11 * 60 * 1000);

      const { data: activities } = await supabase
        .from("crm_lead_activities")
        .select("id, title, type, scheduled_at, lead_id, workspace_id")
        .eq("assigned_to", userId)
        .eq("status", "pending")
        .not("scheduled_at", "is", null)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", in11min.toISOString());

      if (!activities) return;

      for (const act of activities) {
        if (!act.scheduled_at) continue;
        if (notified10min.current.has(act.id)) continue;

        const startTime = new Date(act.scheduled_at);
        const diffMin = (startTime.getTime() - now.getTime()) / 60000;
        if (diffMin > 10 || diffMin <= 0) continue;

        notified10min.current.add(act.id);

        const timeStr = startTime.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });

        await supabase.from("user_notifications").insert({
          user_id: userId,
          workspace_id: act.workspace_id,
          type: "activity_reminder_10min",
          title: "Atividade em 10 minutos",
          message: `${act.title} - ${timeStr}`,
          action_url: `/crm/pipeline?lead=${act.lead_id}&activity=${act.id}`,
          related_lead_id: act.lead_id,
          is_read: false,
        });
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [userId]);
}
