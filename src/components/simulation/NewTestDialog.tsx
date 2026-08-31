import { useState, useEffect } from "react";
import { Bot, Loader2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: string;
  name: string;
  category: string | null;
}

interface NewTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onTestCreated: (leadId: string) => void;
}

export function NewTestDialog({
  open,
  onOpenChange,
  workspaceId,
  onTestCreated,
}: NewTestDialogProps) {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [testName, setTestName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  // Fetch agents when dialog opens
  useEffect(() => {
    if (!open || !workspaceId) return;

    const fetchAgents = async () => {
      setIsLoadingAgents(true);
      const { data, error } = await supabase
        .from("agents")
        .select("id, name, category")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .eq("is_archived", false);

      if (error) {
        console.error("Error fetching agents:", error);
        toast({
          variant: "destructive",
          title: "Erro ao carregar agentes",
          description: error.message,
        });
      } else {
        setAgents(data || []);
        if (data && data.length > 0) {
          setSelectedAgentId(data[0].id);
        }
      }
      setIsLoadingAgents(false);
    };

    fetchAgents();
  }, [open, workspaceId, toast]);

  const handleCreateTest = async () => {
    if (!selectedAgentId || !workspaceId) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Selecione um agente para testar.",
      });
      return;
    }

    setIsCreating(true);

    const leadName = testName.trim() || `Teste ${new Date().toLocaleString("pt-BR")}`;

    const { data, error } = await supabase
      .from("leads")
      .insert({
        name: leadName,
        workspace_id: workspaceId,
        status: "ai_talking",
        is_test: true,
        assigned_agent_id: selectedAgentId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating test lead:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar teste",
        description: error.message,
      });
    } else {
      toast({
        title: "Teste criado",
        description: `Simulação "${leadName}" iniciada com sucesso.`,
      });
      onTestCreated(data.id);
      onOpenChange(false);
      setTestName("");
    }

    setIsCreating(false);
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FlaskConical className="h-4 w-4 text-primary" />
            Nova Simulacao
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Inicie uma conversa de teste para testar o comportamento do agente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Test Name */}
          <div className="space-y-1.5">
            <Label htmlFor="test-name" className="text-xs">
              Nome do Teste (opcional)
            </Label>
            <Input
              id="test-name"
              placeholder="Ex: Teste de vendas"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              className="bg-secondary border-border rounded-lg h-8 text-xs"
            />
          </div>

          {/* Agent Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs">Agente para Testar</Label>
            {isLoadingAgents ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Carregando agentes...</span>
              </div>
            ) : agents.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhum agente ativo encontrado neste workspace.
              </p>
            ) : (
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="bg-secondary border-border rounded-lg h-9 text-xs">
                  <SelectValue placeholder="Selecione um agente" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <Bot className="h-3 w-3 text-primary" />
                        <span>{agent.name}</span>
                        {agent.category && (
                          <span className="text-muted-foreground">({agent.category})</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Selected Agent Preview */}
          {selectedAgent && (
            <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs font-medium text-foreground">{selectedAgent.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedAgent.category || "Categoria Geral"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              setTestName("");
            }}
            className="rounded-lg text-xs"
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleCreateTest}
            disabled={isCreating || !selectedAgentId || isLoadingAgents}
            className="rounded-lg text-xs gap-1.5"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Criando...
              </>
            ) : (
              <>
                <FlaskConical className="h-3 w-3" />
                Iniciar Teste
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
