import { ChevronDown, ChevronRight, Loader2, Building2, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useLocation } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ActivitiesBell } from "./ActivitiesBell";

interface GlobalHeaderProps {
  onMenuClick: () => void;
}

export function GlobalHeader({ onMenuClick }: GlobalHeaderProps) {
  const location = useLocation();
  const isInboxPage = location.pathname === "/";
  
  const { 
    currentCompany, 
    companies, 
    companyId, 
    setCompanyId, 
    isLoading: isLoadingCompany 
  } = useCompany();
  
  const { 
    currentWorkspace, 
    workspaces, 
    workspaceId, 
    setWorkspaceId, 
    isLoading: isLoadingWorkspace 
  } = useWorkspace();

  const getCompanyInitial = (company: { name: string }) => {
    return company.name.charAt(0).toUpperCase();
  };

  const getWorkspaceInitial = (workspace: { name: string }) => {
    return workspace.name.charAt(0).toUpperCase();
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-12 items-center border-b border-border bg-card/30 backdrop-blur px-3">
      {/* Left: Menu button - only on Inbox page or mobile */}
      <div className={cn("w-9", isInboxPage ? "block" : "hidden lg:hidden block")}>
        {isInboxPage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="h-9 w-9"
          >
            <PanelLeft className="h-5 w-5" />
            <span className="sr-only">Abrir menu</span>
          </Button>
        )}
      </div>
      
      {/* Center: Company > Workspace Selectors */}
      <div className="flex-1 flex items-center justify-center gap-1">
        {/* Company Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="h-9 px-2 gap-1.5 hover:bg-muted"
              disabled={isLoadingCompany}
            >
              {isLoadingCompany ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : currentCompany ? (
                <>
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/20 text-primary font-semibold text-xs">
                    {getCompanyInitial(currentCompany)}
                  </div>
                  <span className="font-medium text-sm text-foreground truncate max-w-[100px] hidden sm:inline">
                    {currentCompany.name}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </>
              ) : (
                <>
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Empresa</span>
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="center" 
            className="w-[200px] rounded-lg bg-popover border-border"
          >
            {companies.map((company) => (
              <DropdownMenuItem 
                key={company.id}
                onClick={() => setCompanyId(company.id)}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-1.5 text-sm",
                  company.id === companyId && "bg-primary/10"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <div className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md font-semibold text-xs",
                    company.id === companyId 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-muted text-muted-foreground"
                  )}>
                    {getCompanyInitial(company)}
                  </div>
                  <span className="text-sm truncate flex-1">{company.name}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Separator */}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />

        {/* Workspace Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="h-9 px-2 gap-1.5 hover:bg-muted"
              disabled={isLoadingWorkspace}
            >
              {isLoadingWorkspace ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : currentWorkspace ? (
                <>
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-accent-foreground font-semibold text-xs">
                    {getWorkspaceInitial(currentWorkspace)}
                  </div>
                  <span className="font-medium text-sm text-foreground truncate max-w-[100px] hidden sm:inline">
                    {currentWorkspace.name}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Workspace</span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="center" 
            className="w-[200px] rounded-lg bg-popover border-border"
          >
            {workspaces.length === 0 ? (
              <DropdownMenuItem disabled className="text-muted-foreground text-sm">
                Nenhum workspace
              </DropdownMenuItem>
            ) : (
              workspaces.map((workspace) => (
                <DropdownMenuItem 
                  key={workspace.id}
                  onClick={() => setWorkspaceId(workspace.id)}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1.5 text-sm",
                    workspace.id === workspaceId && "bg-accent/20"
                  )}
                >
                  <div className="flex items-center gap-2 w-full">
                    <div className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-md font-semibold text-xs",
                      workspace.id === workspaceId 
                        ? "bg-accent text-accent-foreground" 
                        : "bg-muted text-muted-foreground"
                    )}>
                      {getWorkspaceInitial(workspace)}
                    </div>
                    <span className="text-sm truncate flex-1">{workspace.name}</span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: Activities + Notifications */}
      <div className="flex items-center justify-end gap-1">
        <ActivitiesBell />
        <NotificationBell />
      </div>
    </header>
  );
}
