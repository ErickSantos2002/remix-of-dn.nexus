import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { 
  MessageSquare, 
  BarChart3, 
  Bot,
  BookOpen,
  Plug, 
  Sun, 
  Moon, 
  LogOut,
  Users,
  Headphones,
  Tags,
  Route,
  Layers,
  Building2,
  FileText,
  PanelLeft,
  Kanban,
  Users2,
  Zap,
  Wrench,
  MessageCircle,
  Calendar as CalendarIcon,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

// Main workspace features
const mainNavItems = [
  { icon: MessageSquare, label: "Chat ao Vivo", href: "/" },
  { icon: BarChart3, label: "Relatórios", href: "/analytics" },
];

// CRM items
const crmNavItems = [
  { icon: Kanban, label: "Pipeline", href: "/crm/pipeline" },
  { icon: Users2, label: "Contatos", href: "/crm/contacts" },
  { icon: Gauge, label: "Desempenho", href: "/crm/desempenho" },
];

// CRM Settings items (admin only)
const crmSettingsItems = [
  { icon: Layers, label: "Etapas do Pipeline", href: "/crm/settings/pipeline", adminOnly: true },
  { icon: Zap, label: "Auto-move", href: "/crm/settings/automove", adminOnly: true },
];

// Workspace settings
const workspaceSettingsItems = [
  { icon: Bot, label: "Agentes", href: "/agents", adminOnly: true },
  { icon: Wrench, label: "Tools", href: "/settings/tools", adminOnly: true },
  { icon: BookOpen, label: "Conhecimento", href: "/knowledge", adminOnly: true },
  { icon: MessageCircle, label: "Widgets", href: "/settings/widgets", adminOnly: true },
  { icon: Tags, label: "Categorias", href: "/settings/categories", adminOnly: true },
  { icon: Route, label: "Roteamento", href: "/settings/routing", adminOnly: true },
  { icon: Headphones, label: "Disponibilidade", href: "/settings/availability", adminOnly: true },
  { icon: Plug, label: "Conexões", href: "/connections" },
];

// Company management (admin only)
const companySettingsItems = [
  { icon: Layers, label: "Workspaces", href: "/settings/workspaces", adminOnly: true },
  { icon: Users, label: "Equipe", href: "/settings/team", adminOnly: true },
  { icon: Building2, label: "Configurações", href: "/settings/company", adminOnly: true },
];

// Super Admin only
const adminNavItems = [
  { icon: FileText, label: "Templates", href: "/admin/templates" },
  { icon: Building2, label: "Empresas", href: "/admin/companies" },
];

interface CollapsedSidebarProps {
  onExpand?: () => void;
}

export function CollapsedSidebar({ onExpand }: CollapsedSidebarProps) {
  const { theme, setTheme } = useTheme();
  const { isAdmin: isGlobalAdmin, isSuperAdmin } = useUserRole();
  const { isAdmin: isCompanyAdmin, isOwner } = useCompany();
  const isAdmin = isGlobalAdmin || isCompanyAdmin || isOwner;
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao sair",
        description: error.message,
      });
      return;
    }
    navigate("/login");
  };

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  const NavItem = ({ item }: { item: { icon: React.ElementType; label: string; href: string } }) => (
    <div className="w-full flex justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={item.href}
            className={cn(
              "relative inline-flex items-center justify-center w-10 h-10 rounded-lg transition-all",
              isActive(item.href)
                ? "bg-sidebar-primary/10 text-sidebar-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="bg-popover border-border">
          {item.label}
        </TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[52px] flex-col items-center justify-between py-3 border-r border-sidebar-border bg-sidebar">
        {/* Top section with logo and expand toggle */}
        <div className="flex flex-col items-center w-full">
          {/* Logo */}
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
            <img src={theme === "premium" ? "/dn-nexus-light.png" : "/dn-nexus-dark.png"} alt="dn.nexus" className="h-6" />
          </div>

          {/* Expand Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground mb-3"
                onClick={onExpand}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover border-border">
              Expandir Menu
            </TooltipContent>
          </Tooltip>

        {/* Main Navigation */}
        <nav className="flex flex-col items-center gap-1 w-full">
          {/* Main items */}
          {mainNavItems.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}

          <Separator className="my-2 w-6 bg-sidebar-border" />

          {/* CRM items */}
          {crmNavItems.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}

          {/* CRM Settings items - admin only */}
          {isAdmin && crmSettingsItems.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}

          <Separator className="my-2 w-6 bg-sidebar-border" />

          {/* Workspace Settings */}
          {workspaceSettingsItems
            .filter(item => !item.adminOnly || isAdmin)
            .map((item) => (
              <NavItem key={item.href} item={item} />
            ))}

          {/* Company items - admin only */}
          {isAdmin && (
            <>
              <Separator className="my-2 w-6 bg-sidebar-border" />
              {companySettingsItems.map((item) => (
                <NavItem key={item.href} item={item} />
              ))}
            </>
          )}

            {/* Admin items - only for super_admin */}
            {isSuperAdmin && (
              <>
                <Separator className="my-2 w-6 bg-sidebar-border" />
                {adminNavItems.map((item) => (
                  <NavItem key={item.href} item={item} />
                ))}
              </>
            )}
          </nav>
        </div>

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-1 pt-3 border-t border-sidebar-border w-full">
          {/* Theme Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setTheme(theme === "dark" ? "premium" : "dark")}
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover border-border">
              {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
            </TooltipContent>
          </Tooltip>

          {/* Logout */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover border-border">
              Sair
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
