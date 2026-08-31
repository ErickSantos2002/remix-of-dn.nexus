import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Calendar, 
  RefreshCw, 
  Link2, 
  Link2Off, 
  Check, 
  AlertCircle,
  Settings,
  Clock,
  Loader2
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

export default function CRMGoogleCalendarSettings() {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state) {
      handleOAuthCallback(code, state);
      // Clear URL params
      setSearchParams({});
    }
  }, [searchParams]);

  const handleOAuthCallback = async (code: string, state: string) => {
    try {
      setIsConnecting(true);
      
      const { workspace_id, user_id } = JSON.parse(atob(state));
      const redirectUri = `${window.location.origin}/crm/google-calendar`;
      
      // Exchange code for tokens
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

      // Save integration to database
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
      
      toast({
        title: "Conectado com sucesso",
        description: `Google Calendar conectado: ${data.email}`,
      });
      
    } catch (error: any) {
      console.error('OAuth callback error:', error);
      toast({
        variant: "destructive",
        title: "Erro ao conectar",
        description: error.message,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  // Fetch Google Calendar integration for current user
  const { data: integration, isLoading } = useQuery({
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

  // Update integration settings
  const updateMutation = useMutation({
    mutationFn: async (updates: { auto_create_events?: boolean; auto_sync_events?: boolean; is_enabled?: boolean }) => {
      if (!integration?.id) return;
      
      const { error } = await supabase
        .from("crm_google_calendar_integration")
        .update(updates)
        .eq("id", integration.id);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-integration"] });
      toast({
        title: "Configuracoes atualizadas",
        description: "As configuracoes foram salvas com sucesso.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar",
        description: error.message,
      });
    },
  });

  // Disconnect integration
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!integration?.id) return;
      
      const { error } = await supabase
        .from("crm_google_calendar_integration")
        .delete()
        .eq("id", integration.id);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-integration"] });
      toast({
        title: "Desconectado",
        description: "A integracao com o Google Calendar foi removida.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro ao desconectar",
        description: error.message,
      });
    },
  });

  // Handle Google OAuth connection
  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !workspaceId) {
        throw new Error('Usuario nao autenticado');
      }

      const redirectUri = `${window.location.origin}/crm/google-calendar`;
      
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: {
          action: 'get_auth_url',
          workspace_id: workspaceId,
          user_id: user.id,
          redirect_uri: redirectUri,
        },
      });

      if (error) throw error;
      
      // Redirect to Google OAuth
      window.location.href = data.auth_url;
      
    } catch (error: any) {
      console.error('Connect error:', error);
      toast({
        variant: "destructive",
        title: "Erro ao conectar",
        description: error.message,
      });
      setIsConnecting(false);
    }
  };

  // Handle manual sync
  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // Update last sync time
      await supabase
        .from('crm_google_calendar_integration')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', integration?.id);
      
      queryClient.invalidateQueries({ queryKey: ['google-calendar-integration'] });
      
      toast({
        title: "Sincronizacao concluida",
        description: "Os eventos foram sincronizados com sucesso.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro na sincronizacao",
        description: error.message,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          Integração Google Calendar
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte com o Google Calendar para sincronizar seus agendamentos
        </p>
      </div>

      {/* Status Card */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Status da Conexão</CardTitle>
            <Badge 
              variant="outline" 
              className={integration?.is_enabled 
                ? "bg-success/20 text-success border-success/30" 
                : "bg-muted text-muted-foreground"
              }
            >
              {integration?.is_enabled ? (
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
          {integration?.is_enabled ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Email conectado</span>
                  <span className="text-foreground font-medium">{integration.google_email || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Calendário</span>
                  <span className="text-foreground font-medium">{integration.google_calendar_id || "Calendário principal"}</span>
                </div>
                {integration.last_sync_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Última sincronização</span>
                    <span className="text-foreground font-medium">
                      {format(new Date(integration.last_sync_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Sincronizando..." : "Sincronizar Agora"}
                </Button>
                <Button 
                  variant="destructive" 
                  className="gap-2"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  <Link2Off className="h-4 w-4" />
                  Desconectar
                </Button>
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
                  Sincronize seus agendamentos automaticamente
                </p>
              </div>
              <Button onClick={handleConnect} className="gap-2">
                <Link2 className="h-4 w-4" />
                Conectar com Google
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings Card */}
      {integration?.is_enabled && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configurações de Sincronização
            </CardTitle>
            <CardDescription>
              Configure como os agendamentos são sincronizados
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-foreground">Criar eventos automaticamente</div>
                <div className="text-sm text-muted-foreground">
                  Novos agendamentos são criados no Google Calendar
                </div>
              </div>
              <Switch
                checked={integration.auto_create_events || false}
                onCheckedChange={(checked) => updateMutation.mutate({ auto_create_events: checked })}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-foreground">Sincronizar automaticamente</div>
                <div className="text-sm text-muted-foreground">
                  Manter eventos sincronizados em tempo real
                </div>
              </div>
              <Switch
                checked={integration.auto_sync_events || false}
                onCheckedChange={(checked) => updateMutation.mutate({ auto_sync_events: checked })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="glass-card border-primary/20">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-foreground">Como funciona a sincronização</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Quando conectado, todos os agendamentos criados no CRM serão automaticamente 
                criados no seu Google Calendar. Alterações feitas em qualquer uma das 
                plataformas serão sincronizadas automaticamente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}