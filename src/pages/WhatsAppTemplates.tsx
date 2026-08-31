import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Loader2, RefreshCw, Plus, Trash2, FileText, MessageSquare, Tag, Sparkles, Pencil } from "lucide-react";

// Parse [nome] tokens in order of appearance and return { text: normalized, map: {1:"nome",...} }
function extractVariables(input: string, startIndex = 1): { text: string; map: Record<string, string>; nextIndex: number } {
  const map: Record<string, string> = {};
  const keyToIndex: Record<string, number> = {};
  let idx = startIndex;
  const text = (input || "").replace(/\[([a-zA-ZÀ-ÿ0-9_ ]+)\]/g, (_m, raw) => {
    const key = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
    if (!key) return _m;
    if (!(key in keyToIndex)) {
      keyToIndex[key] = idx;
      map[String(idx)] = key;
      idx++;
    }
    return `{{${keyToIndex[key]}}}`;
  });
  return { text, map, nextIndex: idx };
}

// Convert {{N}} back to [nome] using a variable_map
function friendlyText(text: string, map: Record<string, string> | null | undefined): string {
  if (!map || !text) return text || "";
  return text.replace(/\{\{(\d+)\}\}/g, (_m, n) => (map[n] ? `[${map[n]}]` : _m));
}

// Detect friendly variables preserving order & uniqueness
function detectFriendlyVars(...texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const re = /\[([a-zA-ZÀ-ÿ0-9_ ]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t || "")) !== null) {
      const k = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      if (k && !seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  return out;
}

interface Connection {
  id: string;
  provider: string | null;
  display_phone_number?: string | null;
  verified_name?: string | null;
  business_account_id?: string | null;
  is_active?: boolean;
}

interface Template {
  id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
  rejection_reason: string | null;
  synced_at: string | null;
  variable_map?: Record<string, string> | null;
  variable_examples?: Record<string, string> | null;
}

const CATEGORY_OPTIONS = [
  { value: "MARKETING", label: "Marketing" },
  { value: "UTILITY", label: "Utility" },
  { value: "AUTHENTICATION", label: "Authentication" },
];

const LANG_OPTIONS = [
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "en_US", label: "English (US)" },
  { value: "es_ES", label: "Español (Espanha)" },
  { value: "es_MX", label: "Español (México)" },
];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status?.toUpperCase()) {
    case "APPROVED": return "default";
    case "REJECTED": return "destructive";
    case "PAUSED":
    case "DISABLED": return "secondary";
    default: return "outline";
  }
}

export default function WhatsAppTemplates() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [loadingConns, setLoadingConns] = useState(true);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingTpl, setDeletingTpl] = useState<Template | null>(null);
  const [detailTpl, setDetailTpl] = useState<Template | null>(null);

  // Create/Edit form state
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  // key = friendly variable key (e.g. "nome"), value = example string
  const [variableExamples, setVariableExamples] = useState<Record<string, string>>({});

  const currentConn = useMemo(
    () => connections.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

  useEffect(() => {
    (async () => {
      if (!currentWorkspace?.id) return;
      setLoadingConns(true);
      const { data, error } = await supabase
        .from("whatsapp_connections")
        .select("id, provider, display_phone_number, verified_name, business_account_id, is_active")
        .eq("workspace_id", currentWorkspace.id)
        .eq("provider", "official")
        .order("created_at", { ascending: true });
      if (error) {
        toast({ variant: "destructive", title: "Erro ao carregar conexões", description: error.message });
      } else {
        const list = (data as Connection[]) || [];
        setConnections(list);
        if (list.length && !connectionId) setConnectionId(list[0].id);
      }
      setLoadingConns(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace?.id]);

  const loadTemplates = async () => {
    if (!connectionId) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: { action: "list", connection_id: connectionId },
    });
    if (error || (data as any)?.error) {
      toast({ variant: "destructive", title: "Erro ao listar modelos", description: (data as any)?.error || error?.message });
    } else {
      setTemplates(((data as any)?.templates as Template[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { loadTemplates(); /* eslint-disable-next-line */ }, [connectionId]);

  const handleSync = async () => {
    if (!connectionId) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: { action: "sync", connection_id: connectionId },
    });
    if (error || (data as any)?.error) {
      toast({ variant: "destructive", title: "Falha na sincronização", description: (data as any)?.error || error?.message });
    } else {
      toast({ title: "Sincronizado", description: `${(data as any)?.synced ?? 0} modelos atualizados.` });
      await loadTemplates();
    }
    setSyncing(false);
  };

  const resetCreateForm = () => {
    setEditingId(null);
    setName(""); setLanguage("pt_BR"); setCategory("UTILITY");
    setHeaderText(""); setBodyText(""); setFooterText("");
    setVariableExamples({});
  };

  const openEditDraft = (tpl: Template) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setLanguage(tpl.language);
    setCategory(tpl.category);
    const comps = (tpl.components || []) as any[];
    const header = comps.find((c) => c.type === "HEADER");
    const bodyC = comps.find((c) => c.type === "BODY");
    const footer = comps.find((c) => c.type === "FOOTER");
    const vmap = tpl.variable_map || {};
    setHeaderText(friendlyText(header?.text || "", vmap));
    setBodyText(friendlyText(bodyC?.text || "", vmap));
    setFooterText(friendlyText(footer?.text || "", vmap));
    // Convert stored variable_examples (indexed by {{N}} numbers) to friendly-name-keyed map
    const storedEx = (tpl.variable_examples || {}) as Record<string, string>;
    const friendlyEx: Record<string, string> = {};
    for (const [numStr, val] of Object.entries(storedEx)) {
      const friendly = vmap[numStr];
      if (friendly) friendlyEx[friendly] = String(val);
    }
    setVariableExamples(friendlyEx);
    setCreateOpen(true);
  };

  const handleCreate = async (asDraft = false) => {
    if (!name.trim() || !bodyText.trim()) {
      toast({ variant: "destructive", title: "Campos obrigatórios", description: "Nome e corpo são obrigatórios." });
      return;
    }
    // Meta requires name to be lowercase, alphanumeric + underscores
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

    // Convert [nome] tokens to sequential {{N}} keeping a shared numbering across components
    const header = extractVariables(headerText, 1);
    const body = extractVariables(bodyText, header.nextIndex);
    const footer = extractVariables(footerText, body.nextIndex);
    const variable_map = { ...header.map, ...body.map, ...footer.map };

    // Map examples by {{N}} number using variable_map (num -> friendly key)
    const variable_examples: Record<string, string> = {};
    for (const [numStr, friendly] of Object.entries(variable_map)) {
      const val = variableExamples[friendly];
      if (val && String(val).trim()) variable_examples[numStr] = String(val).trim();
    }

    const components: any[] = [];
    if (header.text.trim()) components.push({ type: "HEADER", format: "TEXT", text: header.text.trim() });
    components.push({ type: "BODY", text: body.text.trim() });
    if (footer.text.trim()) components.push({ type: "FOOTER", text: footer.text.trim() });

    // Meta rule: variables ({{N}}) cannot be at the very start or end of BODY/HEADER text
    const varEdgeRe = /(^\s*\{\{\d+\}\})|(\{\{\d+\}\}\s*$)/;
    for (const c of components) {
      if ((c.type === "BODY" || c.type === "HEADER") && varEdgeRe.test(c.text || "")) {
        toast({
          variant: "destructive",
          title: "Variável em posição inválida",
          description: `A Meta não permite variáveis no início ou no fim do ${c.type === "BODY" ? "corpo" : "cabeçalho"}. Adicione texto antes/depois da variável (ex.: "Olá [nome], ...").`,
        });
        return;
      }
    }


    const isEditing = !!editingId;
    setCreating(true);
    // When editing, always save changes first (as draft update)
    const saveAction = isEditing || asDraft ? "save_draft" : "create";
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: {
        action: saveAction,
        connection_id: connectionId,
        name: safeName,
        language,
        category,
        components,
        variable_map,
        variable_examples,
        ...(isEditing ? { id: editingId } : {}),
      },
    });
    if (error || (data as any)?.error) {
      toast({ variant: "destructive", title: isEditing ? "Erro ao atualizar rascunho" : (asDraft ? "Erro ao salvar rascunho" : "Erro ao criar modelo"), description: (data as any)?.error || error?.message });
      setCreating(false);
      return;
    }

    // If editing and user chose "Enviar para aprovação", submit the just-saved draft
    if (isEditing && !asDraft) {
      const tplId = (data as any)?.template?.id || editingId;
      const { data: subData, error: subErr } = await supabase.functions.invoke("whatsapp-templates", {
        body: { action: "submit_draft", connection_id: connectionId, template_id: tplId },
      });
      if (subErr || (subData as any)?.error) {
        toast({ variant: "destructive", title: "Erro ao enviar para aprovação", description: (subData as any)?.error || subErr?.message });
        await loadTemplates();
        setCreating(false);
        return;
      }
      toast({ title: "Modelo enviado para aprovação", description: "A Meta pode levar minutos para aprovar." });
    } else {
      toast({
        title: isEditing ? "Rascunho atualizado" : (asDraft ? "Rascunho salvo" : "Modelo enviado para aprovação"),
        description: isEditing ? "As alterações foram salvas." : (asDraft ? "Você pode enviar para aprovação depois." : "A Meta pode levar minutos para aprovar."),
      });
    }
    setCreateOpen(false);
    resetCreateForm();
    await loadTemplates();
    setCreating(false);
  };

  const handleSubmitDraft = async (tpl: Template) => {
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: { action: "submit_draft", connection_id: connectionId, template_id: tpl.id },
    });
    if (error || (data as any)?.error) {
      toast({ variant: "destructive", title: "Erro ao enviar rascunho", description: (data as any)?.error || error?.message });
    } else {
      toast({ title: "Rascunho enviado para aprovação" });
      await loadTemplates();
    }
  };

  const handleDelete = async () => {
    if (!deletingTpl) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-templates", {
      body: {
        action: "delete",
        connection_id: connectionId,
        name: deletingTpl.name,
        hsm_id: deletingTpl.meta_template_id ?? undefined,
      },
    });
    if (error || (data as any)?.error) {
      toast({ variant: "destructive", title: "Erro ao remover", description: (data as any)?.error || error?.message });
    } else {
      toast({ title: "Modelo removido" });
      await loadTemplates();
    }
    setDeletingTpl(null);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Modelos de Mensagem (WhatsApp Business API)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie os templates HSM aprovados pela Meta para cada conexão do WhatsApp Oficial. Templates aprovados podem ser usados nas Réguas para envios fora da janela de 24h.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conexão</CardTitle>
          <CardDescription>Selecione a conexão do WhatsApp Business API deste workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConns ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando conexões...
            </div>
          ) : connections.length === 0 ? (
            <div className="text-sm text-muted-foreground border border-dashed rounded-md p-6 text-center">
              Nenhuma conexão do WhatsApp Oficial cadastrada neste workspace.
              <br />
              Cadastre em <a className="underline" href="/connections">Conexões</a> antes de gerenciar modelos.
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Conexão</Label>
                <Select value={connectionId} onValueChange={setConnectionId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.verified_name || c.display_phone_number || `WABA ${c.business_account_id ?? c.id.slice(0, 6)}`}
                        {c.is_active ? "" : " (inativa)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleSync} disabled={syncing || !connectionId}>
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Sincronizar com Meta
                </Button>
                <Button onClick={() => setCreateOpen(true)} disabled={!connectionId}>
                  <Plus className="h-4 w-4 mr-2" /> Novo modelo
                </Button>
              </div>
            </div>
          )}
          {connectionId && (
            <p className="text-xs text-muted-foreground mt-3">
              Sincronização automática a cada 30 min + atualização em tempo real via webhook da Meta (aprovação/rejeição).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos cadastrados</CardTitle>
          <CardDescription>
            {currentConn ? (
              <>Conexão: <span className="font-medium">{currentConn.verified_name || currentConn.display_phone_number || currentConn.id}</span></>
            ) : "Selecione uma conexão para ver os modelos."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
              Nenhum modelo cadastrado. Clique em "Sincronizar com Meta" para importar os existentes ou em "Novo modelo" para criar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Idioma</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Última sync</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.name}</TableCell>
                      <TableCell className="text-xs">{t.language}</TableCell>
                      <TableCell className="text-xs">{t.category}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                        {t.rejection_reason && (
                          <div className="text-[10px] text-destructive mt-1">{t.rejection_reason}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.synced_at ? new Date(t.synced_at).toLocaleString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {t.status?.toUpperCase() === "DRAFT" && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEditDraft(t)}>
                              <Pencil className="h-3 w-3 mr-1" /> Editar
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleSubmitDraft(t)}>
                              <Sparkles className="h-3 w-3 mr-1 text-primary" /> Enviar
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setDetailTpl(t)}>
                          <MessageSquare className="h-3 w-3 mr-1" /> Ver
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeletingTpl(t)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
        <DialogContent className="glass-card max-w-2xl max-h-[90vh] overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> {editingId ? "Editar rascunho HSM" : "Novo modelo HSM"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              O modelo será enviado para aprovação da Meta. Use variáveis no formato{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[11px]">[nome]</code>,{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[11px]">[empresa]</code>,{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[11px]">[data]</code> — serão convertidas automaticamente para o padrão da Meta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Identificação */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificação</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-sm font-medium text-foreground">Nome (identificador único)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: lembrete_reuniao" />
                  <p className="text-[11px] text-muted-foreground">Será convertido para minúsculo, sem espaços.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-foreground">Idioma</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANG_OPTIONS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Conteúdo */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conteúdo</h3>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Cabeçalho <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Ex.: Lembrete de agendamento" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Corpo <span className="text-destructive">*</span></Label>
                <Textarea rows={5} value={bodyText} onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Olá [nome], tudo bem? Passando para lembrar da nossa reunião em [data]." />
                <p className="text-[11px] text-muted-foreground">
                  Use colchetes para inserir variáveis dinâmicas — ex.: <code className="font-mono">[nome]</code>, <code className="font-mono">[empresa]</code>.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-foreground">Rodapé <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Enviado por Nexus" />
              </div>

              {/* Variáveis detectadas + exemplos exigidos pela Meta */}
              {(() => {
                const vars = detectFriendlyVars(headerText, bodyText, footerText);
                if (!vars.length) return null;
                return (
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Tag className="h-3.5 w-3.5 text-primary" /> Exemplos das variáveis
                    </div>
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      A Meta exige um valor de exemplo para cada variável. Informe um valor realista que represente o conteúdo que será enviado (ex.: para <code className="font-mono">[nome]</code> → "João Silva").
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {vars.map((v, i) => (
                        <div key={v} className="space-y-1">
                          <Label className="text-[11px] font-mono text-muted-foreground">
                            {`{{${i + 1}}}`} → [{v}]
                          </Label>
                          <Input
                            value={variableExamples[v] || ""}
                            onChange={(e) => setVariableExamples((prev) => ({ ...prev, [v]: e.target.value }))}
                            placeholder={`Ex.: ${v === "nome" ? "João Silva" : v === "data" ? "15/07 às 14h" : v === "empresa" ? "Nexus AI" : `exemplo de ${v}`}`}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button variant="outline" onClick={() => handleCreate(true)} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />} {editingId ? "Salvar alterações" : "Salvar rascunho"}
            </Button>
            <Button onClick={() => handleCreate(false)} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Enviar para aprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailTpl} onOpenChange={(o) => !o && setDetailTpl(null)}>
        <DialogContent className="glass-card max-w-2xl max-h-[90vh] overflow-y-auto border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <MessageSquare className="h-4 w-4 text-primary" /> {detailTpl?.name}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-muted-foreground">
              <span>{detailTpl?.language}</span>·<span>{detailTpl?.category}</span>·
              <Badge variant={statusVariant(detailTpl?.status || "")}>{detailTpl?.status}</Badge>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(detailTpl?.components || []).map((c: any, i: number) => (
              <div key={i} className="border border-border bg-muted/20 rounded-md p-3">
                <div className="text-[11px] font-mono uppercase text-muted-foreground mb-1">{c.type}{c.format ? ` · ${c.format}` : ""}</div>
                <div className="text-sm whitespace-pre-wrap text-foreground">
                  {friendlyText(c.text || "", detailTpl?.variable_map) || JSON.stringify(c)}
                </div>
              </div>
            ))}
            {detailTpl?.variable_map && Object.keys(detailTpl.variable_map).length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Tag className="h-3.5 w-3.5 text-primary" /> Variáveis
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(detailTpl.variable_map).map(([n, k]) => (
                    <Badge key={n} variant="secondary" className="font-mono text-[11px]">
                      {`{{${n}}}`} → [{k}]
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {detailTpl?.rejection_reason && (
              <div className="text-sm text-destructive">Motivo de rejeição: {detailTpl.rejection_reason}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* Delete confirm */}
      <AlertDialog open={!!deletingTpl} onOpenChange={(o) => !o && setDeletingTpl(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo <span className="font-mono">{deletingTpl?.name}</span> será removido da Meta e do cache local. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
