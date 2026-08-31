import { useEffect, useState } from "react";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { encryptToken } from "@/lib/crypto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Calendar,
  Check,
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  HelpCircle,
  ChevronRight,
} from "lucide-react";

type CompanyExt = Record<string, unknown>;

export function GoogleCalendarIntegrationCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const { toast } = useToast();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hasExistingSecret, setHasExistingSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [productionDomain, setProductionDomain] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!currentCompany) return;
    const c = currentCompany as unknown as CompanyExt;
    setClientId((c.google_client_id as string) || "");
    setEnabled(!!(c.google_oauth_enabled as boolean));
    setHasExistingSecret(!!(c.has_google_credentials as boolean));
    setClientSecret("");
    setShowSecret(false);
  }, [currentCompany]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectUri = `${origin}/crm/google-calendar`;

  const productionOrigin = productionDomain
    ? (productionDomain.startsWith("http") ? productionDomain : `https://${productionDomain}`)
    : "";
  const productionRedirectUri = productionOrigin ? `${productionOrigin}/crm/google-calendar` : "";

  const javascriptOrigins = [origin, productionOrigin].filter(Boolean);
  const redirectUris = [redirectUri, productionRedirectUri].filter(Boolean);

  const isActive = enabled && !!clientId && (hasExistingSecret || !!clientSecret);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copiado", description: label });
    } catch {
      toast({ title: "Erro", description: "Não foi possível copiar", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!currentCompany) return;

    if (enabled && !clientId.trim()) {
      toast({
        title: "Client ID obrigatório",
        description: "Informe o Client ID para ativar a integração.",
        variant: "destructive",
      });
      return;
    }
    if (enabled && !hasExistingSecret && !clientSecret.trim()) {
      toast({
        title: "Client Secret obrigatório",
        description: "Informe o Client Secret para ativar a integração.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        google_client_id: clientId.trim() || null,
        google_oauth_enabled: enabled,
      };

      if (clientSecret.trim()) {
        updates.google_client_secret = await encryptToken(
          clientSecret.trim(),
          currentCompany.id
        );
        updates.google_oauth_validated_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("companies")
        .update(updates as never)
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      setClientSecret("");
      setShowSecret(false);
      setHasExistingSecret(hasExistingSecret || !!updates.google_client_secret);

      toast({
        title: "Configurações salvas",
        description: "Credenciais do Google Calendar atualizadas.",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Falha ao salvar";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!currentCompany) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          google_client_id: null,
          google_client_secret: null,
          google_oauth_enabled: false,
          google_oauth_validated_at: null,
        } as never)
        .eq("id", currentCompany.id);

      if (error) throw error;

      await refetchCompanies();
      setClientId("");
      setClientSecret("");
      setEnabled(false);
      setHasExistingSecret(false);

      toast({
        title: "Credenciais removidas",
        description: "Integração Google Calendar desativada.",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Falha ao remover";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Integração Google Calendar
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-primary"
                  onClick={() => setShowGuide(true)}
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Como criar credenciais
                </Button>
              </div>
              <CardDescription className="mt-1">
                Cadastre as credenciais OAuth do Google Cloud da empresa para sincronizar agendamentos.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={
                isActive
                  ? "bg-success/15 text-success border-success/40"
                  : "bg-muted text-muted-foreground border-border"
              }
            >
              {isActive ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Ativo
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Inativo
                </>
              )}
            </Badge>
          </div>
        </CardHeader>

      <CardContent className="space-y-6">
        {/* URLs para configurar no Google Cloud Console */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">
              URLs para configurar no Google Cloud Console
            </h4>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir console <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            No Google Cloud Console, crie um <strong>OAuth Client ID</strong> tipo <strong>Web application</strong>,
            ative a API <strong>Google Calendar API</strong> e cole as URLs abaixo nos campos correspondentes.
          </p>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Domínio de produção (opcional)
            </Label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={productionDomain}
                onChange={(e) => setProductionDomain(e.target.value)}
                placeholder="ex: minhaempresa.com.br"
                disabled={isSaving}
                className="flex-1"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Informe o domínio de produção para gerar as URLs adicionais. Não inclua o protocolo (https://).
            </p>
          </div>

          <Separator className="my-2" />

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Authorized JavaScript origins
            </Label>
            {javascriptOrigins.map((url) => (
              <div key={url} className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs font-mono">
                  {url}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => copy(url, "Origin copiada")}
                  aria-label="Copiar origin"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Authorized redirect URIs
            </Label>
            {redirectUris
              .map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs font-mono">
                    {url}
                  </code>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => copy(url, "URI copiada")}
                    aria-label="Copiar URI"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
          </div>
        </div>

        <Separator />

        {/* Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="google-client-id">Client ID</Label>
            <Input
              id="google-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="000000000000-xxxxxxxxxxxx.apps.googleusercontent.com"
              disabled={isSaving}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="google-client-secret">
              Client Secret
              {hasExistingSecret && (
                <span className="ml-2 text-xs text-success">
                  (já configurado — preencha apenas para substituir)
                </span>
              )}
            </Label>
            <div className="flex gap-2">
              <Input
                id="google-client-secret"
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasExistingSecret ? "••••••••••••••••" : "GOCSPX-..."}
                disabled={isSaving}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? "Ocultar secret" : "Mostrar secret"}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Ativar integração</p>
              <p className="text-xs text-muted-foreground">
                Quando ativa, os usuários podem conectar suas contas do Google Calendar.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={isSaving} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving} className="flex-1">
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar credenciais
          </Button>
          {(hasExistingSecret || clientId) && (
            <Button
              variant="outline"
              onClick={handleRemove}
              disabled={isSaving}
              className="text-destructive hover:text-destructive"
              aria-label="Remover credenciais"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
      </Card>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              Como criar credenciais no Google Cloud Console
            </DialogTitle>
            <DialogDescription>
              Siga o passo a passo abaixo para gerar o Client ID e Client Secret
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            <ol className="space-y-5">
              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  1
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Acesse o Google Cloud Console
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Entre em{" "}
                    <a
                      href="https://console.cloud.google.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      console.cloud.google.com
                      <ExternalLink className="h-3 w-3" />
                    </a>{" "}
                    e faça login com sua conta Google.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  2
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Crie um projeto (ou use um existente)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    No seletor de projetos no topo da tela, clique em "Novo projeto" ou selecione um projeto já criado.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  3
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Ative a API do Google Calendar
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Vá para o menu{" "}
                    <strong>APIs e serviços &gt; Biblioteca</strong>. Pesquise por "Google Calendar API" e clique em "Ativar".
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  4
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Configure a tela de consentimento OAuth
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Acesse{" "}
                    <strong>APIs e serviços &gt; Tela de consentimento OAuth</strong>. Escolha o tipo de usuário (Externo ou Interno), preencha os dados obrigatórios (nome do app, email de suporte, domínio) e salve.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  5
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Adicione os escopos necessários
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Na tela de consentimento, vá até a aba{" "}
                    <strong>Escopos</strong> e adicione estes escopos de API do Google Calendar:
                  </p>
                  <div className="mt-2 rounded-md border border-border bg-muted/50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-foreground">
                        https://www.googleapis.com/auth/calendar
                      </code>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() =>
                          copy(
                            "https://www.googleapis.com/auth/calendar",
                            "Escopo copiado"
                          )
                        }
                        aria-label="Copiar escopo"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-foreground">
                        https://www.googleapis.com/auth/calendar.events
                      </code>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() =>
                          copy(
                            "https://www.googleapis.com/auth/calendar.events",
                            "Escopo copiado"
                          )
                        }
                        aria-label="Copiar escopo"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  6
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Crie as credenciais OAuth 2.1
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Vá para{" "}
                    <strong>APIs e serviços &gt; Credenciais</strong>. Clique em{" "}
                    <strong>Criar credenciais &gt; ID do cliente OAuth</strong>. Escolha o tipo{" "}
                    <strong>Aplicativo da Web</strong>.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  7
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Configure as URLs autorizadas
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Cole estas URLs nos campos correspondentes do formulário de credenciais:
                  </p>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                        Authorized JavaScript origins
                      </p>
                      {javascriptOrigins.map((url) => (
                        <div key={url} className="flex items-center gap-2">
                          <code className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono">
                            {url}
                          </code>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => copy(url, "Origin copiada")}
                            aria-label="Copiar origin"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                        Authorized redirect URIs
                      </p>
                      {redirectUris.map((url) => (
                        <div key={url} className="flex items-center gap-2">
                          <code className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 text-xs font-mono">
                            {url}
                          </code>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() => copy(url, "URI copiada")}
                            aria-label="Copiar URI"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                  8
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Copie o Client ID e Client Secret
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Após salvar, a tela mostrará o{" "}
                    <strong>Client ID</strong> e o <strong>Client Secret</strong>. Copie os dois valores e cole nos campos abaixo nesta página.
                  </p>
                </div>
              </li>
            </ol>

            <Separator />

            <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
              <div className="flex items-start gap-3">
                <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Dica importante
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Se for a primeira vez que configura o Google OAuth, talvez seja necessário publicar o aplicativo na tela de consentimento (botão "Publicar aplicativo"). Enquanto estiver em teste, adicione os emails dos usuários que farão login na lista de usuários de teste.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
