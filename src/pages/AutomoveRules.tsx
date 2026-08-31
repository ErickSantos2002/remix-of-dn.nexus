import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  ArrowRight, 
  Loader2,
  Settings,
  History,
  Zap,
  RotateCcw
} from "lucide-react";

interface AutomoveRule {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  condition_type: string;
  condition_value: string;
  condition_operator: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  is_active: boolean;
  priority: number;
  is_default?: boolean;
  from_stage?: { id: string; name: string; color: string };
  to_stage?: { id: string; name: string; color: string };
}

interface AutomoveLog {
  id: string;
  lead_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  reason: string | null;
  created_at: string;
  from_stage?: { name: string; color: string };
  to_stage?: { name: string; color: string };
  lead?: { title: string; contact?: { name: string } };
}

interface Stage {
  id: string;
  name: string;
  color: string;
}

// Tipo de condição por evento: não usa operador/valor (o gatilho é o evento em si)
const GUEST_JOINED_CONDITION = "guest_joined_meeting";

const conditionTypes = [
  { value: "propensity_score", label: "Propensão" },
  { value: "risk_score", label: "Risco" },
  { value: "opportunity_score", label: "Oportunidade" },
  { value: "temperatura", label: "Temperatura" },
  { value: "lead_score", label: "Lead Score" },
  { value: GUEST_JOINED_CONDITION, label: "Reunião realizada (convidado entrou)" },
];

const operators = [
  { value: ">", label: "Maior que" },
  { value: "<", label: "Menor que" },
  { value: ">=", label: "Maior ou igual" },
  { value: "<=", label: "Menor ou igual" },
  { value: "=", label: "Igual a" },
  { value: "!=", label: "Diferente de" },
];

const temperaturas = [
  { value: "muito_quente", label: "Muito Quente" },
  { value: "quente", label: "Quente" },
  { value: "morno", label: "Morno" },
  { value: "frio", label: "Frio" },
];

export default function AutomoveRules() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomoveRule | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    condition_type: "propensity_score",
    condition_value: "",
    condition_operator: ">=",
    from_stage_id: "",
    to_stage_id: "",
    priority: 0,
  });

  // Fetch rules
  const { data: rules, isLoading: isLoadingRules } = useQuery({
    queryKey: ["automove-rules", currentWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_automove_rules")
        .select(`
          *,
          from_stage:crm_pipeline_stages!crm_automove_rules_from_stage_id_fkey(id, name, color),
          to_stage:crm_pipeline_stages!crm_automove_rules_to_stage_id_fkey(id, name, color)
        `)
        .eq("workspace_id", currentWorkspace?.id)
        .order("priority", { ascending: false });

      if (error) throw error;
      return data as AutomoveRule[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch stages
  const { data: stages } = useQuery({
    queryKey: ["pipeline-stages", currentWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name, color")
        .eq("workspace_id", currentWorkspace?.id)
        .order("order", { ascending: true });

      if (error) throw error;
      return data as Stage[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch logs
  const { data: logs, isLoading: isLoadingLogs } = useQuery({
    queryKey: ["automove-logs", currentWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_automove_log")
        .select(`
          *,
          from_stage:crm_pipeline_stages!crm_automove_log_from_stage_id_fkey(name, color),
          to_stage:crm_pipeline_stages!crm_automove_log_to_stage_id_fkey(name, color),
          lead:crm_leads(title, contact:crm_contacts(name))
        `)
        .eq("workspace_id", currentWorkspace?.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as AutomoveLog[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const isEventRule = data.condition_type === GUEST_JOINED_CONDITION;
      const payload = {
        workspace_id: currentWorkspace?.id,
        name: data.name,
        description: data.description || null,
        condition_type: data.condition_type,
        // Regras por evento não têm operador/valor — placeholders fixos
        condition_value: isEventRule ? "true" : data.condition_value,
        condition_operator: isEventRule ? "=" : data.condition_operator,
        from_stage_id: data.from_stage_id || null,
        to_stage_id: data.to_stage_id || null,
        priority: data.priority,
      };

      if (selectedRule) {
        // Ao editar, remove o is_default (regra deixa de ser padrão)
        const { error } = await supabase
          .from("crm_automove_rules")
          .update({ ...payload, is_default: false })
          .eq("id", selectedRule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("crm_automove_rules")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(selectedRule ? "Regra atualizada" : "Regra criada");
      queryClient.invalidateQueries({ queryKey: ["automove-rules"] });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error("Erro: " + error.message);
    },
  });

  // Toggle active mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("crm_automove_rules")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automove-rules"] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("crm_automove_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra excluída");
      queryClient.invalidateQueries({ queryKey: ["automove-rules"] });
      setIsDeleteOpen(false);
      setSelectedRule(null);
    },
    onError: (error: Error) => {
      toast.error("Erro: " + error.message);
    },
  });

  // Restore default rules mutation
  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!currentWorkspace?.id) throw new Error("Workspace não encontrado");
      
      // 1. Deletar todas as regras existentes
      const { error: deleteError } = await supabase
        .from("crm_automove_rules")
        .delete()
        .eq("workspace_id", currentWorkspace.id);
      
      if (deleteError) throw deleteError;
      
      // 2. Chamar a função RPC para criar regras padrão
      const { error: rpcError } = await supabase.rpc("create_default_automove_rules", {
        p_workspace_id: currentWorkspace.id
      });
      
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      toast.success("Regras padrão restauradas");
      queryClient.invalidateQueries({ queryKey: ["automove-rules"] });
      setIsRestoreOpen(false);
    },
    onError: (error: Error) => {
      toast.error("Erro ao restaurar: " + error.message);
    },
  });

  const resetForm = () => {
    setSelectedRule(null);
    setFormData({
      name: "",
      description: "",
      condition_type: "propensity_score",
      condition_value: "",
      condition_operator: ">=",
      from_stage_id: "",
      to_stage_id: "",
      priority: 0,
    });
  };

  const openEditDialog = (rule: AutomoveRule) => {
    setSelectedRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description || "",
      condition_type: rule.condition_type,
      condition_value: rule.condition_value,
      condition_operator: rule.condition_operator,
      from_stage_id: rule.from_stage_id || "",
      to_stage_id: rule.to_stage_id || "",
      priority: rule.priority,
    });
    setIsDialogOpen(true);
  };

  const isEventRule = formData.condition_type === GUEST_JOINED_CONDITION;

  const formatCondition = (rule: AutomoveRule) => {
    if (rule.condition_type === GUEST_JOINED_CONDITION) {
      return "Convidado entrou na reunião";
    }

    const type = conditionTypes.find(t => t.value === rule.condition_type)?.label || rule.condition_type;
    const op = operators.find(o => o.value === rule.condition_operator)?.label || rule.condition_operator;
    
    if (rule.condition_type === "temperatura") {
      const temp = temperaturas.find(t => t.value === rule.condition_value)?.label || rule.condition_value;
      return `${type} ${op} ${temp}`;
    }
    
    return `${type} ${op} ${rule.condition_value}`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Configurar Auto-move de Leads
          </h1>
          <p className="text-muted-foreground">
            Configure regras para mover leads automaticamente com base na análise psicológica
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => setIsRestoreOpen(true)} 
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Restaurar Padrão
          </Button>
          <Button onClick={() => { resetForm(); setIsDialogOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Regra
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rules" className="space-y-6">
        <TabsList>
          <TabsTrigger value="rules" className="gap-2">
            <Settings className="h-4 w-4" />
            Regras
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            Histórico
          </TabsTrigger>
        </TabsList>

        {/* Rules Tab */}
        <TabsContent value="rules">
          <Card className="glass-card">
            <CardContent className="p-0">
              {isLoadingRules ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !rules?.length ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Zap className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">Nenhuma regra configurada</p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => setIsRestoreOpen(true)}
                      className="gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Usar regras padrão
                    </Button>
                    <Button 
                      onClick={() => { resetForm(); setIsDialogOpen(true); }}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Criar regra personalizada
                    </Button>
                  </div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Condição</TableHead>
                      <TableHead>De</TableHead>
                      <TableHead>Para</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-medium text-foreground">{rule.name}</p>
                              {rule.description && (
                                <p className="text-xs text-muted-foreground">{rule.description}</p>
                              )}
                            </div>
                            {rule.is_default && (
                              <Badge variant="outline" className="text-xs border-primary/50 text-primary">
                                Padrão
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{formatCondition(rule)}</Badge>
                        </TableCell>
                        <TableCell>
                          {rule.from_stage ? (
                            <Badge 
                              style={{ backgroundColor: rule.from_stage.color }}
                              className="text-white"
                            >
                              {rule.from_stage.name}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">Qualquer</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            {rule.to_stage ? (
                              <Badge 
                                style={{ backgroundColor: rule.to_stage.color }}
                                className="text-white"
                              >
                                {rule.to_stage.name}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={rule.is_active}
                            onCheckedChange={(checked) => 
                              toggleMutation.mutate({ id: rule.id, is_active: checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(rule)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setSelectedRule(rule); setIsDeleteOpen(true); }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Últimos 50 movimentos automáticos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingLogs ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !logs?.length ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <History className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Nenhum movimento registrado</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>De</TableHead>
                        <TableHead>Para</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(log.created_at).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            {log.lead?.contact?.name || log.lead?.title || "Lead"}
                          </TableCell>
                          <TableCell>
                            {log.from_stage ? (
                              <Badge 
                                style={{ backgroundColor: log.from_stage.color }}
                                className="text-white"
                              >
                                {log.from_stage.name}
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              {log.to_stage ? (
                                <Badge 
                                  style={{ backgroundColor: log.to_stage.color }}
                                  className="text-white"
                                >
                                  {log.to_stage.name}
                                </Badge>
                              ) : (
                                "-"
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {log.reason || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedRule ? "Editar Regra" : "Nova Regra de Auto-move"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da Regra</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Muito Quente para Qualificado"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descreva o objetivo desta regra"
              />
            </div>

            <div className={isEventRule ? "space-y-4" : "grid grid-cols-2 gap-4"}>
              <div className="space-y-2">
                <Label>Tipo de Condição</Label>
                <Select
                  value={formData.condition_type}
                  onValueChange={(value) => setFormData({ ...formData, condition_type: value, condition_value: "" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {conditionTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!isEventRule && (
                <div className="space-y-2">
                  <Label>Operador</Label>
                  <Select
                    value={formData.condition_operator}
                    onValueChange={(value) => setFormData({ ...formData, condition_operator: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {isEventRule ? (
              <p className="text-xs text-muted-foreground">
                Disparada quando o convidado entra na sala de reunião (Daily.co) com a
                reunião já iniciada pelo anfitrião. O lead é movido da etapa de origem
                para a etapa de destino.
              </p>
            ) : (
              <div className="space-y-2">
                <Label>Valor</Label>
                {formData.condition_type === "temperatura" ? (
                  <Select
                    value={formData.condition_value}
                    onValueChange={(value) => setFormData({ ...formData, condition_value: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a temperatura" />
                    </SelectTrigger>
                    <SelectContent>
                      {temperaturas.map((temp) => (
                        <SelectItem key={temp.value} value={temp.value}>
                          {temp.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    value={formData.condition_value}
                    onChange={(e) => setFormData({ ...formData, condition_value: e.target.value })}
                    placeholder={formData.condition_type === "lead_score" ? "Ex: 22" : "Ex: 80"}
                    min={formData.condition_type === "lead_score" ? "6" : "0"}
                    max={formData.condition_type === "lead_score" ? "30" : "100"}
                  />
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>De (Etapa Origem)</Label>
                <Select
                  value={formData.from_stage_id || "any"}
                  onValueChange={(value) => setFormData({ ...formData, from_stage_id: value === "any" ? "" : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Qualquer etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer etapa</SelectItem>
                    {stages?.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Para (Etapa Destino)</Label>
                <Select
                  value={formData.to_stage_id}
                  onValueChange={(value) => setFormData({ ...formData, to_stage_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages?.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Prioridade</Label>
              <Input
                id="priority"
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Maior prioridade é executada primeiro
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => saveMutation.mutate(formData)}
              disabled={saveMutation.isPending || !formData.name || (!isEventRule && !formData.condition_value) || !formData.to_stage_id}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {selectedRule ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Regra</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a regra "{selectedRule?.name}"? 
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedRule && deleteMutation.mutate(selectedRule.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Default Confirmation */}
      <AlertDialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar Regras Padrão</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá remover todas as regras existentes e criar as regras padrão do sistema.
              <br /><br />
              <strong>Regras que serão criadas:</strong>
              <ul className="list-disc list-inside mt-2 text-sm">
                <li>Lead Muito Quente → Qualificado</li>
                <li>Alta Propensão ≥ 80 → Qualificado</li>
                <li>Lead Quente → Qualificado</li>
                <li>Alto Risco ≥ 85 → Lead (reavaliar)</li>
                <li>Lead Frio → Lead</li>
                <li>Reunião realizada (convidado entrou) → MQL para SQL</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => restoreMutation.mutate()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {restoreMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Restaurar Padrão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
