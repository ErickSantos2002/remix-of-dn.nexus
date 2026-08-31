import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Building2, Tag, Star } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
}

interface LinkedWorkspace {
  workspace_id: string;
  keywords: string[];
  is_default: boolean;
  priority: number;
}

interface ConnectionWorkspaceSelectorProps {
  companyId: string;
  connectionId: string | null;
  connectionType: "zapi" | "whatsapp_official" | "instagram";
  linkedWorkspaces: LinkedWorkspace[];
  onLinkedWorkspacesChange: (workspaces: LinkedWorkspace[]) => void;
}

export function ConnectionWorkspaceSelector({
  companyId,
  connectionId,
  connectionType,
  linkedWorkspaces,
  onLinkedWorkspacesChange,
}: ConnectionWorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (!companyId) return;
      
      setLoading(true);
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name, icon")
        .eq("company_id", companyId)
        .order("name");

      if (error) {
        console.error("Error fetching workspaces:", error);
      } else {
        setWorkspaces(data || []);
      }
      setLoading(false);
    };

    fetchWorkspaces();
  }, [companyId]);

  // Load existing linked workspaces when editing
  useEffect(() => {
    const loadLinkedWorkspaces = async () => {
      if (!connectionId || linkedWorkspaces.length > 0) return;

      const { data, error } = await supabase
        .from("connection_workspaces")
        .select("workspace_id, keywords, is_default, priority")
        .eq("connection_id", connectionId)
        .eq("connection_type", connectionType);

      if (error) {
        console.error("Error loading linked workspaces:", error);
      } else if (data && data.length > 0) {
        onLinkedWorkspacesChange(data.map(d => ({
          workspace_id: d.workspace_id,
          keywords: d.keywords || [],
          is_default: d.is_default || false,
          priority: d.priority || 0,
        })));
      }
    };

    loadLinkedWorkspaces();
  }, [connectionId, connectionType]);

  const isWorkspaceLinked = (workspaceId: string) => {
    return linkedWorkspaces.some(lw => lw.workspace_id === workspaceId);
  };

  const getLinkedWorkspace = (workspaceId: string) => {
    return linkedWorkspaces.find(lw => lw.workspace_id === workspaceId);
  };

  const getDefaultWorkspaceId = () => {
    return linkedWorkspaces.find(lw => lw.is_default)?.workspace_id || null;
  };

  const handleToggleWorkspace = (workspaceId: string, checked: boolean) => {
    if (checked) {
      // Add workspace
      const isFirst = linkedWorkspaces.length === 0;
      onLinkedWorkspacesChange([
        ...linkedWorkspaces,
        {
          workspace_id: workspaceId,
          keywords: [],
          is_default: isFirst, // First one is default
          priority: linkedWorkspaces.length,
        },
      ]);
    } else {
      // Remove workspace
      const wasDefault = getLinkedWorkspace(workspaceId)?.is_default;
      let newLinked = linkedWorkspaces.filter(lw => lw.workspace_id !== workspaceId);
      
      // If removed workspace was default, set first remaining as default
      if (wasDefault && newLinked.length > 0) {
        newLinked = newLinked.map((lw, idx) => ({
          ...lw,
          is_default: idx === 0,
        }));
      }
      
      onLinkedWorkspacesChange(newLinked);
    }
  };

  const handleSetDefault = (workspaceId: string) => {
    onLinkedWorkspacesChange(
      linkedWorkspaces.map(lw => ({
        ...lw,
        is_default: lw.workspace_id === workspaceId,
      }))
    );
  };

  const handleKeywordsChange = (workspaceId: string, keywordsStr: string) => {
    const keywords = keywordsStr
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    onLinkedWorkspacesChange(
      linkedWorkspaces.map(lw =>
        lw.workspace_id === workspaceId
          ? { ...lw, keywords }
          : lw
      )
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        Nenhum workspace encontrado nesta empresa.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Workspaces Vinculados</Label>
        <Badge variant="secondary" className="text-xs">
          {linkedWorkspaces.length} selecionado(s)
        </Badge>
      </div>

      <ScrollArea className="h-[280px] rounded-md border border-border p-3">
        <div className="space-y-4">
          {workspaces.map((workspace) => {
            const isLinked = isWorkspaceLinked(workspace.id);
            const linked = getLinkedWorkspace(workspace.id);
            const isDefault = linked?.is_default || false;

            return (
              <div
                key={workspace.id}
                className={`p-3 rounded-lg border transition-colors ${
                  isLinked
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`ws-${workspace.id}`}
                    checked={isLinked}
                    onCheckedChange={(checked) =>
                      handleToggleWorkspace(workspace.id, checked === true)
                    }
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`ws-${workspace.id}`}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {workspace.name}
                        </span>
                      </label>
                      {isLinked && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(workspace.id)}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
                            isDefault
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <Star
                            className={`h-3 w-3 ${isDefault ? "fill-primary" : ""}`}
                          />
                          {isDefault ? "Padrao" : "Definir padrao"}
                        </button>
                      )}
                    </div>

                    {isLinked && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Tag className="h-3 w-3 text-muted-foreground" />
                          <Label className="text-xs text-muted-foreground">
                            Keywords (separadas por virgula)
                          </Label>
                        </div>
                        <Input
                          placeholder="comprar, preco, orcamento..."
                          value={linked?.keywords.join(", ") || ""}
                          onChange={(e) =>
                            handleKeywordsChange(workspace.id, e.target.value)
                          }
                          className="text-sm h-8"
                        />
                        {linked?.keywords && linked.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {linked.keywords.map((kw, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className="text-xs"
                              >
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        Mensagens serao roteadas para o workspace correspondente as keywords. 
        Se nenhuma keyword for encontrada, ira para o workspace padrao.
      </p>
    </div>
  );
}
