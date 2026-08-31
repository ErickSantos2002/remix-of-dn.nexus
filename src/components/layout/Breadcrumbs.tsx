import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: LucideIcon;
}

const routeConfig: Record<string, BreadcrumbItem[]> = {
  "/": [
    { label: "Chat ao Vivo" },
  ],
   "/analytics": [
    { label: "Relatórios" },
  ],
  "/agents": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Agentes" },
  ],
  "/agents/prontos": [
    { label: "Agentes", href: "/agents" },
    { label: "Agentes Prontos" },
  ],
  "/knowledge": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Conhecimento" },
  ],
  "/connections": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Conexões" },
  ],
  "/settings/categories": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Categorias" },
  ],
  "/settings/routing": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Roteamento" },
  ],
  "/settings/availability": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Disponibilidade" },
  ],
  "/settings/workspaces": [
    { label: "Configurações", href: "/settings" },
    { label: "Empresa" },
    { label: "Workspaces" },
  ],
  "/settings/team": [
    { label: "Configurações", href: "/settings" },
    { label: "Empresa" },
    { label: "Equipe" },
  ],
  "/settings/api-keys": [
    { label: "Configurações", href: "/settings" },
    { label: "Empresa" },
    { label: "Chaves de API" },
  ],
  "/settings/company": [
    { label: "Configurações", href: "/settings" },
    { label: "Empresa" },
    { label: "Configurações" },
  ],
  "/settings/tools": [
    { label: "Configurações", href: "/settings" },
    { label: "Workspace" },
    { label: "Catálogo de Tools" },
  ],
  "/admin/templates": [
    { label: "Administração" },
    { label: "Templates" },
  ],
  "/admin/companies": [
    { label: "Administração" },
    { label: "Empresas" },
  ],
};

export default function Breadcrumbs() {
  const location = useLocation();
  const { currentWorkspace } = useWorkspace();
  const pathname = location.pathname;
  
  const items = routeConfig[pathname] || [{ label: "Página" }];

  // Add workspace to breadcrumbs
  const breadcrumbsWithWorkspace: BreadcrumbItem[] = [
    { label: "Home", href: "/", icon: Home },
  ];

  if (currentWorkspace) {
    breadcrumbsWithWorkspace.push({
      label: currentWorkspace.name,
      href: "/",
    });
  }

  breadcrumbsWithWorkspace.push(...items);

  return (
    <nav className="flex items-center font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
      {/* Desktop breadcrumbs */}
      <div className="hidden sm:flex items-center gap-1">
        {breadcrumbsWithWorkspace.map((item, index) => (
          <div key={index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            )}
            {item.href && index < breadcrumbsWithWorkspace.length - 1 ? (
              <Link
                to={item.href}
                className={cn(
                  "flex items-center gap-1 hover:text-foreground transition-colors",
                  index === 0 && "text-muted-foreground"
                )}
              >
                {item.icon && <item.icon className="h-3 w-3" />}
                <span>{item.label}</span>
              </Link>
            ) : (
              <span className={cn(
                "flex items-center gap-1",
                index === breadcrumbsWithWorkspace.length - 1 && "text-foreground font-medium"
              )}>
                {item.icon && <item.icon className="h-3 w-3" />}
                <span>{item.label}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Mobile breadcrumbs - show only last 2 items */}
      <div className="flex sm:hidden items-center gap-1">
        {breadcrumbsWithWorkspace.slice(-2).map((item, index, arr) => (
          <div key={index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            )}
            {item.href && index < arr.length - 1 ? (
              <Link
                to={item.href}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn(
                index === arr.length - 1 && "text-foreground font-medium"
              )}>
                {item.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
