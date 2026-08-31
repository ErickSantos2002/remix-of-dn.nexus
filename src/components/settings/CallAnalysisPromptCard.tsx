import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, Phone } from "lucide-react";

const DEFAULT_PROMPT_PHONE_CALL =
  "Analise esta transcrição de chamada telefônica e forneça:\n1) Resumo da conversa\n2) Objetivo do cliente / motivo do contato\n3) Objeções ou dúvidas levantadas\n4) Nível de interesse percebido (alto/médio/baixo)\n5) Compromissos ou próximos passos acordados\n6) Recomendações para follow-up";

interface Props {
  companyId: string;
}

export function CallAnalysisPromptCard({ companyId }: Props) {
  const { toast } = useToast();
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_PHONE_CALL);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPrompt = async () => {
      setIsLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("meeting_analysis_prompts") as any)
        .select("prompt_text")
        .eq("company_id", companyId)
        .eq("activity_type", "phone_call")
        .maybeSingle();

      if (data?.prompt_text) {
        setPromptText(data.prompt_text);
      }
      setIsLoading(false);
    };
    fetchPrompt();
  }, [companyId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("meeting_analysis_prompts") as any)
        .upsert(
          {
            company_id: companyId,
            activity_type: "phone_call",
            prompt_text: promptText,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,activity_type" }
        );
      if (error) throw error;
      toast({ title: "Sucesso", description: "Prompt de análise de ligações salvo" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast({ title: "Erro", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setPromptText(DEFAULT_PROMPT_PHONE_CALL);
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
          <Phone className="h-5 w-5 text-primary" />
          Análise de Ligações (IA)
        </CardTitle>
        <CardDescription>
          Configure o prompt usado pela IA para analisar transcrições de chamadas telefônicas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Prompt para análise de ligações</Label>
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={8}
              placeholder="Instruções para a IA analisar transcrições de chamadas telefônicas..."
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              A transcrição da chamada será enviada junto com este prompt para a IA.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar Prompt
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isSaving}>
              Restaurar padrão
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
