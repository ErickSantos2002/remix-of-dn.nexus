# Fluxos de CRM v2 — Fase 2 (Builder visual) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frontend dos Fluxos de CRM: lista em `/crm/settings/flows` e builder visual em `/crm/settings/flows/:id` com os nós `delay`/`branch`/`send_whatsapp`/`close_lead` — fluxos criáveis, editáveis e ativáveis de ponta a ponta sobre o motor da Fase 1 (sem e-mail, que é a Fase 3; sem métricas por nó, que são a Fase 4).

**Architecture:** Porte do layout do `JourneyBuilder` do ai-fastlane adaptado ao Nexus: coluna vertical de cards com "+" entre passos, ramificação Sim/Não em duas colunas, diálogo de configuração por tipo de nó. O frontend fala direto com o Supabase (`crm_flows` via RLS; validação de grafo é do banco — erros são exibidos tal como vêm). Estado de servidor via TanStack Query; nenhuma edge function nova.

**Tech Stack:** React 18 + TypeScript, TanStack Query, shadcn/ui, Tailwind (tokens semânticos), supabase-js.

**Spec:** `docs/superpowers/specs/2026-08-13-crm-flows-v2-design.md` (§5 UI; §4 config dos nós; §7 fase 2)

## Global Constraints

- UI em português (Brasil). **Sem emojis na UI. Sem cores diretas** (`text-white`, `bg-black`) — apenas tokens semânticos (`text-foreground`, `bg-card`, `text-muted-foreground`, etc.).
- As tabelas `crm_flows`/`crm_flow_runs` **não estão** em `src/integrations/supabase/types.ts` (auto-gerado, não editar) — usar `supabase.from("crm_flows" as any)`, mesmo padrão do código de cadences existente.
- Nó `close_lead` é terminal (`next` sempre null) — a UI só permite adicioná-lo no fim de um ramo.
- Agente IA do nó WhatsApp: listar **somente** agentes do workspace do fluxo (spec §4.3 — corrige a v1 que listava da empresa toda).
- Mídia: imagem ≤5 MB, vídeo MP4 ≤16 MB, **áudio MP3/OGG ≤16 MB** com `audio_duration` capturado no upload. Upload no bucket `widget-assets`, pasta `cadence/{company_id}/` (as policies de storage existentes cobrem essa pasta).
- Erro de validação do banco (grafo cíclico, config faltando...) é exibido no toast **tal como veio** — nunca mascarado.
- v1 intocada (nenhuma alteração em cadences). Aviso quando uma etapa tiver régua v1 ativa E fluxo v2 ativo.
- Lint gradual: ao editar `App.tsx`/`Sidebar.tsx`, corrigir erros de lint pré-existentes NELES se houver (prioridade `prefer-const` > `no-empty` > `no-explicit-any`); arquivos novos passam limpos em `npx eslint <arquivo>`.
- Verificação de tipos por task: `npx tsc --noEmit` não pode ganhar erros NOVOS referentes aos arquivos criados (o tsconfig é frouxo; a Task 1 registra o baseline).
- Commits pequenos por task, mensagem terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Push apenas na task final.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/flows.ts` | Tipos, labels, catálogo de campos da condição, helpers de grafo/tempo |
| `src/hooks/useFlows.ts` | Queries e mutations de `crm_flows` (lista com contagem de runs e conflito v1, fluxo único, CRUD) |
| `src/pages/CRMFlows.tsx` | Lista de fluxos + diálogo "Novo fluxo" |
| `src/components/crm/flows/FlowNodeCard.tsx` | Card visual de um nó no builder |
| `src/components/crm/flows/BranchRulesEditor.tsx` | Editor de regras da condição (campo → operador → valor, catálogos) |
| `src/components/crm/flows/WhatsAppNodeConfig.tsx` | Config do nó WhatsApp (conteúdo, mídia com áudio, agente, reescrita, período) |
| `src/components/crm/flows/FlowNodeConfigDialog.tsx` | Diálogo de criação/edição de nó (delay, branch, close_lead, send_whatsapp) |
| `src/pages/CRMFlowBuilder.tsx` | O builder: render da cadeia, entrada, guardas de salvar/ativar/pausar/arquivar |
| `src/App.tsx` | Rotas `/crm/settings/flows` e `/crm/settings/flows/:id` |
| `src/components/layout/Sidebar.tsx` | Item "Fluxos" no menu (adminOnly) |

---

### Task 1: `src/lib/flows.ts` — contrato do domínio

**Files:**
- Create: `src/lib/flows.ts`

**Interfaces:**
- Produces: tipos `FlowStatus`, `FlowNodeType`, `FlowNode`, `Flow`, `BranchRule`, `BranchFieldDef`; constantes `NODE_LABELS`, `STATUS_LABELS`, `OPERATOR_LABELS`, `BRANCH_FIELDS`, `WHATSAPP_VARS_HINT`; funções `newNodeId(): string`, `splitMinutes(total): {days,hours,minutes}`, `joinMinutes(days,hours,minutes): number`, `minutesToLabel(m): string`, `computePruned(nodes, entryId): string[]`. Todas as tasks seguintes importam daqui.

- [ ] **Step 1: Registrar o baseline de tipos**

Run: `npx tsc --noEmit 2>&1 | tail -5` — anote a contagem de erros pré-existentes (baseline). As tasks seguintes comparam contra ela.

- [ ] **Step 2: Escrever o arquivo**

```typescript
// src/lib/flows.ts
// Contrato do grafo de Fluxos de CRM v2. ESPELHA o que validate_crm_flow_graph
// (migration 20260813120500) aceita e o que o flow-worker sabe executar.
// Campos/operadores da condição espelham conditions.ts do flow-worker.

export type FlowStatus = "draft" | "active" | "paused" | "archived";
export type FlowNodeType = "delay" | "branch" | "send_whatsapp" | "send_email" | "close_lead";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  config: Record<string, unknown>;
  next: string | null;
  next_false: string | null;
}

export interface Flow {
  id: string;
  workspace_id: string;
  company_id: string;
  stage_id: string;
  name: string;
  status: FlowStatus;
  exit_on_stage_change: boolean;
  reentry: "once" | "allowed";
  reentry_cooldown_hours: number;
  entry_node_id: string | null;
  nodes: FlowNode[];
  created_at: string;
  updated_at: string;
}

export const NODE_LABELS: Record<FlowNodeType, string> = {
  delay: "Espera",
  branch: "Condição",
  send_whatsapp: "Mensagem WhatsApp",
  send_email: "E-mail",
  close_lead: "Fechar lead",
};

export const STATUS_LABELS: Record<FlowStatus, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  archived: "Arquivado",
};

export const WHATSAPP_VARS_HINT =
  "Variáveis: {nome_lead}, {primeiro_nome}, {empresa}, {atendente}";

export function newNodeId(): string {
  return `n${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  const t = Math.max(0, Math.floor(total || 0));
  return { days: Math.floor(t / 1440), hours: Math.floor((t % 1440) / 60), minutes: t % 60 };
}

export function joinMinutes(days: number, hours: number, minutes: number): number {
  return Math.max(1, (days || 0) * 1440 + (hours || 0) * 60 + (minutes || 0));
}

export function minutesToLabel(m: number): string {
  const { days, hours, minutes } = splitMinutes(m);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}min`);
  return parts.join(" ") || "0min";
}

// ---------------------------------------------------------------------------
// Condição (branch): catálogo de campos — espelha o evalRule do flow-worker.
// valueKind decide o controle de valor na UI; catalog aponta a fonte da lista.
// ---------------------------------------------------------------------------
export type BranchValueKind = "number" | "text" | "boolean" | "none" | "catalog";
export type BranchCatalog =
  | "products" | "segments" | "pains" | "objections" | "members" | "sources" | "lead_status";

export interface BranchFieldDef {
  key: string;
  label: string;
  group: string;
  valueKind: BranchValueKind;
  catalog?: BranchCatalog;
  operators: string[];
}

export interface BranchRule {
  field: string;
  operator: string;
  value?: unknown;
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: "é",
  neq: "não é",
  gt: "maior que",
  lt: "menor que",
  contains: "contém",
  not_contains: "não contém",
  empty: "está vazio",
  not_empty: "está preenchido",
};

export const BRANCH_FIELDS: BranchFieldDef[] = [
  { key: "value", label: "Valor do card", group: "Card", valueKind: "number", operators: ["gt", "lt", "eq", "neq", "empty", "not_empty"] },
  { key: "product_id", label: "Produto", group: "Card", valueKind: "catalog", catalog: "products", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "segment_id", label: "Segmento", group: "Card", valueKind: "catalog", catalog: "segments", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "assigned_to", label: "Atendente", group: "Card", valueKind: "catalog", catalog: "members", operators: ["eq", "neq", "empty", "not_empty"] },
  { key: "status", label: "Status do card", group: "Card", valueKind: "catalog", catalog: "lead_status", operators: ["eq", "neq"] },
  { key: "days_in_stage", label: "Tempo na etapa (dias)", group: "Card", valueKind: "number", operators: ["gt", "lt"] },
  { key: "lead_age_days", label: "Idade do lead (dias)", group: "Card", valueKind: "number", operators: ["gt", "lt"] },
  { key: "utm_source", label: "Canal (utm_source)", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_campaign", label: "Campanha", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_medium", label: "Medium", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_content", label: "Content", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "utm_term", label: "Term", group: "Card", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "contact_source", label: "Origem do contato", group: "Contato", valueKind: "catalog", catalog: "sources", operators: ["eq", "neq"] },
  { key: "contact_company", label: "Empresa do contato", group: "Contato", valueKind: "text", operators: ["eq", "neq", "contains", "empty", "not_empty"] },
  { key: "has_phone", label: "Telefone", group: "Contato", valueKind: "none", operators: ["not_empty", "empty"] },
  { key: "has_email", label: "E-mail", group: "Contato", valueKind: "none", operators: ["not_empty", "empty"] },
  { key: "tags", label: "Tag do contato", group: "Contato", valueKind: "text", operators: ["contains", "not_contains"] },
  { key: "propensity_score", label: "Propensão (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "risk_score", label: "Risco (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "opportunity_score", label: "Oportunidade (score)", group: "DNIA", valueKind: "number", operators: ["gt", "lt", "empty", "not_empty"] },
  { key: "pain", label: "Dor", group: "Catálogos", valueKind: "catalog", catalog: "pains", operators: ["contains", "not_contains"] },
  { key: "objection", label: "Objeção", group: "Catálogos", valueKind: "catalog", catalog: "objections", operators: ["contains", "not_contains"] },
  { key: "replied_since_entry", label: "Respondeu desde a entrada no fluxo", group: "Engajamento", valueKind: "boolean", operators: ["eq"] },
];

export const LEAD_STATUS_OPTIONS = [
  { id: "open", name: "Aberto" },
  { id: "won", name: "Ganho" },
  { id: "lost", name: "Perdido" },
];

export function branchFieldDef(key: string): BranchFieldDef | undefined {
  return BRANCH_FIELDS.find((f) => f.key === key);
}

/** Ids inalcançáveis a partir da entrada — usados no aviso de exclusão em cascata. */
export function computePruned(nodes: FlowNode[], entryId: string | null): string[] {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue: (string | null | undefined)[] = [entryId];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || seen.has(cur) || !map.has(cur)) continue;
    seen.add(cur);
    const n = map.get(cur)!;
    queue.push(n.next, n.next_false);
  }
  return nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
}
```

- [ ] **Step 3: Verificar**

Run: `npx eslint src/lib/flows.ts` → sem erros. `npx tsc --noEmit 2>&1 | tail -5` → mesma contagem do baseline (nenhum erro novo).

- [ ] **Step 4: Commit**

```bash
git add src/lib/flows.ts
git commit -m "Fluxos v2: contrato de dominio do builder (tipos, campos da condicao, helpers)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/hooks/useFlows.ts` — dados

**Files:**
- Create: `src/hooks/useFlows.ts`

**Interfaces:**
- Consumes: tipos da Task 1; `useWorkspace()` (`workspaceId`), `useCompany()` (`currentCompany`).
- Produces: `useFlowsList(): UseQueryResult<FlowListItem[]>` com `FlowListItem = Flow & { stage_name: string; open_runs: number; v1_conflict: boolean }`; `useFlow(id?: string): UseQueryResult<Flow | null>`; `useFlowMutations()` retornando `{ createFlow, saveFlow, setFlowStatus, duplicateFlow }` — todas mutations `mutateAsync` que LANÇAM o erro do banco (o chamador mostra o toast).

- [ ] **Step 1: Escrever o arquivo**

```typescript
// src/hooks/useFlows.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompany } from "@/contexts/CompanyContext";
import type { Flow, FlowNode, FlowStatus } from "@/lib/flows";

export interface FlowListItem extends Flow {
  stage_name: string;
  open_runs: number;
  v1_conflict: boolean;
}

export function useFlowsList() {
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();
  return useQuery({
    queryKey: ["crm-flows", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<FlowListItem[]> => {
      const { data: flows, error } = await supabase
        .from("crm_flows" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = ((flows as unknown) as Flow[]) || [];

      const { data: stages } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name")
        .eq("workspace_id", workspaceId!);
      const stageName = new Map((stages || []).map((s) => [s.id, s.name]));

      const runCount = new Map<string, number>();
      const ids = list.map((f) => f.id);
      if (ids.length > 0) {
        const { data: runs } = await supabase
          .from("crm_flow_runs" as any)
          .select("flow_id")
          .in("flow_id", ids)
          .in("state", ["active", "waiting"]);
        for (const r of ((runs as unknown) as { flow_id: string }[]) || []) {
          runCount.set(r.flow_id, (runCount.get(r.flow_id) || 0) + 1);
        }
      }

      // Conflito com a v1: régua de etapa ATIVA da empresa na mesma etapa
      const v1Stages = new Set<string>();
      if (currentCompany?.id) {
        const { data: rules } = await supabase
          .from("cadence_rules" as any)
          .select("stage_id")
          .eq("company_id", currentCompany.id)
          .eq("trigger_type", "stage")
          .eq("is_active", true);
        for (const r of ((rules as unknown) as { stage_id: string | null }[]) || []) {
          if (r.stage_id) v1Stages.add(r.stage_id);
        }
      }

      return list.map((f) => ({
        ...f,
        stage_name: stageName.get(f.stage_id) || "—",
        open_runs: runCount.get(f.id) || 0,
        v1_conflict: v1Stages.has(f.stage_id),
      }));
    },
  });
}

export function useFlow(id?: string) {
  return useQuery({
    queryKey: ["crm-flow", id],
    enabled: !!id,
    queryFn: async (): Promise<Flow | null> => {
      const { data, error } = await supabase
        .from("crm_flows" as any)
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return ((data as unknown) as Flow) || null;
    },
  });
}

export interface SaveFlowPatch {
  name?: string;
  nodes?: FlowNode[];
  entry_node_id?: string | null;
  exit_on_stage_change?: boolean;
  reentry?: "once" | "allowed";
  reentry_cooldown_hours?: number;
}

export function useFlowMutations() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { currentCompany } = useCompany();

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ["crm-flows"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["crm-flow", id] });
  };

  const createFlow = useMutation({
    mutationFn: async (input: { name: string; stage_id: string }): Promise<Flow> => {
      const { data, error } = await supabase
        .from("crm_flows" as any)
        .insert({
          workspace_id: workspaceId,
          company_id: currentCompany?.id, // o banco força a company do workspace
          stage_id: input.stage_id,
          name: input.name,
          status: "draft",
          nodes: [],
        })
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as Flow;
    },
    onSuccess: () => invalidate(),
  });

  const saveFlow = useMutation({
    mutationFn: async (input: { id: string; patch: SaveFlowPatch }): Promise<void> => {
      const { error } = await supabase
        .from("crm_flows" as any)
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const setFlowStatus = useMutation({
    mutationFn: async (input: { id: string; status: FlowStatus }): Promise<void> => {
      const { error } = await supabase
        .from("crm_flows" as any)
        .update({ status: input.status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const duplicateFlow = useMutation({
    mutationFn: async (flow: Flow): Promise<Flow> => {
      const { data, error } = await supabase
        .from("crm_flows" as any)
        .insert({
          workspace_id: flow.workspace_id,
          company_id: flow.company_id,
          stage_id: flow.stage_id,
          name: `${flow.name} (cópia)`,
          status: "draft",
          entry_node_id: flow.entry_node_id,
          nodes: flow.nodes,
          exit_on_stage_change: flow.exit_on_stage_change,
          reentry: flow.reentry,
          reentry_cooldown_hours: flow.reentry_cooldown_hours,
        })
        .select()
        .single();
      if (error) throw error;
      return (data as unknown) as Flow;
    },
    onSuccess: () => invalidate(),
  });

  return { createFlow, saveFlow, setFlowStatus, duplicateFlow };
}
```

- [ ] **Step 2: Verificar**

Run: `npx eslint src/hooks/useFlows.ts` → sem erros (os casts `as any`/`as unknown` seguem o padrão do código de cadences; se a regra `no-explicit-any` acusar, trocar `as any` por `as never` no argumento de `from()` NÃO é o padrão do projeto — manter `as any` e, se o lint do projeto acusar, suprimir com `// eslint-disable-next-line @typescript-eslint/no-explicit-any` na linha, como já ocorre em código existente de cadences). `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFlows.ts
git commit -m "Fluxos v2: hooks de dados do builder (lista, fluxo, mutations)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Lista `/crm/settings/flows` + rota + menu

**Files:**
- Create: `src/pages/CRMFlows.tsx`
- Modify: `src/App.tsx` (lazy import + rota, junto das linhas 65/186 onde está `CRMCadences`)
- Modify: `src/components/layout/Sidebar.tsx:81` (novo item após "Réguas")

**Interfaces:**
- Consumes: `useFlowsList`, `useFlowMutations` (Task 2); `STATUS_LABELS` (Task 1).
- Produces: rota `/crm/settings/flows` navegável; navegação para `/crm/settings/flows/:id` (página criada na Task 6 — até lá o clique cai em NotFound, aceitável dentro da fase).

- [ ] **Step 1: Escrever `src/pages/CRMFlows.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useToast } from "@/hooks/use-toast";
import { useFlowsList, useFlowMutations } from "@/hooks/useFlows";
import { STATUS_LABELS, type FlowStatus } from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Copy, Archive, AlertTriangle, GitBranch } from "lucide-react";

const STATUS_BADGE: Record<FlowStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/30",
  paused: "bg-warning/10 text-warning border-warning/30",
  archived: "bg-muted text-muted-foreground border-border",
};

export default function CRMFlows() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspaceId, currentWorkspace } = useWorkspace();
  const { data: flows, isLoading } = useFlowsList();
  const { createFlow, duplicateFlow, setFlowStatus } = useFlowMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStage, setNewStage] = useState("");
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const { data: stages } = useQuery({
    queryKey: ["crm-flow-stages", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name")
        .eq("workspace_id", workspaceId!)
        .order("order");
      return data || [];
    },
  });

  const handleCreate = async () => {
    try {
      const flow = await createFlow.mutateAsync({ name: newName.trim(), stage_id: newStage });
      setCreateOpen(false);
      setNewName("");
      setNewStage("");
      navigate(`/crm/settings/flows/${flow.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao criar fluxo", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDuplicate = async (id: string) => {
    const flow = flows?.find((f) => f.id === id);
    if (!flow) return;
    try {
      const copy = await duplicateFlow.mutateAsync(flow);
      toast({ title: "Fluxo duplicado como rascunho" });
      navigate(`/crm/settings/flows/${copy.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao duplicar", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    try {
      await setFlowStatus.mutateAsync({ id: archiveId, status: "archived" });
      toast({ title: "Fluxo arquivado", description: "Leads que estavam no fluxo foram encerrados." });
    } catch (e) {
      toast({ variant: "destructive", title: "Erro ao arquivar", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setArchiveId(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Fluxos</h1>
          <p className="text-muted-foreground text-sm">
            Automações visuais disparadas pela entrada do lead em uma etapa do pipeline.
          </p>
          {currentWorkspace && (
            <p className="text-xs text-muted-foreground mt-1">
              Workspace: <span className="font-medium text-foreground">{currentWorkspace.name}</span>
            </p>
          )}
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo fluxo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !flows || flows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed rounded-md">
          <GitBranch className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm">Nenhum fluxo ainda. Clique em "Novo fluxo" para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((f) => (
            <Card key={f.id} className="hover:border-border transition-colors">
              <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
                <button
                  type="button"
                  className="text-left flex-1 min-w-0"
                  onClick={() => navigate(`/crm/settings/flows/${f.id}`)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground truncate">{f.name}</span>
                    <Badge variant="outline" className={STATUS_BADGE[f.status]}>
                      {STATUS_LABELS[f.status]}
                    </Badge>
                    {f.v1_conflict && f.status === "active" && (
                      <span title="Esta etapa também tem uma régua v1 ativa — os dois disparam. Recomendado desativar a régua v1 desta etapa.">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Etapa: <span className="text-foreground">{f.stage_name}</span>
                    {" · "}{f.open_runs} lead{f.open_runs === 1 ? "" : "s"} no fluxo agora
                    {" · "}atualizado {new Date(f.updated_at).toLocaleDateString("pt-BR")}
                  </p>
                </button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" title="Duplicar" onClick={() => handleDuplicate(f.id)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  {f.status !== "archived" && (
                    <Button variant="ghost" size="icon" title="Arquivar" onClick={() => setArchiveId(f.id)}>
                      <Archive className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Boas-vindas MQL" />
            </div>
            <div className="space-y-1.5">
              <Label>Etapa-gatilho</Label>
              <Select value={newStage} onValueChange={setNewStage}>
                <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                <SelectContent>
                  {(stages || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                O fluxo dispara quando um lead entra nesta etapa. Só pode haver um fluxo ativo por etapa.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || !newStage || createFlow.isPending}>
              {createFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(o) => !o && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar este fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads que estiverem no meio do fluxo serão encerrados (motivo: fluxo arquivado) e nenhuma mensagem futura será enviada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleArchive}>
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Rota em `src/App.tsx`**

Junto do lazy de `CRMCadences` (linha ~65), adicionar:

```typescript
const CRMFlows = lazyRetry(() => import("./pages/CRMFlows"));
```

Logo APÓS a rota de cadences (linha ~186 `crm/settings/cadences`), adicionar (mesmo padrão de Suspense/PageLoader da linha vizinha):

```tsx
<Route path="crm/settings/flows" element={<Suspense fallback={<PageLoader />}><CRMFlows /></Suspense>} />
```

- [ ] **Step 3: Item no menu — `src/components/layout/Sidebar.tsx:81`**

Logo após a linha `{ icon: Zap, label: "Réguas", href: "/crm/settings/cadences", adminOnly: true },` adicionar:

```typescript
  { icon: GitBranch, label: "Fluxos", href: "/crm/settings/flows", adminOnly: true },
```

E incluir `GitBranch` no import de `lucide-react` do arquivo (se ainda não estiver).

- [ ] **Step 4: Verificar**

Run: `npx eslint src/pages/CRMFlows.tsx` → limpo; `npx eslint src/App.tsx src/components/layout/Sidebar.tsx` → sem erros NOVOS (corrigir pré-existentes nesses dois se forem `prefer-const`/`no-empty`); `npx tsc --noEmit` → sem erros novos; `npm run dev` e abrir `http://localhost:8080/crm/settings/flows` → lista vazia renderiza, "Novo fluxo" cria e navega (a rota `:id` ainda dá NotFound — esperado até a Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/pages/CRMFlows.tsx src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "Fluxos v2: lista de fluxos, rota e item de menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Card de nó + diálogo de config (delay, close_lead) + editor de condição

**Files:**
- Create: `src/components/crm/flows/FlowNodeCard.tsx`
- Create: `src/components/crm/flows/BranchRulesEditor.tsx`
- Create: `src/components/crm/flows/FlowNodeConfigDialog.tsx`

**Interfaces:**
- Consumes: Task 1 (`FlowNode`, `FlowNodeType`, `NODE_LABELS`, `BRANCH_FIELDS`, `branchFieldDef`, `OPERATOR_LABELS`, `LEAD_STATUS_OPTIONS`, `splitMinutes`, `joinMinutes`, tipos `BranchRule`); `useAssignableMembers(workspaceId)` (hook existente).
- Produces:
  - `FlowNodeCard({ node, summary, onEdit, onDelete }): JSX` — card visual.
  - `BranchRulesEditor({ rules, onChange, workspaceId, companyId }): JSX` — controlado.
  - `FlowNodeConfigDialog({ open, onOpenChange, type, initialConfig, onSave, workspaceId, companyId }): JSX` — `onSave(config: Record<string, unknown>)` só é chamado com config VÁLIDA. Na Task 5 o case `send_whatsapp` deste diálogo é preenchido; até lá mostra um aviso "disponível na próxima task" — o builder (Task 6) já integra tudo.

- [ ] **Step 1: `FlowNodeCard.tsx`**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, GitBranch, MessageSquare, Flag, Mail, Pencil, Trash2 } from "lucide-react";
import { NODE_LABELS, type FlowNode, type FlowNodeType } from "@/lib/flows";

const NODE_ICONS: Record<FlowNodeType, typeof Clock> = {
  delay: Clock,
  branch: GitBranch,
  send_whatsapp: MessageSquare,
  send_email: Mail,
  close_lead: Flag,
};

interface Props {
  node: FlowNode;
  summary: string;
  onEdit: () => void;
  onDelete: () => void;
}

export function FlowNodeCard({ node, summary, onEdit, onDelete }: Props) {
  const Icon = NODE_ICONS[node.type];
  return (
    <Card className="w-72 border-border/70">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{NODE_LABELS[node.type]}</p>
              <p className="text-xs text-muted-foreground truncate" title={summary}>{summary}</p>
            </div>
          </div>
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete} title="Excluir">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `BranchRulesEditor.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAssignableMembers } from "@/hooks/useAssignableMembers";
import {
  BRANCH_FIELDS, branchFieldDef, OPERATOR_LABELS, LEAD_STATUS_OPTIONS,
  type BranchRule, type BranchCatalog,
} from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface CatalogOption { id: string; name: string }

interface Props {
  rules: BranchRule[];
  onChange: (rules: BranchRule[]) => void;
  workspaceId: string;
  companyId: string;
}

export function BranchRulesEditor({ rules, onChange, workspaceId, companyId }: Props) {
  const { data: members } = useAssignableMembers(workspaceId);

  const { data: catalogs } = useQuery({
    queryKey: ["flow-branch-catalogs", workspaceId, companyId],
    enabled: !!workspaceId && !!companyId,
    queryFn: async () => {
      const [products, segments, pains, objections, sources] = await Promise.all([
        supabase.from("crm_products").select("id, name").eq("workspace_id", workspaceId),
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
              <Select value={rule.operator} onValueChange={(v) => updateRule(idx, { operator: v, value: undefined })}>
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
```

- [ ] **Step 3: `FlowNodeConfigDialog.tsx`** (delay + close_lead + branch; case `send_whatsapp` é preenchido na Task 5)

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  NODE_LABELS, splitMinutes, joinMinutes, branchFieldDef,
  type FlowNodeType, type BranchRule,
} from "@/lib/flows";
import { BranchRulesEditor } from "./BranchRulesEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: FlowNodeType | null;
  initialConfig: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
  workspaceId: string;
  companyId: string;
}

export function FlowNodeConfigDialog({ open, onOpenChange, type, initialConfig, onSave, workspaceId, companyId }: Props) {
  const { toast } = useToast();
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (open) setConfig({ ...initialConfig });
  }, [open, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: lossReasons } = useQuery({
    queryKey: ["flow-loss-reasons", workspaceId],
    enabled: open && type === "close_lead" && !!workspaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_loss_reasons")
        .select("id, name")
        .eq("workspace_id", workspaceId);
      return data || [];
    },
  });

  const handleSave = () => {
    if (type === "delay") {
      const minutes = Number(config.minutes) || 0;
      if (minutes < 1) {
        toast({ variant: "destructive", title: "Espera inválida", description: "A espera precisa ser de ao menos 1 minuto." });
        return;
      }
      onSave({ minutes });
    } else if (type === "branch") {
      const rules = (config.rules as BranchRule[] | undefined) || [];
      const valid = rules.filter((r) => r.field && r.operator && branchFieldDef(r.field));
      if (valid.length === 0) {
        toast({ variant: "destructive", title: "Condição vazia", description: "Adicione ao menos uma regra completa." });
        return;
      }
      const incomplete = valid.some((r) => {
        const def = branchFieldDef(r.field)!;
        const needsValue = def.valueKind !== "none" && r.operator !== "empty" && r.operator !== "not_empty";
        return needsValue && (r.value === undefined || r.value === null || r.value === "");
      });
      if (incomplete) {
        toast({ variant: "destructive", title: "Regra incompleta", description: "Preencha o valor de todas as regras." });
        return;
      }
      onSave({ logic: config.logic === "or" ? "or" : "and", rules: valid });
    } else if (type === "close_lead") {
      const outcome = config.outcome === "lost" ? "lost" : "won";
      if (outcome === "lost" && !config.loss_reason_id) {
        toast({ variant: "destructive", title: "Motivo obrigatório", description: "Selecione o motivo de perda." });
        return;
      }
      onSave({ outcome, loss_reason_id: outcome === "lost" ? config.loss_reason_id : null });
    } else if (type === "send_whatsapp") {
      // Preenchido na Task 5 (WhatsAppNodeConfig valida conteúdo/mídia)
      const content = typeof config.content === "string" ? config.content.trim() : "";
      if (!content && !config.media_url) {
        toast({ variant: "destructive", title: "Mensagem vazia", description: "Escreva o conteúdo ou anexe uma mídia." });
        return;
      }
      onSave(config);
    }
    onOpenChange(false);
  };

  const delayParts = splitMinutes(Number(config.minutes) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type ? NODE_LABELS[type] : ""}</DialogTitle>
        </DialogHeader>

        {type === "delay" && (
          <div className="flex items-end gap-3">
            {(["days", "hours", "minutes"] as const).map((unit) => (
              <div key={unit} className="space-y-1">
                <Label className="text-xs">{unit === "days" ? "Dias" : unit === "hours" ? "Horas" : "Minutos"}</Label>
                <Input
                  type="number" min={0} className="w-24"
                  value={delayParts[unit]}
                  onChange={(e) => {
                    const v = Math.max(0, parseInt(e.target.value) || 0);
                    const next = { ...delayParts, [unit]: v };
                    setConfig({ ...config, minutes: joinMinutes(next.days, next.hours, next.minutes) });
                  }}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground pb-2">após o passo anterior</p>
          </div>
        )}

        {type === "branch" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs">As regras se combinam por</Label>
              <Select
                value={config.logic === "or" ? "or" : "and"}
                onValueChange={(v) => setConfig({ ...config, logic: v })}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">E</SelectItem>
                  <SelectItem value="or">OU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BranchRulesEditor
              rules={(config.rules as BranchRule[] | undefined) || []}
              onChange={(rules) => setConfig({ ...config, rules })}
              workspaceId={workspaceId}
              companyId={companyId}
            />
            <p className="text-[11px] text-muted-foreground">
              A condição é avaliada no momento em que o lead chega neste passo. Regra sem dado no card conta como "Não".
            </p>
          </div>
        )}

        {type === "close_lead" && (
          <div className="space-y-4">
            <RadioGroup
              value={config.outcome === "lost" ? "lost" : "won"}
              onValueChange={(v) => setConfig({ ...config, outcome: v })}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="won" id="flow-won" />
                <Label htmlFor="flow-won">Marcar como ganho</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="lost" id="flow-lost" />
                <Label htmlFor="flow-lost">Marcar como perdido</Label>
              </div>
            </RadioGroup>
            {config.outcome === "lost" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Motivo de perda</Label>
                <Select
                  value={typeof config.loss_reason_id === "string" ? config.loss_reason_id : ""}
                  onValueChange={(v) => setConfig({ ...config, loss_reason_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {(lossReasons || []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Este passo é terminal: fecha o card no pipeline (mesmo efeito do fechamento manual) e encerra o fluxo para o lead.
            </p>
          </div>
        )}

        {type === "send_whatsapp" && (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-md">
            Configuração de WhatsApp disponível na próxima etapa da implementação.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verificar**

Run: `npx eslint src/components/crm/flows/` → limpo; `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/components/crm/flows/
git commit -m "Fluxos v2: card de no, editor de condicao e dialogo de config (espera/condicao/fechar lead)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Config do nó WhatsApp (mídia com áudio, agente, reescrita)

**Files:**
- Create: `src/components/crm/flows/WhatsAppNodeConfig.tsx`
- Modify: `src/components/crm/flows/FlowNodeConfigDialog.tsx` (substituir o aviso do case `send_whatsapp` pelo componente)

**Interfaces:**
- Consumes: `WHATSAPP_VARS_HINT` (Task 1); diálogo da Task 4 (o case `send_whatsapp` já valida conteúdo/mídia no save).
- Produces: `WhatsAppNodeConfig({ config, onChange, workspaceId, companyId }): JSX` — controlado; escreve em `config`: `content`, `media_url`, `media_type` (`image|video|audio|null`), `audio_duration` (segundos, só áudio), `day_period`, `agent_id`, `agent_source`, `ai_rewrite_enabled`.

- [ ] **Step 1: Escrever `WhatsAppNodeConfig.tsx`** (porte dos controles do `CadenceTemplateEditor` da v1, com duas mudanças deliberadas: agentes SOMENTE do workspace do fluxo, e upload de áudio)

```tsx
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WHATSAPP_VARS_HINT } from "@/lib/flows";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, X, Image as ImageIcon, Video as VideoIcon, Music,
} from "lucide-react";

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  workspaceId: string;
  companyId: string;
}

type MediaKind = "image" | "video" | "audio";

const MEDIA_LIMITS: Record<MediaKind, { maxBytes: number; accept: string; label: string }> = {
  image: { maxBytes: 5 * 1024 * 1024, accept: "image/jpeg,image/png,image/webp", label: "Imagens devem ter no máximo 5 MB." },
  video: { maxBytes: 16 * 1024 * 1024, accept: "video/mp4", label: "Vídeos devem ter no máximo 16 MB." },
  audio: { maxBytes: 16 * 1024 * 1024, accept: "audio/mpeg,audio/ogg,.mp3,.ogg", label: "Áudios (MP3/OGG) devem ter no máximo 16 MB." },
};

export function WhatsAppNodeConfig({ config, onChange, workspaceId, companyId }: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const inputs = useRef<Record<MediaKind, HTMLInputElement | null>>({ image: null, video: null, audio: null });

  // Spec §4.3: SOMENTE agentes do workspace do fluxo (a v1 listava da empresa toda
  // e o envio falhava em silêncio quando o agente era de outro workspace).
  const { data: agents } = useQuery({
    queryKey: ["flow-agents", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [legacy, instances] = await Promise.all([
        supabase.from("agents" as any).select("id, name")
          .eq("workspace_id", workspaceId).eq("is_active", true).eq("is_archived", false),
        supabase.from("agent_instances" as any).select("id, name")
          .eq("workspace_id", workspaceId).eq("is_active", true).eq("is_archived", false),
      ]);
      return [
        ...(((legacy.data as any[]) || []).map((a) => ({ ...a, source: "agents" as const }))),
        ...(((instances.data as any[]) || []).map((a) => ({ ...a, source: "agent_instances" as const }))),
      ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    },
  });

  const readAudioDuration = (file: File): Promise<number | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener("loadedmetadata", () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
      });
      audio.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        resolve(null);
      });
    });

  const handleUpload = async (kind: MediaKind, file: File) => {
    const limit = MEDIA_LIMITS[kind];
    if (file.size > limit.maxBytes) {
      toast({ variant: "destructive", title: "Arquivo muito grande", description: limit.label });
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `cadence/${companyId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("widget-assets")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("widget-assets").getPublicUrl(path);
      const patch: Record<string, unknown> = { ...config, media_url: pub.publicUrl, media_type: kind };
      if (kind === "audio") patch.audio_duration = await readAudioDuration(file);
      else patch.audio_duration = null;
      onChange(patch);
      toast({ title: "Mídia anexada" });
    } catch (e) {
      toast({ variant: "destructive", title: "Erro no upload", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  };

  const mediaUrl = typeof config.media_url === "string" ? config.media_url : null;
  const mediaType = config.media_type as MediaKind | null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs">Período do dia</Label>
        <Select
          value={typeof config.day_period === "string" ? (config.day_period as string) : "qualquer"}
          onValueChange={(v) => onChange({ ...config, day_period: v })}
        >
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="qualquer">Qualquer</SelectItem>
            <SelectItem value="manha">Manhã (6h–12h)</SelectItem>
            <SelectItem value="tarde">Tarde (12h–18h)</SelectItem>
            <SelectItem value="noite">Noite (18h–22h)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Agente IA (assume o chat após envio)</Label>
        <Select
          value={config.agent_id && config.agent_source ? `${config.agent_source}:${config.agent_id}` : "__keep__"}
          onValueChange={(v) => {
            if (v === "__keep__") onChange({ ...config, agent_id: null, agent_source: null });
            else {
              const [src, id] = v.split(":");
              onChange({ ...config, agent_id: id, agent_source: src });
            }
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__keep__">Manter atribuição atual</SelectItem>
            {(agents || []).map((a) => (
              <SelectItem key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Somente agentes deste workspace. Ao enviar, o chat vai para "IA conversando" com este agente.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
        <div className="space-y-0.5">
          <Label className="text-xs">Reescrever com IA antes de enviar</Label>
          <p className="text-[11px] text-muted-foreground">
            A IA reescreve a mensagem mantendo a essência, preservando nomes e links, sem inventar informações.
          </p>
        </div>
        <Switch
          checked={config.ai_rewrite_enabled === true}
          onCheckedChange={(v) => onChange({ ...config, ai_rewrite_enabled: v })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mídia (opcional)</Label>
          {mediaUrl && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...config, media_url: null, media_type: null, audio_duration: null })}>
              <X className="h-3 w-3 mr-1" /> Remover
            </Button>
          )}
        </div>
        {mediaUrl ? (
          <div className="rounded-md border border-border p-2 bg-muted/30">
            {mediaType === "image" && <img src={mediaUrl} alt="Mídia" className="max-h-40 rounded" />}
            {mediaType === "video" && <video src={mediaUrl} controls className="max-h-40 rounded" />}
            {mediaType === "audio" && (
              <div className="space-y-1">
                <audio src={mediaUrl} controls className="w-full" />
                {typeof config.audio_duration === "number" && (
                  <p className="text-[11px] text-muted-foreground">
                    Duração: {config.audio_duration}s — enviado como mensagem de voz.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(MEDIA_LIMITS) as MediaKind[]).map((kind) => (
              <span key={kind}>
                <input
                  type="file"
                  accept={MEDIA_LIMITS[kind].accept}
                  className="hidden"
                  ref={(el) => { inputs.current[kind] = el; }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(kind, f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputs.current[kind]?.click()}>
                  {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> :
                    kind === "image" ? <ImageIcon className="h-3 w-3 mr-1" /> :
                    kind === "video" ? <VideoIcon className="h-3 w-3 mr-1" /> :
                    <Music className="h-3 w-3 mr-1" />}
                  {kind === "image" ? "Imagem" : kind === "video" ? "Vídeo" : "Áudio"}
                </Button>
              </span>
            ))}
            <span className="text-xs text-muted-foreground self-center">
              Imagem 5 MB · Vídeo MP4 16 MB · Áudio MP3/OGG 16 MB
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Mensagem {mediaUrl && mediaType !== "audio" && <span className="text-muted-foreground">(enviada como legenda)</span>}
          {mediaType === "audio" && <span className="text-muted-foreground">(opcional; o áudio é a mensagem)</span>}
        </Label>
        <Textarea
          rows={4}
          value={typeof config.content === "string" ? config.content : ""}
          onChange={(e) => onChange({ ...config, content: e.target.value })}
          placeholder="Olá {primeiro_nome}, tudo bem?"
        />
        <p className="text-[11px] text-muted-foreground">{WHATSAPP_VARS_HINT}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrar no diálogo** — em `FlowNodeConfigDialog.tsx`, substituir o bloco do aviso:

```tsx
        {type === "send_whatsapp" && (
          <WhatsAppNodeConfig
            config={config}
            onChange={setConfig}
            workspaceId={workspaceId}
            companyId={companyId}
          />
        )}
```

E adicionar o import: `import { WhatsAppNodeConfig } from "./WhatsAppNodeConfig";`. A validação do save (conteúdo OU mídia) já existe no case `send_whatsapp` do `handleSave` — ajustar para também aceitar mídia sem conteúdo (já aceita).

- [ ] **Step 3: Verificar**

Run: `npx eslint src/components/crm/flows/` → limpo; `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/components/crm/flows/
git commit -m "Fluxos v2: config do no WhatsApp com midia (incl. audio), agente do workspace e reescrita

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: O builder — `/crm/settings/flows/:id`

**Files:**
- Create: `src/pages/CRMFlowBuilder.tsx`
- Modify: `src/App.tsx` (lazy import + rota `crm/settings/flows/:id`)

**Interfaces:**
- Consumes: Tasks 1–5 (`useFlow`, `useFlowMutations`, `FlowNodeCard`, `FlowNodeConfigDialog`, helpers de `@/lib/flows`).
- Produces: builder completo — criar/editar/reordenar por inserção, salvar com erro do banco visível, ativar/pausar/arquivar com guardas.

- [ ] **Step 1: Escrever `src/pages/CRMFlowBuilder.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useFlow, useFlowMutations, useFlowsList } from "@/hooks/useFlows";
import {
  NODE_LABELS, STATUS_LABELS, OPERATOR_LABELS, branchFieldDef, minutesToLabel,
  newNodeId, computePruned, type FlowNode, type FlowNodeType, type BranchRule,
} from "@/lib/flows";
import { FlowNodeCard } from "@/components/crm/flows/FlowNodeCard";
import { FlowNodeConfigDialog } from "@/components/crm/flows/FlowNodeConfigDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Play, Pause, Archive, Save, GitBranch, AlertTriangle } from "lucide-react";

type BranchKey = "next" | "next_false";

const ADD_MENU: { label: string; type: FlowNodeType }[] = [
  { label: NODE_LABELS.send_whatsapp, type: "send_whatsapp" },
  { label: NODE_LABELS.delay, type: "delay" },
  { label: NODE_LABELS.branch, type: "branch" },
  { label: NODE_LABELS.close_lead, type: "close_lead" },
];

export default function CRMFlowBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: flow, isLoading, refetch } = useFlow(id);
  const { data: flowsList } = useFlowsList();
  const { saveFlow, setFlowStatus } = useFlowMutations();

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(null);
  const [exitOnStageChange, setExitOnStageChange] = useState(true);
  const [reentry, setReentry] = useState<"once" | "allowed">("once");
  const [cooldownDays, setCooldownDays] = useState(7);
  const [dirty, setDirty] = useState(false);
  const [originalNodeIds, setOriginalNodeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [pendingInsert, setPendingInsert] = useState<{ parentId: string | null; branchKey: BranchKey } | null>(null);
  const [addType, setAddType] = useState<FlowNodeType | null>(null);
  const [editingNode, setEditingNode] = useState<FlowNode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeId: string; finalNodes: FlowNode[]; newEntryId: string | null; prunedLabels: string[] } | null>(null);
  const [confirmActiveEdit, setConfirmActiveEdit] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [showEntryDialog, setShowEntryDialog] = useState(false);

  useEffect(() => {
    if (!flow) return;
    setNodes(flow.nodes || []);
    setEntryNodeId(flow.entry_node_id ?? null);
    setExitOnStageChange(flow.exit_on_stage_change);
    setReentry(flow.reentry);
    setCooldownDays(Math.max(1, Math.round((flow.reentry_cooldown_hours ?? 168) / 24)));
    setOriginalNodeIds(new Set((flow.nodes || []).map((n) => n.id)));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow?.id, flow?.updated_at]);

  const { data: stage } = useQuery({
    queryKey: ["flow-stage", flow?.stage_id],
    enabled: !!flow?.stage_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_pipeline_stages").select("id, name").eq("id", flow!.stage_id).maybeSingle();
      return data;
    },
  });

  const v1Conflict = useMemo(
    () => !!flowsList?.find((f) => f.id === id)?.v1_conflict,
    [flowsList, id],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const summaryFor = (node: FlowNode): string => {
    switch (node.type) {
      case "delay":
        return `Esperar ${minutesToLabel(Number(node.config.minutes) || 0)}`;
      case "branch": {
        const rules = ((node.config.rules as BranchRule[] | undefined) || []);
        const sep = node.config.logic === "or" ? " OU " : " E ";
        return rules
          .map((r) => `${branchFieldDef(r.field)?.label || r.field} ${OPERATOR_LABELS[r.operator] || r.operator}${r.value !== undefined && r.value !== null && r.value !== "" ? ` ${r.value}` : ""}`)
          .join(sep) || "sem condições";
      }
      case "send_whatsapp": {
        const content = typeof node.config.content === "string" ? node.config.content : "";
        const extras: string[] = [];
        if (node.config.media_type) extras.push(String(node.config.media_type));
        if (node.config.agent_id) extras.push("agente IA");
        if (node.config.ai_rewrite_enabled) extras.push("reescrita IA");
        return `${content.slice(0, 50) || "(sem texto)"}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
      }
      case "close_lead":
        return node.config.outcome === "lost" ? "Marcar como perdido" : "Marcar como ganho";
      default:
        return "";
    }
  };

  const openAddMenu = (parentId: string | null, branchKey: BranchKey, type: FlowNodeType) => {
    // close_lead é terminal: só pode ser inserido no FIM de um ramo
    const parent = parentId ? byId.get(parentId) : null;
    const currentTarget = parentId === null ? entryNodeId : (parent ? parent[branchKey] : null);
    if (type === "close_lead" && currentTarget !== null) {
      toast({ variant: "destructive", title: "Passo terminal", description: '"Fechar lead" encerra o fluxo — adicione-o no fim de um ramo.' });
      return;
    }
    setPendingInsert({ parentId, branchKey });
    setAddType(type);
  };

  const handleCreateNode = (config: Record<string, unknown>) => {
    if (!pendingInsert || !addType) return;
    setDirty(true);
    const nid = newNodeId();
    const { parentId, branchKey } = pendingInsert;
    const newNode: FlowNode = { id: nid, type: addType, config, next: null, next_false: null };
    if (parentId === null) {
      newNode.next = addType === "close_lead" ? null : entryNodeId;
      setEntryNodeId(nid);
      setNodes((prev) => [...prev, newNode]);
    } else {
      setNodes((prev) => {
        const parent = prev.find((n) => n.id === parentId);
        const currentTarget = parent ? parent[branchKey] ?? null : null;
        newNode.next = addType === "close_lead" ? null : currentTarget;
        return [...prev.map((n) => (n.id === parentId ? { ...n, [branchKey]: nid } : n)), newNode];
      });
    }
    setPendingInsert(null);
    setAddType(null);
  };

  const handleEditSave = (config: Record<string, unknown>) => {
    if (!editingNode) return;
    setNodes((prev) => prev.map((n) => (n.id === editingNode.id ? { ...n, config } : n)));
    setEditingNode(null);
    setDirty(true);
  };

  const requestDeleteNode = (nodeId: string) => {
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const fallback = target.next ?? null;
    const repointed = nodes
      .map((n) => {
        const patch: Partial<FlowNode> = {};
        if (n.next === nodeId) patch.next = fallback;
        if (n.next_false === nodeId) patch.next_false = fallback;
        return Object.keys(patch).length ? { ...n, ...patch } : n;
      })
      .filter((n) => n.id !== nodeId);
    const newEntryId = entryNodeId === nodeId ? fallback : entryNodeId;
    const prunedIds = computePruned(repointed, newEntryId);
    const finalNodes = repointed.filter((n) => !prunedIds.includes(n.id));
    if (prunedIds.length > 0) {
      const prunedLabels = prunedIds.map((pid) => {
        const n = nodes.find((x) => x.id === pid);
        return n ? NODE_LABELS[n.type] : pid;
      });
      setConfirmDelete({ nodeId, finalNodes, newEntryId, prunedLabels });
    } else {
      setNodes(finalNodes);
      setEntryNodeId(newEntryId);
      setDirty(true);
    }
  };

  const doSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await saveFlow.mutateAsync({
        id,
        patch: {
          nodes,
          entry_node_id: entryNodeId,
          exit_on_stage_change: exitOnStageChange,
          reentry,
          reentry_cooldown_hours: Math.max(1, Math.round(cooldownDays * 24)),
        },
      });
      toast({ title: "Fluxo salvo" });
      setConfirmActiveEdit(false);
      setDirty(false);
      await refetch();
    } catch (e) {
      // A mensagem do banco (ciclo, config faltando) É a mensagem útil — nunca mascarar
      toast({ variant: "destructive", title: "Erro ao salvar fluxo", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    const currentIds = new Set(nodes.map((n) => n.id));
    const deletedSomething = [...originalNodeIds].some((oid) => !currentIds.has(oid));
    if (flow?.status === "active" && deletedSomething) {
      setConfirmActiveEdit(true);
      return;
    }
    doSave();
  };

  const doSetStatus = async (status: "active" | "paused" | "archived") => {
    if (!id) return;
    try {
      await setFlowStatus.mutateAsync({ id, status });
      toast({ title: status === "active" ? "Fluxo ativado" : status === "paused" ? "Fluxo pausado" : "Fluxo arquivado" });
      await refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Erro", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleActivateClick = () => {
    if (dirty) {
      toast({ variant: "destructive", title: "Alterações não salvas", description: 'Clique em "Salvar" antes de ativar.' });
      return;
    }
    if (nodes.length === 0 || !entryNodeId) {
      toast({ variant: "destructive", title: "Fluxo vazio", description: "Adicione ao menos um passo antes de ativar." });
      return;
    }
    setConfirmActivate(true);
  };

  const AddButton = ({ parentId, branchKey }: { parentId: string | null; branchKey: BranchKey }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-7 h-7 rounded-full border border-dashed border-border/60 hover:border-primary hover:text-primary flex items-center justify-center text-muted-foreground transition-colors my-1"
          aria-label="Adicionar passo"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {ADD_MENU.map((item) => (
          <DropdownMenuItem key={item.type} onClick={() => openAddMenu(parentId, branchKey, item.type)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderChain = (
    startId: string | null,
    renderedIds: Set<string>,
    parentForInsert: string | null,
    branchKeyForInsert: BranchKey,
  ): JSX.Element => {
    const items: JSX.Element[] = [];
    items.push(<AddButton key={`add-${parentForInsert}-${branchKeyForInsert}-head`} parentId={parentForInsert} branchKey={branchKeyForInsert} />);

    let currentId = startId;
    while (currentId) {
      if (renderedIds.has(currentId)) {
        const n = byId.get(currentId);
        items.push(
          <div key={`ref-${currentId}`} className="text-[11px] text-muted-foreground italic border border-dashed border-border/50 rounded-md px-3 py-1.5">
            continua em "{n ? NODE_LABELS[n.type] : currentId}"
          </div>,
        );
        break;
      }
      const node = byId.get(currentId);
      if (!node) break;
      renderedIds.add(currentId);

      items.push(
        <FlowNodeCard
          key={node.id}
          node={node}
          summary={summaryFor(node)}
          onEdit={() => setEditingNode(node)}
          onDelete={() => requestDeleteNode(node.id)}
        />,
      );

      if (node.type === "branch") {
        items.push(
          <div key={`branches-${node.id}`} className="flex gap-8 items-start justify-center w-full">
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Sim</Badge>
              {renderChain(node.next ?? null, renderedIds, node.id, "next")}
            </div>
            <div className="flex-1 flex flex-col items-center min-w-0">
              <Badge variant="secondary" className="text-[10px] mb-1">Não</Badge>
              {renderChain(node.next_false ?? null, renderedIds, node.id, "next_false")}
            </div>
          </div>,
        );
        currentId = null;
      } else if (node.type === "close_lead") {
        items.push(
          <div key={`end-${node.id}`} className="text-[11px] text-muted-foreground border border-border/50 rounded-full px-3 py-1">
            fim do fluxo
          </div>,
        );
        currentId = null;
      } else {
        items.push(<AddButton key={`add-${node.id}`} parentId={node.id} branchKey="next" />);
        currentId = node.next ?? null;
      }
    }
    return <div className="flex flex-col items-center gap-1.5">{items}</div>;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
        <Skeleton className="h-24 w-full max-w-md mx-auto" />
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p>Fluxo não encontrado.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate("/crm/settings/flows")}>Voltar</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/crm/settings/flows")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{flow.name}</h1>
              <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[flow.status]}</Badge>
              {v1Conflict && flow.status === "active" && (
                <span title="Esta etapa também tem régua v1 ativa — os dois motores disparam.">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Etapa-gatilho: {stage?.name || "…"}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSaveClick} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
          {flow.status !== "active" && flow.status !== "archived" && (
            <Button size="sm" className="gap-1.5" onClick={handleActivateClick}>
              <Play className="h-3.5 w-3.5" /> Ativar
            </Button>
          )}
          {flow.status === "active" && (
            <Button size="sm" variant="outline" className="gap-1.5 text-warning" onClick={() => doSetStatus("paused")}>
              <Pause className="h-3.5 w-3.5" /> Pausar
            </Button>
          )}
          {flow.status !== "archived" && flow.status !== "draft" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => doSetStatus("archived")}>
              <Archive className="h-3.5 w-3.5" /> Arquivar
            </Button>
          )}
        </div>
      </div>

      <Card className="max-w-md mx-auto border-primary/30 bg-primary/[0.03]">
        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrada</p>
            <p className="text-sm font-medium truncate">Lead entra em "{stage?.name || "…"}"</p>
            <p className="text-[11px] text-muted-foreground">
              {exitOnStageChange ? "Sai do fluxo ao trocar de etapa" : "Continua mesmo trocando de etapa"}
              {" · "}
              {reentry === "once" ? "uma vez por lead" : `pode reentrar após ${cooldownDays}d`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowEntryDialog(true)}>Editar</Button>
        </CardContent>
      </Card>

      <div className="overflow-x-auto pt-2">
        <div className="flex justify-center min-w-fit px-4">
          {renderChain(entryNodeId, new Set(), null, "next")}
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <GitBranch className="h-10 w-10 mb-2 opacity-30" />
          <p className="text-sm">Clique no "+" acima para adicionar o primeiro passo</p>
        </div>
      )}

      <FlowNodeConfigDialog
        open={!!addType}
        onOpenChange={(o) => { if (!o) { setAddType(null); setPendingInsert(null); } }}
        type={addType}
        initialConfig={addType === "delay" ? { minutes: 60 } : addType === "branch" ? { logic: "and", rules: [] } : {}}
        onSave={handleCreateNode}
        workspaceId={flow.workspace_id}
        companyId={flow.company_id}
      />
      <FlowNodeConfigDialog
        open={!!editingNode}
        onOpenChange={(o) => { if (!o) setEditingNode(null); }}
        type={editingNode?.type ?? null}
        initialConfig={editingNode?.config ?? {}}
        onSave={handleEditSave}
        workspaceId={flow.workspace_id}
        companyId={flow.company_id}
      />

      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Entrada do fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs">Encerrar ao sair da etapa</Label>
                <p className="text-[11px] text-muted-foreground">
                  Se o lead trocar de etapa no meio do fluxo, as mensagens restantes são canceladas.
                </p>
              </div>
              <Switch checked={exitOnStageChange} onCheckedChange={(v) => { setExitOnStageChange(v); setDirty(true); }} />
            </div>
            <Select value={reentry} onValueChange={(v) => { setReentry(v as "once" | "allowed"); setDirty(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Uma vez por lead</SelectItem>
                <SelectItem value="allowed">Pode entrar de novo</SelectItem>
              </SelectContent>
            </Select>
            {reentry === "allowed" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Intervalo mínimo antes de reentrar</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={1} className="w-24"
                    value={cooldownDays}
                    onChange={(e) => { setCooldownDays(Math.max(1, Number(e.target.value))); setDirty(true); }}
                  />
                  <span className="text-sm text-muted-foreground">dia(s)</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Evita que um lead que oscila entre etapas receba as mesmas mensagens repetidamente.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowEntryDialog(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este passo?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso também removerá {confirmDelete?.prunedLabels.length} passo(s) que só existiam a partir daqui: {confirmDelete?.prunedLabels.join(", ")}. Essa parte do fluxo será perdida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (!confirmDelete) return;
                setNodes(confirmDelete.finalNodes);
                setEntryNodeId(confirmDelete.newEntryId);
                setConfirmDelete(null);
                setDirty(true);
              }}
            >
              Excluir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmActiveEdit} onOpenChange={(o) => !o && setConfirmActiveEdit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este fluxo está ativo</AlertDialogTitle>
            <AlertDialogDescription>
              Você removeu passo(s) de um fluxo em execução. Leads parados exatamente nesses passos serão movidos para o passo seguinte (ou encerrados, se não houver). Deseja salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={doSave}>
              {saving ? "Salvando..." : "Salvar mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmActivate} onOpenChange={(o) => !o && setConfirmActivate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar "{flow.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads que entrarem na etapa "{stage?.name}" a partir de agora serão inscritos no fluxo. Quem já está na etapa NÃO é inscrito retroativamente.
              {v1Conflict && (
                <>
                  {" "}Atenção: esta etapa também tem uma régua v1 ativa — os dois disparam. Recomendado desativar a régua v1 desta etapa.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmActivate(false); doSetStatus("active"); }}>
              Ativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Rota em `src/App.tsx`** — junto do lazy da Task 3:

```typescript
const CRMFlowBuilder = lazyRetry(() => import("./pages/CRMFlowBuilder"));
```

E logo após a rota `crm/settings/flows`:

```tsx
<Route path="crm/settings/flows/:id" element={<Suspense fallback={<PageLoader />}><CRMFlowBuilder /></Suspense>} />
```

- [ ] **Step 3: Verificar manualmente com `npm run dev`**

1. Criar fluxo pela lista → builder abre vazio com card de entrada.
2. Adicionar espera → condição → nos ramos Sim/Não adicionar mensagem WhatsApp e fechar lead (perda com motivo) → Salvar → toast "Fluxo salvo".
3. Tentar adicionar "Fechar lead" no MEIO de um ramo → toast de passo terminal.
4. Ativar com alteração pendente → toast bloqueando; salvar e Ativar → diálogo de confirmação (com aviso v1 se aplicável) → status Ativo.
5. Excluir a condição → AlertDialog listando os passos podados.
6. Forçar um erro do banco (ex.: editar espera para 0 via devtools não dá — em vez disso, confirmar que salvar um fluxo válido funciona e que a mensagem de erro de validação aparece ao ativar um fluxo cujo grafo o banco rejeite, se ocorrer).

Run: `npx eslint src/pages/CRMFlowBuilder.tsx src/App.tsx` → limpo/sem novos; `npx tsc --noEmit` → sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CRMFlowBuilder.tsx src/App.tsx
git commit -m "Fluxos v2: builder visual com cadeia de nos, ramificacao e guardas de ativacao

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Verificação final, CLAUDE.md, push + prompt Lovable

**Files:**
- Modify: `CLAUDE.md` (item 18 da seção Business Domain)

- [ ] **Step 1: Build de produção**

Run: `npm run build`
Expected: build conclui sem erros. Se o bundle do builder for reclamado por tamanho, ignorar (sem TipTap ainda; lazy route já divide o chunk).

- [ ] **Step 2: Lint dos arquivos da fase**

Run: `npx eslint src/lib/flows.ts src/hooks/useFlows.ts src/pages/CRMFlows.tsx src/pages/CRMFlowBuilder.tsx src/components/crm/flows/`
Expected: limpo.

- [ ] **Step 3: Atualizar o item 18 do `CLAUDE.md`** — acrescentar ao final do item "CRM Flows v2 (motor)":

```markdown
    - **Builder (Fase 2)**: lista em `/crm/settings/flows` (`CRMFlows.tsx`) e builder em `/crm/settings/flows/:id` (`CRMFlowBuilder.tsx`); componentes em `src/components/crm/flows/`; contrato do grafo em `src/lib/flows.ts` (BRANCH_FIELDS espelha conditions.ts do worker); dados via `src/hooks/useFlows.ts` (`from("crm_flows" as any)` — tabela fora do types.ts gerado). `close_lead` é terminal na UI; agente IA do nó WhatsApp lista só agentes do workspace do fluxo; erro de validação do banco aparece no toast tal como veio.
```

- [ ] **Step 4: Commit, push e prompt do Lovable**

```bash
git add CLAUDE.md
git commit -m "Fluxos v2: documentar o builder no CLAUDE.md

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git pull --no-rebase && git push origin main
```

Entregar ao usuário o prompt para o editor Lovable:

> Faça o build/deploy do frontend com as mudanças da main (novas páginas `/crm/settings/flows` e `/crm/settings/flows/:id` — Fluxos v2). Não há migrations nem edge functions novas neste push.

**Checklist manual pós-deploy** (usuário, em produção): criar um fluxo de teste numa etapa sem régua v1 → espera 1 min → WhatsApp com áudio → condição "respondeu desde a entrada" → fechar lead; ativar; mover um card com telefone real; conferir mensagem/áudio chegando e o card fechando conforme o ramo.

---

## Self-review (executado na escrita do plano)

- **Cobertura do spec (Fase 2)**: §5.1 lista → Task 3; §5.2 builder → Task 6; §5.3 guardas (dirty, prune, fluxo ativo, ativação não-retroativa, erro do banco verbatim, AlertDialog) → Task 6; §4.1–§4.3/§4.5 config dos nós → Tasks 4–5; aviso v1×v2 → Tasks 3 e 6; agente por workspace → Task 5. Fora da fase (correto): §5.4 WYSIWYG (Fase 3), §5.5 métricas/drawer (Fase 4).
- **Placeholders**: nenhum TBD; o único stub (case send_whatsapp da Task 4) é deliberado, contrato definitivo e substituído na Task 5.
- **Consistência de tipos**: `FlowNodeConfigDialog` props idênticas nas Tasks 4/5/6; `BranchRule.value?: unknown` compatível com o editor; `useFlowMutations` consumido na lista (create/duplicate/setStatus) e no builder (save/setStatus); `computePruned(nodes, entryId)` mesma assinatura na lib e no builder.
