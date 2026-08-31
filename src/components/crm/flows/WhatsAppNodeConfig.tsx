import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WHATSAPP_VARS_HINT } from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, X, Image as ImageIcon, Video as VideoIcon, Music,
} from "lucide-react";

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  workspaceId: string;
  companyId: string;
}

type MediaKind = "image" | "video" | "audio";

const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; accept: string; label: string }> = {
  image: { maxBytes: 5 * 1024 * 1024, accept: "image/jpeg,image/png,image/webp", label: "Imagens devem ter no máximo 5 MB." },
  video: { maxBytes: 16 * 1024 * 1024, accept: "video/mp4", label: "Vídeos devem ter no máximo 16 MB." },
  audio: { maxBytes: 16 * 1024 * 1024, accept: "audio/mpeg,audio/ogg,.mp3,.ogg", label: "Áudios (MP3/OGG) devem ter no máximo 16 MB." },
};

export function WhatsAppNodeConfig({ config, onChange, workspaceId, companyId }: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const inputs = useRef<Record<MediaKind, HTMLInputElement | null>>({ image: null, video: null, audio: null });

  // Spec §4.3: SOMENTE agentes do workspace do fluxo (a v1 listava da empresa toda
  // e o envio falhava em silêncio quando o agente era de outro workspace).
  const { data: agents } = useQuery({
    queryKey: ["flow-agents", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [legacy, instances] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("agents" as any).select("id, name")
          .eq("workspace_id", workspaceId).eq("is_active", true).eq("is_archived", false),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("agent_instances" as any).select("id, name")
          .eq("workspace_id", workspaceId).eq("is_active", true).eq("is_archived", false),
      ]);
      return [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(((legacy.data as any[]) || []).map((a) => ({ ...a, source: "agents" as const }))),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(((instances.data as any[]) || []).map((a) => ({ ...a, source: "agent_instances" as const }))),
      ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    },
  });

  const readAudioDuration = (file: File): Promise<number | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener("loadedmetadata", () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        resolve(null);
      });
    });

  const handleUpload = async (kind: MediaKind, file: File) => {
    const limit = MEDIA_LIMITS[kind];
    if (file.size > limit.maxBytes) {
      toast({ variant: "destructive", title: "Arquivo muito grande", description: limit.label });
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `cadence/${companyId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("widget-assets")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("widget-assets").getPublicUrl(path);
      const patch: Record<string, unknown> = { ...config, media_url: pub.publicUrl, media_type: kind };
      if (kind === "audio") patch.audio_duration = await readAudioDuration(file);
      else patch.audio_duration = null;
      onChange(patch);
      toast({ title: "Mídia anexada" });
    } catch (e) {
      toast({ variant: "destructive", title: "Erro no upload", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  const mediaUrl = typeof config.media_url === "string" ? config.media_url : null;
  const mediaType = config.media_type as MediaKind | null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs">Período do dia</Label>
        <Select
          value={typeof config.day_period === "string" ? (config.day_period as string) : "qualquer"}
          onValueChange={(v) => onChange({ ...config, day_period: v })}
        >
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="qualquer">Qualquer</SelectItem>
            <SelectItem value="manha">Manhã (6h–12h)</SelectItem>
            <SelectItem value="tarde">Tarde (12h–18h)</SelectItem>
            <SelectItem value="noite">Noite (18h–22h)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Agente IA (assume o chat após envio)</Label>
        <Select
          value={config.agent_id && config.agent_source ? `${config.agent_source}:${config.agent_id}` : "__keep__"}
          onValueChange={(v) => {
            if (v === "__keep__") onChange({ ...config, agent_id: null, agent_source: null });
            else {
              const [src, id] = v.split(":");
              onChange({ ...config, agent_id: id, agent_source: src });
            }
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep__">Manter atribuição atual</SelectItem>
            {(agents || []).map((a) => (
              <SelectItem key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Somente agentes deste workspace. Ao enviar, o chat vai para "IA conversando" com este agente.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
        <div className="space-y-0.5">
          <Label className="text-xs">Reescrever com IA antes de enviar</Label>
          <p className="text-[11px] text-muted-foreground">
            A IA reescreve a mensagem mantendo a essência, preservando nomes e links, sem inventar informações.
          </p>
        </div>
        <Switch
          checked={config.ai_rewrite_enabled === true}
          onCheckedChange={(v) => onChange({ ...config, ai_rewrite_enabled: v })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mídia (opcional)</Label>
          {mediaUrl && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...config, media_url: null, media_type: null, audio_duration: null })}>
              <X className="h-3 w-3 mr-1" /> Remover
            </Button>
          )}
        </div>
        {mediaUrl ? (
          <div className="rounded-md border border-border p-2 bg-muted/30">
            {mediaType === "image" && <img src={mediaUrl} alt="Mídia" className="max-h-40 rounded" />}
            {mediaType === "video" && <video src={mediaUrl} controls className="max-h-40 rounded" />}
            {mediaType === "audio" && (
              <div className="space-y-1">
                <audio src={mediaUrl} controls className="w-full" />
                {typeof config.audio_duration === "number" && (
                  <p className="text-[11px] text-muted-foreground">
                    Duração: {config.audio_duration}s — enviado como mensagem de voz.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(MEDIA_LIMITS) as MediaKind[]).map((kind) => (
              <span key={kind}>
                <input
                  type="file"
                  accept={MEDIA_LIMITS[kind].accept}
                  className="hidden"
                  ref={(el) => { inputs.current[kind] = el; }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(kind, f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputs.current[kind]?.click()}>
                  {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> :
                    kind === "image" ? <ImageIcon className="h-3 w-3 mr-1" /> :
                    kind === "video" ? <VideoIcon className="h-3 w-3 mr-1" /> :
                    <Music className="h-3 w-3 mr-1" />}
                  {kind === "image" ? "Imagem" : kind === "video" ? "Vídeo" : "Áudio"}
                </Button>
              </span>
            ))}
            <span className="text-xs text-muted-foreground self-center">
              Imagem 5 MB · Vídeo MP4 16 MB · Áudio MP3/OGG 16 MB
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Mensagem {mediaUrl && mediaType !== "audio" && <span className="text-muted-foreground">(enviada como legenda)</span>}
          {mediaType === "audio" && <span className="text-muted-foreground">(opcional; o áudio é a mensagem)</span>}
        </Label>
        <Textarea
          rows={4}
          value={typeof config.content === "string" ? config.content : ""}
          onChange={(e) => onChange({ ...config, content: e.target.value })}
          placeholder="Olá {primeiro_nome}, tudo bem?"
        />
        <p className="text-[11px] text-muted-foreground">{WHATSAPP_VARS_HINT}</p>
      </div>
    </div>
  );
}
