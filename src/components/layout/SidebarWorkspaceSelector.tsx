import { ChevronDown, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useState } from "react";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";

export function SidebarWorkspaceSelector() {
  const { currentWorkspace, workspaces, setWorkspaceId } = useWorkspace();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { isAdmin } = useUserRole();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-9 bg-sidebar-accent/50 border-sidebar-border hover:bg-sidebar-accent"
          >
          <div className="flex items-center gap-2 min-w-0">
              <span className="w-5 h-5 rounded bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                {currentWorkspace?.name?.charAt(0).toUpperCase() || "W"}
              </span>
              <span className="text-sm font-medium truncate">
                {currentWorkspace?.name || "Selecionar Workspace"}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="start" 
          className="w-[220px] bg-popover border-border"
        >
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => setWorkspaceId(workspace.id)}
              className={cn(
                "cursor-pointer",
                currentWorkspace?.id === workspace.id && "bg-accent"
              )}
            >
              <span className="w-5 h-5 rounded bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0 mr-2">
                {workspace.name?.charAt(0).toUpperCase() || "W"}
              </span>
              <span className="flex-1 truncate">{workspace.name}</span>
              {currentWorkspace?.id === workspace.id && (
                <Check className="h-4 w-4 text-primary shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
          
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              
              <DropdownMenuItem
                onClick={() => setShowCreateDialog(true)}
                className="cursor-pointer text-primary"
              >
                <Plus className="h-4 w-4 mr-2" />
                Novo Workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog} 
      />
    </>
  );
}
