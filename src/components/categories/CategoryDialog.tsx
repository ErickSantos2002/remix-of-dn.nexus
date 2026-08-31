import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORY_ICONS, CATEGORY_COLORS } from "./categoryIcons";

export interface CategoryFormData {
  name: string;
  description: string;
  icon: string;
  color: string;
  priority: number;
  sla_minutes: number;
  is_active: boolean;
  agent_ids: string[];
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  priority: number | null;
  sla_minutes: number | null;
  is_active: boolean | null;
  assigned_agents: { id: string; name: string }[];
}

interface WorkspaceMember {
  id: string;
  name: string | null;
  email: string;
}

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: CategoryFormData) => Promise<void>;
  category: Category | null;
  members: WorkspaceMember[];
}

export function CategoryDialog({
  open,
  onOpenChange,
  onSave,
  category,
  members,
}: CategoryDialogProps) {
  const [formData, setFormData] = useState<CategoryFormData>({
    name: "",
    description: "",
    icon: "globe",
    color: "#3D61FF",
    priority: 1,
    sla_minutes: 30,
    is_active: true,
    agent_ids: [],
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (category) {
      setFormData({
        name: category.name,
        description: category.description || "",
        icon: category.icon || "globe",
        color: category.color || "#3D61FF",
        priority: category.priority ?? 1,
        sla_minutes: category.sla_minutes ?? 30,
        is_active: category.is_active ?? true,
        agent_ids: category.assigned_agents.map(a => a.id),
      });
    } else {
      setFormData({
        name: "",
        description: "",
        icon: "globe",
        color: "#3D61FF",
        priority: 1,
        sla_minutes: 30,
        is_active: true,
        agent_ids: [],
      });
    }
  }, [category, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setIsSaving(true);
    try {
      await onSave(formData);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setFormData(prev => ({
      ...prev,
      agent_ids: prev.agent_ids.includes(agentId)
        ? prev.agent_ids.filter(id => id !== agentId)
        : [...prev.agent_ids, agentId]
    }));
  };

  const SelectedIcon = CATEGORY_ICONS.find(i => i.value === formData.icon)?.icon || CATEGORY_ICONS[0].icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {category ? "Editar Categoria" : "Nova Categoria"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4 pb-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Suporte Técnico"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descreva o propósito desta categoria..."
                  rows={2}
                  className="resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ícone</Label>
                  <Select
                    value={formData.icon}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, icon: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <SelectedIcon className="h-4 w-4" />
                          <span>{CATEGORY_ICONS.find(i => i.value === formData.icon)?.label}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent side="bottom" className="max-h-60 overflow-y-auto">
                      {CATEGORY_ICONS.map(({ value, label, icon: Icon }) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            <span>{label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Cor</Label>
                  <Select
                    value={formData.color}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, color: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <div 
                            className="h-4 w-4 rounded-full" 
                            style={{ backgroundColor: formData.color }}
                          />
                          <span>{CATEGORY_COLORS.find(c => c.value === formData.color)?.label}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_COLORS.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="h-4 w-4 rounded-full" 
                              style={{ backgroundColor: value }}
                            />
                            <span>{label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select
                    value={formData.priority.toString()}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, priority: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Baixa</SelectItem>
                      <SelectItem value="1">Normal</SelectItem>
                      <SelectItem value="2">Alta</SelectItem>
                      <SelectItem value="3">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sla">SLA (minutos)</Label>
                  <Input
                    id="sla"
                    type="number"
                    min={5}
                    value={formData.sla_minutes}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      sla_minutes: Math.max(5, parseInt(e.target.value) || 5) 
                    }))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground">
                    Categoria ativa para roteamento
                  </p>
                </div>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Agentes Designados</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Selecione os agentes humanos que atenderão esta categoria
                </p>
                <div className="border border-border rounded-lg p-3 space-y-2 max-h-[150px] overflow-y-auto">
                  {members.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic text-center py-2">
                      Nenhum membro disponível
                    </p>
                  ) : (
                    members.map(member => (
                      <div 
                        key={member.id} 
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggleAgent(member.id)}
                      >
                        <Checkbox
                          checked={formData.agent_ids.includes(member.id)}
                          onCheckedChange={() => toggleAgent(member.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {member.name || "Sem nome"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {member.email}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {formData.agent_ids.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formData.agent_ids.length} agente(s) selecionado(s)
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving || !formData.name.trim()}>
              {isSaving ? "Salvando..." : category ? "Salvar Alterações" : "Criar Categoria"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
