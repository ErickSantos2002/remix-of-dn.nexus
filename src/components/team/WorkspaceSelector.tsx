import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Layers } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
}

interface WorkspaceSelectorProps {
  companyId: string;
  selectedWorkspaces: string[];
  onSelectionChange: (workspaceIds: string[]) => void;
}

const WorkspaceSelector = ({
  companyId,
  selectedWorkspaces,
  onSelectionChange,
}: WorkspaceSelectorProps) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (!companyId) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("workspaces")
          .select("id, name, icon")
          .eq("company_id", companyId)
          .order("name");

        if (error) throw error;
        setWorkspaces(data || []);
      } catch (error) {
        console.error("Error fetching workspaces:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkspaces();
  }, [companyId]);

  const handleToggle = (workspaceId: string) => {
    if (selectedWorkspaces.includes(workspaceId)) {
      onSelectionChange(selectedWorkspaces.filter((id) => id !== workspaceId));
    } else {
      onSelectionChange([...selectedWorkspaces, workspaceId]);
    }
  };

  const handleSelectAll = () => {
    if (selectedWorkspaces.length === workspaces.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(workspaces.map((w) => w.id));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        Nenhum workspace disponivel nesta empresa.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Workspaces
        </Label>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs text-primary hover:underline"
        >
          {selectedWorkspaces.length === workspaces.length
            ? "Desmarcar todos"
            : "Selecionar todos"}
        </button>
      </div>
      
      <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border border-border p-3 bg-muted/30">
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className="flex items-center space-x-3 py-1"
          >
            <Checkbox
              id={`workspace-${workspace.id}`}
              checked={selectedWorkspaces.includes(workspace.id)}
              onCheckedChange={() => handleToggle(workspace.id)}
            />
            <Label
              htmlFor={`workspace-${workspace.id}`}
              className="text-sm font-normal cursor-pointer flex-1"
            >
              <span className="mr-2">{workspace.icon || "📁"}</span>
              {workspace.name}
            </Label>
          </div>
        ))}
      </div>
      
      <p className="text-xs text-muted-foreground">
        {selectedWorkspaces.length} de {workspaces.length} selecionado(s)
      </p>
    </div>
  );
};

export default WorkspaceSelector;
