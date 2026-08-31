import { useState } from "react";
import { format, startOfMonth, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Download, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RecordingRow {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  transcription_text: string | null;
  crm_appointments: {
    title: string | null;
    start_time: string | null;
    status: string | null;
    lead_id: string | null;
    crm_contacts: { name: string | null; email: string | null; phone: string | null; company: string | null } | null;
  } | null;
}

const PRESETS = [
  { label: "Últimos 7 dias", getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: "Últimos 30 dias", getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "Este mês", getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Últimos 90 dias", getRange: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
];

function csvEscape(value: string | number | null | undefined) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob(["\uFEFF" + content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportTranscriptsDialog({ open, onOpenChange }: Props) {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [from, setFrom] = useState<Date | undefined>(subDays(new Date(), 30));
  const [to, setTo] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState<null | "csv" | "txt">(null);

  const fetchRows = async (): Promise<RecordingRow[]> => {
    const start = new Date(from!);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to!);
    end.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("daily_recordings")
      .select(
        "id, created_at, duration_seconds, transcription_text, crm_appointments!daily_recordings_appointment_id_fkey(title, start_time, status, lead_id, crm_contacts(name, email, phone, company))",
      )
      .eq("workspace_id", workspaceId!)
      .not("transcription_text", "is", null)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);

    if (error) throw error;
    return (data || []) as unknown as RecordingRow[];
  };

  const handleExport = async (kind: "csv" | "txt") => {
    if (!workspaceId || !from || !to) return;
    setLoading(kind);
    try {
      const rows = await fetchRows();
      if (rows.length === 0) {
        toast({ title: "Nenhuma transcrição encontrada", description: "Ajuste o período selecionado." });
        return;
      }

      const period = `${format(from, "yyyy-MM-dd")}_${format(to, "yyyy-MM-dd")}`;

      if (kind === "csv") {
        const header = [
          "Data da reuniao",
          "Titulo",
          "Contato",
          "Empresa",
          "Email",
          "Telefone",
          "Status",
          "Duracao (min)",
          "Lead ID",
          "Transcricao",
        ];
        const lines = rows.map((r) => {
          const apt = r.crm_appointments;
          const c = apt?.crm_contacts;
          const date = apt?.start_time || r.created_at;
          return [
            format(new Date(date), "dd/MM/yyyy HH:mm", { locale: ptBR }),
            apt?.title || "",
            c?.name || "",
            c?.company || "",
            c?.email || "",
            c?.phone || "",
            apt?.status || "",
            r.duration_seconds ? Math.round(r.duration_seconds / 60) : "",
            apt?.lead_id || "",
            (r.transcription_text || "").replace(/\r?\n/g, " "),
          ]
            .map(csvEscape)
            .join(";");
        });
        download(`transcricoes_${period}.csv`, [header.map(csvEscape).join(";"), ...lines].join("\n"), "text/csv");
      } else {
        const blocks = rows.map((r) => {
          const apt = r.crm_appointments;
          const c = apt?.crm_contacts;
          const date = apt?.start_time || r.created_at;
          return [
            "=".repeat(70),
            `Data: ${format(new Date(date), "dd/MM/yyyy HH:mm", { locale: ptBR })}`,
            `Reunião: ${apt?.title || "Sem título"}`,
            `Contato: ${c?.name || "Não identificado"}${c?.company ? ` (${c.company})` : ""}`,
            r.duration_seconds ? `Duração: ${Math.round(r.duration_seconds / 60)} min` : "",
            "=".repeat(70),
            "",
            r.transcription_text || "",
            "",
          ]
            .filter(Boolean)
            .join("\n");
        });
        download(`transcricoes_${period}.txt`, blocks.join("\n\n"), "text/plain");
      }

      toast({ title: "Exportação concluída", description: `${rows.length} transcrições exportadas.` });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Erro ao exportar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  const DateField = ({ value, onChange, label }: { value?: Date; onChange: (d?: Date) => void; label: string }) => (
    <div className="flex-1 space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}
          >
            <CalendarIcon className="h-4 w-4 mr-2" />
            {value ? format(value, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-popover border-border" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            initialFocus
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg glass-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Exportar transcrições
          </DialogTitle>
          <DialogDescription>
            Baixe em um único arquivo todas as transcrições das reuniões realizadas no período.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                variant="secondary"
                size="sm"
                onClick={() => {
                  const r = p.getRange();
                  setFrom(r.from);
                  setTo(r.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="flex gap-3">
            <DateField label="De" value={from} onChange={setFrom} />
            <DateField label="Até" value={to} onChange={setTo} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleExport("txt")} disabled={!!loading || !from || !to}>
            {loading === "txt" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Baixar TXT
          </Button>
          <Button onClick={() => handleExport("csv")} disabled={!!loading || !from || !to}>
            {loading === "csv" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Baixar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
