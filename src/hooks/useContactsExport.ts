import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { parseTags } from "@/types/tags";
import { formatPhoneForDisplay, extractDDD } from "@/lib/phone";
import type { ContactFilters } from "@/components/crm/ContactsFilter";

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  position: string | null;
  employee_count: string | null;
  revenue: string | null;
  notes: string | null;
  tags: unknown;
  source: string | null;
  created_at: string | null;
}

/**
 * Escapes a CSV field value to handle special characters
 */
function escapeCSVField(value: string): string {
  if (!value) return "";
  // If the value contains semicolon, newline, or quotes, wrap in quotes and escape existing quotes
  if (value.includes(";") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generates CSV content from contacts array
 */
function generateCSV(contacts: Contact[]): string {
  const BOM = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const headers = [
    "nome",
    "telefone",
    "email",
    "empresa",
    "cargo",
    "posicao",
    "tamanho_empresa",
    "faturamento",
    "observacoes",
    "tags",
    "origem",
    "data_criacao",
  ];

  const rows = contacts.map((contact) => {
    const tags = parseTags(contact.tags)
      .map((t) => t.name)
      .join(",");
    const createdAt = contact.created_at
      ? new Date(contact.created_at).toLocaleDateString("pt-BR")
      : "";

    return [
      contact.name,
      formatPhoneForDisplay(contact.phone),
      contact.email || "",
      contact.company || "",
      contact.job_title || "",
      contact.position || "",
      contact.employee_count || "",
      contact.revenue || "",
      contact.notes || "",
      tags,
      contact.source || "",
      createdAt,
    ]
      .map(escapeCSVField)
      .join(";");
  });

  return BOM + [headers.join(";"), ...rows].join("\n");
}

/**
 * Triggers download of a CSV file
 */
function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useContactsExport(workspaceId: string | undefined) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const exportContacts = async (options: {
    filters?: ContactFilters;
    exportAll?: boolean;
  }) => {
    if (!workspaceId) {
      toast({
        title: "Erro",
        description: "Workspace não encontrado",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    try {
      let query = supabase
        .from("crm_contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .neq("is_active", false);

      // Apply filters only if not exporting all
      if (!options.exportAll && options.filters) {
        const filters = options.filters;

        if (filters.search) {
          query = query.or(
            `name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,company.ilike.%${filters.search}%`
          );
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

        // Apply sorting
        query = query.order(filters.sortBy, {
          ascending: filters.sortOrder === "asc",
        });
      } else {
        // Default sorting by name
        query = query.order("name", { ascending: true });
      }

      const { data, error } = await query;

      if (error) throw error;

      let contacts = data as Contact[];

      // Filter by tags client-side if needed
      if (!options.exportAll && options.filters?.tags?.length) {
        const filterTags = options.filters.tags;
        contacts = contacts.filter((contact) => {
          const contactTags = parseTags(contact.tags);
          return filterTags.some((filterTag) =>
            contactTags.some(
              (ct) => ct.name.toLowerCase() === filterTag.toLowerCase()
            )
          );
        });
      }

      // Filter by DDDs client-side if needed
      if (!options.exportAll && options.filters?.ddds?.length) {
        const filterDdds = options.filters.ddds;
        contacts = contacts.filter((contact) => {
          const ddd = extractDDD(contact.phone);
          return ddd !== null && filterDdds.includes(ddd);
        });
      }

      if (contacts.length === 0) {
        toast({
          title: "Nenhum contato encontrado",
          description: "Não há contatos para exportar com os filtros aplicados",
        });
        return;
      }

      const csv = generateCSV(contacts);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `contatos_${timestamp}.csv`;

      downloadCSV(csv, filename);

      toast({
        title: "Exportação concluída",
        description: `${contacts.length} contato(s) exportado(s) com sucesso`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Erro na exportação",
        description: "Não foi possível exportar os contatos",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return { exportContacts, isExporting };
}
