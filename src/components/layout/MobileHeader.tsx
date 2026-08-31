import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const { currentWorkspace } = useWorkspace();

  return (
    <header className="fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="h-9 w-9"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Abrir menu</span>
      </Button>
      
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-xs">
          {currentWorkspace?.name?.charAt(0).toUpperCase() || "?"}
        </div>
        <span className="font-medium text-sm text-foreground truncate max-w-[150px]">
          {currentWorkspace?.name || "Workspace"}
        </span>
      </div>

      <div className="w-9" /> {/* Spacer for balance */}
    </header>
  );
}
