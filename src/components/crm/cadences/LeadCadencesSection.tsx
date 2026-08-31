import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Radio, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadCadencesSectionProps {
  leadId: string;
}

/** Linha de cadence_messages com os relacionamentos usados no agrupamento. */
interface CadenceMessageRow {
  rule_id: string;
  activity_id: string | null;
  status: string;
  send_at: string;
  created_at: string;
  cadence_rules: {
    name: string | null;
    trigger_type: string;
    activity_type: string | null;
    stage_id: string | null;
    crm_pipeline_stages: { name: string } | null;
  } | null;
  crm_lead_activities: { id: string; title: string | null; type: string | null } | null;
}

interface ActiveCadenceItem {
  key: string;
  rule_id: string;
  rule_name: string;
  trigger_type: string;
  activity_id: string | null;
  activity_title: string | null;
  activity_type: string | null;
  stage_name: string | null;
  pending: number;
  sent: number;
  total: number;
  next_send_at: string | null;
}

export function LeadCadencesSection({ leadId }: LeadCadencesSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmTarget, setConfirmTarget] = useState<ActiveCadenceItem | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["lead-active-cadences", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cadence_scheduled_messages")
        .select(`
          id,
          rule_id,
          activity_id,
          status,
          send_at,
          created_at,
          cadence_rules!inner (
            id,
            name,
            trigger_type,
            activity_type,
            stage_id,
            crm_pipeline_stages ( name )
          ),
          crm_lead_activities ( id, title, type )
        `)
        .eq("lead_id", leadId)
        .order("send_at", { ascending: true });
      if (error) throw error;

      const rows = ((data as CadenceMessageRow[]) || []).filter((r) => r.cadence_rules);

      // Determine the current run per group as the most recent batch that still has
      // pending messages. Each enqueue creates one batch with the same created_at;
      // counting by the exact batch prevents older runs of the same rule from leaking
      // into the active cadence summary.
      const runStart = new Map<string, string>();
      for (const row of rows) {
        if (row.status !== "pending") continue;
        const key = `${row.rule_id}::${row.activity_id ?? "-"}`;
        const existing = runStart.get(key);
        if (!existing || row.created_at > existing) runStart.set(key, row.created_at);
      }

      const groups = new Map<string, ActiveCadenceItem>();
      for (const row of rows) {
        const activityId = row.activity_id as string | null;
        const key = `${row.rule_id}::${activityId ?? "-"}`;
        const start = runStart.get(key);
        if (!start) continue; // no active run for this group
        if (row.created_at !== start) continue; // belongs to a previous run
        const rule = row.cadence_rules;
        let item = groups.get(key);
        if (!item) {
          item = {
            key,
            rule_id: row.rule_id,
            rule_name: rule.name || "Régua sem nome",
            trigger_type: rule.trigger_type,
            activity_id: activityId,
            activity_title: row.crm_lead_activities?.title ?? null,
            activity_type: row.crm_lead_activities?.type ?? rule.activity_type ?? null,
            stage_name: rule.crm_pipeline_stages?.name ?? null,
            pending: 0,
            sent: 0,
            total: 0,
            next_send_at: null,
          };
          groups.set(key, item);
        }
        item.total += 1;
        if (row.status === "pending") {
          item.pending += 1;
          if (!item.next_send_at || row.send_at < item.next_send_at) {
            item.next_send_at = row.send_at;
          }
        } else if (row.status === "sent") {
          item.sent += 1;
        }
      }

      return Array.from(groups.values()).filter((i) => i.pending > 0);
    },

    enabled: !!leadId,
  });

  const cancelMutation = useMutation({
    mutationFn: async (item: ActiveCadenceItem) => {
      let q = supabase
        .from("cadence_scheduled_messages")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("lead_id", leadId)
        .eq("rule_id", item.rule_id)
        .eq("status", "pending");
      if (item.activity_id) {
        q = q.eq("activity_id", item.activity_id);
      } else {
        q = q.is("activity_id", null);
      }
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Lead retirado da régua" });
      queryClient.invalidateQueries({ queryKey: ["lead-active-cadences", leadId] });
    },
    onError: (e: { message?: string }) => {
      toast({ variant: "destructive", title: "Erro ao retirar da régua", description: e?.message });
    },
  });

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando réguas...
        </div>
      );
    }
    if (!items.length) {
      return (
        <p className="text-sm text-muted-foreground">Nenhuma régua ativa para este lead.</p>
      );
    }
    return (
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-border bg-background/50 p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">
                    {item.rule_name}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.trigger_type === "stage" ? "Etapa" : "Atividade"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {item.trigger_type === "stage"
                    ? item.stage_name || "Etapa"
                    : [item.activity_type, item.activity_title].filter(Boolean).join(" · ") || "Atividade"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmTarget(item)}
                disabled={cancelMutation.isPending}
              >
                Retirar
              </Button>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                {item.sent} enviadas
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-primary" />
                {item.pending} pendentes
              </span>
              {item.next_send_at && (
                <span className="ml-auto">
                  Próxima: {format(new Date(item.next_send_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }, [items, isLoading, cancelMutation.isPending]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Radio className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Régua</h3>
      </div>
      {content}

      <AlertDialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Retirar lead desta régua?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as mensagens pendentes de <strong>{confirmTarget?.rule_name}</strong> para este lead serão canceladas. Mensagens já enviadas não são afetadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (confirmTarget) cancelMutation.mutate(confirmTarget);
                setConfirmTarget(null);
              }}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Retirar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
