import { useEffect, useMemo, useState } from "react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sparkles, Check, AlertCircle, Eye, EyeOff, Loader2, Save, Trash2, ExternalLink, FlaskConical, X } from "lucide-react";

type CompanyExt = Record<string, unknown>;
type ModelResult = { ok: boolean; error?: string };
type LastTest = { ok: boolean; models: Record<string, ModelResult>; tested_at: string };

const REQUIRED_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-embedding-001",
];

export function GeminiIntegrationCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const { toast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<LastTest | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!currentCompany) return;
    const c = currentCompany as unknown as CompanyExt;
    setHasExistingKey(!!(c.has_gemini_api_key as boolean));
    setEnabled(!!(c.gemini_enabled as boolean));
    setValidatedAt((c.gemini_validated_at as string) || null);
    setLastTest((c.gemini_last_test as LastTest) || null);
    setApiKey("");
    setShowKey(false);
  }, [currentCompany]);

  const canActivate = useMemo(() => hasExistingKey && !!validatedAt && !!lastTest?.ok, [hasExistingKey, validatedAt, lastTest]);
  const isActive = enabled && canActivate;

  async function persistKey(plainKey: string) {
    if (!currentCompany) return;
    const encrypted = await encryptToken(plainKey, currentCompany.id);
    const { error } = await supabase
      .from("companies")
      .update({
        gemini_api_key: encrypted,
        gemini_enabled: false,
        gemini_validated_at: null,
        gemini_last_test: null,
      } as never)
      .eq("id", currentCompany.id);
    if (error) throw error;
  }

  async function runTest(useStoredKey: boolean) {
    if (!currentCompany) return;
    setIsTesting(true);
    try {
      const payload: Record<string, string> = { company_id: currentCompany.id };
      if (!useStoredKey) {
        const trimmed = apiKey.trim();
        if (!trimmed) {
          toast({ title: "Chave obrigatória", description: "Informe a chave do Gemini antes de testar.", variant: "destructive" });
          return;
        }
        payload.api_key = trimmed;
      }
      const { data, error } = await supabase.functions.invoke("gemini-validate-token", { body: payload });
      if (error) throw error;
      await refetchCompanies();
      if (data?.ok) {
        toast({ title: "Todos os modelos OK", description: "A chave foi validada com sucesso. Voce ja pode ativar." });
      } else {
        const failed = Object.entries((data?.models || {}) as Record<string, ModelResult>)
          .filter(([, r]) => !r.ok).map(([m]) => m).join(", ");
        toast({
          title: "Validacao falhou",
          description: data?.error || `Modelos com erro: ${failed || "desconhecido"}.`,
          variant: "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao testar a chave.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSaveAndTest() {
    if (!currentCompany) return;
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast({ title: "Chave obrigatória", description: "Cole a chave do Gemini.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await persistKey(trimmed);
      await refetchCompanies();
      setApiKey("");
      setShowKey(false);
      toast({ title: "Chave salva", description: "Agora vamos testar todos os modelos." });
      await runTest(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao salvar.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleEnabled(next: boolean) {
    if (!currentCompany) return;
    if (next && !canActivate) {
      toast({
        title: "Teste obrigatório",
        description: "Rode o teste de modelos primeiro e garanta que todos passaram.",
        variant: "destructive",
      });
      return;
    }
    setEnabled(next);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ gemini_enabled: next } as never)
        .eq("id", currentCompany.id);
      if (error) throw error;
      await refetchCompanies();
      toast({
        title: next ? "Integração ativada" : "Integração desativada",
        description: next
          ? "Agora suas chamadas de IA usam sua própria chave Gemini."
          : "Voltamos a usar a chave do Lovable Cloud (fallback).",
      });
    } catch (e) {
      setEnabled(!next);
      const msg = e instanceof Error ? e.message : "Falha ao atualizar.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    }
  }

  async function handleRemove() {
    if (!currentCompany) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({
          gemini_api_key: null,
          gemini_enabled: false,
          gemini_validated_at: null,
          gemini_last_test: null,
        } as never)
        .eq("id", currentCompany.id);
      if (error) throw error;
      await refetchCompanies();
      setApiKey(""); setHasExistingKey(false); setEnabled(false); setValidatedAt(null); setLastTest(null);
      toast({ title: "Chave removida", description: "Voltamos a usar a chave do Lovable Cloud." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao remover.";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  const formattedValidatedAt = validatedAt
    ? new Date(validatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Google Gemini API
            </CardTitle>
            <CardDescription className="mt-1">
              Use sua própria chave da API do Google Gemini. Só pode ser ativada após validarmos
              que todos os modelos necessários estão acessíveis. Quando desativada ou com erro,
              usamos automaticamente a chave do Lovable Cloud como fallback.
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
            {isActive ? <><Check className="h-3 w-3 mr-1" />Ativa</> :
              hasExistingKey ? <><AlertCircle className="h-3 w-3 mr-1" />Inativa</> :
                <><AlertCircle className="h-3 w-3 mr-1" />Nao configurada</>}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {hasExistingKey && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Chave armazenada</h4>
              <code className="text-xs font-mono text-muted-foreground">AIza••••••••••</code>
            </div>
            {formattedValidatedAt && (
              <p className="text-xs text-muted-foreground">
                Última validação: <strong>{formattedValidatedAt}</strong>
              </p>
            )}
          </div>
        )}

        {/* Resultado do ultimo teste */}
        {lastTest && (
          <div className="rounded-lg border border-border bg-background/40 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Ultimo teste de modelos</h4>
              <Badge variant="outline" className={lastTest.ok ? "bg-success/15 text-success border-success/40" : "bg-destructive/15 text-destructive border-destructive/40"}>
                {lastTest.ok ? "Todos OK" : "Com falhas"}
              </Badge>
            </div>
            <ul className="text-xs space-y-1">
              {REQUIRED_MODELS.map((m) => {
                const r = lastTest.models?.[m];
                return (
                  <li key={m} className="flex items-start gap-2">
                    {r?.ok ? <Check className="h-3.5 w-3.5 text-success mt-0.5" /> : <X className="h-3.5 w-3.5 text-destructive mt-0.5" />}
                    <span className="font-mono">{m}</span>
                    {!r?.ok && r?.error && <span className="text-muted-foreground"> — {r.error}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="gemini-api-key">
            Chave da API
            {hasExistingKey && <span className="ml-2 text-xs text-success">(ja configurada — preencha apenas para substituir)</span>}
          </Label>
          <div className="flex gap-2">
            <Input
              id="gemini-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasExistingKey ? "••••••••••••••••" : "AIza..."}
              disabled={isSaving || isTesting}
              autoComplete="off"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Ocultar" : "Mostrar"}>
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Gere uma chave em{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              aistudio.google.com/apikey <ExternalLink className="h-3 w-3" />
            </a>
            . Os modelos preview <code className="font-mono">gemini-3-*-preview</code> são mapeados automaticamente
            para <code className="font-mono">gemini-2.5-*</code> equivalentes quando sua chave esta ativa.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
          <div>
            <p className="text-sm font-medium">Ativar minha chave</p>
            <p className="text-xs text-muted-foreground">
              {canActivate
                ? "Todos os modelos validados. Pronto para ativar."
                : hasExistingKey
                  ? "Rode o teste de modelos para liberar a ativacao."
                  : "Configure e teste a chave para liberar a ativacao."}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isSaving || isTesting || !canActivate}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSaveAndTest} disabled={isSaving || isTesting || !apiKey.trim()} className="flex-1 min-w-[180px]">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar e testar
          </Button>
          {hasExistingKey && (
            <Button variant="outline" onClick={() => runTest(true)} disabled={isSaving || isTesting}>
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FlaskConical className="h-4 w-4 mr-2" />}
              Testar modelos
            </Button>
          )}
          {hasExistingKey && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isSaving || isTesting} className="text-destructive hover:text-destructive" aria-label="Remover chave">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover chave do Gemini?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A chave armazenada será apagada e voltaremos a usar a chave do Lovable Cloud.
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
  );
}
