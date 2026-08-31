import { useState, useEffect } from "react";
import { 
  Bot, FileText, Mic2, Settings2, Check, ArrowRight, ArrowLeft, Sparkles, Package, Loader2,
  MessageCircle, Target, BarChart3, Lightbulb, Rocket, Zap, Star, Flame, Gem, Palette, BookOpen,
  Smile, Briefcase, TrendingUp, DollarSign, Wrench, Users, Megaphone, Globe, LucideIcon, SplitSquareHorizontal,
  Calendar, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Enums } from "@/integrations/supabase/types";
import { useToolCatalog, ToolCatalogItem } from "@/hooks/useToolCatalog";
import { useAgentCategories } from "@/hooks/useAgentCategories";

type AgentTone = Enums<"agent_tone">;

interface AgentWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (data: AgentWizardData) => Promise<void>;
  onGoToAgentsProntos?: () => void;
}

export interface AgentWizardData {
  origin: "scratch" | "template";
  name: string;
  icon: string;
  description: string;
  tone: AgentTone;
  systemPrompt: string;
  category: string;
  categoryId: string | null;
  addKnowledgeBase: boolean;
  splitMessages: boolean;
  liveChatEnabled: boolean;
  selectedTools: string[];
  keywords: string[];
  activationDescription: string;
  isDefaultForCategory: boolean;
}

const STEP_LABELS = [
  "Origem",
  "Perfil",
  "Tom de Voz",
  "Configuração",
  "Revisão",
];

interface IconOption {
  id: string;
  Icon: LucideIcon;
}

const ICONS: IconOption[] = [
  { id: "bot", Icon: Bot },
  { id: "message-circle", Icon: MessageCircle },
  { id: "target", Icon: Target },
  { id: "bar-chart", Icon: BarChart3 },
  { id: "lightbulb", Icon: Lightbulb },
  { id: "rocket", Icon: Rocket },
  { id: "zap", Icon: Zap },
  { id: "star", Icon: Star },
  { id: "flame", Icon: Flame },
  { id: "gem", Icon: Gem },
  { id: "palette", Icon: Palette },
  { id: "book-open", Icon: BookOpen },
];

const AgentWizard = ({ open, onOpenChange, onComplete, onGoToAgentsProntos }: AgentWizardProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { tools: availableTools, loading: loadingTools } = useToolCatalog();
  const { categories: dynamicCategories, loading: loadingCategories } = useAgentCategories();

  // Form data
  const [origin, setOrigin] = useState<"scratch" | "template" | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("bot");
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState<AgentTone>("professional");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [category, setCategory] = useState("GERAL");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [addKnowledgeBase, setAddKnowledgeBase] = useState(false);
  const [splitMessages, setSplitMessages] = useState(true);
  const [liveChatEnabled, setLiveChatEnabled] = useState(true);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [activationDescription, setActivationDescription] = useState("");
  const [isDefaultForCategory, setIsDefaultForCategory] = useState(false);

  const resetForm = () => {
    setCurrentStep(1);
    setOrigin(null);
    setName("");
    setIcon("bot");
    setDescription("");
    setTone("professional");
    setSystemPrompt("");
    setCategory("GERAL");
    setCategoryId(null);
    setAddKnowledgeBase(false);
    setSplitMessages(true);
    setLiveChatEnabled(true);
    setSelectedTools([]);
    setKeywords([]);
    setKeywordsInput("");
    setActivationDescription("");
    setIsDefaultForCategory(false);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleNext = () => {
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !origin) return;
    
    setIsSubmitting(true);
    try {
      await onComplete({
        origin,
        name: name.trim(),
        icon,
        description: description.trim(),
        tone,
        systemPrompt: systemPrompt.trim(),
        category,
        categoryId,
        addKnowledgeBase,
        splitMessages,
        liveChatEnabled,
        selectedTools,
        keywords,
        activationDescription: activationDescription.trim(),
        isDefaultForCategory,
      });
      handleClose();
    } catch (error) {
      console.error("Error creating agent:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return origin !== null;
      case 2:
        return name.trim().length > 0;
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const progress = (currentStep / 5) * 100;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] glass-card border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        {/* Header with Progress */}
        <div className="p-6 pb-4 border-b border-border/50 flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Bot className="h-6 w-6 text-primary" />
              Criar Novo Agente
            </DialogTitle>
          </DialogHeader>
          
          {/* Progress Bar */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Passo {currentStep} de 5</span>
              <span className="text-primary font-medium">{STEP_LABELS[currentStep - 1]}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Step Indicators */}
          <div className="flex items-center justify-between mt-4">
            {STEP_LABELS.map((label, index) => (
              <div
                key={index}
                className={cn(
                  "flex flex-col items-center gap-1",
                  index + 1 <= currentStep ? "text-primary" : "text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                    index + 1 < currentStep && "bg-primary text-primary-foreground",
                    index + 1 === currentStep && "bg-primary/20 text-primary border-2 border-primary",
                    index + 1 > currentStep && "bg-muted text-muted-foreground"
                  )}
                >
                  {index + 1 < currentStep ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="text-[10px] hidden sm:block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {/* Step 1: Escolher Origem */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-foreground">Como você quer criar seu agente?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Escolha começar do zero ou usar um template pronto
                </p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={() => setOrigin("scratch")}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left",
                    origin === "scratch"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-card"
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Começar do Zero</h4>
                    <p className="text-sm text-muted-foreground">
                      Crie um agente personalizado do início
                    </p>
                  </div>
                  {origin === "scratch" && (
                    <Check className="h-5 w-5 text-primary" />
                  )}
                </button>

                <button
                  onClick={() => {
                    setOrigin("template");
                    if (onGoToAgentsProntos) {
                      handleClose();
                      onGoToAgentsProntos();
                    }
                  }}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left",
                    origin === "template"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50 hover:bg-card"
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Package className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Usar um Template</h4>
                    <p className="text-sm text-muted-foreground">
                      Clone um agente pronto para usar
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Perfil do Agente */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-foreground">Perfil do Agente</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Defina a identidade do seu agente
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Nome do Agente *</Label>
                  <Input
                    id="agent-name"
                    placeholder="Ex: Alex (Vendas)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-secondary border-border rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Avatar/Ícone</Label>
                  <div className="grid grid-cols-6 gap-2">
                    {ICONS.map(({ id, Icon }) => (
                      <button
                        key={id}
                        onClick={() => setIcon(id)}
                        className={cn(
                          "h-12 w-12 rounded-xl flex items-center justify-center transition-all",
                          icon === id
                            ? "bg-primary/20 border-2 border-primary"
                            : "bg-secondary hover:bg-muted border-2 border-transparent"
                        )}
                      >
                        <Icon className={cn(
                          "h-6 w-6",
                          icon === id ? "text-primary" : "text-muted-foreground"
                        )} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-description">Descrição (opcional)</Label>
                  <Textarea
                    id="agent-description"
                    placeholder="Uma breve descrição do agente..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[80px] bg-secondary border-border rounded-xl resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Tom de Voz */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-foreground">Tom de Voz</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Como seu agente deve se comunicar?
                </p>
              </div>

              <RadioGroup
                value={tone}
                onValueChange={(v) => setTone(v as AgentTone)}
                className="space-y-3"
              >
                <label
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
                    tone === "friendly"
                      ? "border-success bg-success/10"
                      : "border-border hover:border-success/50"
                  )}
                >
                  <RadioGroupItem value="friendly" className="sr-only" />
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success/10">
                    <Smile className="h-6 w-6 text-success" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Amigável</h4>
                    <p className="text-sm text-muted-foreground">
                      Tom acessível e acolhedor, perfeito para atendimento ao cliente
                    </p>
                  </div>
                  {tone === "friendly" && <Check className="h-5 w-5 text-success" />}
                </label>

                <label
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
                    tone === "professional"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <RadioGroupItem value="professional" className="sr-only" />
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Briefcase className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Profissional</h4>
                    <p className="text-sm text-muted-foreground">
                      Tom formal e objetivo, ideal para comunicação corporativa
                    </p>
                  </div>
                  {tone === "professional" && <Check className="h-5 w-5 text-primary" />}
                </label>

                <label
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all",
                    tone === "aggressive"
                      ? "border-destructive bg-destructive/10"
                      : "border-border hover:border-destructive/50"
                  )}
                >
                  <RadioGroupItem value="aggressive" className="sr-only" />
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
                    <TrendingUp className="h-6 w-6 text-destructive" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Agressivo</h4>
                    <p className="text-sm text-muted-foreground">
                      Tom direto e persuasivo, ideal para vendas e conversões
                    </p>
                  </div>
                  {tone === "aggressive" && <Check className="h-5 w-5 text-destructive" />}
                </label>
              </RadioGroup>
            </div>
          )}

          {/* Step 4: Configuração Técnica */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-foreground">Configuração Técnica</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Defina o comportamento e categoria do agente
                </p>
              </div>

              <div className="space-y-4">
                <ExpandableTextarea
                  id="system-prompt"
                  label="System Prompt"
                  placeholder="Descreva como o agente deve se comportar...&#10;&#10;Ex: Você é um assistente de vendas especializado em software. Seu objetivo é qualificar leads e agendar demonstrações. Seja sempre cordial e focado em resolver as dúvidas do cliente."
                  value={systemPrompt}
                  onChange={setSystemPrompt}
                  description="Instruções detalhadas de como o agente deve se comportar nas conversas."
                  minHeight="150px"
                  modalTitle="Editar System Prompt"
                />

                <div className="space-y-2">
                  <Label htmlFor="category">Categoria</Label>
                  <Select 
                    value={categoryId || ""} 
                    onValueChange={(v) => {
                      setCategoryId(v);
                      const cat = dynamicCategories.find(c => c.id === v);
                      if (cat) setCategory(cat.slug);
                    }}
                  >
                    <SelectTrigger className="bg-secondary border-border rounded-xl">
                      <SelectValue placeholder={loadingCategories ? "Carregando..." : "Selecione a categoria"} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {dynamicCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">{cat.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A categoria define para qual tipo de pergunta este agente será selecionado.
                  </p>
                </div>

                <div className="flex items-center space-x-3 p-4 rounded-xl bg-secondary/50 border border-border">
                  <Checkbox
                    id="add-kb"
                    checked={addKnowledgeBase}
                    onCheckedChange={(checked) => setAddKnowledgeBase(checked as boolean)}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="add-kb"
                      className="text-sm font-medium text-foreground cursor-pointer"
                    >
                      Adicionar base de conhecimento agora?
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Você pode adicionar uma base de conhecimento ao agente após criá-lo
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-4 rounded-xl bg-secondary/50 border border-border">
                  <Checkbox
                    id="split-messages"
                    checked={splitMessages}
                    onCheckedChange={(checked) => setSplitMessages(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="split-messages"
                      className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2"
                    >
                      <SplitSquareHorizontal className="h-4 w-4 text-primary" />
                      Quebrar mensagens
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Divide respostas longas em mensagens menores para parecer mais humano
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-4 rounded-xl bg-secondary/50 border border-border">
                  <Checkbox
                    id="live-chat-enabled"
                    checked={liveChatEnabled}
                    onCheckedChange={(checked) => setLiveChatEnabled(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="live-chat-enabled"
                      className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-2"
                    >
                      <MessageCircle className="h-4 w-4 text-primary" />
                      Habilitado no chat ao vivo
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Quando desativado, este agente não será selecionado automaticamente para responder leads no chat ao vivo nem no widget
                    </p>
                  </div>
                </div>


                {/* Tools Selection */}
                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    Tools (Ferramentas)
                  </Label>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Habilite ferramentas que o agente poderá usar durante as conversas
                  </p>
                  
                  {loadingTools ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : availableTools.length === 0 ? (
                    <div className="p-4 rounded-xl bg-muted/50 text-center">
                      <p className="text-sm text-muted-foreground">Nenhuma ferramenta disponível</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {availableTools.map((tool) => {
                        const isSelected = selectedTools.includes(tool.id);
                        const hasSetupRequirements = tool.requires_setup && tool.requires_setup.length > 0;
                        
                        return (
                          <div
                            key={tool.id}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-xl border transition-all",
                              isSelected 
                                ? "border-primary bg-primary/5" 
                                : "border-border bg-secondary/50 hover:border-primary/30"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "p-2 rounded-lg",
                                isSelected ? "bg-primary/20" : "bg-muted"
                              )}>
                                <Calendar className={cn(
                                  "h-4 w-4",
                                  isSelected ? "text-primary" : "text-muted-foreground"
                                )} />
                              </div>
                              <div>
                                <p className={cn(
                                  "text-sm font-medium",
                                  isSelected ? "text-foreground" : "text-muted-foreground"
                                )}>
                                  {tool.label}
                                </p>
                                {tool.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">
                                    {tool.description}
                                  </p>
                                )}
                                {hasSetupRequirements && (
                                  <p className="text-xs text-warning flex items-center gap-1 mt-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Requer configuração
                                  </p>
                                )}
                              </div>
                            </div>
                            <Switch
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedTools([...selectedTools, tool.id]);
                                } else {
                                  setSelectedTools(selectedTools.filter(id => id !== tool.id));
                                }
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Revisão */}
          {currentStep === 5 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-foreground">Revisar e Ativar</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Confira as informações antes de criar o agente
                </p>
              </div>

              <div className="glass-card p-4 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                    {(() => {
                      const selectedIcon = ICONS.find(i => i.id === icon);
                      if (selectedIcon) {
                        const IconComponent = selectedIcon.Icon;
                        return <IconComponent className="h-8 w-8 text-primary" />;
                      }
                      return <Bot className="h-8 w-8 text-primary" />;
                    })()}
                  </div>
                  <div>
                    <h4 className="font-semibold text-lg text-foreground">{name || "Sem nome"}</h4>
                    {description && (
                      <p className="text-sm text-muted-foreground">{description}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-secondary/50">
                    <span className="text-xs text-muted-foreground block mb-1">Tom de Voz</span>
                    <span className="text-sm font-medium text-foreground flex items-center gap-2">
                      {tone === "friendly" && <><Smile className="h-4 w-4 text-success" /> Amigável</>}
                      {tone === "professional" && <><Briefcase className="h-4 w-4 text-primary" /> Profissional</>}
                      {tone === "aggressive" && <><TrendingUp className="h-4 w-4 text-destructive" /> Agressivo</>}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary/50">
                    <span className="text-xs text-muted-foreground block mb-1">Categoria</span>
                    <span className="text-sm font-medium text-foreground flex items-center gap-2">
                      {category === "VENDAS" && <><DollarSign className="h-4 w-4" /> Vendas</>}
                      {category === "SUPORTE" && <><Wrench className="h-4 w-4" /> Suporte</>}
                      {category === "RH" && <><Users className="h-4 w-4" /> RH</>}
                      {category === "MARKETING" && <><Megaphone className="h-4 w-4" /> Marketing</>}
                      {category === "GERAL" && <><Globe className="h-4 w-4" /> Geral</>}
                    </span>
                  </div>
                </div>

                {systemPrompt && (
                  <div className="p-3 rounded-lg bg-secondary/50">
                    <span className="text-xs text-muted-foreground block mb-1">System Prompt</span>
                    <p className="text-sm text-foreground line-clamp-3">
                      {systemPrompt.substring(0, 200)}
                      {systemPrompt.length > 200 && "..."}
                    </p>
                  </div>
                )}

                {addKnowledgeBase && (
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <span className="text-sm text-primary flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Base de conhecimento será configurada após criação
                    </span>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-secondary/50">
                  <span className="text-xs text-muted-foreground block mb-1">Quebra de Mensagens</span>
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    <SplitSquareHorizontal className={`h-4 w-4 ${splitMessages ? "text-primary" : "text-muted-foreground"}`} />
                    {splitMessages ? "Ativado" : "Desativado"}
                  </span>
                </div>

                {selectedTools.length > 0 && (
                  <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                    <span className="text-xs text-muted-foreground block mb-2">Tools Habilitadas</span>
                    <div className="flex flex-wrap gap-2">
                      {selectedTools.map(toolId => {
                        const tool = availableTools.find(t => t.id === toolId);
                        return tool ? (
                          <span key={toolId} className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-lg flex items-center gap-1">
                            <Wrench className="h-3 w-3" />
                            {tool.label}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-4 border-t border-border/50 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={currentStep === 1 ? handleClose : handleBack}
            className="rounded-xl gap-2 border-border"
          >
            {currentStep === 1 ? (
              "Cancelar"
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </>
            )}
          </Button>

          {currentStep < 5 ? (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="rounded-xl gap-2"
            >
              Próximo
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
              className="rounded-xl gap-2 glow-primary"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Criar Agente
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgentWizard;
