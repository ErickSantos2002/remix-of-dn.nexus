import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Link, Mail, AlertCircle } from "lucide-react";

interface InviteLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  inviteLink: string;
  email: string;
  emailSent: boolean;
}

const InviteLinkDialog = ({
  isOpen,
  onClose,
  inviteLink,
  email,
  emailSent,
}: InviteLinkDialogProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({
        title: "Link copiado",
        description: "O link de convite foi copiado para a area de transferencia.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Erro",
        description: "Nao foi possivel copiar o link.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="h-5 w-5 text-primary" />
            Convite Criado
          </DialogTitle>
          <DialogDescription>
            Convite criado para <strong>{email}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status do email */}
          <div className="flex items-center gap-2">
            {emailSent ? (
              <Badge variant="secondary" className="bg-success/10 text-success">
                <Mail className="h-3 w-3 mr-1" />
                Email enviado
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-warning/10 text-warning">
                <AlertCircle className="h-3 w-3 mr-1" />
                Email nao configurado
              </Badge>
            )}
          </div>

          {!emailSent && (
            <p className="text-sm text-muted-foreground">
              O servico de email nao esta configurado. Compartilhe o link abaixo com o convidado.
            </p>
          )}

          {/* Link de convite */}
          <div className="space-y-2">
            <Label>Link de Convite</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteLink}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopyLink}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Este link expira em 7 dias. O convidado pode usar este link para criar uma conta ou fazer login.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={handleCopyLink}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copiar Link
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InviteLinkDialog;
