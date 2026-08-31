import { useState } from "react";
import { Code, Clock, FileText, Brain, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface DebugData {
  detected_intent?: string;
  rag_documents?: Array<{
    content: string;
    similarity: number;
    knowledge_base_id?: string;
  }>;
  response_time_ms?: number;
  prompt_sent?: string;
  model_used?: string;
  tokens_used?: number;
}

interface DebugInsightsProps {
  debugData: DebugData | null;
}

export function DebugInsights({ debugData }: DebugInsightsProps) {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isRagOpen, setIsRagOpen] = useState(false);

  if (!debugData) {
    return (
      <div className="space-y-2">
        <h4 className="text-[10px] font-medium text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Code className="h-3 w-3" />
          DEBUG MODE
        </h4>
        <p className="text-xs text-muted-foreground italic bg-background/50 p-2 rounded-lg">
          Dados de debug serao exibidos aqui apos a primeira interacao.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <h4 className="text-[10px] font-medium text-primary uppercase tracking-wider flex items-center gap-1.5">
        <Code className="h-3 w-3" />
        DEBUG MODE
      </h4>

      {/* Intent Detected */}
      {debugData.detected_intent && (
        <div className="bg-background/50 p-2.5 rounded-lg space-y-1">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3 w-3 text-primary" />
            <span className="text-[10px] text-muted-foreground uppercase">Intent Detectado</span>
          </div>
          <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border-primary/30">
            {debugData.detected_intent}
          </Badge>
        </div>
      )}

      {/* Response Time */}
      {debugData.response_time_ms !== undefined && (
        <div className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">Tempo de Resposta</span>
          </div>
          <Badge 
            variant="outline" 
            className={cn(
              "text-[10px] px-2 py-0.5 font-mono",
              debugData.response_time_ms < 1000 
                ? "bg-success/20 text-success border-success/30" 
                : debugData.response_time_ms < 3000 
                  ? "bg-warning/20 text-warning border-warning/30"
                  : "bg-destructive/20 text-destructive border-destructive/30"
            )}
          >
            {debugData.response_time_ms}ms
          </Badge>
        </div>
      )}

      {/* Model & Tokens */}
      {(debugData.model_used || debugData.tokens_used !== undefined) && (
        <div className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">Modelo</span>
          </div>
          <div className="flex items-center gap-2">
            {debugData.model_used && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-muted">
                {debugData.model_used}
              </Badge>
            )}
            {debugData.tokens_used !== undefined && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {debugData.tokens_used} tokens
              </span>
            )}
          </div>
        </div>
      )}

      {/* RAG Documents */}
      {debugData.rag_documents && debugData.rag_documents.length > 0 && (
        <Collapsible open={isRagOpen} onOpenChange={setIsRagOpen}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg hover:bg-background/70 transition-colors">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-primary" />
                <span className="text-[10px] text-muted-foreground uppercase">
                  Documentos RAG ({debugData.rag_documents.length})
                </span>
              </div>
              {isRagOpen ? (
                <ChevronUp className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {debugData.rag_documents.map((doc, idx) => (
              <div 
                key={idx} 
                className="bg-muted/50 border border-border p-2 rounded-lg space-y-1"
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[8px] px-1 py-0">
                    Doc #{idx + 1}
                  </Badge>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    Similaridade: {(doc.similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-[10px] text-foreground line-clamp-3">
                  {doc.content}
                </p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Prompt Sent */}
      {debugData.prompt_sent && (
        <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between bg-primary/5 border border-primary/20 p-2.5 rounded-lg hover:bg-primary/10 transition-colors">
              <div className="flex items-center gap-1.5">
                <Code className="h-3 w-3 text-primary" />
                <span className="text-[10px] text-primary uppercase font-medium">
                  Ver Prompt Completo
                </span>
              </div>
              {isPromptOpen ? (
                <ChevronUp className="h-3 w-3 text-primary" />
              ) : (
                <ChevronDown className="h-3 w-3 text-primary" />
              )}
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="bg-card border border-border p-3 rounded-lg">
              <pre className="text-[10px] text-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-[300px] overflow-y-auto">
                {debugData.prompt_sent}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Separator />
      
      <p className="text-[9px] text-muted-foreground italic text-center">
        Modo de simulacao ativo - dados de debug visiveis apenas para admins
      </p>
    </div>
  );
}
