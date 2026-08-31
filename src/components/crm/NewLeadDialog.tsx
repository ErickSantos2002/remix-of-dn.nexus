import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, ExternalLink } from "lucide-react";
import { getInitialStages } from "@/lib/pipelineValidation";
import { useContactSources } from "@/hooks/useContactSources";

interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
}

interface WorkspaceMember {
  user_id: string;
  profile: {
    name: string | null;
    email: string | null;
  } | null;
}

interface NewLeadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    job_title?: string;
    description?: string;
  };
}

export function NewLeadDialog({ isOpen, onClose, onSuccess, initialData }: NewLeadDialogProps) {
  const { currentWorkspace } = useWorkspace();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { data: contactSources = [] } = useContactSources();

  const [contactMatch, setContactMatch] = useState<{
    contact: { id: string; name: string; phone: string | null; email: string | null; company: string | null; job_title: string | null };
    leadId: string | null;
  } | null>(null);

  const [newLead, setNewLead] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
    job_title: "",
    employee_count: "",
    revenue: "",
    title: "",
    description: "",
    value: "",
    stage_id: "",
    product_id: "",
    assigned_to: "",
    origem: "",
  });

  const [formErrors, setFormErrors] = useState<{
    name?: boolean;
    phone?: boolean;
  }>({});

  // Get current user ID on mount
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    };
    fetchUser();
  }, []);

  // Pre-fill with initialData when dialog opens
  useEffect(() => {
    if (isOpen) {
      setNewLead(prev => ({
        ...prev,
        name: initialData?.name || "",
        phone: initialData?.phone || "",
        email: initialData?.email || "",
        job_title: initialData?.job_title || "",
        company: initialData?.company || "",
        description: initialData?.description || "",
        assigned_to: currentUserId || "",
      }));
      setFormErrors({});
      setContactMatch(null);
    }
  }, [isOpen, initialData, currentUserId]);

  // Fetch company workspace IDs for cross-workspace search
  const { data: companyWorkspaceIds = [] } = useQuery({
    queryKey: ["company-workspace-ids", currentWorkspace?.company_id],
    queryFn: async () => {
      if (!currentWorkspace?.company_id) return [];
      const { data } = await supabase
        .from("workspaces")
        .select("id")
        .eq("company_id", currentWorkspace.company_id);
      return (data || []).map(w => w.id);
    },
    enabled: !!currentWorkspace?.company_id && isOpen,
  });

  // Debounced contact search by phone or email
  useEffect(() => {
    if (!isOpen || companyWorkspaceIds.length === 0) return;

    const phone = newLead.phone.replace(/\D/g, "");
    const email = newLead.email.trim();
    const hasPhone = phone.length >= 8;
    const hasEmail = email.includes("@");

    if (!hasPhone && !hasEmail) {
      setContactMatch(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        let orFilters: string[] = [];
        if (hasPhone) orFilters.push(`phone.ilike.%${phone}%`);
        if (hasEmail) orFilters.push(`email.ilike.%${email}%`);

        const { data: contacts } = await supabase
          .from("crm_contacts")
          .select("id, name, phone, email, company, job_title")
          .in("workspace_id", companyWorkspaceIds)
          .or(orFilters.join(","))
          .neq("is_active", false)
          .limit(1)
          .maybeSingle();

        if (!contacts) {
          setContactMatch(null);
          return;
        }

        // Check if contact has an open CRM lead
        const { data: existingLead } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("contact_id", contacts.id)
          .eq("status", "open")
          .is("deleted_at", null)
          .maybeSingle();

        setContactMatch({
          contact: contacts,
          leadId: existingLead?.id || null,
        });
      } catch {
        setContactMatch(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [newLead.phone, newLead.email, isOpen, companyWorkspaceIds]);

  // Fetch stages
  const { data: stages = [] } = useQuery({
    queryKey: ["crm-stages", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("order", { ascending: true });
      if (error) throw error;
      return data as Stage[];
    },
    enabled: !!currentWorkspace?.id && isOpen,
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["crm-products", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_products")
        .select("id, name, price")
        .eq("workspace_id", currentWorkspace.id)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!currentWorkspace?.id && isOpen,
  });

  // Fetch workspace members (expanded: includes owner + company admins)
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members-expanded", currentWorkspace?.id, companyId],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const membersMap = new Map<string, WorkspaceMember>();

      // 1. Workspace members
      const { data: wsMembers } = await supabase
        .from("workspace_members")
        .select("user_id, profiles!workspace_members_user_id_fkey(name, email)")
        .eq("workspace_id", currentWorkspace.id)
        .eq("status", "active");
      (wsMembers || []).forEach((m: any) => {
        if (!membersMap.has(m.user_id)) {
          membersMap.set(m.user_id, { user_id: m.user_id, profile: m.profiles || null });
        }
      });

      // 2. Workspace owner
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("owner_id")
        .eq("id", currentWorkspace.id)
        .single();
      if (wsData?.owner_id && !membersMap.has(wsData.owner_id)) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", wsData.owner_id)
          .single();
        if (ownerProfile) {
          membersMap.set(wsData.owner_id, { user_id: wsData.owner_id, profile: ownerProfile });
        }
      }

      // 3. Company admins/super_admins
      if (companyId) {
        const { data: admins } = await supabase
          .from("company_members")
          .select("user_id, profiles!company_members_user_id_fkey(name, email)")
          .eq("company_id", companyId)
          .eq("status", "active")
          .in("role", ["admin", "super_admin"]);
        (admins || []).forEach((m: any) => {
          if (!membersMap.has(m.user_id)) {
            membersMap.set(m.user_id, { user_id: m.user_id, profile: m.profiles || null });
          }
        });
      }

      return Array.from(membersMap.values());
    },
    enabled: !!currentWorkspace?.id && isOpen,
  });

  // Create lead mutation
  const isSubmittingRef = useRef(false);

  const createLead = useMutation({
    mutationFn: async () => {
      // Prevent double submission
      if (isSubmittingRef.current) {
        console.log("[NewLeadDialog] Ignoring duplicate submission");
        return;
      }
      isSubmittingRef.current = true;

      if (!currentWorkspace?.id || !newLead.name.trim()) {
        isSubmittingRef.current = false;
        return;
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      const stageId = newLead.stage_id || stages[0]?.id;
      if (!stageId) throw new Error("Nenhum estágio disponível");

      let contactId: string;

      // Check if contact with phone already exists
      if (newLead.phone?.trim()) {
        const { data: existingContact } = await supabase
          .from("crm_contacts")
          .select("id, is_active")
          .eq("workspace_id", currentWorkspace.id)
          .eq("phone", newLead.phone.trim())
          .maybeSingle();

        if (existingContact) {
          if (existingContact.is_active !== false) {
            // Check if contact already has a lead
            const { data: existingLead } = await supabase
              .from("crm_leads")
              .select("id")
              .eq("contact_id", existingContact.id)
              .is("deleted_at", null)
              .maybeSingle();

            if (existingLead) {
              throw new Error("Lead já existe para este telefone");
            }

            // Link to existing contact
            contactId = existingContact.id;
            await supabase.from("crm_contacts").update({
              name: newLead.name.trim(),
              email: newLead.email || null,
              company: newLead.company || null,
              job_title: newLead.job_title || null,
              employee_count: newLead.employee_count || null,
              revenue: newLead.revenue || null,
              notes: newLead.description || null,
            }).eq("id", contactId);
          } else {
            // Reactivate inactive contact
            contactId = existingContact.id;
            await supabase.from("crm_contacts").update({
              is_active: true,
              name: newLead.name.trim(),
              email: newLead.email || null,
              company: newLead.company || null,
              job_title: newLead.job_title || null,
              employee_count: newLead.employee_count || null,
              revenue: newLead.revenue || null,
              notes: newLead.description || null,
            }).eq("id", contactId);
          }
        } else {
          // Create new contact
          const { data: newContact, error: contactError } = await supabase
            .from("crm_contacts")
            .insert({
              workspace_id: currentWorkspace.id,
              name: newLead.name.trim(),
              phone: newLead.phone.trim(),
              email: newLead.email || null,
              company: newLead.company || null,
              job_title: newLead.job_title || null,
              employee_count: newLead.employee_count || null,
              revenue: newLead.revenue || null,
              notes: newLead.description || null,
              source: newLead.origem || "pipeline",
              is_active: true,
              created_by: user?.id,
            })
            .select("id")
            .single();

          if (contactError) throw contactError;
          contactId = newContact.id;
        }
      } else {
        // No phone - create new contact
        const { data: newContact, error: contactError } = await supabase
          .from("crm_contacts")
          .insert({
            workspace_id: currentWorkspace.id,
            name: newLead.name.trim(),
            phone: null,
            email: newLead.email || null,
            company: newLead.company || null,
            job_title: newLead.job_title || null,
            employee_count: newLead.employee_count || null,
            revenue: newLead.revenue || null,
            notes: newLead.description || null,
            source: newLead.origem || "pipeline",
            is_active: true,
            created_by: user?.id,
          })
          .select("id")
          .single();

        if (contactError) throw contactError;
        contactId = newContact.id;
      }

      // Check if trigger already created the lead
      const { data: existingLead } = await supabase
        .from("crm_leads")
        .select("id, stage_id")
        .eq("contact_id", contactId)
        .eq("status", "open")
        .is("deleted_at", null)
        .maybeSingle();

      let leadId: string;

      if (existingLead) {
        // Update existing lead
        const { error: updateError } = await supabase
          .from("crm_leads")
          .update({
            title: newLead.title?.trim() || newLead.company?.trim() || newLead.name.trim() || null,
            description: newLead.description || null,
            value: parseFloat(newLead.value) || 0,
            product_id: newLead.product_id || null,
            assigned_to: newLead.assigned_to || user?.id || null,
            stage_id: stageId,
          })
          .eq("id", existingLead.id);

        if (updateError) throw updateError;
        leadId = existingLead.id;

        if (existingLead.stage_id !== stageId) {
          await supabase.from("crm_lead_history").insert({
            lead_id: leadId,
            from_stage_id: existingLead.stage_id,
            to_stage_id: stageId,
            moved_by: "user",
            reason: "stage_change",
          });
        }
      } else {
        // Create new CRM Lead
        const { data: newLeadData, error: leadError } = await supabase
          .from("crm_leads")
          .insert({
            workspace_id: currentWorkspace.id,
            contact_id: contactId,
            stage_id: stageId,
            title: newLead.title?.trim() || newLead.company?.trim() || newLead.name.trim() || null,
            description: newLead.description || null,
            value: parseFloat(newLead.value) || 0,
            status: "open",
            product_id: newLead.product_id || null,
            assigned_to: newLead.assigned_to || user?.id || null,
            created_by: user?.id,
          })
          .select("id")
          .single();

        if (leadError) throw leadError;
        leadId = newLeadData.id;

        await supabase.from("crm_lead_history").insert({
          lead_id: leadId,
          to_stage_id: stageId,
          moved_by: "user",
          reason: "created",
        });
      }
    },
    onSuccess: () => {
      isSubmittingRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      setNewLead({
        name: "", phone: "", email: "", company: "", job_title: "",
        employee_count: "", revenue: "", title: "", description: "", value: "", stage_id: "",
        product_id: "", assigned_to: "", origem: ""
      });
      setFormErrors({});
      toast({ title: "Lead criado com sucesso" });
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      isSubmittingRef.current = false;
      console.error("[NewLeadDialog] Error:", error);
      if (error.message?.includes("Contato duplicado")) {
        toast({
          variant: "destructive",
          title: "Contato duplicado",
          description: error.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Erro ao criar lead",
          description: error.message,
        });
      }
    }
  });

  const handleClose = () => {
    setNewLead({
      name: "", phone: "", email: "", company: "", job_title: "",
      employee_count: "", revenue: "", title: "", description: "", value: "", stage_id: "",
      product_id: "", assigned_to: "", origem: ""
    });
    setFormErrors({});
    setContactMatch(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="glass-card border-border sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {/* Nome */}
          <div className="space-y-2">
            <Label>Nome <span className="text-destructive">*</span></Label>
            <Input
              value={newLead.name}
              onChange={(e) => {
                setNewLead({ ...newLead, name: e.target.value });
                if (formErrors.name) setFormErrors(prev => ({ ...prev, name: false }));
              }}
              placeholder="Nome completo"
              className={formErrors.name ? "border-destructive ring-1 ring-destructive" : ""}
            />
          </div>

          {/* Telefone + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={newLead.phone}
                onChange={(e) => {
                  setNewLead({ ...newLead, phone: e.target.value });
                  if (formErrors.phone) setFormErrors(prev => ({ ...prev, phone: false }));
                }}
                placeholder="(11) 99999-9999"
                className={formErrors.phone ? "border-destructive ring-1 ring-destructive" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={newLead.email}
                onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
          </div>

          {/* Contact match banner */}
          {contactMatch && (
            contactMatch.leadId ? (
              <Alert className="border-warning/50 bg-warning/10">
                <Search className="h-4 w-4 text-warning" />
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    Contato <strong>{contactMatch.contact.name}</strong> encontrado com card aberto no pipeline.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-warning/50 text-warning hover:bg-warning/20"
                    onClick={() => {
                      onClose();
                      navigate(`/crm/pipeline?lead=${contactMatch.leadId}`);
                    }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Ver card
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-primary/50 bg-primary/10">
                <Search className="h-4 w-4 text-primary" />
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    Contato <strong>{contactMatch.contact.name}</strong> encontrado sem card no pipeline.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-primary/50 text-primary hover:bg-primary/20"
                    onClick={() => {
                      setNewLead(prev => ({
                        ...prev,
                        name: contactMatch.contact.name || prev.name,
                        company: contactMatch.contact.company || prev.company,
                        job_title: contactMatch.contact.job_title || prev.job_title,
                        email: contactMatch.contact.email || prev.email,
                        phone: contactMatch.contact.phone || prev.phone,
                      }));
                      setContactMatch(null);
                    }}
                  >
                    Criar card para este contato
                  </Button>
                </AlertDescription>
              </Alert>
            )
          )}

          {/* Empresa + Cargo */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Input
                value={newLead.company}
                onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Input
                value={newLead.job_title}
                onChange={(e) => setNewLead({ ...newLead, job_title: e.target.value })}
                placeholder="Cargo ou função"
              />
            </div>
          </div>

          {/* Tamanho da Empresa + Faturamento */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tamanho da Empresa</Label>
              <Select
                value={newLead.employee_count}
                onValueChange={(v) => setNewLead({ ...newLead, employee_count: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Eu S.A.">Eu S.A.</SelectItem>
                  <SelectItem value="1-10 funcionários">1-10 funcionários</SelectItem>
                  <SelectItem value="11-50 funcionários">11-50 funcionários</SelectItem>
                  <SelectItem value="51-200 funcionários">51-200 funcionários</SelectItem>
                  <SelectItem value="+200 funcionários">+200 funcionários</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Faturamento</Label>
              <Select
                value={newLead.revenue}
                onValueChange={(v) => setNewLead({ ...newLead, revenue: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Até 100k/mês">Até 100k/mês</SelectItem>
                  <SelectItem value="Entre 100k e 500k/mes">Entre 100k e 500k/mes</SelectItem>
                  <SelectItem value="Entre 500k e 1MM/mes">Entre 500k e 1MM/mes</SelectItem>
                  <SelectItem value="Entre 1MM e 3MM/mes">Entre 1MM e 3MM/mes</SelectItem>
                  <SelectItem value="Acima de 5MM/mes">Acima de 5MM/mes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Titulo do Lead */}
          <div className="space-y-2">
            <Label>Título do Lead</Label>
            <Input
              value={newLead.title}
              onChange={(e) => setNewLead({ ...newLead, title: e.target.value })}
              placeholder="Ex: Venda de produto X"
            />
          </div>

          {/* Produto */}
          {products.length > 0 && (
            <div className="space-y-2">
              <Label>Produto</Label>
              <Select
                value={newLead.product_id}
                onValueChange={(v) => setNewLead({ ...newLead, product_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Valor do Negocio */}
          <div className="space-y-2">
            <Label>Valor do Negócio (R$)</Label>
            <Input
              type="number"
              value={newLead.value}
              onChange={(e) => setNewLead({ ...newLead, value: e.target.value })}
              placeholder="Ex: 10000"
            />
          </div>

          {/* Vendedor/Atendente */}
          {members.length > 0 && (
            <div className="space-y-2">
              <Label>Vendedor/Atendente</Label>
              <Select
                value={newLead.assigned_to}
                onValueChange={(v) => setNewLead({ ...newLead, assigned_to: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um responsável" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.profile?.name || m.profile?.email || "Sem nome"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Origem */}
          <div className="space-y-2">
            <Label>Origem</Label>
            <Select
              value={newLead.origem}
              onValueChange={(v) => setNewLead({ ...newLead, origem: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a origem" />
              </SelectTrigger>
              <SelectContent>
                {contactSources.map((opt) => (
                  <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Estágio */}
          <div className="space-y-2">
            <Label>Estágio</Label>
            <Select
              value={newLead.stage_id}
              onValueChange={(v) => setNewLead({ ...newLead, stage_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Primeiro estágio" />
              </SelectTrigger>
              <SelectContent>
                {getInitialStages(stages).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Observações */}
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={newLead.description}
              onChange={(e) => setNewLead({ ...newLead, description: e.target.value })}
              placeholder="Notas sobre o contato..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => createLead.mutate()}
              disabled={!newLead.name.trim() || createLead.isPending}
            >
              Criar Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
