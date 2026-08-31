import { useState, useEffect } from "react";
import Breadcrumbs from "@/components/layout/Breadcrumbs";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { getAppBaseUrl } from "@/lib/utils";
import MemberEditDialog from "@/components/team/MemberEditDialog";
import InviteLinkDialog from "@/components/team/InviteLinkDialog";
import DirectRegisterDialog from "@/components/team/DirectRegisterDialog";
import WorkspaceSelector from "@/components/team/WorkspaceSelector";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  Mail,
  Send,
  RefreshCw,
  X,
  UserMinus,
  Loader2,
  Clock,
  CheckCircle,
  Building2,
  Settings,
  UserPlus,
  Copy,
  Link,
} from "lucide-react";

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  created_at: string;
  expires_at: string;
  workspace_ids: string[] | null;
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

const TeamSettings = () => {
  const { currentCompany, isOwner: isCompanyOwner, isAdmin: isCompanyAdmin } = useCompany();
  const { userId, isSuperAdmin } = useUserRole();
  const { toast } = useToast();

  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // Form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("member");
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([]);

  // Dialog state
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [inviteToCancel, setInviteToCancel] = useState<Invite | null>(null);
  const [memberToEdit, setMemberToEdit] = useState<Member | null>(null);
  
  // New dialog states
  const [showInviteLinkDialog, setShowInviteLinkDialog] = useState(false);
  const [inviteLinkData, setInviteLinkData] = useState<{
    link: string;
    email: string;
    emailSent: boolean;
  } | null>(null);
  const [showDirectRegisterDialog, setShowDirectRegisterDialog] = useState(false);

  const fetchTeamData = async () => {
    if (!currentCompany?.id) return;

    setIsLoading(true);
    try {
      // Fetch pending invites from company_invites (including workspace_ids)
      const { data: invitesData, error: invitesError } = await supabase
        .from("company_invites")
        .select("id, email, role, status, token, created_at, expires_at, workspace_ids")
        .eq("company_id", currentCompany.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (invitesError) throw invitesError;
      setInvites((invitesData || []) as Invite[]);

      // Fetch company members
      const { data: membersData, error: membersError } = await supabase
        .from("company_members")
        .select(`
          *,
          profile:profiles!company_members_user_id_fkey(name, email)
        `)
        .eq("company_id", currentCompany.id)
        .eq("status", "active")
        .order("joined_at", { ascending: false });

      if (membersError) throw membersError;

      // Fetch super_admin roles from user_roles to override company_members roles
      const { data: superAdminRoles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("role", "super_admin");

      const superAdminUserIds = new Set(superAdminRoles?.map(r => r.user_id) || []);

      // Override roles for super_admins
      const membersWithCorrectRoles = (membersData || []).map((m: any) => ({
        ...m,
        role: superAdminUserIds.has(m.user_id) ? "super_admin" : m.role
      }));

      // Fetch company owner
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select(`
          owner_id,
          created_at
        `)
        .eq("id", currentCompany.id)
        .single();

      if (companyError) throw companyError;

      // Filtrar membros que tem profile valido (pode ser null se usuario foi deletado)
      const validMembers = membersWithCorrectRoles.filter((m: any) => m.profile !== null);
      const allMembers: Member[] = (validMembers as unknown as Member[]) || [];

      // Add owner to members list if not already present
      if (companyData?.owner_id) {
        const ownerAlreadyInList = allMembers.some(
          (m) => m.user_id === companyData.owner_id
        );

        if (!ownerAlreadyInList) {
          // Fetch owner profile separately
          const { data: ownerProfile } = await supabase
            .from("profiles")
            .select("name, email")
            .eq("id", companyData.owner_id)
            .single();

          if (ownerProfile) {
            const ownerAsMember: Member = {
              id: `owner-${companyData.owner_id}`,
              user_id: companyData.owner_id,
              role: "owner",
              status: "active",
              joined_at: companyData.created_at || new Date().toISOString(),
              profile: ownerProfile,
            };
            allMembers.unshift(ownerAsMember);
          }
        }
      }

      setMembers(allMembers);
    } catch (error) {
      console.error("Error fetching team data:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel carregar os dados da equipe.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamData();
  }, [currentCompany?.id]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const getInviteLink = (token: string) => {
    return `${getAppBaseUrl()}/accept-invite?token=${token}`;
  };

  const handleSendInvite = async () => {
    if (!currentCompany?.id || !userId) return;

    if (!inviteEmail.trim()) {
      toast({
        title: "Erro",
        description: "Por favor, insira um email.",
        variant: "destructive",
      });
      return;
    }

    if (!validateEmail(inviteEmail)) {
      toast({
        title: "Erro",
        description: "Por favor, insira um email valido.",
        variant: "destructive",
      });
      return;
    }

    // Query database directly to check for existing active members (avoid stale cache issues)
    const { data: activeMembers } = await supabase
      .from("company_members")
      .select(`
        user_id,
        profiles!company_members_user_id_fkey(email)
      `)
      .eq("company_id", currentCompany.id)
      .eq("status", "active");

    const isAlreadyMember = activeMembers?.some(
      (m: any) => m.profiles?.email?.toLowerCase() === inviteEmail.toLowerCase()
    );

    if (isAlreadyMember) {
      toast({
        title: "Erro",
        description: "Este email ja e membro ativo da empresa.",
        variant: "destructive",
      });
      return;
    }

    // Check for existing pending invites
    const { data: existingInvites } = await supabase
      .from("company_invites")
      .select("id")
      .eq("company_id", currentCompany.id)
      .ilike("email", inviteEmail)
      .eq("status", "pending")
      .limit(1);

    if (existingInvites && existingInvites.length > 0) {
      toast({
        title: "Erro",
        description: "Ja existe um convite pendente para este email.",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      // Create invite in database with workspace_ids
      const { data: inviteData, error } = await supabase
        .from("company_invites")
        .insert({
          company_id: currentCompany.id,
          email: inviteEmail.toLowerCase(),
          role: inviteRole,
          created_by: userId,
          workspace_ids: selectedWorkspaces.length > 0 ? selectedWorkspaces : null,
        })
        .select()
        .single();

      if (error) throw error;

      const inviteLink = getInviteLink(inviteData.token);

      // Try to send email via edge function
      let emailSent = false;
      try {
        const { data: emailResponse } = await supabase.functions.invoke("send-invite-email", {
          body: {
            email: inviteEmail.toLowerCase(),
            companyName: currentCompany.name,
            company_id: currentCompany.id,
            inviteLink: inviteLink,
            role: inviteRole,
          },
        });
        emailSent = emailResponse?.emailSent || false;
      } catch (emailError) {
        console.log("Email sending skipped:", emailError);
      }

      // Show invite link dialog
      setInviteLinkData({
        link: inviteLink,
        email: inviteEmail,
        emailSent: emailSent,
      });
      setShowInviteLinkDialog(true);

      setInviteEmail("");
      setInviteRole("member");
      setSelectedWorkspaces([]);
      fetchTeamData();
    } catch (error) {
      console.error("Error sending invite:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel enviar o convite.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleCopyInviteLink = async (invite: Invite) => {
    const link = getInviteLink(invite.token);
    try {
      await navigator.clipboard.writeText(link);
      toast({
        title: "Link copiado",
        description: "O link de convite foi copiado para a area de transferencia.",
      });
    } catch (error) {
      toast({
        title: "Erro",
        description: "Nao foi possivel copiar o link.",
        variant: "destructive",
      });
    }
  };

  const handleResendInvite = async (invite: Invite) => {
    try {
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      const { error } = await supabase
        .from("company_invites")
        .update({ expires_at: newExpiresAt.toISOString() })
        .eq("id", invite.id);

      if (error) throw error;

      // Try to resend email
      const inviteLink = getInviteLink(invite.token);
      try {
        await supabase.functions.invoke("send-invite-email", {
          body: {
            email: invite.email,
            companyName: currentCompany?.name,
            company_id: currentCompany?.id,
            inviteLink: inviteLink,
            role: invite.role,
          },
        });
      } catch (emailError) {
        console.log("Email sending skipped:", emailError);
      }

      toast({
        title: "Convite reenviado",
        description: `Convite reenviado para ${invite.email}`,
      });

      fetchTeamData();
    } catch (error) {
      console.error("Error resending invite:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel reenviar o convite.",
        variant: "destructive",
      });
    }
  };

  const handleCancelInvite = async () => {
    if (!inviteToCancel) return;

    try {
      const { error } = await supabase
        .from("company_invites")
        .delete()
        .eq("id", inviteToCancel.id);

      if (error) throw error;

      toast({
        title: "Convite cancelado",
        description: `Convite para ${inviteToCancel.email} foi cancelado.`,
      });

      setInviteToCancel(null);
      fetchTeamData();
    } catch (error) {
      console.error("Error canceling invite:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel cancelar o convite.",
        variant: "destructive",
      });
    }
  };

  const handleChangeRole = async (memberId: string, userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from("company_members")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;

      // Sincronizar com user_roles para super_admin
      if (newRole === "super_admin") {
        // Deletar registro existente e inserir novo (constraint é user_id + role)
        await supabase.from("user_roles").delete().eq("user_id", userId);
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: "super_admin" });
        if (roleError) console.error("Error setting super_admin in user_roles:", roleError);
      } else {
        // Atualizar role para member (ou inserir se não existir)
        const { data: existingRole } = await supabase
          .from("user_roles")
          .select("id, role")
          .eq("user_id", userId)
          .single();
        
        if (existingRole) {
          await supabase
            .from("user_roles")
            .update({ role: newRole as "admin" | "member" })
            .eq("id", existingRole.id);
        } else {
          await supabase
            .from("user_roles")
            .insert({ user_id: userId, role: newRole as "admin" | "member" });
        }
      }

      const roleLabels: Record<string, string> = {
        super_admin: "Super Admin",
        admin: "Admin",
        member: "Member",
      };
      
      toast({
        title: "Role atualizado",
        description: `Role atualizado para ${roleLabels[newRole] || newRole}`,
      });

      fetchTeamData();
    } catch (error) {
      console.error("Error changing role:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel atualizar o role.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;

    try {
      const { error } = await supabase
        .from("company_members")
        .update({ status: "removed" })
        .eq("id", memberToRemove.id);

      if (error) throw error;

      toast({
        title: "Membro removido",
        description: `${memberToRemove.profile.name || memberToRemove.profile.email} foi removido.`,
      });

      setMemberToRemove(null);
      fetchTeamData();
    } catch (error) {
      console.error("Error removing member:", error);
      toast({
        title: "Erro",
        description: "Nao foi possivel remover o membro.",
        variant: "destructive",
      });
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  if (!currentCompany) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Building2 className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">
          Selecione uma Empresa
        </h2>
        <p className="text-muted-foreground text-center">
          Voce precisa selecionar uma empresa para gerenciar a equipe.
        </p>
      </div>
    );
  }

  const canManageTeam = isCompanyOwner || isCompanyAdmin || isSuperAdmin;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <Breadcrumbs />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Gerenciamento de Equipe
        </h1>
        <p className="text-muted-foreground">
          Convide membros e gerencie permissoes da empresa <strong>{currentCompany.name}</strong>
        </p>
      </div>

      {/* Add Member Section */}
      {canManageTeam && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Adicionar Novo Membro
            </CardTitle>
            <CardDescription>
              Escolha como adicionar um novo membro a empresa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="invite" className="w-full">
              <TabsList>
                <TabsTrigger value="invite" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Convidar por Email
                </TabsTrigger>
                <TabsTrigger value="direct" className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Cadastrar Diretamente
                </TabsTrigger>
              </TabsList>

              <TabsContent value="invite" className="space-y-4">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@exemplo.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="w-full sm:w-40 space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
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
                  </div>

                  {/* Workspace Selection */}
                  {currentCompany && (
                    <WorkspaceSelector
                      companyId={currentCompany.id}
                      selectedWorkspaces={selectedWorkspaces}
                      onSelectionChange={setSelectedWorkspaces}
                    />
                  )}

                  <div className="flex items-end">
                    <Button
                      onClick={handleSendInvite}
                      disabled={isSending || !inviteEmail}
                      className="w-full sm:w-auto"
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar Convite
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Um link de convite sera gerado. Se o servico de email estiver configurado, o convite sera enviado automaticamente.
                </p>
              </TabsContent>

              <TabsContent value="direct" className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-muted-foreground mb-4">
                    Crie uma conta diretamente para o novo membro. Voce recebera as credenciais para compartilhar.
                  </p>
                  <Button onClick={() => setShowDirectRegisterDialog(true)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Cadastrar Novo Usuario
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground space-y-1">
              {isSuperAdmin && (
                <p>
                  <strong>Super Admin:</strong> Acesso total a plataforma, todas as empresas e configuracoes globais
                </p>
              )}
              <p>
                <strong>Admin:</strong> Pode gerenciar workspaces, agentes, equipe e configuracoes
              </p>
              <p>
                <strong>Member:</strong> Pode ver e usar agentes em todos os workspaces
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Membros da Empresa
          </CardTitle>
          <CardDescription>
            Gerencie os membros e convites pendentes da empresa
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 && invites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mb-2" />
              <p>Nenhum membro ou convite encontrado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Membro</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Active Members */}
                {members.map((member) => {
                  const isOwner = member.role === "owner";
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {getInitials(member.profile.name, member.profile.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-foreground">
                              {member.profile.name || "Sem nome"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {member.profile.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isOwner ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            Owner
                          </Badge>
                        ) : canManageTeam ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              handleChangeRole(member.id, member.user_id, value)
                            }
                          >
                            <SelectTrigger className="w-32">
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
                        ) : (
                          <Badge variant="outline" className="capitalize">
                            {member.role}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="bg-success/10 text-success"
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Ativo
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(member.joined_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canManageTeam && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setMemberToEdit(member)}
                              title="Gerenciar acessos"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          )}
                          {!isOwner && canManageTeam && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setMemberToRemove(member)}
                            >
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {/* Pending Invites */}
                {invites.map((invite) => (
                  <TableRow key={invite.id} className="opacity-75">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                            {invite.email.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">
                            Convite Pendente
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {invite.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {invite.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isExpired(invite.expires_at) ? (
                        <Badge
                          variant="secondary"
                          className="bg-destructive/10 text-destructive"
                        >
                          Expirado
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-warning/10 text-warning"
                        >
                          <Clock className="h-3 w-3 mr-1" />
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManageTeam && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyInviteLink(invite)}
                            title="Copiar Link"
                          >
                            <Link className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResendInvite(invite)}
                            title="Reenviar Convite"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setInviteToCancel(invite)}
                            title="Cancelar Convite"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Remove Member Dialog */}
      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={() => setMemberToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Membro</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover{" "}
              <strong>
                {memberToRemove?.profile.name || memberToRemove?.profile.email}
              </strong>
              ? Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invite Dialog */}
      <AlertDialog
        open={!!inviteToCancel}
        onOpenChange={() => setInviteToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Convite</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar o convite para{" "}
              <strong>{inviteToCancel?.email}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvite}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar Convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Member Edit Dialog */}
      {currentCompany && (
        <MemberEditDialog
          member={memberToEdit}
          companyId={currentCompany.id}
          isOpen={!!memberToEdit}
          onClose={() => setMemberToEdit(null)}
          onSaved={fetchTeamData}
          currentUserIsSuperAdmin={isSuperAdmin}
        />
      )}

      {/* Invite Link Dialog */}
      {inviteLinkData && (
        <InviteLinkDialog
          isOpen={showInviteLinkDialog}
          onClose={() => {
            setShowInviteLinkDialog(false);
            setInviteLinkData(null);
          }}
          inviteLink={inviteLinkData.link}
          email={inviteLinkData.email}
          emailSent={inviteLinkData.emailSent}
        />
      )}

      {/* Direct Register Dialog */}
      {currentCompany && userId && (
        <DirectRegisterDialog
          isOpen={showDirectRegisterDialog}
          onClose={() => setShowDirectRegisterDialog(false)}
          companyId={currentCompany.id}
          companyName={currentCompany.name}
          currentUserId={userId}
          onSuccess={fetchTeamData}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </div>
  );
};

export default TeamSettings;
