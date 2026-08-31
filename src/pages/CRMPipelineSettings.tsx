import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, GripVertical, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Stage {
  id: string;
  name: string;
  description: string | null;
  color: string;
  order: number;
  is_default: boolean;
  meta_event_name: string | null;
  meta_event_is_custom: boolean;
  warning_after_hours: number;
  danger_after_hours: number;
}


const META_STANDARD_EVENTS = [
  "Lead",
  "Contact",
  "Schedule",
  "CompleteRegistration",
  "SubmitApplication",
  "Subscribe",
  "Purchase",
];

const defaultColors = [
  // excecao DS: cor e dado do usuario, nao token de tema
  "#FF8000",
  "#4A9EFF",
  "#9B59B6",
  "#F39C12",
  "#27AE60",
  "#E74C3C",
  "#3498DB",
  "#1ABC9C",
];

function SortableStageRow({
  stage,
  index,
  onEdit,
  onDelete,
}: {
  stage: Stage;
  index: number;
  onEdit: (stage: Stage) => void;
  onDelete: (stage: Stage) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-3 border-b border-border bg-card ${
        isDragging ? "z-50 shadow-lg" : ""
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
      >
        <GripVertical className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Stage info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{stage.name}</p>
        {stage.description && (
          <p className="text-xs text-muted-foreground truncate">
            {stage.description}
          </p>
        )}
      </div>

      {/* Color */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded border border-border flex-shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <span className="text-sm font-mono text-muted-foreground hidden sm:inline">
          {stage.color}
        </span>
      </div>

      {/* Position */}
      <div className="w-12 text-center">
        <span className="font-mono text-sm text-muted-foreground">{index + 1}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onEdit(stage)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => onDelete(stage)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function CRMPipelineSettings() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [deleteStage, setDeleteStage] = useState<Stage | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#FF8000",
    meta_event_mode: "none" as "none" | "standard" | "custom",
    meta_event_name: "",
    warning_after_hours: 72,
    danger_after_hours: 168,
  });
  const [selectedLossReasonIds, setSelectedLossReasonIds] = useState<string[]>([]);


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Fetch stages
  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["crm-stages", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("order", { ascending: true });
      if (error) throw error;
      return data as Stage[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch active loss reasons for this workspace
  const { data: lossReasons = [] } = useQuery({
    queryKey: ["crm-loss-reasons-settings", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_loss_reasons")
        .select("id, name")
        .eq("workspace_id", currentWorkspace.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: !!currentWorkspace?.id,
  });

  // Save stage mutation
  const saveStage = useMutation({
    mutationFn: async () => {
      if (!currentWorkspace?.id) return;

      const metaEventName =
        formData.meta_event_mode === "none"
          ? null
          : (formData.meta_event_name || "").trim() || null;

      const stageData = {
        workspace_id: currentWorkspace.id,
        name: formData.name,
        description: formData.description || null,
        color: formData.color,
        meta_event_name: metaEventName,
        meta_event_is_custom: formData.meta_event_mode === "custom",
        warning_after_hours: Math.max(0, Number(formData.warning_after_hours) || 0),
        danger_after_hours: Math.max(0, Number(formData.danger_after_hours) || 0),
      };


      let stageId: string;
      if (editingStage) {
        const { error } = await supabase
          .from("crm_pipeline_stages")
          .update(stageData)
          .eq("id", editingStage.id);
        if (error) throw error;
        stageId = editingStage.id;
      } else {
        const nextOrder = stages.length;
        const { data: inserted, error } = await supabase
          .from("crm_pipeline_stages")
          .insert({ ...stageData, order: nextOrder })
          .select("id")
          .single();
        if (error) throw error;
        stageId = inserted.id;
      }

      // Sync loss reason links
      const { error: delErr } = await supabase
        .from("crm_stage_loss_reasons")
        .delete()
        .eq("stage_id", stageId);
      if (delErr) throw delErr;

      if (selectedLossReasonIds.length > 0) {
        const { error: insErr } = await supabase
          .from("crm_stage_loss_reasons")
          .insert(
            selectedLossReasonIds.map((loss_reason_id) => ({
              stage_id: stageId,
              loss_reason_id,
            }))
          );
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-stages"] });
      queryClient.invalidateQueries({ queryKey: ["crm-stage-loss-reasons"] });
      setIsDialogOpen(false);
      setEditingStage(null);
      setFormData({ name: "", description: "", color: "#FF8000", meta_event_mode: "none", meta_event_name: "", warning_after_hours: 72, danger_after_hours: 168 });
      setSelectedLossReasonIds([]);

      toast({ title: editingStage ? "Estágio atualizado" : "Estágio criado" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Erro ao salvar estágio",
        description: "Verifique os dados e tente novamente.",
      });
    },
  });

  // Delete stage mutation
  const removeStage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("crm_pipeline_stages")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-stages"] });
      setDeleteStage(null);
      toast({ title: "Estágio excluído" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Este estágio pode ter leads associados.",
      });
    },
  });

  // Reorder stages mutation
  const reorderStages = useMutation({
    mutationFn: async (newOrder: { id: string; order: number }[]) => {
      for (const item of newOrder) {
        await supabase
          .from("crm_pipeline_stages")
          .update({ order: item.order })
          .eq("id", item.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-stages"] });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Erro ao reordenar",
        description: "Tente novamente.",
      });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(stages, oldIndex, newIndex);
    const updates = reordered.map((stage, index) => ({
      id: stage.id,
      order: index,
    }));

    reorderStages.mutate(updates);
  };

  const openEditDialog = async (stage: Stage) => {
    setEditingStage(stage);
    const mode: "none" | "standard" | "custom" = !stage.meta_event_name
      ? "none"
      : stage.meta_event_is_custom
        ? "custom"
        : "standard";
    setFormData({
      name: stage.name,
      description: stage.description || "",
      color: stage.color,
      meta_event_mode: mode,
      meta_event_name: stage.meta_event_name || "",
      warning_after_hours: stage.warning_after_hours ?? 72,
      danger_after_hours: stage.danger_after_hours ?? 168,
    });

    // Load existing loss reason links for this stage
    const { data: links } = await supabase
      .from("crm_stage_loss_reasons")
      .select("loss_reason_id")
      .eq("stage_id", stage.id);
    setSelectedLossReasonIds((links || []).map((l) => l.loss_reason_id));

    setIsDialogOpen(true);
  };

  const openNewDialog = () => {
    setEditingStage(null);
    setFormData({ name: "", description: "", color: "#FF8000", meta_event_mode: "none", meta_event_name: "", warning_after_hours: 72, danger_after_hours: 168 });
    setSelectedLossReasonIds([]);
    setIsDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/crm/pipeline")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Configurar Pipeline
            </h1>
            <p className="text-sm text-muted-foreground">
              Arraste para reordenar os estágios
            </p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Estágio
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-card border-border max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingStage ? "Editar Estágio" : "Novo Estágio"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Ex: Qualificado"
                />
                {editingStage && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(editingStage.id);
                      toast({ title: "ID copiado para a área de transferência" });
                    }}
                    className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Clique para copiar o UUID"
                  >
                    {editingStage.id}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Descrição do estágio..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={formData.color}
                    onChange={(e) =>
                      setFormData({ ...formData, color: e.target.value })
                    }
                    className="w-12 h-10 p-1 cursor-pointer"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {defaultColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                        style={{ backgroundColor: color }}
                        onClick={() => setFormData({ ...formData, color })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Tempo na etapa - thresholds de cor */}
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Tempo do card na etapa</Label>
                <p className="text-xs text-muted-foreground">
                  Quando o card ficar parado nesta etapa por mais que estes limites, o badge de tempo muda de cor. Use 0 para desativar.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-warning">Atenção (horas)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={formData.warning_after_hours}
                      onChange={(e) =>
                        setFormData({ ...formData, warning_after_hours: Number(e.target.value) })
                      }
                      placeholder="72"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-destructive">Alerta (horas)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={formData.danger_after_hours}
                      onChange={(e) =>
                        setFormData({ ...formData, danger_after_hours: Number(e.target.value) })
                      }
                      placeholder="168"
                    />
                  </div>
                </div>
              </div>

              {/* Meta Ads Integration */}
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Evento Meta Ads</Label>
                <p className="text-xs text-muted-foreground">
                  Disparado para a Meta (Conversions API) toda vez que um card entrar nesta etapa.
                </p>
                <Select
                  value={formData.meta_event_mode === "standard"
                    ? formData.meta_event_name || "__pick__"
                    : formData.meta_event_mode}
                  onValueChange={(value) => {
                    if (value === "none") {
                      setFormData({ ...formData, meta_event_mode: "none", meta_event_name: "" });
                    } else if (value === "custom") {
                      setFormData({ ...formData, meta_event_mode: "custom" });
                    } else {
                      setFormData({ ...formData, meta_event_mode: "standard", meta_event_name: value });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {META_STANDARD_EVENTS.map((evt) => (
                      <SelectItem key={evt} value={evt}>{evt}</SelectItem>
                    ))}
                    <SelectItem value="custom">Evento personalizado…</SelectItem>
                  </SelectContent>
                </Select>
                {formData.meta_event_mode === "custom" && (
                  <Input
                    value={formData.meta_event_name}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        meta_event_name: e.target.value.replace(/[^A-Za-z0-9_]/g, ""),
                      })
                    }
                    placeholder="Ex: MQL_Qualificado"
                  />
                )}
              </div>

              {/* Motivos de perda permitidos */}
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Motivos de perda permitidos</Label>
                <p className="text-xs text-muted-foreground">
                  Selecione os motivos de perda que ficarão disponíveis quando um lead nesta etapa for marcado como perdido. Se nenhum for selecionado, todos os motivos ativos ficam disponíveis.
                </p>
                {lossReasons.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    Nenhum motivo de perda cadastrado. Cadastre em Configurações da Empresa.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-2 rounded-md border border-border p-3">
                    {lossReasons.map((reason) => {
                      const checked = selectedLossReasonIds.includes(reason.id);
                      return (
                        <label
                          key={reason.id}
                          className="flex items-center gap-2 cursor-pointer text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setSelectedLossReasonIds((prev) =>
                                v
                                  ? [...prev, reason.id]
                                  : prev.filter((id) => id !== reason.id)
                              );
                            }}
                          />
                          <span>{reason.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedLossReasonIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedLossReasonIds([])}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Limpar seleção (permitir todos)
                  </button>
                )}
              </div>


              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => saveStage.mutate()}
                  disabled={
                    !formData.name ||
                    saveStage.isPending ||
                    (formData.meta_event_mode === "custom" && !formData.meta_event_name.trim())
                  }
                >
                  {editingStage ? "Salvar" : "Criar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stages List with Drag & Drop */}
      <div className="glass-card flex-1 overflow-auto">
        {/* Header */}
        <div className="flex items-center gap-4 p-3 border-b border-border bg-muted/30 text-sm font-medium text-muted-foreground">
          <div className="w-8"></div>
          <div className="flex-1">Estágio</div>
          <div className="w-32">Cor</div>
          <div className="w-12 text-center">Pos.</div>
          <div className="w-20">Ações</div>
        </div>

        {stages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {isLoading ? "Carregando..." : "Nenhum estágio cadastrado"}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={stages.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {stages.map((stage, index) => (
                <SortableStageRow
                  key={stage.id}
                  stage={stage}
                  index={index}
                  onEdit={openEditDialog}
                  onDelete={setDeleteStage}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteStage} onOpenChange={() => setDeleteStage(null)}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir estágio?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteStage?.name}"? Leads neste
              estágio precisarão ser movidos antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteStage && removeStage.mutate(deleteStage.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
