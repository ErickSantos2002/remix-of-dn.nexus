import { Suspense } from "react";
import { lazyRetry } from "@/lib/lazyRetry";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";

// PublicSchedule is eager-imported to remove one waterfall hop on /schedule/:id.
// Other public routes stay lazy.
import PublicSchedule from "./pages/PublicSchedule";
const PublicChat = lazyRetry(() => import("./pages/PublicChat"));
const EmbedChat = lazyRetry(() => import("./pages/EmbedChat"));
const MeetingRoom = lazyRetry(() => import("./pages/MeetingRoom"));
const MeetingGate = lazyRetry(() => import("./pages/MeetingGate"));

// Auth pages - lazy
const Login = lazyRetry(() => import("./pages/Login"));
const Register = lazyRetry(() => import("./pages/Register"));
const ResetPassword = lazyRetry(() => import("./pages/ResetPassword"));
const AcceptInvite = lazyRetry(() => import("./pages/AcceptInvite"));
const NotFound = lazyRetry(() => import("./pages/NotFound"));
const LegalPrivacyPolicy = lazyRetry(() => import("./pages/LegalPrivacyPolicy"));
const LegalSecurityPolicy = lazyRetry(() => import("./pages/LegalSecurityPolicy"));
const LegalCookiesPolicy = lazyRetry(() => import("./pages/LegalCookiesPolicy"));
const LegalAutomatedServiceNotice = lazyRetry(() => import("./pages/LegalAutomatedServiceNotice"));
const LegalTermsOfUse = lazyRetry(() => import("./pages/LegalTermsOfUse"));

// Auth guards - needed for route structure
import ProtectedRoute from "./components/auth/ProtectedRoute";
import SuperAdminRoute from "./components/auth/SuperAdminRoute";
import AdminRoute from "./components/auth/AdminRoute";
import { AppLayout } from "./components/layout/AppLayout";

// Lazy loaded pages - only downloaded when navigated to
const Inbox = lazyRetry(() => import("./pages/Inbox"));
const Analytics = lazyRetry(() => import("./pages/Analytics"));
const ProductDocs = lazyRetry(() => import("./pages/ProductDocs"));
const Agents = lazyRetry(() => import("./pages/Agents"));
const AgentsProntos = lazyRetry(() => import("./pages/AgentsProntos"));
const AdminTemplates = lazyRetry(() => import("./pages/AdminTemplates"));
const AdminCompanies = lazyRetry(() => import("./pages/AdminCompanies"));
const Admin = lazyRetry(() => import("./pages/Admin"));
const Knowledge = lazyRetry(() => import("./pages/Knowledge"));
const Connections = lazyRetry(() => import("./pages/Connections"));
const TeamSettings = lazyRetry(() => import("./pages/TeamSettings"));
const WorkspacesSettings = lazyRetry(() => import("./pages/WorkspacesSettings"));
const CompanySettings = lazyRetry(() => import("./pages/CompanySettings"));
const AgentAvailability = lazyRetry(() => import("./pages/AgentAvailability"));
const ChatCategories = lazyRetry(() => import("./pages/ChatCategories"));
const RoutingConfig = lazyRetry(() => import("./pages/RoutingConfig"));
const ApiKeys = lazyRetry(() => import("./pages/ApiKeys"));
const CRMPipeline = lazyRetry(() => import("./pages/CRMPipeline"));
const CRMContacts = lazyRetry(() => import("./pages/CRMContacts"));
const CRMPipelineSettings = lazyRetry(() => import("./pages/CRMPipelineSettings"));
const CRMProductsSettings = lazyRetry(() => import("./pages/CRMProductsSettings"));

const LeadPsychology = lazyRetry(() => import("./pages/LeadPsychology"));
const AutomoveRules = lazyRetry(() => import("./pages/AutomoveRules"));
const CRMAppointments = lazyRetry(() => import("./pages/CRMAppointments"));
const CrmPerformance = lazyRetry(() => import("./pages/CrmPerformance"));
const CRMGoogleCalendarSettings = lazyRetry(() => import("./pages/CRMGoogleCalendarSettings"));
const CRMAgentCalendarSettings = lazyRetry(() => import("./pages/CRMAgentCalendarSettings"));
const CRMCadences = lazyRetry(() => import("./pages/CRMCadences"));
const CRMFlows = lazyRetry(() => import("./pages/CRMFlows"));
const CRMFlowBuilder = lazyRetry(() => import("./pages/CRMFlowBuilder"));
const CompanySendingWindow = lazyRetry(() => import("./pages/CompanySendingWindow"));
const CRMTagsSettings = lazyRetry(() => import("./pages/CRMTagsSettings"));
const AgentToolsSettings = lazyRetry(() => import("./pages/AgentToolsSettings"));
const ToolsCatalog = lazyRetry(() => import("./pages/ToolsCatalog"));
const AgentCategories = lazyRetry(() => import("./pages/AgentCategories"));
const WidgetSettings = lazyRetry(() => import("./pages/WidgetSettings"));
const MeetingSettings = lazyRetry(() => import("./pages/MeetingSettings"));
const AdminNotificationsTest = lazyRetry(() => import("./pages/AdminNotificationsTest"));
const ApiDocs = lazyRetry(() => import("./pages/ApiDocs"));
const DataPrivacy = lazyRetry(() => import("./pages/DataPrivacy"));
const SchedulingWidgetHistory = lazyRetry(() => import("./pages/SchedulingWidgetHistory"));
const Widgets = lazyRetry(() => import("./pages/Widgets"));
const WhatsAppTemplates = lazyRetry(() => import("./pages/WhatsAppTemplates"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex items-center justify-center h-full min-h-[200px]">
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

// Public widget shell — bypasses QueryClient/Theme/Toaster/Tooltip to keep
// the critical JS path under 100KB for /schedule/:id.
const PublicScheduleShell = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/schedule/:widgetId" element={<PublicSchedule />} />
      <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
    </Routes>
  </BrowserRouter>
);

const FullApp = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      themes={["dark", "premium"]}
      enableSystem={false}
      disableTransitionOnChange
      /* next-themes escreve color-scheme inline no <html> e so entende
         "dark"/"light". Como o tema claro do Nexus se chama "premium",
         ele mantinha "dark" e o Chrome pintava scrollbar, autofill e
         date picker escuros sobre o fundo claro. O color-scheme fica
         por conta do CSS, em [data-theme="..."]. */
      enableColorScheme={false}
    >
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public widget routes - outside of auth */}
            <Route path="/chat/:slug" element={<PublicChat />} />
            <Route path="/embed/:slug" element={<EmbedChat />} />
            <Route path="/meeting/:roomName" element={<MeetingRoom />} />
            <Route path="/m/:appointmentId" element={<MeetingGate />} />
            <Route path="/schedule/:widgetId" element={<PublicSchedule />} />

            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/api/docs" element={<Suspense fallback={<PageLoader />}><ApiDocs /></Suspense>} />
            <Route path="/legal/politica-de-privacidade" element={<LegalPrivacyPolicy />} />
            <Route path="/legal/politica-de-seguranca-da-informacao" element={<LegalSecurityPolicy />} />
            <Route path="/legal/politica-de-cookies" element={<LegalCookiesPolicy />} />
            <Route path="/legal/aviso-de-atendimento-automatizado" element={<LegalAutomatedServiceNotice />} />
            <Route path="/legal/termos-de-uso" element={<LegalTermsOfUse />} />
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Suspense fallback={<PageLoader />}><Inbox /></Suspense>} />
              <Route path="analytics" element={<Suspense fallback={<PageLoader />}><Analytics /></Suspense>} />
              <Route path="docs" element={<Suspense fallback={<PageLoader />}><ProductDocs /></Suspense>} />
              <Route path="agents" element={<Suspense fallback={<PageLoader />}><Agents /></Suspense>} />
              <Route path="agents/categories" element={<Suspense fallback={<PageLoader />}><AgentCategories /></Suspense>} />
              <Route path="agents/prontos" element={<Suspense fallback={<PageLoader />}><AgentsProntos /></Suspense>} />
              <Route path="agents/:agentId/tools" element={<Suspense fallback={<PageLoader />}><AgentToolsSettings /></Suspense>} />
              <Route
                path="admin"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoader />}><Admin /></Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route
                path="admin/templates"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoader />}><AdminTemplates /></Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route
                path="admin/companies"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoader />}><AdminCompanies /></Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route
                path="admin/notifications-test"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoader />}><AdminNotificationsTest /></Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route path="knowledge" element={<Suspense fallback={<PageLoader />}><Knowledge /></Suspense>} />
              <Route path="connections" element={<Suspense fallback={<PageLoader />}><Connections /></Suspense>} />
              <Route path="crm/pipeline" element={<Suspense fallback={<PageLoader />}><CRMPipeline /></Suspense>} />
              <Route path="crm/contacts" element={<Suspense fallback={<PageLoader />}><CRMContacts /></Suspense>} />
              <Route path="crm/contacts/:contactId" element={<Suspense fallback={<PageLoader />}><CRMContacts /></Suspense>} />
              <Route path="crm/appointments" element={<Suspense fallback={<PageLoader />}><CRMAppointments /></Suspense>} />
              <Route path="crm/desempenho" element={<Suspense fallback={<PageLoader />}><CrmPerformance /></Suspense>} />
              <Route path="crm/settings/pipeline" element={<Suspense fallback={<PageLoader />}><CRMPipelineSettings /></Suspense>} />
              <Route path="crm/settings/products" element={<Suspense fallback={<PageLoader />}><CRMProductsSettings /></Suspense>} />
              <Route path="crm/settings/tags" element={<Suspense fallback={<PageLoader />}><CRMTagsSettings /></Suspense>} />
              
              <Route path="crm/settings/automove" element={<Suspense fallback={<PageLoader />}><AutomoveRules /></Suspense>} />
              <Route path="crm/settings/google-calendar" element={<Suspense fallback={<PageLoader />}><CRMGoogleCalendarSettings /></Suspense>} />
              <Route path="crm/settings/agent-calendars" element={<Suspense fallback={<PageLoader />}><CRMAgentCalendarSettings /></Suspense>} />
              <Route path="crm/settings/cadences" element={<Suspense fallback={<PageLoader />}><CRMCadences /></Suspense>} />
              <Route path="crm/settings/flows" element={<Suspense fallback={<PageLoader />}><CRMFlows /></Suspense>} />
              <Route path="crm/settings/flows/:id" element={<Suspense fallback={<PageLoader />}><CRMFlowBuilder /></Suspense>} />
              <Route path="crm/settings/activity-cadences" element={<Navigate to="/crm/settings/cadences?tab=activity" replace />} />
              <Route path="crm/settings/stage-cadences" element={<Navigate to="/crm/settings/cadences?tab=stage" replace />} />
              <Route path="crm/leads/:leadId/psychology" element={<Suspense fallback={<PageLoader />}><LeadPsychology /></Suspense>} />
              <Route path="settings/company" element={<Suspense fallback={<PageLoader />}><CompanySettings /></Suspense>} />
              <Route path="settings/company/sending-window" element={<Suspense fallback={<PageLoader />}><CompanySendingWindow /></Suspense>} />
              <Route path="settings/workspaces" element={<Suspense fallback={<PageLoader />}><WorkspacesSettings /></Suspense>} />
              <Route path="settings/availability" element={<Suspense fallback={<PageLoader />}><AgentAvailability /></Suspense>} />
              <Route path="settings/categories" element={<Suspense fallback={<PageLoader />}><ChatCategories /></Suspense>} />
              <Route path="settings/routing" element={<Suspense fallback={<PageLoader />}><RoutingConfig /></Suspense>} />
              <Route path="settings/api-keys" element={<Suspense fallback={<PageLoader />}><ApiKeys /></Suspense>} />
              <Route path="settings/tools" element={<Suspense fallback={<PageLoader />}><ToolsCatalog /></Suspense>} />
              <Route path="settings/widgets" element={<Suspense fallback={<PageLoader />}><Widgets /></Suspense>} />
              <Route path="settings/whatsapp-templates" element={<AdminRoute><Suspense fallback={<PageLoader />}><WhatsAppTemplates /></Suspense></AdminRoute>} />
              <Route path="settings/assistente-reuniao" element={<Suspense fallback={<PageLoader />}><MeetingSettings /></Suspense>} />
              <Route path="settings/scheduling" element={<Navigate to="/settings/widgets#scheduling" replace />} />
              <Route path="settings/scheduling/:widgetId/history" element={<Suspense fallback={<PageLoader />}><SchedulingWidgetHistory /></Suspense>} />
              <Route
                path="settings/data-privacy"
                element={
                  <AdminRoute>
                    <Suspense fallback={<PageLoader />}><DataPrivacy /></Suspense>
                  </AdminRoute>
                }
              />
              <Route
                path="settings/team"
                element={
                  <AdminRoute>
                    <Suspense fallback={<PageLoader />}><TeamSettings /></Suspense>
                  </AdminRoute>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

const isPublicScheduleRoute =
  typeof window !== "undefined" && window.location.pathname.startsWith("/schedule/");

const App = () => (isPublicScheduleRoute ? <PublicScheduleShell /> : <FullApp />);

export default App;
