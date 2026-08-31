import { useState, useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MessageSquare, Plus, Settings, Trash2, Copy, Check, ExternalLink, Phone, Shield, Zap, Calendar, Link2, Link2Off, RefreshCw, Loader2, AlertCircle, Building2, ChevronRight, Power, QrCode, Pencil, User, FileText, ImageIcon, PhoneOff, Save, BarChart3 } from "lucide-react";
import { ZapiStatsModal } from "@/components/connections/ZapiStatsModal";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ZapiTestPanel } from "@/components/zapi/ZapiTestPanel";
import { useSearchParams, useLocation, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";
import { ConnectionWorkspaceSelector } from "@/components/connections/ConnectionWorkspaceSelector";
import { ConnectionHealthBadge } from "@/components/connections/ConnectionHealthBadge";
import { WarmUpBanner } from "@/components/connections/WarmUpBanner";
import { saveConnectionWorkspaces, loadConnectionWorkspaces } from "@/hooks/useConnectionWorkspaces";
import { encryptToken } from "@/lib/crypto";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface WhatsAppConnection {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  access_token: string;
  business_account_id: string;
  webhook_verify_token: string;
  is_active: boolean;
  provider?: string;
  display_phone_number?: string | null;
  verified_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ZApiConnection {
  id: string;
  workspace_id: string;
  instance_id: string;
  api_token?: string; // coluna sem SELECT para clientes (segredo; só service_role lê)
  phone_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  zapi_instance_name: string | null;
  zapi_due: string | null;
  zapi_connected: boolean | null;
  zapi_payment_status: string | null;
  zapi_created_at: string | null;
  zapi_validated_at: string | null;
  call_reject_auto: boolean | null;
  call_reject_message: string | null;
}

interface ValidatedZapiInstance {
  id: string;
  name: string;
  due: number;
  connected: boolean;
  paymentStatus: string;
  created: string;
}

interface LinkedWorkspace {
  workspace_id: string;
  keywords: string[];
  is_default: boolean;
  priority: number;
}

const VALID_TABS = ["official", "zapi", "google-calendar"] as const;
type TabValue = typeof VALID_TABS[number];

const Connections = () => {
  const { workspaceId } = useWorkspace();
  const { companyId, isOwner } = useCompany();
  const { isSuperAdmin, isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Members only manage their own Google Calendar; official channel is admin/owner territory
  const canManageChannels = isAdmin || isOwner;
  // Every workspace user can view Z-API instances (read-only) and reconnect via QR Code
  const canViewZapi = true;


  // Tab from URL hash
  const getTabFromHash = (): TabValue => {
    const hash = location.hash.replace("#", "");
    return VALID_TABS.includes(hash as TabValue) ? (hash as TabValue) : "official";
  };

  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromHash());

  // Update tab when hash changes
  useEffect(() => {
    setActiveTab(getTabFromHash());
  }, [location.hash]);

  // Redirect members away from tabs they cannot access
  useEffect(() => {
    if (!canManageChannels && activeTab === "official") {
      const fallback: TabValue = canViewZapi ? "zapi" : "google-calendar";
      setActiveTab(fallback);
      navigate(`#${fallback}`, { replace: true });
    }
  }, [canManageChannels, canViewZapi, activeTab, navigate]);


  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue);
    navigate(`#${value}`, { replace: true });
  };
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [zapiConnections, setZapiConnections] = useState<ZApiConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isZapiDialogOpen, setIsZapiDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<WhatsAppConnection | null>(null);
  const [editingZapiConnection, setEditingZapiConnection] = useState<ZApiConnection | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  
  // WhatsApp Official Form state
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Z-API Form state
  const [zapiInstanceId, setZapiInstanceId] = useState("");
  const [zapiApiToken, setZapiApiToken] = useState("");
  const [zapiInstanceName, setZapiInstanceName] = useState("");
  const [zapiPhoneNumber, setZapiPhoneNumber] = useState("");
  const [isZapiSaving, setIsZapiSaving] = useState(false);

  // Z-API Validation state (2-step modal)
  const [zapiValidationStep, setZapiValidationStep] = useState<'input' | 'confirm'>('input');
  const [validatedZapiInstance, setValidatedZapiInstance] = useState<ValidatedZapiInstance | null>(null);
  const [isValidatingZapi, setIsValidatingZapi] = useState(false);
  const [isRevalidatingZapi, setIsRevalidatingZapi] = useState(false);
  const [isConfiguringWebhooks, setIsConfiguringWebhooks] = useState(false);
  const [editZapiNewInstanceId, setEditZapiNewInstanceId] = useState("");
  const [editZapiNewApiToken, setEditZapiNewApiToken] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [companyWorkspaces, setCompanyWorkspaces] = useState<{ id: string; name: string }[]>([]);

  // Linked workspaces state for multi-workspace routing
  const [linkedWorkspaces, setLinkedWorkspaces] = useState<LinkedWorkspace[]>([]);
  const [zapiLinkedWorkspaces, setZapiLinkedWorkspaces] = useState<LinkedWorkspace[]>([]);

  // Z-API Connect/Disconnect state
  const [isDisconnectingZapi, setIsDisconnectingZapi] = useState(false);
  const [isQRCodeModalOpen, setIsQRCodeModalOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [isLoadingQRCode, setIsLoadingQRCode] = useState(false);
  const [qrCodePollingInterval, setQrCodePollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  // Z-API Profile Edit state
  const [isProfileEditModalOpen, setIsProfileEditModalOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profilePictureUrl, setProfilePictureUrl] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // Z-API Call Rejection state
  const [callRejectAuto, setCallRejectAuto] = useState(false);
  const [callRejectMessage, setCallRejectMessage] = useState("");
  const [isSavingCallSettings, setIsSavingCallSettings] = useState(false);

  // Z-API Stats modal state
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [statsConnectionId, setStatsConnectionId] = useState<string | null>(null);
  const [statsConnectionName, setStatsConnectionName] = useState<string | null>(null);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;
  const zapiWebhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-webhook`;

  // Check if user can manage connections (company owner or super_admin)
  const canManageConnections = isOwner || isSuperAdmin;

  // Google Calendar Integration - individual per user
  const { data: googleIntegration, isLoading: googleLoading } = useQuery({
    queryKey: ["google-calendar-integration", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("crm_google_calendar_integration")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  // Handle Google OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state) {
      handleGoogleOAuthCallback(code, state);
      setSearchParams({});
    }
  }, [searchParams]);

  const handleGoogleOAuthCallback = async (code: string, state: string) => {
    try {
      setIsConnectingGoogle(true);
      const { workspace_id, user_id } = JSON.parse(atob(state));
      const redirectUri = `${window.location.origin}/connections`;
      
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: {
          action: 'exchange_code',
          code,
          redirect_uri: redirectUri,
          workspace_id,
          user_id,
        },
      });

      if (error || !data.success) {
        throw new Error(data?.error || error?.message || 'Failed to connect');
      }

      const { data: { user } } = await supabase.auth.getUser();
      
      const { error: insertError } = await supabase
        .from('crm_google_calendar_integration')
        .upsert({
          workspace_id,
          user_id: user?.id,
          google_access_token: data.access_token,
          google_refresh_token: data.refresh_token,
          token_expires_at: data.expires_at,
          google_email: data.email,
          google_calendar_id: data.calendar_id,
          is_enabled: true,
          auto_create_events: true,
          auto_sync_events: true,
        }, {
          onConflict: 'workspace_id,user_id',
        });

      if (insertError) throw insertError;

      queryClient.invalidateQueries({ queryKey: ['google-calendar-integration'] });
      toast.success(`Google Calendar conectado: ${data.email}`);
      
    } catch (error: any) {
      console.error('OAuth callback error:', error);
      toast.error(error.message || 'Erro ao conectar Google Calendar');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      setIsConnectingGoogle(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !workspaceId) {
        throw new Error('Usuário não autenticado');
      }

      const redirectUri = `${window.location.origin}/connections`;
      
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: {
          action: 'get_auth_url',
          workspace_id: workspaceId,
          user_id: user.id,
          redirect_uri: redirectUri,
        },
      });

      if (error) throw error;
      window.location.href = data.auth_url;
      
    } catch (error: any) {
      console.error('Connect error:', error);
      toast.error(error.message || 'Erro ao conectar');
      setIsConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      const { error } = await supabase
        .from('crm_google_calendar_integration')
        .delete()
        .eq('workspace_id', workspaceId);
      
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['google-calendar-integration'] });
      toast.success('Google Calendar desconectado');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao desconectar');
    }
  };

  const handleSyncGoogle = async () => {
    setIsSyncingGoogle(true);
    try {
      await supabase
        .from('crm_google_calendar_integration')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId);
      
      queryClient.invalidateQueries({ queryKey: ['google-calendar-integration'] });
      toast.success('Sincronização concluída');
    } catch (error: any) {
      toast.error(error.message || 'Erro na sincronização');
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  const handleToggleGoogleSetting = async (field: string, value: boolean) => {
    try {
      const { error } = await supabase
        .from('crm_google_calendar_integration')
        .update({ [field]: value })
        .eq('workspace_id', workspaceId);
      
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['google-calendar-integration'] });
      toast.success('Configuração atualizada');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar');
    }
  };

  useEffect(() => {
    if (!canManageChannels && !canViewZapi) {
      setLoading(false);
      return;
    }
    if (workspaceId) {
      if (canManageChannels) fetchConnections();
      if (canViewZapi) fetchZapiConnections();
      if (!canManageChannels) setLoading(false);
    }
  }, [workspaceId, canManageChannels, canViewZapi]);


  // Fetch company workspaces for Z-API connection dropdown
  useEffect(() => {
    const fetchCompanyWorkspaces = async () => {
      if (!companyId || !canManageChannels) return;
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name");

      if (!error && data) {
        setCompanyWorkspaces(data);
      }
    };
    fetchCompanyWorkspaces();
  }, [companyId, canManageChannels]);

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_connections')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      console.error('Error fetching connections:', error);
      toast.error('Erro ao carregar conexoes');
    } finally {
      setLoading(false);
    }
  };

  const fetchZapiConnections = async () => {
    try {
      // Buscar IDs de conexões vinculadas ao workspace atual (ÚNICA fonte de verdade)
      const { data: linkedConnections } = await supabase
        .from('connection_workspaces')
        .select('connection_id')
        .eq('workspace_id', workspaceId)
        .eq('connection_type', 'zapi')
        .eq('is_active', true);

      const linkedIds = (linkedConnections || []).map(c => c.connection_id);

      // Se não há conexões vinculadas, retornar lista vazia
      if (linkedIds.length === 0) {
        setZapiConnections([]);
        return;
      }

      // Buscar apenas conexões vinculadas via connection_workspaces.
      // Colunas explícitas: api_token/client_token não têm mais SELECT para
      // clientes (privilégio por coluna) — select('*') falharia com 42501.
      const { data, error } = await supabase
        .from('zapi_connections')
        .select('id, workspace_id, instance_id, instance_name, phone_number, is_active, zapi_connected, zapi_payment_status, zapi_due, zapi_validated_at, zapi_instance_name, zapi_created_at, call_reject_auto, call_reject_message, circuit_state, circuit_failure_count, circuit_opened_at, created_at, updated_at')
        .in('id', linkedIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setZapiConnections((data || []) as ZApiConnection[]);
    } catch (error) {
      console.error('Error fetching Z-API connections:', error);
    }
  };

  const handleSaveConnection = async () => {
    if (!phoneNumberId || !accessToken || !businessAccountId) {
      toast.error('Preencha todos os campos obrigatorios');
      return;
    }

    setIsSaving(true);
    try {
      let connectionId: string;
      
      if (editingConnection) {
        const { error } = await supabase
          .from('whatsapp_connections')
          .update({
            phone_number_id: phoneNumberId,
            access_token: accessToken,
            business_account_id: businessAccountId,
          })
          .eq('id', editingConnection.id);

        if (error) throw error;
        connectionId = editingConnection.id;
      } else {
        const { data, error } = await supabase
          .from('whatsapp_connections')
          .insert({
            workspace_id: workspaceId,
            phone_number_id: phoneNumberId,
            access_token: accessToken,
            business_account_id: businessAccountId,
            provider: 'official',
          })
          .select('id')
          .single();

        if (error) throw error;
        connectionId = data.id;
      }

      // Save linked workspaces
      if (linkedWorkspaces.length > 0) {
        await saveConnectionWorkspaces(connectionId, 'whatsapp_official', linkedWorkspaces);
      }

      toast.success(editingConnection ? 'Conexão atualizada com sucesso' : 'Conexão criada com sucesso');
      setIsDialogOpen(false);
      resetForm();
      fetchConnections();
    } catch (error) {
      console.error('Error saving connection:', error);
      toast.error('Erro ao salvar conexão');
    } finally {
      setIsSaving(false);
    }
  };

  // Parse instance ID from URL or raw value
  const parseInstanceId = (input: string): string => {
    // If it's a URL like https://api.z-api.io/instances/XXXX/token/... extract the ID
    const urlMatch = input.match(/instances\/([A-F0-9]{32})/i);
    if (urlMatch) {
      return urlMatch[1].toUpperCase();
    }
    // If it looks like a raw instance ID (32 hex chars), return it
    if (/^[A-F0-9]{32}$/i.test(input.trim())) {
      return input.trim().toUpperCase();
    }
    // Otherwise return as-is (will be validated later)
    return input.trim();
  };

  const validateInstanceId = (id: string): boolean => {
    return /^[A-F0-9]{32}$/i.test(id);
  };

  // Edit mode only - updates instance name, phone and linked workspaces
  const handleSaveZapiConnection = async () => {
    if (!editingZapiConnection) {
      toast.error('Nenhuma conexão selecionada para edição');
      return;
    }

    setIsZapiSaving(true);
    try {
      // Verificar se o nome da instância mudou e chamar Z-API para renomear
      const nameChanged = zapiInstanceName !== editingZapiConnection.zapi_instance_name;
      if (nameChanged && zapiInstanceName.trim() && companyId && editingZapiConnection.zapi_connected) {
        console.log('[Connections] Renaming instance via Z-API:', zapiInstanceName.trim());
        const { data: renameData, error: renameError } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: editingZapiConnection.id,
            company_id: companyId,
            action: 'rename-instance',
            instance_name: zapiInstanceName.trim(),
          },
        });

        if (renameError || !renameData?.success) {
          console.error('[Connections] Rename error:', renameError || renameData?.error);
          toast.error('Erro ao renomear instância na Z-API: ' + (renameData?.error || 'Erro desconhecido'));
          // Continuar salvando no banco local mesmo assim
        } else {
          console.log('[Connections] Instance renamed successfully');
        }
      }

      const { error } = await supabase
        .from('zapi_connections')
        .update({
          zapi_instance_name: zapiInstanceName || null,
          phone_number: zapiPhoneNumber || null,
        })
        .eq('id', editingZapiConnection.id);

      if (error) throw error;

      // Save linked workspaces for routing (handles empty array = remove all)
      await saveConnectionWorkspaces(editingZapiConnection.id, 'zapi', zapiLinkedWorkspaces);

      toast.success('Conexão Z-API atualizada');
      setIsZapiDialogOpen(false);
      resetZapiForm();
      fetchZapiConnections();
    } catch (error) {
      console.error('Error saving Z-API connection:', error);
      toast.error('Erro ao salvar conexão Z-API');
    } finally {
      setIsZapiSaving(false);
    }
  };

  const handleToggleActive = async (connection: WhatsAppConnection) => {
    try {
      const nextActive = !connection.is_active;
      const { error } = await supabase
        .from('whatsapp_connections')
        .update({ is_active: nextActive })
        .eq('id', connection.id);

      if (error) throw error;

      toast.success(connection.is_active ? 'Conexão desativada' : 'Conexão ativada');

      // Ao ativar, busca o número real na Meta Graph API e salva no card
      if (nextActive) {
        try {
          const { data, error: fnErr } = await supabase.functions.invoke(
            'whatsapp-fetch-phone-info',
            { body: { connection_id: connection.id } }
          );
          const errMsg =
            (data as any)?.error ||
            (fnErr as any)?.context?.error?.message ||
            (fnErr as any)?.message;
          if (data?.display_phone_number) {
            toast.success(`Número identificado: ${data.display_phone_number}`);
          } else if (errMsg?.includes('Session has expired') || errMsg?.includes('access token')) {
            toast.error('Token da Meta expirado. Edite a conexão e cole um novo Access Token permanente (System User).', { duration: 8000 });
          } else if (errMsg) {
            toast.error(`Não foi possível obter o número: ${errMsg}`);
          }
        } catch (e: any) {
          console.error('Fetch phone info error:', e);
          toast.error('Conexão ativada, mas falhou ao buscar o número na Meta');
        }
      }

      fetchConnections();
    } catch (error) {
      console.error('Error toggling connection:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const handleToggleZapiActive = async (connection: ZApiConnection) => {
    try {
      const { error } = await supabase
        .from('zapi_connections')
        .update({ is_active: !connection.is_active })
        .eq('id', connection.id);

      if (error) throw error;
      
      toast.success(connection.is_active ? 'Conexão desativada' : 'Conexão ativada');
      fetchZapiConnections();
    } catch (error) {
      console.error('Error toggling Z-API connection:', error);
      toast.error('Erro ao alterar status');
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from('whatsapp_connections')
        .delete()
        .eq('id', connectionId);

      if (error) throw error;
      
      toast.success('Conexão removida com sucesso');
      fetchConnections();
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast.error('Erro ao remover conexão');
    }
  };

  const handleDeleteZapiConnection = async (connectionId: string) => {
    try {
      const { error } = await supabase
        .from('zapi_connections')
        .delete()
        .eq('id', connectionId);

      if (error) throw error;
      
      toast.success('Conexão Z-API removida com sucesso');
      fetchZapiConnections();
    } catch (error) {
      console.error('Error deleting Z-API connection:', error);
      toast.error('Erro ao remover conexão');
    }
  };

  const handleEditConnection = async (connection: WhatsAppConnection) => {
    setEditingConnection(connection);
    setPhoneNumberId(connection.phone_number_id);
    setAccessToken(connection.access_token);
    setBusinessAccountId(connection.business_account_id);
    
    // Load linked workspaces
    const linked = await loadConnectionWorkspaces(connection.id, 'whatsapp_official');
    setLinkedWorkspaces(linked);
    
    setIsDialogOpen(true);
  };

  const handleEditZapiConnection = async (connection: ZApiConnection) => {
    setEditingZapiConnection(connection);
    setZapiInstanceId(connection.instance_id);
    // api_token não é mais legível pelo cliente (privilégio por coluna) e o
    // update de credenciais usa editZapiNewApiToken — campo fica vazio.
    setZapiApiToken("");
    setZapiInstanceName(connection.zapi_instance_name || "");
    setZapiPhoneNumber(connection.phone_number || "");

    // Load linked workspaces
    let linked = await loadConnectionWorkspaces(connection.id, 'zapi');

    // Fallback: se não há workspaces na tabela connection_workspaces,
    // usar o workspace_id da própria conexão
    if (linked.length === 0 && connection.workspace_id) {
      linked = [{
        workspace_id: connection.workspace_id,
        keywords: [],
        is_default: true,
        priority: 0,
      }];
    }

    setZapiLinkedWorkspaces(linked);

    // Initialize call rejection settings
    setCallRejectAuto(connection.call_reject_auto || false);
    setCallRejectMessage(connection.call_reject_message || "");

    setIsZapiDialogOpen(true);
  };

  const handleRevalidateZapiConnection = async () => {
    if (!editingZapiConnection || !companyId) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }

    setIsRevalidatingZapi(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-validate-instance', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
        },
      });

      if (error) throw error;

      if (!data.valid) {
        toast.error(data.error || 'Falha na validação');
        return;
      }

      // Atualizar estado local com dados retornados
      const updatedConnection = {
        zapi_instance_name: data.connection.zapi_instance_name,
        zapi_due: data.connection.zapi_due,
        zapi_connected: data.connection.zapi_connected,
        zapi_payment_status: data.connection.zapi_payment_status,
        zapi_validated_at: data.connection.zapi_validated_at,
      };

      setEditingZapiConnection(prev => prev ? { ...prev, ...updatedConnection } : null);

      // Atualizar tambem a lista de conexoes para refletir o nome atualizado
      setZapiConnections(prev => prev.map(conn =>
        conn.id === editingZapiConnection.id ? { ...conn, ...updatedConnection } : conn
      ));

      // Feedback sobre webhooks
      if (data.webhooks?.success) {
        toast.success(`Instância revalidada e ${data.webhooks.configured} webhooks configurados com sucesso`);
      } else if (data.webhooks?.configured > 0) {
        toast.warning(`Instância revalidada. ${data.webhooks.configured}/${data.webhooks.total} webhooks configurados.`);
      } else if (data.webhooks) {
        toast.warning('Instância revalidada, mas nenhum webhook foi configurado. Verifique os logs.');
      } else {
        toast.success('Instância revalidada com sucesso');
      }
    } catch (error: any) {
      console.error('Error revalidating Z-API connection:', error);
      toast.error(error.message || 'Erro ao revalidar instância');
    } finally {
      setIsRevalidatingZapi(false);
    }
  };

  const handleReconfigureZapiWebhooks = async () => {
    if (!editingZapiConnection) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }
    setIsConfiguringWebhooks(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-configure-webhooks', {
        body: { connection_id: editingZapiConnection.id },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`${data.configured} webhooks configurados com sucesso`);
      } else if (data?.configured > 0) {
        const failedLabels = (data.results || [])
          .filter((r: any) => !r.ok)
          .map((r: any) => r.label)
          .join(', ');
        toast.warning(`${data.configured} configurados, ${data.failed} falharam: ${failedLabels}`);
      } else {
        toast.error(data?.error || 'Falha ao configurar webhooks');
      }
    } catch (err: any) {
      console.error('Error configuring Z-API webhooks:', err);
      toast.error(err.message || 'Erro ao configurar webhooks');
    } finally {
      setIsConfiguringWebhooks(false);
    }
  };

  // Desconectar instância Z-API
  const handleDisconnectZapi = async () => {
    if (!editingZapiConnection || !companyId) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }

    setIsDisconnectingZapi(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
          action: 'disconnect',
        },
      });

      if (error) throw error;

      if (!data.success) {
        toast.error(data.error || 'Erro ao desconectar instância');
        return;
      }

      // Atualizar estado local
      setEditingZapiConnection(prev => prev ? { ...prev, zapi_connected: false } : null);
      toast.success('Instância desconectada com sucesso');
    } catch (error: any) {
      console.error('Error disconnecting Z-API:', error);
      toast.error(error.message || 'Erro ao desconectar instância');
    } finally {
      setIsDisconnectingZapi(false);
    }
  };

  // Buscar QR Code
  const fetchQRCode = async () => {
    if (!editingZapiConnection || !companyId) return;

    setIsLoadingQRCode(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
          action: 'qrcode',
        },
      });

      if (error) throw error;

      if (!data.success) {
        if (data.alreadyConnected) {
          toast.success('Instância já está conectada!');
          setEditingZapiConnection(prev => prev ? { ...prev, zapi_connected: true } : null);
          handleCloseQRCodeModal();
          return;
        }
        toast.error(data.error || 'Erro ao gerar QR Code');
        setQrCodeData(null);
        return;
      }

      if (typeof data.qrcode !== 'string') {
        console.error('QR code data is not a string:', data.qrcode);
        toast.error('Formato de QR Code inesperado');
        setQrCodeData(null);
        return;
      }
      setQrCodeData(data.qrcode);
    } catch (error: any) {
      console.error('Error fetching QR code:', error);
      toast.error(error.message || 'Erro ao gerar QR Code');
      setQrCodeData(null);
    } finally {
      setIsLoadingQRCode(false);
    }
  };

  // Buscar QR Code para uma conexão específica (usado pelo botão do card)
  const fetchQRCodeForConnection = async (connection: ZApiConnection) => {
    if (!companyId) return;

    setIsLoadingQRCode(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: connection.id,
          company_id: companyId,
          action: 'qrcode',
        },
      });

      if (error) throw error;

      if (!data.success) {
        if (data.alreadyConnected) {
          toast.success('Instância já está conectada!');
          setEditingZapiConnection(prev => prev ? { ...prev, zapi_connected: true } : null);
          handleCloseQRCodeModal();
          fetchZapiConnections();
          return;
        }
        toast.error(data.error || 'Erro ao gerar QR Code');
        setQrCodeData(null);
        return;
      }

      if (typeof data.qrcode !== 'string') {
        console.error('QR code data is not a string:', data.qrcode);
        toast.error('Formato de QR Code inesperado');
        setQrCodeData(null);
        return;
      }
      setQrCodeData(data.qrcode);
    } catch (error: any) {
      console.error('Error fetching QR code:', error);
      toast.error(error.message || 'Erro ao gerar QR Code');
      setQrCodeData(null);
    } finally {
      setIsLoadingQRCode(false);
    }
  };

  // Verificar status da conexão
  const checkConnectionStatus = async () => {
    if (!editingZapiConnection || !companyId) return false;

    try {
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
          action: 'status',
        },
      });

      if (error) throw error;

      if (data.success && data.connected) {
        // Conexão estabelecida!
        setEditingZapiConnection(prev => prev ? { ...prev, zapi_connected: true } : null);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking connection status:', error);
      return false;
    }
  };

  // Iniciar polling do status
  const startQRCodePolling = () => {
    // Limpar interval anterior se existir
    if (qrCodePollingInterval) {
      clearInterval(qrCodePollingInterval);
    }

    const interval = setInterval(async () => {
      const connected = await checkConnectionStatus();
      if (connected) {
        clearInterval(interval);
        setQrCodePollingInterval(null);
        toast.success('WhatsApp conectado com sucesso!');
        handleCloseQRCodeModal();

        // Revalidar e atualizar dados do card
        await handleRevalidateZapiConnection();
      }
    }, 5000);

    setQrCodePollingInterval(interval);
  };

  // Abrir modal QR Code
  const handleOpenQRCodeModal = async () => {
    setIsQRCodeModalOpen(true);
    setQrCodeData(null);
    await fetchQRCode();
    startQRCodePolling();
  };

  // Abrir modal QR Code diretamente do card
  const handleOpenQRCodeFromCard = async (connection: ZApiConnection) => {
    setEditingZapiConnection(connection);
    setIsQRCodeModalOpen(true);
    setQrCodeData(null);
    await fetchQRCodeForConnection(connection);
    startQRCodePolling();
  };

  // Fechar modal QR Code
  const handleCloseQRCodeModal = () => {
    if (qrCodePollingInterval) {
      clearInterval(qrCodePollingInterval);
      setQrCodePollingInterval(null);
    }
    setIsQRCodeModalOpen(false);
    setQrCodeData(null);
  };

  // Cleanup polling ao desmontar
  useEffect(() => {
    return () => {
      if (qrCodePollingInterval) {
        clearInterval(qrCodePollingInterval);
      }
    };
  }, [qrCodePollingInterval]);

  // Abrir modal de edição de perfil
  const handleOpenProfileEditModal = async () => {
    if (!editingZapiConnection || !companyId) return;

    // Abrir modal e mostrar loading
    setIsProfileEditModalOpen(true);
    setIsLoadingProfile(true);
    setProfileName("");
    setProfileDescription("");
    setProfilePictureUrl("");

    try {
      // Buscar dados atuais do perfil via Z-API
      const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
          action: 'get-profile',
        },
      });

      if (error) throw error;

      if (data.success && data.profile) {
        setProfileName(data.profile.name || "");
        setProfileDescription(data.profile.description || "");
        // Não pre-preenchemos a URL da foto por segurança
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      // Fallback para dados locais
      setProfileName(editingZapiConnection?.zapi_instance_name || "");
    } finally {
      setIsLoadingProfile(false);
    }
  };

  // Fechar modal de edição de perfil
  const handleCloseProfileEditModal = () => {
    setIsProfileEditModalOpen(false);
    setProfileName("");
    setProfileDescription("");
    setProfilePictureUrl("");
  };

  // Salvar alteracoes do perfil
  const handleSaveProfile = async () => {
    if (!editingZapiConnection || !companyId) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }

    setIsSavingProfile(true);
    let hasChanges = false;
    const errors: string[] = [];

    try {
      // Atualizar nome do perfil
      if (profileName.trim()) {
        const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: editingZapiConnection.id,
            company_id: companyId,
            action: 'update-profile-name',
            profile_name: profileName.trim(),
          },
        });
        if (error || !data.success) {
          errors.push('Nome');
        } else {
          hasChanges = true;
        }
      }

      // Atualizar descrição do perfil
      if (profileDescription !== undefined && profileDescription !== "") {
        const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: editingZapiConnection.id,
            company_id: companyId,
            action: 'update-profile-description',
            profile_description: profileDescription,
          },
        });
        if (error || !data.success) {
          errors.push('Descrição');
        } else {
          hasChanges = true;
        }
      }

      // Atualizar foto do perfil
      if (profilePictureUrl.trim()) {
        const { data, error } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: editingZapiConnection.id,
            company_id: companyId,
            action: 'update-profile-picture',
            profile_picture_url: profilePictureUrl.trim(),
          },
        });
        if (error || !data.success) {
          errors.push('Foto');
        } else {
          hasChanges = true;
        }
      }

      if (errors.length > 0) {
        toast.error(`Erro ao atualizar: ${errors.join(', ')}`);
      } else if (hasChanges) {
        toast.success('Perfil atualizado com sucesso!');
        handleCloseProfileEditModal();
      } else {
        toast.info('Nenhuma alteração para salvar');
      }
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Erro ao atualizar perfil');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Salvar configurações de rejeição de chamadas
  const handleSaveCallSettings = async () => {
    if (!editingZapiConnection || !companyId) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }

    setIsSavingCallSettings(true);
    const errors: string[] = [];

    try {
      // Salvar configuração de rejeição automática
      const { data: rejectData, error: rejectError } = await supabase.functions.invoke('zapi-instance-control', {
        body: {
          connection_id: editingZapiConnection.id,
          company_id: companyId,
          action: 'update-call-reject-auto',
          call_reject_auto: callRejectAuto,
        },
      });

      if (rejectError || !rejectData?.success) {
        errors.push('Rejeição automática');
      }

      // Se ativo e tem mensagem, salvar mensagem
      if (callRejectAuto && callRejectMessage.trim()) {
        const { data: msgData, error: msgError } = await supabase.functions.invoke('zapi-instance-control', {
          body: {
            connection_id: editingZapiConnection.id,
            company_id: companyId,
            action: 'update-call-reject-message',
            call_reject_message: callRejectMessage.trim(),
          },
        });

        if (msgError || !msgData?.success) {
          errors.push('Mensagem');
        }
      }

      if (errors.length > 0) {
        toast.error(`Erro ao salvar: ${errors.join(', ')}`);
      } else {
        // Atualizar estado local
        setEditingZapiConnection(prev => prev ? {
          ...prev,
          call_reject_auto: callRejectAuto,
          call_reject_message: callRejectMessage,
        } : null);

        toast.success('Configurações de chamada atualizadas');
      }
    } catch (error: any) {
      console.error('Error saving call settings:', error);
      toast.error(error.message || 'Erro ao salvar configurações');
    } finally {
      setIsSavingCallSettings(false);
    }
  };

  const resetForm = () => {
    setEditingConnection(null);
    setPhoneNumberId("");
    setAccessToken("");
    setBusinessAccountId("");
    setLinkedWorkspaces([]);
  };

  const resetZapiForm = () => {
    setEditingZapiConnection(null);
    setZapiInstanceId("");
    setZapiApiToken("");
    setZapiInstanceName("");
    setZapiPhoneNumber("");
    setZapiLinkedWorkspaces([]);
    // Reset validation state
    setZapiValidationStep('input');
    setValidatedZapiInstance(null);
    setSelectedWorkspaceId("");
    // Reset super_admin credential edit state
    setEditZapiNewInstanceId("");
    setEditZapiNewApiToken("");
  };

  const handleUpdateZapiCredentials = async () => {
    if (!editingZapiConnection || !companyId) {
      toast.error('Nenhuma conexão selecionada');
      return;
    }

    if (!editZapiNewInstanceId || !editZapiNewApiToken) {
      toast.error('Preencha Instance ID e API Token');
      return;
    }

    const parsedInstanceId = parseInstanceId(editZapiNewInstanceId);

    if (!validateInstanceId(parsedInstanceId)) {
      toast.error('Instance ID invalido. Deve ter 32 caracteres hexadecimais.');
      return;
    }

    setIsValidatingZapi(true);
    try {
      // Primeiro validar as novas credenciais
      const { data: validateData, error: validateError } = await supabase.functions.invoke('zapi-validate-instance', {
        body: {
          instance_id: parsedInstanceId,
          api_token: editZapiNewApiToken,
          company_id: companyId,
        },
      });

      if (validateError) throw validateError;

      if (!validateData.valid) {
        toast.error(validateData.error || 'Credenciais invalidas');
        return;
      }

      // Criptografar apenas api_token (instance_id nao e sensivel e necessario para busca do webhook)
      const encryptedApiToken = await encryptToken(editZapiNewApiToken, companyId);

      // Atualizar a conexão com as novas credenciais
      const { error: updateError } = await supabase
        .from('zapi_connections')
        .update({
          instance_id: parsedInstanceId,
          api_token: encryptedApiToken,
          zapi_instance_name: validateData.data.name,
          zapi_due: validateData.data.due ? new Date(validateData.data.due).toISOString() : null,
          zapi_connected: validateData.data.connected,
          zapi_payment_status: validateData.data.paymentStatus,
          zapi_validated_at: new Date().toISOString(),
        })
        .eq('id', editingZapiConnection.id);

      if (updateError) throw updateError;

      // Atualizar estado local
      setEditingZapiConnection(prev => prev ? {
        ...prev,
        zapi_instance_name: validateData.data.name,
        zapi_due: validateData.data.due ? new Date(validateData.data.due).toISOString() : null,
        zapi_connected: validateData.data.connected,
        zapi_payment_status: validateData.data.paymentStatus,
        zapi_validated_at: new Date().toISOString(),
      } : null);

      // Limpar campos
      setEditZapiNewInstanceId("");
      setEditZapiNewApiToken("");

      toast.success('Credenciais atualizadas com sucesso');
      fetchZapiConnections();
    } catch (error: any) {
      console.error('Error updating Z-API credentials:', error);
      toast.error(error.message || 'Erro ao atualizar credenciais');
    } finally {
      setIsValidatingZapi(false);
    }
  };

  const handleValidateZapiInstance = async () => {
    if (!zapiInstanceId || !zapiApiToken) {
      toast.error('Preencha Instance ID e API Token');
      return;
    }

    const parsedInstanceId = parseInstanceId(zapiInstanceId);

    if (!validateInstanceId(parsedInstanceId)) {
      toast.error('Instance ID invalido. Deve ter 32 caracteres hexadecimais.');
      return;
    }

    if (!companyId) {
      toast.error('Empresa não selecionada');
      return;
    }

    setIsValidatingZapi(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-validate-instance', {
        body: {
          instance_id: parsedInstanceId,
          api_token: zapiApiToken,
          company_id: companyId,
        },
      });

      if (error) throw error;

      if (!data.valid) {
        toast.error(data.error || 'Credenciais invalidas');
        return;
      }

      // Set validated instance data and move to confirm step
      setValidatedZapiInstance(data.data);
      setZapiValidationStep('confirm');

      // Pre-select current workspace if available
      if (workspaceId && !selectedWorkspaceId) {
        setSelectedWorkspaceId(workspaceId);
      }

      toast.success('Instância validada com sucesso');
    } catch (error: any) {
      console.error('Error validating Z-API instance:', error);
      toast.error(error.message || 'Erro ao validar instância');
    } finally {
      setIsValidatingZapi(false);
    }
  };

  const handleSaveValidatedZapiConnection = async () => {
    if (!validatedZapiInstance || !selectedWorkspaceId || !companyId) {
      toast.error('Selecione um workspace');
      return;
    }

    const parsedInstanceId = parseInstanceId(zapiInstanceId);

    setIsZapiSaving(true);
    try {
      // Encrypt only api_token (instance_id is not sensitive and needed for webhook lookup)
      const encryptedApiToken = await encryptToken(zapiApiToken, companyId);

      const { data, error } = await supabase
        .from('zapi_connections')
        .insert({
          workspace_id: selectedWorkspaceId,
          instance_id: parsedInstanceId,
          api_token: encryptedApiToken,
          phone_number: null,
          zapi_instance_name: validatedZapiInstance.name,
          zapi_due: validatedZapiInstance.due ? new Date(validatedZapiInstance.due).toISOString() : null,
          zapi_connected: validatedZapiInstance.connected,
          zapi_payment_status: validatedZapiInstance.paymentStatus,
          zapi_created_at: validatedZapiInstance.created ? new Date(validatedZapiInstance.created).toISOString() : null,
          zapi_validated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw error;

      toast.success('Conexão Z-API criada com sucesso');
      setIsZapiDialogOpen(false);
      resetZapiForm();
      fetchZapiConnections();
    } catch (error: any) {
      console.error('Error saving Z-API connection:', error);
      toast.error(error.message || 'Erro ao salvar conexão Z-API');
    } finally {
      setIsZapiSaving(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success('Copiado para a area de transferencia');
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const maskToken = (token: string) => {
    if (token.length <= 20) return '****';
    return token.substring(0, 10) + '...' + token.substring(token.length - 10);
  };

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Breadcrumbs />
        <div className="glass-card p-8 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Selecione um Workspace</h2>
          <p className="text-muted-foreground">Selecione um workspace para gerenciar conexoes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs />
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conexões</h1>
          <p className="text-muted-foreground">
            {canManageChannels
              ? "Configure integracoes com WhatsApp e outros canais."
              : "Acompanhe as conexoes Z-API e conecte sua agenda do Google."}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          {canManageChannels && (
            <TabsTrigger value="official" asChild>
              <Link to="#official" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                WhatsApp Official
              </Link>
            </TabsTrigger>
          )}
          {canViewZapi && (
            <TabsTrigger value="zapi" asChild>
              <Link to="#zapi" className="gap-2">
                <Zap className="w-4 h-4" />
                Z-API
              </Link>
            </TabsTrigger>
          )}

          <TabsTrigger value="google-calendar" asChild>
            <Link to="#google-calendar" className="gap-2">
              <Calendar className="w-4 h-4" />
              Google Calendar
            </Link>
          </TabsTrigger>
        </TabsList>

        {/* WhatsApp Official Tab */}
        {canManageChannels && (
        <>
        <TabsContent value="official" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--brand-whatsapp)]/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-[var(--brand-whatsapp)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">WhatsApp Business API</h2>
                <p className="text-sm text-muted-foreground">API oficial do Meta</p>
              </div>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
              {canManageConnections && (
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" />
                    Nova Conexão
                  </Button>
                </DialogTrigger>
              )}
              <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-primary" />
                    {editingConnection ? 'Editar Conexão WhatsApp' : 'Nova Conexão WhatsApp'}
                  </DialogTitle>
                  <DialogDescription>
                    Configure sua integração com a WhatsApp Business API.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
                    <Input
                      id="phoneNumberId"
                      placeholder="Ex: 123456789012345"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontrado no painel do Meta Business
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="businessAccountId">Business Account ID *</Label>
                    <Input
                      id="businessAccountId"
                      placeholder="Ex: 987654321098765"
                      value={businessAccountId}
                      onChange={(e) => setBusinessAccountId(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="accessToken">Access Token *</Label>
                    <Input
                      id="accessToken"
                      type="password"
                      placeholder="Token de acesso permanente"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Token permanente gerado no Meta Business
                    </p>
                  </div>

                  {/* Multi-workspace selector for routing */}
                  {companyId && (
                    <ConnectionWorkspaceSelector
                      companyId={companyId}
                      connectionId={editingConnection?.id || null}
                      connectionType="whatsapp_official"
                      linkedWorkspaces={linkedWorkspaces}
                      onLinkedWorkspacesChange={setLinkedWorkspaces}
                    />
                  )}

                  <div className="glass-card p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Shield className="w-4 h-4 text-primary" />
                      Configuração do Webhook
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">URL do Webhook</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={webhookUrl}
                          className="text-xs font-mono bg-muted/50"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(webhookUrl, 'webhook')}
                        >
                          {copiedField === 'webhook' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    {editingConnection && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Verify Token</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={editingConnection.webhook_verify_token}
                            className="text-xs font-mono bg-muted/50"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(editingConnection.webhook_verify_token, 'verify')}
                          >
                            {copiedField === 'verify' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSaveConnection} disabled={isSaving}>
                    {isSaving ? 'Salvando...' : editingConnection ? 'Atualizar' : 'Criar Conexão'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2].map((i) => (
                <Card key={i} className="glass-card animate-pulse">
                  <CardHeader>
                    <div className="h-5 bg-muted rounded w-1/2" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-10 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : connections.length === 0 ? (
            <Card className="glass-card border-dashed">
              <CardContent className="py-12 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  Nenhuma conexão oficial configurada
                </h3>
                <p className="text-muted-foreground mb-4">
                  Conecte sua conta WhatsApp Business para receber e responder mensagens.
                </p>
                {canManageConnections && (
                  <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Adicionar Conexão
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {connections.map((connection) => (
                <Card key={connection.id} className="glass-card group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[var(--brand-whatsapp)]/20 flex items-center justify-center">
                          <Phone className="w-5 h-5 text-[var(--brand-whatsapp)]" />
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            {connection.display_phone_number
                              ? `+${connection.display_phone_number.replace(/^\+/, '')}`
                              : 'WhatsApp Official'}
                          </CardTitle>
                          <CardDescription className="text-xs font-mono">
                            {connection.verified_name
                              ? connection.verified_name
                              : `ID: ${connection.phone_number_id}`}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant={connection.is_active ? "default" : "secondary"}>
                        {connection.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                      {connection.display_phone_number && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Número:</span>
                          <span className="font-mono text-foreground">
                            +{connection.display_phone_number.replace(/^\+/, '')}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Phone ID:</span>
                        <span className="font-mono text-foreground">{connection.phone_number_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Business ID:</span>
                        <span className="font-mono text-foreground">{connection.business_account_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Token:</span>
                        <span className="font-mono text-foreground">{maskToken(connection.access_token)}</span>
                      </div>
                    </div>


                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={connection.is_active}
                          onCheckedChange={() => handleToggleActive(connection)}
                          disabled={!canManageConnections}
                        />
                        <span className="text-sm text-muted-foreground">
                          {connection.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      {canManageConnections && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditConnection(connection)}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover Conexão</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover esta conexão? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteConnection(connection.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* WhatsApp Official Setup Guide */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Como Configurar (Official)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">1. Conta Meta Business</h4>
                  <p className="text-sm text-muted-foreground">
                    Crie ou acesse sua conta no Meta Business Suite e configure o WhatsApp Business API.
                  </p>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4" />
                      Acessar Meta Business
                    </a>
                  </Button>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">2. Obter Credenciais</h4>
                  <p className="text-sm text-muted-foreground">
                    No painel do WhatsApp, copie o Phone Number ID, Business Account ID e gere um Access Token permanente.
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">3. Configurar Webhook</h4>
                  <p className="text-sm text-muted-foreground">
                    No Meta Business, configure o webhook usando a URL e Verify Token fornecidos.
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">4. Testar Conexão</h4>
                  <p className="text-sm text-muted-foreground">
                    Envie uma mensagem para o número configurado e verifique se aparece no Chat ao Vivo.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        </>
        )}

        {/* Z-API Tab */}
        <TabsContent value="zapi" className="space-y-4">

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Z-API</h2>
                <p className="text-sm text-muted-foreground">Integração alternativa via Z-API</p>
              </div>
            </div>
            <Dialog open={isZapiDialogOpen} onOpenChange={(open) => { setIsZapiDialogOpen(open); if (!open) resetZapiForm(); }}>
              {canManageConnections && (
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" />
                    Nova Conexão Z-API
                  </Button>
                </DialogTrigger>
              )}
              <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" />
                    {editingZapiConnection ? 'Editar Conexão Z-API' : 'Nova Conexão Z-API'}
                  </DialogTitle>
                  <DialogDescription>
                    {zapiValidationStep === 'input'
                      ? 'Informe as credenciais da instância para validar.'
                      : 'Confirme os dados da instância e selecione o workspace.'}
                  </DialogDescription>
                </DialogHeader>

                {/* Step 1: Input credentials */}
                {zapiValidationStep === 'input' && !editingZapiConnection && (
                  <div className="space-y-4 py-4">
                    <div className="glass-card p-3 border-primary/30 bg-primary/5">
                      <p className="text-xs text-muted-foreground">
                        <strong className="text-foreground">Pré-requisito:</strong> Configure o Token de Segurança da Conta Z-API em Configurações da Empresa antes de adicionar instâncias.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="zapiInstanceId">Instance ID *</Label>
                      <Input
                        id="zapiInstanceId"
                        placeholder="Ex: 3EB9AACC9DE76160F09AB6EB734A5D3D"
                        value={zapiInstanceId}
                        onChange={(e) => setZapiInstanceId(e.target.value)}
                        disabled={isValidatingZapi}
                      />
                      <p className="text-xs text-muted-foreground">
                        Código de 32 caracteres. Pode colar a URL completa.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="zapiApiToken">Token da Instância *</Label>
                      <Input
                        id="zapiApiToken"
                        type="password"
                        placeholder="Token de acesso da instância"
                        value={zapiApiToken}
                        onChange={(e) => setZapiApiToken(e.target.value)}
                        disabled={isValidatingZapi}
                      />
                      <p className="text-xs text-muted-foreground">
                        Encontrado no painel Z-API em "Token da instância"
                      </p>
                    </div>

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsZapiDialogOpen(false)} disabled={isValidatingZapi}>
                        Cancelar
                      </Button>
                      <Button onClick={handleValidateZapiInstance} disabled={isValidatingZapi}>
                        {isValidatingZapi ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Validando...
                          </>
                        ) : (
                          'Validar'
                        )}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {/* Step 2: Confirm and select workspace */}
                {zapiValidationStep === 'confirm' && validatedZapiInstance && !editingZapiConnection && (
                  <div className="space-y-4 py-4">
                    <div className="glass-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Check className="w-4 h-4 text-success" />
                          Instância Validada
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={handleValidateZapiInstance}
                          disabled={isValidatingZapi}
                        >
                          {isValidatingZapi ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Revalidar
                        </Button>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Nome:</span>
                          <span className="text-foreground font-medium">{validatedZapiInstance.name || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Status:</span>
                          <Badge variant={validatedZapiInstance.connected ? "default" : "secondary"}>
                            {validatedZapiInstance.connected ? "Conectado" : "Desconectado"}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pagamento:</span>
                          <span className="text-foreground">{validatedZapiInstance.paymentStatus || '-'}</span>
                        </div>
                        {validatedZapiInstance.due && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Expiração:</span>
                            <span className="text-foreground">
                              {new Date(validatedZapiInstance.due).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        )}
                        {validatedZapiInstance.created && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Criada em:</span>
                            <span className="text-foreground">
                              {new Date(validatedZapiInstance.created).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Vincular ao Workspace *</Label>
                      <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um workspace" />
                        </SelectTrigger>
                        <SelectContent>
                          {companyWorkspaces.map((ws) => (
                            <SelectItem key={ws.id} value={ws.id}>
                              <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-muted-foreground" />
                                {ws.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        A conexão será vinculada a este workspace.
                      </p>
                    </div>

                    <div className="glass-card p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Shield className="w-4 h-4 text-primary" />
                          Configuração dos Webhooks Z-API
                        </div>
                        <Button variant="outline" size="sm" className="gap-2" asChild>
                          <a
                            href={`https://app.z-api.io/app/instances/visualization/${parseInstanceId(zapiInstanceId)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Abrir no Z-API
                          </a>
                        </Button>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Configure estas URLs no painel Z-API em "Webhooks". Copie e cole cada URL no campo correspondente.
                      </p>

                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: "Ao receber", key: "receive" },
                          { label: "Ao enviar", key: "send" },
                          { label: "Ao conectar", key: "connect" },
                          { label: "Ao desconectar", key: "disconnect" },
                          { label: "Status da mensagem", key: "status" },
                          { label: "Presenca do chat", key: "presence" },
                        ].map((webhook) => (
                          <div key={webhook.key} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{webhook.label}</Label>
                            <div className="flex gap-1">
                              <Input
                                readOnly
                                value={zapiWebhookUrl}
                                className="text-[10px] font-mono bg-muted/50 h-8"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => copyToClipboard(zapiWebhookUrl, `zapi-${webhook.key}`)}
                              >
                                {copiedField === `zapi-${webhook.key}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setZapiValidationStep('input')}>
                        Voltar
                      </Button>
                      <Button onClick={handleSaveValidatedZapiConnection} disabled={isZapiSaving || !selectedWorkspaceId}>
                        {isZapiSaving ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          'Salvar Conexão'
                        )}
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {/* Edit mode - original form */}
                {editingZapiConnection && (
                  <div className="space-y-4 py-4">
                    {!isSuperAdmin && (
                      <div className="glass-card p-3 border-primary/30 bg-primary/5">
                        <p className="text-xs text-muted-foreground">
                          <strong className="text-foreground">Nota:</strong> As credenciais (Instance ID e Token) não podem ser alteradas. Para usar novas credenciais, crie uma nova conexão.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="zapiInstanceName">Nome da Instância</Label>
                      <Input
                        id="zapiInstanceName"
                        placeholder="Ex: Atendimento Principal"
                        value={zapiInstanceName}
                        onChange={(e) => setZapiInstanceName(e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="zapiPhoneNumber">Número do WhatsApp</Label>
                      <Input
                        id="zapiPhoneNumber"
                        placeholder="Ex: 5511999999999"
                        value={zapiPhoneNumber}
                        onChange={(e) => setZapiPhoneNumber(e.target.value)}
                      />
                    </div>

                    {/* Multi-workspace selector for routing */}
                    {companyId && (
                      <ConnectionWorkspaceSelector
                        companyId={companyId}
                        connectionId={editingZapiConnection.id}
                        connectionType="zapi"
                        linkedWorkspaces={zapiLinkedWorkspaces}
                        onLinkedWorkspacesChange={setZapiLinkedWorkspaces}
                      />
                    )}

                    {/* Status da Instância com Revalidação */}
                    <div className="glass-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <RefreshCw className="w-4 h-4 text-primary" />
                          Status da Instância
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRevalidateZapiConnection}
                            disabled={isRevalidatingZapi}
                          >
                            {isRevalidatingZapi ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Validando...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Revalidar
                              </>
                            )}
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleReconfigureZapiWebhooks}
                            disabled={isConfiguringWebhooks}
                            title="Reaponta todos os webhooks (recebido, entregue, status, conectado, etc.) para o Nexus"
                          >
                            {isConfiguringWebhooks ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Configurando...
                              </>
                            ) : (
                              <>
                                <Link2 className="w-4 h-4 mr-2" />
                                Reconfigurar webhooks
                              </>
                            )}
                          </Button>


                          {/* Botao Desconectar - quando conectado */}
                          {editingZapiConnection?.zapi_connected && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={handleDisconnectZapi}
                              disabled={isDisconnectingZapi}
                            >
                              {isDisconnectingZapi ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Power className="w-4 h-4 mr-2" />
                              )}
                              Desconectar
                            </Button>
                          )}

                          {/* Botao Conectar - quando desconectado */}
                          {!editingZapiConnection?.zapi_connected && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={handleOpenQRCodeModal}
                            >
                              <QrCode className="w-4 h-4 mr-2" />
                              Conectar
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Conectado:</span>
                          <Badge variant={editingZapiConnection?.zapi_connected ? "default" : "secondary"}>
                            {editingZapiConnection?.zapi_connected ? "Sim" : "Não"}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Pagamento:</span>
                          <span className="text-foreground">{editingZapiConnection?.zapi_payment_status || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Expiração:</span>
                          <span className="text-foreground">
                            {editingZapiConnection?.zapi_due
                              ? new Date(editingZapiConnection.zapi_due).toLocaleDateString('pt-BR')
                              : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Validado em:</span>
                          <span className="text-foreground text-xs">
                            {editingZapiConnection?.zapi_validated_at
                              ? new Date(editingZapiConnection.zapi_validated_at).toLocaleDateString('pt-BR')
                              : '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Perfil do WhatsApp */}
                    <div className="glass-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <User className="w-4 h-4 text-primary" />
                          Perfil do WhatsApp
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleOpenProfileEditModal}
                          disabled={!editingZapiConnection?.zapi_connected}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Editar Perfil
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                          <User className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {editingZapiConnection?.zapi_instance_name || 'Nome não definido'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {editingZapiConnection?.phone_number || 'Número não definido'}
                          </p>
                        </div>
                      </div>
                      {!editingZapiConnection?.zapi_connected && (
                        <p className="text-xs text-warning">
                          Conecte a instância para editar o perfil do WhatsApp
                        </p>
                      )}
                    </div>

                    {/* Rejeição de Chamadas */}
                    <div className="glass-card p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <PhoneOff className="w-4 h-4 text-primary" />
                          Rejeição de Chamadas
                        </div>
                        <Switch
                          checked={callRejectAuto}
                          onCheckedChange={setCallRejectAuto}
                          disabled={!editingZapiConnection?.zapi_connected || isSavingCallSettings}
                        />
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Quando ativado, todas as ligações recebidas serão rejeitadas automaticamente.
                      </p>

                      {callRejectAuto && (
                        <div className="space-y-2 pt-2 border-t border-border/50">
                          <Label htmlFor="callRejectMessage">Mensagem após ligação rejeitada</Label>
                          <Textarea
                            id="callRejectMessage"
                            placeholder="Ex: Desculpe, não posso atender ligações. Por favor, envie uma mensagem."
                            value={callRejectMessage}
                            onChange={(e) => setCallRejectMessage(e.target.value)}
                            disabled={isSavingCallSettings}
                            rows={2}
                          />
                          <p className="text-xs text-muted-foreground">
                            Esta mensagem será enviada automaticamente quando uma ligação for rejeitada.
                          </p>
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveCallSettings}
                        disabled={!editingZapiConnection?.zapi_connected || isSavingCallSettings}
                        className="w-full"
                      >
                        {isSavingCallSettings ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 mr-2" />
                            Salvar Configurações
                          </>
                        )}
                      </Button>

                      {!editingZapiConnection?.zapi_connected && (
                        <p className="text-xs text-warning">
                          Conecte a instância para configurar a rejeição de chamadas
                        </p>
                      )}
                    </div>

                    {/* Configuração dos Webhooks Z-API - Todos os webhooks */}
                    <div className="glass-card p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Shield className="w-4 h-4 text-primary" />
                        Configuração dos Webhooks Z-API
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Configure estas URLs no painel Z-API em "Webhooks". Copie e cole cada URL no campo correspondente.
                      </p>

                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: "Ao receber", key: "receive" },
                          { label: "Ao enviar", key: "send" },
                          { label: "Ao conectar", key: "connect" },
                          { label: "Ao desconectar", key: "disconnect" },
                          { label: "Status da mensagem", key: "status" },
                          { label: "Presenca do chat", key: "presence" },
                        ].map((webhook) => (
                          <div key={webhook.key} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{webhook.label}</Label>
                            <div className="flex gap-1">
                              <Input
                                readOnly
                                value={zapiWebhookUrl}
                                className="text-[10px] font-mono bg-muted/50 h-8"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => copyToClipboard(zapiWebhookUrl, `zapi-edit-${webhook.key}`)}
                              >
                                {copiedField === `zapi-edit-${webhook.key}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Super Admin - Credential Update Section (Collapsible) */}
                    {isSuperAdmin && (
                      <Collapsible defaultOpen={false} className="glass-card border-warning/30 bg-warning/5">
                        <CollapsibleTrigger className="flex items-center gap-2 w-full p-4 text-sm font-medium text-foreground group">
                          <ChevronRight className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                          <Shield className="w-4 h-4 text-warning" />
                          Atualizar Credenciais (Super Admin)
                        </CollapsibleTrigger>
                        <CollapsibleContent className="px-4 pb-4 space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Somente super administradores podem alterar as credenciais da instância.
                          </p>

                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="editZapiNewInstanceId" className="text-xs">Novo Instance ID</Label>
                              <Input
                                id="editZapiNewInstanceId"
                                placeholder="Ex: 3EB9AACC9DE76160F09AB6EB734A5D3D"
                                value={editZapiNewInstanceId}
                                onChange={(e) => setEditZapiNewInstanceId(e.target.value)}
                                disabled={isValidatingZapi}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="editZapiNewApiToken" className="text-xs">Novo API Token</Label>
                              <Input
                                id="editZapiNewApiToken"
                                type="password"
                                placeholder="Token de acesso da instância"
                                value={editZapiNewApiToken}
                                onChange={(e) => setEditZapiNewApiToken(e.target.value)}
                                disabled={isValidatingZapi}
                              />
                            </div>

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleUpdateZapiCredentials}
                              disabled={isValidatingZapi || !editZapiNewInstanceId || !editZapiNewApiToken}
                              className="w-full"
                            >
                              {isValidatingZapi ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Validando e Atualizando...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-4 h-4 mr-2" />
                                  Validar e Atualizar Credenciais
                                </>
                              )}
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsZapiDialogOpen(false)}>
                        Cancelar
                      </Button>
                      <Button onClick={handleSaveZapiConnection} disabled={isZapiSaving}>
                        {isZapiSaving ? 'Salvando...' : 'Atualizar'}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {zapiConnections.length === 0 ? (
            <Card className="glass-card border-dashed">
              <CardContent className="py-12 text-center">
                <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  Nenhuma conexão Z-API configurada
                </h3>
                <p className="text-muted-foreground mb-4">
                  Configure sua integração Z-API para usar números não oficiais.
                </p>
                {canManageConnections && (
                  <Button onClick={() => setIsZapiDialogOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    Adicionar Conexão Z-API
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {zapiConnections.map((connection) => (
                <Card key={connection.id} className="glass-card group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Zap className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">
                            {connection.zapi_instance_name || 'Instância Z-API'}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {connection.phone_number || 'Credenciais salvas'}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={connection.is_active ? "default" : "secondary"}>
                          {connection.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                        {connection.zapi_connected !== null && (
                          <Badge variant={connection.zapi_connected ? "outline" : "secondary"} className="text-[10px]">
                            {connection.zapi_connected ? "Conectado" : "Desconectado"}
                          </Badge>
                        )}
                        <ConnectionHealthBadge connectionId={connection.id} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <WarmUpBanner connectionCreatedAt={connection.created_at} />
                    <div className="space-y-2 text-sm">
                      {connection.zapi_payment_status && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pagamento:</span>
                          <span className="text-foreground">{connection.zapi_payment_status}</span>
                        </div>
                      )}
                      {connection.zapi_due && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expiração:</span>
                          <span className="text-foreground">
                            {new Date(connection.zapi_due).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      )}
                      {connection.zapi_validated_at && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Validado em:</span>
                          <span className="text-foreground text-xs">
                            {new Date(connection.zapi_validated_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={connection.is_active}
                          onCheckedChange={() => handleToggleZapiActive(connection)}
                          disabled={!canManageConnections}
                        />
                        <span className="text-sm text-muted-foreground">
                          {connection.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setStatsConnectionId(connection.id);
                            setStatsConnectionName(connection.zapi_instance_name || connection.instance_id);
                            setIsStatsModalOpen(true);
                          }}
                          title="Estatisticas"
                        >
                          <BarChart3 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        {connection.zapi_connected !== null && !connection.zapi_connected && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenQRCodeFromCard(connection)}
                            title="Conectar WhatsApp"
                          >
                            <QrCode className="w-4 h-4 text-primary" />
                          </Button>
                        )}
                      {canManageConnections && (
                        <>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditZapiConnection(connection)}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover Conexão Z-API</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover esta conexão? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteZapiConnection(connection.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Z-API Setup Guide */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Como Configurar (Z-API)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">1. Criar Conta Z-API</h4>
                  <p className="text-sm text-muted-foreground">
                    Acesse z-api.io e crie sua conta. Voce recebera creditos de teste.
                  </p>
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href="https://z-api.io" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4" />
                      Acessar Z-API
                    </a>
                  </Button>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">2. Criar Instância</h4>
                  <p className="text-sm text-muted-foreground">
                    No painel Z-API, crie uma nova instância e conecte seu WhatsApp escaneando o QR Code.
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">3. Obter Credenciais</h4>
                  <p className="text-sm text-muted-foreground">
                    Copie o Instance ID e Token da sua instância no painel Z-API.
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">4. Configurar Webhook</h4>
                  <p className="text-sm text-muted-foreground">
                    No painel Z-API, va em Webhooks e configure a URL fornecida em "On Message Received".
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Z-API Test Panel */}
          {canManageConnections && zapiConnections.filter(c => c.is_active).length > 0 && (
            <ZapiTestPanel connectionId={zapiConnections.find(c => c.is_active)?.id} />
          )}
        </TabsContent>


        {/* Google Calendar Tab */}
        <TabsContent value="google-calendar" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Google Calendar</h2>
                <p className="text-sm text-muted-foreground">Sincronize agendamentos automaticamente</p>
              </div>
            </div>
          </div>

          {/* Status Card */}
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Status da Conexão</CardTitle>
                <Badge
                  variant="outline"
                  className={googleIntegration?.is_enabled
                    ? "bg-success/20 text-success border-success/30"
                    : "bg-muted text-muted-foreground"
                  }
                >
                  {googleIntegration?.is_enabled ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Conectado
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Desconectado
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {googleLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : googleIntegration?.is_enabled ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Email conectado</span>
                      <span className="text-foreground font-medium">{googleIntegration.google_email || "N/A"}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Calendario</span>
                      <span className="text-foreground font-medium">{googleIntegration.google_calendar_id || "Principal"}</span>
                    </div>
                    {googleIntegration.last_sync_at && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Última sincronização</span>
                        <span className="text-foreground font-medium">
                          {new Date(googleIntegration.last_sync_at).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-foreground">Criar eventos automaticamente</div>
                        <div className="text-sm text-muted-foreground">
                          Novos agendamentos sao criados no Google Calendar
                        </div>
                      </div>
                      <Switch
                        checked={googleIntegration.auto_create_events || false}
                        onCheckedChange={(checked) => handleToggleGoogleSetting('auto_create_events', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-foreground">Sincronizar automaticamente</div>
                        <div className="text-sm text-muted-foreground">
                          Manter eventos sincronizados em tempo real
                        </div>
                      </div>
                      <Switch
                        checked={googleIntegration.auto_sync_events || false}
                        onCheckedChange={(checked) => handleToggleGoogleSetting('auto_sync_events', checked)}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 gap-2"
                      onClick={handleSyncGoogle}
                      disabled={isSyncingGoogle}
                    >
                      <RefreshCw className={`h-4 w-4 ${isSyncingGoogle ? "animate-spin" : ""}`} />
                      {isSyncingGoogle ? "Sincronizando..." : "Sincronizar Agora"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="gap-2">
                          <Link2Off className="h-4 w-4" />
                          Desconectar
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Desconectar Google Calendar</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tem certeza? Novos agendamentos não serão sincronizados com o Google Calendar.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDisconnectGoogle}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Desconectar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 space-y-4">
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <Calendar className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Conecte com o Google Calendar</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Sincronize agendamentos automaticamente e crie links do Google Meet
                    </p>
                  </div>
                  <Button onClick={handleConnectGoogle} disabled={isConnectingGoogle} className="gap-2">
                    {isConnectingGoogle ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {isConnectingGoogle ? "Conectando..." : "Conectar com Google"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* How it works */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-primary" />
                Como funciona a sincronização
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Quando conectado, todos os agendamentos criados no CRM serao automaticamente criados no seu Google Calendar. 
                Alteracoes feitas em qualquer uma das plataformas serao sincronizadas automaticamente.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal QR Code para conexão Z-API */}
      <Dialog open={isQRCodeModalOpen} onOpenChange={handleCloseQRCodeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              Conectar WhatsApp
            </DialogTitle>
            <DialogDescription>
              Escaneie o QR Code com seu WhatsApp para conectar a instância
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-6">
            {isLoadingQRCode ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-32 w-32 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            ) : qrCodeData ? (
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-white rounded-lg">
                  <img
                    src={typeof qrCodeData === 'string' && qrCodeData.startsWith('data:') ? qrCodeData : `data:image/png;base64,${qrCodeData}`}
                    alt="QR Code"
                    className="w-64 h-64"
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Aguardando leitura do QR Code...
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Verificando conexão a cada 5 segundos
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <AlertCircle className="h-16 w-16 text-destructive" />
                <p className="text-sm text-destructive text-center">
                  Erro ao carregar QR Code
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  fetchQRCode();
                }}
                disabled={isLoadingQRCode}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingQRCode ? 'animate-spin' : ''}`} />
                Gerar novo QR Code
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={handleCloseQRCodeModal}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Edição de Perfil WhatsApp */}
      <Dialog open={isProfileEditModalOpen} onOpenChange={handleCloseProfileEditModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Editar Perfil do WhatsApp
            </DialogTitle>
            <DialogDescription>
              Atualize as informações do perfil da sua instância WhatsApp
            </DialogDescription>
          </DialogHeader>

          {isLoadingProfile ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando dados do perfil...</p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Foto do Perfil */}
              <div className="space-y-2">
                <Label htmlFor="profilePictureUrl" className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  URL da Foto do Perfil
                </Label>
                <Input
                  id="profilePictureUrl"
                  placeholder="https://exemplo.com/imagem.jpg"
                  value={profilePictureUrl}
                  onChange={(e) => setProfilePictureUrl(e.target.value)}
                  disabled={isSavingProfile}
                />
                <p className="text-xs text-muted-foreground">
                  Insira a URL de uma imagem pública (JPG, PNG)
                </p>
              </div>

              {/* Nome do Perfil */}
              <div className="space-y-2">
                <Label htmlFor="profileName" className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Nome do Perfil
                </Label>
                <Input
                  id="profileName"
                  placeholder="Nome exibido no WhatsApp"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  disabled={isSavingProfile}
                  maxLength={25}
                />
                <p className="text-xs text-muted-foreground">
                  Máximo de 25 caracteres
                </p>
              </div>

              {/* Descrição do Perfil */}
              <div className="space-y-2">
                <Label htmlFor="profileDescription" className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Recado / Status
                </Label>
                <Textarea
                  id="profileDescription"
                  placeholder="Seu recado ou status no WhatsApp"
                  value={profileDescription}
                  onChange={(e) => setProfileDescription(e.target.value)}
                  disabled={isSavingProfile}
                  rows={3}
                  maxLength={139}
                />
                <p className="text-xs text-muted-foreground">
                  Máximo de 139 caracteres
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCloseProfileEditModal} disabled={isSavingProfile || isLoadingProfile}>
              Cancelar
            </Button>
            <Button onClick={handleSaveProfile} disabled={isSavingProfile || isLoadingProfile}>
              {isSavingProfile ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Alterações'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Z-API Stats Modal */}
      <ZapiStatsModal
        open={isStatsModalOpen}
        onOpenChange={setIsStatsModalOpen}
        connectionId={statsConnectionId}
        connectionName={statsConnectionName}
      />
    </div>
  );
};

export default Connections;
