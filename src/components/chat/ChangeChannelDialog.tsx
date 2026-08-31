import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Globe, Wifi, WifiOff, Check, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ConnectionOption {
  id: string;
  name: string;
  type: "zapi" | "whatsapp_official" | "widget";
  phone?: string | null;
  connected?: boolean | null;
  is_active?: boolean | null;
}

interface ChangeChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  workspaceId: string;
  currentConnectionId: string | null;
  currentSource: string | null;
  onChannelChanged: (newConnectionId: string, connectionName: string, connectionType: "zapi" | "whatsapp_official") => void;
}

export function ChangeChannelDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  leadPhone,
  workspaceId,
  currentConnectionId,
  currentSource,
  onChannelChanged,
}: ChangeChannelDialogProps) {
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchConnections = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch connection_workspaces for this workspace
      const { data: cw } = await supabase
        .from("connection_workspaces")
        .select("connection_id, connection_type")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true);

      if (!cw || cw.length === 0) {
        setConnections([]);
        setIsLoading(false);
        return;
      }

      const results: ConnectionOption[] = [];

      // Separate by type
      const zapiIds = cw.filter(c => c.connection_type === "zapi").map(c => c.connection_id);
      const officialIds = cw.filter(c => c.connection_type === "whatsapp_official").map(c => c.connection_id);

      if (zapiIds.length > 0) {
        const { data: zapiConns } = await supabase
          .from("zapi_connections")
          .select("id, instance_name, zapi_instance_name, phone_number, zapi_connected, is_active")
          .in("id", zapiIds);

        if (zapiConns) {
          for (const zc of zapiConns) {
            results.push({
              id: zc.id,
              name: zc.zapi_instance_name || zc.instance_name || "Z-API",
              type: "zapi",
              phone: zc.phone_number,
              connected: zc.zapi_connected,
              is_active: zc.is_active,
            });
          }
        }
      }

      if (officialIds.length > 0) {
        const { data: officialConns } = await supabase
          .from("whatsapp_connections")
          .select("id, phone_number_id, display_phone_number, verified_name, is_active")
          .in("id", officialIds);

        if (officialConns) {
          for (const wc of officialConns) {
            const displayName = wc.verified_name || "WhatsApp Official";
            const displayPhone = wc.display_phone_number || wc.phone_number_id;
            results.push({
              id: wc.id,
              name: displayPhone ? `${displayName} (${displayPhone})` : displayName,
              type: "whatsapp_official",
              phone: displayPhone,
              connected: true,
              is_active: wc.is_active,
            });
          }
        }
      }

      setConnections(results);
    } catch (err) {
      console.error("[ChangeChannelDialog] Error fetching connections:", err);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }
    void fetchConnections();
  }, [fetchConnections, open]);

  const getSourceLabel = () => {
    if (currentSource?.startsWith("Widget:")) return currentSource.replace("Widget:", "Widget: ");
    if (currentConnectionId) {
      const conn = connections.find(c => c.id === currentConnectionId);
      if (conn) return conn.name;
      return "Conexao atual";
    }
    return currentSource || "Desconhecido";
  };

  const handleSwitch = async () => {
    if (!selectedId) return;
    if (!leadPhone) {
      toast({
        title: "Telefone obrigatório",
        description: "O lead precisa ter um número de telefone para trocar para um canal WhatsApp.",
        variant: "destructive",
      });
      return;
    }
    setIsSwitching(true);

    try {
      const targetConn = connections.find(c => c.id === selectedId);
      if (!targetConn) throw new Error("Conexao nao encontrada");

      const cleanPhone = leadPhone.replace(/\D/g, "");

      // 1. Prepare the target conversation before disabling the current channel.
      // WhatsApp Official enforces UNIQUE(connection_id, phone_number), so an
      // inactive conversation must be reused instead of inserted again.
      let targetConversationId: string;

      if (targetConn.type === "whatsapp_official") {
        const { data: existingConversation, error: findErr } = await supabase
          .from("whatsapp_conversations")
          .select("id")
          .eq("connection_id", selectedId)
          .eq("phone_number", cleanPhone)
          .maybeSingle();
        if (findErr) throw findErr;

        if (existingConversation) {
          const { error: updateErr } = await supabase
            .from("whatsapp_conversations")
            .update({
              lead_id: leadId,
              workspace_id: workspaceId,
              is_active: true,
              last_message_at: new Date().toISOString(),
            })
            .eq("id", existingConversation.id);
          if (updateErr) throw updateErr;
          targetConversationId = existingConversation.id;
        } else {
          const { data: insertedConversation, error: insertErr } = await supabase
            .from("whatsapp_conversations")
            .insert({
              lead_id: leadId,
              connection_id: selectedId,
              workspace_id: workspaceId,
              phone_number: cleanPhone,
              is_active: true,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          targetConversationId = insertedConversation.id;
        }
      } else {
        const { data: existingConversations, error: findErr } = await supabase
          .from("zapi_conversations")
          .select("id")
          .eq("connection_id", selectedId)
          .eq("phone_number", cleanPhone)
          .order("created_at", { ascending: false })
          .limit(1);
        if (findErr) throw findErr;

        const existingConversation = existingConversations?.[0];
        if (existingConversation) {
          const { error: updateErr } = await supabase
            .from("zapi_conversations")
            .update({
              lead_id: leadId,
              workspace_id: workspaceId,
              is_active: true,
            })
            .eq("id", existingConversation.id);
          if (updateErr) throw updateErr;
          targetConversationId = existingConversation.id;
        } else {
          const { data: insertedConversation, error: insertErr } = await supabase
            .from("zapi_conversations")
            .insert({
              lead_id: leadId,
              connection_id: selectedId,
              workspace_id: workspaceId,
              phone_number: cleanPhone,
              is_active: true,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          targetConversationId = insertedConversation.id;
        }
      }

      // 2. Disable every other conversation only after the target is ready.
      const { error: deactivateZapiErr } = await supabase
        .from("zapi_conversations")
        .update({ is_active: false })
        .eq("lead_id", leadId)
        .eq("is_active", true)
        .neq("id", targetConversationId);
      if (deactivateZapiErr) throw deactivateZapiErr;

      const { error: deactivateWaErr } = await supabase
        .from("whatsapp_conversations")
        .update({ is_active: false })
        .eq("lead_id", leadId)
        .eq("is_active", true)
        .neq("id", targetConversationId);
      if (deactivateWaErr) throw deactivateWaErr;

      // Ensure the selected target remains active when IDs happen to overlap
      // across the two conversation tables.
      if (targetConn.type === "whatsapp_official") {
        const { error: activateErr } = await supabase
          .from("whatsapp_conversations")
          .update({ is_active: true })
          .eq("id", targetConversationId);
        if (activateErr) throw activateErr;
      } else {
        const { error: activateErr } = await supabase
          .from("zapi_conversations")
          .update({ is_active: true })
          .eq("id", targetConversationId);
        if (activateErr) throw activateErr;
      }

      /*
       * The target record is now active and every other channel for this lead
       * is inactive, preventing duplicate delivery.
       */

      // 3. Update lead source if it was from widget
      const { data: leadData, error: leadReadErr } = await supabase
        .from("leads")
        .select("source")
        .eq("id", leadId)
        .single();

      if (leadReadErr) throw leadReadErr;

      if (leadData?.source?.startsWith("Widget:")) {
        const { error: leadUpdateErr } = await supabase
          .from("leads")
          .update({ source: "whatsapp" })
          .eq("id", leadId);

        if (leadUpdateErr) throw leadUpdateErr;
      }

      // 4. Insert system message
      const fromLabel = getSourceLabel();
      const toLabel = targetConn.name;
      const systemContent = `__SYSTEM__:Troca de canal: ${fromLabel} → ${toLabel}`;

      const { error: msgErr } = await supabase.from("messages").insert({
        lead_id: leadId,
        workspace_id: workspaceId,
        content: systemContent,
        sender_type: "human_agent",
      });

      if (msgErr) throw msgErr;

      toast({ title: "Canal alterado com sucesso", description: `Agora usando: ${toLabel}` });
      onChannelChanged(selectedId, toLabel, targetConn.type === "whatsapp_official" ? "whatsapp_official" : "zapi");
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("[ChangeChannelDialog] Error switching channel:", err);
      const errorMessage = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String(err.message)
          : JSON.stringify(err);
      toast({ title: "Erro ao trocar canal", description: errorMessage, variant: "destructive" });
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trocar canal de conexão</DialogTitle>
          <DialogDescription>
            Selecione a conexão para continuar o atendimento de <span className="font-medium text-foreground">{leadName}</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : connections.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma conexão disponível neste workspace.
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {connections.map((conn) => {
                const isCurrent = conn.id === currentConnectionId;
                const isSelected = conn.id === selectedId;
                const isDisabled = isCurrent || conn.is_active === false;

                return (
                  <button
                    key={conn.id}
                    onClick={() => !isDisabled && setSelectedId(conn.id)}
                    disabled={isDisabled}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : isCurrent
                          ? "border-border bg-muted/40 opacity-60 cursor-default"
                          : "border-border hover:border-primary/50 hover:bg-muted/50",
                      isDisabled && !isCurrent && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted shrink-0">
                      {conn.type === "zapi" ? (
                        <Phone className="h-4 w-4 text-muted-foreground" />
                      ) : conn.type === "whatsapp_official" ? (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{conn.name}</span>
                        {isCurrent && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-border text-muted-foreground shrink-0">
                            Atual
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {conn.type === "zapi" ? "Z-API" : "WhatsApp Official"}
                        </span>
                        {conn.phone && (
                          <span className="text-[11px] text-muted-foreground">
                            {conn.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isSelected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : conn.connected === false ? (
                        <WifiOff className="h-4 w-4 text-destructive" />
                      ) : conn.connected === true ? (
                        <Wifi className="h-4 w-4 text-success" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {!leadPhone && !isLoading && connections.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            Este lead não possui telefone cadastrado. Adicione um número antes de trocar o canal.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSwitch}
            disabled={!selectedId || isSwitching}
          >
            {isSwitching ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Confirmar troca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
