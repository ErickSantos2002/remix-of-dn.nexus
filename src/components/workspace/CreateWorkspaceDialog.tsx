import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";

const WORKSPACE_ICONS = [
  "Briefcase", "Target", "Phone", "Mail", "Users", "ShoppingCart", 
  "MessageSquare", "Headphones", "TrendingUp", "Globe", "Star", "Zap"
];

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const { toast } = useToast();
  const { refetchWorkspaces, setWorkspaceId } = useWorkspace();
  const { companyId, currentCompany } = useCompany();
  const [isLoading, setIsLoading] = useState(false);
  
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Nome obrigatorio",
        description: "Por favor, informe um nome para o workspace.",
      });
      return;
    }

    if (!companyId) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Nenhuma empresa selecionada.",
      });
      return;
    }

    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Usuario nao autenticado.",
      });
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        name: name.trim(),
        icon: icon || null,
        description: description.trim() || null,
        company_id: companyId,
        owner_id: user.id,
        is_default: false,
      })
      .select()
      .single();

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao criar workspace",
        description: error.message,
      });
      setIsLoading(false);
      return;
    }

    toast({
      title: "Workspace criado",
      description: `"${name}" foi criado com sucesso.`,
    });

    // Reset form
    setName("");
    setIcon("");
    setDescription("");
    
    // Refresh and switch to new workspace
    await refetchWorkspaces();
    if (data) {
      setWorkspaceId(data.id);
    }
    
    onOpenChange(false);
    setIsLoading(false);
  };

  const handleClose = () => {
    setName("");
    setIcon("");
    setDescription("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Criar Novo Workspace</DialogTitle>
          <DialogDescription>
            Crie um novo workspace na empresa "{currentCompany?.name || 'sua empresa'}".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Nome *</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Vendas, Suporte, Marketing..."
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label>Icone (opcional)</Label>
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_ICONS.slice(0, 6).map((iconName) => (
                <Button
                  key={iconName}
                  type="button"
                  variant={icon === iconName ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setIcon(iconName)}
                >
                  <span className="text-xs">{iconName.charAt(0)}</span>
                </Button>
              ))}
            </div>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Ou digite um icone..."
              className="bg-background mt-2"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-description">Descricao (opcional)</Label>
            <Textarea
              id="workspace-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o proposito deste workspace..."
              className="bg-background resize-none"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={isLoading || !companyId}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
