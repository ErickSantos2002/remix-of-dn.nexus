import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { useMeetingsReport, type MeetingStatus } from "@/hooks/useMeetingsReport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users, Calendar, Activity as ActivityIcon } from "lucide-react";

interface MeetingsFilters {
  memberIds: string[];
  weeks: number;
  types: string[];
}

const DEFAULT_FILTERS: MeetingsFilters = {
  memberIds: [],
  weeks: 4,
  types: ["meeting", "demo", "reschedule"],
};

const ACTIVITY_LABELS: Record<string, string> = {
  meeting: "Reunião",
  demo: "Demonstração",
  reschedule: "Reagendamento",
};

const WEEKS_OPTIONS = [1, 2, 4, 8, 12];

function StatusBadge({ status }: { status: MeetingStatus }) {
  if (status === "rolou") {
    return <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15">Rolou</Badge>;
  }
  if (status === "reagendou") {
    return <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">Reagendou</Badge>;
  }
  return <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15">No Show</Badge>;
}

function formatPct(v: number) {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

export function MeetingsTab() {
  const { workspaceId, currentWorkspace } = useWorkspace();
  const { companyId } = useCompany();
  const [filters, setFilters] = usePersistedFilters<MeetingsFilters>(
    "analytics:meetings",
    DEFAULT_FILTERS,
    workspaceId,
  );

  const [membersOpen, setMembersOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);

  // Members list (workspace + owner + company admins)
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members-meetings", workspaceId, companyId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const map = new Map<string, { user_id: string; name: string }>();

      const { data: wsMembers } = await supabase
        .from("workspace_members")
        .select("user_id, profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", workspaceId!)
        .eq("status", "active");
      (wsMembers || []).forEach((m: any) => {
        if (m.user_id && !map.has(m.user_id)) {
          map.set(m.user_id, { user_id: m.user_id, name: m.profiles?.name || m.profiles?.email || "Sem nome" });
        }
      });

      if (currentWorkspace?.owner_id && !map.has(currentWorkspace.owner_id)) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", currentWorkspace.owner_id)
          .single();
        map.set(currentWorkspace.owner_id, {
          user_id: currentWorkspace.owner_id,
          name: ownerProfile?.name || ownerProfile?.email || "Owner",
        });
      }

      if (companyId) {
        const { data: admins } = await supabase
          .from("company_members")
          .select("user_id, profiles:user_id(name, email)")
          .eq("company_id", companyId)
          .eq("status", "active")
          .in("role", ["admin", "super_admin"]);
        (admins || []).forEach((a: any) => {
          if (a.user_id && !map.has(a.user_id)) {
            map.set(a.user_id, { user_id: a.user_id, name: a.profiles?.name || a.profiles?.email || "Admin" });
          }
        });
      }

      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const { data, isLoading } = useMeetingsReport({
    workspaceId,
    memberIds: filters.memberIds,
    weeks: filters.weeks,
    types: filters.types,
  });

  const membersLabel = useMemo(() => {
    if (filters.memberIds.length === 0) return "Todos os membros";
    if (filters.memberIds.length === 1) {
      const m = members.find(x => x.user_id === filters.memberIds[0]);
      return m?.name || "1 membro";
    }
    return `${filters.memberIds.length} membros`;
  }, [filters.memberIds, members]);

  const typesLabel = useMemo(() => {
    if (filters.types.length === 0 || filters.types.length === 3) return "Todas atividades";
    return filters.types.map(t => ACTIVITY_LABELS[t] || t).join(", ");
  }, [filters.types]);

  const toggleMember = (id: string) => {
    setFilters(f => ({
      ...f,
      memberIds: f.memberIds.includes(id) ? f.memberIds.filter(x => x !== id) : [...f.memberIds, id],
    }));
  };
  const toggleType = (t: string) => {
    setFilters(f => ({
      ...f,
      types: f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t],
    }));
  };

  const selectedMembers = useMemo(() => {
    if (filters.memberIds.length === 1) {
      const m = members.find(x => x.user_id === filters.memberIds[0]);
      return m ? [m] : [];
    }
    if (filters.memberIds.length === members.length) {
      return [{ user_id: "all", name: "Todos" }];
    }
    return filters.memberIds.map(id => members.find(m => m.user_id === id)).filter(Boolean) as { user_id: string; name: string }[];
  }, [filters.memberIds, members]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={membersOpen} onOpenChange={setMembersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-xl">
              <Users className="h-4 w-4" />
              {membersLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 bg-popover border-border" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Membros</span>
              <div className="flex gap-2">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setFilters(f => ({ ...f, memberIds: members.map(m => m.user_id) }))}
                >
                  Todos
                </button>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setFilters(f => ({ ...f, memberIds: [] }))}
                >
                  Limpar
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto space-y-1">
              {members.map(m => (
                <div
                  key={m.user_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMember(m.user_id);
                  }}
                >
                  <Checkbox
                    id={`member-${m.user_id}`}
                    checked={filters.memberIds.includes(m.user_id)}
                    onCheckedChange={() => toggleMember(m.user_id)}
                  />
                  <label htmlFor={`member-${m.user_id}`} className="text-sm flex-1 cursor-pointer select-none">
                    {m.name}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Select
          value={String(filters.weeks)}
          onValueChange={(v) => setFilters(f => ({ ...f, weeks: Number(v) }))}
        >
          <SelectTrigger className="w-[160px] rounded-xl">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {WEEKS_OPTIONS.map(w => (
              <SelectItem key={w} value={String(w)}>{w} {w === 1 ? "semana" : "semanas"}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover open={typesOpen} onOpenChange={setTypesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-xl">
              <ActivityIcon className="h-4 w-4" />
              {typesLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2 bg-popover border-border" align="start">
            <div className="space-y-1">
              {Object.entries(ACTIVITY_LABELS).map(([k, label]) => (
                <div
                  key={k}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleType(k);
                  }}
                >
                  <Checkbox
                    id={`type-${k}`}
                    checked={filters.types.includes(k)}
                    onCheckedChange={() => toggleType(k)}
                  />
                  <label htmlFor={`type-${k}`} className="text-sm flex-1 cursor-pointer select-none">
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Selected members chips */}
      {filters.memberIds.length > 0 && filters.memberIds.length < members.length && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Membros:</span>
          {selectedMembers.map(m => (
            <Badge key={m.user_id} variant="secondary" className="text-xs gap-1 pr-1">
              {m.name}
              <button
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => toggleMember(m.user_id)}
              >
                x
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Weekly blocks */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.weeks.length === 0 ? (
        <div className="glass-card p-8 text-center text-muted-foreground">
          Nenhuma atividade encontrada para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-4">
          {data.weeks.map((week, idx) => (
            <div key={idx} className="glass-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Semana {week.label}
                </h3>
                <span className="text-xs text-muted-foreground font-mono">
                  {week.totals.total} {week.totals.total === 1 ? "atividade" : "atividades"}
                </span>
              </div>

              {/* Totalizador */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border">
                        <td className="px-3 py-2 text-muted-foreground">Rolou</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-success">{week.totals.rolou}</td>
                      </tr>
                      <tr className="border-b border-border">
                        <td className="px-3 py-2 text-muted-foreground">Reagendou</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-warning">{week.totals.reagendou}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 text-muted-foreground">No Show</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-destructive">{week.totals.noShow}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="bg-warning/20 border-b border-border">
                        <td className="px-3 py-2 font-semibold text-foreground">Total</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{week.totals.total}</td>
                      </tr>
                      <tr className="border-b border-border">
                        <td className="px-3 py-2 text-muted-foreground">Aconteceu</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPct(week.totals.aconteceuPct)}</td>
                      </tr>
                      <tr className="border-b border-border">
                        <td className="px-3 py-2 text-muted-foreground">No Show</td>
                        <td className="px-3 py-2 text-right font-mono">{formatPct(week.totals.noShowPct)}</td>
                      </tr>
                      <tr className="bg-destructive/20">
                        <td className="px-3 py-2 font-semibold text-foreground">No Show / Total</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{formatPct(week.totals.noShowOverTotalPct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detalhe */}
              {week.items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contato</TableHead>
                      <TableHead className="w-[140px]">Status</TableHead>
                      <TableHead className="w-[220px]">Membro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {week.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.contactName}</TableCell>
                        <TableCell><StatusBadge status={item.status} /></TableCell>
                        <TableCell className="text-muted-foreground">{item.memberName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-sm text-muted-foreground py-2">Sem atividades nesta semana.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
