import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { User, Phone, Mail, Building, UserPlus, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

interface VCardData {
  displayName?: string;
  phones?: string[];
  vCard?: string;
}

interface VCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: VCardData | null;
  onAddToLeads?: (data: { name: string; phone: string; email?: string; company?: string; job_title?: string; description?: string }) => void;
}

// Parse vCard string to extract fields
function parseVCard(vcard: string): Record<string, string> {
  const result: Record<string, string> = {};
  const extras: string[] = [];
  const lines = vcard.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('FN:')) {
      result.fullName = trimmedLine.substring(3).trim();
    } else if (trimmedLine.startsWith('ORG:')) {
      result.organization = trimmedLine.substring(4).trim();
    } else if (trimmedLine.startsWith('TITLE:')) {
      result.jobTitle = trimmedLine.substring(6).trim();
    } else if (trimmedLine.includes('EMAIL') && trimmedLine.includes(':')) {
      // Handle both EMAIL and itemN.EMAIL patterns (WhatsApp uses itemN. prefix)
      const match = trimmedLine.match(/EMAIL[^:]*:(.+)/);
      if (match && !result.email) result.email = match[1].trim();
    } else if (trimmedLine.includes('TEL') && trimmedLine.includes(':')) {
      // Handle both TEL and itemN.TEL patterns
      const match = trimmedLine.match(/TEL[^:]*:(.+)/);
      if (match && !result.phone) result.phone = match[1].trim();
    } else if (trimmedLine.startsWith('ADR') || trimmedLine.includes('.ADR')) {
      const match = trimmedLine.match(/ADR[^:]*:(.+)/);
      if (match) {
        const parts = match[1].split(';').filter(p => p.trim());
        if (parts.length > 0) {
          result.address = parts.join(', ');
          extras.push(`Endereco: ${result.address}`);
        }
      }
    } else if (trimmedLine.startsWith('NICKNAME:')) {
      const value = trimmedLine.substring(9).trim();
      if (value) extras.push(`Apelido: ${value}`);
    } else if (trimmedLine.startsWith('BDAY')) {
      const match = trimmedLine.match(/BDAY[^:]*:(.+)/);
      if (match) extras.push(`Aniversario: ${match[1].trim()}`);
    } else if (trimmedLine.includes('.URL:') || trimmedLine.startsWith('URL:')) {
      const match = trimmedLine.match(/URL[^:]*:(.+)/);
      if (match) extras.push(`Site: ${match[1].trim()}`);
    } else if (trimmedLine.startsWith('X-WA-BIZ-NAME:')) {
      const value = trimmedLine.substring(14).trim();
      if (value && value !== result.fullName) extras.push(`Nome comercial: ${value}`);
    } else if (trimmedLine.startsWith('NOTE:')) {
      const value = trimmedLine.substring(5).trim();
      if (value) extras.push(`Nota: ${value}`);
    }
  }

  // Combine extras into description
  if (extras.length > 0) {
    result.extraFields = extras.join('\n');
  }

  return result;
}

// Format phone number for display
function formatPhoneDisplay(phone: string): string {
  // Remove non-digits except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned;
}

export function VCardModal({ isOpen, onClose, data, onAddToLeads }: VCardModalProps) {
  const { toast } = useToast();

  if (!data) return null;

  const parsed = data.vCard ? parseVCard(data.vCard) : {};
  const displayName = data.displayName || parsed.fullName || "Contato";
  const phone = data.phones?.[0] || parsed.phone || "";
  const formattedPhone = formatPhoneDisplay(phone);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(formattedPhone);
    toast({ description: "Telefone copiado!" });
  };

  const handleAddToLeads = () => {
    if (onAddToLeads) {
      onAddToLeads({
        name: displayName,
        phone: formattedPhone,
        email: parsed.email,
        company: parsed.organization,
        job_title: parsed.jobTitle,
        description: parsed.extraFields,
      });
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contato</DialogTitle>
          <VisuallyHidden.Root>
            <DialogDescription>Detalhes do contato compartilhado</DialogDescription>
          </VisuallyHidden.Root>
        </DialogHeader>

        <div className="flex flex-col items-center py-4">
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-4">
            <User className="h-10 w-10 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-center">{displayName}</h3>
        </div>

        <div className="space-y-3">
          {formattedPhone && (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-mono">{formattedPhone}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCopyPhone} className="h-8 w-8 p-0">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}

          {parsed.email && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm truncate">{parsed.email}</span>
            </div>
          )}

          {parsed.organization && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Building className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm">{parsed.organization}</span>
            </div>
          )}
        </div>

        {onAddToLeads && (
          <Button onClick={handleAddToLeads} className="w-full mt-4">
            <UserPlus className="h-4 w-4 mr-2" />
            Adicionar aos Leads
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
