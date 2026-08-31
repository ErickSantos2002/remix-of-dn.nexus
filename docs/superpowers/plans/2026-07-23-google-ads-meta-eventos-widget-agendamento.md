# Eventos multi-etapa (Google Ads + Meta) no widget de agendamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar paridade Meta ↔ Google Ads em 5 pontos do funil do widget de agendamento (`/schedule/:widgetId`): Cadastro/Lead, Lead Qualificado, Agendou, Fora do ICP e Já agendado — cada um com sua própria ação de conversão no Google Ads (label por etapa, configurável por widget) e evento correspondente no Meta.

**Architecture:** Nova coluna JSONB `google_ads_conversions` em `scheduling_widgets` (1 AW ID + 5 labels), exposta pelo GET do edge function `schedule-widget` e consumida pelo `PublicSchedule.tsx`, que dispara `fireGoogleAdsConversion` por etapa (com backward-compat para o label único da empresa) e adiciona eventos custom do Meta nos dois estados terminais.

**Tech Stack:** React 18 + TypeScript + Vite, Supabase (Postgres + Deno edge functions), gtag.js (`src/lib/googleAds.ts`), Meta Pixel (`window.fbq`).

## Global Constraints

- **Sem framework de testes** no projeto (não existem testes). Verificação = `npx eslint <arquivo>` (deve passar limpo) + `npx tsc --noEmit` filtrado pelo arquivo (sem erros no arquivo editado) + verificação de runtime no navegador via Tag Assistant. `npm run build` local **falha** por dependência ausente `@daily-co/daily-js` (pré-existente, ambiental) — **não** usar como gate; usar `tsc --noEmit` filtrado.
- **Lint gradual** (CLAUDE.md): corrigir erros de lint no arquivo editado antes de commitar. Prioridade `prefer-const` > `no-empty` > `no-explicit-any`.
- **Lovable**: migrations e edge functions **não** são auto-deployadas — exigem prompt para o usuário colar no editor Lovable (ver Task 6). Frontend (`src/`) é auto-deployado no push da `main`.
- **types.ts é auto-gerado** (não editar). O código não deve depender do `google_ads_conversions` estar nos tipos gerados: no frontend usar interfaces próprias (`WidgetInfo`, `SchedulingWidget` com campo **opcional**) e adicionar o campo ao payload de `update`/`insert` via **spread** (evita excess-property check); no edge function o client é `createClient<any>` (sem type-check).
- **Convenção de nomes de eventos Meta (fixos):** `"Fora do ICP"` e `"Reunião já agendada"`.
- **Chaves de etapa (JSONB):** `lead`, `qualified`, `scheduled`, `icp_blocked`, `already_scheduled`. AW account em `account`.
- **Idioma:** UI e textos em pt-BR.

---

### Task 1: Migration — coluna `google_ads_conversions`

**Files:**
- Create: `supabase/migrations/20260723190000_add_google_ads_conversions_to_scheduling_widgets.sql`

**Interfaces:**
- Produces: coluna `public.scheduling_widgets.google_ads_conversions JSONB` (nullable).

- [ ] **Step 1: Criar a migration**

Arquivo `supabase/migrations/20260723190000_add_google_ads_conversions_to_scheduling_widgets.sql`:

```sql
-- Conversões do Google Ads por etapa do funil, configuradas por widget.
-- Estrutura: { "account": "AW-XXXXXXXXX", "lead": "LABEL", "qualified": "LABEL",
--              "scheduled": "LABEL", "icp_blocked": "LABEL", "already_scheduled": "LABEL" }
-- Labels ausentes/nulos => aquela etapa não dispara conversão no Google Ads.
ALTER TABLE public.scheduling_widgets
  ADD COLUMN IF NOT EXISTS google_ads_conversions JSONB;

COMMENT ON COLUMN public.scheduling_widgets.google_ads_conversions IS
  'Google Ads conversion actions por etapa do funil (account AW-XXXX + labels lead/qualified/scheduled/icp_blocked/already_scheduled).';
```

- [ ] **Step 2: Verificar sintaxe SQL (revisão visual)**

Confirmar: `ADD COLUMN IF NOT EXISTS`, tipo `JSONB`, nullable (sem `NOT NULL`, sem default). Nenhuma mudança de RLS (as policies existentes de `scheduling_widgets` já cobrem a coluna).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260723190000_add_google_ads_conversions_to_scheduling_widgets.sql
git commit -m "feat(db): add google_ads_conversions JSONB to scheduling_widgets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Edge function — retornar `google_ads_conversions` no GET

**Files:**
- Modify: `supabase/functions/schedule-widget/index.ts` (bloco `widgetPayload`, ~:582-594)

**Interfaces:**
- Consumes: `widget` (linha do `select("*")` em `scheduling_widgets`), agora com `google_ads_conversions`.
- Produces: campo `google_ads_conversions` no JSON de resposta do GET (consumido pela Task 4).

- [ ] **Step 1: Adicionar o campo ao payload**

Em `supabase/functions/schedule-widget/index.ts`, no objeto `widgetPayload`, adicionar a última linha antes do `}`:

Antes:
```ts
        style: widget.style ?? null,
        google_ads_send_to: resolvedGoogleAdsSendTo,
      };
```

Depois:
```ts
        style: widget.style ?? null,
        google_ads_send_to: resolvedGoogleAdsSendTo,
        google_ads_conversions: widget.google_ads_conversions ?? null,
      };
```

- [ ] **Step 2: Lint do arquivo**

Run: `npx eslint supabase/functions/schedule-widget/index.ts`
Expected: sem novos erros (o client é `createClient<any>`, então `widget.google_ads_conversions` é `any` — sem erro de tipo).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/schedule-widget/index.ts
git commit -m "feat(schedule-widget): return google_ads_conversions in GET payload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: UI de configuração no modal do widget

**Files:**
- Modify: `src/pages/SchedulingWidgets.tsx` (interface :63-85; form state ~:114-119; `resetForm` ~:250-266; `openEdit` ~:269-296; `handleSave` ~:298-368; JSX após a seção ICP ~:775)

**Interfaces:**
- Produces: grava `scheduling_widgets.google_ads_conversions` (JSONB `{account, lead, qualified, scheduled, icp_blocked, already_scheduled}` ou `null`).

- [ ] **Step 1: Adicionar tipo e campo à interface `SchedulingWidget`**

Logo antes de `interface SchedulingWidget {` (~:63), adicionar:

```ts
interface GoogleAdsConversions {
  account?: string | null;
  lead?: string | null;
  qualified?: string | null;
  scheduled?: string | null;
  icp_blocked?: string | null;
  already_scheduled?: string | null;
}
```

E dentro de `interface SchedulingWidget`, após `style?: Partial<SchedulingStyle> | null;` (:84):

```ts
  google_ads_conversions?: GoogleAdsConversions | null;
```

(Campo **opcional** — mantém o cast `data as SchedulingWidget[]` válido enquanto os tipos gerados não têm a coluna.)

- [ ] **Step 2: Adicionar form state**

Após `const [formIcpBlockMsg, setFormIcpBlockMsg] = useState(DEFAULT_ICP_BLOCK_MSG);` (:119):

```ts
  const [formGadsAccount, setFormGadsAccount] = useState("");
  const [formGadsLabels, setFormGadsLabels] = useState({
    lead: "", qualified: "", scheduled: "", icp_blocked: "", already_scheduled: "",
  });
```

- [ ] **Step 3: Resetar no `resetForm`**

Após `setFormIcpBlockMsg(DEFAULT_ICP_BLOCK_MSG);` (:259):

```ts
    setFormGadsAccount("");
    setFormGadsLabels({ lead: "", qualified: "", scheduled: "", icp_blocked: "", already_scheduled: "" });
```

- [ ] **Step 4: Carregar no `openEdit`**

Após `setFormIcpBlockMsg(widget.icp_block_message || DEFAULT_ICP_BLOCK_MSG);` (:280):

```ts
    const conv = widget.google_ads_conversions ?? null;
    setFormGadsAccount(conv?.account || "");
    setFormGadsLabels({
      lead: conv?.lead || "",
      qualified: conv?.qualified || "",
      scheduled: conv?.scheduled || "",
      icp_blocked: conv?.icp_blocked || "",
      already_scheduled: conv?.already_scheduled || "",
    });
```

- [ ] **Step 5: Validar e montar o payload no `handleSave`**

Após o bloco de validação do ICP (`if (formIcpEnabled && ...) { ... }`, termina em :313), adicionar validação do AW ID:

```ts
    const gadsAccount = formGadsAccount.trim();
    if (gadsAccount && !/^AW-[A-Z0-9]+$/i.test(gadsAccount)) {
      toast({ variant: "destructive", title: "Conversion ID do Google Ads inválido (formato AW-XXXXXXXXX)." });
      return;
    }
    const hasAnyGadsLabel = Object.values(formGadsLabels).some((v) => v.trim());
    const google_ads_conversions = (gadsAccount && hasAnyGadsLabel)
      ? {
          account: gadsAccount,
          lead: formGadsLabels.lead.trim() || null,
          qualified: formGadsLabels.qualified.trim() || null,
          scheduled: formGadsLabels.scheduled.trim() || null,
          icp_blocked: formGadsLabels.icp_blocked.trim() || null,
          already_scheduled: formGadsLabels.already_scheduled.trim() || null,
        }
      : null;
    const trackingPayload = { google_ads_conversions };
```

Depois adicionar `...trackingPayload` aos dois literais. No `update` (:331-338):

```ts
      await supabase.from("scheduling_widgets").update({
        name: formName,
        title: formTitle.trim() || null,
        description: formDescription || null,
        duration_minutes: parseInt(formDuration),
        booking_window_days: windowDays,
        ...icpPayload,
        ...trackingPayload,
      }).eq("id", editing.id);
```

E no `insert` (:347-356):

```ts
      const { data, error } = await supabase.from("scheduling_widgets").insert({
        workspace_id: workspaceId,
        name: formName,
        title: formTitle.trim() || null,
        description: formDescription || null,
        duration_minutes: parseInt(formDuration),
        booking_window_days: windowDays,
        created_by: user?.id,
        ...icpPayload,
        ...trackingPayload,
      }).select("id").single();
```

(O `google_ads_conversions` entra por **spread** — evita erro de excess-property enquanto a coluna não está nos tipos gerados.)

- [ ] **Step 6: Adicionar a seção "Google Ads" no JSX**

Inserir uma nova `<section>` entre o fechamento da seção ICP (`</section>` em :775) e o comentário `{/* Seção: Mensagem de confirmação */}` (:777):

```tsx
            {/* Seção: Conversões do Google Ads */}
            <section className="space-y-4 border-t border-border pt-5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Conversões do Google Ads</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Uma ação de conversão (label) por etapa do funil. Deixe em branco as etapas que não quer rastrear.
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Conversion ID (AW-XXXXXXXXX)</Label>
                <Input
                  value={formGadsAccount}
                  onChange={e => setFormGadsAccount(e.target.value)}
                  placeholder="AW-18303781569"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {([
                  ["lead", "Cadastro / Lead (etapa 1)"],
                  ["qualified", "Lead Qualificado (etapa 2)"],
                  ["scheduled", "Agendou (etapa 3)"],
                  ["icp_blocked", "Fora do ICP"],
                  ["already_scheduled", "Já agendado"],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={formGadsLabels[key]}
                      onChange={e => setFormGadsLabels(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="Label da conversão"
                    />
                  </div>
                ))}
              </div>
            </section>
```

(Reusa `AlertTriangle`, `Label`, `Input` já importados no arquivo.)

- [ ] **Step 7: Lint + typecheck do arquivo**

Run: `npx eslint src/pages/SchedulingWidgets.tsx`
Expected: sem erros.

Run: `npx tsc --noEmit 2>&1 | Select-String -Pattern 'SchedulingWidgets' -SimpleMatch`
Expected: vazio (sem erros de tipo no arquivo).

- [ ] **Step 8: Commit**

```bash
git add src/pages/SchedulingWidgets.tsx
git commit -m "feat(scheduling-widgets): UI para configurar conversões Google Ads por etapa

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Disparo Google Ads por etapa no `PublicSchedule.tsx`

**Files:**
- Modify: `src/pages/PublicSchedule.tsx` (interface `WidgetInfo` :19-32; consts de módulo ~:80; helper após `userDataForPixel` :409-417; call sites :490-496, :594, :663-669)

**Interfaces:**
- Consumes: `widget.google_ads_conversions` (do GET, Task 2), `fireGoogleAdsConversion` (`src/lib/googleAds.ts`).
- Produces: helper `fireGadsStep(step, transactionId)` usado por esta task e pela Task 5.

- [ ] **Step 1: Adicionar tipo e campo à interface `WidgetInfo`**

Antes de `interface WidgetInfo {` (:19), adicionar:

```ts
interface GoogleAdsConversions {
  account?: string | null;
  lead?: string | null;
  qualified?: string | null;
  scheduled?: string | null;
  icp_blocked?: string | null;
  already_scheduled?: string | null;
}
```

Dentro de `WidgetInfo`, após `gtm_container_id?: string | null;` (:30):

```ts
  google_ads_conversions?: GoogleAdsConversions | null;
```

- [ ] **Step 2: Adicionar consts de módulo para o mapeamento legado**

Após a linha `const STEP_INDEX: ... ;` (:80), adicionar:

```ts
type GadsStep = "lead" | "qualified" | "scheduled" | "icp_blocked" | "already_scheduled";
// Backward-compat: sem config por-widget, só estas 2 etapas usavam o label único da empresa.
const GADS_LEGACY_EVENT: Partial<Record<GadsStep, string>> = { lead: "sign_up", scheduled: "schedule" };
```

- [ ] **Step 3: Adicionar o helper `fireGadsStep`**

Logo após a função `userDataForPixel` (termina em :417), adicionar dentro do componente:

```ts
  // Dispara a conversão do Google Ads correspondente à etapa do funil.
  // Precedência: se o widget tem google_ads_conversions (account + label da etapa), usa esse label;
  // caso contrário, backward-compat com o label único da empresa (só para lead/scheduled).
  const fireGadsStep = (step: GadsStep, transactionId: string) => {
    const conv = widget?.google_ads_conversions;
    if (conv?.account) {
      const label = conv[step];
      if (label) {
        void fireGoogleAdsConversion({ sendTo: `${conv.account}/${label}`, eventName: step, transactionId });
      }
      return;
    }
    const legacyEvent = GADS_LEGACY_EVENT[step];
    if (legacyEvent && widget?.google_ads_send_to) {
      void fireGoogleAdsConversion({ sendTo: widget.google_ads_send_to, eventName: legacyEvent, transactionId });
    }
  };
```

- [ ] **Step 4: Trocar o disparo do `sign_up` (etapa 1)**

Em `handleSubmitBasic`, substituir o bloco (:490-496):

```ts
        if (widget?.google_ads_send_to) {
          void fireGoogleAdsConversion({
            sendTo: widget.google_ads_send_to,
            eventName: "sign_up",
            transactionId: `lead_${data.lead_id}`,
          });
        }
```

por:

```ts
        fireGadsStep("lead", `lead_${data.lead_id}`);
```

- [ ] **Step 5: Adicionar o disparo `qualified` (etapa 2)**

Em `handleSubmitQualify`, dentro do bloco `if (!shouldSkipMetaEvents(email))` do Google (após `pushDataLayer("qualified_lead", gParams);`, :594), adicionar:

```ts
        fireGadsStep("qualified", `qualified_${leadId}`);
```

- [ ] **Step 6: Trocar o disparo do `schedule` (etapa 3)**

Em `handleConfirm`, substituir o bloco (:663-669):

```ts
        if (widget?.google_ads_send_to) {
          void fireGoogleAdsConversion({
            sendTo: widget.google_ads_send_to,
            eventName: "schedule",
            transactionId: `schedule_${leadId}_${selectedDate}_${selectedTime}`,
          });
        }
```

por:

```ts
        fireGadsStep("scheduled", `schedule_${leadId}_${selectedDate}_${selectedTime}`);
```

- [ ] **Step 7: Lint + typecheck do arquivo**

Run: `npx eslint src/pages/PublicSchedule.tsx`
Expected: sem erros.

Run: `npx tsc --noEmit 2>&1 | Select-String -Pattern 'PublicSchedule' -SimpleMatch`
Expected: vazio.

- [ ] **Step 8: Commit**

```bash
git add src/pages/PublicSchedule.tsx
git commit -m "feat(schedule): conversões Google Ads por etapa (lead/qualified/scheduled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Eventos terminais (ICP bloqueado e já agendado) — Meta + Google Ads

**Files:**
- Modify: `src/pages/PublicSchedule.tsx` (helper após `fireGadsStep`; branches `icp_blocked`/`already_scheduled` em `handleSubmitQualify` :542-551 e `already_scheduled` em `handleConfirm` :635-640)

**Interfaces:**
- Consumes: `fireGadsStep` (Task 4), `userDataForPixel` (:409), `shouldSkipMetaEvents` (:82).
- Produces: helper `fireMetaCustom(eventName)`.

- [ ] **Step 1: Adicionar o helper `fireMetaCustom`**

Logo após `fireGadsStep` (Task 4, Step 3), adicionar:

```ts
  // Evento custom do Meta para estados terminais (respeita pixel configurado e skip interno).
  const fireMetaCustom = (eventName: string) => {
    if (typeof window === "undefined" || !window.fbq || !widget?.meta_pixel_id || shouldSkipMetaEvents(email)) return;
    const payload = { content_name: widget?.name, content_category: "agendamento", ...userDataForPixel() };
    try { window.fbq("trackCustom", eventName, payload); }
    catch (e) { console.error(`[MetaPixel] ${eventName} error`, e); }
  };
```

- [ ] **Step 2: Disparar no branch `icp_blocked` (handleSubmitQualify)**

No branch (:542-546), inserir as duas chamadas antes de `setStep("icp_blocked")`:

Antes:
```ts
        if (data?.icp_blocked) {
          setIcpBlockedMessage(data.error || "Lead fora do perfil desejado para esta agenda.");
          setStep("icp_blocked");
          return;
        }
```

Depois:
```ts
        if (data?.icp_blocked) {
          setIcpBlockedMessage(data.error || "Lead fora do perfil desejado para esta agenda.");
          fireMetaCustom("Fora do ICP");
          fireGadsStep("icp_blocked", `icpblock_${leadId}`);
          setStep("icp_blocked");
          return;
        }
```

- [ ] **Step 3: Disparar no branch `already_scheduled` (handleSubmitQualify)**

No branch (:547-551), inserir antes de `setStep("already_scheduled")`:

```ts
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
```

Resultado:
```ts
        if (data?.already_scheduled) {
          if (data.appointment) setExistingAppointment(data.appointment as ExistingAppointment);
          setExistingMessage(data.message || "Você já possui uma reunião agendada. Se precisar reagendar, fale com nosso time.");
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
          setStep("already_scheduled");
          return;
        }
```

- [ ] **Step 4: Disparar no branch `already_scheduled` (handleConfirm)**

No branch (:635-640), inserir antes de `setStep("already_scheduled")`, idêntico ao Step 3:

```ts
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
```

Resultado:
```ts
        if (data?.already_scheduled) {
          if (data.appointment) setExistingAppointment(data.appointment as ExistingAppointment);
          setExistingMessage(data.message || "Você já possui uma reunião agendada. Se precisar reagendar, fale com nosso time.");
          fireMetaCustom("Reunião já agendada");
          fireGadsStep("already_scheduled", `already_${leadId || contactId}`);
          setStep("already_scheduled");
          return;
        }
```

- [ ] **Step 5: Lint + typecheck do arquivo**

Run: `npx eslint src/pages/PublicSchedule.tsx`
Expected: sem erros.

Run: `npx tsc --noEmit 2>&1 | Select-String -Pattern 'PublicSchedule' -SimpleMatch`
Expected: vazio.

- [ ] **Step 6: Commit + push**

```bash
git add src/pages/PublicSchedule.tsx
git commit -m "feat(schedule): eventos terminais Meta+Google Ads (fora do ICP / já agendado)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git pull --no-edit && git push origin main
```

---

### Task 6: Deploy no Lovable + verificação end-to-end

**Files:** nenhum (deploy + verificação manual).

- [ ] **Step 1: Fornecer o prompt de deploy ao usuário**

Entregar ao usuário (colar no editor Lovable), com o hash do commit final:

```
Aplique a migration `20260723190000_add_google_ads_conversions_to_scheduling_widgets.sql`
e faça deploy da edge function `schedule-widget`.

Mudanças (commit <HASH>):
1. Nova coluna JSONB google_ads_conversions em scheduling_widgets.
2. schedule-widget (GET) passa a retornar google_ads_conversions no payload do widget.

O código já está no repositório GitHub. Regenere os tipos do Supabase após a migration.
```

- [ ] **Step 2: Confirmar a coluna e o GET (após deploy)**

Após o Lovable aplicar: no widget de teste, configurar no modal o Conversion ID (`AW-18303781569`) + 5 labels distintos e salvar. Confirmar via GET que o payload traz `google_ads_conversions` (ex.: abrir `/schedule/60f1bf47-…` e inspecionar `window.__nexusScheduleData` no console, ou a resposta do endpoint `schedule-widget`).

- [ ] **Step 3: Verificação end-to-end no Tag Assistant**

Abrir `/schedule/60f1bf47-86ea-45a4-902b-aea7a9ea7e8a` com Tag Assistant conectado e percorrer o funil:
- Etapa 1 → console `[GoogleAds] conversion HIT sent (lead)`; Tag Assistant: Conversão do label `lead`; Meta `Lead`/`CompleteRegistration`.
- Etapa 2 → `conversion HIT sent (qualified)`; label `qualified`; Meta `Leads Qualificados`.
- Etapa 3 → `conversion HIT sent (scheduled)`; label `scheduled`; Meta `Schedule`/`Agendamento`.
- Forçar lead fora do ICP → `conversion HIT sent (icp_blocked)`; label `icp_blocked`; Meta custom **"Fora do ICP"**.
- Lead com reunião existente → `conversion HIT sent (already_scheduled)`; label `already_scheduled`; Meta custom **"Reunião já agendada"**.
- Confirmar no Tag Assistant que os hits de **Conversão são distintos** (labels diferentes), não mais idênticos.

- [ ] **Step 4: Backward-compat (widget sem config)**

Confirmar que um widget **sem** `google_ads_conversions` mantém o comportamento anterior: etapa 1 e etapa 3 disparam a conversão com o label único da empresa (`google_ads_send_to`), etapa 2 e terminais não disparam Google Ads.

---

## Self-Review

**Spec coverage:**
- 5 conversões Google Ads distintas por widget → Tasks 1 (coluna), 3 (UI), 4 (lead/qualified/scheduled), 5 (icp_blocked/already_scheduled). ✔
- Meta custom nos terminais (paridade total) → Task 5. ✔
- Config por widget (AW ID + 5 labels) → Task 3. ✔
- Edge function retorna o campo → Task 2. ✔
- Backward-compat + chat fora de escopo → Task 4 (helper) + Task 6 Step 4. ✔
- Deploy Lovable (migration + edge fn) → Task 6. ✔

**Placeholder scan:** `<HASH>` na Task 6 é preenchido no momento do deploy (esperado). `LABEL`/`AW-XXXXXXXXX` são exemplos de UI/SQL. Sem TODOs pendentes.

**Type consistency:** `GoogleAdsConversions` (chaves `account, lead, qualified, scheduled, icp_blocked, already_scheduled`) idêntico em `SchedulingWidgets.tsx` e `PublicSchedule.tsx`. `fireGadsStep(step: GadsStep, transactionId: string)` e `fireMetaCustom(eventName: string)` usados consistentemente. Chaves JSONB batem entre UI (Task 3), helper (Task 4) e edge function (Task 2).
