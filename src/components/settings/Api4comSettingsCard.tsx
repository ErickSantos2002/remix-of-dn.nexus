import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Phone, Save, Trash2, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Webhook, Zap } from "lucide-react";

interface Api4comSettingsCardProps {
  companyId: string;
  hasToken: boolean;
  initialDomain: string | null;
  initialIsActive: boolean;
  initialWebhookConfiguredAt: string | null;
  onSaved?: () => void;
}

export function Api4comSettingsCard({
  companyId,
  hasToken: initialHasToken,
  initialDomain,
  initialIsActive,
  initialWebhookConfiguredAt,
  onSaved,
}: Api4comSettingsCardProps) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [domain, setDomain] = useState(initialDomain || "");
  const [hasToken, setHasToken] = useState(initialHasToken);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [webhookAt, setWebhookAt] = useState<string | null>(initialWebhookConfiguredAt);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);

  useEffect(() => {
    setHasToken(initialHasToken);
    setDomain(initialDomain || "");
    setIsActive(initialIsActive);
    setWebhookAt(initialWebhookConfiguredAt);
    setToken("");
    setShowToken(false);
  }, [companyId, initialHasToken, initialDomain, initialIsActive, initialWebhookConfiguredAt]);

  const handleReveal = async () => {
    if (showToken) {
      setShowToken(false);
      setToken("");
      return;
    }
    if (!hasToken) return;
    try {
      const { data: encrypted, error } = await supabase.rpc(
        "get_company_secret_encrypted" as never,
        { p_company_id: companyId, p_field: "api4com_token_encrypted" } as never,
      );
      if (error || !encrypted) throw error ?? new Error("empty");
      const dec = await decryptToken(encrypted as string, companyId);
      setToken(dec);
      setShowToken(true);
    } catch {
      toast({ title: "Erro", description: "Falha ao revelar token (apenas o dono ou super admin pode revelar)", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!token.trim()) {
      toast({ title: "Erro", description: "Token é obrigatório", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const encrypted = await encryptToken(token.trim(), companyId);
      const { error } = await supabase.from("companies").update({
        api4com_token_encrypted: encrypted,
        api4com_domain: domain.trim() || null,
      } as never).eq("id", companyId);
      if (error) throw error;
      setHasToken(true);
      setToken("");
      setShowToken(false);
      toast({ title: "Sucesso", description: "Configuracao api4com salva" });
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao salvar";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-test-connection", {
        body: { company_id: companyId },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: "Conexao OK", description: "Token valido na api4com" });
      } else {
        toast({ title: "Falha na conexão", description: typeof data?.error === "string" ? data.error : JSON.stringify(data?.error || "erro"), variant: "destructive" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleConfigureWebhook = async () => {
    setIsConfiguring(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-configure-webhook", {
        body: { company_id: companyId },
      });
      if (error) throw error;
      if (data?.success) {
        setIsActive(true);
        setWebhookAt(new Date().toISOString());
        toast({ title: "Webhook configurado", description: `Gateway: ${data.gateway_id}` });
        onSaved?.();
      } else {
        toast({ title: "Falha ao configurar", description: typeof data?.error === "string" ? data.error : JSON.stringify(data?.error || "erro"), variant: "destructive" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsConfiguring(false);
    }
  };

  const handleRemove = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase.from("companies").update({
        api4com_token_encrypted: null,
        api4com_domain: null,
        api4com_webhook_secret: null,
        api4com_webhook_gateway_id: null,
        api4com_webhook_configured_at: null,
        api4com_is_active: false,
      } as never).eq("id", companyId);
      if (error) throw error;
      setHasToken(false);
      setToken("");
      setIsActive(false);
      setWebhookAt(null);
      toast({ title: "Removido", description: "Integração api4com desativada" });
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          Integração api4com
        </CardTitle>
        <CardDescription>
          Click-to-call no CRM com gravação, transcrição e análise de IA
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">Token</span>
            <span className={`flex items-center gap-1.5 text-sm ${hasToken ? "text-success" : "text-muted-foreground"}`}>
              {hasToken ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {hasToken ? "Salvo" : "Nao configurado"}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">Webhook</span>
            <span className={`flex items-center gap-1.5 text-sm ${isActive ? "text-success" : "text-muted-foreground"}`}>
              {isActive ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {isActive ? "Ativo" : "Pendente"}
            </span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="api4com-token">Token Bearer</Label>
          <div className="flex gap-2">
            <Input
              id="api4com-token"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? "Token salvo (clique no olho para revelar)" : "Cole o token Bearer da api4com"}
              disabled={isSaving}
            />
            {hasToken && (
              <Button variant="outline" size="icon" onClick={handleReveal} disabled={isSaving}>
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Encontre em https://app.api4com.com em Configuracoes &gt; API. Sera criptografado.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api4com-domain">Domínio SIP (opcional)</Label>
          <Input
            id="api4com-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="ex: minhaempresa"
            disabled={isSaving}
          />
          <p className="text-xs text-muted-foreground">
            Identificador SIP da sua conta api4com (opcional, usado em integrações futuras). O webphone fica em https://app.api4com.com.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={isSaving || !token.trim() || showToken} className="flex-1 min-w-[140px]">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {hasToken ? "Atualizar" : "Salvar"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={isTesting || !hasToken}>
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Testar
          </Button>
          <Button variant="outline" onClick={handleConfigureWebhook} disabled={isConfiguring || !hasToken}>
            {isConfiguring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Webhook className="h-4 w-4 mr-2" />}
            {isActive ? "Reconfigurar webhook" : "Configurar webhook"}
          </Button>
          {hasToken && (
            <Button variant="outline" onClick={handleRemove} disabled={isSaving} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {webhookAt && (
          <p className="text-xs text-muted-foreground">
            Webhook configurado em {new Date(webhookAt).toLocaleString("pt-BR")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
