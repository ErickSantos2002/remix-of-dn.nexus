import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Copy, ExternalLink, Trash2, Settings, Globe, Code, MessageCircle, Loader2 } from "lucide-react";
import { WidgetChat } from "@/components/widget/WidgetChat";
import { ImageUpload } from "@/components/widget/ImageUpload";

interface WidgetConfig {
  id: string;
  workspace_id: string;
  name: string;
  type: "standalone" | "embed" | "bubble";
  agent_id: string | null;
  is_active: boolean;
  slug: string;
  settings: {
    title?: string;
    subtitle?: string;
    primary_color?: string;
    logo_url?: string;
    welcome_message?: string;
    welcome_message_enabled?: boolean;
    position?: string;
    width?: number;
    height?: number;
    show_powered_by?: boolean;
    show_header?: boolean;
    header_banner_url?: string;
    agent_avatar_url?: string;
  };
  allowed_origins: string[];
  created_at: string;
}

interface AgentInstance {
  id: string;
  name: string;
}

export default function WidgetSettings() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WidgetConfig | null>(null);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    type: "standalone" as "standalone" | "embed" | "bubble",
    agent_id: "",
    slug: "",
    is_active: true,
    allowed_origins: "",
    settings: {
      title: "Fale Conosco",
      subtitle: "Como posso ajudar?",
      primary_color: "#FF8000",
      logo_url: "",
      welcome_message: "",
      welcome_message_enabled: false,
      position: "bottom-right",
      width: 400,
      height: 600,
      show_powered_by: true,
      show_header: true,
      header_banner_url: "",
      agent_avatar_url: "",
    },
  });

  // Fetch widgets
  const { data: widgets, isLoading } = useQuery({
    queryKey: ["widget_configs", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("widget_configs")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as WidgetConfig[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch agents from BOTH tables (legacy + new)
  const { data: agents } = useQuery({
    queryKey: ["unified_agents", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      
      // Buscar de ambas as tabelas em paralelo
      const [legacyResult, instancesResult] = await Promise.all([
        supabase
          .from("agents")
          .select("id, name")
          .eq("workspace_id", currentWorkspace.id)
          .eq("is_active", true)
          .eq("is_archived", false),
        supabase
          .from("agent_instances")
          .select("id, name")
          .eq("workspace_id", currentWorkspace.id)
          .eq("is_active", true)
          .eq("is_archived", false),
      ]);

      // Combinar resultados
      const legacyAgents = (legacyResult.data || []).map(a => ({
        id: a.id,
        name: a.name,
      }));
      
      const instanceAgents = (instancesResult.data || []).map(a => ({
        id: a.id,
        name: a.name,
      }));

      return [...legacyAgents, ...instanceAgents] as AgentInstance[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        workspace_id: currentWorkspace!.id,
        name: data.name,
        type: data.type,
        agent_id: data.agent_id || null,
        slug: data.slug,
        is_active: data.is_active,
        allowed_origins: data.allowed_origins
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
        settings: data.settings,
      };

      if (editingWidget) {
        const { error } = await supabase
          .from("widget_configs")
          .update(payload)
          .eq("id", editingWidget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("widget_configs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget_configs"] });
      toast.success(editingWidget ? "Widget atualizado" : "Widget criado");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("widget_configs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["widget_configs"] });
      toast.success("Widget excluido");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      type: "standalone",
      agent_id: "",
      slug: "",
      is_active: true,
      allowed_origins: "",
    settings: {
      title: "Fale Conosco",
      subtitle: "Como posso ajudar?",
      primary_color: "#FF8000",
      logo_url: "",
      welcome_message: "",
      welcome_message_enabled: false,
      position: "bottom-right",
      width: 400,
      height: 600,
      show_powered_by: true,
      show_header: true,
      header_banner_url: "",
      agent_avatar_url: "",
    },
    });
    setEditingWidget(null);
  };

  const handleEdit = (widget: WidgetConfig) => {
    setEditingWidget(widget);
    setFormData({
      name: widget.name,
      type: widget.type,
      agent_id: widget.agent_id || "",
      slug: widget.slug,
      is_active: widget.is_active,
      allowed_origins: widget.allowed_origins?.join(", ") || "",
      settings: {
        title: widget.settings?.title || "Fale Conosco",
        subtitle: widget.settings?.subtitle || "",
        primary_color: widget.settings?.primary_color || "#FF8000",
        logo_url: widget.settings?.logo_url || "",
        welcome_message: widget.settings?.welcome_message || "",
        welcome_message_enabled: widget.settings?.welcome_message_enabled ?? !!(widget.settings?.welcome_message),
        position: widget.settings?.position || "bottom-right",
        width: widget.settings?.width || 400,
        height: widget.settings?.height || 600,
        show_powered_by: widget.settings?.show_powered_by ?? true,
        show_header: widget.settings?.show_header ?? true,
        header_banner_url: widget.settings?.header_banner_url || "",
        agent_avatar_url: widget.settings?.agent_avatar_url || "",
      },
    });
    setIsDialogOpen(true);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const getIntegrationCode = (widget: WidgetConfig) => {
    // SEMPRE usar URL publicada para integracao externa
    const publishedUrl = "https://nexus-ai-schema.lovable.app";
    
    // Forcar tipagem dos settings para acesso correto
    const settings = widget.settings as {
      width?: number;
      height?: number;
      position?: string;
      primary_color?: string;
      show_powered_by?: boolean;
    };
    
    switch (widget.type) {
      case "standalone":
        return {
          label: "URL do Chat",
          code: `${publishedUrl}/chat/${widget.slug}`,
          type: "url",
        };
      case "embed":
        return {
          label: "Codigo Embed",
          code: `<iframe
  src="${publishedUrl}/embed/${widget.slug}"
  width="${settings?.width || 400}"
  height="${settings?.height || 600}"
  frameborder="0"
  style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
></iframe>`,
          type: "html",
        };
      case "bubble":
        return {
          label: "Script Widget",
          code: `<script
  src="${publishedUrl}/widget.js"
  data-widget-id="${widget.slug}"
  data-position="${settings?.position || "bottom-right"}"
  data-primary-color="${settings?.primary_color || "#FF8000"}"
></script>`,
          type: "html",
        };
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "standalone":
        return <Globe className="h-4 w-4" />;
      case "embed":
        return <Code className="h-4 w-4" />;
      case "bubble":
        return <MessageCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "standalone":
        return "URL Standalone";
      case "embed":
        return "Embed Iframe";
      case "bubble":
        return "Widget Flutuante";
      default:
        return type;
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chat Widgets</h1>
          <p className="text-muted-foreground">
            Configure widgets de chat para integrar em sites externos
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Novo Widget
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingWidget ? "Editar Widget" : "Novo Widget"}
              </DialogTitle>
              <DialogDescription>
                Configure as opcoes do widget de chat
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        name: e.target.value,
                        slug: prev.slug || generateSlug(e.target.value),
                      }));
                    }}
                    placeholder="Meu Chat"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug (URL)</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, slug: e.target.value }))
                    }
                    placeholder="meu-chat"
                  />
                </div>
              </div>

              {/* Type */}
              <div className="space-y-2">
                <Label>Tipo de Widget</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: "standalone" | "embed" | "bubble") =>
                    setFormData((prev) => ({ ...prev, type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standalone">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        URL Standalone - Pagina completa de chat
                      </div>
                    </SelectItem>
                    <SelectItem value="embed">
                      <div className="flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        Embed - Para incorporar via iframe
                      </div>
                    </SelectItem>
                    <SelectItem value="bubble">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4" />
                        Bubble - Bolinha flutuante no site
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Agent */}
              <div className="space-y-2">
                <Label>Agente Padrao</Label>
                <Select
                  value={formData.agent_id}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, agent_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um agente" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents?.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Visual settings */}
              <div className="border rounded-lg p-4 space-y-4">
                <h3 className="font-medium">Aparencia</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Título</Label>
                    <Input
                      value={formData.settings.title}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, title: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Subtitulo</Label>
                    <Input
                      value={formData.settings.subtitle}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, subtitle: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cor Primaria</Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={formData.settings.primary_color}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, primary_color: e.target.value },
                          }))
                        }
                        className="w-12 h-10 p-1"
                      />
                      <Input
                        value={formData.settings.primary_color}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, primary_color: e.target.value },
                          }))
                        }
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Logo (URL ou Upload)</Label>
                    <ImageUpload
                      value={formData.settings.logo_url}
                      onChange={(url) =>
                        setFormData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, logo_url: url },
                        }))
                      }
                      folder="logos"
                      placeholder="Upload do logo"
                      aspectRatio="square"
                    />
                  </div>
                </div>

                {/* Header settings for standalone/embed */}
                {(formData.type === "standalone" || formData.type === "embed") && (
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.settings.show_header}
                        onCheckedChange={(checked) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, show_header: checked },
                          }))
                        }
                      />
                      <Label>Mostrar Header</Label>
                    </div>

                    {formData.settings.show_header && (
                      <>
                        <div className="space-y-2">
                          <Label>Banner (opcional)</Label>
                          <ImageUpload
                            value={formData.settings.header_banner_url}
                            onChange={(url) =>
                              setFormData((prev) => ({
                                ...prev,
                                settings: { ...prev.settings, header_banner_url: url },
                              }))
                            }
                            folder="banners"
                            placeholder="Upload do banner"
                            aspectRatio="banner"
                          />
                          <p className="text-xs text-muted-foreground">
                            Imagem exibida no topo do chat
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>Avatar do Agente (opcional)</Label>
                          <ImageUpload
                            value={formData.settings.agent_avatar_url}
                            onChange={(url) =>
                              setFormData((prev) => ({
                                ...prev,
                                settings: { ...prev.settings, agent_avatar_url: url },
                              }))
                            }
                            folder="avatars"
                            placeholder="Upload do avatar"
                            aspectRatio="square"
                          />
                          <p className="text-xs text-muted-foreground">
                            Foto do agente exibida nas mensagens
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.settings.welcome_message_enabled}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, welcome_message_enabled: checked },
                        }))
                      }
                    />
                    <Label>Enviar mensagem de boas-vindas</Label>
                  </div>
                  {formData.settings.welcome_message_enabled && (
                    <div className="space-y-2">
                      <Label>Mensagem de Boas-vindas</Label>
                      <Textarea
                        value={formData.settings.welcome_message}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, welcome_message: e.target.value },
                          }))
                        }
                        rows={2}
                        placeholder="Ex: Ola! Como posso ajudar voce hoje?"
                      />
                    </div>
                  )}
                </div>
                {formData.type === "bubble" && (
                  <div className="space-y-2">
                    <Label>Posicao</Label>
                    <Select
                      value={formData.settings.position}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, position: value },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bottom-right">Inferior Direito</SelectItem>
                        <SelectItem value="bottom-left">Inferior Esquerdo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {formData.type === "embed" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Largura (px)</Label>
                      <Input
                        type="number"
                        value={formData.settings.width}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, width: parseInt(e.target.value) },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Altura (px)</Label>
                      <Input
                        type="number"
                        value={formData.settings.height}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, height: parseInt(e.target.value) },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.settings.show_powered_by}
                    onCheckedChange={(checked) =>
                      setFormData((prev) => ({
                        ...prev,
                        settings: { ...prev.settings, show_powered_by: checked },
                      }))
                    }
                  />
                  <Label>Mostrar "Powered by Nexus AI"</Label>
                </div>
              </div>

              {/* Security */}
              <div className="space-y-2">
                <Label>Dominios Permitidos (separados por virgula)</Label>
                <Input
                  value={formData.allowed_origins}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, allowed_origins: e.target.value }))
                  }
                  placeholder="example.com, app.example.com (vazio = todos)"
                />
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para permitir qualquer dominio
                </p>
              </div>

              {/* Active */}
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, is_active: checked }))
                  }
                />
                <Label>Widget Ativo</Label>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>
              <Button
                onClick={() => {
                  if (formData.settings.welcome_message_enabled && !formData.settings.welcome_message?.trim()) {
                    toast.error("Preencha a mensagem de boas-vindas ou desative a opcao");
                    return;
                  }
                  saveMutation.mutate(formData);
                }}
                disabled={saveMutation.isPending || !formData.name || !formData.slug}
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingWidget ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Widgets list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : widgets?.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Nenhum widget configurado
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              Crie um widget para integrar o chat em sites externos
            </p>
            <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Criar Primeiro Widget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {widgets?.map((widget) => {
            const integration = getIntegrationCode(widget);
            return (
              <Card key={widget.id} className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: widget.settings?.primary_color || "#FF8000" }}
                      >
                        {getTypeIcon(widget.type)}
                      </div>
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {widget.name}
                          <Badge variant={widget.is_active ? "default" : "secondary"}>
                            {widget.is_active ? "Ativo" : "Inativo"}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          {getTypeLabel(widget.type)} · /{widget.slug}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewSlug(previewSlug === widget.slug ? null : widget.slug)}
                      >
                        Preview
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(widget)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(widget.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="code" className="w-full">
                    <TabsList className="mb-2">
                      <TabsTrigger value="code">Codigo de Integracao</TabsTrigger>
                      {previewSlug === widget.slug && (
                        <TabsTrigger value="preview">Preview</TabsTrigger>
                      )}
                    </TabsList>
                    <TabsContent value="code">
                      <div className="bg-muted rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">
                            {integration.label}
                          </span>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(integration.code, integration.label)}
                              className="h-7 text-xs"
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              Copiar
                            </Button>
                            {widget.type === "standalone" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open(integration.code, "_blank")}
                                className="h-7 text-xs"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Abrir
                              </Button>
                            )}
                          </div>
                        </div>
                        <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                          {integration.code}
                        </pre>
                      </div>
                    </TabsContent>
                    {previewSlug === widget.slug && (
                      <TabsContent value="preview">
                        <div className="h-[400px] border rounded-lg overflow-hidden">
                          <WidgetChat
                            slug={widget.slug}
                            showHeader={true}
                            showPoweredBy={widget.settings?.show_powered_by ?? true}
                          />
                        </div>
                      </TabsContent>
                    )}
                  </Tabs>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
