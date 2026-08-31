import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NotificationPermissionBannerProps {
  permissionStatus: NotificationPermission;
  onRequestPermission: () => void;
}

export function NotificationPermissionBanner({
  permissionStatus,
  onRequestPermission,
}: NotificationPermissionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [currentPermission, setCurrentPermission] = useState(permissionStatus);

  // Keep in sync with prop and also re-check on mount
  useEffect(() => {
    setCurrentPermission(permissionStatus);
  }, [permissionStatus]);

  // Also check directly on mount in case the prop was stale
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setCurrentPermission(Notification.permission);
    }
  }, []);

  // Don't show if notifications are not supported
  if (typeof Notification === "undefined") return null;

  // Don't show if already granted/denied or dismissed
  if (currentPermission !== "default" || dismissed) return null;

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-between gap-3 z-50">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Bell className="h-4 w-4 text-primary" />
        <span>Ative as notificacoes para receber alertas de reunioes e mensagens</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs"
          onClick={() => {
            onRequestPermission();
            // Re-check after a short delay
            setTimeout(() => {
              if (typeof Notification !== "undefined") {
                setCurrentPermission(Notification.permission);
              }
            }, 1000);
          }}
        >
          Ativar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}