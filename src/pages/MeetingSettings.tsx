import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Video } from "lucide-react";
import { AnalysisPlaybookSelect } from "@/components/crm/AnalysisPlaybookSelect";

const AI_MODELS = [
  {
    value: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash (rápido — recomendado)",
  },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (equilibrado)" },
  {
    value: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite (mais barato)",
  },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (mais preciso)" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-5", label: "GPT-5 (premium)" },
];

interface MeetingSettings {
  workspace_id: string;
  enabled: boolean;
  agent_id: string | null;
  agent_source: "agents" | "agent_instances";
  ai_model: string;
  auto_insights_enabled: boolean;
  auto_insights_delay_ms: number;
}

export default function MeetingSettings() {
  const { workspaceId, agents, isLoadingAgents } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [autoInsights, setAutoInsights] = useState(true);
  const [autoDelayMs, setAutoDelayMs] = useState<number>(4000);
  const [agentKey, setAgentKey] = useState<string>("");
  const [aiModel, setAiModel] = useState<string>(
    "google/gemini-3-flash-preview",
  );
  // Analise aplicada as reunioes criadas pelo agente neste workspace
  const [defaultAnalysisPlaybookId, setDefaultAnalysisPlaybookId] = useState<string>("");

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("workspace_meeting_settings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        toast.error("Erro ao carregar configurações");
      } else if (data) {
        const s = data as MeetingSettings;
        setEnabled(s.enabled);
        setAutoInsights(s.auto_insights_enabled ?? true);
        setAutoDelayMs(s.auto_insights_delay_ms ?? 4000);
        setAiModel(s.ai_model);
        setDefaultAnalysisPlaybookId(
          (data as { default_analysis_playbook_id?: string | null }).default_analysis_playbook_id || "",
        );
        if (s.agent_id) setAgentKey(`${s.agent_source}:${s.agent_id}`);
      }
      setLoading(false);
    })();
  }, [workspaceId]);

  const onSave = async () => {
    if (!workspaceId) return;
    if (enabled && !agentKey) {
      toast.error("Selecione um agente para ativar os insights");
      return;
    }
    setSaving(true);
    const [source, id] = agentKey ? agentKey.split(":") : [null, null];
    const payload = {
      workspace_id: workspaceId,
      enabled,
      agent_id: id,
      agent_source: (source as "agents" | "agent_instances") || "agents",
      ai_model: aiModel,
      auto_insights_enabled: autoInsights,
      auto_insights_delay_ms: autoDelayMs,
      default_analysis_playbook_id: defaultAnalysisPlaybookId || null,
    };
    const { error } = await supabase
      .from("workspace_meeting_settings")
      .upsert(payload as never, { onConflict: "workspace_id" });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Erro ao salvar");
    } else {
      toast.success("Configurações salvas");
    }
  };

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Video className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            Assistente de reunião
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure o agente de IA que ajuda o Host durante reuniões ao vivo.
          </p>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Insights de IA na reunião</CardTitle>
          <CardDescription>
            Quando ativo, o agente escuta a transcrição em tempo real e gera
            insights e sugestões de fala apenas para o Host.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border">
                <div>
                  <Label className="text-sm font-medium">
                    Ativar insights de IA
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Exibido apenas para o Host durante a reunião.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              {enabled && (
                <>
                  <div className="space-y-2">
                    <Label>Agente responsável</Label>
                    <Select
                      value={agentKey}
                      onValueChange={setAgentKey}
                      disabled={isLoadingAgents}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um agente" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents
                          .filter((a) => a.is_active)
                          .map((a) => (
                            <SelectItem
                              key={`${a.source}:${a.id}`}
                              value={`${a.source}:${a.id}`}
                            >
                              {a.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      O system prompt do agente é usado como contexto base.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Modelo de IA</Label>
                    <Select value={aiModel} onValueChange={setAiModel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Modelos mais rápidos respondem antes; modelos premium dão
                      insights mais ricos com maior custo.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border">
                    <div>
                      <Label className="text-sm font-medium">
                        Análise automática
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Quando ativo, gera insights automaticamente após o
                        convidado terminar de falar. Desativado, somente sob
                        demanda.
                      </p>
                    </div>
                    <Switch
                      checked={autoInsights}
                      onCheckedChange={setAutoInsights}
                    />
                  </div>

                  <div
                    className={`space-y-3 p-3 rounded-lg border border-border transition-opacity ${
                      autoInsights ? "" : "opacity-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <Label className="text-sm font-medium">
                        Tempo de espera após a fala do convidado
                      </Label>
                      <span className="font-mono text-sm text-primary">
                        {(autoDelayMs / 1000).toFixed(0)}s
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={15}
                      step={1}
                      value={[Math.round(autoDelayMs / 1000)]}
                      onValueChange={(v) => setAutoDelayMs(v[0] * 1000)}
                      disabled={!autoInsights}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tempo que o assistente aguarda em silêncio antes de gerar
                      o insight. Menor = mais reativo; maior = evita interromper
                      raciocínios longos.
                      {!autoInsights && " (Ative a análise automática para usar.)"}
                    </p>
                  </div>
                </>
              )}

              {/* Independe dos insights ao vivo: vale para toda reunião criada pelo agente */}
              <div className="p-3 rounded-lg border border-border">
                <AnalysisPlaybookSelect
                  activityType="meeting"
                  value={defaultAnalysisPlaybookId}
                  onChange={setDefaultAnalysisPlaybookId}
                  label="Análise padrão das reuniões agendadas pelo agente"
                  description="Aplicada às reuniões que o agente marca pelo chat. Pode ser trocada em cada atividade."
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={onSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salvar configurações
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
