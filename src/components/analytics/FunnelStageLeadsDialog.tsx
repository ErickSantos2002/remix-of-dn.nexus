import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, ExternalLink } from "lucide-react";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface FunnelStageLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stageId: string;
  stageName: string;
  mode: "current" | "period";
  leadIds?: string[];
  customTitle?: string;
  contextLabel?: string;
  excludedLeadIds?: Set<string>;
  onExclusionChange?: () => void;
}

interface LeadRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  contact_name: string | null;
  contact_phone: string | null;
  added_at: string | null;
}

function mapLeadRow(l: { id: string; title: string | null; status: string | null; created_at: string | null; crm_contacts: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null }): LeadRow {
  return {
    id: l.id,
    title: l.title || "Sem título",
    status: l.status || "open",
    created_at: l.created_at || "",
    contact_name: Array.isArray(l.crm_contacts)
      ? l.crm_contacts[0]?.name || null
      : l.crm_contacts?.name || null,
    contact_phone: Array.isArray(l.crm_contacts)
      ? l.crm_contacts[0]?.phone || null
      : l.crm_contacts?.phone || null,
    added_at: null,
  };
}

export function FunnelStageLeadsDialog({
  open,
  onOpenChange,
  stageId,
  stageName,
  mode,
  leadIds,
  customTitle,
  contextLabel,
  excludedLeadIds,
  onExclusionChange,
}: FunnelStageLeadsDialogProps) {
  const { workspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [localExcluded, setLocalExcluded] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (open && workspaceId) {
      fetchLeads();
    }
  }, [open, workspaceId, stageId, mode]);

  useEffect(() => {
    setLocalExcluded(new Set(excludedLeadIds || []));
  }, [excludedLeadIds, open]);

  async function fetchHistoryDates(leadIdsList: string[]): Promise<Map<string, string>> {
    const dateMap = new Map<string, string>();
    if (leadIdsList.length === 0) return dateMap;

    const title = customTitle || "";
    const isWon = title.includes("Won") || title.includes("Ganho") || title.includes("Clientes");
    const isLost = title.includes("Lost") || title.includes("Perdido");

    const chunkSize = 200;
    for (let i = 0; i < leadIdsList.length; i += chunkSize) {
      const chunk = leadIdsList.slice(i, i + chunkSize);

      let query = supabase
        .from("crm_lead_history")
        .select("lead_id, created_at")
        .in("lead_id", chunk)
        .order("created_at", { ascending: false });

      if (stageId) {
        query = query.eq("to_stage_id", stageId);
      } else if (isWon) {
        query = query.in("action", ["won", "marked_won"]);
      } else if (isLost) {
        query = query.in("action", ["lost", "marked_lost"]);
      } else {
        // No filter context — skip history
        continue;
      }

      const { data } = await query;
      if (data) {
        for (const row of data) {
          // Keep the most recent entry per lead
          if (!dateMap.has(row.lead_id)) {
            dateMap.set(row.lead_id, row.created_at || "");
          }
        }
      }
    }
    return dateMap;
  }

  async function fetchLeads() {
    if (!workspaceId) return;
    setIsLoading(true);

    try {
      const ids = leadIds && leadIds.length > 0 ? leadIds : null;
      let fetchedLeads: LeadRow[] = [];

      if (ids) {
        const chunkSize = 200;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { data } = await supabase
            .from("crm_leads")
            .select("id, title, status, created_at, crm_contacts(name, phone)")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .in("id", chunk)
            .order("created_at", { ascending: false });
          if (data) {
            fetchedLeads.push(...data.map(mapLeadRow));
          }
        }
      } else {
        const query = supabase
          .from("crm_leads")
          .select("id, title, status, created_at, crm_contacts(name, phone)")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .eq("stage_id", stageId)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(200);
        const { data } = await query;
        fetchedLeads = (data || []).map(mapLeadRow);
      }

      // Enrich with history dates if contextLabel is provided
      if (contextLabel && fetchedLeads.length > 0) {
        const allIds = fetchedLeads.map(l => l.id);
        const dateMap = await fetchHistoryDates(allIds);
        for (const lead of fetchedLeads) {
          lead.added_at = dateMap.get(lead.id) || null;
        }
      }

      setLeads(fetchedLeads);
    } catch (err) {
      console.error("Error fetching stage leads:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleExclusion(leadId: string, nextCounted: boolean) {
    if (!workspaceId) return;
    setPendingId(leadId);
    // optimistic update
    setLocalExcluded(prev => {
      const next = new Set(prev);
      if (nextCounted) next.delete(leadId); else next.add(leadId);
      return next;
    });

    try {
      if (nextCounted) {
        const { error } = await supabase
          .from("cohort_excluded_leads" as any)
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("lead_id", leadId);
        if (error) throw error;
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("cohort_excluded_leads" as any)
          .insert({
            workspace_id: workspaceId,
            lead_id: leadId,
            excluded_by: userRes?.user?.id ?? null,
          } as any);
        if (error) throw error;
      }
      onExclusionChange?.();
    } catch (err: any) {
      console.error("toggleExclusion error:", err);
      // revert optimistic
      setLocalExcluded(prev => {
        const next = new Set(prev);
        if (nextCounted) next.add(leadId); else next.delete(leadId);
        return next;
      });
      toast({
        title: "Não foi possível atualizar",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  const statusLabel: Record<string, string> = {
    open: "Aberto",
    won: "Ganho",
    lost: "Perdido",
  };

  const statusColor: Record<string, string> = {
    open: "bg-primary/20 text-primary",
    won: "bg-success/20 text-success",
    lost: "bg-destructive/20 text-destructive",
  };

  const countedTotal = leads.filter(l => !localExcluded.has(l.id)).length;
  const hasExclusions = leads.some(l => localExcluded.has(l.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {customTitle || `${stageName} — ${mode === "current" ? "Leads atuais" : "Gerados no período"}`}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            Nenhum lead encontrado
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                {contextLabel && <TableHead>Adicionado em {contextLabel}</TableHead>}
                <TableHead className="text-center">Contabilizar</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const excluded = localExcluded.has(lead.id);
                return (
                  <TableRow key={lead.id} className={cn(excluded && "opacity-50")}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{lead.contact_name || lead.title}</span>
                        {excluded && (
                          <Badge variant="outline" className="text-[10px]">Excluído</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {lead.contact_phone
                        ? formatPhoneForDisplay(lead.contact_phone)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusColor[lead.status] || ""}
                      >
                        {statusLabel[lead.status] || lead.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {lead.created_at
                        ? new Date(lead.created_at).toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    {contextLabel && (
                      <TableCell className="text-xs text-muted-foreground">
                        {lead.added_at
                          ? new Date(lead.added_at).toLocaleDateString("pt-BR")
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <Switch
                        checked={!excluded}
                        disabled={pendingId === lead.id}
                        onCheckedChange={(checked) => toggleExclusion(lead.id, checked)}
                        aria-label="Contabilizar lead nos relatórios de cohort"
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/crm/pipeline?lead=${lead.id}`);
                        }}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Ver no pipeline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-muted-foreground text-right mt-2">
          {hasExclusions
            ? `${countedTotal} de ${leads.length} contabilizado${leads.length !== 1 ? "s" : ""}`
            : `${leads.length} lead${leads.length !== 1 ? "s" : ""}`}
        </p>
      </DialogContent>
    </Dialog>
  );
}
