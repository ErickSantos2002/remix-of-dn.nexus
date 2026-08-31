import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, ExternalLink, Copy, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
  caption?: string;
  isLive?: boolean;
}

interface LocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: LocationData | null;
}

export function LocationModal({ isOpen, onClose, data }: LocationModalProps) {
  const { toast } = useToast();

  if (!data) return null;

  const { latitude, longitude, name, address, caption, isLive } = data;

  // Google Maps URLs - usando formato oficial da API
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  const embedUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&z=15&output=embed`;
  const displayName = isLive ? "Localização em tempo real" : (name || "Localização");

  const handleCopyCoordinates = () => {
    navigator.clipboard.writeText(`${latitude}, ${longitude}`);
    toast({ description: "Coordenadas copiadas!" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            {displayName}
          </DialogTitle>
          <VisuallyHidden.Root>
            <DialogDescription>Localização compartilhada via WhatsApp</DialogDescription>
          </VisuallyHidden.Root>
        </DialogHeader>

        {/* Aviso de localização em tempo real */}
        {isLive && (
          <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm">
            <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              Esta é uma localização em tempo real. Apenas a posição inicial está sendo exibida.
            </p>
          </div>
        )}

        {/* Mapa embed */}
        <div className="w-full h-64 rounded-lg overflow-hidden bg-muted">
          <iframe
            src={embedUrl}
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title="Mapa da localização"
          />
        </div>

        {/* Informações */}
        <div className="space-y-3">
          {caption && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm">{caption}</p>
            </div>
          )}

          {address && (
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-sm">{address}</span>
            </div>
          )}

          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Coordenadas:</span>
              <span className="text-sm font-mono">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleCopyCoordinates} className="h-8 w-8 p-0">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Ações */}
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir no Google Maps
        </a>
      </DialogContent>
    </Dialog>
  );
}
