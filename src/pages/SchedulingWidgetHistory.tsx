import { useState, useEffect, useMemo, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CalendarDays, Video, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, ChevronDown, ClipboardCheck } from "lucide-react";

type WidgetQualification = {
  answers?: {
    job_title?: string | null;
    company?: string | null;
    revenue?: string | null;
    employee_count?: string | null;
  } | null;
  icp_enabled?: boolean;
  icp_config_snapshot?: {
    revenue_ranges?: string[];
    job_titles?: string[];
    employee_counts?: string[];
  } | null;
  evaluated_at?: string;
};

interface AppointmentRow {
  kind: "appointment" | "blocked";
  id: string;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  status: string | null;
  meeting_link: string | null;
  daily_room_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  member_name: string | null;
  widget_qualification: WidgetQualification | null;
  failed_dimensions: string[] | null;
}

interface RawBlockedAttempt {
  id: string;
  created_at: string;
  contact_id: string | null;
  lead_id: string | null;
  answers: WidgetQualification["answers"];
  icp_config_snapshot: WidgetQualification["icp_config_snapshot"];
  failed_dimensions: string[] | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  revenue: "Faturamento",
  job_title: "Cargo",
  employee_count: "Funcionários",
};

interface RawAppointment {
  id: string;
  start_time: string;
  end_time: string;
  created_at: string;
  status: string | null;
  meeting_link: string | null;
  daily_room_url: string | null;
  contact_id: string;
  assigned_to: string | null;
  widget_qualification: WidgetQualification | null;
}

type SortKey = "start_time" | "created_at" | "contact_name" | "contact_email" | "contact_phone" | "member_name" | "status";
type SortDir = "asc" | "desc";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "Agendado", variant: "outline" },
  confirmed: { label: "Confirmado", variant: "default" },
  completed: { label: "Realizado", variant: "default" },
  cancelled: { label: "Cancelado", variant: "destructive" },
  no_show: { label: "Não compareceu", variant: "secondary" },
};

const PAGE_SIZE = 1000;
const DATE_KEYS: SortKey[] = ["start_time", "created_at"];

async function fetchAllAppointments(widgetId: string): Promise<RawAppointment[]> {
  const all: RawAppointment[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("crm_appointments")
      .select("id, start_time, end_time, created_at, status, meeting_link, daily_room_url, contact_id, assigned_to, widget_qualification")
      .eq("scheduling_widget_id", widgetId)
      .order("start_time", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as RawAppointment[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchAllBlockedAttempts(widgetId: string): Promise<RawBlockedAttempt[]> {
  const all: RawBlockedAttempt[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("scheduling_blocked_attempts")
      .select("id, created_at, contact_id, lead_id, answers, icp_config_snapshot, failed_dimensions")
      .eq("widget_id", widgetId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as RawBlockedAttempt[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchAllByIds<T>(table: "crm_contacts" | "profiles", cols: string, ids: string[]): Promise<T[]> {
  const all: T[] = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(cols)
        .in("id", chunk)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as T[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return all;
}

export default function SchedulingWidgetHistory() {
  const { widgetId } = useParams<{ widgetId: string }>();
  const navigate = useNavigate();
  const [widgetName, setWidgetName] = useState("");
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "created_at", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showBlocked, setShowBlocked] = useState(true);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!widgetId) return;

    const fetchData = async () => {
      setLoading(true);

      const { data: widget } = await supabase
        .from("scheduling_widgets")
        .select("name")
        .eq("id", widgetId)
        .single();
      if (widget) setWidgetName(widget.name);

      const [appointments, blocked] = await Promise.all([
        fetchAllAppointments(widgetId),
        fetchAllBlockedAttempts(widgetId),
      ]);

      if (appointments.length === 0 && blocked.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const contactIds = [...new Set([
        ...appointments.map(a => a.contact_id),
        ...blocked.map(b => b.contact_id),
      ].filter(Boolean))] as string[];
      const memberIds = [...new Set(appointments.map(a => a.assigned_to).filter(Boolean))] as string[];

      const [contacts, profiles] = await Promise.all([
        contactIds.length > 0
          ? fetchAllByIds<{ id: string; name: string | null; email: string | null; phone: string | null }>("crm_contacts", "id, name, email, phone", contactIds)
          : Promise.resolve([]),
        memberIds.length > 0
          ? fetchAllByIds<{ id: string; name: string | null; email: string | null }>("profiles", "id, name, email", memberIds)
          : Promise.resolve([]),
      ]);

      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      const apptRows: AppointmentRow[] = appointments.map(a => {
        const contact = contactMap.get(a.contact_id);
        const member = a.assigned_to ? profileMap.get(a.assigned_to) : undefined;
        return {
          kind: "appointment" as const,
          id: a.id,
          start_time: a.start_time,
          end_time: a.end_time,
          created_at: a.created_at,
          status: a.status,
          meeting_link: a.meeting_link,
          daily_room_url: a.daily_room_url,
          contact_name: contact?.name || null,
          contact_email: contact?.email || null,
          contact_phone: contact?.phone || null,
          member_name: member?.name || member?.email || null,
          widget_qualification: (a.widget_qualification as WidgetQualification | null) ?? null,
          failed_dimensions: null,
        };
      });

      const blockedRows: AppointmentRow[] = blocked.map(b => {
        const contact = b.contact_id ? contactMap.get(b.contact_id) : undefined;
        return {
          kind: "blocked" as const,
          id: b.id,
          start_time: null,
          end_time: null,
          created_at: b.created_at,
          status: null,
          meeting_link: null,
          daily_room_url: null,
          contact_name: contact?.name || null,
          contact_email: contact?.email || null,
          contact_phone: contact?.phone || null,
          member_name: null,
          widget_qualification: { answers: b.answers, icp_enabled: true, icp_config_snapshot: b.icp_config_snapshot },
          failed_dimensions: b.failed_dimensions ?? [],
        };
      });

      setRows([...apptRows, ...blockedRows]);
      setLoading(false);
    };

    fetchData();
  }, [widgetId]);

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatPhone = (phone: string | null) => {
    if (!phone) return "-";
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) {
      const local = digits.slice(2);
      const ddd = local.slice(0, 2);
      const num = local.slice(2);
      return `(${ddd}) ${num.slice(0, num.length - 4)}-${num.slice(-4)}`;
    }
    return phone;
  };

  const sortedRows = useMemo(() => {
    const arr = rows.filter(r => showBlocked || r.kind !== "blocked");
    const { key, dir } = sort;
    const mult = dir === "asc" ? 1 : -1;
    const isDate = DATE_KEYS.includes(key);
    arr.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const aEmpty = va === null || va === undefined || va === "";
      const bEmpty = vb === null || vb === undefined || vb === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (isDate) {
        return (new Date(va as string).getTime() - new Date(vb as string).getTime()) * mult;
      }
      return String(va).localeCompare(String(vb), "pt-BR", { sensitivity: "base" }) * mult;
    });
    return arr;
  }, [rows, sort, showBlocked]);

  const apptCount = rows.filter(r => r.kind === "appointment").length;
  const blockedCount = rows.filter(r => r.kind === "blocked").length;

  const toggleSort = (key: SortKey) => {
    setSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: DATE_KEYS.includes(key) ? "desc" : "asc" };
    });
  };

  const SortableHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => {
    const active = sort.key === k;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <TableHead>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
        >
          {children}
          <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-50"}`} />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/settings/scheduling")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            Historico de Conversoes
          </h1>
          {widgetName && <p className="text-muted-foreground text-sm mt-1">Widget: {widgetName}{!loading && ` • ${apptCount} agendamento${apptCount === 1 ? "" : "s"}`}{!loading && blockedCount > 0 && ` • ${blockedCount} bloqueado${blockedCount === 1 ? "" : "s"}`}</p>}
        </div>
        {!loading && blockedCount > 0 && (
          <Button
            variant={showBlocked ? "default" : "outline"}
            size="sm"
            onClick={() => setShowBlocked(v => !v)}
          >
            {showBlocked ? "Ocultar bloqueados" : `Mostrar ${blockedCount} bloqueado${blockedCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum agendamento realizado</h3>
          <p className="text-muted-foreground">Os agendamentos feitos por este widget aparecerao aqui.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead k="start_time">Data/Hora</SortableHead>
                <SortableHead k="created_at">Agendado em</SortableHead>
                <SortableHead k="contact_name">Contato</SortableHead>
                <SortableHead k="contact_email">Email</SortableHead>
                <SortableHead k="contact_phone">WhatsApp</SortableHead>
                <SortableHead k="member_name">Membro</SortableHead>
                <SortableHead k="status">Status</SortableHead>
                <TableHead>Reuniao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map(r => {
                const st = STATUS_MAP[r.status || "scheduled"] || STATUS_MAP.scheduled;
                const link = r.meeting_link || r.daily_room_url;
                const isOpen = expanded.has(r.id);
                const q = r.widget_qualification;
                return (
                  <Fragment key={r.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggleExpand(r.id)}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          {formatDateTime(r.start_time)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                      <TableCell>{r.contact_name || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.contact_email || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatPhone(r.contact_phone)}</TableCell>
                      <TableCell>{r.member_name || "-"}</TableCell>
                      <TableCell>
                        {r.kind === "blocked" ? (
                          <Badge variant="destructive" className="text-xs">Bloqueado</Badge>
                        ) : (
                          <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {link ? (
                          <Button variant="ghost" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                            <a href={link} target="_blank" rel="noopener noreferrer">
                              <Video className="h-3 w-3 mr-1" /> Abrir
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={8} className="py-4">
                          {q?.answers ? (
                            <div className="space-y-3">
                              <div className="text-xs font-medium text-foreground flex items-center gap-2">
                                <ClipboardCheck className="h-4 w-4 text-primary" />
                                Qualificação enviada ao widget
                                <span className="text-[10px] text-muted-foreground font-normal">(avaliação determinística, sem IA)</span>
                              </div>
                              {r.kind === "blocked" && r.failed_dimensions && r.failed_dimensions.length > 0 && (
                                <div className="text-xs text-destructive">
                                  Reprovado em: {r.failed_dimensions.map(d => DIMENSION_LABELS[d] || d).join(", ")}
                                </div>
                              )}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                <div><div className="text-xs text-muted-foreground">Cargo</div><div className="text-foreground">{q.answers.job_title ?? "—"}</div></div>
                                <div><div className="text-xs text-muted-foreground">Empresa</div><div className="text-foreground">{q.answers.company ?? "—"}</div></div>
                                <div><div className="text-xs text-muted-foreground">Faturamento</div><div className="text-foreground">{q.answers.revenue ?? "—"}</div></div>
                                <div><div className="text-xs text-muted-foreground">Funcionários</div><div className="text-foreground">{q.answers.employee_count ?? "—"}</div></div>
                              </div>
                              {q.icp_enabled && q.icp_config_snapshot && (
                                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
                                  <div className="text-foreground font-medium">Opções de ICP aceitas no momento do agendamento:</div>
                                  <div><span className="text-foreground">Faturamento:</span> {(q.icp_config_snapshot.revenue_ranges ?? []).join(" · ") || "—"}</div>
                                  <div><span className="text-foreground">Cargo:</span> {(q.icp_config_snapshot.job_titles ?? []).join(" · ") || "—"}</div>
                                  <div><span className="text-foreground">Funcionários:</span> {(q.icp_config_snapshot.employee_counts ?? []).join(" · ") || "—"}</div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              Sem dados de qualificação salvos (agendamento anterior à atualização ou criado fora do widget).
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
