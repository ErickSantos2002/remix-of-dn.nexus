import { useEffect, useMemo, useState } from "react";
import { Send, Loader2, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type TemplateComponent = {
  type: string;
  text?: string;
  format?: string;
};

type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: TemplateComponent[];
  variable_map: Record<string, string> | null;
};

export interface SendTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  workspaceId: string | null;
  onSend: (payload: {
    templateName: string;
    languageCode: string;
    variables: string[];
    renderedText: string;
  }) => Promise<void>;
}

// Extract body text and detected {{n}} variables (or friendly [name] tokens)
function extractBody(tpl: Template): { rawBody: string; variables: string[] } {
  const body = (tpl.components || []).find((c) => c.type === "BODY");
  const raw = body?.text || "";
  const numeric = Array.from(raw.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
  const unique = Array.from(new Set(numeric)).sort(
    (a, b) => Number(a) - Number(b)
  );
  return { rawBody: raw, variables: unique };
}

function renderBody(rawBody: string, values: Record<string, string>): string {
  return rawBody.replace(/\{\{(\d+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
}

export function SendTemplateDialog({
  open,
  onOpenChange,
  connectionId,
  workspaceId,
  onSend,
}: SendTemplateDialogProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !connectionId || !workspaceId) return;
    setLoading(true);
    setSelectedId(null);
    setValues({});
    (async () => {
      const { data, error } = await supabase
        .from("whatsapp_message_templates")
        .select("id, name, language, category, status, components, variable_map")
        .eq("connection_id", connectionId)
        .eq("workspace_id", workspaceId)
        .eq("status", "APPROVED")
        .order("name", { ascending: true });
      if (error) {
        toast({
          variant: "destructive",
          title: "Erro ao carregar modelos",
          description: error.message,
        });
      } else {
        setTemplates((data as unknown as Template[]) || []);
      }
      setLoading(false);
    })();
  }, [open, connectionId, workspaceId, toast]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId]
  );

  const { rawBody, variables } = useMemo(() => {
    if (!selected) return { rawBody: "", variables: [] as string[] };
    return extractBody(selected);
  }, [selected]);

  const rendered = useMemo(
    () => renderBody(rawBody, values),
    [rawBody, values]
  );

  const missingVars = variables.filter((v) => !values[v]?.trim());
  const canSend = !!selected && missingVars.length === 0 && !sending;

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      const orderedVars = variables.map((v) => values[v] || "");
      await onSend({
        templateName: selected.name,
        languageCode: selected.language,
        variables: orderedVars,
        renderedText: rendered,
      });
      onOpenChange(false);
    } catch (e) {
      // parent handles toast
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar modelo aprovado</DialogTitle>
          <DialogDescription>
            Fora da janela de 24h só é permitido enviar mensagens usando um
            modelo (HSM) aprovado pela Meta.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Nenhum modelo aprovado disponível para esta conexão. Cadastre e
            aprove modelos em Configurações → WhatsApp Templates.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
            <ScrollArea className="max-h-[320px] rounded-lg border border-border">
              <div className="p-1">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(tpl.id);
                      setValues({});
                    }}
                    className={cn(
                      "w-full text-left px-2 py-2 rounded-md text-xs flex flex-col gap-0.5 transition-colors",
                      selectedId === tpl.id
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted text-muted-foreground"
                    )}
                  >
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <FileText className="h-3 w-3" />
                      {tpl.name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] py-0 px-1">
                        {tpl.language}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] py-0 px-1">
                        {tpl.category}
                      </Badge>
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>

            <div className="space-y-3">
              {!selected ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Selecione um modelo à esquerda.
                </div>
              ) : (
                <>
                  {variables.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Variáveis
                      </Label>
                      {variables.map((v) => {
                        const friendly = selected.variable_map?.[v] || `Variável ${v}`;
                        return (
                          <div key={v} className="space-y-1">
                            <Label className="text-[11px]">
                              {friendly}
                              <span className="text-muted-foreground ml-1">
                                (&#123;&#123;{v}&#125;&#125;)
                              </span>
                            </Label>
                            <Input
                              value={values[v] || ""}
                              onChange={(e) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [v]: e.target.value,
                                }))
                              }
                              placeholder={friendly}
                              className="h-8 text-xs"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Prévia
                    </Label>
                    <div className="rounded-lg bg-muted/40 border border-border p-3 whitespace-pre-wrap text-xs text-foreground min-h-[60px]">
                      {rendered || "—"}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Enviar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
