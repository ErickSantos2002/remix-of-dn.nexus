import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UserPlus, Loader2, Eye, EyeOff, Copy, Check } from "lucide-react";
import WorkspaceSelector from "./WorkspaceSelector";

interface DirectRegisterDialogProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  currentUserId: string;
  onSuccess: () => void;
  isSuperAdmin?: boolean;
}

const DirectRegisterDialog = ({
  isOpen,
  onClose,
  companyId,
  companyName,
  currentUserId,
  onSuccess,
  isSuperAdmin = false,
}: DirectRegisterDialogProps) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "member",
  });
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([]);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData({ ...formData, password });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password) {
      toast({
        title: "Erro",
        description: "Preencha todos os campos obrigatorios.",
        variant: "destructive",
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: "Erro",
        description: "A senha deve ter pelo menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Check if email is already an active member of this company
      const { data: activeMembers } = await supabase
        .from("company_members")
        .select(`
          user_id,
          profiles!company_members_user_id_fkey(email)
        `)
        .eq("company_id", companyId)
        .eq("status", "active");

      const isAlreadyMember = activeMembers?.some(
        (m: any) => m.profiles?.email?.toLowerCase() === formData.email.toLowerCase()
      );

      if (isAlreadyMember) {
        toast({
          title: "Erro",
          description: "Este email ja e membro ativo da empresa.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-user-direct", {
        body: {
          email: formData.email,
          password: formData.password,
          name: formData.name,
          companyId: companyId,
          role: formData.role,
          createdBy: currentUserId,
          workspaceIds: selectedWorkspaces.length > 0 ? selectedWorkspaces : null,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      if (data.isNewUser) {
        setCreatedCredentials({
          email: formData.email,
          password: formData.password,
        });
        setShowCredentials(true);
        toast({
          title: "Usuario criado",
          description: `${formData.name || formData.email} foi adicionado a empresa.`,
        });
      } else {
        toast({
          title: "Usuario adicionado",
          description: `${formData.email} foi adicionado a empresa.`,
        });
        handleClose();
      }

      onSuccess();
    } catch (error: any) {
      console.error("Error creating user:", error);
      toast({
        title: "Erro",
        description: error.message || "Nao foi possivel criar o usuario.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!createdCredentials) return;
    
    const text = `Email: ${createdCredentials.email}\nSenha: ${createdCredentials.password}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: "Credenciais copiadas",
      description: "As credenciais foram copiadas para a area de transferencia.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setFormData({ name: "", email: "", password: "", role: "member" });
    setSelectedWorkspaces([]);
    setShowCredentials(false);
    setCreatedCredentials(null);
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {showCredentials ? "Usuario Criado" : "Cadastrar Usuario"}
          </DialogTitle>
          <DialogDescription>
            {showCredentials 
              ? "Compartilhe as credenciais com o novo usuario."
              : `Cadastre um novo usuario diretamente na empresa ${companyName}.`
            }
          </DialogDescription>
        </DialogHeader>

        {showCredentials && createdCredentials ? (
          <div className="space-y-4 py-4">
            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <p className="font-mono text-sm">{createdCredentials.email}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Senha</Label>
                <p className="font-mono text-sm">{createdCredentials.password}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Compartilhe estas credenciais de forma segura. O usuario pode alterar a senha apos o primeiro login.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
              <Button onClick={handleCopyCredentials}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar Credenciais
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                placeholder="Nome completo"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@exemplo.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha *</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimo 6 caracteres"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    minLength={6}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={generatePassword}
                >
                  Gerar
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value })}
              >
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSuperAdmin && (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  )}
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Workspace Selection */}
            <WorkspaceSelector
              companyId={companyId}
              selectedWorkspaces={selectedWorkspaces}
              onSelectionChange={setSelectedWorkspaces}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Criar Usuario
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DirectRegisterDialog;
