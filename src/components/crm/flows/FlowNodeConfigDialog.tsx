import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  NODE_LABELS, splitMinutes, joinMinutes, branchFieldDef,
  type FlowNodeType, type BranchRule,
} from "@/lib/flows";
import { BranchRulesEditor } from "./BranchRulesEditor";
import { WhatsAppNodeConfig } from "./WhatsAppNodeConfig";
import { RichTextEditor } from "./RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Eye } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: FlowNodeType | null;
  initialConfig: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  workspaceId: string;
  companyId: string;
}

export function FlowNodeConfigDialog({ open, onOpenChange, type, initialConfig, onSave, workspaceId, companyId }: Props) {
  const { toast } = useToast();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [emailPreview, setEmailPreview] = useState(false);

  useEffect(() => {
    if (open) {
      setConfig({ ...initialConfig });
      setEmailPreview(false);
    }
  }, [open, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: lossReasons } = useQuery({
    queryKey: ["flow-loss-reasons", workspaceId],
    enabled: open && type === "close_lead" && !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_loss_reasons")
        .select("id, name")
        .eq("workspace_id", workspaceId);
      return data || [];
    },
  });

  const handleSave = () => {
    if (type === "delay") {
      const minutes = Number(config.minutes) || 0;
      if (minutes < 1) {
        toast({ variant: "destructive", title: "Espera inválida", description: "A espera precisa ser de ao menos 1 minuto." });
        return;
      }
      onSave({ minutes });
    } else if (type === "branch") {
      const rules = (config.rules as BranchRule[] | undefined) || [];
      const valid = rules.filter((r) => r.field && r.operator && branchFieldDef(r.field));
      if (valid.length === 0) {
        toast({ variant: "destructive", title: "Condição vazia", description: "Adicione ao menos uma regra completa." });
        return;
      }
      const incomplete = valid.some((r) => {
        const def = branchFieldDef(r.field)!;
        const needsValue = def.valueKind !== "none" && r.operator !== "empty" && r.operator !== "not_empty";
        return needsValue && (r.value === undefined || r.value === null || r.value === "");
      });
      if (incomplete) {
        toast({ variant: "destructive", title: "Regra incompleta", description: "Preencha o valor de todas as regras." });
        return;
      }
      onSave({ logic: config.logic === "or" ? "or" : "and", rules: valid });
    } else if (type === "close_lead") {
      const outcome = config.outcome === "lost" ? "lost" : "won";
      if (outcome === "lost" && !config.loss_reason_id) {
        toast({ variant: "destructive", title: "Motivo obrigatório", description: "Selecione o motivo de perda." });
        return;
      }
      onSave({ outcome, loss_reason_id: outcome === "lost" ? config.loss_reason_id : null });
    } else if (type === "send_whatsapp") {
      // Preenchido na Task 5 (WhatsAppNodeConfig valida conteúdo/mídia)
      const content = typeof config.content === "string" ? config.content.trim() : "";
      if (!content && !config.media_url) {
        toast({ variant: "destructive", title: "Mensagem vazia", description: "Escreva o conteúdo ou anexe uma mídia." });
        return;
      }
      onSave(config);
    } else if (type === "send_email") {
      const subject = typeof config.subject === "string" ? config.subject.trim() : "";
      const html = typeof config.html === "string" ? config.html : "";
      // O editor devolve "<p></p>" quando vazio — não conta como conteúdo
      const hasBody = html.replace(/<[^>]*>/g, "").trim().length > 0 || /<img\s/i.test(html);
      if (!subject) {
        toast({ variant: "destructive", title: "Assunto obrigatório", description: "Escreva o assunto do e-mail." });
        return;
      }
      if (!hasBody) {
        toast({ variant: "destructive", title: "E-mail vazio", description: "Escreva o conteúdo do e-mail." });
        return;
      }
      onSave({
        subject,
        from_name: typeof config.from_name === "string" && config.from_name.trim() ? config.from_name.trim() : null,
        html,
      });
    }
    onOpenChange(false);
  };

  const delayParts = splitMinutes(Number(config.minutes) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[940px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type ? NODE_LABELS[type] : ""}</DialogTitle>
        </DialogHeader>

        {type === "delay" && (
          <div className="flex items-end gap-3">
            {(["days", "hours", "minutes"] as const).map((unit) => (
              <div key={unit} className="space-y-1">
                <Label className="text-xs">{unit === "days" ? "Dias" : unit === "hours" ? "Horas" : "Minutos"}</Label>
                <Input
                  type="number" min={0} className="w-24"
                  value={delayParts[unit]}
                  onChange={(e) => {
                    const v = Math.max(0, parseInt(e.target.value) || 0);
                    const next = { ...delayParts, [unit]: v };
                    setConfig({ ...config, minutes: joinMinutes(next.days, next.hours, next.minutes) });
                  }}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground pb-2">após o passo anterior</p>
          </div>
        )}

        {type === "branch" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs">As regras se combinam por</Label>
              <Select
                value={config.logic === "or" ? "or" : "and"}
                onValueChange={(v) => setConfig({ ...config, logic: v })}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">E</SelectItem>
                  <SelectItem value="or">OU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BranchRulesEditor
              rules={(config.rules as BranchRule[] | undefined) || []}
              onChange={(rules) => setConfig({ ...config, rules })}
              workspaceId={workspaceId}
              companyId={companyId}
            />
            <p className="text-[11px] text-muted-foreground">
              A condição é avaliada no momento em que o lead chega neste passo. Regra sem dado no card conta como "Não".
            </p>
          </div>
        )}

        {type === "close_lead" && (
          <div className="space-y-4">
            <RadioGroup
              value={config.outcome === "lost" ? "lost" : "won"}
              onValueChange={(v) => setConfig({ ...config, outcome: v })}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="won" id="flow-won" />
                <Label htmlFor="flow-won">Marcar como ganho</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="lost" id="flow-lost" />
                <Label htmlFor="flow-lost">Marcar como perdido</Label>
              </div>
            </RadioGroup>
            {config.outcome === "lost" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Motivo de perda</Label>
                <Select
                  value={typeof config.loss_reason_id === "string" ? config.loss_reason_id : ""}
                  onValueChange={(v) => setConfig({ ...config, loss_reason_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {(lossReasons || []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Este passo é terminal: fecha o card no pipeline (mesmo efeito do fechamento manual) e encerra o fluxo para o lead.
            </p>
          </div>
        )}

        {type === "send_whatsapp" && (
          <WhatsAppNodeConfig
            config={config}
            onChange={setConfig}
            workspaceId={workspaceId}
            companyId={companyId}
          />
        )}

        {type === "send_email" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Assunto</Label>
                <Input
                  value={typeof config.subject === "string" ? config.subject : ""}
                  onChange={(e) => setConfig({ ...config, subject: e.target.value })}
                  placeholder="Olá {primeiro_nome}, sobre nossa conversa"
                />
                <p className="text-[11px] text-muted-foreground">Aceita variáveis.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Remetente (opcional)</Label>
                <Input
                  value={typeof config.from_name === "string" ? config.from_name : ""}
                  onChange={(e) => setConfig({ ...config, from_name: e.target.value })}
                  placeholder="Ex.: {atendente} da Empresa"
                />
                <p className="text-[11px] text-muted-foreground">Padrão: nome do atendente do lead.</p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Conteúdo</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setEmailPreview((p) => !p)}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  {emailPreview ? "Editar" : "Visualizar"}
                </Button>
              </div>
              {emailPreview ? (
                <div className="rounded-md border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-2 pb-2 border-b border-border">
                    Assunto: {typeof config.subject === "string" && config.subject ? config.subject : "(sem assunto)"}
                  </p>
                  {/* iframe com sandbox vazio: o HTML do e-mail é renderizado isolado
                      (sem scripts, sem acesso ao app) e mais fiel ao cliente de e-mail */}
                  <iframe
                    title="Pré-visualização do e-mail"
                    sandbox=""
                    className="w-full min-h-[200px] bg-white rounded"
                    srcDoc={`<!doctype html><meta charset="utf-8"><style>
                      body{font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;margin:12px;line-height:1.5}
                      h1{font-size:26px;margin:.5em 0}h2{font-size:21px;margin:.5em 0}
                      h3{font-size:18px;margin:.4em 0}h4{font-size:16px;margin:.4em 0}
                      p{margin:.4em 0}img{max-width:100%;height:auto}
                      blockquote{border-left:3px solid #ddd;margin:.5em 0;padding-left:12px;color:#555}
                      hr{border:0;border-top:1px solid #ddd;margin:1em 0}
                      ul{padding-left:20px}ol{padding-left:20px}a{color:#2563eb}
                    </style><body>${typeof config.html === "string" ? config.html : ""}</body>`}
                  />
                </div>
              ) : (
                <RichTextEditor
                  value={typeof config.html === "string" ? config.html : ""}
                  onChange={(html) => setConfig({ ...config, html })}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                Variáveis: {"{nome_lead}"}, {"{primeiro_nome}"}, {"{empresa}"}, {"{atendente}"} — funcionam no assunto, no remetente e no conteúdo.
                O envio usa a integração Resend configurada em Configurações {">"} Empresa.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
