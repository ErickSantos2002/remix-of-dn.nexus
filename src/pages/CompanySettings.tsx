import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompany } from "@/contexts/CompanyContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, Building2, Trash2, Save, Calendar, Users, Shield, Eye, EyeOff, CheckCircle2, AlertCircle, BarChart3, Key, Video, Brain, Plug, LineChart, Kanban, ClipboardCheck } from "lucide-react";
import { MeetingAnalysisPromptsCard } from "@/components/settings/MeetingAnalysisPromptsCard";
import { LeadSourcesCard } from "@/components/settings/LeadSourcesCard";
import { LossReasonsCard } from "@/components/settings/LossReasonsCard";
import { PainsCard } from "@/components/settings/PainsCard";
import { ObjectionsCard } from "@/components/settings/ObjectionsCard";
import { SegmentsCard } from "@/components/settings/SegmentsCard";
import { AnalysisPlaybooksCard } from "@/components/settings/AnalysisPlaybooksCard";

import { CallAnalysisPromptCard } from "@/components/settings/CallAnalysisPromptCard";
import { Api4comSettingsCard } from "@/components/settings/Api4comSettingsCard";
import { DnMarketingSettingsCard } from "@/components/settings/DnMarketingSettingsCard";
import { GoogleCalendarIntegrationCard } from "@/components/settings/GoogleCalendarIntegrationCard";
import { OpenAIIntegrationCard } from "@/components/settings/OpenAIIntegrationCard";
import { GeminiIntegrationCard } from "@/components/settings/GeminiIntegrationCard";
import { ResendIntegrationCard } from "@/components/settings/ResendIntegrationCard";
import { SendingWindowCard } from "@/components/settings/SendingWindowCard";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const COMPANY_ICONS = ["Building2", "Briefcase", "Globe", "Target", "Rocket", "Star", "Zap", "Shield"];

export default function CompanySettings() {
  const { currentCompany, companies, setCompanyId, refetchCompanies, isOwner, isAdmin } = useCompany();
  const { isSuperAdmin } = useUserRole();
  const { toast } = useToast();

  // Aba na URL: permite link direto para uma secao e sobrevive ao reload
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "empresa";
  const handleTabChange = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };
  
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [zapiAccountToken, setZapiAccountToken] = useState("");
  const [showZapiToken, setShowZapiToken] = useState(false);
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [metaPixelId, setMetaPixelId] = useState("");
  const [isSavingPixel, setIsSavingPixel] = useState(false);
  const [hasExistingPixel, setHasExistingPixel] = useState(false);
  const [clarityProjectId, setClarityProjectId] = useState("");
  const [isSavingClarity, setIsSavingClarity] = useState(false);
  const [hasExistingClarity, setHasExistingClarity] = useState(false);
  const [gtmContainerId, setGtmContainerId] = useState("");
  const [isSavingGtm, setIsSavingGtm] = useState(false);
  const [hasExistingGtm, setHasExistingGtm] = useState(false);
  const [googleAdsSendTo, setGoogleAdsSendTo] = useState("");
  const [isSavingGoogleAds, setIsSavingGoogleAds] = useState(false);
  const [hasExistingGoogleAds, setHasExistingGoogleAds] = useState(false);

  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [isSavingMetaToken, setIsSavingMetaToken] = useState(false);
  const [hasExistingMetaToken, setHasExistingMetaToken] = useState(false);
  const [dailyApiKey, setDailyApiKey] = useState("");
  const [showDailyKey, setShowDailyKey] = useState(false);
  const [isSavingDailyKey, setIsSavingDailyKey] = useState(false);
  const [hasExistingDailyKey, setHasExistingDailyKey] = useState(false);

  useEffect(() => {
    if (currentCompany) {
      setName(currentCompany.name);
      setIcon(currentCompany.icon || "");
      setDescription(currentCompany.description || "");
      setHasExistingToken(!!currentCompany.zapi_account_token);
      setZapiAccountToken("");
      setShowZapiToken(false);
      // Meta Pixel
      const pixelId = (currentCompany as unknown as Record<string, unknown>).meta_pixel_id as string | null;
      setHasExistingPixel(!!pixelId);
      setMetaPixelId(pixelId || "");
      // Microsoft Clarity
      const clarityId = (currentCompany as unknown as Record<string, unknown>).clarity_project_id as string | null;
      setHasExistingClarity(!!clarityId);
      setClarityProjectId(clarityId || "");
      // Google Tag Manager
      const gtmId = (currentCompany as unknown as Record<string, unknown>).gtm_container_id as string | null;
      setHasExistingGtm(!!gtmId);
      setGtmContainerId(gtmId || "");
      // Google Ads (conversão)
      const gadsSendTo = (currentCompany as unknown as Record<string, unknown>).google_ads_send_to as string | null;
      setHasExistingGoogleAds(!!gadsSendTo);
      setGoogleAdsSendTo(gadsSendTo || "");
      // Meta Access Token (existence flag only — secret value is server-side)
      const hasMeta = (currentCompany as unknown as Record<string, unknown>).has_meta_access_token as boolean | null;
      setHasExistingMetaToken(!!hasMeta);

      setMetaAccessToken("");
      setShowMetaToken(false);
      // Daily.co (existence flag only)
      const hasDaily = (currentCompany as unknown as Record<string, unknown>).has_daily_api_key as boolean | null;
      setHasExistingDailyKey(!!hasDaily);
      setDailyApiKey("");
      setShowDailyKey(false);
      fetchMemberCount();
    }
  }, [currentCompany]);

  const fetchMemberCount = async () => {
    if (!currentCompany) return;
    
    const { count } = await supabase
      .from("company_members")
      .select("*", { count: "exact", head: true })
      .eq("company_id", currentCompany.id)
      .eq("status", "active");
    
    setMemberCount((count || 0) + 1); // +1 para incluir o owner
  };

  const handleSave = async () => {
    if (!currentCompany || !name.trim()) {
      toast({
        title: "Erro",
        description: "Nome da empresa é obrigatório",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          name: name.trim(),
          icon: icon || null,
          description: description.trim() || null,
        })
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      toast({
        title: "Sucesso",
        description: "Empresa atualizada com sucesso",
      });
    } catch (error: unknown) {
      console.error("Erro ao atualizar empresa:", error);
      toast({
        title: "Erro",
        description: (error instanceof Error ? error.message : null) || "Falha ao atualizar empresa",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveZapiToken = async () => {
    if (!currentCompany || !zapiAccountToken.trim()) {
      toast({
        title: "Erro",
        description: "Token de segurança e obrigatório",
        variant: "destructive",
      });
      return;
    }

    setIsSavingToken(true);
    try {
      const encrypted = await encryptToken(zapiAccountToken.trim(), currentCompany.id);

      const { error } = await supabase
        .from("companies")
        .update({ zapi_account_token: encrypted })
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      setZapiAccountToken("");
      setShowZapiToken(false);
      setHasExistingToken(true);
      toast({
        title: "Sucesso",
        description: "Token Z-API salvo com sucesso",
      });
    } catch (error: unknown) {
      console.error("Erro ao salvar token Z-API:", error);
      toast({
        title: "Erro",
        description: (error instanceof Error ? error.message : null) || "Falha ao salvar token Z-API",
        variant: "destructive",
      });
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleRevealZapiToken = async () => {
    if (!currentCompany?.zapi_account_token) return;

    if (showZapiToken) {
      setShowZapiToken(false);
      setZapiAccountToken("");
      return;
    }

    try {
      const decrypted = await decryptToken(
        currentCompany.zapi_account_token,
        currentCompany.id
      );
      setZapiAccountToken(decrypted);
      setShowZapiToken(true);
    } catch (error) {
      console.error("Erro ao descriptografar token:", error);
      toast({
        title: "Erro",
        description: "Falha ao descriptografar token",
        variant: "destructive",
      });
    }
  };

  const handleRemoveZapiToken = async () => {
    if (!currentCompany) return;

    setIsSavingToken(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          zapi_account_token: null,
          zapi_token_status: null,
          zapi_token_validated_at: null,
        })
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      setZapiAccountToken("");
      setShowZapiToken(false);
      setHasExistingToken(false);
      toast({
        title: "Sucesso",
        description: "Token Z-API removido",
      });
    } catch (error: unknown) {
      console.error("Erro ao remover token Z-API:", error);
      toast({
        title: "Erro",
        description: (error instanceof Error ? error.message : null) || "Falha ao remover token Z-API",
        variant: "destructive",
      });
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleDelete = async () => {
    if (!currentCompany) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("companies")
        .delete()
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      
      // Selecionar outra empresa se existir
      const remainingCompanies = companies.filter((c) => c.id !== currentCompany.id);
      if (remainingCompanies.length > 0) {
        setCompanyId(remainingCompanies[0].id);
      }

      toast({
        title: "Sucesso",
        description: "Empresa excluída com sucesso",
      });
    } catch (error: unknown) {
      console.error("Erro ao excluir empresa:", error);
      toast({
        title: "Erro",
        description: (error instanceof Error ? error.message : null) || "Falha ao excluir empresa",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!currentCompany) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">Selecione uma empresa</p>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          Configurações da Empresa
        </h1>
        <p className="text-muted-foreground">
          Gerencie as configurações da sua empresa
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        {/* Barra fixa: a pagina e longa, e perder a navegacao ao rolar custa caro */}
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/80 backdrop-blur-sm border-b border-border/50">
          <TabsList>
            <TabsTrigger value="empresa" className="gap-2 py-2">
              <Building2 className="h-4 w-4" />
              <span className="truncate">Empresa</span>
            </TabsTrigger>
            <TabsTrigger value="integrações" className="gap-2 py-2">
              <Plug className="h-4 w-4" />
              <span className="truncate">Integrações</span>
            </TabsTrigger>
            <TabsTrigger value="rastreamento" className="gap-2 py-2">
              <LineChart className="h-4 w-4" />
              <span className="truncate">Rastreamento</span>
            </TabsTrigger>
            <TabsTrigger value="crm" className="gap-2 py-2">
              <Kanban className="h-4 w-4" />
              <span className="truncate">CRM</span>
            </TabsTrigger>
            <TabsTrigger value="analises" className="gap-2 py-2">
              <ClipboardCheck className="h-4 w-4" />
              <span className="truncate">Análises</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="empresa" className="mt-6">
          <div className="columns-1 xl:columns-2 xl:gap-6 [&>*]:mb-6 [&>*]:break-inside-avoid">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Informações Gerais</CardTitle>
                <CardDescription>
                  Dados basicos da empresa
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome da Empresa</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome da empresa"
                    disabled={!isOwner}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Ícone</Label>
                  <div className="flex flex-wrap gap-2">
                    {COMPANY_ICONS.map((iconName) => (
                      <Button
                        key={iconName}
                        variant={icon === iconName ? "default" : "outline"}
                        size="sm"
                        onClick={() => setIcon(iconName)}
                        disabled={!isOwner}
                        className="w-10 h-10 p-0"
                      >
                        {iconName.charAt(0)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição da empresa (opcional)"
                    rows={3}
                    disabled={!isOwner}
                  />
                </div>

                {isOwner && (
                  <Button onClick={handleSave} disabled={isLoading} className="w-full">
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Salvar Alterações
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Informações do Sistema</CardTitle>
                <CardDescription>
                  Dados de sistema da empresa
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Data de Criação</span>
                  </div>
                  <span className="text-foreground font-mono text-sm">
                    {currentCompany.created_at
                      ? format(new Date(currentCompany.created_at), "dd/MM/yyyy", { locale: ptBR })
                      : "-"}
                  </span>
                </div>

                <Separator />

                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>Total de Membros</span>
                  </div>
                  <span className="text-foreground font-mono text-sm">
                    {memberCount}
                  </span>
                </div>
              </CardContent>
            </Card>

            {(isOwner || isAdmin || isSuperAdmin) && <SendingWindowCard />}

            {isOwner && companies.length > 1 && (
              <Card className="glass-card border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-destructive">Zona de Perigo</CardTitle>
                  <CardDescription>
                    Ações irreversíveis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir Empresa
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação não pode ser desfeita. Todos os workspaces, agentes, leads e
                          dados associados serão permanentemente excluídos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          disabled={isDeleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            )}

          </div>
        </TabsContent>

        <TabsContent value="integrações" className="mt-6">
          <div className="columns-1 xl:columns-2 xl:gap-6 [&>*]:mb-6 [&>*]:break-inside-avoid">
            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Integração Z-API</CardTitle>
                  <CardDescription>
                    Token de segurança da conta Z-API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Shield className="h-4 w-4" />
                      <span>Token</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingToken ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingToken ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingToken ? "Salvo" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="zapi-token">Token de Segurança da Conta</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="zapi-token"
                          type={showZapiToken ? "text" : "password"}
                          value={zapiAccountToken}
                          onChange={(e) => setZapiAccountToken(e.target.value)}
                          placeholder={hasExistingToken ? "Token salvo (clique no olho para revelar)" : "Cole o token de segurança da conta"}
                          disabled={isSavingToken}
                        />
                      </div>
                      {hasExistingToken && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleRevealZapiToken}
                          disabled={isSavingToken}
                          title={showZapiToken ? "Ocultar token" : "Revelar token"}
                        >
                          {showZapiToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Este token é encontrado no painel da Z-API em Segurança da Conta. Ele será criptografado antes de ser salvo.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveZapiToken}
                      disabled={isSavingToken || !zapiAccountToken.trim() || showZapiToken}
                      className="flex-1"
                    >
                      {isSavingToken ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingToken ? "Atualizar Token" : "Salvar Token"}
                    </Button>
                    {hasExistingToken && (
                      <Button
                        variant="outline"
                        onClick={handleRemoveZapiToken}
                        disabled={isSavingToken}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {(isOwner || isAdmin || isSuperAdmin) && <GoogleCalendarIntegrationCard />}

            {(isOwner || isAdmin || isSuperAdmin) && <OpenAIIntegrationCard />}

            {(isOwner || isAdmin || isSuperAdmin) && <GeminiIntegrationCard />}

            {(isOwner || isAdmin || isSuperAdmin) && <ResendIntegrationCard />}

            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="h-5 w-5 text-primary" />
                    Daily.co (Reuniões Online)
                  </CardTitle>
                  <CardDescription>
                    API Key para criar salas de videoconferência integradas ao CRM
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Video className="h-4 w-4" />
                      <span>API Key</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingDailyKey ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingDailyKey ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingDailyKey ? "Configurado" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="daily-api-key">Daily.co API Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="daily-api-key"
                          type={showDailyKey ? "text" : "password"}
                          value={dailyApiKey}
                          onChange={(e) => setDailyApiKey(e.target.value)}
                          placeholder={hasExistingDailyKey ? "API Key salva (clique no olho para revelar)" : "Cole a API Key do Daily.co"}
                          disabled={isSavingDailyKey}
                        />
                      </div>
                      {hasExistingDailyKey && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={async () => {
                            if (!currentCompany) return;
                            if (showDailyKey) {
                              setShowDailyKey(false);
                              setDailyApiKey("");
                              return;
                            }
                            try {
                              const { data: encrypted, error } = await supabase.rpc(
                                "get_company_secret_encrypted" as never,
                                { p_company_id: currentCompany.id, p_field: "daily_api_key" } as never,
                              );
                              if (error || !encrypted) throw error ?? new Error("empty");
                              const decrypted = await decryptToken(encrypted as string, currentCompany.id);
                              setDailyApiKey(decrypted);
                              setShowDailyKey(true);
                            } catch {
                              toast({ title: "Erro", description: "Falha ao revelar a API Key (apenas o dono ou super admin pode revelar)", variant: "destructive" });
                            }
                          }}
                          disabled={isSavingDailyKey}
                          title={showDailyKey ? "Ocultar" : "Revelar"}
                        >
                          {showDailyKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Encontre a API Key no painel do Daily.co em Developers. Será criptografada antes de salvar.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany || !dailyApiKey.trim()) {
                          toast({ title: "Erro", description: "API Key e obrigatória", variant: "destructive" });
                          return;
                        }
                        setIsSavingDailyKey(true);
                        try {
                          const encrypted = await encryptToken(dailyApiKey.trim(), currentCompany.id);
                          const { error } = await supabase
                            .from("companies")
                            .update({ daily_api_key: encrypted } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setDailyApiKey("");
                          setShowDailyKey(false);
                          setHasExistingDailyKey(true);
                          toast({ title: "Sucesso", description: "API Key Daily.co salva com sucesso" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingDailyKey(false);
                        }
                      }}
                      disabled={isSavingDailyKey || !dailyApiKey.trim() || showDailyKey}
                      className="flex-1"
                    >
                      {isSavingDailyKey ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingDailyKey ? "Atualizar API Key" : "Salvar API Key"}
                    </Button>
                    {hasExistingDailyKey && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingDailyKey(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ daily_api_key: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setDailyApiKey("");
                            setShowDailyKey(false);
                            setHasExistingDailyKey(false);
                            toast({ title: "Sucesso", description: "API Key Daily.co removida" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingDailyKey(false);
                          }
                        }}
                        disabled={isSavingDailyKey}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* api4com */}
            {(isOwner || isSuperAdmin) && (
              <Api4comSettingsCard
                companyId={currentCompany.id}
                hasToken={!!(currentCompany as unknown as Record<string, boolean>).has_api4com_token}
                initialDomain={(currentCompany as unknown as Record<string, string | null>).api4com_domain ?? null}
                initialIsActive={!!(currentCompany as unknown as Record<string, boolean>).api4com_is_active}
                initialWebhookConfiguredAt={(currentCompany as unknown as Record<string, string | null>).api4com_webhook_configured_at ?? null}
                onSaved={refetchCompanies}
              />
            )}

            {/* dn.marketing */}
            {(isOwner || isAdmin || isSuperAdmin) && (
              <DnMarketingSettingsCard
                companyId={currentCompany.id}
                hasToken={!!(currentCompany as unknown as Record<string, boolean>).has_dnmarketing_token}
                initialBaseUrl={(currentCompany as unknown as Record<string, string | null>).dnmarketing_base_url ?? null}
                initialIsActive={!!(currentCompany as unknown as Record<string, boolean>).dnmarketing_is_active}
                initialValidatedAt={(currentCompany as unknown as Record<string, string | null>).dnmarketing_validated_at ?? null}
                onSaved={refetchCompanies}
              />
            )}

          </div>
        </TabsContent>

        <TabsContent value="rastreamento" className="mt-6">
          <div className="columns-1 xl:columns-2 xl:gap-6 [&>*]:mb-6 [&>*]:break-inside-avoid">
            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Meta Pixel
                  </CardTitle>
                  <CardDescription>
                    Rastreie o comportamento dos leads do Chat Widget com o Meta Pixel (Facebook Pixel)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BarChart3 className="h-4 w-4" />
                      <span>Pixel ID</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingPixel ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingPixel ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingPixel ? "Configurado" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="meta-pixel-id">Meta Pixel ID</Label>
                    <Input
                      id="meta-pixel-id"
                      value={metaPixelId}
                      onChange={(e) => setMetaPixelId(e.target.value)}
                      placeholder="Ex: 1234567890"
                      disabled={isSavingPixel}
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontre o Pixel ID no Meta Events Manager. Eventos disparados: PageView, MQL (Lead Score &gt;= 22) e Agendamento.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany) return;
                        setIsSavingPixel(true);
                        try {
                          const { error } = await supabase
                            .from("companies")
                            .update({ meta_pixel_id: metaPixelId.trim() || null } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setHasExistingPixel(!!metaPixelId.trim());
                          toast({ title: "Sucesso", description: metaPixelId.trim() ? "Meta Pixel ID salvo" : "Meta Pixel ID removido" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingPixel(false);
                        }
                      }}
                      disabled={isSavingPixel}
                      className="flex-1"
                    >
                      {isSavingPixel ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingPixel ? "Atualizar Pixel ID" : "Salvar Pixel ID"}
                    </Button>
                    {hasExistingPixel && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingPixel(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ meta_pixel_id: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setMetaPixelId("");
                            setHasExistingPixel(false);
                            toast({ title: "Sucesso", description: "Meta Pixel ID removido" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingPixel(false);
                          }
                        }}
                        disabled={isSavingPixel}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <Separator />

                  {/* Meta Conversions API Access Token */}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Key className="h-4 w-4" />
                      <span>Conversions API Token</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingMetaToken ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingMetaToken ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingMetaToken ? "Salvo" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="meta-token">Access Token (System User Token)</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="meta-token"
                          type={showMetaToken ? "text" : "password"}
                          value={metaAccessToken}
                          onChange={(e) => setMetaAccessToken(e.target.value)}
                          placeholder={hasExistingMetaToken ? "Token salvo (clique no olho para revelar)" : "Cole o Access Token da Meta"}
                          disabled={isSavingMetaToken}
                        />
                      </div>
                      {hasExistingMetaToken && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={async () => {
                            if (!currentCompany) return;
                            const metaToken = (currentCompany as unknown as Record<string, unknown>).meta_access_token as string | null;
                            if (!metaToken) return;
                            if (showMetaToken) {
                              setShowMetaToken(false);
                              setMetaAccessToken("");
                              return;
                            }
                            try {
                              const decrypted = await decryptToken(metaToken, currentCompany.id);
                              setMetaAccessToken(decrypted);
                              setShowMetaToken(true);
                            } catch {
                              toast({ title: "Erro", description: "Falha ao descriptografar token", variant: "destructive" });
                            }
                          }}
                          disabled={isSavingMetaToken}
                          title={showMetaToken ? "Ocultar token" : "Revelar token"}
                        >
                          {showMetaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Token de System User gerado no Meta Business Manager com permissão ads_management. Será criptografado antes de salvar.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany || !metaAccessToken.trim()) {
                          toast({ title: "Erro", description: "Token e obrigatório", variant: "destructive" });
                          return;
                        }
                        setIsSavingMetaToken(true);
                        try {
                          const encrypted = await encryptToken(metaAccessToken.trim(), currentCompany.id);
                          const { error } = await supabase
                            .from("companies")
                            .update({ meta_access_token: encrypted } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setMetaAccessToken("");
                          setShowMetaToken(false);
                          setHasExistingMetaToken(true);
                          toast({ title: "Sucesso", description: "Meta Access Token salvo com sucesso" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingMetaToken(false);
                        }
                      }}
                      disabled={isSavingMetaToken || !metaAccessToken.trim() || showMetaToken}
                      className="flex-1"
                    >
                      {isSavingMetaToken ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingMetaToken ? "Atualizar Token" : "Salvar Token"}
                    </Button>
                    {hasExistingMetaToken && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingMetaToken(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ meta_access_token: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setMetaAccessToken("");
                            setShowMetaToken(false);
                            setHasExistingMetaToken(false);
                            toast({ title: "Sucesso", description: "Meta Access Token removido" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingMetaToken(false);
                          }
                        }}
                        disabled={isSavingMetaToken}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Google Tag Manager
                  </CardTitle>
                  <CardDescription>
                    Injete o container do GTM nas páginas públicas dos widgets de Chat e Agendamento
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BarChart3 className="h-4 w-4" />
                      <span>Container ID</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingGtm ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingGtm ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingGtm ? "Configurado" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="gtm-container-id">GTM Container ID</Label>
                    <Input
                      id="gtm-container-id"
                      value={gtmContainerId}
                      onChange={(e) => setGtmContainerId(e.target.value)}
                      placeholder="Ex: GTM-XXXXXXX"
                      disabled={isSavingGtm}
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontre o Container ID em tagmanager.google.com. O container será carregado automaticamente nas páginas públicas dos widgets desta empresa.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany) return;
                        const trimmed = gtmContainerId.trim();
                        if (trimmed && !/^GTM-[A-Z0-9]+$/i.test(trimmed)) {
                          toast({ title: "Formato inválido", description: "O ID deve começar com GTM- (ex: GTM-XXXXXXX)", variant: "destructive" });
                          return;
                        }
                        setIsSavingGtm(true);
                        try {
                          const { error } = await supabase
                            .from("companies")
                            .update({ gtm_container_id: trimmed || null } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setHasExistingGtm(!!trimmed);
                          toast({ title: "Sucesso", description: trimmed ? "GTM Container ID salvo" : "GTM Container ID removido" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingGtm(false);
                        }
                      }}
                      disabled={isSavingGtm}
                      className="flex-1"
                    >
                      {isSavingGtm ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingGtm ? "Atualizar Container ID" : "Salvar Container ID"}
                    </Button>
                    {hasExistingGtm && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingGtm(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ gtm_container_id: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setGtmContainerId("");
                            setHasExistingGtm(false);
                            toast({ title: "Sucesso", description: "GTM Container ID removido" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingGtm(false);
                          }
                        }}
                        disabled={isSavingGtm}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Google Ads
                  </CardTitle>
                  <CardDescription>
                    Dispare conversões do Google Ads nos widgets de Chat e Agendamento (eventos MQL e Agendamento)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BarChart3 className="h-4 w-4" />
                      <span>Rótulo de conversão</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingGoogleAds ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingGoogleAds ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingGoogleAds ? "Configurado" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="google-ads-send-to">send_to (AW-XXXXXXX/LABEL)</Label>
                    <Input
                      id="google-ads-send-to"
                      value={googleAdsSendTo}
                      onChange={(e) => setGoogleAdsSendTo(e.target.value)}
                      placeholder="Ex: AW-1234567890/AbCdEfGhIj"
                      disabled={isSavingGoogleAds}
                    />
                    <p className="text-xs text-muted-foreground">
                      Cole aqui o valor de <span className="font-mono">send_to</span> gerado no Google Ads (ID da conta + rótulo de conversão). Serão disparados os eventos MQL e Agendamento, iguais aos do Meta Pixel.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany) return;
                        const trimmed = googleAdsSendTo.trim();
                        if (trimmed && !/^AW-[A-Z0-9]+\/[A-Za-z0-9_-]+$/i.test(trimmed)) {
                          toast({ title: "Formato inválido", description: "Use o formato AW-XXXXXXX/LABEL", variant: "destructive" });
                          return;
                        }
                        setIsSavingGoogleAds(true);
                        try {
                          const { error } = await supabase
                            .from("companies")
                            .update({ google_ads_send_to: trimmed || null } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setHasExistingGoogleAds(!!trimmed);
                          toast({ title: "Sucesso", description: trimmed ? "Rótulo de conversão salvo" : "Rótulo de conversão removido" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingGoogleAds(false);
                        }
                      }}
                      disabled={isSavingGoogleAds}
                      className="flex-1"
                    >
                      {isSavingGoogleAds ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingGoogleAds ? "Atualizar rótulo" : "Salvar rótulo"}
                    </Button>
                    {hasExistingGoogleAds && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingGoogleAds(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ google_ads_send_to: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setGoogleAdsSendTo("");
                            setHasExistingGoogleAds(false);
                            toast({ title: "Sucesso", description: "Rótulo de conversão removido" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingGoogleAds(false);
                          }
                        }}
                        disabled={isSavingGoogleAds}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {(isOwner || isSuperAdmin) && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Microsoft Clarity
                  </CardTitle>
                  <CardDescription>
                    Grave sessões e rastreie eventos dos widgets de Chat e Agendamento com o Microsoft Clarity
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <BarChart3 className="h-4 w-4" />
                      <span>Project ID</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasExistingClarity ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-sm ${hasExistingClarity ? "text-success" : "text-muted-foreground"}`}>
                        {hasExistingClarity ? "Configurado" : "Não configurado"}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="clarity-project-id">Clarity Project ID</Label>
                    <Input
                      id="clarity-project-id"
                      value={clarityProjectId}
                      onChange={(e) => setClarityProjectId(e.target.value)}
                      placeholder="Ex: abcd1234ef"
                      disabled={isSavingClarity}
                    />
                    <p className="text-xs text-muted-foreground">
                      Encontre o Project ID em clarity.microsoft.com → Settings → Setup. Os mesmos eventos do Meta Pixel são enviados ao Clarity (PageView, Lead, CompleteRegistration, Leads Qualificados, Schedule, Agendamento).
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (!currentCompany) return;
                        setIsSavingClarity(true);
                        try {
                          const { error } = await supabase
                            .from("companies")
                            .update({ clarity_project_id: clarityProjectId.trim() || null } as Record<string, unknown>)
                            .eq("id", currentCompany.id);
                          if (error) throw error;
                          await refetchCompanies();
                          setHasExistingClarity(!!clarityProjectId.trim());
                          toast({ title: "Sucesso", description: clarityProjectId.trim() ? "Clarity Project ID salvo" : "Clarity Project ID removido" });
                        } catch (error: unknown) {
                          const msg = error instanceof Error ? error.message : "Falha ao salvar";
                          toast({ title: "Erro", description: msg, variant: "destructive" });
                        } finally {
                          setIsSavingClarity(false);
                        }
                      }}
                      disabled={isSavingClarity}
                      className="flex-1"
                    >
                      {isSavingClarity ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      {hasExistingClarity ? "Atualizar Project ID" : "Salvar Project ID"}
                    </Button>
                    {hasExistingClarity && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (!currentCompany) return;
                          setIsSavingClarity(true);
                          try {
                            const { error } = await supabase
                              .from("companies")
                              .update({ clarity_project_id: null } as Record<string, unknown>)
                              .eq("id", currentCompany.id);
                            if (error) throw error;
                            await refetchCompanies();
                            setClarityProjectId("");
                            setHasExistingClarity(false);
                            toast({ title: "Sucesso", description: "Clarity Project ID removido" });
                          } catch (error: unknown) {
                            const msg = error instanceof Error ? error.message : "Falha ao remover";
                            toast({ title: "Erro", description: msg, variant: "destructive" });
                          } finally {
                            setIsSavingClarity(false);
                          }
                        }}
                        disabled={isSavingClarity}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        </TabsContent>

        <TabsContent value="crm" className="mt-6">
          <div className="columns-1 xl:columns-2 xl:gap-6 [&>*]:mb-6 [&>*]:break-inside-avoid">
            {/* Origens do Lead */}
            {(isOwner || isAdmin || isSuperAdmin) && (
              <LeadSourcesCard companyId={currentCompany.id} />
            )}

            {/* Motivos de Perda */}
            {(isOwner || isAdmin || isSuperAdmin) && <LossReasonsCard />}

            {/* Dores */}
            {(isOwner || isAdmin || isSuperAdmin) && <PainsCard />}

            {/* Objeções */}
            {(isOwner || isAdmin || isSuperAdmin) && <ObjectionsCard />}

            {/* Segmentos */}
            {(isOwner || isAdmin || isSuperAdmin) && <SegmentsCard />}

          </div>
        </TabsContent>

        <TabsContent value="analises" className="mt-6">
          <div className="space-y-6">
            {/* Configuração principal: ocupa a largura inteira */}
            {(isOwner || isAdmin || isSuperAdmin) && (
              <AnalysisPlaybooksCard companyId={currentCompany.id} />
            )}

            {/* Prompts genéricos: só valem quando a reunião não tem análise
                vinculada. Ficam lado a lado e subordinados ao bloco acima. */}
            {(isOwner || isSuperAdmin) && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-foreground">Análise geral (sem playbook)</h2>
                  <p className="text-xs text-muted-foreground">
                    Usada quando o atendimento não tem uma análise de playbook vinculada.
                  </p>
                </div>
                <div className="grid gap-6 xl:grid-cols-2 items-start">
                  <MeetingAnalysisPromptsCard companyId={currentCompany.id} />
                  <CallAnalysisPromptCard companyId={currentCompany.id} />
                </div>
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
