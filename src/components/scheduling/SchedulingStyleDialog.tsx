import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Palette, RotateCcw, ExternalLink } from "lucide-react";
import SchedulingStylePreview from "./SchedulingStylePreview";
import {
  DEFAULT_SCHEDULING_STYLE,
  SCHEDULING_FONTS,
  mergeStyle,
  type RadiusKey,
  type SchedulingStyle,
} from "@/lib/schedulingStyle";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  widgetId: string | null;
  widgetTitle?: string | null;
  widgetDescription?: string | null;
  initialStyle?: Partial<SchedulingStyle> | null;
  onSaved?: (style: SchedulingStyle) => void;
}

const RADIUS_OPTIONS: { value: RadiusKey; label: string }[] = [
  { value: "none", label: "Sem arredondar" },
  { value: "sm", label: "Sutil (4px)" },
  { value: "md", label: "Médio (8px)" },
  { value: "lg", label: "Grande (12px)" },
  { value: "xl", label: "Bem arredondado (16px)" },
  { value: "2xl", label: "Pílula (24px)" },
];

const WEIGHT_OPTIONS = [
  { value: 500, label: "Médio (500)" },
  { value: 600, label: "Semibold (600)" },
  { value: 700, label: "Bold (700)" },
  { value: 800, label: "Extra bold (800)" },
];

/** Color input com swatch + hex sincronizados. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const safe = value && value.startsWith("#") ? value : "#000000";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 rounded-md border border-border bg-transparent cursor-pointer"
          aria-label={label}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9 font-mono text-xs" />
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs text-muted-foreground font-mono">{value}{unit}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

export default function SchedulingStyleDialog({
  open,
  onOpenChange,
  widgetId,
  widgetTitle,
  widgetDescription,
  initialStyle,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [style, setStyle] = useState<SchedulingStyle>(() => mergeStyle(initialStyle));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setStyle(mergeStyle(initialStyle));
  }, [open, initialStyle]);

  const set = <K extends keyof SchedulingStyle>(key: K, value: SchedulingStyle[K]) =>
    setStyle((prev) => ({ ...prev, [key]: value }));

  const handleReset = () => setStyle({ ...DEFAULT_SCHEDULING_STYLE });

  const handleSave = async () => {
    if (!widgetId) return;
    setSaving(true);
    const { error } = await supabase
      .from("scheduling_widgets")
      .update({ style: JSON.parse(JSON.stringify(style)) })
      .eq("id", widgetId);
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar aparência", description: error.message });
      return;
    }
    toast({ title: "Aparência salva!" });
    onSaved?.(style);
    onOpenChange(false);
  };

  const previewUrl = widgetId ? `/schedule/${widgetId}?preview=1` : "#";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-6 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" /> Aparência do Widget
          </DialogTitle>
          <DialogDescription>
            Personalize cores, fontes, tamanhos e logo. As alterações aparecem no preview ao lado em tempo real.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-0 overflow-hidden flex-1">
          {/* Controles */}
          <div className="overflow-y-auto p-6 pt-4 border-r border-border">
            <Tabs defaultValue="cores" className="w-full">
              <TabsList>
                <TabsTrigger value="cores">Cores</TabsTrigger>
                <TabsTrigger value="tipografia">Tipografia</TabsTrigger>
                <TabsTrigger value="tamanhos">Tamanhos</TabsTrigger>
                <TabsTrigger value="logo">Logo</TabsTrigger>
              </TabsList>

              <TabsContent value="cores" className="space-y-4 mt-4">
                <ColorField label="Cor primária (botão / acentos)" value={style.primaryColor} onChange={(v) => set("primaryColor", v)} />
                <ColorField label="Cor do texto do botão" value={style.primaryTextColor} onChange={(v) => set("primaryTextColor", v)} />
                <ColorField label="Cor de fundo da página" value={style.pageBgColor} onChange={(v) => set("pageBgColor", v)} />
                <ColorField label="Cor de fundo do card" value={style.cardBgColor} onChange={(v) => set("cardBgColor", v)} />
                <ColorField label="Cor do texto principal" value={style.textColor} onChange={(v) => set("textColor", v)} />
                <ColorField label="Cor do texto secundário" value={style.mutedTextColor} onChange={(v) => set("mutedTextColor", v)} />
                <ColorField label="Cor de fundo dos campos" value={style.inputBgColor} onChange={(v) => set("inputBgColor", v)} />
                <ColorField label="Cor da borda dos campos" value={style.inputBorderColor} onChange={(v) => set("inputBorderColor", v)} />
                <ColorField label="Cor do texto dos campos" value={style.inputTextColor} onChange={(v) => set("inputTextColor", v)} />
                <ColorField label="Cor de fundo dos botões de horário" value={style.timeButtonBgColor} onChange={(v) => set("timeButtonBgColor", v)} />
                <ColorField label="Cor da borda dos botões de horário" value={style.timeButtonBorderColor} onChange={(v) => set("timeButtonBorderColor", v)} />
                <ColorField label="Cor do texto dos botões de horário" value={style.timeButtonTextColor} onChange={(v) => set("timeButtonTextColor", v)} />
              </TabsContent>

              <TabsContent value="tipografia" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Fonte do título</Label>
                    <Select value={style.titleFont} onValueChange={(v) => set("titleFont", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCHEDULING_FONTS.map((f) => (
                          <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Fonte do corpo</Label>
                    <Select value={style.bodyFont} onValueChange={(v) => set("bodyFont", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCHEDULING_FONTS.map((f) => (
                          <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Peso do título</Label>
                  <Select value={String(style.titleWeight)} onValueChange={(v) => set("titleWeight", Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEIGHT_OPTIONS.map((w) => (
                        <SelectItem key={w.value} value={String(w.value)}>{w.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <SliderField label="Tamanho do título (desktop)" value={style.titleSizeDesktop} min={18} max={48} onChange={(v) => set("titleSizeDesktop", v)} />
                <SliderField label="Tamanho do título (mobile)" value={style.titleSizeMobile} min={16} max={32} onChange={(v) => set("titleSizeMobile", v)} />
                <SliderField label="Tamanho da descrição" value={style.descriptionSize} min={12} max={20} onChange={(v) => set("descriptionSize", v)} />
                <SliderField label="Tamanho dos rótulos dos campos" value={style.labelSize} min={11} max={16} onChange={(v) => set("labelSize", v)} />
                <SliderField label="Tamanho do texto do botão" value={style.ctaSize} min={12} max={20} onChange={(v) => set("ctaSize", v)} />
              </TabsContent>

              <TabsContent value="tamanhos" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Arredondar card</Label>
                    <Select value={style.radiusCard} onValueChange={(v) => set("radiusCard", v as RadiusKey)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{RADIUS_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Arredondar campos</Label>
                    <Select value={style.radiusInput} onValueChange={(v) => set("radiusInput", v as RadiusKey)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{RADIUS_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Arredondar botão</Label>
                  <Select value={style.radiusButton} onValueChange={(v) => set("radiusButton", v as RadiusKey)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RADIUS_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SliderField label="Altura dos campos" value={style.inputHeight} min={36} max={56} onChange={(v) => set("inputHeight", v)} />
                <SliderField label="Altura do botão" value={style.ctaHeight} min={40} max={64} onChange={(v) => set("ctaHeight", v)} />
                <SliderField label="Espaço interno do card" value={style.cardPadding} min={16} max={48} onChange={(v) => set("cardPadding", v)} />
                <SliderField label="Espaço entre campos" value={style.fieldGap} min={8} max={24} onChange={(v) => set("fieldGap", v)} />
              </TabsContent>

              <TabsContent value="logo" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Exibir logo</Label>
                  <Switch
                    checked={style.showLogo}
                    onCheckedChange={(v) => set("showLogo", v)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL do logo</Label>
                  <Input
                    value={style.logoUrl}
                    onChange={(e) => set("logoUrl", e.target.value)}
                    placeholder="https://exemplo.com/logo.png"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Use uma URL pública (PNG ou SVG). Deixe em branco para esconder.
                  </p>
                </div>
                <SliderField label="Altura do logo" value={style.logoHeight} min={24} max={80} onChange={(v) => set("logoHeight", v)} />
                <div className="space-y-1.5">
                  <Label className="text-xs">Alinhamento do cabeçalho</Label>
                  <Select value={style.headerAlign} onValueChange={(v) => set("headerAlign", v as "left" | "center")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="center">Centralizado</SelectItem>
                      <SelectItem value="left">Esquerda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Preview */}
          <div className="overflow-y-auto p-6 pt-4 bg-muted/10">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Pré-visualização</Label>
              {widgetId && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Página inteira
                  </a>
                </Button>
              )}
            </div>
            <SchedulingStylePreview
              style={style}
              title={widgetTitle || "Diagnóstico Gratuito de IA"}
              description={widgetDescription || "Preencha seus dados para descobrir como a IA pode transformar seu negócio."}
            />
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border flex-row items-center justify-between sm:justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1" /> Restaurar padrão
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !widgetId}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : "Salvar aparência"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
