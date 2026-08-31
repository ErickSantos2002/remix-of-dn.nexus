import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CollapsedSidebar } from "./CollapsedSidebar";
import { GlobalHeader } from "./GlobalHeader";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { useAppointmentReminders } from "@/hooks/useAppointmentReminders";
import { useActivityReminders } from "@/hooks/useActivityReminders";
import { NotificationPermissionBanner } from "@/components/notifications/NotificationPermissionBanner";

function AppLayoutContent() {
  const location = useLocation();
  const isInboxPage = location.pathname === "/";
  
  const [sidebarOpen, setSidebarOpen] = useState(!isInboxPage);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { permissionStatus, requestPermission } = useAppointmentReminders();
  useActivityReminders();

  useEffect(() => {
    setSidebarOpen(!isInboxPage);
    if (isInboxPage) {
      setSidebarCollapsed(false);
    }
  }, [isInboxPage]);

  const isPersistentSidebar = !isInboxPage;

  return (
    <div className="flex flex-col h-screen h-[100dvh] w-full bg-background overflow-hidden">
      {/* Global Header - always visible */}
      <GlobalHeader onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

      
      {/* Main layout area - below header */}
      <div className="flex flex-1 overflow-hidden pt-12">

        <NotificationPermissionBanner
          permissionStatus={permissionStatus}
          onRequestPermission={requestPermission}
        />
            
        {/* Persistent Sidebar for desktop on non-Inbox pages */}
        {isPersistentSidebar && (
          <div 
            className={cn(
              "hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out",
              sidebarCollapsed ? "w-[52px]" : "w-[240px]"
            )}
          >
            {sidebarCollapsed ? (
              <CollapsedSidebar onExpand={() => setSidebarCollapsed(false)} />
            ) : (
              <Sidebar onClose={() => setSidebarCollapsed(true)} isPersistent={true} />
            )}
          </div>
        )}

        {/* Overlay Sidebar for mobile OR for Inbox page */}
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out w-[240px] pt-12",
            isPersistentSidebar ? "lg:hidden" : "",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>

        {/* Overlay backdrop when sidebar is open (mobile or Inbox) */}
        {sidebarOpen && (
          <div
            className={cn(
              "fixed inset-0 z-30 bg-background/80 backdrop-blur-sm pt-12",
              isPersistentSidebar && "lg:hidden"
            )}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content - with scroll support */}
        <main className="flex-1 h-full overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <CompanyProvider>
      <WorkspaceProvider>
        <AppLayoutContent />
      </WorkspaceProvider>
    </CompanyProvider>
  );
}
