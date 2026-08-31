import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Edit, Trash2, Building2, Loader2, Mail, RefreshCw, UserPlus, CheckCircle, Clock } from 'lucide-react';
import { getAppBaseUrl } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Company {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  owner_id: string | null;
  created_at: string | null;
  member_count?: number;
  owner_email?: string;
  invite_status?: 'pending' | 'accepted' | 'none';
  invite_email?: string;
}

interface CompanyInvite {
  id: string;
  email: string;
  invitee_name: string | null;
  invitee_phone: string | null;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
}

const AdminCompanies = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    try {
      setLoading(true);
      
      // Fetch companies with member counts
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select(`
          *,
          company_members(id)
        `)
        .order('created_at', { ascending: false });

      if (companiesError) throw companiesError;

      // Fetch owner emails separately
      const ownerIds = [...new Set((companiesData || []).map(c => c.owner_id).filter(Boolean))];
      let ownerEmails: Record<string, string> = {};
      
      if (ownerIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', ownerIds);
        
        ownerEmails = (profilesData || []).reduce((acc, p) => {
          acc[p.id] = p.email;
          return acc;
        }, {} as Record<string, string>);
      }

      // Fetch latest invite for each company
      const companyIds = (companiesData || []).map(c => c.id);
      const invitesByCompany: Record<string, CompanyInvite> = {};
      
      if (companyIds.length > 0) {
        const { data: invitesData } = await supabase
          .from('company_invites')
          .select('id, email, invitee_name, invitee_phone, role, status, created_at, expires_at, company_id')
          .in('company_id', companyIds)
          .order('created_at', { ascending: false });
        
        // Get the most recent invite per company
        (invitesData || []).forEach((invite: any) => {
          if (!invitesByCompany[invite.company_id]) {
            invitesByCompany[invite.company_id] = invite;
          }
        });
      }

      const companiesWithCounts = (companiesData || []).map((company: any) => {
        const invite = invitesByCompany[company.id];
        return {
          ...company,
          member_count: company.company_members?.length || 0,
          owner_email: company.owner_id ? ownerEmails[company.owner_id] || 'N/A' : 'N/A',
          invite_status: invite ? (invite.status as 'pending' | 'accepted') : 'none',
          invite_email: invite?.email,
        };
      });

      setCompanies(companiesWithCounts);
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      toast.error('Erro ao carregar empresas');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCompany(formData: {
    name: string;
    description: string;
    firstUserName: string;
    firstUserEmail: string;
    firstUserPhone: string;
    firstUserRole: string;
  }) {
    try {
      setSaving(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      
      // Create company
      const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .insert([{
          name: formData.name,
          description: formData.description || null,
          owner_id: user?.id,
        }])
        .select()
        .single();

      if (companyError) throw companyError;

      // Create invite for first user
      const { data: inviteData, error: inviteError } = await supabase
        .from('company_invites')
        .insert([{
          company_id: companyData.id,
          email: formData.firstUserEmail,
          invitee_name: formData.firstUserName,
          invitee_phone: formData.firstUserPhone,
          role: formData.firstUserRole,
          created_by: user?.id,
        }])
        .select()
        .single();

      if (inviteError) throw inviteError;

      // Send invite email
      const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${inviteData.token}`;
      
      const { data: profileData } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user?.id || '')
        .single();

      const { error: emailError } = await supabase.functions.invoke('send-invite-email', {
        body: {
          email: formData.firstUserEmail,
          companyName: formData.name,
          company_id: companyData.id,
          inviteLink,
          role: formData.firstUserRole,
          inviterName: profileData?.name || user?.email,
          inviteeName: formData.firstUserName,
        },
      });

      if (emailError) {
        console.error('Email error:', emailError);
        toast.warning('Empresa criada, mas houve um erro ao enviar o email');
      } else {
        toast.success('Empresa criada e convite enviado com sucesso');
      }

      setCompanies([{
        ...companyData,
        member_count: 0,
        owner_email: user?.email || 'N/A',
        invite_status: 'pending',
        invite_email: formData.firstUserEmail,
      }, ...companies]);
      
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Erro ao criar empresa:', error);
      toast.error('Erro ao criar empresa');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCompany(formData: { name: string; description: string }) {
    if (!editingCompany) return;

    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('companies')
        .update({
          name: formData.name,
          description: formData.description || null,
        })
        .eq('id', editingCompany.id);

      if (error) throw error;

      setCompanies(companies.map(c =>
        c.id === editingCompany.id
          ? { ...c, name: formData.name, description: formData.description }
          : c
      ));
      setEditingCompany(null);
      toast.success('Empresa atualizada com sucesso');
    } catch (error) {
      console.error('Erro ao atualizar empresa:', error);
      toast.error('Erro ao atualizar empresa');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCompany() {
    if (!deleteConfirm) return;

    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('companies')
        .delete()
        .eq('id', deleteConfirm.id);

      if (error) throw error;

      setCompanies(companies.filter(c => c.id !== deleteConfirm.id));
      setDeleteConfirm(null);
      toast.success('Empresa deletada com sucesso');
    } catch (error) {
      console.error('Erro ao deletar empresa:', error);
      toast.error('Erro ao deletar empresa');
    } finally {
      setSaving(false);
    }
  }

  async function handleResendInvite(companyId: string) {
    try {
      setResendingInvite(companyId);
      
      // Get the latest pending invite for this company
      const { data: invite, error: inviteError } = await supabase
        .from('company_invites')
        .select('*')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (inviteError || !invite) {
        toast.error('Nenhum convite pendente encontrado');
        return;
      }

      // Get company name
      const company = companies.find(c => c.id === companyId);
      
      // Get inviter info
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profileData } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user?.id || '')
        .single();

      const inviteLink = `${getAppBaseUrl()}/accept-invite?token=${invite.token}`;

      const { error: emailError } = await supabase.functions.invoke('send-invite-email', {
        body: {
          email: invite.email,
          companyName: company?.name || 'Empresa',
          company_id: companyId,
          inviteLink,
          role: invite.role,
          inviterName: profileData?.name || user?.email,
          inviteeName: invite.invitee_name,
        },
      });

      if (emailError) {
        throw emailError;
      }

      toast.success('Convite reenviado com sucesso');
    } catch (error) {
      console.error('Erro ao reenviar convite:', error);
      toast.error('Erro ao reenviar convite');
    } finally {
      setResendingInvite(null);
    }
  }

  const getInviteStatusBadge = (company: Company) => {
    if (company.invite_status === 'pending') {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="gap-1 text-warning border-warning">
                <Clock className="h-3 w-3" />
                Pendente
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Convite enviado para {company.invite_email}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (company.invite_status === 'accepted') {
      return (
        <Badge variant="outline" className="gap-1 text-success border-success">
          <CheckCircle className="h-3 w-3" />
          Aceito
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Gerenciar Empresas</h1>
            <p className="text-muted-foreground text-sm">
              Crie, edite e delete empresas da plataforma
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Empresa
          </Button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : companies.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma empresa criada ainda</p>
            <Button 
              onClick={() => setShowCreateDialog(true)} 
              className="mt-4 gap-2"
            >
              <Plus className="w-4 h-4" />
              Criar Primeira Empresa
            </Button>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Proprietario</TableHead>
                  <TableHead>Membros</TableHead>
                  <TableHead>Status Convite</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {company.description || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {company.owner_email}
                    </TableCell>
                    <TableCell>
                      <span className="bg-muted text-muted-foreground px-2 py-1 rounded text-xs">
                        {company.member_count} membros
                      </span>
                    </TableCell>
                    <TableCell>
                      {getInviteStatusBadge(company)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {company.created_at 
                        ? new Date(company.created_at).toLocaleDateString('pt-BR')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {company.invite_status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleResendInvite(company.id)}
                            disabled={resendingInvite === company.id}
                            title="Reenviar convite"
                          >
                            {resendingInvite === company.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingCompany(company)}
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(company)}
                          title="Deletar"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <CreateCompanyDialog
        open={showCreateDialog}
        saving={saving}
        onSave={handleCreateCompany}
        onClose={() => setShowCreateDialog(false)}
      />

      {/* Edit Dialog */}
      <EditCompanyDialog
        open={!!editingCompany}
        company={editingCompany}
        saving={saving}
        onSave={handleUpdateCompany}
        onClose={() => setEditingCompany(null)}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar Empresa?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            Tem certeza que deseja deletar "{deleteConfirm?.name}"? 
            Esta acao ira remover todos os dados associados e nao pode ser desfeita.
          </p>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              className="flex-1"
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCompany}
              className="flex-1"
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deletar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Create Company Dialog Component with First User
function CreateCompanyDialog({
  open,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  saving: boolean;
  onSave: (data: {
    name: string;
    description: string;
    firstUserName: string;
    firstUserEmail: string;
    firstUserPhone: string;
    firstUserRole: string;
  }) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    firstUserName: '',
    firstUserEmail: '',
    firstUserPhone: '',
    firstUserRole: 'admin',
  });

  useEffect(() => {
    if (!open) {
      setFormData({
        name: '',
        description: '',
        firstUserName: '',
        firstUserEmail: '',
        firstUserPhone: '',
        firstUserRole: 'admin',
      });
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Nome da empresa e obrigatorio');
      return;
    }
    if (!formData.firstUserName.trim()) {
      toast.error('Nome do primeiro usuario e obrigatorio');
      return;
    }
    if (!formData.firstUserEmail.trim()) {
      toast.error('Email do primeiro usuario e obrigatorio');
      return;
    }
    if (!formData.firstUserPhone.trim()) {
      toast.error('Telefone do primeiro usuario e obrigatorio');
      return;
    }
    onSave(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Criar Nova Empresa
          </DialogTitle>
          <DialogDescription>
            Crie a empresa e adicione o primeiro administrador
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Dados da Empresa
            </h3>
            <div className="space-y-2">
              <Label htmlFor="name">Nome da Empresa *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Empresa XYZ"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descricao da empresa"
                rows={2}
              />
            </div>
          </div>

          {/* First User Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Primeiro Usuario (recebera convite por email)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstUserName">Nome *</Label>
                <Input
                  id="firstUserName"
                  value={formData.firstUserName}
                  onChange={(e) => setFormData({ ...formData, firstUserName: e.target.value })}
                  placeholder="Nome completo"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstUserPhone">Telefone *</Label>
                <Input
                  id="firstUserPhone"
                  value={formData.firstUserPhone}
                  onChange={(e) => setFormData({ ...formData, firstUserPhone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstUserEmail">Email *</Label>
                <Input
                  id="firstUserEmail"
                  type="email"
                  value={formData.firstUserEmail}
                  onChange={(e) => setFormData({ ...formData, firstUserEmail: e.target.value })}
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstUserRole">Funcao</Label>
                <Select
                  value={formData.firstUserRole}
                  onValueChange={(value) => setFormData({ ...formData, firstUserRole: value })}
                >
                  <SelectTrigger id="firstUserRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="member">Membro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Criar e Enviar Convite
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Edit Company Dialog Component
function EditCompanyDialog({
  open,
  company,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  company: Company | null;
  saving: boolean;
  onSave: (data: { name: string; description: string }) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });

  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name,
        description: company.description || '',
      });
    } else {
      setFormData({ name: '', description: '' });
    }
  }, [company, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Nome da empresa e obrigatorio');
      return;
    }
    onSave(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Empresa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome da Empresa</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: Empresa XYZ"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Descrição</Label>
            <Textarea
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Descricao da empresa"
              rows={3}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Atualizar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AdminCompanies;