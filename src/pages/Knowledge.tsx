import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, BookOpen, Upload, FileText, Loader2, Trash2, Clock, CheckCircle, AlertCircle, XCircle, RotateCcw, ChevronRight, Download } from "lucide-react";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  created_at: string | null;
}

interface Document {
  id: number;
  content: string;
  created_at: string | null;
  metadata: unknown;
}

interface ProcessingJob {
  id: string;
  filename: string;
  file_size: number;
  status: string;
  chunks_created: number;
  embeddings_generated: number;
  error_message: string | null;
  created_at: string;
  storage_path: string;
  started_at?: string | null;
  max_pages?: number | null;
  embedding_status?: string | null;
  embeddings_total?: number | null;
}

// Calculate progress percentage for a processing job
const getJobProgress = (job: ProcessingJob): number => {
  if (job.status === "completed" && job.embedding_status === "completed") return 100;
  if (job.status === "completed" && job.embedding_status === "processing") {
    // Embedding phase: 80-99%
    if (job.embeddings_total && job.embeddings_generated) {
      return 80 + Math.round((job.embeddings_generated / job.embeddings_total) * 19);
    }
    return 85;
  }
  if (job.status === "completed") return 80; // Document processed, waiting for embeddings
  if (job.status === "failed") return 0;
  if (job.status === "pending") return 2;
  
  // New format: "Processando: X% (Y/Z chunks)"
  if (job.error_message) {
    const percentMatch = job.error_message.match(/(\d+)%/);
    if (percentMatch) {
      // Scale to 0-80% range (document processing phase)
      return Math.min(Math.round(parseInt(percentMatch[1], 10) * 0.8), 79);
    }
    
    // Old format: "Processando: pagina X/Y"
    const pageMatch = job.error_message.match(/pagina (\d+)\/(\d+)/i);
    if (pageMatch) {
      const current = parseInt(pageMatch[1], 10);
      const total = parseInt(pageMatch[2], 10);
      if (total > 0) {
        return Math.min(Math.round((current / total) * 80), 79);
      }
    }
  }
  
  // Fallback: if we have chunks, estimate progress
  if (job.chunks_created > 0) {
    return Math.min(Math.round((job.chunks_created / 10) * 8), 79);
  }
  
  return 5; // Default: show some progress
};

// Get user-friendly processing stage
interface ProcessingStage {
  text: string;
  failed: boolean;
  icon: 'pending' | 'reading' | 'extracting' | 'embedding' | 'done' | 'failed';
}

const getProcessingStage = (job: ProcessingJob): ProcessingStage => {
  if (job.status === "failed") {
    return { text: "Falhou", failed: true, icon: 'failed' };
  }
  if (job.embedding_status === "failed") {
    return { text: "Falhou ao preparar busca", failed: true, icon: 'failed' };
  }
  if (job.status === "pending") {
    return { text: "Aguardando...", failed: false, icon: 'pending' };
  }
  if (job.status === "processing" && job.chunks_created === 0) {
    return { text: "Lendo documento...", failed: false, icon: 'reading' };
  }
  if (job.status === "processing" && job.chunks_created > 0) {
    return { text: `Extraindo conteudo... (${job.chunks_created} partes)`, failed: false, icon: 'extracting' };
  }
  if (job.status === "completed" && job.embedding_status === "incomplete") {
    const progress = job.embeddings_total && job.embeddings_generated 
      ? `${job.embeddings_generated}/${job.embeddings_total}`
      : '';
    return { text: `Continuando... ${progress}`, failed: false, icon: 'embedding' };
  }
  if (job.status === "completed" && job.embedding_status === "processing") {
    const progress = job.embeddings_total && job.embeddings_generated 
      ? `${job.embeddings_generated}/${job.embeddings_total}`
      : '';
    return { text: `Preparando busca... ${progress}`, failed: false, icon: 'embedding' };
  }
  if (job.status === "completed" && job.embedding_status === "completed") {
    return { text: "Pronto", failed: false, icon: 'done' };
  }
  if (job.status === "completed") {
    return { text: "Finalizando...", failed: false, icon: 'embedding' };
  }
  return { text: "Processando...", failed: false, icon: 'reading' };
};

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".json"];
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const RECOMMENDED_PDF_SIZE_MB = 10;
const RECOMMENDED_PDF_SIZE_BYTES = RECOMMENDED_PDF_SIZE_MB * 1024 * 1024;
// Max processing time before showing "stuck" warning (5 minutes - reduced for faster detection)
const MAX_PROCESSING_TIME_MS = 5 * 60 * 1000;
// Dead job detection (no update for 2 minutes)
const DEAD_JOB_THRESHOLD_MS = 2 * 60 * 1000;

// Sanitize filename for storage path
const sanitizeFileName = (name: string): string => {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-zA-Z0-9._-]/g, "_") // Replace special chars with underscore
    .replace(/_+/g, "_") // Collapse multiple underscores
    .toLowerCase();
};

// Format processing time
const formatProcessingTime = (startedAt: string | null): string => {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);
  if (diffMins > 0) {
    return `${diffMins}m ${diffSecs}s`;
  }
  return `${diffSecs}s`;
};

// Check if job is stuck (processing for too long)
const isJobStuck = (job: ProcessingJob): boolean => {
  if (job.status !== "processing") return false;
  if (!job.started_at) return false;
  const start = new Date(job.started_at).getTime();
  return Date.now() - start > MAX_PROCESSING_TIME_MS;
};

// Check if job is dead (no progress update for too long)
const isJobDead = (job: ProcessingJob): boolean => {
  if (job.status !== "processing" && job.status !== "pending") return false;
  // Use updated_at from job metadata if available, otherwise created_at
  const lastUpdate = job.started_at ? new Date(job.started_at).getTime() : new Date(job.created_at).getTime();
  return Date.now() - lastUpdate > DEAD_JOB_THRESHOLD_MS;
};

const Knowledge = () => {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [kbName, setKbName] = useState("");
  const [kbDescription, setKbDescription] = useState("");

  const [documentsMap, setDocumentsMap] = useState<Record<string, Document[]>>({});
  const [processingJobsMap, setProcessingJobsMap] = useState<Record<string, ProcessingJob[]>>({});
  const [loadingDocuments, setLoadingDocuments] = useState<Record<string, boolean>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [cancellingJob, setCancellingJob] = useState<string | null>(null);
  const [reprocessingJob, setReprocessingJob] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    filename: string;
    kbId: string;
    storagePath?: string;
  } | null>(null);
  const [deleteKbConfirm, setDeleteKbConfirm] = useState<KnowledgeBase | null>(null);
  const [deletingKb, setDeletingKb] = useState(false);
  
  // Track which jobs we've already triggered regeneration for
  const regeneratedJobsRef = useRef<Set<string>>(new Set());

  const fetchKnowledgeBases = async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    const { data, error } = await supabase
      .from("knowledge_bases")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching knowledge bases:", error);
      toast({
        variant: "destructive",
        title: "Erro ao carregar bases",
        description: error.message,
      });
    } else {
      setKnowledgeBases(data || []);
    }
    setIsLoading(false);
  };

  const fetchDocuments = async (knowledgeBaseId: string, showLoading = true) => {
    if (showLoading) {
      setLoadingDocuments((prev) => ({ ...prev, [knowledgeBaseId]: true }));
    }

    // Fetch documents
    const { data: docsData, error: docsError } = await supabase
      .from("documents")
      .select("id, content, created_at, metadata")
      .eq("knowledge_base_id", knowledgeBaseId)
      .order("created_at", { ascending: false });

    if (docsError) {
      console.error("Error fetching documents:", docsError);
    } else {
      setDocumentsMap((prev) => ({ ...prev, [knowledgeBaseId]: docsData || [] }));
    }

    // Fetch processing jobs
    const { data: jobsData, error: jobsError } = await supabase
      .from("document_processing_jobs")
      .select("*")
      .eq("knowledge_base_id", knowledgeBaseId)
      .order("created_at", { ascending: false });

    if (!jobsError && jobsData) {
      setProcessingJobsMap((prev) => ({ ...prev, [knowledgeBaseId]: jobsData as ProcessingJob[] }));
    }

    if (showLoading) {
      setLoadingDocuments((prev) => ({ ...prev, [knowledgeBaseId]: false }));
    }
  };

  useEffect(() => {
    fetchKnowledgeBases();
  }, [workspaceId]);

  const handleCreateKnowledgeBase = async () => {
    if (!kbName.trim()) {
      toast({
        variant: "destructive",
        title: "Nome obrigatório",
        description: "Por favor, insira um nome para a base de conhecimento.",
      });
      return;
    }

    if (!workspaceId) {
      toast({
        variant: "destructive",
        title: "Workspace não selecionado",
        description: "Selecione um workspace primeiro.",
      });
      return;
    }

    setIsCreating(true);

    const { error } = await supabase.from("knowledge_bases").insert({
      name: kbName.trim(),
      description: kbDescription.trim() || null,
      workspace_id: workspaceId,
    });

    if (error) {
      console.error("Error creating knowledge base:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar base",
        description: error.message,
      });
    } else {
      toast({
        title: "Base criada!",
        description: `A base "${kbName}" foi criada com sucesso.`,
      });
      setKbName("");
      setKbDescription("");
      setIsDialogOpen(false);
      await fetchKnowledgeBases();
    }

    setIsCreating(false);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    knowledgeBaseId: string
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingFor(knowledgeBaseId);

    for (const file of Array.from(files)) {
      const fileName = file.name.toLowerCase();
      const isSupported = SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext));

      if (!isSupported) {
        toast({
          variant: "destructive",
          title: "Formato não suportado",
          description: `O arquivo "${file.name}" não é suportado.`,
        });
        continue;
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        const isPdf = fileName.endsWith(".pdf");
        toast({
          variant: "destructive",
          title: "Arquivo muito grande",
          description: isPdf 
            ? `O arquivo "${file.name}" excede ${MAX_FILE_SIZE_MB}MB. Divida o PDF em partes menores usando ferramentas como iLovePDF ou SmallPDF.`
            : `O arquivo "${file.name}" excede o limite de ${MAX_FILE_SIZE_MB}MB.`,
        });
        continue;
      }

      // Warning for large PDFs
      const isPdfFile = fileName.endsWith(".pdf");
      if (isPdfFile && file.size > RECOMMENDED_PDF_SIZE_BYTES) {
        toast({
          title: "Arquivo grande detectado",
          description: `"${file.name}" (${(file.size / 1024 / 1024).toFixed(0)}MB) pode demorar mais para processar. Para melhor performance, considere arquivos menores que ${RECOMMENDED_PDF_SIZE_MB}MB.`,
        });
      }

      try {
        // 1. Upload file to storage
        const safeFileName = sanitizeFileName(file.name);
        const storagePath = `${knowledgeBaseId}/${Date.now()}_${safeFileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from("knowledge-documents")
          .upload(storagePath, file);

        if (uploadError) {
          throw new Error(`Falha ao fazer upload: ${uploadError.message}`);
        }

        // 2. Create processing job
        const { data: jobData, error: jobError } = await supabase
          .from("document_processing_jobs")
          .insert({
            knowledge_base_id: knowledgeBaseId,
            storage_path: storagePath,
            filename: file.name,
            file_size: file.size,
            status: "pending",
          })
          .select("id")
          .single();

        if (jobError) {
          throw new Error(`Falha ao criar job: ${jobError.message}`);
        }

        // 3. Trigger background processing
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document-background`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ job_id: jobData.id }),
          }
        );

        if (!response.ok) {
          console.warn("Background processing started but may take time");
        }

        toast({
          title: "Upload iniciado!",
          description: `"${file.name}" está sendo processado em background. Tamanho: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
        });
      } catch (err) {
        console.error("Error uploading file:", err);
        toast({
          variant: "destructive",
          title: "Erro ao fazer upload",
          description: err instanceof Error ? err.message : `Não foi possível processar "${file.name}".`,
        });
      }
    }

    setUploadingFor(null);
    await fetchDocuments(knowledgeBaseId);
    e.target.value = "";
  };

  const handleDeleteDocument = async (docId: number, kbId: string) => {
    const { error } = await supabase.from("documents").delete().eq("id", docId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error.message,
      });
    } else {
      toast({
        title: "Documento excluído",
        description: "O documento foi removido da base.",
      });
      await fetchDocuments(kbId);
    }
  };

  const confirmDeleteFailedJob = (jobId: string, filename: string, kbId: string, storagePath?: string) => {
    setDeleteConfirm({ id: jobId, filename, kbId, storagePath });
  };

  const executeDeleteFailedJob = async () => {
    if (!deleteConfirm) return;

    const { id: jobId, filename, kbId, storagePath } = deleteConfirm;
    setDeleteConfirm(null);

    try {
      // 1. Delete file from Storage (if exists)
      if (storagePath) {
        try {
          await supabase.storage
            .from("knowledge-documents")
            .remove([storagePath]);
        } catch (storageError) {
          console.log("Arquivo não encontrado no storage:", storageError);
        }
      }

      // 2. Delete processing job record
      const { error: deleteError } = await supabase
        .from("document_processing_jobs")
        .delete()
        .eq("id", jobId);

      if (deleteError) throw deleteError;

      // 3. Delete associated chunks (if any)
      await supabase
        .from("documents")
        .delete()
        .eq("knowledge_base_id", kbId)
        .filter("metadata->filename", "eq", filename);

      // 4. Show success
      toast({
        title: "Arquivo removido",
        description: `"${filename}" foi deletado com sucesso.`,
      });

      // 5. Reload list
      await fetchDocuments(kbId);
    } catch (error) {
      console.error("Erro ao deletar arquivo:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  };

  // Cancel a stuck or processing job - also deletes file and chunks
  const handleCancelJob = async (job: ProcessingJob, kbId: string) => {
    setCancellingJob(job.id);
    try {
      // 1. Mark as cancelled immediately
      await supabase
        .from("document_processing_jobs")
        .update({ 
          status: "failed", 
          error_message: "Cancelado pelo usuario" 
        })
        .eq("id", job.id);

      // 2. Delete file from storage
      if (job.storage_path) {
        try {
          await supabase.storage
            .from("knowledge-documents")
            .remove([job.storage_path]);
          console.log("Arquivo removido do storage:", job.storage_path);
        } catch (storageError) {
          console.log("Arquivo nao encontrado no storage:", storageError);
        }
      }

      // 3. Delete any chunks already created
      const { error: deleteChunksError } = await supabase
        .from("documents")
        .delete()
        .eq("knowledge_base_id", kbId)
        .filter("metadata->>job_id", "eq", job.id);

      if (deleteChunksError) {
        console.error("Erro ao deletar chunks:", deleteChunksError);
      }

      // 4. Delete the job record
      const { error: deleteJobError } = await supabase
        .from("document_processing_jobs")
        .delete()
        .eq("id", job.id);

      if (deleteJobError) {
        console.error("Erro ao deletar job:", deleteJobError);
      }

      toast({
        title: "Processamento cancelado",
        description: `"${job.filename}" foi cancelado e removido.`,
      });

      await fetchDocuments(kbId);
    } catch (error) {
      console.error("Erro ao cancelar job:", error);
      toast({
        variant: "destructive",
        title: "Erro ao cancelar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    } finally {
      setCancellingJob(null);
    }
  };

  // Download document file from storage
  const handleDownloadJob = async (job: ProcessingJob) => {
    if (!job.storage_path) {
      toast({
        variant: "destructive",
        title: "Arquivo indisponível",
        description: "Este documento não possui arquivo armazenado.",
      });
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from("knowledge-documents")
        .download(job.storage_path);
      if (error || !data) throw error || new Error("Falha ao baixar");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Download error:", err);
      toast({
        variant: "destructive",
        title: "Erro ao baixar",
        description: err?.message || "Não foi possível baixar o arquivo.",
      });
    }
  };

  // Reprocess a failed job
  const handleReprocessJob = async (job: ProcessingJob, kbId: string) => {
    setReprocessingJob(job.id);
    try {
      // Reset job status
      const { error: updateError } = await supabase
        .from("document_processing_jobs")
        .update({ 
          status: "pending",
          error_message: null,
          chunks_created: 0,
          embeddings_generated: 0,
          started_at: null
        })
        .eq("id", job.id);

      if (updateError) throw updateError;

      // Delete any existing chunks from this job
      await supabase
        .from("documents")
        .delete()
        .eq("knowledge_base_id", kbId)
        .filter("metadata->job_id", "eq", job.id);

      // Trigger background processing
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document-background`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ job_id: job.id }),
        }
      );

      if (!response.ok) {
        console.warn("Reprocessing started but may take time");
      }

      toast({
        title: "Reprocessamento iniciado",
        description: `"${job.filename}" está sendo reprocessado.`,
      });

      await fetchDocuments(kbId);
    } catch (error) {
      console.error("Erro ao reprocessar:", error);
      toast({
        variant: "destructive",
        title: "Erro ao reprocessar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    } finally {
      setReprocessingJob(null);
    }
  };

  // Delete entire knowledge base
  const handleDeleteKnowledgeBase = async (kb: KnowledgeBase) => {
    setDeletingKb(true);
    try {
      // 1. Fetch all jobs to get storage paths
      const { data: jobs } = await supabase
        .from("document_processing_jobs")
        .select("storage_path")
        .eq("knowledge_base_id", kb.id);

      // 2. Delete files from storage
      if (jobs && jobs.length > 0) {
        const paths = jobs.map(j => j.storage_path).filter(Boolean);
        if (paths.length > 0) {
          await supabase.storage.from("knowledge-documents").remove(paths);
        }
      }

      // 3. Delete all documents
      await supabase.from("documents").delete().eq("knowledge_base_id", kb.id);

      // 4. Delete all processing jobs
      await supabase.from("document_processing_jobs").delete().eq("knowledge_base_id", kb.id);

      // 5. Remove associations with agents
      await supabase.from("agent_knowledge_bases").delete().eq("knowledge_base_id", kb.id);

      // 6. Delete the knowledge base
      const { error } = await supabase.from("knowledge_bases").delete().eq("id", kb.id);

      if (error) throw error;

      toast({
        title: "Base excluída",
        description: `"${kb.name}" foi removida com sucesso.`,
      });

      // 7. Clear local state and refresh
      setDeleteKbConfirm(null);
      setDocumentsMap(prev => {
        const next = { ...prev };
        delete next[kb.id];
        return next;
      });
      setProcessingJobsMap(prev => {
        const next = { ...prev };
        delete next[kb.id];
        return next;
      });
      await fetchKnowledgeBases();
    } catch (error) {
      console.error("Erro ao deletar base:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    } finally {
      setDeletingKb(false);
    }
  };

  // Auto-trigger embedding generation for completed jobs without embeddings
  // Also auto-cleanup stuck/failed jobs
  useEffect(() => {
    const handleAutoProcessing = async () => {
      const allJobs = Object.values(processingJobsMap).flat();
      const now = Date.now();
      
      // Auto-cleanup: Mark very old processing jobs as failed
      for (const job of allJobs) {
        if (job.status === "processing" || job.status === "pending") {
          const jobAge = now - new Date(job.created_at).getTime();
          // If job is older than 30 minutes and still processing, it's stuck
          if (jobAge > 30 * 60 * 1000 && !regeneratedJobsRef.current.has(`cleanup_${job.id}`)) {
            regeneratedJobsRef.current.add(`cleanup_${job.id}`);
            console.log(`[AUTO-CLEANUP] Marking stuck job as failed: ${job.id}`);
            
            await supabase
              .from("document_processing_jobs")
              .update({ 
                status: "failed", 
                error_message: "Processamento travado - timeout automatico" 
              })
              .eq("id", job.id);
          }
        }
      }
      
      // Find jobs that are completed but need embeddings (including incomplete ones that need continuation)
      const jobsNeedingEmbeddings = allJobs.filter(job => 
        job.status === "completed" && 
        (!job.embedding_status || job.embedding_status === "pending" || job.embedding_status === "failed" || job.embedding_status === "incomplete") &&
        !regeneratedJobsRef.current.has(`${job.id}_${job.embedding_status}`)
      );

      for (const job of jobsNeedingEmbeddings) {
        // Use unique key including status to allow re-trigger for incomplete jobs
        regeneratedJobsRef.current.add(`${job.id}_${job.embedding_status}`);
        console.log(`[AUTO-EMBED] Triggering embeddings for job: ${job.id} (status: ${job.embedding_status})`);
        
        try {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-embeddings-background`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({ job_id: job.id }),
            }
          );
        } catch (error) {
          console.error(`[AUTO-EMBED] Error for job ${job.id}:`, error);
        }
      }
    };

    handleAutoProcessing();
  }, [processingJobsMap]);

  // Auto-refresh processing jobs (including embedding generation)
  useEffect(() => {
    const ACTIVE_JOB_THRESHOLD_MS = 30 * 60 * 1000;
    const now = Date.now();
    
    const hasActiveJobs = Object.values(processingJobsMap).some(jobs => 
      jobs.some(j => {
        const jobAge = now - new Date(j.created_at).getTime();
        if (jobAge > ACTIVE_JOB_THRESHOLD_MS) return false;
        
        return j.status === "processing" || 
               j.status === "pending" ||
               (j.status === "completed" && j.embedding_status === "processing");
      })
    );

    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      Object.keys(processingJobsMap).forEach(kbId => {
        const jobs = processingJobsMap[kbId] || [];
        const hasActive = jobs.some(j => {
          const jobAge = now - new Date(j.created_at).getTime();
          if (jobAge > ACTIVE_JOB_THRESHOLD_MS) return false;
          
          return j.status === "processing" || 
                 j.status === "pending" ||
                 (j.status === "completed" && j.embedding_status === "processing");
        });
        if (hasActive) {
          fetchDocuments(kbId, false);
        }
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [processingJobsMap]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-warning" />;
      case "processing":
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string, embeddingStatus?: string | null) => {
    // Simplified status for users
    if (status === "completed") {
      if (embeddingStatus === "processing") {
        return (
          <Badge variant="default" className="text-xs bg-primary/80">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            Processando
          </Badge>
        );
      }
      if (embeddingStatus === "completed") {
        return (
          <Badge variant="outline" className="text-xs text-success border-success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Pronto
          </Badge>
        );
      }
      // For pending or failed embeddings, show as "Processando" and auto-retry
      return (
        <Badge variant="default" className="text-xs bg-primary/80">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          Processando
        </Badge>
      );
    }

    if (status === "processing" || status === "pending") {
      return (
        <Badge variant="default" className="text-xs bg-primary/80">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          Processando
        </Badge>
      );
    }

    if (status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          Falhou
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="text-xs">
        {status}
      </Badge>
    );
  };

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Selecione um workspace para gerenciar bases de conhecimento.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-background min-h-screen">
      <Breadcrumbs />
      
      {/* Global Progress Indicator - Detailed per document */}
      {(() => {
        // Create array of jobs with their kbId
        const allJobsWithKb: Array<{ job: ProcessingJob; kbId: string }> = [];
        Object.entries(processingJobsMap).forEach(([kbId, jobs]) => {
          jobs.forEach(job => allJobsWithKb.push({ job, kbId }));
        });
        
        const activeJobs = allJobsWithKb.filter(({ job }) => 
          job.status === "processing" || 
          job.status === "pending" ||
          (job.status === "completed" && job.embedding_status === "processing")
        );
        const failedJobs = allJobsWithKb.filter(({ job }) => 
          job.status === "failed" || job.embedding_status === "failed"
        );
        const readyJobs = allJobsWithKb.filter(({ job }) => 
          job.status === "completed" && job.embedding_status === "completed"
        );
        
        const hasActiveOrFailed = activeJobs.length > 0 || failedJobs.length > 0;
        
        if (!hasActiveOrFailed) return null;
        
        // Calculate average progress
        const jobsForProgress = [...activeJobs, ...readyJobs];
        const avgProgress = jobsForProgress.length > 0 
          ? Math.round(jobsForProgress.reduce((sum, { job }) => sum + getJobProgress(job), 0) / jobsForProgress.length)
          : 0;
        
        // Filter jobs to show (not completed)
        const jobsToShow = allJobsWithKb.filter(({ job }) => 
          job.status !== "completed" || 
          job.embedding_status !== "completed"
        );
        
        return (
          <div className="glass-card p-4 animate-fade-in space-y-4">
            {/* Header with global progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {activeJobs.length > 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : failedJobs.length > 0 ? (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <CheckCircle className="h-4 w-4 text-success" />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {activeJobs.length > 0 
                      ? `Processando documentos`
                      : failedJobs.length > 0 
                        ? `${failedJobs.length} ${failedJobs.length === 1 ? 'documento falhou' : 'documentos falharam'}`
                        : 'Todos prontos'
                    }
                  </span>
                </div>
                <span className="text-sm font-mono text-muted-foreground">
                  {readyJobs.length} de {allJobsWithKb.length - failedJobs.length} prontos
                </span>
              </div>
              {activeJobs.length > 0 && (
                <Progress value={avgProgress} className="h-2" />
              )}
            </div>
            
            {/* Individual document progress */}
            {jobsToShow.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {jobsToShow.map(({ job, kbId }) => {
                  const stage = getProcessingStage(job);
                  const progress = getJobProgress(job);
                  const truncatedName = job.filename.length > 35 
                    ? job.filename.substring(0, 32) + '...' 
                    : job.filename;
                  
                  return (
                    <div key={job.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-secondary/30">
                      {/* Icon based on state */}
                      <div className="flex-shrink-0">
                        {stage.icon === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                        {stage.icon === 'done' && <CheckCircle className="h-4 w-4 text-success" />}
                        {stage.icon === 'pending' && <Clock className="h-4 w-4 text-muted-foreground" />}
                        {(stage.icon === 'reading' || stage.icon === 'extracting' || stage.icon === 'embedding') && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                      </div>
                      
                      {/* Filename */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground truncate" title={job.filename}>
                            {truncatedName}
                          </span>
                          <span className={`text-xs flex-shrink-0 ${stage.failed ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {stage.text}
                          </span>
                        </div>
                        {/* Progress bar for active jobs */}
                        {!stage.failed && stage.icon !== 'done' && (
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={progress} className="h-1 flex-1" />
                            <span className="text-xs font-mono text-muted-foreground w-8 text-right">
                              {progress}%
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {/* Reprocess button for failed jobs */}
                      {stage.failed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-primary hover:text-primary"
                          onClick={() => handleReprocessJob(job, kbId)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
      
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bases de Conhecimento</h1>
          <p className="mt-1 text-muted-foreground">
            Gerencie suas bases de conhecimento para RAG.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-2 glow-primary">
              <Plus className="h-4 w-4" />
              Nova Base
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] glass-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Nova Base de Conhecimento
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Crie uma nova base para armazenar documentos.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="kb-name">Nome</Label>
                <Input
                  id="kb-name"
                  placeholder="Ex: FAQ de Produtos"
                  value={kbName}
                  onChange={(e) => setKbName(e.target.value)}
                  className="bg-secondary border-border rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kb-description">Descrição</Label>
                <Textarea
                  id="kb-description"
                  placeholder="Descreva o conteúdo desta base..."
                  value={kbDescription}
                  onChange={(e) => setKbDescription(e.target.value)}
                  className="min-h-[100px] bg-secondary border-border rounded-xl resize-none"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                className="rounded-xl border-border"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateKnowledgeBase}
                disabled={isCreating}
                className="rounded-xl"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar Base"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Supported formats */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-muted-foreground">Formatos:</span>
        {SUPPORTED_EXTENSIONS.map((ext) => (
          <Badge key={ext} variant="secondary" className="text-xs">
            {ext}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground ml-2">
          (máx. {MAX_FILE_SIZE_MB}MB)
        </span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : knowledgeBases.length === 0 ? (
        <div className="glass-card border-dashed">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg mb-1 text-foreground">
              Nenhuma base de conhecimento
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Crie sua primeira base para treinar seus agentes.
            </p>
            <Button
              className="mt-4 rounded-xl gap-2"
              onClick={() => setIsDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Criar Primeira Base
            </Button>
          </div>
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {knowledgeBases.map((kb) => (
            <AccordionItem
              key={kb.id}
              value={kb.id}
              className="glass-card border-border rounded-xl overflow-hidden"
            >
              <AccordionTrigger
                className="px-6 py-4 hover:no-underline group"
                onClick={() => {
                  if (!documentsMap[kb.id]) {
                    fetchDocuments(kb.id);
                  }
                }}
              >
                <div className="flex items-center gap-3 text-left flex-1">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{kb.name}</h3>
                    {kb.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {kb.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteKbConfirm(kb);
                    }}
                    title="Excluir base de conhecimento"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-6 pb-6">
                {/* Upload */}
                <div className="mb-6">
                  <label
                    htmlFor={`file-upload-${kb.id}`}
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-secondary/50 transition-colors"
                  >
                    {uploadingFor === kb.id ? (
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Clique para fazer upload (até {MAX_FILE_SIZE_MB}MB)
                        </p>
                      </>
                    )}
                  </label>
                  <input
                    id={`file-upload-${kb.id}`}
                    type="file"
                    className="hidden"
                    accept={SUPPORTED_EXTENSIONS.join(",")}
                    multiple
                    onChange={(e) => handleFileUpload(e, kb.id)}
                    disabled={uploadingFor === kb.id}
                  />
                </div>

                {/* Processing Jobs - Collapsible */}
                {processingJobsMap[kb.id] && processingJobsMap[kb.id].length > 0 && (
                  <Collapsible defaultOpen={false} className="mb-6">
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-foreground mb-3 hover:text-primary transition-colors group w-full">
                      <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                      <span>Processamento</span>
                      <Badge variant="secondary" className="text-xs ml-auto">
                        {processingJobsMap[kb.id].length}
                      </Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-3 ml-6">
                        {processingJobsMap[kb.id].map((job) => {
                          const stuck = isJobStuck(job);
                          const dead = isJobDead(job);
                          const hasIssue = stuck || dead;
                          const progress = getJobProgress(job);
                          const isActive = job.status === "processing" || job.status === "pending";
                          
                          return (
                            <div
                              key={job.id}
                              className={`p-4 rounded-xl ${
                                hasIssue ? 'bg-warning/10 border border-warning/30' : 
                                job.status === "failed" ? 'bg-destructive/10 border border-destructive/30' :
                                'bg-secondary/30'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                  {hasIssue ? (
                                    <AlertCircle className="h-4 w-4 text-warning" />
                                  ) : (
                                    getStatusIcon(job.status)
                                  )}
                                  <div>
                                    <p className="text-sm font-medium text-foreground">
                                      {job.filename}
                                      {stuck && (
                                        <Badge variant="outline" className="ml-2 text-xs text-warning border-warning">
                                          Travado
                                        </Badge>
                                      )}
                                      {dead && !stuck && (
                                        <Badge variant="outline" className="ml-2 text-xs text-destructive border-destructive">
                                          Sem resposta
                                        </Badge>
                                      )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {(job.file_size / 1024 / 1024).toFixed(1)}MB
                                      {isActive && job.started_at && (
                                        <span className="ml-2 font-mono">
                                          {formatProcessingTime(job.started_at)}
                                        </span>
                                      )}
                                      {job.status === "completed" && job.embedding_status === "completed" && (
                                        <span className="text-success ml-1">- Pronto para uso</span>
                                      )}
                                      {job.status === "failed" && (
                                        <span className="text-destructive ml-1">- Tente novamente</span>
                                      )}
                                      {hasIssue && (
                                        <span className="text-warning ml-1">- Tente cancelar e reenviar</span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isActive && (
                                    <span className="text-sm font-mono text-primary">{progress}%</span>
                                  )}
                                  {getStatusBadge(job.status, job.embedding_status)}
                                  {/* Download button (available when file exists in storage) */}
                                  {job.storage_path && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                      onClick={() => handleDownloadJob(job)}
                                      title="Baixar documento"
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  )}
                                  
                                  {/* Cancel button for processing/pending/stuck jobs */}
                                  {(job.status === "processing" || job.status === "pending" || stuck) && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-warning hover:bg-warning/10"
                                      onClick={() => handleCancelJob(job, kb.id)}
                                      disabled={cancellingJob === job.id}
                                      title="Cancelar processamento"
                                    >
                                      {cancellingJob === job.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <XCircle className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                  
                                  {/* Reprocess button for failed jobs */}
                                  {job.status === "failed" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                      onClick={() => handleReprocessJob(job, kb.id)}
                                      disabled={reprocessingJob === job.id}
                                      title="Reprocessar"
                                    >
                                      {reprocessingJob === job.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                  
                                  {/* Delete button for failed jobs */}
                                  {job.status === "failed" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => confirmDeleteFailedJob(job.id, job.filename, kb.id, job.storage_path)}
                                      title="Deletar"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              
                              {/* Progress bar for active jobs */}
                              {isActive && (
                                <div className="mt-3">
                                  <Progress value={progress} className="h-2" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Documents - Collapsible */}
                <Collapsible defaultOpen={false}>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-foreground mb-3 hover:text-primary transition-colors group w-full">
                    <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                    <span>Documentos</span>
                    {documentsMap[kb.id] && processingJobsMap[kb.id] && (
                      <Badge variant="secondary" className="text-xs ml-auto">
                        {(() => {
                          // Get filenames from completed jobs only
                          const completedFilenames = new Set(
                            processingJobsMap[kb.id]
                              ?.filter(j => j.status === "completed")
                              .map(j => j.filename) || []
                          );
                          
                          const grouped = documentsMap[kb.id].reduce((acc, doc) => {
                            const metadata = doc.metadata as { filename?: string; job_id?: string } | null;
                            const filename = metadata?.filename || `doc_${doc.id}`;
                            
                            // Only count if from a completed job
                            if (!completedFilenames.has(filename)) return acc;
                            
                            if (!acc[filename]) acc[filename] = [];
                            acc[filename].push(doc);
                            return acc;
                          }, {} as Record<string, Document[]>);
                          return Object.keys(grouped).length;
                        })()}
                      </Badge>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-6">
                      {loadingDocuments[kb.id] ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (() => {
                        // Get filenames from completed jobs only
                        const completedFilenames = new Set(
                          processingJobsMap[kb.id]
                            ?.filter(j => j.status === "completed")
                            .map(j => j.filename) || []
                        );
                        
                        // Group documents by filename, filtering only completed ones
                        const grouped = (documentsMap[kb.id] || []).reduce((acc, doc) => {
                          const metadata = doc.metadata as { 
                            filename?: string; 
                            size?: number;
                            chunk_index?: number;
                            total_chunks?: number;
                          } | null;
                          const filename = metadata?.filename || `doc_${doc.id}`;
                          
                          // Only include documents from completed jobs
                          if (!completedFilenames.has(filename)) return acc;
                          
                          if (!acc[filename]) {
                            acc[filename] = {
                              filename: metadata?.filename || `Documento #${doc.id}`,
                              size: metadata?.size || 0,
                              totalChunks: metadata?.total_chunks || 1,
                              docs: []
                            };
                          }
                          acc[filename].docs.push(doc);
                          return acc;
                        }, {} as Record<string, { filename: string; size: number; totalChunks: number; docs: Document[] }>);
                        
                        const entries = Object.entries(grouped);
                        
                        if (entries.length === 0) {
                          return (
                            <div className="text-center py-6 text-muted-foreground text-sm">
                              Nenhum documento processado nesta base.
                            </div>
                          );
                        }
                        
                        return (
                          <div className="space-y-2">
                            {entries.map(([key, group]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between p-3 bg-secondary/50 rounded-xl"
                              >
                                <div className="flex items-center gap-3">
                                  <FileText className="h-5 w-5 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm font-medium text-foreground">
                                      {group.filename}
                                      <Badge variant="secondary" className="ml-2 text-xs">
                                        {group.docs.length} partes
                                      </Badge>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {group.docs.reduce((sum, d) => sum + d.content.length, 0)} caracteres
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={async () => {
                                    // Delete all chunks of this document
                                    for (const doc of group.docs) {
                                      await supabase.from("documents").delete().eq("id", doc.id);
                                    }
                                    toast({
                                      title: "Documento excluído",
                                      description: `"${group.filename}" foi removido.`,
                                    });
                                    await fetchDocuments(kb.id);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card p-6 max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-4">Deletar Arquivo?</h3>
            <p className="text-muted-foreground mb-6">
              Tem certeza que deseja deletar "{deleteConfirm.filename}"?
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={executeDeleteFailedJob}
              >
                Deletar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Knowledge Base Confirmation Modal */}
      {deleteKbConfirm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card p-6 max-w-md mx-4 animate-fade-in border border-destructive/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Excluir Base de Conhecimento?</h3>
            </div>
            <p className="text-muted-foreground mb-2">
              Tem certeza que deseja excluir a base <span className="font-semibold text-foreground">"{deleteKbConfirm.name}"</span>?
            </p>
            <p className="text-sm text-destructive mb-6">
              Todos os documentos, arquivos e configurações serão permanentemente removidos. Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteKbConfirm(null)}
                disabled={deletingKb}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => handleDeleteKnowledgeBase(deleteKbConfirm)}
                disabled={deletingKb}
              >
                {deletingKb ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  "Excluir Base"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Knowledge;
