import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, HeartCrack } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MultiCatalogSelect, CatalogOption } from "./MultiCatalogSelect";
import { useLeadAttributeSections } from "@/hooks/useLeadAttributeSections";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


// Untyped client: the table names are dynamic (union of two tables), which
// makes the generated Supabase types blow up during inference.
type LooseQuery = {
  select: (cols: string) => LooseQuery;
  insert: (values: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
  delete: () => LooseQuery;
  eq: (col: string, value: unknown) => LooseQuery;
  in: (col: string, values: unknown[]) => LooseQuery;
  order: (col: string, opts: { ascending: boolean }) => LooseQuery;
  then: <T>(cb: (res: { data: Array<Record<string, string>> | null; error: { message: string } | null }) => T) => Promise<T>;
};
const db = supabase as unknown as { from: (table: string) => LooseQuery };

interface LeadPainsObjectionsSectionProps {
  leadId: string;
  workspaceId: string | undefined;
}

type Kind = "pains" | "objections";

const CONFIG = {
  pains: {
    catalogTable: "crm_pains" as const,
    linkTable: "crm_lead_pains" as const,
    fk: "pain_id" as const,
    label: "Dores",
    placeholder: "Selecione as dores...",
    help: "Registre as dores identificadas neste lead.",
    empty: "Nenhuma dor cadastrada em Configurações da empresa.",
  },
  objections: {
    catalogTable: "crm_objections" as const,
    linkTable: "crm_lead_objections" as const,
    fk: "objection_id" as const,
    label: "Objeções",
    placeholder: "Selecione as objeções...",
    help: "Registre as objeções levantadas por este lead.",
    empty: "Nenhuma objeção cadastrada em Configurações da empresa.",
  },
};

function useCatalogSection(kind: Kind, leadId: string, workspaceId: string | undefined) {
  const cfg = CONFIG[kind];
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const catalogQuery = useQuery({
    queryKey: [`lead-catalog-${kind}`, workspaceId],
    queryFn: async (): Promise<CatalogOption[]> => {
      if (!workspaceId) return [];
      const { data, error } = await db
        .from(cfg.catalogTable)
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CatalogOption[];
    },
    enabled: !!workspaceId,
  });

  const linksQuery = useQuery({
    queryKey: [`lead-links-${kind}`, leadId],
    queryFn: async (): Promise<CatalogOption[]> => {
      const linkRes = await db
        .from(cfg.linkTable)
        .select(cfg.fk)
        .eq("lead_id", leadId);
      if (linkRes.error) throw linkRes.error;
      const ids = (linkRes.data ?? []).map((row) => row[cfg.fk]).filter(Boolean);
      if (ids.length === 0) return [];
      const catRes = await db
        .from(cfg.catalogTable)
        .select("id, name")
        .in("id", ids);
      if (catRes.error) throw catRes.error;
      return ((catRes.data ?? []) as unknown as CatalogOption[]).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!leadId,
  });

  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "add" | "remove" }) => {
      if (action === "add") {
        const { data: userData } = await supabase.auth.getUser();
        const { error } = await db.from(cfg.linkTable).insert({
          lead_id: leadId,
          [cfg.fk]: id,
          created_by: userData.user?.id ?? null,
        });
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await db
          .from(cfg.linkTable)
          .delete()
          .eq("lead_id", leadId)
          .eq(cfg.fk, id);
        if (error) throw error;
      }
    },
    onMutate: async ({ id, action }) => {
      const key = [`lead-links-${kind}`, leadId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CatalogOption[]>(key) ?? [];
      const option = catalogQuery.data?.find((o) => o.id === id);
      const next =
        action === "add"
          ? option
            ? [...previous, option].sort((a, b) => a.name.localeCompare(b.name))
            : previous
          : previous.filter((o) => o.id !== id);
      queryClient.setQueryData(key, next);
      return { previous, key };
    },
    onError: (error: Error, _vars, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`lead-links-${kind}`, leadId] });
    },
  });

  const selected = linksQuery.data ?? [];
  const selectedIds = new Set(selected.map((s) => s.id));

  return {
    cfg,
    options: catalogQuery.data ?? [],
    selected,
    isLoading: catalogQuery.isLoading || linksQuery.isLoading,
    toggle: (id: string) =>
      mutation.mutate({ id, action: selectedIds.has(id) ? "remove" : "add" }),
    remove: (id: string) => mutation.mutate({ id, action: "remove" }),
  };
}

const NO_SEGMENT = "__none__";

function LeadSegmentBlock({ leadId, workspaceId }: LeadPainsObjectionsSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const optionsQuery = useQuery({
    queryKey: ["lead-catalog-segments", workspaceId],
    queryFn: async (): Promise<CatalogOption[]> => {
      if (!workspaceId) return [];
      const { data, error } = await db
        .from("crm_segments")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CatalogOption[];
    },
    enabled: !!workspaceId,
  });

  const currentQuery = useQuery({
    queryKey: ["lead-segment", leadId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await db.from("crm_leads").select("segment_id").eq("id", leadId);
      if (error) throw error;
      const row = (data ?? [])[0] as unknown as { segment_id: string | null } | undefined;
      return row?.segment_id ?? null;
    },
    enabled: !!leadId,
  });

  const mutation = useMutation({
    mutationFn: async (segmentId: string | null) => {
      const { error } = await supabase
        .from("crm_leads")
        .update({ segment_id: segmentId })
        .eq("id", leadId);
      if (error) throw error;
    },
    onMutate: async (segmentId) => {
      const key = ["lead-segment", leadId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string | null>(key) ?? null;
      queryClient.setQueryData(key, segmentId);
      return { previous, key };
    },
    onError: (error: Error, _v, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      toast({ title: "Erro ao salvar segmento", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-segment", leadId] });
    },
  });

  const options = optionsQuery.data ?? [];
  const value = currentQuery.data ?? null;

  return (
    <div className="bg-background/50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Segmento</span>
      </div>
      <Select
        value={value ?? NO_SEGMENT}
        onValueChange={(v) => mutation.mutate(v === NO_SEGMENT ? null : v)}
        disabled={optionsQuery.isLoading || currentQuery.isLoading}
      >
        <SelectTrigger className="bg-background/60">
          <SelectValue placeholder="Selecione o segmento..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SEGMENT}>Nenhum</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground mt-1.5">
        {options.length === 0
          ? "Nenhum segmento cadastrado em Configurações da empresa."
          : "Defina o segmento de mercado deste lead."}
      </p>
    </div>
  );
}

export function LeadPainsObjectionsSection({
  leadId,
  workspaceId,
}: LeadPainsObjectionsSectionProps) {
  const pains = useCatalogSection("pains", leadId, workspaceId);
  const objections = useCatalogSection("objections", leadId, workspaceId);
  const visibility = useLeadAttributeSections(workspaceId);

  const sections = [
    { key: "pains" as const, icon: HeartCrack, data: pains },
    { key: "objections" as const, icon: AlertTriangle, data: objections },
  ].filter((s) => visibility.isActive(s.key));

  return (
    <>
      {visibility.isActive("segments") && (
        <LeadSegmentBlock leadId={leadId} workspaceId={workspaceId} />
      )}
      {sections.map(({ key, icon: Icon, data }) => (
        <div key={key} className="bg-background/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{data.cfg.label}</span>
          </div>
          <MultiCatalogSelect
            options={data.options}
            selected={data.selected}
            onToggle={data.toggle}
            onRemove={data.remove}
            placeholder={data.cfg.placeholder}
            emptyMessage={data.cfg.empty}
            disabled={data.isLoading}
          />
          <p className="text-xs text-muted-foreground mt-1.5">{data.cfg.help}</p>
        </div>
      ))}
    </>
  );

}
