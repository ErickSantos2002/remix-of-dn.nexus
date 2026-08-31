import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Plus, Trash2, Save, Upload, X, Image as ImageIcon, Video as VideoIcon, GripVertical } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface CadenceTemplate {
  id?: string;
  channel: "whatsapp" | "email";
  subject?: string;
  from_name?: string | null;
  content: string;
  offset_value: number;
  offset_unit: "minutes" | "hours" | "days";
  day_period: "manha" | "tarde" | "noite" | "qualquer";
  order: number;
  is_active: boolean;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  agent_id?: string | null;
  agent_source?: "agents" | "agent_instances" | null;
  ai_rewrite_enabled?: boolean;
}


interface AgentOption {
  id: string;
  name: string;
  workspace_id: string;
  workspace_name?: string | null;
  source: "agents" | "agent_instances";
}

interface Props {
  ruleId: string;
  triggerType: "activity" | "stage";
  /** Etapa migrada para Fluxos v2: a régua vira histórico e não aceita edição. */
  readOnly?: boolean;
  /** Nome do fluxo que assumiu a etapa, exibido no aviso de somente-leitura. */
  readOnlyFlowName?: string;
}

const VARS_HINT_ACTIVITY = "Variáveis: {nome_lead}, {primeiro_nome}, {empresa}, {atendente}, {titulo_atividade}, {data_atividade}, {hora_atividade}, {link_reuniao} (apenas reunião/demo)";
const VARS_HINT_STAGE = "Variáveis: {nome_lead}, {primeiro_nome}, {empresa}, {atendente}";

function SortableTemplateItem({ id, children }: { id: string; children: (handleProps: { listeners: any; attributes: any }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : "auto" as const,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ listeners, attributes })}
    </div>
  );
}

export function CadenceTemplateEditor({ ruleId, triggerType, readOnly = false, readOnlyFlowName }: Props) {
  const { toast } = useToast();
  const { currentCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<CadenceTemplate[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cadence_templates" as any)
      .select("*")
      .eq("rule_id", ruleId)
      .order("order", { ascending: true });
    if (!error) setTemplates((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId]);

  useEffect(() => {
    const fetchAgents = async () => {
      if (!currentCompany?.id) return;

      // Workspaces da empresa atual
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("company_id", currentCompany.id);
      const workspaces = (wsData as any[]) || [];
      const wsIds = workspaces.map((w) => w.id);
      const wsName: Record<string, string> = {};
      workspaces.forEach((w) => { wsName[w.id] = w.name; });

      if (wsIds.length === 0) {
        setAgents([]);
        return;
      }

      const [legacyRes, instancesRes] = await Promise.all([
        supabase
          .from("agents" as any)
          .select("id, name, workspace_id")
          .in("workspace_id", wsIds)
          .eq("is_active", true)
          .eq("is_archived", false),
        supabase
          .from("agent_instances" as any)
          .select("id, name, workspace_id")
          .in("workspace_id", wsIds)
          .eq("is_active", true)
          .eq("is_archived", false),
      ]);

      const legacy: AgentOption[] = (((legacyRes.data as any[]) || []).map((a) => ({
        id: a.id,
        name: a.name,
        workspace_id: a.workspace_id,
        workspace_name: wsName[a.workspace_id] ?? null,
        source: "agents" as const,
      })));
      const instances: AgentOption[] = (((instancesRes.data as any[]) || []).map((a) => ({
        id: a.id,
        name: a.name,
        workspace_id: a.workspace_id,
        workspace_name: wsName[a.workspace_id] ?? null,
        source: "agent_instances" as const,
      })));

      const merged = [...legacy, ...instances].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setAgents(merged);
    };
    fetchAgents();
  }, [currentCompany?.id]);

  const addTemplate = () => {
    if (readOnly) return;
    setTemplates((prev) => [
      ...prev,
      {
        channel: "whatsapp",
        content: "",
        offset_value: triggerType === "activity" ? 1 : 0,
        offset_unit: triggerType === "activity" ? "hours" : "minutes",
        day_period: "qualquer",
        order: prev.length,
        is_active: true,
        media_url: null,
        media_type: null,
        agent_id: null,
        agent_source: null,
        ai_rewrite_enabled: false,
      },
    ]);
  };

  const updateTemplate = (idx: number, patch: Partial<CadenceTemplate>) => {
    setTemplates((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTemplate = async (idx: number) => {
    if (readOnly) return;
    const t = templates[idx];
    if (t.id) {
      const { error } = await supabase.from("cadence_templates" as any).delete().eq("id", t.id);
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        return;
      }
    }
    setTemplates((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMediaUpload = async (idx: number, file: File, kind: "image" | "video") => {
    if (!currentCompany?.id) return;
    const maxBytes = kind === "image" ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast({
        variant: "destructive",
        title: "Arquivo muito grande",
        description: kind === "image" ? "Imagens devem ter no máximo 5 MB." : "Vídeos devem ter no máximo 16 MB.",
      });
      return;
    }
    setUploadingIdx(idx);
    try {
      const ext = (file.name.split(".").pop() || (kind === "image" ? "jpg" : "mp4")).toLowerCase();
      const path = `cadence/${currentCompany.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("widget-assets")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("widget-assets").getPublicUrl(path);
      updateTemplate(idx, { media_url: pub.publicUrl, media_type: kind });
      toast({ title: "Mídia anexada" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro no upload", description: e.message });
    } finally {
      setUploadingIdx(null);
    }
  };

  const removeMedia = (idx: number) => {
    updateTemplate(idx, { media_url: null, media_type: null });
  };

  const handleSaveAll = async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      for (let i = 0; i < templates.length; i++) {
        const t = templates[i];
        if (!t.content.trim() && !t.media_url) continue;
        const payload = {
          rule_id: ruleId,
          channel: t.channel,
          subject: t.subject || null,
          from_name: t.channel === "email" ? (t.from_name || null) : null,
          content: t.content,

          offset_value: t.offset_value,
          offset_unit: t.offset_unit,
          day_period: t.day_period,
          order: i,
          is_active: t.is_active,
          media_url: t.media_url || null,
          media_type: t.media_type || null,
          agent_id: t.channel === "whatsapp" ? (t.agent_id || null) : null,
          agent_source: t.channel === "whatsapp" ? (t.agent_source || null) : null,
          ai_rewrite_enabled: t.channel === "whatsapp" ? !!t.ai_rewrite_enabled : false,
        };
        if (t.id) {
          const { error } = await supabase
            .from("cadence_templates" as any)
            .update(payload)
            .eq("id", t.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("cadence_templates" as any)
            .insert(payload)
            .select()
            .single();
          if (error) throw error;
          templates[i].id = (data as any).id;
        }
      }
      toast({ title: "Templates salvos" });
      fetchTemplates();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao salvar", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = templates.findIndex((t, i) => (t.id ?? `new-${i}`) === active.id);
    const newIndex = templates.findIndex((t, i) => (t.id ?? `new-${i}`) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(templates, oldIndex, newIndex);
    setTemplates(reordered);

    // Persist new order for already-saved templates
    setReordering(true);
    try {
      const updates = reordered
        .map((t, i) => ({ id: t.id, order: i }))
        .filter((u) => !!u.id);
      for (const u of updates) {
        await supabase
          .from("cadence_templates" as any)
          .update({ order: u.order })
          .eq("id", u.id!);
      }
      toast({ title: "Ordem atualizada" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao reordenar", description: e.message });
    } finally {
      setReordering(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hint = triggerType === "activity" ? VARS_HINT_ACTIVITY : VARS_HINT_STAGE;
  const offsetLabel = triggerType === "activity" ? "Antes do evento" : "Após entrada na etapa";

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Somente leitura: esta etapa passou a ser atendida pelo fluxo{" "}
          <span className="font-medium text-foreground">{readOnlyFlowName || "ativo"}</span>. As mensagens abaixo
          continuam sendo enviadas para quem já estava na régua, mas não recebem novos leads nem podem ser editadas.
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">{hint}</p>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addTemplate}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar mensagem
            </Button>
            <Button size="sm" onClick={handleSaveAll} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar tudo
            </Button>
          </div>
        )}
      </div>

      {templates.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-8 border border-dashed rounded-md">
          {readOnly ? "Nenhuma mensagem cadastrada nesta régua." : 'Nenhuma mensagem ainda. Clique em "Adicionar mensagem".'}
        </div>
      )}

      <fieldset disabled={readOnly} className={readOnly ? "min-w-0 opacity-70" : "min-w-0"}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={templates.map((t, i) => t.id ?? `new-${i}`)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {templates.map((t, idx) => {
              const itemId = t.id ?? `new-${idx}`;
              return (
                <SortableTemplateItem key={itemId} id={itemId}>
                  {({ listeners, attributes }) => (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              {...attributes}
                              {...listeners}
                              className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded text-muted-foreground"
                              aria-label="Arrastar para reordenar"
                              title="Arrastar para reordenar"
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            <Switch
                              checked={t.is_active}
                              onCheckedChange={(v) => updateTemplate(idx, { is_active: v })}
                            />
                            <span className="text-xs text-muted-foreground">
                              {t.is_active ? "Ativa" : "Pausada"}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground ml-2">#{idx + 1}</span>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeTemplate(idx)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Canal</Label>
                <Select value={t.channel} onValueChange={(v) => updateTemplate(idx, { channel: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{offsetLabel}</Label>
                <Input
                  type="number"
                  min={0}
                  value={t.offset_value}
                  onChange={(e) => updateTemplate(idx, { offset_value: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade</Label>
                <Select value={t.offset_unit} onValueChange={(v) => updateTemplate(idx, { offset_unit: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Período do dia</Label>
                <Select value={t.day_period} onValueChange={(v) => updateTemplate(idx, { day_period: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qualquer">Qualquer</SelectItem>
                    <SelectItem value="manha">Manhã (6h–12h)</SelectItem>
                    <SelectItem value="tarde">Tarde (12h–18h)</SelectItem>
                    <SelectItem value="noite">Noite (18h–22h)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {t.channel === "email" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Remetente</Label>
                  <Input
                    value={t.from_name || ""}
                    onChange={(e) => updateTemplate(idx, { from_name: e.target.value })}
                    placeholder="Ex.: {atendente} da Empresa"
                  />
                  <p className="text-[11px] text-muted-foreground">Aceita variáveis. Padrão: nome do atendente do lead.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Assunto</Label>
                  <Input
                    value={t.subject || ""}
                    onChange={(e) => updateTemplate(idx, { subject: e.target.value })}
                    placeholder="Ex.: Olá {primeiro_nome}, sobre nossa reunião"
                  />
                  <p className="text-[11px] text-muted-foreground">Aceita variáveis.</p>
                </div>
              </div>
            )}


            {t.channel === "whatsapp" && (
              <div className="space-y-1">
                <Label className="text-xs">Agente IA (assume o chat após envio)</Label>
                <Select
                  value={t.agent_id && t.agent_source ? `${t.agent_source}:${t.agent_id}` : "__keep__"}
                  onValueChange={(v) => {
                    if (v === "__keep__") {
                      updateTemplate(idx, { agent_id: null, agent_source: null });
                    } else {
                      const [src, id] = v.split(":");
                      updateTemplate(idx, {
                        agent_id: id,
                        agent_source: src as "agents" | "agent_instances",
                      });
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__keep__">Manter atribuição atual</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>
                        {a.name}{a.workspace_name ? ` · ${a.workspace_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Ao enviar, o chat será movido para "IA conversando" com este agente ativo. Selecione um agente do mesmo workspace do lead.
                </p>
              </div>
            )}

            {t.channel === "whatsapp" && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <Label className="text-xs">Reescrever com IA antes de enviar</Label>
                  <p className="text-[11px] text-muted-foreground">
                    A IA (Gemini Flash) reescreve a mensagem mantendo a essência, preservando nomes e links, sem inventar informações.
                  </p>
                </div>
                <Switch
                  checked={!!t.ai_rewrite_enabled}
                  onCheckedChange={(v) => updateTemplate(idx, { ai_rewrite_enabled: v })}
                />
              </div>
            )}


            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Mídia (opcional)</Label>
                {t.media_url && (
                  <Button variant="ghost" size="sm" onClick={() => removeMedia(idx)}>
                    <X className="h-3 w-3 mr-1" /> Remover
                  </Button>
                )}
              </div>
              {t.media_url ? (
                <div className="rounded-md border border-border p-2 bg-muted/30">
                  {t.media_type === "image" ? (
                    <img src={t.media_url} alt="Mídia" className="max-h-40 rounded" />
                  ) : (
                    <video src={t.media_url} controls className="max-h-40 rounded" />
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    ref={(el) => { fileInputs.current[idx * 2] = el; }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleMediaUpload(idx, f, "image");
                      e.target.value = "";
                    }}
                  />
                  <input
                    type="file"
                    accept="video/mp4"
                    className="hidden"
                    ref={(el) => { fileInputs.current[idx * 2 + 1] = el; }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleMediaUpload(idx, f, "video");
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploadingIdx === idx}
                    onClick={() => fileInputs.current[idx * 2]?.click()}
                  >
                    {uploadingIdx === idx ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3 w-3 mr-1" />
                    )}
                    Imagem
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploadingIdx === idx}
                    onClick={() => fileInputs.current[idx * 2 + 1]?.click()}
                  >
                    {uploadingIdx === idx ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <VideoIcon className="h-3 w-3 mr-1" />
                    )}
                    Vídeo
                  </Button>
                  <span className="text-xs text-muted-foreground self-center">
                    Imagem até 5 MB · Vídeo MP4 até 16 MB
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Mensagem {t.media_url && <span className="text-muted-foreground">(será enviada como legenda)</span>}</Label>
              <Textarea
                rows={4}
                value={t.content}
                onChange={(e) => updateTemplate(idx, { content: e.target.value })}
                placeholder="Olá {primeiro_nome}, lembrete da sua reunião em {data_atividade} às {hora_atividade}."
              />
            </div>
                      </CardContent>
                    </Card>
                  )}
                </SortableTemplateItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      </fieldset>
    </div>
  );
}
