import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Calendar, Settings, Loader2, Wrench, AlertCircle } from "lucide-react";
import { Json } from "@/integrations/supabase/types";

interface ToolCatalogItem {
  id: string;
  name: string;
  label: string;
  description: string | null;
  icon_name: string;
  category: string;
  default_config: Json;
  requires_setup: string[];
  is_active: boolean;
}

interface AgentTool {
  id?: string;
  tool_id: string;
  tool_name: string;
  is_enabled: boolean;
  config: Record<string, any>;
  catalog: ToolCatalogItem;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Calendar,
  Wrench,
  Settings,
};

export default function AgentToolsSettings() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentWorkspace?.id && agentId) {
      fetchAgentAndTools();
    }
  }, [currentWorkspace?.id, agentId]);

  const fetchAgentAndTools = async () => {
    if (!currentWorkspace?.id || !agentId) return;
    
    try {
      // Fetch agent info - try agent_instances first, then fallback to agents
      let agentData = null;
      
      const { data: instanceData } = await supabase
        .from("agent_instances")
        .select("id, name")
        .eq("id", agentId)
        .eq("workspace_id", currentWorkspace.id)
        .single();

      if (instanceData) {
        agentData = instanceData;
      } else {
        // Fallback to legacy agents table
        const { data: legacyData } = await supabase
          .from("agents")
          .select("id, name")
          .eq("id", agentId)
          .eq("workspace_id", currentWorkspace.id)
          .single();
        agentData = legacyData;
      }

      if (!agentData) {
        console.error("Agent not found in either table");
        setLoading(false);
        return;
      }
      setAgent(agentData);

      // Fetch tool catalog
      const { data: catalogData, error: catalogError } = await supabase
        .from("tool_catalog")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (catalogError) throw catalogError;

      // Fetch existing tool configurations
      const { data: agentToolsData, error: toolsError } = await supabase
        .from("agent_tools")
        .select("*")
        .eq("agent_id", agentId)
        .eq("workspace_id", currentWorkspace.id);

      if (toolsError) throw toolsError;

      // Merge catalog with agent configs
      const mergedTools: AgentTool[] = (catalogData || []).map((catalogItem: ToolCatalogItem) => {
        const existingTool = agentToolsData?.find(
          t => t.tool_id === catalogItem.id || t.tool_name === catalogItem.name
        );
        
        const defaultConfig = typeof catalogItem.default_config === 'object' && catalogItem.default_config !== null
          ? catalogItem.default_config as Record<string, any>
          : {};

        return {
          id: existingTool?.id,
          tool_id: catalogItem.id,
          tool_name: catalogItem.name,
          is_enabled: existingTool?.is_enabled ?? false,
          config: existingTool?.config as Record<string, any> ?? defaultConfig,
          catalog: catalogItem
        };
      });

      setTools(mergedTools);
    } catch (error) {
      console.error("Error fetching agent tools:", error);
      toast.error("Erro ao carregar configurações das tools");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTool = async (toolName: string, enabled: boolean) => {
    if (!currentWorkspace?.id || !agentId) return;
    
    setSaving(true);
    try {
      const toolIndex = tools.findIndex(t => t.tool_name === toolName);
      if (toolIndex === -1) return;

      const tool = tools[toolIndex];

      if (tool.id) {
        const { error } = await supabase
          .from("agent_tools")
          .update({ is_enabled: enabled })
          .eq("id", tool.id);
        if (error) {
          console.error("[AgentToolsSettings] Update failed:", error.message, error.code);
          toast.error("Erro ao atualizar ferramenta: " + error.message);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("agent_tools")
          .insert({
            workspace_id: currentWorkspace.id,
            agent_id: agentId,
            tool_id: tool.tool_id,
            tool_name: toolName,
            is_enabled: enabled,
            config: tool.config
          })
          .select("id")
          .single();

        if (error) {
          console.error("[AgentToolsSettings] Insert failed:", error.message, error.code);
          toast.error("Erro ao criar ferramenta: " + error.message);
          return;
        }
        if (data) {
          tool.id = data.id;
        }
      }

      setTools(prev => prev.map((t, i) => 
        i === toolIndex ? { ...t, is_enabled: enabled } : t
      ));

      toast.success(enabled ? "Tool ativada" : "Tool desativada");
    } catch (error) {
      console.error("Error toggling tool:", error);
      toast.error("Erro ao atualizar tool");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateConfig = async (toolName: string, configKey: string, value: boolean) => {
    if (!currentWorkspace?.id || !agentId) return;
    
    setSaving(true);
    try {
      const toolIndex = tools.findIndex(t => t.tool_name === toolName);
      if (toolIndex === -1) return;

      const tool = tools[toolIndex];
      const newConfig = { ...tool.config, [configKey]: value };

      if (tool.id) {
        const { error } = await supabase
          .from("agent_tools")
          .update({ config: newConfig })
          .eq("id", tool.id);
        if (error) {
          console.error("[AgentToolsSettings] Config update failed:", error.message);
          toast.error("Erro ao salvar configuracao: " + error.message);
          return;
        }
      }

      setTools(prev => prev.map((t, i) => 
        i === toolIndex ? { ...t, config: newConfig } : t
      ));

      toast.success("Configuração salva");
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Agente não encontrado.</p>
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tools do Agente</h1>
          <p className="text-muted-foreground">{agent.name}</p>
        </div>
      </div>

      <div className="space-y-4">
        {tools.map(tool => {
          const IconComponent = ICON_MAP[tool.catalog.icon_name] || Wrench;
          const hasSetupRequirements = tool.catalog.requires_setup && tool.catalog.requires_setup.length > 0;
          
          return (
            <Card key={tool.tool_name} className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <IconComponent className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{tool.catalog.label}</CardTitle>
                      <CardDescription>{tool.catalog.description}</CardDescription>
                    </div>
                  </div>
                  <Switch
                    checked={tool.is_enabled}
                    onCheckedChange={(checked) => handleToggleTool(tool.tool_name, checked)}
                    disabled={saving}
                  />
                </div>

                {hasSetupRequirements && (
                  <div className="flex items-start gap-2 p-3 mt-3 rounded-lg bg-warning/10 border border-warning/20">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-medium text-warning">Requer configuração adicional</p>
                      <p className="text-muted-foreground mt-1">
                        Esta ferramenta requer: {tool.catalog.requires_setup.join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </CardHeader>
              
              {tool.is_enabled && (
                <CardContent className="space-y-4 pt-0">
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Configurações</span>
                    </div>
                    
                    {tool.tool_name === "schedule_appointment" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${tool.tool_name}-google-meet`}
                            checked={tool.config.create_google_meet ?? true}
                            onCheckedChange={(checked) => 
                              handleUpdateConfig(tool.tool_name, "create_google_meet", checked as boolean)
                            }
                            disabled={saving}
                          />
                          <Label htmlFor={`${tool.tool_name}-google-meet`} className="text-sm">
                            Criar Google Meet automaticamente
                          </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${tool.tool_name}-google-calendar`}
                            checked={tool.config.sync_google_calendar ?? true}
                            onCheckedChange={(checked) => 
                              handleUpdateConfig(tool.tool_name, "sync_google_calendar", checked as boolean)
                            }
                            disabled={saving}
                          />
                          <Label htmlFor={`${tool.tool_name}-google-calendar`} className="text-sm">
                            Sincronizar com Google Calendar
                          </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${tool.tool_name}-confirmation`}
                            checked={tool.config.send_confirmation ?? true}
                            onCheckedChange={(checked) => 
                              handleUpdateConfig(tool.tool_name, "send_confirmation", checked as boolean)
                            }
                            disabled={saving}
                          />
                          <Label htmlFor={`${tool.tool_name}-confirmation`} className="text-sm">
                            Enviar confirmação ao cliente
                          </Label>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`${tool.tool_name}-auto-suggest`}
                            checked={tool.config.auto_suggest_times ?? true}
                            onCheckedChange={(checked) => 
                              handleUpdateConfig(tool.tool_name, "auto_suggest_times", checked as boolean)
                            }
                            disabled={saving}
                          />
                          <Label htmlFor={`${tool.tool_name}-auto-suggest`} className="text-sm">
                            Sugerir horários automaticamente
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {tools.length === 0 && (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              Nenhuma tool disponível no catálogo.
            </p>
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => navigate("/settings/tools")}
            >
              Ver Catálogo de Tools
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
