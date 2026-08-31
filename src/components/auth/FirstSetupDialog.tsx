import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FirstSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

export function FirstSetupDialog({ open, onOpenChange, onCompleted }: FirstSetupDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    companyName: "",
    workspaceName: "Principal",
  });

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password.length < 8) {
      toast({
        variant: "destructive",
        title: "Senha muito curta",
        description: "A senha deve ter no mínimo 8 caracteres.",
      });
      return;
    }

    if (form.password !== form.confirmPassword) {
      toast({
        variant: "destructive",
        title: "Senhas diferentes",
        description: "A confirmação da senha não confere.",
      });
      return;
    }

    setIsSaving(true);

    const { data, error } = await supabase.functions.invoke("bootstrap-admin", {
      body: {
        action: "setup",
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        company_name: form.companyName.trim(),
        workspace_name: form.workspaceName.trim() || "Principal",
      },
    });

    if (error || (data && (data as { error?: unknown }).error)) {
      setIsSaving(false);
      const message =
        typeof (data as { error?: unknown })?.error === "string"
          ? ((data as { error: string }).error)
          : "Não foi possível concluir a configuração inicial.";
      toast({ variant: "destructive", title: "Erro na configuração", description: message });
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    });

    setIsSaving(false);

    if (signInError) {
      toast({
        title: "Configuração concluída",
        description: "Faça login com as credenciais criadas.",
      });
      onOpenChange(false);
      onCompleted?.();
      return;
    }

    toast({ title: "Tudo pronto", description: "Administrador, empresa e workspace criados." });
    onOpenChange(false);
    onCompleted?.();
    navigate("/");
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !isSaving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configuração inicial</DialogTitle>
          <DialogDescription>
            Crie o administrador do sistema, a empresa e o primeiro workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="setup-name">Nome do administrador</Label>
            <Input
              id="setup-name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              disabled={isSaving}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="setup-email">E-mail</Label>
            <Input
              id="setup-email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              required
              disabled={isSaving}
              className="rounded-xl"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="setup-password">Senha</Label>
              <Input
                id="setup-password"
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                required
                minLength={8}
                disabled={isSaving}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-password-confirm">Confirmar senha</Label>
              <Input
                id="setup-password-confirm"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => update("confirmPassword", e.target.value)}
                required
                minLength={8}
                disabled={isSaving}
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="setup-company">Nome da empresa</Label>
            <Input
              id="setup-company"
              value={form.companyName}
              onChange={(e) => update("companyName", e.target.value)}
              required
              disabled={isSaving}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="setup-workspace">Primeiro workspace</Label>
            <Input
              id="setup-workspace"
              value={form.workspaceName}
              onChange={(e) => update("workspaceName", e.target.value)}
              required
              disabled={isSaving}
              className="rounded-xl"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar administrador"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
