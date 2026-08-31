import { useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseTags } from "@/types/tags";

interface ExportLead {
  id: string;
  title: string | null;
  description?: string | null;
  value: number;
  stage_id: string;
  status: string | null;
  product_id: string | null;
  assigned_to: string | null;
  segment_id?: string | null;
  created_at: string | null;
  moved_at?: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  contact?: {
    name?: string;
    phone?: string;
    email?: string | null;
    company?: string | null;
    tags?: unknown;
    source?: string | null;
    position?: string | null;
    job_title?: string | null;
    employee_count?: string | null;
    revenue?: string | null;
    scheduling_blocked?: boolean | null;
    opted_out?: boolean | null;
    opted_out_at?: string | null;
  } | null;
  psychology?: {
    temperatura?: string | null;
    propensity_score?: number | null;
    risk_score?: number | null;
    opportunity_score?: number | null;
  } | null;
}

interface ExportStage {
  id: string;
  name: string;
}
interface ExportProduct {
  id: string;
  name: string;
}
interface ExportMember {
  user_id: string;
  profile?: { name?: string | null; email?: string | null } | null;
}

interface ExportArgs {
  leads: ExportLead[];
  stages: ExportStage[];
  products: ExportProduct[];
  members: ExportMember[];
  workspaceName?: string;
  workspaceId?: string;
}

type CatalogKind = "pains" | "objections";

// Supabase quebra o .in() acima de ~1000 valores; 200 por lote e o padrao do projeto.
const LINK_CHUNK = 200;

const TEMPERATURE_LABELS: Record<string, string> = {
  muito_quente: "Muito Quente",
  quente: "Quente",
  morno: "Morno",
  frio: "Frio",
};

const escape = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const formatBRDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
};

const formatPhoneDisplay = (phone?: string | null): string => {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  // Strip leading 55 if present and length matches Brazilian
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
};

const formatBool = (val?: boolean | null): string => (val ? "Sim" : "Não");

const formatScore = (val?: number | null): string =>
  typeof val === "number" ? String(val) : "";

// Marcas de acentuacao (U+0300-U+036F) e BOM sao montados por code point para nao
// deixar caracteres invisiveis no fonte.
const DIACRITICS_RE = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);
const UTF8_BOM = String.fromCharCode(0xfeff);

const slugify = (str: string): string =>
  str
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "workspace";

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function fetchSegmentNames(workspaceId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("crm_segments")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/**
 * Resolve os vinculos de dores/objecoes de cada lead para uma string "A, B, C".
 * O catalogo nao e filtrado por is_active de proposito: um item desativado depois
 * de vinculado continua visivel no card, entao continua visivel no CSV.
 */
async function fetchLinkedNames(
  kind: CatalogKind,
  workspaceId: string,
  leadIds: string[]
): Promise<Map<string, string>> {
  const catalogRes =
    kind === "pains"
      ? await supabase.from("crm_pains").select("id, name").eq("workspace_id", workspaceId)
      : await supabase.from("crm_objections").select("id, name").eq("workspace_id", workspaceId);
  if (catalogRes.error) throw catalogRes.error;
  const nameById = new Map((catalogRes.data ?? []).map((row) => [row.id, row.name]));

  const byLead = new Map<string, string[]>();
  for (const ids of chunk(leadIds, LINK_CHUNK)) {
    const linkRes =
      kind === "pains"
        ? await supabase.from("crm_lead_pains").select("lead_id, pain_id").in("lead_id", ids)
        : await supabase
            .from("crm_lead_objections")
            .select("lead_id, objection_id")
            .in("lead_id", ids);
    if (linkRes.error) throw linkRes.error;

    for (const row of (linkRes.data ?? []) as Array<Record<string, string | null>>) {
      const leadId = row.lead_id;
      const catalogId = kind === "pains" ? row.pain_id : row.objection_id;
      if (!leadId || !catalogId) continue;
      const name = nameById.get(catalogId);
      if (!name) continue;
      const list = byLead.get(leadId);
      if (list) list.push(name);
      else byLead.set(leadId, [name]);
    }
  }

  return new Map(
    [...byLead].map(([leadId, names]) => [
      leadId,
      names.sort((a, b) => a.localeCompare(b, "pt-BR")).join(", "),
    ])
  );
}

interface LeadAttributes {
  showSegments: boolean;
  showPains: boolean;
  showObjections: boolean;
  segmentNames: Map<string, string>;
  painsByLead: Map<string, string>;
  objectionsByLead: Map<string, string>;
}

const EMPTY_ATTRIBUTES: LeadAttributes = {
  showSegments: false,
  showPains: false,
  showObjections: false,
  segmentNames: new Map(),
  painsByLead: new Map(),
  objectionsByLead: new Map(),
};

/**
 * Le a visibilidade das secoes de atributos e carrega apenas as que estao ativas.
 * Ausencia de registro em crm_lead_attribute_sections = secao ativa (mesma regra
 * de useLeadAttributeSections).
 */
async function fetchLeadAttributes(
  workspaceId: string,
  leadIds: string[]
): Promise<LeadAttributes> {
  const { data, error } = await supabase
    .from("crm_lead_attribute_sections")
    .select("section_key, is_active")
    .eq("workspace_id", workspaceId);
  if (error) throw error;

  const sectionMap = new Map((data ?? []).map((row) => [row.section_key, row.is_active]));
  const isActive = (key: string) => sectionMap.get(key) ?? true;

  const showSegments = isActive("segments");
  const showPains = isActive("pains");
  const showObjections = isActive("objections");

  const [segmentNames, painsByLead, objectionsByLead] = await Promise.all([
    showSegments ? fetchSegmentNames(workspaceId) : Promise.resolve(new Map<string, string>()),
    showPains
      ? fetchLinkedNames("pains", workspaceId, leadIds)
      : Promise.resolve(new Map<string, string>()),
    showObjections
      ? fetchLinkedNames("objections", workspaceId, leadIds)
      : Promise.resolve(new Map<string, string>()),
  ]);

  return { showSegments, showPains, showObjections, segmentNames, painsByLead, objectionsByLead };
}

export function usePipelineExport() {
  const exportToCsv = useCallback(
    async ({ leads, stages, products, members, workspaceName, workspaceId }: ExportArgs) => {
      if (!leads || leads.length === 0) {
        toast.info("Nenhum card visível para exportar.");
        return;
      }

      const toastId = toast.loading("Gerando CSV...");

      let attributes = EMPTY_ATTRIBUTES;
      if (workspaceId) {
        try {
          attributes = await fetchLeadAttributes(
            workspaceId,
            leads.map((lead) => lead.id)
          );
        } catch (error) {
          console.error("[usePipelineExport] falha ao carregar atributos do lead:", error);
          toast.warning("Segmento, dores e objeções não puderam ser carregados.");
        }
      }

      const stageById = new Map(stages.map((s) => [s.id, s.name]));
      const productById = new Map(products.map((p) => [p.id, p.name]));
      const memberById = new Map(
        members.map((m) => [m.user_id, m.profile?.name || m.profile?.email || ""])
      );

      const headers = [
        "Etapa",
        "Status",
        "Titulo do lead",
        "Descricao",
        "Contato",
        "Empresa",
        "Cargo",
        "Funcionarios",
        "Faturamento",
        "E-mail",
        "Telefone",
        "Origem do contato",
        "Tags",
        ...(attributes.showSegments ? ["Segmento"] : []),
        ...(attributes.showPains ? ["Dores"] : []),
        ...(attributes.showObjections ? ["Objecoes"] : []),
        "Atendente",
        "Produto",
        "UTM Source",
        "UTM Medium",
        "UTM Campaign",
        "UTM Term",
        "UTM Content",
        "Valor (R$)",
        "Temperatura",
        "Propensao (%)",
        "Risco (%)",
        "Oportunidade (%)",
        "Bloqueia agendamentos",
        "Nao deseja receber contato",
        "Opt-out em",
        "Criado em",
        "Ultima atualizacao",
      ];

      const rows = leads.map((lead) => {
        const tagsArr = parseTags(lead.contact?.tags).map((t) => t.name);
        const temperatura = lead.psychology?.temperatura;
        return [
          stageById.get(lead.stage_id) || "",
          lead.status || "",
          lead.title || lead.contact?.name || "",
          lead.description || "",
          lead.contact?.name || "",
          lead.contact?.company || "",
          lead.contact?.job_title || lead.contact?.position || "",
          lead.contact?.employee_count || "",
          lead.contact?.revenue || "",
          lead.contact?.email || "",
          formatPhoneDisplay(lead.contact?.phone),
          lead.contact?.source || "",
          tagsArr.join(", "),
          ...(attributes.showSegments
            ? [(lead.segment_id && attributes.segmentNames.get(lead.segment_id)) || ""]
            : []),
          ...(attributes.showPains ? [attributes.painsByLead.get(lead.id) || ""] : []),
          ...(attributes.showObjections ? [attributes.objectionsByLead.get(lead.id) || ""] : []),
          lead.assigned_to ? memberById.get(lead.assigned_to) || "" : "",
          lead.product_id ? productById.get(lead.product_id) || "" : "",
          lead.utm_source || "",
          lead.utm_medium || "",
          lead.utm_campaign || "",
          lead.utm_term || "",
          lead.utm_content || "",
          typeof lead.value === "number"
            ? lead.value.toFixed(2).replace(".", ",")
            : "",
          temperatura ? TEMPERATURE_LABELS[temperatura] || temperatura : "",
          formatScore(lead.psychology?.propensity_score),
          formatScore(lead.psychology?.risk_score),
          formatScore(lead.psychology?.opportunity_score),
          formatBool(lead.contact?.scheduling_blocked),
          formatBool(lead.contact?.opted_out),
          formatBRDateTime(lead.contact?.opted_out_at),
          formatBRDateTime(lead.created_at),
          formatBRDateTime(lead.moved_at || lead.created_at),
        ];
      });

      const csv =
        UTF8_BOM +
        [headers, ...rows]
          .map((row) => row.map(escape).join(";"))
          .join("\r\n");

      const today = new Date().toISOString().slice(0, 10);
      const wsSlug = slugify(workspaceName || "workspace");
      const filename = `pipeline_${wsSlug}_${today}.csv`;

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`${leads.length} card(s) exportados para CSV.`, { id: toastId });
    },
    []
  );

  return { exportToCsv };
}
