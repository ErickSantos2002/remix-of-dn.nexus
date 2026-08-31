import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Megaphone, Save, Trash2, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Zap } from "lucide-react";

interface DnMarketingSettingsCardProps {
  companyId: string;
  hasToken: boolean;
  initialBaseUrl: string | null;
  initialIsActive: boolean;
  initialValidatedAt: string | null;
  onSaved?: () => void;
}

export function DnMarketingSettingsCard({
  companyId,
  hasToken: initialHasToken,
  initialBaseUrl,
  initialIsActive,
  initialValidatedAt,
  onSaved,
}: DnMarketingSettingsCardProps) {
  const { toast } = useToast();
  const { isAdmin, isOwner } = useCompany() as unknown as { isAdmin: boolean; isOwner: boolean };
  const canEdit = isAdmin || isOwner;

  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl || "");
  const [hasToken, setHasToken] = useState(initialHasToken);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [validatedAt, setValidatedAt] = useState<string | null>(initialValidatedAt);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    setHasToken(initialHasToken);
    setBaseUrl(initialBaseUrl || "");
    setIsActive(initialIsActive);
    setValidatedAt(initialValidatedAt);
    setToken("");
    setShowToken(false);
  }, [companyId, initialHasToken, initialBaseUrl, initialIsActive, initialValidatedAt]);

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
        { p_company_id: companyId, p_field: "dnmarketing_token_encrypted" } as never,
      );
      if (error || !encrypted) throw error ?? new Error("empty");
      const dec = await decryptToken(encrypted as string, companyId);
      setToken(dec);
      setShowToken(true);
    } catch {
      toast({ title: "Erro", description: "Falha ao revelar token (apenas o dono ou super admin pode revelar)", variant: "destructive" });
    }
  };

  const runTest = async (overrideToken?: string, overrideBaseUrl?: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke("dnmarketing-test-connection", {
      body: {
        company_id: companyId,
        token: overrideToken,
        base_url: overrideBaseUrl,
      },
    });
    if (error) throw error;
    if (data?.success) {
      setValidatedAt(new Date().toISOString());
      return true;
    }
    const msg = typeof data?.error === "string" ? data.error : JSON.stringify(data?.error || "Token inválido");
    toast({ title: "Falha na validação", description: msg, variant: "destructive" });
    return false;
  };

  const handleTest = async () => {
    if (!baseUrl.trim()) {
      toast({ title: "Erro", description: "Informe a URL base", variant: "destructive" });
      return;
    }
    setIsTesting(true);
    try {
      const ok = await runTest(token.trim() || undefined, baseUrl.trim());
      if (ok) toast({ title: "Conexao OK", description: "Token valido para esta URL" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!token.trim() && !hasToken) {
      toast({ title: "Erro", description: "Token é obrigatório", variant: "destructive" });
      return;
    }
    if (!baseUrl.trim()) {
      toast({ title: "Erro", description: "URL base é obrigatória", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const update: Record<string, unknown> = { dnmarketing_base_url: baseUrl.trim() };
      if (token.trim()) {
        update.dnmarketing_token_encrypted = await encryptToken(token.trim(), companyId);
      }
      const { error } = await supabase.from("companies").update(update as never).eq("id", companyId);
      if (error) throw error;
      setHasToken(true);
      setToken("");
      setShowToken(false);
      toast({ title: "Sucesso", description: "Configuracao dn.marketing salva" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao salvar", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (next: boolean) => {
    if (!next) {
      setIsToggling(true);
      try {
        const { error } = await supabase
          .from("companies")
          .update({ dnmarketing_is_active: false } as never)
          .eq("id", companyId);
        if (error) throw error;
        setIsActive(false);
        toast({ title: "Integração desativada" });
        onSaved?.();
      } catch (e) {
        toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
      } finally {
        setIsToggling(false);
      }
      return;
    }

    if (!hasToken || !baseUrl.trim()) {
      toast({ title: "Configure antes", description: "Salve token e URL antes de ativar", variant: "destructive" });
      return;
    }
    setIsToggling(true);
    try {
      const ok = await runTest();
      if (!ok) return;
      const { error } = await supabase
        .from("companies")
        .update({ dnmarketing_is_active: true, dnmarketing_validated_at: new Date().toISOString() } as never)
        .eq("id", companyId);
      if (error) throw error;
      setIsActive(true);
      toast({ title: "Integração ativada" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setIsToggling(false);
    }
  };

  const handleRemove = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          dnmarketing_token_encrypted: null,
          dnmarketing_base_url: null,
          dnmarketing_is_active: false,
          dnmarketing_validated_at: null,
        } as never)
        .eq("id", companyId);
      if (error) throw error;
      setHasToken(false);
      setToken("");
      setBaseUrl("");
      setIsActive(false);
      setValidatedAt(null);
      toast({ title: "Removido", description: "Integração dn.marketing desativada" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              Integração dn.marketing
            </CardTitle>
            <CardDescription>
              Sincronizacao de identidade, status de pipeline e eventos com a plataforma dn.marketing
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${isActive ? "text-success" : "text-muted-foreground"}`}>
              {isActive ? "Ativo" : "Inativo"}
            </span>
            <Switch
              checked={isActive}
              onCheckedChange={handleToggleActive}
              disabled={!canEdit || isToggling || isTesting}
            />
          </div>
        </div>
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
            <span className="text-sm text-muted-foreground">URL base</span>
            <span className={`flex items-center gap-1.5 text-sm ${baseUrl ? "text-success" : "text-muted-foreground"}`}>
              {baseUrl ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {baseUrl ? "Salva" : "Nao configurada"}
            </span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="dnm-base-url">URL base da API</Label>
          <Input
            id="dnm-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.dn.marketing/functions/v1"
            disabled={!canEdit || isSaving}
          />
          <p className="text-xs text-muted-foreground">
            Sem barra no final. Ex: https://kfhojzdcnpuntynodsff.supabase.co/functions/v1
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dnm-token">Token</Label>
          <div className="flex gap-2">
            <Input
              id="dnm-token"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? "Token salvo (clique no olho para revelar)" : "Cole o token da dn.marketing"}
              disabled={!canEdit || isSaving}
            />
            {hasToken && (
              <Button variant="outline" size="icon" onClick={handleReveal} disabled={!canEdit || isSaving}>
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Sera criptografado antes de ser armazenado.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleSave}
            disabled={!canEdit || isSaving || (!token.trim() && !hasToken) || !baseUrl.trim() || showToken}
            className="flex-1 min-w-[140px]"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {hasToken ? "Atualizar" : "Salvar"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!canEdit || isTesting || !baseUrl.trim() || (!hasToken && !token.trim())}
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Testar conexão
          </Button>
          {hasToken && (
            <Button
              variant="outline"
              onClick={handleRemove}
              disabled={!canEdit || isSaving}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {validatedAt && (
          <p className="text-xs text-muted-foreground">
            Última validação em {new Date(validatedAt).toLocaleString("pt-BR")}
          </p>
        )}

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Apenas owners e admins da empresa podem editar esta configuração.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
