import { useState } from "react";
import { Bell, Volume2, Clock, CalendarPlus, ShieldCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { playNotificationSound, showBrowserNotification } from "@/lib/notificationSound";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export default function AdminNotificationsTest() {
  const { workspaceId } = useWorkspace();
  const [permissionStatus, setPermissionStatus] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const requestPermission = async () => {
    if (typeof Notification === "undefined") {
      toast({ title: "Erro", description: "Browser nao suporta notificacoes", variant: "destructive" });
      return;
    }
    const result = await Notification.requestPermission();
    setPermissionStatus(result);
    toast({ title: "Permissao", description: `Status: ${result}` });
  };

  const testSound = () => {
    playNotificationSound();
    toast({ title: "Som tocado", description: "Voce ouviu o ding?" });
  };

  const testBrowserNotification = () => {
    showBrowserNotification(
      "Teste de Notificacao",
      "Esta e uma notificacao de teste do Nexus AI",
      () => toast({ title: "Clicou na notificacao" })
    );
    toast({ title: "Notificacao enviada", description: "Verifique o browser" });
  };

  const simulateAlert = async (type: string, title: string, message: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !workspaceId) {
      toast({ title: "Erro", description: "Usuario ou workspace nao encontrado", variant: "destructive" });
      return;
    }

    showBrowserNotification(title, message);

    const { error } = await supabase.from("user_notifications").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      type,
      title,
      message,
      is_read: false,
    });

    if (error) {
      toast({ title: "Erro ao inserir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Alerta simulado", description: `Tipo: ${type}` });
    }
  };

  const getStatusColor = () => {
    switch (permissionStatus) {
      case "granted": return "text-success";
      case "denied": return "text-destructive";
      default: return "text-warning";
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Teste de Notificacoes
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pagina exclusiva para super admins testarem o sistema de alertas
        </p>
      </div>

      {/* Permission Status */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Permissao do Browser</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status atual:</span>
          <Badge variant="outline" className={getStatusColor()}>
            {permissionStatus}
          </Badge>
        </div>
        <Button size="sm" onClick={requestPermission} className="gap-2">
          <Bell className="h-4 w-4" />
          Solicitar Permissao
        </Button>
      </div>

      {/* Test Sound */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Testar Som</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Toca o som de notificacao (Web Audio API)
        </p>
        <Button size="sm" variant="outline" onClick={testSound} className="gap-2">
          <Volume2 className="h-4 w-4" />
          Tocar Som
        </Button>
      </div>

      {/* Test Browser Notification */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Testar Browser Notification</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Dispara uma notificacao nativa do browser com som
        </p>
        <Button size="sm" variant="outline" onClick={testBrowserNotification} className="gap-2">
          <Send className="h-4 w-4" />
          Enviar Notificacao
        </Button>
      </div>

      {/* Simulate Alerts */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-warning" />
          <h2 className="font-semibold text-foreground">Simular Alertas de Reuniao</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Cria notificacoes in-app e dispara browser notifications
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => simulateAlert(
              "appointment_reminder_5min",
              "Reuniao em 5 minutos",
              "Reuniao de Alinhamento comeca as 14:30"
            )}
          >
            <Clock className="h-4 w-4 text-warning" />
            Alerta 5min
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => simulateAlert(
              "appointment_reminder_1min",
              "Reuniao em 1 minuto",
              "Reuniao de Alinhamento comeca as 14:30"
            )}
          >
            <Clock className="h-4 w-4 text-destructive" />
            Alerta 1min
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => simulateAlert(
              "new_appointment",
              "Nova reuniao agendada",
              "Demo do Produto - 20/03 as 10:00"
            )}
          >
            <CalendarPlus className="h-4 w-4 text-success" />
            Nova Reuniao
          </Button>
        </div>
      </div>
    </div>
  );
}
