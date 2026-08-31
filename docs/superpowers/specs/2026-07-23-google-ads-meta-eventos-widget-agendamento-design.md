# Eventos multi-etapa (Google Ads + Meta) no widget de agendamento

**Data:** 2026-07-23
**Rota alvo:** `/schedule/:widgetId` (`src/pages/PublicSchedule.tsx`)

## Contexto / Problema

Após corrigir o envio dos hits de conversão do Google Ads (commit `799abfce`), todas as
conversões chegam ao Tag Assistant como uma única "Conversão" genérica — porque etapa 1
(`sign_up`) e etapa 3 (`schedule`) disparam o **mesmo** label (`AW-18303781569/TW6cCPLtqtIcEMGV9pdE`).

No Google Ads, diferente do Meta, cada "tipo de evento" é uma **ação de conversão separada** com
seu **próprio label** (`AW-CONVERSION_ID/LABEL`) — não existe nome de evento que diferencie dentro
do mesmo label. Para ter Lead / Qualificado / Agendou / etc. como conversões distintas, é preciso
uma ação (label) por etapa.

O objetivo é dar **paridade Meta ↔ Google Ads** em 5 pontos do funil do widget de agendamento,
incluindo os dois estados terminais que hoje não disparam nada.

## Mapa de eventos (estado final desejado)

| # | Chave | Ponto no fluxo (`PublicSchedule.tsx`) | Meta | Google Ads |
|---|-------|----------------------------------------|------|------------|
| 1 | `lead` | `handleSubmitBasic` (~:473-505) | `Lead` + `CompleteRegistration` (já existe) | label `lead` |
| 2 | `qualified` | `handleSubmitQualify` (~:557-595) | `Leads Qualificados` (já existe) | label `qualified` **(novo)** |
| 3 | `scheduled` | `handleConfirm` (~:644-679) | `Schedule` + `Agendamento` (já existe) | label `scheduled` |
| 4 | `icp_blocked` | `handleSubmitQualify` `data.icp_blocked` (:542) | custom **"Fora do ICP"** (novo) | label `icp_blocked` **(novo)** |
| 5 | `already_scheduled` | `handleSubmitQualify` (:547) **e** `handleConfirm` (:635) | custom **"Reunião já agendada"** (novo) | label `already_scheduled` **(novo)** |

Decisões do usuário: paridade total (ICP também no Meta); nomes de eventos Meta fixos no código;
1 AW ID único por widget + 5 labels.

## Modelo de dados

Nova coluna **JSONB `google_ads_conversions`** em `scheduling_widgets` (default `NULL`):

```json
{
  "account": "AW-18303781569",
  "lead": "LABEL1",
  "qualified": "LABEL2",
  "scheduled": "LABEL3",
  "icp_blocked": "LABEL4",
  "already_scheduled": "LABEL5"
}
```

- `account` = Conversion ID do Google Ads (`AW-XXXXXXXXX`), sem label.
- Cada chave de etapa guarda apenas o **label**; `send_to` é montado como `account + "/" + label`.
- Label vazio/ausente ⇒ aquele evento **não** dispara Google Ads (opcional e gracioso).
- Migration requer prompt de deploy no Lovable (migrations não são auto-deployadas).

## UI de configuração (por widget)

Nova seção **"Google Ads"** no modal de `src/pages/SchedulingWidgets.tsx`, seguindo o padrão dos
campos ICP existentes:

- 1 input: **Conversion ID** (`AW-…`), validação `^AW-[A-Z0-9]+$` (case-insensitive).
- 5 inputs de **label**, rotulados: Cadastro (`lead`), Qualificado (`qualified`), Agendou
  (`scheduled`), Fora do ICP (`icp_blocked`), Já agendado (`already_scheduled`).
  Validação de label: `^[A-Za-z0-9_-]+$` (quando preenchido).
- Estado de formulário novo (ex.: `formGadsAccount`, `formGadsLabels`), carregado no editar
  (junto de `formIcpEnabled` etc., ~:276) e persistido no objeto de `update`/`insert`
  (`scheduling_widgets`, ~:318 e ~:347) como `google_ads_conversions`.
- Interface `SchedulingWidget` (:63) ganha o campo `google_ads_conversions`.

## Lógica de disparo (frontend — `PublicSchedule.tsx`)

**Google Ads.** Novo helper local que lê `widget.google_ads_conversions`, monta
`send_to = account + "/" + label` e chama `fireGoogleAdsConversion` (`src/lib/googleAds.ts`, já
existente) — só quando `account` e o `label` da etapa existem. Chamado nos 5 pontos.
`transaction_id` por etapa para deduplicação (ex.: `lead_<leadId>`, `qualified_<leadId>`,
`schedule_<leadId>_<date>_<time>`, `icpblock_<leadId>`, `already_<leadId|contactId>`).

**Meta (estados terminais novos).** Adicionar `fbq("trackCustom", "<nome fixo>", payload)`:
- `icp_blocked` → **"Fora do ICP"**
- `already_scheduled` → **"Reunião já agendada"**

Reaproveitar `userDataForPixel()` (:409) para o payload e respeitar o guard
`shouldSkipMetaEvents(email)` (:82) e `widget?.meta_pixel_id`, no mesmo padrão dos eventos custom
já existentes ("Leads Qualificados", "Agendamento"). Meta CAPI server-side dos terminais fica
**fora de escopo** (os eventos de etapa 2/3 já são client-side only; mantém consistência).

`WidgetInfo` (`PublicSchedule.tsx:19`) ganha o campo `google_ads_conversions`.

## Edge function

`supabase/functions/schedule-widget/index.ts` (GET): incluir `google_ads_conversions:
widget.google_ads_conversions ?? null` no `widgetPayload` (~:582-594). O widget já é lido com
`select("*")`, então o valor está disponível. Requer prompt de deploy no Lovable (edge function).

## Backward-compat

- Widget **sem** `google_ads_conversions` ⇒ mantém o comportamento atual (label único da empresa,
  `companies.google_ads_send_to`, em `sign_up` e `schedule`).
- Widget **com** `google_ads_conversions` ⇒ usa o mapa por-etapa; **não** dispara também o label da
  empresa (evita duplicidade). Precedência: config do widget sobrepõe a da empresa.
- Widgets de **chat** (`useWidgetChat.ts`, `WidgetChat.tsx`, `TypebotChat.tsx`) ficam **fora de
  escopo** — não têm etapas 4/5 e seguem usando `companies.google_ads_send_to`.

## Verificação

1. **Lint/build** do que for editado (regra de lint gradual; `googleAds.ts` já limpo).
2. **Migration + edge function**: aplicar via prompt no Lovable; confirmar coluna criada e GET
   retornando `google_ads_conversions`.
3. **End-to-end no Tag Assistant** (`/schedule/60f1bf47-…`, widget configurado com os 5 labels):
   - Etapa 1 → hit de conversão do label `lead`; Meta `Lead`/`CompleteRegistration`.
   - Etapa 2 → label `qualified`; Meta `Leads Qualificados`.
   - Etapa 3 → label `scheduled`; Meta `Schedule`/`Agendamento`.
   - Forçar não-ICP → label `icp_blocked`; Meta custom **"Fora do ICP"**.
   - Lead com reunião existente → label `already_scheduled`; Meta custom **"Reunião já agendada"**.
   - No Tag Assistant: hits de **Conversão distintos** (labels diferentes), não mais idênticos.
   - No console: `[GoogleAds] conversion HIT sent (<etapa>)` para cada etapa configurada.

## Fora de escopo

- Eventos GA4 nomeados (o GA4 `G-8XNNF8J4C5` é carregado pelo GTM; os pushes de dataLayer já
  existem para o GTM/GA4 consumir se configurado — não mexemos no container GTM, sem acesso).
- Meta CAPI server-side para os terminais.
- Widgets de chat.
- Nomes de eventos Meta configuráveis (ficaram fixos por decisão do usuário).
