import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAssignableMembers } from "@/hooks/useAssignableMembers";
import { useWorkspaceTags } from "@/hooks/useWorkspaceTags";
import { JOB_TITLE_OPTIONS, REVENUE_OPTIONS, EMPLOYEE_OPTIONS } from "@/lib/widgetVocabulary";
import { ACTIVITY_TYPE_OPTIONS, ACTIVITY_STATUS_OPTIONS } from "@/lib/activityVocabulary";
import {
  BRANCH_FIELDS, branchFieldDef, OPERATOR_LABELS, LEAD_STATUS_OPTIONS, asActivityValue,
  type BranchRule, type BranchCatalog,
} from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface CatalogOption { id: string; name: string }

// Radix não aceita SelectItem com value vazio — sentinela para "status opcional"
const ANY_STATUS = "__any__";

interface Props {
  rules: BranchRule[];
  onChange: (rules: BranchRule[]) => void;
  workspaceId: string;
  companyId: string;
}

export function BranchRulesEditor({ rules, onChange, workspaceId, companyId }: Props) {
  const { data: members } = useAssignableMembers(workspaceId);
  const { data: workspaceTags } = useWorkspaceTags(workspaceId);

  const { data: catalogs } = useQuery({
    queryKey: ["flow-branch-catalogs", workspaceId, companyId],
    enabled: !!workspaceId && !!companyId,
    queryFn: async () => {
      const [products, segments, pains, objections, sources] = await Promise.all([
        supabase.from("crm_products").select("id, name").eq("workspace_id", workspaceId).eq("is_active", true),
        supabase.from("crm_segments").select("id, name").eq("workspace_id", workspaceId).eq("is_active", true),
        supabase.from("crm_pains").select("id, name").eq("workspace_id", workspaceId).eq("is_active", true),
        supabase.from("crm_objections").select("id, name").eq("workspace_id", workspaceId).eq("is_active", true),
        supabase.from("crm_contact_sources").select("id, name").eq("company_id", companyId).eq("is_active", true),
      ]);
      return {
        products: (products.data || []) as CatalogOption[],
        segments: (segments.data || []) as CatalogOption[],
        pains: (pains.data || []) as CatalogOption[],
        objections: (objections.data || []) as CatalogOption[],
        sources: (sources.data || []) as CatalogOption[],
      };
    },
  });

  const catalogOptions = (catalog: BranchCatalog): CatalogOption[] => {
    if (catalog === "members") return members || [];
    if (catalog === "lead_status") return LEAD_STATUS_OPTIONS;
    if (catalog === "sources") {
      // Origem do contato compara por NOME no worker — o valor salvo é o name
      return (catalogs?.sources || []).map((s) => ({ id: s.name, name: s.name }));
    }
    if (catalog === "tags") {
      // Tag do contato compara por NOME (case-insensitive) no worker — o valor salvo é o name
      return (workspaceTags || []).map((t) => ({ id: t.name, name: t.name }));
    }
    // Vocabulários fixos do widget de agendamento (valor salvo = texto exato
    // que o widget grava em crm_contacts; worker compara case-insensitive)
    if (catalog === "job_titles") return JOB_TITLE_OPTIONS.map((o) => ({ id: o, name: o }));
    if (catalog === "revenues") return REVENUE_OPTIONS.map((o) => ({ id: o, name: o }));
    if (catalog === "employee_counts") return EMPLOYEE_OPTIONS.map((o) => ({ id: o, name: o }));
    return catalogs?.[catalog] || [];
  };

  const groups = Array.from(new Set(BRANCH_FIELDS.map((f) => f.group)));

  const updateRule = (idx: number, patch: Partial<BranchRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const setField = (idx: number, fieldKey: string) => {
    const def = branchFieldDef(fieldKey);
    onChange(rules.map((r, i) =>
      i === idx ? { field: fieldKey, operator: def?.operators[0] || "eq", value: undefined } : r,
    ));
  };

  return (
    <div className="space-y-2">
      {rules.map((rule, idx) => {
        const def = branchFieldDef(rule.field);
        const needsValue = def && def.valueKind !== "none" &&
          rule.operator !== "empty" && rule.operator !== "not_empty";
        return (
          <div key={idx} className="flex items-center gap-2 flex-wrap">
            <Select value={rule.field || ""} onValueChange={(v) => setField(idx, v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Campo" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {BRANCH_FIELDS.filter((f) => f.group === g).map((f) => (
                      <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {def && (
              <Select
                value={rule.operator}
                onValueChange={(v) => updateRule(idx, {
                  operator: v,
                  // "tem"/"não tem" compartilham o mesmo par tipo+status
                  value: def.valueKind === "activity" ? rule.value : undefined,
                })}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {def.operators.map((op) => (
                    <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {needsValue && def.valueKind === "number" && (
              <Input
                type="number" className="w-28"
                value={rule.value === undefined || rule.value === null ? "" : String(rule.value)}
                onChange={(e) => updateRule(idx, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            )}
            {needsValue && def.valueKind === "text" && (
              <Input
                className="w-44"
                value={typeof rule.value === "string" ? rule.value : ""}
                onChange={(e) => updateRule(idx, { value: e.target.value })}
              />
            )}
            {needsValue && def.valueKind === "boolean" && (
              <Select
                value={rule.value === undefined ? "" : String(rule.value)}
                onValueChange={(v) => updateRule(idx, { value: v })}
              >
                <SelectTrigger className="w-28"><SelectValue placeholder="Valor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim</SelectItem>
                  <SelectItem value="false">Não</SelectItem>
                </SelectContent>
              </Select>
            )}
            {needsValue && def.valueKind === "catalog" && def.catalog && (
              <Select
                value={typeof rule.value === "string" ? rule.value : ""}
                onValueChange={(v) => updateRule(idx, { value: v })}
              >
                <SelectTrigger className="w-52"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {catalogOptions(def.catalog).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {needsValue && def.valueKind === "activity" && (() => {
              const act = asActivityValue(rule.value);
              return (
                <>
                  <Select
                    value={act.type}
                    onValueChange={(v) => updateRule(idx, { value: { ...act, type: v } })}
                  >
                    <SelectTrigger className="w-52"><SelectValue placeholder="Tipo de atividade" /></SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={act.status ?? ANY_STATUS}
                    onValueChange={(v) => updateRule(idx, {
                      value: { type: act.type, status: v === ANY_STATUS ? undefined : v },
                    })}
                  >
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_STATUS}>Qualquer status</SelectItem>
                      {ACTIVITY_STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              );
            })()}

            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => onChange(rules.filter((_, i) => i !== idx))}
              title="Remover regra"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline" size="sm"
        onClick={() => onChange([...rules, { field: "", operator: "eq", value: undefined }])}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar regra
      </Button>
    </div>
  );
}
