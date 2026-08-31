import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Pencil, Trash2, User, Users, SearchX, Building2, Mail, Phone, MessageCircle, Loader2, Upload, Download, LayoutGrid, Merge, BellOff } from "lucide-react";
import { EmptyState } from "@/components/dn/EmptyState";
import { ContactDetailModal } from "@/components/crm/ContactDetailModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ContactTagList } from "@/components/crm/tags";
import { ContactsFilter, defaultFilters, type ContactFilters } from "@/components/crm/ContactsFilter";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { ContactsPagination } from "@/components/crm/ContactsPagination";
import { ExportContactsDialog, ImportContactsDialog } from "@/components/crm/contacts";
import { useUserRole } from "@/hooks/useUserRole";
import { useCompany } from "@/contexts/CompanyContext";
import { parseTags } from "@/types/tags";
import { formatPhoneForDisplay, normalizePhone, extractDDD } from "@/lib/phone";
import type { ContactTag } from "@/types/tags";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  notes: string | null;
  source: string;
  status: string;
  created_at: string;
  lead_id: string | null;
  tags: unknown; // JSONB from database
  opted_out?: boolean | null;
  opted_out_at?: string | null;
}

const emptyContact = {
  name: "",
  phone: "",
  email: "",
  company: "",
  job_title: "",
  notes: "",
  employee_count: "",
  revenue: "",
  deal_value: "",
  opted_out: false,
};

const PAGE_SIZE = 50;

// Brazil timezone (UTC-3) range helpers for created_at filter
const startOfDayBR = (yyyyMmDd: string) => `${yyyyMmDd}T00:00:00-03:00`;
const endOfDayBR = (yyyyMmDd: string) => `${yyyyMmDd}T23:59:59.999-03:00`;

// Client-side date range filter (used after RPC search results)
const isWithinDateRange = (
  createdAt: string | null,
  createdFrom?: string,
  createdTo?: string,
): boolean => {
  if (!createdFrom && !createdTo) return true;
  if (!createdAt) return false;
  const ts = new Date(createdAt).getTime();
  if (createdFrom && ts < new Date(startOfDayBR(createdFrom)).getTime()) return false;
  if (createdTo && ts > new Date(endOfDayBR(createdTo)).getTime()) return false;
  return true;
};

export default function CRMContacts() {
  const { currentWorkspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { contactId } = useParams();
  const [filters, setFilters] = usePersistedFilters<ContactFilters>(
    "crm-contacts",
    defaultFilters,
    currentWorkspace?.id ?? null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState(emptyContact);
  const [creatingLeadForContact, setCreatingLeadForContact] = useState<string | null>(null);
  const [creatingPipelineForContact, setCreatingPipelineForContact] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Permission hooks
  const { isAdmin, isSuperAdmin } = useUserRole();
  const { isOwner } = useCompany();

  // Check if user can export (owner, admin or super_admin)
  const canExport = isOwner || isAdmin || isSuperAdmin;
  const [isMerging, setIsMerging] = useState(false);
  const { companyId } = useCompany();

  const handleMergeDuplicates = async () => {
    if (!companyId) return;
    setIsMerging(true);
    try {
      const { data, error } = await supabase.functions.invoke("merge-duplicates", {
        body: { company_id: companyId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      if (data.groups_found === 0) {
        toast({ title: "Nenhum duplicado encontrado", description: "Todos os contatos são únicos." });
      } else {
        toast({
          title: "Duplicados corrigidos",
          description: `${data.groups_found} grupos encontrados. ${data.contacts_deactivated} contatos duplicados desativados.`,
        });
        queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
        queryClient.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      }

      if (data.errors?.length > 0) {
        console.warn("Merge errors:", data.errors);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ title: "Erro ao corrigir duplicados", description: message, variant: "destructive" });
    } finally {
      setIsMerging(false);
    }
  };

  // Check if there are active filters
  const hasActiveFilters =
    filters.search !== "" ||
    filters.source !== "all" ||
    filters.hasConversation !== "all" ||
    filters.tags.length > 0 ||
    filters.company !== "" ||
    filters.ddds.length > 0 ||
    !!filters.createdFrom ||
    !!filters.createdTo ||
    filters.optedOut !== "all";

  // Reset to page 1 when filters change
  const handleFiltersChange = (newFilters: ContactFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
    setSelectedIds(new Set());
  };

  // Fetch all contacts for company list (lightweight query)
  const { data: allCompanies = [] } = useQuery({
    queryKey: ["crm-contacts-companies", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("company")
        .eq("workspace_id", currentWorkspace.id)
        .neq("is_active", false)
        .not("company", "is", null);
      if (error) throw error;
      const uniqueCompanies = [...new Set(data.map((c) => c.company).filter(Boolean))] as string[];
      return uniqueCompanies.sort();
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch all phones for DDD aggregation
  const { data: availableDdds = [] } = useQuery({
    queryKey: ["crm-contacts-ddds", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [] as { ddd: string; count: number }[];
      const counts = new Map<string, number>();
      // Paginate to bypass 1000 row limit
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("crm_contacts")
          .select("phone")
          .eq("workspace_id", currentWorkspace.id)
          .neq("is_active", false)
          .not("phone", "is", null)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          const ddd = extractDDD(row.phone);
          if (ddd) counts.set(ddd, (counts.get(ddd) || 0) + 1);
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return Array.from(counts.entries())
        .map(([ddd, count]) => ({ ddd, count }))
        .sort((a, b) => a.ddd.localeCompare(b.ddd));
    },
    enabled: !!currentWorkspace?.id,
  });

  // Count query for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["crm-contacts-count", currentWorkspace?.id, filters],
    queryFn: async () => {
      if (!currentWorkspace?.id) return 0;

      if (filters.search) {
        // Use RPC for accent-insensitive search
        const { data, error } = await supabase.rpc("search_contacts_unaccent", {
          p_workspace_id: currentWorkspace.id,
          p_search: filters.search,
          p_source: filters.source !== "all" ? filters.source : null,
          p_has_conversation: filters.hasConversation !== "all" ? filters.hasConversation : null,
          p_company: filters.company || null,
          p_sort_by: filters.sortBy,
          p_sort_order: filters.sortOrder,
          p_offset: 0,
          p_limit: 10000,
          p_deleted_status: filters.deletedStatus,
        });
        if (error) throw error;
        let rows = (data || []) as Contact[];
        if (filters.createdFrom || filters.createdTo) {
          rows = rows.filter((c) =>
            isWithinDateRange(c.created_at ?? null, filters.createdFrom, filters.createdTo),
          );
        }
        if (filters.optedOut === "yes") {
          rows = rows.filter((c) => !c.opted_out);
        } else if (filters.optedOut === "no") {
          rows = rows.filter((c) => !!c.opted_out);
        }
        return rows.length;
      }

      let query = supabase
        .from("crm_contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", currentWorkspace.id);

      if (filters.deletedStatus === "active") {
        query = query.neq("is_active", false);
      } else if (filters.deletedStatus === "deleted") {
        query = query.eq("is_active", false);
      }

      if (filters.source !== "all") {
        query = query.eq("source", filters.source);
      }

      if (filters.hasConversation === "active") {
        query = query.not("lead_id", "is", null);
      } else if (filters.hasConversation === "none") {
        query = query.is("lead_id", null);
      }

      if (filters.company) {
        query = query.eq("company", filters.company);
      }

      if (filters.createdFrom) {
        query = query.gte("created_at", startOfDayBR(filters.createdFrom));
      }
      if (filters.createdTo) {
        query = query.lte("created_at", endOfDayBR(filters.createdTo));
      }

      if (filters.optedOut === "yes") {
        query = query.or("opted_out.is.null,opted_out.eq.false");
      } else if (filters.optedOut === "no") {
        query = query.eq("opted_out", true);
      }


      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch contacts with pagination and filters
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["crm-contacts", currentWorkspace?.id, filters, currentPage],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];

      const from = (currentPage - 1) * PAGE_SIZE;

      if (filters.search) {
        // Use RPC for accent-insensitive search
        const { data, error } = await supabase.rpc("search_contacts_unaccent", {
          p_workspace_id: currentWorkspace.id,
          p_search: filters.search,
          p_source: filters.source !== "all" ? filters.source : null,
          p_has_conversation: filters.hasConversation !== "all" ? filters.hasConversation : null,
          p_company: filters.company || null,
          p_sort_by: filters.sortBy,
          p_sort_order: filters.sortOrder,
          p_offset: from,
          p_limit: PAGE_SIZE,
          p_deleted_status: filters.deletedStatus,
        });
        if (error) throw error;

        let filteredData = (data || []) as Contact[];
        if (filters.tags.length > 0) {
          filteredData = filteredData.filter((contact) => {
            const contactTags = parseTags(contact.tags);
            return filters.tags.some((filterTag) =>
              contactTags.some((ct) => ct.name.toLowerCase() === filterTag.toLowerCase())
            );
          });
        }
        if (filters.createdFrom || filters.createdTo) {
          filteredData = filteredData.filter((c) =>
            isWithinDateRange(c.created_at ?? null, filters.createdFrom, filters.createdTo),
          );
        }
        if (filters.ddds.length > 0) {
          filteredData = filteredData.filter((contact) => {
            const ddd = extractDDD(contact.phone);
            return ddd !== null && filters.ddds.includes(ddd);
          });
        }
        if (filters.optedOut === "yes") {
          filteredData = filteredData.filter((c) => !c.opted_out);
        } else if (filters.optedOut === "no") {
          filteredData = filteredData.filter((c) => !!c.opted_out);
        }
        return filteredData;
      }

      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("crm_contacts")
        .select("*")
        .eq("workspace_id", currentWorkspace.id);

      if (filters.deletedStatus === "active") {
        query = query.neq("is_active", false);
      } else if (filters.deletedStatus === "deleted") {
        query = query.eq("is_active", false);
      }

      if (filters.source !== "all") {
        query = query.eq("source", filters.source);
      }

      if (filters.hasConversation === "active") {
        query = query.not("lead_id", "is", null);
      } else if (filters.hasConversation === "none") {
        query = query.is("lead_id", null);
      }

      if (filters.company) {
        query = query.eq("company", filters.company);
      }

      if (filters.createdFrom) {
        query = query.gte("created_at", startOfDayBR(filters.createdFrom));
      }
      if (filters.createdTo) {
        query = query.lte("created_at", endOfDayBR(filters.createdTo));
      }

      if (filters.optedOut === "yes") {
        query = query.or("opted_out.is.null,opted_out.eq.false");
      } else if (filters.optedOut === "no") {
        query = query.eq("opted_out", true);
      }


      query = query.order(filters.sortBy, { ascending: filters.sortOrder === "asc" });
      query = query.range(from, to);

      const { data, error } = await query;
      if (error) throw error;

      let filteredData = data as Contact[];
      if (filters.tags.length > 0) {
        filteredData = filteredData.filter((contact) => {
          const contactTags = parseTags(contact.tags);
          return filters.tags.some((filterTag) =>
            contactTags.some((ct) => ct.name.toLowerCase() === filterTag.toLowerCase())
          );
        });
      }

      if (filters.ddds.length > 0) {
        filteredData = filteredData.filter((contact) => {
          const ddd = extractDDD(contact.phone);
          return ddd !== null && filters.ddds.includes(ddd);
        });
      }

      return filteredData;
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch contact IDs that already have a crm_lead (active or soft-deleted)
  const { data: contactPipelineMap = new Map<string, { id: string; deletedAt: string | null }>() } = useQuery({
    queryKey: ["crm-contacts-pipeline-status", currentWorkspace?.id, contacts.map(c => c.id).join(",")],
    queryFn: async () => {
      const map = new Map<string, { id: string; deletedAt: string | null }>();
      if (!currentWorkspace?.id || contacts.length === 0) return map;
      const contactIds = contacts.map(c => c.id);
      const { data, error } = await supabase
        .from("crm_leads")
        .select("contact_id, id, deleted_at, created_at")
        .eq("workspace_id", currentWorkspace.id)
        .in("contact_id", contactIds)
        .order("deleted_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      (data || []).forEach(d => {
        if (d.contact_id && !map.has(d.contact_id)) {
          map.set(d.contact_id, { id: d.id, deletedAt: d.deleted_at });
        }
      });
      return map;
    },
    enabled: !!currentWorkspace?.id && contacts.length > 0,
  });

  // Open existing pipeline card (reactivating if soft-deleted) or create a new one
  const openOrCreatePipelineCard = useMutation({
    mutationFn: async (contact: Contact) => {
      if (!currentWorkspace?.id) throw new Error("Workspace required");

      const { data: existing } = await supabase
        .from("crm_leads")
        .select("id, deleted_at, stage_id")
        .eq("workspace_id", currentWorkspace.id)
        .eq("contact_id", contact.id)
        .order("deleted_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && !existing.deleted_at) {
        return { leadId: existing.id, action: "opened" as const };
      }

      if (existing && existing.deleted_at) {
        const nowIso = new Date().toISOString();
        const { error: upErr } = await supabase
          .from("crm_leads")
          .update({
            deleted_at: null,
            deleted_by: null,
            status: "open",
            updated_at: nowIso,
            moved_at: nowIso,
          })
          .eq("id", existing.id);
        if (upErr) throw upErr;

        await supabase.from("crm_lead_history").insert({
          lead_id: existing.id,
          from_stage_id: existing.stage_id,
          to_stage_id: existing.stage_id,
          moved_by: "manual-reactivation",
          action: "reactivated",
          reason: "Card reativado a partir da lista de contatos",
        });

        return { leadId: existing.id, action: "reactivated" as const };
      }

      const { data: defaultStage } = await supabase
        .from("crm_pipeline_stages")
        .select("id")
        .eq("workspace_id", currentWorkspace.id)
        .order("order", { ascending: true })
        .limit(1)
        .single();

      if (!defaultStage) throw new Error("Nenhum estagio encontrado no pipeline");

      const { data: { user } } = await supabase.auth.getUser();

      const { data: inserted, error } = await supabase
        .from("crm_leads")
        .insert({
          workspace_id: currentWorkspace.id,
          contact_id: contact.id,
          stage_id: defaultStage.id,
          title: contact.company?.trim() || contact.name?.trim() || "Novo Lead",
          status: "open",
          created_by: user?.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { leadId: inserted!.id, action: "created" as const };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["crm-contacts-pipeline-status"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      setCreatingPipelineForContact(null);
      if (result.action === "created") {
        toast({ title: "Card criado no pipeline" });
      } else if (result.action === "reactivated") {
        toast({ title: "Card reativado no pipeline" });
      }
      navigate(`/crm/pipeline?lead=${result.leadId}`);
    },
    onError: (error: any) => {
      console.error("Error opening/creating pipeline card:", error);
      setCreatingPipelineForContact(null);
      toast({
        variant: "destructive",
        title: "Erro ao abrir card no pipeline",
        description: "Tente novamente.",
      });
    },
  });

  // Calculate pagination values
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const filteredContacts = contacts;

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Create/Update contact mutation
  const saveContact = useMutation({
    mutationFn: async () => {
      if (!currentWorkspace?.id) return;

      // Obter usuario atual para preencher created_by
      const { data: { user } } = await supabase.auth.getUser();

      const contactData = {
        workspace_id: currentWorkspace.id,
        name: formData.name,
        phone: formData.phone || null,
        email: formData.email || null,
        company: formData.company || null,
        job_title: formData.job_title || null,
        notes: formData.notes || null,
        employee_count: formData.employee_count || null,
        revenue: formData.revenue || null,
        opted_out: !!formData.opted_out,
        opted_out_at: formData.opted_out
          ? (editingContact?.opted_out ? editingContact?.opted_out_at ?? new Date().toISOString() : new Date().toISOString())
          : null,
      };

      let contactId = editingContact?.id;

      if (editingContact) {
        const { error } = await supabase
          .from("crm_contacts")
          .update(contactData)
          .eq("id", editingContact.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("crm_contacts")
          .insert({
            ...contactData,
            created_by: user?.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        contactId = data.id;
      }

      // Sincronizar valor do negócio com crm_leads
      if (contactId && formData.deal_value) {
        const dealValue = parseFloat(formData.deal_value.replace(/[^\d.,]/g, "").replace(",", "."));
        
        if (!isNaN(dealValue)) {
          // Verificar se existe crm_lead para este contato
          const { data: existingCrmLead } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("contact_id", contactId)
            .is("deleted_at", null)
            .maybeSingle();

          if (existingCrmLead) {
            // Atualizar valor existente
            await supabase
              .from("crm_leads")
              .update({ value: dealValue })
              .eq("id", existingCrmLead.id);
          } else {
            // Check if CRM lead already exists for this contact by workspace + contact_id (prevent duplicates)
            const { data: duplicateCheck } = await supabase
              .from("crm_leads")
              .select("id")
              .eq("workspace_id", currentWorkspace.id)
              .eq("contact_id", contactId)
              .is("deleted_at", null)
              .maybeSingle();

            if (duplicateCheck) {
              // Lead already exists, just update the value
              await supabase
                .from("crm_leads")
                .update({ value: dealValue })
                .eq("id", duplicateCheck.id);
            } else {
              // Criar novo crm_lead com o valor
              // Primeiro, buscar o stage default
              const { data: defaultStage } = await supabase
                .from("crm_pipeline_stages")
                .select("id")
                .eq("workspace_id", currentWorkspace.id)
                .eq("is_default", true)
                .maybeSingle();

              if (defaultStage) {
                await supabase
                  .from("crm_leads")
                  .insert({
                    workspace_id: currentWorkspace.id,
                    contact_id: contactId,
                    stage_id: defaultStage.id,
                    value: dealValue,
                    title: formData.company?.trim() || formData.name?.trim() || null,
                  });
              }
            }
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      queryClient.invalidateQueries({ queryKey: ["crm-contacts-companies"] });
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-lead-detail"] });
      setIsDialogOpen(false);
      setEditingContact(null);
      setFormData(emptyContact);
      toast({ title: "Contato atualizado" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Erro ao salvar contato",
        description: "Verifique os dados e tente novamente.",
      });
    },
  });

  // Delete contact mutation (também exclui o lead associado)
  const removeContact = useMutation({
    mutationFn: async (id: string) => {
      // 1. Buscar o contato para pegar o lead_id
      const { data: contact } = await supabase
        .from("crm_contacts")
        .select("lead_id")
        .eq("id", id)
        .single();
      
      const leadId = contact?.lead_id;
      
      // 2. PRIMEIRO: Deletar o lead (FK agora é ON DELETE SET NULL)
      if (leadId) {
        const { error: deleteLeadError } = await supabase
          .from("leads")
          .delete()
          .eq("id", leadId);
        
        if (deleteLeadError) {
          console.error("Erro ao deletar lead:", deleteLeadError);
        }
      }
      
      // 3. DEPOIS: Deletar o contato
      const { error: deleteContactError, count } = await supabase
        .from("crm_contacts")
        .delete({ count: "exact" })
        .eq("id", id);
      if (deleteContactError) throw deleteContactError;
      if (count === 0) throw new Error("Não foi possível excluir o contato. Verifique suas permissões.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts-companies"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      setDeleteContact(null);
      toast({ title: "Contato e conversa excluidos" });
    },
    onError: (error: unknown) => {
      console.error("Delete error:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Erro inesperado ao excluir o contato.",
      });
    },
  });

  // Bulk delete mutation (também exclui os leads associados)
  const bulkDeleteContacts = useMutation({
    mutationFn: async (ids: string[]) => {
      // 1. Buscar os lead_ids dos contatos
      const { data: contactsData } = await supabase
        .from("crm_contacts")
        .select("id, lead_id")
        .in("id", ids);

      const leadIds = contactsData?.map(c => c.lead_id).filter(Boolean) || [];

      // 2. PRIMEIRO: Deletar os leads (FK agora é ON DELETE SET NULL)
      if (leadIds.length > 0) {
        const { error: deleteLeadsError } = await supabase
          .from("leads")
          .delete()
          .in("id", leadIds);

        if (deleteLeadsError) {
          console.error("Erro ao deletar leads:", deleteLeadsError);
        }
      }

      // 3. DEPOIS: Deletar os contatos
      const { error: deleteContactsError, count } = await supabase
        .from("crm_contacts")
        .delete({ count: "exact" })
        .in("id", ids);
      if (deleteContactsError) throw deleteContactsError;
      if (count === 0) throw new Error("Não foi possível excluir os contatos. Verifique suas permissões.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts-count"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-contacts-companies"] });
      await queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      setSelectedIds(new Set());
      setShowBulkDeleteDialog(false);
      toast({ title: `${selectedIds.size} contato(s) e conversa(s) excluido(s)` });
    },
    onError: (error: any) => {
      console.error("Bulk delete error:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir contatos",
        description: "Alguns contatos podem nao ter sido excluidos.",
      });
    },
  });

  const openEditDialog = async (contact: Contact) => {
    setEditingContact(contact);
    
    // Buscar valor do deal se existir crm_lead associado
    let dealValue = "";
    if (currentWorkspace?.id) {
      const { data: crmLead } = await supabase
        .from("crm_leads")
        .select("value")
        .eq("contact_id", contact.id)
        .is("deleted_at", null)
        .maybeSingle();
      
      if (crmLead?.value) {
        dealValue = crmLead.value.toString();
      }
    }
    
    setFormData({
      name: contact.name,
      phone: contact.phone || "",
      email: contact.email || "",
      company: contact.company || "",
      job_title: contact.job_title || "",
      notes: contact.notes || "",
      employee_count: (contact as any).employee_count || "",
      revenue: (contact as any).revenue || "",
      deal_value: dealValue,
      opted_out: !!(contact as any).opted_out,
    });
    setIsDialogOpen(true);
  };


  // Função para abrir ou criar conversa
  const handleOpenConversation = async (contact: Contact) => {
    if (!currentWorkspace?.id || !contact.phone) {
      toast({
        variant: "destructive",
        title: "Telefone obrigatorio",
        description: "O contato precisa ter um telefone para iniciar uma conversa.",
      });
      return;
    }

    // Se já tem lead_id, redireciona direto para o Inbox
    if (contact.lead_id) {
      navigate(`/?lead=${contact.lead_id}`);
      return;
    }

    // Caso contrário, cria um novo lead
    setCreatingLeadForContact(contact.id);
    try {
      // Primeiro verifica se existe um lead com este telefone
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("workspace_id", currentWorkspace.id)
        .eq("phone", contact.phone)
        .maybeSingle();

      if (existingLead) {
        // Se existe, atualiza o contato com o lead_id e redireciona
        await supabase
          .from("crm_contacts")
          .update({ lead_id: existingLead.id })
          .eq("id", contact.id);
        
        queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
        navigate(`/?lead=${existingLead.id}`);
        return;
      }

      // Cria novo lead
      const { data: newLead, error } = await supabase
        .from("leads")
        .insert({
          workspace_id: currentWorkspace.id,
          phone: contact.phone,
          name: contact.name,
          status: "new",
        })
        .select("id")
        .single();

      if (error) throw error;

      console.log("[CRMContacts] handleOpenConversation - new lead created:", {
        leadId: newLead.id,
        contactId: contact.id,
        contactPhone: contact.phone,
        workspaceId: currentWorkspace.id,
      });

      // Criar zapi_conversations para permitir envio outbound via Z-API
      // Usar connection_workspaces (fonte de verdade) ao inves de zapi_connections.workspace_id (legado)
      const { data: connLink } = await supabase
        .from("connection_workspaces")
        .select("connection_id")
        .eq("workspace_id", currentWorkspace.id)
        .eq("connection_type", "zapi")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const zapiConnection = connLink ? { id: connLink.connection_id } : null;

      if (zapiConnection && contact.phone) {
        const { error: zapiConvError } = await supabase
          .from("zapi_conversations")
          .insert({
            workspace_id: currentWorkspace.id,
            connection_id: zapiConnection.id,
            lead_id: newLead.id,
            phone_number: normalizePhone(contact.phone) || contact.phone.replace(/\D/g, ""),
            contact_name: contact.name || null,
            last_message_at: new Date().toISOString(),
            is_active: true,
          });

        if (zapiConvError) {
          console.error("[CRMContacts] Error creating zapi_conversations:", zapiConvError);
        } else {
          console.log("[CRMContacts] zapi_conversations created for outbound messaging");
        }
      }

      // Atualiza o contato com o lead_id (trigger já deve fazer isso, mas garante)
      await supabase
        .from("crm_contacts")
        .update({ lead_id: newLead.id })
        .eq("id", contact.id);

      queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      toast({ title: "Conversa criada com sucesso" });
      navigate(`/?lead=${newLead.id}`);
    } catch (error) {
      console.error("Error creating lead:", error);
      toast({
        variant: "destructive",
        title: "Erro ao criar conversa",
        description: "Tente novamente mais tarde.",
      });
    } finally {
      setCreatingLeadForContact(null);
    }
  };

  const isAllSelected = filteredContacts.length > 0 && selectedIds.size === filteredContacts.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredContacts.length;

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Contatos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seus contatos do CRM
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Para cadastrar novos contatos,{" "}
            <Button 
              variant="link" 
              className="h-auto p-0 text-xs text-primary" 
              onClick={() => navigate("/crm/pipeline")}
            >
              acesse o Pipeline
            </Button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsImportOpen(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Importar
          </Button>

          {canExport && (
            <Button
              variant="outline"
              onClick={() => setIsExportOpen(true)}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          )}

          {canExport && (
            <Button
              variant="outline"
              onClick={handleMergeDuplicates}
              disabled={isMerging}
              className="gap-2"
            >
              {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
              Corrigir Duplicados
            </Button>
          )}

          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setShowBulkDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Excluir ({selectedIds.size})
            </Button>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="glass-card border-border">
              <DialogHeader>
                <DialogTitle>Editar Contato</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Nome *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Nome completo"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Telefone</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      placeholder="email@exemplo.com"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Empresa</Label>
                    <Input
                      value={formData.company}
                      onChange={(e) =>
                        setFormData({ ...formData, company: e.target.value })
                      }
                      placeholder="Nome da empresa"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cargo</Label>
                    <Input
                      value={formData.job_title}
                      onChange={(e) =>
                        setFormData({ ...formData, job_title: e.target.value })
                      }
                      placeholder="Cargo ou funcao"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tamanho da Empresa</Label>
                    <Select
                      value={formData.employee_count}
                      onValueChange={(value) =>
                        setFormData({ ...formData, employee_count: value })
                      }
                    >
                      <SelectTrigger className="bg-card">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="Eu S.A.">Eu S.A.</SelectItem>
                        <SelectItem value="1-10 funcionarios">1-10 funcionarios</SelectItem>
                        <SelectItem value="11-50 funcionarios">11-50 funcionarios</SelectItem>
                        <SelectItem value="51-200 funcionarios">51-200 funcionarios</SelectItem>
                        <SelectItem value="+200 funcionarios">+200 funcionarios</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Faturamento</Label>
                    <Select
                      value={formData.revenue}
                      onValueChange={(value) =>
                        setFormData({ ...formData, revenue: value })
                      }
                    >
                      <SelectTrigger className="bg-card">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border z-50">
                        <SelectItem value="Ate 100k/mes">Ate 100k/mes</SelectItem>
                        <SelectItem value="Entre 100k e 500k/mes">Entre 100k e 500k/mes</SelectItem>
                        <SelectItem value="Entre 500k e 1MM/mes">Entre 500k e 1MM/mes</SelectItem>
                        <SelectItem value="Entre 1MM e 3MM/mes">Entre 1MM e 3MM/mes</SelectItem>
                        <SelectItem value="Entre 3MM e 5MM/mes">Entre 3MM e 5MM/mes</SelectItem>
                        <SelectItem value="Acima de 5MM/mes">Acima de 5MM/mes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Valor do Negocio (R$)</Label>
                  <Input
                    type="text"
                    value={formData.deal_value}
                    onChange={(e) =>
                      setFormData({ ...formData, deal_value: e.target.value })
                    }
                    placeholder="Ex: 10000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Observacoes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    placeholder="Notas sobre o contato..."
                    rows={3}
                  />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-3">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2 text-foreground font-semibold">
                      <BellOff className="h-4 w-4 text-destructive" />
                      Nao deseja mais receber contato
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Ativar suprime envios automaticos e mensagens deste contato.
                    </p>
                  </div>
                  <Switch
                    checked={!!formData.opted_out}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, opted_out: checked })
                    }
                    className="data-[state=unchecked]:bg-muted-foreground/40 data-[state=checked]:bg-destructive"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => saveContact.mutate()}
                    disabled={!formData.name || saveContact.isPending}
                  >
                    {editingContact ? "Salvar" : "Criar"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <ContactsFilter
          workspaceId={currentWorkspace?.id}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          companies={allCompanies}
          availableDdds={availableDdds}
        />
      </div>

      {/* Table */}
      <div className="glass-card flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Selecionar todos"
                  className={isSomeSelected ? "opacity-50" : ""}
                />
              </TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="w-[120px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  {isLoading ? (
                    <div className="py-14 text-center text-sm text-muted-foreground">Carregando...</div>
                  ) : filters.search || filters.source !== "all" || filters.hasConversation !== "all" || filters.tags.length > 0 || filters.company || filters.ddds.length > 0 || filters.createdFrom || filters.createdTo ? (
                    <EmptyState
                      icon={SearchX}
                      title="Nenhum contato encontrado"
                      description="Nenhum contato corresponde aos filtros aplicados. Ajuste ou limpe os filtros para ver mais resultados."
                    />
                  ) : (
                    <EmptyState
                      icon={Users}
                      title="Nenhum contato cadastrado"
                      description="Os contatos aparecem aqui conforme entram pelo WhatsApp ou pelo Pipeline. Você também pode importar uma lista."
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredContacts.map((contact) => (
                <TableRow key={contact.id} className="border-border">
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={`Selecionar ${contact.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p
                            className="font-medium text-foreground cursor-pointer hover:text-primary transition-colors"
                            onClick={() => navigate(`/crm/contacts/${contact.id}`)}
                          >
                            {contact.name}
                          </p>
                          {(contact as any).opted_out && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-destructive/10 text-destructive border border-destructive/30">
                                    <BellOff className="h-3 w-3" />
                                    Sem contato
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Este contato pediu para nao receber mais interacoes</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        {contact.job_title && (
                          <p className="text-xs text-muted-foreground">
                            {contact.job_title}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {contact.phone && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {formatPhoneForDisplay(contact.phone)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.email && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.company && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {contact.company}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <ContactTagList
                      tags={parseTags(contact.tags)}
                      maxVisible={2}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {contact.source === 'whatsapp' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-success/10 text-success">
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                          <User className="h-3 w-3" />
                          Manual
                        </span>
                      )}
                      {contact.lead_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
                          Chat ativo
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <TooltipProvider>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-primary hover:text-primary"
                              onClick={() => handleOpenConversation(contact)}
                              disabled={!contact.phone || creatingLeadForContact === contact.id}
                            >
                              {creatingLeadForContact === contact.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MessageCircle className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {contact.lead_id ? "Abrir conversa" : "Iniciar conversa"}
                          </TooltipContent>
                        </Tooltip>
                        {(() => {
                          const entry = contactPipelineMap.get(contact.id);
                          const hasActive = !!entry && !entry.deletedAt;
                          if (hasActive) {
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => navigate(`/crm/pipeline?lead=${entry!.id}`)}
                                  >
                                    <LayoutGrid className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ver no pipeline</TooltipContent>
                              </Tooltip>
                            );
                          }
                          const tooltipLabel = entry?.deletedAt
                            ? "Reativar card no pipeline"
                            : "Criar card no pipeline";
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-success hover:text-success"
                                  onClick={() => {
                                    setCreatingPipelineForContact(contact.id);
                                    openOrCreatePipelineCard.mutate(contact);
                                  }}
                                  disabled={creatingPipelineForContact === contact.id}
                                >
                                  {creatingPipelineForContact === contact.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <LayoutGrid className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{tooltipLabel}</TooltipContent>
                            </Tooltip>
                          );
                        })()}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(contact)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Editar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteContact(contact)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalCount > 0 && (
          <ContactsPagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteContact} onOpenChange={() => setDeleteContact(null)}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteContact?.name}"? Esta acao
              nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteContact && removeContact.mutate(deleteContact.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent className="glass-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} contato(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir os contatos selecionados? Esta acao
              nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => bulkDeleteContacts.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteContacts.isPending}
            >
              {bulkDeleteContacts.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Excluir {selectedIds.size} contato(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export contacts modal */}
      <ExportContactsDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        workspaceId={currentWorkspace?.id}
        hasActiveFilters={hasActiveFilters}
        filters={filters}
      />

      {/* Import contacts modal */}
      <ImportContactsDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        workspaceId={currentWorkspace?.id}
      />

      {/* Contact detail modal */}
      <ContactDetailModal
        contactId={contactId}
        open={!!contactId}
        onOpenChange={(open) => {
          if (!open) navigate("/crm/contacts");
        }}
      />
    </div>
  );
}
