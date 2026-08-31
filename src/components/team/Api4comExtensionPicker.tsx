import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Phone, RefreshCw, ExternalLink, AlertCircle, Check, ChevronsUpDown, Sparkles, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Api4comExtensionPickerProps {
  userId: string;
  companyId: string;
  userEmail?: string;
  onSaved?: () => void;
}

interface RawExtension {
  id?: string | number;
  ramal?: string | number;
  extension?: string | number;
  number?: string | number;
  ext?: string | number;
  name?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  displayName?: string;
  display_name?: string;
  description?: string;
  label?: string;
  email?: string;
  userEmail?: string;
  user_email?: string;
  mail?: string;
  [key: string]: unknown;
}

interface NormalizedExtension {
  value: string;
  name: string;
  email: string;
  raw: RawExtension;
}

function normalize(ext: RawExtension, idx: number): NormalizedExtension {
  const value = String(ext.ramal ?? ext.extension ?? ext.number ?? ext.ext ?? ext.id ?? `ext-${idx}`);
  const first = ext.firstName ?? ext.first_name ?? "";
  const last = ext.lastName ?? ext.last_name ?? "";
  const composed = `${first} ${last}`.trim();
  const name =
    (ext.name as string) ||
    (ext.displayName as string) ||
    (ext.display_name as string) ||
    composed ||
    (ext.description as string) ||
    (ext.label as string) ||
    "";
  const email =
    (ext.email as string) ||
    (ext.userEmail as string) ||
    (ext.user_email as string) ||
    (ext.mail as string) ||
    "";
  return { value, name, email, raw: ext };
}

export function Api4comExtensionPicker({ userId, companyId, userEmail, onSaved }: Api4comExtensionPickerProps) {
  const { toast } = useToast();
  const [extensions, setExtensions] = useState<NormalizedExtension[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [currentExt, setCurrentExt] = useState<string>("");
  const [domain, setDomain] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompanyConfigured, setIsCompanyConfigured] = useState(false);
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const suggestedValue = useMemo(() => {
    if (!userEmail) return "";
    const match = extensions.find((x) => x.email.toLowerCase() === userEmail.toLowerCase());
    return match?.value || "";
  }, [extensions, userEmail]);

  const selectedItem = useMemo(
    () => extensions.find((x) => x.value === selected),
    [extensions, selected],
  );

  const loadCurrent = async () => {
    const [{ data: profile }, { data: company }] = await Promise.all([
      supabase.from("profiles").select("api4com_extension").eq("id", userId).single(),
      supabase.from("companies").select("api4com_domain, has_api4com_token").eq("id", companyId).single(),
    ]);
    const ext = (profile as { api4com_extension?: string } | null)?.api4com_extension || "";
    setCurrentExt(ext);
    setSelected(ext);
    setDomain((company as { api4com_domain?: string } | null)?.api4com_domain || "");
    setIsCompanyConfigured(!!(company as { has_api4com_token?: boolean } | null)?.has_api4com_token);
  };

  const loadExtensions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("api4com-list-extensions", {
        body: { company_id: companyId },
      });
      if (error) throw error;
      const rawList: RawExtension[] = (data?.success && Array.isArray(data.extensions)) ? data.extensions : [];
      const list = rawList.map((x, i) => normalize(x, i));
      setExtensions(list);
      setLoaded(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao listar ramais";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadCurrent(); }, [userId, companyId]);

  // Auto-load extensions once company is confirmed configured
  useEffect(() => {
    if (isCompanyConfigured && !loaded && !isLoading) {
      loadExtensions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompanyConfigured]);

  // Auto-select suggested if user has none yet
  useEffect(() => {
    if (!selected && suggestedValue) setSelected(suggestedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedValue]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isSelf = user?.id === userId;

      let savedExt: string | null = null;

      if (isSelf) {
        // RLS allows self-update
        const { data, error } = await supabase
          .from("profiles")
          .update({
            api4com_extension: selected || null,
            api4com_synced_at: new Date().toISOString(),
          } as never)
          .eq("id", userId)
          .select("api4com_extension")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Sem permissao para salvar o ramal deste usuario.");
        savedExt = (data as { api4com_extension?: string | null }).api4com_extension ?? null;
      } else {
        // Cross-user: invoke privileged edge function
        const { data, error } = await supabase.functions.invoke("update-member-extension", {
          body: { user_id: userId, company_id: companyId, extension: selected || null },
        });
        if (error) {
          let msg = error.message || "Falha ao salvar ramal";
          try {
            const ctx = (error as { context?: Response }).context;
            if (ctx && typeof ctx.json === "function") {
              const j = await ctx.json();
              if (j?.error) msg = j.error;
            }
          } catch { /* ignore */ }
          throw new Error(msg);
        }
        savedExt = data?.api4com_extension ?? null;
      }

      if ((savedExt || "") !== (selected || "")) {
        throw new Error("Ramal nao foi persistido corretamente.");
      }

      toast({ title: "Ramal salvo" });
      await loadCurrent();
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha";
      toast({ title: "Erro ao salvar ramal", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isCompanyConfigured) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Ramal api4com
        </Label>
        <div className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Integracao api4com nao configurada para esta empresa. Configure em Empresa &gt; Integracao api4com.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Phone className="h-4 w-4" />
          Ramal api4com
        </Label>
        <a
          href="https://app.api4com.com"
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          title="Acesse o portal api4com para instalar a extensao do Webphone no Chrome"
        >
          Portal api4com <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {isLoading && extensions.length === 0 ? (
        <Skeleton className="h-10 w-full" />
      ) : extensions.length === 0 && loaded ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p>Nenhum ramal encontrado na api4com.</p>
            <p>Cadastre ramais no painel api4com e clique em atualizar.</p>
          </div>
          <Button variant="outline" size="icon" className="ml-auto shrink-0" onClick={loadExtensions} disabled={isLoading} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="flex-1 justify-between font-normal"
              >
                {selectedItem ? (
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm">{selectedItem.value}</span>
                    {selectedItem.name && (
                      <span className="text-muted-foreground truncate">— {selectedItem.name}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Selecione um ramal...</span>
                )}
                <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command
                filter={(value, search) => {
                  // value is the CommandItem value (we set as `${ext.value} ${name} ${email}`)
                  return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                }}
              >
                <CommandInput placeholder="Buscar por numero, nome ou e-mail..." />
                <CommandList>
                  <CommandEmpty>Nenhum ramal encontrado.</CommandEmpty>
                  <CommandGroup>
                    {extensions.map((x) => {
                      const isSuggested = suggestedValue && x.value === suggestedValue;
                      const isSelected = x.value === selected;
                      return (
                        <CommandItem
                          key={x.value}
                          value={`${x.value} ${x.name} ${x.email}`}
                          onSelect={() => {
                            setSelected(x.value);
                            setOpen(false);
                          }}
                          className="flex items-start gap-2 py-2"
                        >
                          <Check className={cn("h-4 w-4 mt-1 shrink-0", isSelected ? "opacity-100 text-primary" : "opacity-0")} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-medium">{x.value}</span>
                              {isSuggested && (
                                <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                                  <Sparkles className="h-3 w-3" />
                                  Sugerido
                                </Badge>
                              )}
                            </div>
                            {(x.name || x.email) && (
                              <div className="text-xs text-muted-foreground truncate">
                                {x.name || "Sem nome"}
                                {x.email && <> · {x.email}</>}
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" onClick={loadExtensions} disabled={isLoading} title="Atualizar lista">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button size="sm" onClick={handleSave} disabled={isSaving || selected === currentExt}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Salvar ramal
        </Button>
        {currentExt && (
          <p className="text-xs text-muted-foreground">
            Atual: <span className="font-mono">{currentExt}</span>
          </p>
        )}
      </div>

      {extensions.length > 0 && (
        <Collapsible open={showRaw} onOpenChange={setShowRaw}>
          <CollapsibleTrigger asChild>
            <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Code2 className="h-3 w-3" />
              {showRaw ? "Ocultar" : "Ver"} dados brutos ({extensions.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 p-2 rounded border border-border bg-muted/30 text-[10px] overflow-auto max-h-48">
              {JSON.stringify(extensions.map((x) => x.raw), null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
