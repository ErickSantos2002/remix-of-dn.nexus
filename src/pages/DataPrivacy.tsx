import { useState } from "react";
import { Search, ShieldCheck, Trash2, EyeOff, FileText, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface SearchResult {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  is_anonymized: boolean;
  leads_count: number;
  messages_count: number;
  crm_leads_count: number;
  conversations_count: number;
}

interface ActionResult {
  success: boolean;
  action_type: string;
  hash: string;
  tables_affected: Record<string, number>;
  records_affected_count: number;
}

export default function DataPrivacy() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<SearchResult | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"anonymize" | "delete" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [certificate, setCertificate] = useState<ActionResult | null>(null);
  const [certificateAction, setCertificateAction] = useState<"anonymize" | "delete" | null>(null);

  // Fetch deletion logs
  const { data: logs } = useQuery({
    queryKey: ["data-deletion-logs", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("data_deletion_log")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("executed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentWorkspace?.id,
  });

  const handleSearch = async () => {
    if (!searchTerm.trim() || !currentWorkspace?.id) return;
    setIsSearching(true);
    setSearchResults([]);
    setSelectedContact(null);
    setCertificate(null);

    try {
      const { data, error } = await supabase.functions.invoke("lgpd-data-management", {
        body: {
          action: "search",
          workspace_id: currentWorkspace.id,
          search_term: searchTerm.trim(),
        },
      });

      if (error) throw error;
      setSearchResults(data.results || []);

      if (!data.results || data.results.length === 0) {
        toast({ title: "Nenhum resultado", description: "Nenhum titular encontrado com este termo." });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Erro na busca", description: String(err) });
    } finally {
      setIsSearching(false);
    }
  };

  const openConfirmDialog = (action: "anonymize" | "delete") => {
    if (!selectedContact) return;
    setConfirmAction(action);
    setConfirmText("");
    setConfirmDialogOpen(true);
  };

  const handleExecuteAction = async () => {
    if (!selectedContact || !confirmAction || !currentWorkspace?.id) return;
    setIsProcessing(true);
    setConfirmDialogOpen(false);

    try {
      const { data, error } = await supabase.functions.invoke("lgpd-data-management", {
        body: {
          action: confirmAction === "anonymize" ? "anonymize" : "delete",
          workspace_id: currentWorkspace.id,
          customer_phone: selectedContact.phone,
        },
      });

      if (error) throw error;

      setCertificate(data);
      setCertificateAction(confirmAction);
      setSearchResults([]);
      setSelectedContact(null);
      queryClient.invalidateQueries({ queryKey: ["data-deletion-logs"] });

      toast({
         title: confirmAction === "anonymize" ? "Dados anonimizados" : "Dados excluídos",
        description: `${data.records_affected_count} registros processados com sucesso.`,
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Erro ao processar", description: String(err) });
    } finally {
      setIsProcessing(false);
      setConfirmText("");
    }
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Privacidade de Dados (LGPD)</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie solicitações de exclusão e anonimização de dados pessoais
          </p>
        </div>
      </div>

      <Separator />

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar Titular</CardTitle>
          <CardDescription>Busque por nome, email ou número de WhatsApp do titular dos dados</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Nome, email ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={isSearching || !searchTerm.trim()}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2">Buscar</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados ({searchResults.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {searchResults.map((result) => (
              <div
                key={result.id}
                onClick={() => setSelectedContact(result)}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                  selectedContact?.id === result.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-foreground">{result.name}</span>
                    {result.is_anonymized && (
                      <Badge variant="secondary" className="ml-2 text-xs">Anonimizado</Badge>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <span>Tel: {result.phone || "N/A"}</span>
                  <span>Email: {result.email || "N/A"}</span>
                  <span>Leads: {result.leads_count}</span>
                  <span>Mensagens: {result.messages_count}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mt-1">
                  <span>Cards CRM: {result.crm_leads_count}</span>
                  <span>Conversas: {result.conversations_count}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {selectedContact && !selectedContact.is_anonymized && (
        <Card>
          <CardHeader>
             <CardTitle className="text-base">Ações para: {selectedContact.name}</CardTitle>
            <CardDescription>Selecione a ação a ser executada nos dados deste titular</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => openConfirmDialog("anonymize")}
              disabled={isProcessing}
              className="flex-1"
            >
              <EyeOff className="h-4 w-4 mr-2" />
              Anonimizar Dados
            </Button>
            <Button
              variant="destructive"
              onClick={() => openConfirmDialog("delete")}
              disabled={isProcessing}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir Completamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Certificate */}
      {certificate && (
        <Card className="print:shadow-none" id="lgpd-certificate">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <CardTitle className="text-base">Comprovante de {certificateAction === "anonymize" ? "Anonimização" : "Exclusão"}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Data/Hora:</span>
                <p className="font-medium text-foreground">{format(new Date(), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
              </div>
              <div>
                 <span className="text-muted-foreground">Tipo de Ação:</span>
                <p className="font-medium text-foreground">
                  {certificate.action_type === "anonymization" ? "Anonimização" : "Exclusão Completa"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Hash do Titular:</span>
                <p className="font-mono font-medium text-foreground">{certificate.hash}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total de Registros:</span>
                <p className="font-mono font-medium text-foreground">{certificate.records_affected_count}</p>
              </div>
            </div>
            <Separator />
            <div>
              <span className="text-sm text-muted-foreground">Tabelas Afetadas:</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(certificate.tables_affected).map(([table, count]) => (
                  <Badge key={table} variant="secondary" className="font-mono text-xs">
                    {table}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            <Button variant="outline" onClick={handleExportPDF} className="mt-4 print:hidden">
              <FileText className="h-4 w-4 mr-2" />
              Exportar Comprovante (PDF)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {logs && logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico de Operações</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Hash Titular</TableHead>
                  <TableHead>Registros</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log: Record<string, unknown>) => (
                  <TableRow key={log.id as string}>
                    <TableCell className="text-xs">
                      {format(new Date(log.executed_at as string), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                       <Badge variant={log.action_type === "anonymization" ? "secondary" : "destructive"} className="text-xs">
                        {log.action_type === "anonymization" ? "Anonimização" : "Exclusão"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.customer_identifier_hash as string}</TableCell>
                    <TableCell className="font-mono text-xs">{log.records_affected_count as number}</TableCell>
                    <TableCell>
                      <Badge
                        variant={(log.status as string) === "completed" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {(log.status as string) === "completed" ? "Concluído" : (log.status as string)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p className="font-medium text-foreground">1. Buscar Titular</p>
            <p>Digite o nome, email ou telefone do cliente no campo de busca. O sistema localiza o contato e exibe um resumo com quantidade de leads, mensagens, cards no CRM e conversas associadas.</p>
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="font-medium text-foreground">2. Escolher a ação</p>
            <div className="ml-4 space-y-2">
              <div>
                <p className="font-medium text-foreground flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5" /> Anonimizar Dados</p>
                <p>Substitui nome, telefone e email por valores irreversíveis (ex: &quot;Titular Anonimizado #A3F2B1C8&quot;). Apaga mensagens e conteúdo sensível, mas preserva registros do CRM (cards, pipeline) com dados anonimizados para manter a integridade do sistema.</p>
              </div>
              <div>
                <p className="font-medium text-foreground flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Excluir Completamente</p>
                <p>Remove permanentemente todos os registros do cliente: mensagens, conversas, leads, contatos, cards CRM, agendamentos e demais referências.</p>
              </div>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
             <p className="font-medium text-foreground">3. Confirmação</p>
            <p>Um modal exige que você digite &quot;CONFIRMAR&quot; antes de executar qualquer ação. Isso previne operações acidentais.</p>
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="font-medium text-foreground">4. Comprovante</p>
            <p>Após a execução, é exibido um certificado com data/hora, tipo de ação, hash do titular, tabelas e registros afetados. Você pode exportar como PDF.</p>
          </div>
          <Separator />
          <div className="space-y-1">
            <p className="font-medium text-foreground">Quem pode acessar</p>
            <p>Apenas usuários com role <Badge variant="secondary" className="text-xs">admin</Badge> ou <Badge variant="secondary" className="text-xs">super_admin</Badge>.</p>
          </div>
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {confirmAction === "anonymize" ? "Anonimizar Dados" : "Excluir Dados Completamente"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
               <p>
                {confirmAction === "anonymize"
                  ? "Esta ação irá substituir todos os dados pessoais do titular por valores anonimizados. O histórico de mensagens será excluído. Esta ação é irreversível."
                  : "Esta ação irá excluir permanentemente TODOS os dados do titular, incluindo conversas, leads, cards do CRM e mensagens. Esta ação é irreversível."}
              </p>
              <p className="font-medium text-foreground">
                Titular: {selectedContact?.name} ({selectedContact?.phone})
              </p>
              <div className="space-y-2 pt-2">
                <p className="text-sm">
                  Digite <span className="font-bold text-foreground">CONFIRMAR</span> para prosseguir:
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="CONFIRMAR"
                  className="font-mono"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecuteAction}
              disabled={confirmText !== "CONFIRMAR"}
              className={confirmAction === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {confirmAction === "anonymize" ? "Anonimizar" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
