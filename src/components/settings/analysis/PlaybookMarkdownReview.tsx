import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { AnalysisPlaybook } from "@/types/analysis";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, FileUp, Loader2, Save } from "lucide-react";

// Tabelas de análise ainda não presentes em types.ts (auto-gerado pelo Lovable).
/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_FILE_SIZE_MB = 9;

interface Props {
  playbook: AnalysisPlaybook;
}

/**
 * Passo "Playbook" do cadastro de uma análise:
 * upload do .docx -> conversão para Markdown -> revisão/edição -> aprovação.
 *
 * A aprovação é obrigatória porque o parser de .docx é aproximado: o admin é a
 * válvula de correção antes de o conteúdo virar rubrica.
 */
export function PlaybookMarkdownReview({ playbook }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [markdown, setMarkdown] = useState(playbook.playbook_md ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setMarkdown(playbook.playbook_md ?? "");
  }, [playbook.id, playbook.playbook_md]);

  const isApproved = !!playbook.md_approved_at;
  const hasUnsavedEdits = markdown !== (playbook.playbook_md ?? "");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["analysis-playbooks"] });
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Permite reenviar o mesmo arquivo depois de um erro
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".docx")) {
      toast({
        title: "Formato não suportado",
        description: "Envie o playbook em .docx.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: `O limite é ${MAX_FILE_SIZE_MB} MB.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("playbook-ingest", {
        body: { playbook_id: playbook.id, filename: file.name, file_base64: base64 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMarkdown(data.playbook_md ?? "");
      refresh();
      toast({
        title: "Playbook convertido",
        description: `${data.stats?.headings ?? 0} seções identificadas. Revise o conteúdo e aprove.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível converter o arquivo.";
      toast({ title: "Erro no upload", description: message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveEdits = async () => {
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("analysis_playbooks") as any)
        .update({ playbook_md: markdown, md_approved_at: null })
        .eq("id", playbook.id);
      if (error) throw error;
      refresh();
      toast({ title: "Alterações salvas", description: "Aprove o conteúdo para liberar a rubrica." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!markdown.trim()) {
      toast({
        title: "Conteúdo vazio",
        description: "Envie o playbook antes de aprovar.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("analysis_playbooks") as any)
        .update({ playbook_md: markdown, md_approved_at: new Date().toISOString() })
        .eq("id", playbook.id);
      if (error) throw error;
      refresh();
      toast({ title: "Playbook aprovado", description: "Agora você pode gerar a rubrica de avaliação." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível aprovar.";
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Label>Arquivo do playbook</Label>
          <p className="text-xs text-muted-foreground">
            {playbook.playbook_filename
              ? `Último envio: ${playbook.playbook_filename}`
              : "Nenhum arquivo enviado ainda. Formato aceito: .docx"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isApproved ? (
            <Badge className="badge-success gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Aprovado
            </Badge>
          ) : (
            markdown && <Badge className="badge-warning">Aguardando aprovação</Badge>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            {playbook.playbook_md ? "Enviar novo arquivo" : "Enviar .docx"}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="playbook-markdown">Conteúdo convertido (Markdown)</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {markdown.length.toLocaleString("pt-BR")} caracteres
          </span>
        </div>
        <Textarea
          id="playbook-markdown"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={18}
          placeholder="O conteúdo do playbook aparece aqui após o upload. Você pode corrigir o que a conversão não capturou bem."
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          A conversão preserva os títulos do documento (capítulos, etapas, blocos). Corrija o que ficou fora do
          lugar antes de aprovar — é deste conteúdo que a rubrica é extraída.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleApprove} disabled={isSaving || !markdown.trim()}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          {isApproved ? "Aprovar novamente" : "Aprovar Markdown"}
        </Button>
        <Button variant="outline" onClick={handleSaveEdits} disabled={isSaving || !hasUnsavedEdits}>
          <Save className="h-4 w-4 mr-2" />
          Salvar sem aprovar
        </Button>
      </div>
    </div>
  );
}
