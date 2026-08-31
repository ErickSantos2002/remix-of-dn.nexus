import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { Key, Plus, Trash2, Copy, Check, ExternalLink, Globe, ShieldCheck, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiKeysTable = () => supabase.from("api_keys" as any);

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

async function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const rawKey = `nxai_${hex}`;
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey)
  );
  const keyHash = Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  const keyPrefix = rawKey.substring(0, 12);
  return { rawKey, keyHash, keyPrefix };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ApiKeys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const { currentCompany } = useCompany();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpires, setNewKeyExpires] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "API | Nexus AI";
  }, []);

  const workspaceId = currentWorkspace?.id;

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ["api-keys", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await apiKeysTable()
        .select("id, name, key_prefix, is_active, created_at, last_used_at, expires_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as ApiKeyRow[]);
    },
    enabled: !!workspaceId,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, expiresAt }: { name: string; expiresAt: string | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Utilizador nao autenticado");
      if (!workspaceId || !currentCompany?.id) throw new Error("Workspace ou empresa nao selecionado");

      const { rawKey, keyHash, keyPrefix } = await generateApiKey();

      const { error } = await apiKeysTable().insert({
        workspace_id: workspaceId,
        company_id: currentCompany.id,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        permissions: [],
        created_by: user.id,
        expires_at: expiresAt || null,
      });

      if (error) throw error;
      return rawKey;
    },
    onSuccess: (rawKey) => {
      setCreatedKey(rawKey);
      queryClient.invalidateQueries({ queryKey: ["api-keys", workspaceId] });
      toast({
        title: "Chave criada com sucesso",
        description: "Copie a chave agora. Ela nao sera exibida novamente.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao criar chave",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await apiKeysTable().delete().eq("id", keyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys", workspaceId] });
      toast({ title: "Chave removida com sucesso" });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao remover chave",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    createMutation.mutate({
      name: newKeyName.trim(),
      expiresAt: newKeyExpires || null,
    });
  };

  const handleCloseCreateDialog = () => {
    setCreateOpen(false);
    setNewKeyName("");
    setNewKeyExpires("");
    setCreatedKey(null);
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Key className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">API</h1>
            <p className="text-sm text-muted-foreground">
              Integre sistemas externos com a API REST do Nexus AI
            </p>
          </div>
        </div>

        {/* API Info Card */}
        <div className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            Informacoes da API
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>Base URL</span>
              </div>
              <code className="block text-sm font-mono bg-muted/30 rounded px-3 py-2 text-foreground break-all">
                https://apbvnbubxyaihygnxdev.supabase.co/functions/v1/api-gateway
              </code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Server className="h-4 w-4" />
                <span>Workspace Header</span>
              </div>
              <code className="block text-sm font-mono bg-muted/30 rounded px-3 py-2 text-foreground">
                X-Workspace-Id: {workspaceId || "..."}
              </code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                <span>Autenticacao</span>
              </div>
              <div className="text-sm text-foreground space-y-1">
                <p>
                  <span className="font-mono bg-muted/30 rounded px-1.5 py-0.5">
                    Authorization: Bearer &lt;JWT&gt;
                  </span>
                </p>
                <p>
                  <span className="font-mono bg-muted/30 rounded px-1.5 py-0.5">
                    X-API-Key: &lt;chave&gt;
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => window.open("/api/docs", "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir documentacao Swagger
              </Button>
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Chaves de API
            </h2>
            <Dialog open={createOpen} onOpenChange={(open) => {
              if (!open) handleCloseCreateDialog();
              else setCreateOpen(true);
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Criar Chave
                </Button>
              </DialogTrigger>
              <DialogContent>
                {createdKey ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>Chave criada</DialogTitle>
                      <DialogDescription>
                        Esta chave so sera exibida uma vez. Copie e armazene em
                        local seguro.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={createdKey}
                          className="font-mono text-sm"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={handleCopy}
                        >
                          {copied ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-sm text-destructive">
                        Atencao: esta chave nao podera ser visualizada novamente
                        apos fechar este dialogo.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCloseCreateDialog}>Fechar</Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>Criar chave de API</DialogTitle>
                      <DialogDescription>
                        Crie uma chave para autenticar requisicoes a API.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="key-name">Nome</Label>
                        <Input
                          id="key-name"
                          placeholder="Ex: Integracao ERP"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="key-expires">
                          Expiracao (opcional)
                        </Label>
                        <Input
                          id="key-expires"
                          type="date"
                          value={newKeyExpires}
                          onChange={(e) => setNewKeyExpires(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={handleCloseCreateDialog}
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleCreate}
                        disabled={
                          !newKeyName.trim() || createMutation.isPending
                        }
                      >
                        {createMutation.isPending ? "Criando..." : "Criar"}
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Carregando...
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-8">
              <Key className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                Nenhuma chave de API criada ainda.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Crie uma chave para comecar a usar a API.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Prefixo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criada em</TableHead>
                    <TableHead>Ultimo uso</TableHead>
                    <TableHead>Expiracao</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => {
                    const isExpired =
                      key.expires_at &&
                      new Date(key.expires_at) < new Date();
                    return (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium text-foreground">
                          {key.name}
                        </TableCell>
                        <TableCell>
                          <code className="text-sm font-mono text-muted-foreground">
                            {key.key_prefix}...
                          </code>
                        </TableCell>
                        <TableCell>
                          {!key.is_active ? (
                            <Badge variant="secondary">Inativa</Badge>
                          ) : isExpired ? (
                            <Badge variant="destructive">Expirada</Badge>
                          ) : (
                            <Badge className="badge-success">
                              Ativa
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(key.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(key.last_used_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {key.expires_at
                            ? formatDate(key.expires_at)
                            : "Sem expiracao"}
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remover chave de API
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover a chave &quot;
                                  {key.name}&quot;? Todas as integracoes que
                                  utilizam esta chave deixarao de funcionar
                                  imediatamente.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(key.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
