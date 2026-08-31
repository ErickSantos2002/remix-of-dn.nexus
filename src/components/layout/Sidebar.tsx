import { useState } from "react";
import { useTheme } from "next-themes";
import { useNavigate, Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  MessageSquare,
  BarChart3,
  Bot,
  BookOpen,
  Plug,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  LogOut,
  Settings,
  Users,
  Headphones,
  Tags,
  Route,
  Layers,
  Building2,
  Key,
  FileText,
  PanelLeftClose,
  Crown,
  Kanban,
  Users2,
  Zap,
  Calendar as CalendarIcon,
  Clock,
  Wrench,
  Package,
  
  MessageCircle,
  Video,
  ShieldCheck,
  Gauge,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUserRole } from "@/hooks/useUserRole";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { SidebarWorkspaceSelector } from "@/components/layout/SidebarWorkspaceSelector";

// Main workspace features (always visible)
const mainNavItems = [
  { icon: MessageSquare, label: "Chat ao Vivo", href: "/" },
  { icon: BarChart3, label: "Relatorios", href: "/analytics" },
  { icon: BookOpen, label: "Documentação", href: "/docs" },
];

// CRM items
const crmNavItems = [
  { icon: Kanban, label: "Pipeline", href: "/crm/pipeline" },
  { icon: Users2, label: "Contatos", href: "/crm/contacts" },
  { icon: CalendarIcon, label: "Agendamentos", href: "/crm/appointments" },
  { icon: Gauge, label: "Desempenho", href: "/crm/desempenho" },
];

// CRM Settings items (admin only)
const crmSettingsItems = [
  { icon: Layers, label: "Etapas do Pipeline", href: "/crm/settings/pipeline", adminOnly: true },
  { icon: Package, label: "Produtos", href: "/crm/settings/products", adminOnly: true },
  { icon: Tags, label: "Tags de Contatos", href: "/crm/settings/tags", adminOnly: true },
  
  { icon: Zap, label: "Auto-move", href: "/crm/settings/automove", adminOnly: true },
  { icon: Clock, label: "Calendário Atendentes", href: "/crm/settings/agent-calendars", adminOnly: true },
  { icon: Zap, label: "Réguas", href: "/crm/settings/cadences", adminOnly: true },
  { icon: GitBranch, label: "Fluxos", href: "/crm/settings/flows", adminOnly: true },
];

// Workspace settings
const workspaceSettingsItems = [
  { icon: Bot, label: "Agentes", href: "/agents", adminOnly: true },
  { icon: Tags, label: "Categorias de Agentes", href: "/agents/categories", adminOnly: true },
  { icon: Wrench, label: "Tools", href: "/settings/tools", adminOnly: true },
  { icon: BookOpen, label: "Conhecimento", href: "/knowledge", adminOnly: true },
  { icon: MessageCircle, label: "Widgets", href: "/settings/widgets", adminOnly: true },
  { icon: Video, label: "Assistente de reunião", href: "/settings/assistente-reuniao", adminOnly: true },
  { icon: Route, label: "Roteamento", href: "/settings/routing", adminOnly: true },
  { icon: Headphones, label: "Disponibilidade", href: "/settings/availability", adminOnly: true },
  { icon: Plug, label: "Conexões", href: "/connections" },
  { icon: FileText, label: "Modelos WhatsApp", href: "/settings/whatsapp-templates", adminOnly: true },
];

// Company management (admin only)
const companySettingsItems = [
  { icon: Layers, label: "Workspaces", href: "/settings/workspaces", adminOnly: true },
  { icon: Users, label: "Equipe", href: "/settings/team", adminOnly: true },
  { icon: Building2, label: "Configurações", href: "/settings/company", adminOnly: true },
  { icon: Clock, label: "Janela de envio", href: "/settings/company/sending-window", adminOnly: true },
  { icon: Key, label: "API", href: "/settings/api-keys", adminOnly: true },
  { icon: ShieldCheck, label: "Privacidade de Dados", href: "/settings/data-privacy", adminOnly: true },
];

// Super Admin only
const adminNavItems = [
  { icon: FileText, label: "Templates", href: "/admin/templates" },
  { icon: Building2, label: "Empresas", href: "/admin/companies" },
];

interface SidebarProps {
  onClose?: () => void;
  isPersistent?: boolean;
}

export function Sidebar({ onClose, isPersistent = false }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isAdmin: isGlobalAdmin, isSuperAdmin } = useUserRole();
  const { currentCompany, isAdmin: isCompanyAdmin, isOwner } = useCompany();
  const { currentWorkspace } = useWorkspace();
  const isAdmin = isGlobalAdmin || isCompanyAdmin || isOwner;

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

  const handleNavClick = () => {
    // Só fecha se for modo overlay (mobile ou Inbox)
    if (!isPersistent) {
      onClose?.();
    }
  };

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    // Exact match para evitar que /agents fique ativo quando em /agents/categories
    if (href === "/agents") return location.pathname === "/agents";
    return location.pathname.startsWith(href);
  };

  const NavItem = ({ item, onClick }: { item: { icon: LucideIcon; label: string; href: string }; onClick?: () => void }) => (
    <Link
      to={item.href}
      onClick={onClick || handleNavClick}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all",
        isActive(item.href)
          ? "bg-sidebar-primary/10 text-sidebar-primary font-medium before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-sidebar-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
    >
      <item.icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );

  const SectionHeader = ({ icon: Icon, label }: { icon: LucideIcon; label: string }) => (
    <div className="flex items-center gap-2 px-3 pt-4 pb-2">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );

  const CollapsibleSection = ({
    icon: Icon,
    label,
    items,
    variant = "section",
  }: {
    icon: LucideIcon;
    label: string;
    items: { icon: LucideIcon; label: string; href: string }[];
    variant?: "section" | "subsection";
  }) => {
    const hasActive = items.some((it) => isActive(it.href));
    const isSub = variant === "subsection";
    return (
      <Collapsible defaultOpen={hasActive}>
        <CollapsibleTrigger
          className={cn(
            "group flex w-full items-center gap-2 rounded-md transition-colors hover:bg-sidebar-accent/50",
            isSub ? "px-3 pt-3 pb-1.5" : "px-3 pt-4 pb-2"
          )}
        >
          <Icon
            className={cn(
              isSub ? "h-3.5 w-3.5 text-muted-foreground/70" : "h-4 w-4 text-primary"
            )}
          />
          <span
            className={cn(
              "uppercase tracking-wider flex-1 text-left",
              isSub
                ? "text-[10px] font-semibold text-muted-foreground"
                : "text-xs font-bold text-foreground"
            )}
          >
            {label}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-0.5 overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          {items.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar">
      {/* Header - Logo and Workspace Selector */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="relative flex items-center justify-center mb-3">
          <img src={theme === "premium" ? "/dn-nexus-light.png" : "/dn-nexus-dark.png"} alt="dn.nexus" className="h-[36px] w-auto object-contain" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-0 h-7 w-7 text-muted-foreground hover:text-sidebar-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <SidebarWorkspaceSelector />
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
        
        {/* Workspace Name and Main Items */}
        <div className="px-3 py-1.5 mb-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            {currentWorkspace?.name || "Workspace"}
          </span>
        </div>
        <div className="space-y-0.5">
          {mainNavItems.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}
        </div>

        <Separator className="my-3 bg-sidebar-border" />

        {/* CRM Section */}
        <SectionHeader icon={Kanban} label="CRM" />
        <div className="space-y-0.5">
          {crmNavItems.map((item) => (
            <NavItem key={item.href} item={item} />
          ))}
        </div>

        {/* CRM Settings Subsection - admin only (collapsible) */}
        {isAdmin && (
          <CollapsibleSection
            icon={Settings}
            label="Configurações"
            items={crmSettingsItems}
            variant="subsection"
          />
        )}

        <Separator className="my-3 bg-sidebar-border" />

        {/* CONFIGURAÇÕES Section Header */}
        <SectionHeader icon={Settings} label="Configurações" />

        {/* WORKSPACE Subsection (collapsible) */}
        <CollapsibleSection
          icon={Settings}
          label="Workspace"
          items={workspaceSettingsItems.filter((item) => !item.adminOnly || isAdmin)}
          variant="subsection"
        />

        {/* EMPRESA Section - admin only (collapsible) */}
        {isAdmin && (
          <CollapsibleSection
            icon={Building2}
            label="Empresa"
            items={companySettingsItems}
            variant="section"
          />
        )}

        {/* ADMINISTRAÇÃO Section - only for super_admin (collapsible) */}
        {isSuperAdmin && (
          <CollapsibleSection
            icon={Crown}
            label="Administração"
            items={adminNavItems}
            variant="section"
          />
        )}
      </nav>

      {/* Footer - Theme Toggle & User Section */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {/* Theme Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 justify-center gap-2 h-8 text-xs bg-sidebar-accent hover:bg-sidebar-border border-sidebar-border"
            onClick={() => setTheme(theme === "dark" ? "premium" : "dark")}
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5" />
                <span>Modo Claro</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" />
                <span>Modo Escuro</span>
              </>
            )}
          </Button>
        </div>

        {/* User Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between rounded-lg px-3 py-2 h-auto hover:bg-sidebar-accent"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-xs flex-shrink-0">
                  U
                </div>
                <span className="text-sm font-medium text-sidebar-foreground">Minha Conta</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="start" 
            className="w-[200px] rounded-lg bg-popover border-border z-[60]"
          >
            <DropdownMenuItem 
              onClick={handleLogout}
              className="cursor-pointer rounded-md px-3 py-2 text-sm text-destructive focus:bg-destructive focus:text-destructive-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
