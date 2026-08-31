import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ContactTagList } from "@/components/crm/tags";
import { parseTags } from "@/types/tags";
import { formatPhoneForDisplay } from "@/lib/phone";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  User,
  Phone,
  Mail,
  Building2,
  Briefcase,
  MessageCircle,
  LayoutGrid,
  Calendar,
  Globe,
  FileText,
  Loader2,
  BellOff,
} from "lucide-react";

interface ContactDetailModalProps {
  contactId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDetailModal({ contactId, open, onOpenChange }: ContactDetailModalProps) {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOptOut, setConfirmOptOut] = useState(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contact-detail", contactId],
    queryFn: async () => {
      if (!contactId) return null;
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("*")
        .eq("id", contactId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!contactId && open,
  });

  const { data: crmLead } = useQuery({
    queryKey: ["contact-crm-lead", contactId, currentWorkspace?.id],
    queryFn: async () => {
      if (!contactId || !currentWorkspace?.id) return null;
      const { data } = await supabase
        .from("crm_leads")
        .select("id, stage_id, status, value")
        .eq("contact_id", contactId)
        .eq("workspace_id", currentWorkspace.id)
        .is("deleted_at", null)
        .eq("status", "open")
        .maybeSingle();
      return data;
    },
    enabled: !!contactId && !!currentWorkspace?.id && open,
  });

  const deactivatedBy = (contact as any)?.deactivated_by as string | null | undefined;
  const deactivatedAt = (contact as any)?.deactivated_at as string | null | undefined;
  const isInactive = !!contact && (contact as any).is_active === false;
  const optedOut = !!(contact as any)?.opted_out;
  const optedOutAt = (contact as any)?.opted_out_at as string | null | undefined;

  const { data: deactivatedByProfile } = useQuery({
    queryKey: ["contact-deactivated-by", deactivatedBy],
    queryFn: async () => {
      if (!deactivatedBy) return null;
      const { data } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", deactivatedBy)
        .maybeSingle();
      return data;
    },
    enabled: !!deactivatedBy,
  });

  const updateOptOut = useMutation({
    mutationFn: async (nextOptedOut: boolean) => {
      if (!contactId) throw new Error("contactId required");
      const { error } = await supabase
        .from("crm_contacts")
        .update({
          opted_out: nextOptedOut,
          opted_out_at: nextOptedOut ? new Date().toISOString() : null,
        })
        .eq("id", contactId);
      if (error) throw error;
    },
    onSuccess: (_, nextOptedOut) => {
      queryClient.invalidateQueries({ queryKey: ["contact-detail", contactId] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      toast({
        title: nextOptedOut
          ? "Contato marcado como 'nao deseja receber contato'"
          : "Contato pode receber interacoes novamente",
      });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao atualizar preferencia de contato" });
    },
  });

  const tags = contact ? parseTags(contact.tags) : [];

  const handleGoToInbox = () => {
    if (contact?.lead_id) {
      navigate(`/?lead=${contact.lead_id}`);
    }
  };

  const handleGoToPipeline = () => {
    if (crmLead?.id) {
      navigate(`/crm/pipeline?lead=${crmLead.id}`);
    }
  };

  const handleToggleOptOut = (checked: boolean) => {
    if (checked) {
      setConfirmOptOut(true);
    } else {
      updateOptOut.mutate(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg glass-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Detalhes do Contato</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : contact ? (
          <div className="space-y-4">
            {/* Name & Job Title */}
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-semibold text-foreground">{contact.name}</h3>
                  {optedOut && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-destructive/10 text-destructive border border-destructive/30">
                      <BellOff className="h-3 w-3" />
                      Sem contato
                    </span>
                  )}
                </div>
                {contact.job_title && (
                  <p className="text-sm text-muted-foreground">{contact.job_title}</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Contact Info */}
            <div className="space-y-2">
              {contact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground">{formatPhoneForDisplay(contact.phone)}</span>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground">{contact.email}</span>
                </div>
              )}
              {contact.company && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground">{contact.company}</span>
                </div>
              )}
              {contact.position && (
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="text-foreground">{contact.position}</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Opt-out toggle */}
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <BellOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground font-medium">Nao deseja mais receber contato</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quando ativo, este contato nao sera mais contatado por nenhum canal (WhatsApp, IA, cadencias).
                    </p>
                    {optedOut && optedOutAt && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Marcado em {format(new Date(optedOutAt), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  checked={optedOut}
                  onCheckedChange={handleToggleOptOut}
                  disabled={updateOptOut.isPending}
                />
              </div>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Tags</p>
                  <ContactTagList tags={tags} />
                </div>
              </>
            )}

            {/* Notes */}
            {contact.notes && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Notas</p>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{contact.notes}</p>
                </div>
              </>
            )}

            {/* Meta */}
            <Separator />
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {contact.source && (
                <div className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  <span>{contact.source}</span>
                </div>
              )}
              {contact.created_at && (
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>{format(new Date(contact.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
                </div>
              )}
            </div>

            {isInactive && (
              <>
                <Separator />
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-medium text-destructive mb-1">Contato inativado</p>
                  <p className="text-xs text-muted-foreground">
                    {deactivatedAt
                      ? format(new Date(deactivatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                      : "Data desconhecida"}
                    {" por "}
                    {deactivatedByProfile?.name || deactivatedByProfile?.email || (deactivatedBy ? "usuário desconhecido" : "sistema (ação automática)")}
                  </p>
                </div>
              </>
            )}

            {/* Action Buttons */}
            <Separator />
            <div className="flex gap-2">
              {contact.lead_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleGoToInbox}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  Ver conversa
                </Button>
              )}
              {crmLead?.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleGoToPipeline}
                >
                  <LayoutGrid className="h-4 w-4 mr-1" />
                  Ver no Pipeline
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8">Contato nao encontrado</p>
        )}
      </DialogContent>

      <AlertDialog open={confirmOptOut} onOpenChange={setConfirmOptOut}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como "nao deseja receber contato"?</AlertDialogTitle>
            <AlertDialogDescription>
              Este contato deixara de receber qualquer interacao automatica (WhatsApp, IA e cadencias).
              Voce podera reverter a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                setConfirmOptOut(false);
                updateOptOut.mutate(true);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
