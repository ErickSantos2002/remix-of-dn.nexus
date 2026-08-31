import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Layers, Shield, Crown, User, Mail, UserCog, KeyRound } from "lucide-react";
import { Api4comExtensionPicker } from "./Api4comExtensionPicker";

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  joined_at: string;
  profile: {
    name: string | null;
    email: string;
  };
}

interface MemberEditDialogProps {
  member: Member | null;
  companyId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  currentUserIsSuperAdmin?: boolean;
}

const MemberEditDialog = ({
  member,
  companyId,
  isOpen,
  onClose,
  onSaved,
  currentUserIsSuperAdmin = false,
}: MemberEditDialogProps) => {
  const { toast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [allocatedWorkspaces, setAllocatedWorkspaces] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  
  // Profile editing
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("member");

  const isOwner = member?.role === "owner";
  const isOwnerOrAdmin = member?.role === "owner" || member?.role === "admin" || member?.role === "super_admin";

  useEffect(() => {
    const initializeDialog = async () => {
      if (!isOpen || !member) return;
      
      setName(member.profile.name || "");
      setEmail(member.profile.email || "");
      
      // Check if user is super_admin in user_roles table (source of truth for super_admin)
      const { data: userRoleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", member.user_id)
        .eq("role", "super_admin")
        .maybeSingle();
      
      // Use super_admin from user_roles if exists, otherwise use company_members role
      const effectiveRole = userRoleData?.role === "super_admin" ? "super_admin" : (member.role || "member");
      setSelectedRole(effectiveRole);
      
      fetchData();
    };
    
    initializeDialog();
  }, [isOpen, member, companyId]);

  const fetchData = async () => {
    if (!member) return;
    
    setIsLoading(true);
    try {
      // Fetch all workspaces from company
      const { data: workspacesData, error: workspacesError } = await supabase
        .from("workspaces")
        .select("id, name, icon")
        .eq("company_id", companyId)
        .order("name");

      if (workspacesError) throw workspacesError;
      setWorkspaces(workspacesData || []);

      // Fetch current workspace allocations for this member
      const { data: allocationsData, error: allocationsError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", member.user_id)
        .eq("status", "active");

      if (allocationsError) throw allocationsError;

      const allocatedIds = new Set(allocationsData?.map((a) => a.workspace_id) || []);
      setAllocatedWorkspaces(allocatedIds);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleWorkspace = (workspaceId: string) => {
    if (isOwnerOrAdmin) return;
    
    setAllocatedWorkspaces((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(workspaceId)) {
        newSet.delete(workspaceId);
      } else {
        newSet.add(workspaceId);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    if (!member) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      // Update profile if name changed
      const trimmedName = name.trim();
      if (trimmedName !== (member.profile.name || "")) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ name: trimmedName || null })
          .eq("id", member.user_id);

        if (profileError) throw profileError;
      }

      // Update role if changed (only if not owner)
      if (!isOwner && selectedRole !== member.role) {
        const { error: roleError } = await supabase
          .from("company_members")
          .update({ role: selectedRole })
          .eq("id", member.id);

        if (roleError) throw roleError;

        // Sincronizar user_roles (mesma logica do TeamSettings.handleChangeRole)
        if (selectedRole === "super_admin") {
          // Delete all existing roles and insert super_admin
          await supabase
            .from("user_roles")
            .delete()
            .eq("user_id", member.user_id);
          const { error: insertError } = await supabase
            .from("user_roles")
            .insert({ user_id: member.user_id, role: "super_admin" });
          if (insertError) console.error("Error setting super_admin in user_roles:", insertError);
        } else {
          // For admin/member: check existing record and update or insert
          const { data: existingRole } = await supabase
            .from("user_roles")
            .select("id, role")
            .eq("user_id", member.user_id)
            .maybeSingle();

          if (existingRole) {
            await supabase
              .from("user_roles")
              .update({ role: selectedRole as "admin" | "member" | "super_admin" })
              .eq("id", existingRole.id);
          } else {
            await supabase
              .from("user_roles")
              .insert({ user_id: member.user_id, role: selectedRole as "admin" | "member" | "super_admin" });
          }
        }
      }

      // Update workspace allocations (only for non-owner/admin)
      if (!isOwnerOrAdmin) {
        const { data: currentAllocations } = await supabase
          .from("workspace_members")
          .select("id, workspace_id")
          .eq("user_id", member.user_id)
          .eq("status", "active");

        const currentIds = new Set(currentAllocations?.map((a) => a.workspace_id) || []);
        
        const toAdd = [...allocatedWorkspaces].filter((id) => !currentIds.has(id));
        const toRemove = currentAllocations?.filter(
          (a) => !allocatedWorkspaces.has(a.workspace_id)
        ) || [];

        if (toAdd.length > 0) {
          const insertData = toAdd.map((workspaceId) => ({
            workspace_id: workspaceId,
            user_id: member.user_id,
            role: selectedRole,
            status: "active",
          }));

          const { error: insertError } = await supabase
            .from("workspace_members")
            .insert(insertData);

          if (insertError) throw insertError;
        }

        if (toRemove.length > 0) {
          const { error: deleteError } = await supabase
            .from("workspace_members")
            .delete()
            .in("id", toRemove.map((a) => a.id));

          if (deleteError) throw deleteError;
        }
      }

      toast({
        title: "Membro atualizado",
        description: "As alterações foram salvas com sucesso.",
      });

      onSaved();
      onClose();
    } catch (error) {
      console.error("Error saving:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar as alterações.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  if (!member) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(member.profile.name, member.profile.email)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-base font-semibold">Editar Membro</p>
              <p className="text-sm font-normal text-muted-foreground">
                {member.profile.email}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>
            Edite as informações e acessos deste membro
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Profile Fields */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="member-name" className="text-sm font-medium flex items-center gap-2">
                <User className="h-4 w-4" />
                Nome
              </Label>
              <Input
                id="member-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do membro"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-email" className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                id="member-email"
                value={email}
                disabled
                className="bg-muted/50"
              />
              <p className="text-xs text-muted-foreground">
                O email não pode ser alterado
              </p>
            </div>

            {/* Reset Password */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Senha
              </Label>
              <Button
                variant="outline"
                size="sm"
                disabled={isSendingReset}
                onClick={async () => {
                  if (!member?.profile.email) return;
                  setIsSendingReset(true);
                  try {
                    const { error } = await supabase.auth.resetPasswordForEmail(
                      member.profile.email,
                      { redirectTo: `${window.location.origin}/reset-password` }
                    );
                    if (error) throw error;
                    toast({
                      title: "Email enviado",
                      description: `Um link de redefinição de senha foi enviado para ${member.profile.email}.`,
                    });
                  } catch (error: any) {
                    console.error("Error sending reset email:", error);
                    toast({
                      title: "Erro",
                      description: error?.message || "Não foi possível enviar o email de redefinição.",
                      variant: "destructive",
                    });
                  } finally {
                    setIsSendingReset(false);
                  }
                }}
              >
                {isSendingReset ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Enviando...
                  </>
                ) : (
                  "Enviar email de redefinição de senha"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Um link será enviado para o email do membro
              </p>
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <UserCog className="h-4 w-4" />
                Role
              </Label>
              {isOwner ? (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  <Crown className="h-3 w-3 mr-1" />
                  Owner
                </Badge>
              ) : (
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentUserIsSuperAdmin && (
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    )}
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                {selectedRole === "super_admin" 
                  ? "Acesso total a plataforma, todas as empresas e configuracoes globais" 
                  : selectedRole === "admin" 
                  ? "Pode gerenciar workspaces, agentes, equipe e configuracoes" 
                  : "Pode ver e usar agentes nos workspaces alocados"}
              </p>
            </div>
          </div>

          <Separator />

          {/* api4com extension */}
          <Api4comExtensionPicker
            userId={member.user_id}
            companyId={companyId}
            userEmail={member.profile.email}
          />

          <Separator />

          {/* Workspace Access */}
          <div>
            <Label className="text-sm font-medium mb-3 block">
              <Layers className="h-4 w-4 inline mr-2" />
              Acesso aos Workspaces
            </Label>

            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhum workspace encontrado
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isOwnerOrAdmin
                        ? "bg-muted/50 border-border/50"
                        : "bg-card border-border hover:bg-muted/30 cursor-pointer"
                    }`}
                    onClick={() => handleToggleWorkspace(workspace.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-lg">
                        {workspace.icon || "📁"}
                      </div>
                      <span className="font-medium text-sm">{workspace.name}</span>
                    </div>

                    {isOwnerOrAdmin ? (
                      <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                        {member.role === "owner" ? (
                          <>
                            <Crown className="h-3 w-3 mr-1" />
                            Auto
                          </>
                        ) : (
                          <>
                            <Shield className="h-3 w-3 mr-1" />
                            Auto
                          </>
                        )}
                      </Badge>
                    ) : (
                      <Checkbox
                        checked={allocatedWorkspaces.has(workspace.id)}
                        onCheckedChange={() => handleToggleWorkspace(workspace.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {isOwnerOrAdmin && (
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Owners e Admins têm acesso automático a todos os workspaces
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MemberEditDialog;
