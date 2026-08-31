import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Brain } from "lucide-react";

const DEFAULT_PROMPTS: Record<string, string> = {
  meeting:
    "Analise esta transcrição de reunião e forneça:\n1) Resumo executivo\n2) Principais decisões tomadas\n3) Ações acordadas e responsáveis\n4) Pontos de atenção\n5) Próximos passos recomendados",
  demo:
    "Analise esta transcrição de demonstração comercial e forneça:\n1) Resumo da demo\n2) Funcionalidades que mais interessaram o prospect\n3) Objeções levantadas\n4) Nível de interesse percebido (alto/médio/baixo)\n5) Recomendações para follow-up",
};

interface Props {
  companyId: string;
}

export function MeetingAnalysisPromptsCard({ companyId }: Props) {
  const { toast } = useToast();
  const [meetingPrompt, setMeetingPrompt] = useState(DEFAULT_PROMPTS.meeting);
  const [demoPrompt, setDemoPrompt] = useState(DEFAULT_PROMPTS.demo);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPrompts = async () => {
      setIsLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("meeting_analysis_prompts") as any)
        .select("activity_type, prompt_text")
        .eq("company_id", companyId);

      if (data) {
        for (const row of data as Array<{ activity_type: string; prompt_text: string }>) {
          if (row.activity_type === "meeting") setMeetingPrompt(row.prompt_text);
          if (row.activity_type === "demo") setDemoPrompt(row.prompt_text);
        }
      }
      setIsLoading(false);
    };
    fetchPrompts();
  }, [companyId]);

  const handleSave = async (type: "meeting" | "demo") => {
    setIsSaving(true);
    const promptText = type === "meeting" ? meetingPrompt : demoPrompt;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("meeting_analysis_prompts") as any)
        .upsert(
          { company_id: companyId, activity_type: type, prompt_text: promptText, updated_at: new Date().toISOString() },
          { onConflict: "company_id,activity_type" }
        );
      if (error) throw error;
      toast({ title: "Sucesso", description: `Prompt de ${type === "meeting" ? "reunião" : "demo"} salvo` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = (type: "meeting" | "demo") => {
    if (type === "meeting") setMeetingPrompt(DEFAULT_PROMPTS.meeting);
    else setDemoPrompt(DEFAULT_PROMPTS.demo);
  };

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Análise de Reuniões (IA)
        </CardTitle>
        <CardDescription>
          Configure os prompts usados pela IA para analisar transcrições de reuniões e demos
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="meeting" className="w-full">
          <TabsList>
            <TabsTrigger value="meeting">Reunião</TabsTrigger>
            <TabsTrigger value="demo">Demo</TabsTrigger>
          </TabsList>

          <TabsContent value="meeting" className="space-y-3">
            <div className="space-y-2">
              <Label>Prompt para análise de reuniões</Label>
              <Textarea
                value={meetingPrompt}
                onChange={(e) => setMeetingPrompt(e.target.value)}
                rows={6}
                placeholder="Instruções para a IA analisar transcrições de reuniões..."
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                A transcrição da reunião será enviada junto com este prompt para a IA.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => handleSave("meeting")} disabled={isSaving} className="flex-1">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar Prompt
              </Button>
              <Button variant="outline" onClick={() => handleReset("meeting")} disabled={isSaving}>
                Restaurar padrão
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="demo" className="space-y-3">
            <div className="space-y-2">
              <Label>Prompt para análise de demos</Label>
              <Textarea
                value={demoPrompt}
                onChange={(e) => setDemoPrompt(e.target.value)}
                rows={6}
                placeholder="Instruções para a IA analisar transcrições de demos..."
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                A transcrição da demo será enviada junto com este prompt para a IA.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => handleSave("demo")} disabled={isSaving} className="flex-1">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar Prompt
              </Button>
              <Button variant="outline" onClick={() => handleReset("demo")} disabled={isSaving}>
                Restaurar padrão
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
