import { Download, FileText, Image as ImageIcon, Volume2, Video, User, MapPin } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { VCardModal } from "./VCardModal";
import { LocationModal } from "./LocationModal";

interface VCardData {
  displayName?: string;
  phones?: string[];
  vCard?: string;
}

interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
  caption?: string;
  isLive?: boolean;
}

interface MediaMessageProps {
  url: string;
  type: string;
  className?: string;
  onAddVCardToLeads?: (data: { name: string; phone: string }) => void;
}

export const MediaMessage = ({ url, type, className, onAddVCardToLeads }: MediaMessageProps) => {
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [isVCardOpen, setIsVCardOpen] = useState(false);
  const [vcardData, setVcardData] = useState<VCardData | null>(null);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [locationData, setLocationData] = useState<LocationData | null>(null);

  if (!url) return null;

  // Normalizar o tipo para verificação
  const normalizedType = type?.toLowerCase() || "";

  // Imagem
  if (normalizedType === "image" || normalizedType.startsWith("image/")) {
    return (
      <>
        <img
          src={url}
          alt="Imagem enviada"
          className={`max-w-full max-h-48 rounded-lg cursor-pointer hover:opacity-90 transition-opacity ${className || ""}`}
          onClick={() => setIsImageOpen(true)}
          loading="lazy"
        />
        <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
          <DialogContent className="max-w-4xl p-0 bg-transparent border-none">
            <VisuallyHidden.Root>
              <DialogTitle>Imagem ampliada</DialogTitle>
              <DialogDescription>Visualização da imagem em tamanho maior</DialogDescription>
            </VisuallyHidden.Root>
            <img
              src={url}
              alt="Imagem ampliada"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Áudio
  if (normalizedType === "audio" || normalizedType.startsWith("audio/")) {
    // Detectar MIME type do data URL ou usar default
    let audioMimeType = "audio/webm";
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);/);
      if (match) {
        audioMimeType = match[1];
      }
    } else if (type && type.includes("/")) {
      audioMimeType = type;
    }

    return (
      <div className={`flex items-center gap-2 ${className || ""}`}>
        <Volume2 className="h-4 w-4 text-primary shrink-0" />
        <audio controls className="max-w-full h-8" preload="auto">
          <source src={url} type={audioMimeType} />
          Seu navegador não suporta audio.
        </audio>
      </div>
    );
  }

  // Vídeo
  if (normalizedType === "video" || normalizedType.startsWith("video/")) {
    return (
      <video
        controls
        className={`max-w-full max-h-48 rounded-lg ${className || ""}`}
        preload="metadata"
      >
        <source src={url} type="video/mp4" />
        Seu navegador não suporta vídeo.
      </video>
    );
  }

  // PTV (Video Note / Recado de vídeo circular)
  if (normalizedType === "ptv") {
    return (
      <div className={`relative inline-block ${className || ""}`}>
        <video
          controls
          className="w-32 h-32 rounded-full object-cover border-2 border-primary/30"
          preload="metadata"
        >
          <source src={url} type="video/mp4" />
          Seu navegador não suporta vídeo.
        </video>
        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1">
          <Video className="h-3 w-3" />
        </div>
      </div>
    );
  }

  // Sticker
  if (normalizedType === "sticker") {
    return (
      <>
        <img
          src={url}
          alt="Figurinha"
          className={`max-w-[120px] max-h-[120px] rounded cursor-pointer hover:opacity-90 transition-opacity ${className || ""}`}
          onClick={() => setIsImageOpen(true)}
          loading="lazy"
        />
        <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
          <DialogContent className="max-w-md p-0 bg-transparent border-none">
            <VisuallyHidden.Root>
              <DialogTitle>Figurinha ampliada</DialogTitle>
              <DialogDescription>Visualização da figurinha em tamanho maior</DialogDescription>
            </VisuallyHidden.Root>
            <img
              src={url}
              alt="Figurinha ampliada"
              className="max-w-full max-h-[60vh] object-contain"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // VCard (Contato compartilhado)
  if (normalizedType === "vcard") {
    // Parse JSON from url (we stored JSON there since VCard has no media URL)
    let parsedVCard: VCardData | null = null;
    try {
      parsedVCard = JSON.parse(url);
    } catch {
      parsedVCard = { displayName: "Contato" };
    }

    const handleOpenVCard = () => {
      setVcardData(parsedVCard);
      setIsVCardOpen(true);
    };

    return (
      <>
        {/* Thumbnail */}
        <div
          onClick={handleOpenVCard}
          className={`flex items-center gap-3 p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors max-w-[280px] ${className || ""}`}
        >
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{parsedVCard?.displayName || "Contato"}</p>
            <p className="text-xs text-muted-foreground">Toque para ver</p>
          </div>
        </div>

        {/* Modal */}
        <VCardModal
          isOpen={isVCardOpen}
          onClose={() => setIsVCardOpen(false)}
          data={vcardData}
          onAddToLeads={onAddVCardToLeads}
        />
      </>
    );
  }

  // Localização
  if (normalizedType === "location") {
    let parsedLocation: LocationData | null = null;
    try {
      parsedLocation = JSON.parse(url);
    } catch {
      parsedLocation = null;
    }

    if (!parsedLocation) return null;

    const handleOpenLocation = () => {
      setLocationData(parsedLocation);
      setIsLocationOpen(true);
    };

    return (
      <>
        {/* Thumbnail */}
        <div
          onClick={handleOpenLocation}
          className={`flex items-center gap-3 p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors max-w-[280px] ${className || ""}`}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {parsedLocation.isLive ? "Localização em tempo real" : (parsedLocation.name || parsedLocation.address || "Localização")}
            </p>
            {parsedLocation.isLive ? (
              <p className="text-xs text-muted-foreground truncate">
                {parsedLocation.caption || "Posição inicial"}
              </p>
            ) : parsedLocation.name && parsedLocation.address ? (
              <p className="text-xs text-muted-foreground truncate">{parsedLocation.address}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Toque para ver no mapa</p>
            )}
          </div>
        </div>

        {/* Modal */}
        <LocationModal
          isOpen={isLocationOpen}
          onClose={() => setIsLocationOpen(false)}
          data={locationData}
        />
      </>
    );
  }

  // Documento
  if (normalizedType === "document" || normalizedType.startsWith("application/")) {
    const handleDownload = () => {
      // Handle base64 data URLs - convert to blob and download
      if (url.startsWith("data:")) {
        try {
          const [header, base64] = url.split(",");
          const mimeType = header.match(/data:(.*);/)?.[1] || "application/octet-stream";
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = "documento";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        } catch (error) {
          console.error("Error downloading document:", error);
        }
      } else {
        // Regular URL - open in new tab
        window.open(url, "_blank");
      }
    };

    return (
      <button
        onClick={handleDownload}
        className={`flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer ${className || ""}`}
      >
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs truncate flex-1">Documento</span>
        <Download className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
    );
  }

  // Default
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 text-xs text-primary hover:underline ${className || ""}`}
    >
      <Download className="h-3 w-3" />
      Baixar arquivo
    </a>
  );
};
