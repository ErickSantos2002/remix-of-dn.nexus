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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Brain,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Trash2,
  ExternalLink,
  HelpCircle,
  RefreshCw,
} from "lucide-react";

type CompanyExt = Record<string, unknown>;

export function OpenAIIntegrationCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  const [modelDefault, setModelDefault] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!currentCompany) return;
    const c = currentCompany as unknown as CompanyExt;
    setHasExistingKey(!!(c.has_openai_api_key as boolean));
    setEnabled(!!(c.openai_enabled as boolean));
    setValidatedAt((c.openai_validated_at as string) || null);
    setModelDefault((c.openai_model_default as string) || null);
    setApiKey("");
    setShowKey(false);
  }, [currentCompany]);

  const isActive = enabled && hasExistingKey && !!validatedAt;

  const handleValidateAndSave = async () => {
    if (!currentCompany) return;
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast({
        title: "Chave obrigatória",
        description: "Informe a API Key da OpenAI.",
        variant: "destructive",
      });
      return;
    }
    if (!trimmed.startsWith("sk-")) {
      toast({
        title: "Formato inválido",
        description: "A chave da OpenAI deve comecar com 'sk-'.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      // 1. Validate against OpenAI via edge function
      const { data, error } = await supabase.functions.invoke("openai-validate-token", {
        body: { company_id: currentCompany.id, api_key: trimmed },
      });
      if (error) throw error;
      if (!data?.valid) {
        toast({
          title: "Chave invalida",
          description: data?.error || "Não foi possível validar a chave.",
          variant: "destructive",
        });
        return;
      }

      // 2. Encrypt and save
      const encrypted = await encryptToken(trimmed, currentCompany.id);
      const { error: updErr } = await supabase
        .from("companies")
        .update({
          openai_api_key: encrypted,
          openai_enabled: true,
          openai_validated_at: new Date().toISOString(),
          openai_model_default: data.sample_model || null,
        } as never)
        .eq("id", currentCompany.id);

      if (updErr) throw updErr;

      await refetchCompanies();
      setApiKey("");
      setShowKey(false);
      toast({
        title: "Chave validada e salva",
        description: `Integração OpenAI ativada (${data.models_count} modelos disponíveis).`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao validar/salvar.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevalidate = async () => {
    if (!currentCompany) return;
    setIsRevalidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("openai-validate-token", {
        body: { company_id: currentCompany.id },
      });
      if (error) throw error;

      await refetchCompanies();

      if (!data?.valid) {
        toast({
          title: "Revalidação falhou",
          description: data?.error || "Chave não está mais válida. Integração desativada.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Chave revalidada",
          description: `${data.models_count} modelos disponíveis.`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao revalidar.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsRevalidating(false);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!currentCompany) return;
    // Can't enable without a validated key
    if (next && (!hasExistingKey || !validatedAt)) {
      toast({
        title: "Valide a chave primeiro",
        description: "Cadastre e valide uma API Key antes de ativar.",
        variant: "destructive",
      });
      return;
    }
    setEnabled(next);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ openai_enabled: next } as never)
        .eq("id", currentCompany.id);
      if (error) throw error;
      await refetchCompanies();
    } catch (e) {
      setEnabled(!next);
      const msg = e instanceof Error ? e.message : "Falha ao atualizar.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    }
  };

  const handleRemove = async () => {
    if (!currentCompany) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          openai_api_key: null,
          openai_enabled: false,
          openai_validated_at: null,
          openai_model_default: null,
        } as never)
        .eq("id", currentCompany.id);
      if (error) throw error;

      await refetchCompanies();
      setApiKey("");
      setHasExistingKey(false);
      setEnabled(false);
      setValidatedAt(null);
      setModelDefault(null);
      toast({
        title: "Chave removida",
        description: "Integração OpenAI desativada.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao remover.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const formattedValidatedAt = validatedAt
    ? new Date(validatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;

  return (
    <>
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  Integração OpenAI
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-primary"
                  onClick={() => setShowGuide(true)}
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Como obter a chave
                </Button>
              </div>
              <CardDescription className="mt-1">
                Cadastre a API Key da OpenAI da empresa. A chave e validada antes de ser ativada.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={
                isActive
                  ? "bg-success/15 text-success border-success/40"
                  : hasExistingKey
                    ? "bg-warning/15 text-warning border-warning/40"
                    : "bg-muted text-muted-foreground border-border"
              }
            >
              {isActive ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Ativo
                </>
              ) : hasExistingKey ? (
                <>
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Inativo
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Nao configurado
                </>
              )}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {hasExistingKey && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">Chave armazenada</h4>
                <code className="text-xs font-mono text-muted-foreground">
                  sk-••••••••••••
                </code>
              </div>
              {formattedValidatedAt && (
                <p className="text-xs text-muted-foreground">
                  Última validação: <strong>{formattedValidatedAt}</strong>
                </p>
              )}
              {modelDefault && (
                <p className="text-xs text-muted-foreground">
                  Modelo de referencia: <strong className="font-mono">{modelDefault}</strong>
                </p>
              )}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRevalidate}
                  disabled={isRevalidating || isSaving}
                >
                  {isRevalidating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  )}
                  Revalidar chave salva
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-api-key">
                API Key
                {hasExistingKey && (
                  <span className="ml-2 text-xs text-success">
                    (ja configurada — preencha apenas para substituir)
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="openai-api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasExistingKey ? "••••••••••••••••" : "sk-..."}
                  disabled={isSaving}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                A chave e testada contra a API da OpenAI antes de ser salva e ativada.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativar integração</p>
                <p className="text-xs text-muted-foreground">
                  Quando ativa, os recursos de IA da empresa usam essa chave.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={isSaving || isRevalidating || !hasExistingKey || !validatedAt}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleValidateAndSave} disabled={isSaving || !apiKey.trim()} className="flex-1">
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Validar e salvar
            </Button>
            {hasExistingKey && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isSaving || isRevalidating}
                    className="text-destructive hover:text-destructive"
                    aria-label="Remover chave"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover chave da OpenAI?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A integração será desativada e a chave armazenada será apagada. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRemove}>Remover</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              Como obter a API Key da OpenAI
            </DialogTitle>
            <DialogDescription>
              Siga os passos para gerar uma chave na plataforma da OpenAI.
            </DialogDescription>
          </DialogHeader>

          <ol className="space-y-4 mt-2">
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                1
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Acesse a plataforma</p>
                <p className="text-sm text-muted-foreground">
                  Entre em{" "}
                  <a
                    href="https://platform.openai.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    platform.openai.com <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  com a conta da empresa.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                2
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Abra "API keys"</p>
                <p className="text-sm text-muted-foreground">
                  Va em{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    platform.openai.com/api-keys <ExternalLink className="h-3 w-3" />
                  </a>
                  .
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                3
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Crie uma nova chave</p>
                <p className="text-sm text-muted-foreground">
                  Clique em <strong>"Create new secret key"</strong>, de um nome (ex: "Nexus AI") e copie o valor
                  comecando com <code className="font-mono">sk-</code>. A chave so e exibida uma vez.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">
                4
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Cole aqui e valide</p>
                <p className="text-sm text-muted-foreground">
                  Cole a chave no campo <strong>API Key</strong> e clique em <strong>"Validar e salvar"</strong>.
                  Garantimos que ela seja aceita pela OpenAI antes de ativar a integração.
                </p>
              </div>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
