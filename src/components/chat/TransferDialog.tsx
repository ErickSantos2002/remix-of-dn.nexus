import { useState, useEffect } from "react";
import { ArrowRightLeft, Loader2, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { transferLead } from "@/lib/routing/transferLead";
import { useChatPresence } from "@/hooks/useChatPresence";
import { PRESENCE_LABEL, PRESENCE_PILL } from "@/lib/routing/presence";
import { Pill } from "@/components/dn/Pill";

interface WorkspaceMember {
  user_id: string;
  name: string | null;
  email: string;
}

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string | null;
  workspaceId: string;
  currentUserId: string;
  onTransferComplete?: () => void;
}

export function TransferDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  workspaceId,
  currentUserId,
  onTransferComplete,
}: TransferDialogProps) {
  const { toast } = useToast();
  const { presence } = useChatPresence(workspaceId);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [transferReason, setTransferReason] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  // Fetch available members when dialog opens
  useEffect(() => {
    if (!open || !workspaceId) return;

    const fetchMembers = async () => {
      setIsLoadingMembers(true);

      try {
        // Fetch workspace members with profiles
        const { data: workspaceMembers, error: membersError } = await supabase
          .from("workspace_members")
          .select(`
            user_id,
            profiles:user_id (
              name,
              email,
              is_human
            )
          `)
          .eq("workspace_id", workspaceId)
          .eq("status", "active");

        if (membersError) {
          console.error("Error fetching members:", membersError);
          return;
        }

        // Combine data and filter out current user
        const combinedMembers: WorkspaceMember[] = (workspaceMembers || [])
          .filter((m) => m.user_id !== currentUserId)
          .map((m) => {
            // Tipo do embed ambiguo no query builder do Supabase (SelectQueryError
            // por multiplas FKs entre workspace_members e profiles). Cast via
            // unknown preserva o shape de campos sem suprimir no-explicit-any.
            const profile = m.profiles as unknown as { name: string | null; email: string; is_human: boolean } | null;
            return {
              user_id: m.user_id,
              name: profile?.name || null,
              email: profile?.email || "Email desconhecido",
            };
          })
          // Sort: available first, then by least load
          .sort((a, b) => {
            const pa = presence.get(a.user_id);
            const pb = presence.get(b.user_id);
            return (
              (pa?.state === "available" ? 0 : 1) - (pb?.state === "available" ? 0 : 1) ||
              (pa?.load ?? 0) - (pb?.load ?? 0)
            );
          });

        setMembers(combinedMembers);
      } catch (error) {
        console.error("Error fetching members:", error);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    fetchMembers();
  }, [open, workspaceId, currentUserId, presence]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedUserId(null);
      setTransferReason("");
    }
  }, [open]);

  const handleTransfer = async () => {
    if (!selectedUserId || !transferReason.trim()) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Selecione um membro e informe o motivo da transferência.",
      });
      return;
    }

    setIsTransferring(true);

    try {
      // Get the current lead's agent_id
      const { data: leadData } = await supabase
        .from("leads")
        .select("assigned_agent_id")
        .eq("id", leadId)
        .single();

      // Get the first active agent for this workspace if no agent assigned
      let agentId = leadData?.assigned_agent_id;
      if (!agentId) {
        const { data: agentData } = await supabase
          .from("agent_instances")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("is_active", true)
          .limit(1)
          .single();
        agentId = agentData?.id;
      }

      if (!agentId) {
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Nenhum agente ativo encontrado no workspace.",
        });
        setIsTransferring(false);
        return;
      }

      const result = await transferLead({
        leadId,
        fromUserId: currentUserId,
        toUserId: selectedUserId,
        reason: transferReason.trim(),
        workspaceId,
        agentId,
      });

      if (result.success) {
        // Update lead status to human_talking and assign to new user
        await supabase
          .from("leads")
          .update({
            status: "human_talking",
            assigned_to_user_id: selectedUserId,
            assigned_at: new Date().toISOString(),
          })
          .eq("id", leadId);

        toast({
          title: "Transferência realizada",
          description: `A conversa foi transferida com sucesso.`,
        });
        onOpenChange(false);
        onTransferComplete?.();
      } else {
        toast({
          variant: "destructive",
          title: "Erro na transferência",
          description: result.error || "Não foi possível realizar a transferência.",
        });
      }
    } catch (error) {
      console.error("Transfer error:", error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Ocorreu um erro ao transferir a conversa.",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Transferir Conversa
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Transfira a conversa de "{leadName || "Sem nome"}" para outro membro da equipe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Member List */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Selecione um membro</Label>
            <ScrollArea className="h-[200px] rounded-lg border border-border">
              {isLoadingMembers ? (
                <div className="flex items-center justify-center h-full py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                  <User className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground">Nenhum membro disponível</p>
                  <p className="text-[10px] text-muted-foreground/70">Adicione membros ao workspace primeiro</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {members.map((member) => {
                    const isSelected = selectedUserId === member.user_id;
                    const p = presence.get(member.user_id);
                    const state = p?.state ?? "available";
                    const isAtCapacity = (p?.load ?? 0) >= (p?.maxConcurrentLeads ?? 10);

                    return (
                      <button
                        key={member.user_id}
                        onClick={() => setSelectedUserId(member.user_id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left",
                          isSelected
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-card border border-transparent"
                        )}
                      >
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarFallback className="bg-card text-foreground text-xs font-medium">
                            {getInitials(member.name, member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-xs truncate">
                              {member.name || member.email}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <Pill status={PRESENCE_PILL[state]}>{PRESENCE_LABEL[state]}</Pill>
                            <span className="text-muted-foreground/50">•</span>
                            <span>
                              {p?.load ?? 0}/{p?.maxConcurrentLeads ?? 10} leads
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-primary/20 text-primary">
                            Selecionado
                          </Badge>
                        )}
                        {isAtCapacity && state !== "at_capacity" && (
                          <Pill status="warning">Sem capacidade</Pill>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Transfer Reason */}
          <div className="space-y-2">
            <Label htmlFor="transfer-reason" className="text-xs text-muted-foreground">
              Motivo da transferência
            </Label>
            <Textarea
              id="transfer-reason"
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              placeholder="Ex: Cliente precisa de suporte técnico especializado..."
              className="min-h-[80px] resize-none text-xs bg-background border-border rounded-lg"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="rounded-lg text-xs"
            disabled={isTransferring}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleTransfer}
            disabled={!selectedUserId || !transferReason.trim() || isTransferring}
            className="rounded-lg text-xs"
          >
            {isTransferring ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Transferindo...
              </>
            ) : (
              <>
                <ArrowRightLeft className="mr-1.5 h-3 w-3" />
                Transferir
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
