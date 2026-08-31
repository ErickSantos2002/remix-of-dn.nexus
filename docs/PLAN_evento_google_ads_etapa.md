# Plano — Evento Google Ads por etapa do pipeline (Enhanced Conversions for Leads)

> Documento de planejamento para implementação futura. Nenhum código desta feature foi implementado ainda.

## Contexto

Na rota `/crm/settings/pipeline`, o modal "Editar Estágio" já tem a seção **"Evento Meta Ads"**: o usuário escolhe um evento por etapa e, quando um lead muda de `stage_id`, um trigger no banco chama a edge function `meta-conversions-api` que envia a conversão server-side (Conversions API da Meta) com e-mail/telefone hasheados + o `value` do lead.

O objetivo é uma seção equivalente **"Evento Google Ads"** para disparar uma conversão (com valor) ao entrar numa etapa.

**Descoberta arquitetural decisiva:** o Google Ads **não** tem um endpoint simples estilo pixel/CAPI. O formato `AW-XXXXXXXXX/LABEL` (usado no widget de agendamento) só funciona no `gtag.js` **dentro do navegador de quem clicou no anúncio**. Uma mudança de etapa no CRM é server-side / no navegador do vendedor — gtag ali atribuiria o vendedor, não o lead. Confirmado que **não existe nenhuma integração Google Ads server-side hoje** (só o gtag client-side do widget; o único helper `_shared/googleCredentials.ts` é do Google Calendar).

**Decisão:** implementar via **Enhanced Conversions for Leads (ECL)** através da **Google Ads API** — casa a conversão ao clique usando e-mail/telefone hasheados (os mesmos dados que já hasheamos para o Meta), sem depender de `gclid`, cobrindo leads de qualquer origem (WhatsApp, manual). As credenciais (developer token + OAuth) ainda precisam ser obtidas, então o código será construído completo e ficará **inerte** até as credenciais serem preenchidas (mesmo comportamento do `meta-conversions-api`, que aborta com 400 sem token).

## Pré-requisitos externos (fora do código)

Necessários para o disparo funcionar de fato (o código não depende deles para ser mergeado):
1. **Developer token** da Google Ads API (API Center do MCC) — aprovação do Google pode levar dias.
2. **Cliente OAuth2** (Google Cloud Console) com escopo `https://www.googleapis.com/auth/adwords` → obter **refresh token** da conta de anúncios.
3. **Customer ID** da conta (e `login-customer-id` do MCC, se aplicável).
4. No Google Ads: **aceitar os termos de dados do cliente** e habilitar **Enhanced Conversions for Leads**; criar as **conversion actions** (tipo lead) que serão referenciadas por etapa.

## Arquitetura (espelha o Meta, com trigger independente)

```
Lead muda de stage_id
  → trigger trg_google_ads_conversion_on_stage_change (crm_leads)
    → lê google_ads_conversion_action_id da nova etapa (crm_pipeline_stages)
      → se preenchido: net.http_post → edge function google-ads-conversions
        → resolve workspace → company → credenciais Google Ads (decripta)
        → busca contato (email/phone), hash SHA-256 (email lowercase; phone E.164 +55)
        → troca refresh_token por access_token (oauth2.googleapis.com/token)
        → POST googleads.googleapis.com/v{N}/customers/{cid}:uploadClickConversions
           (userIdentifiers hashed + conversionValue + currencyCode BRL + orderId dedup)
        → registra em google_ads_conversion_events
```

Meta e Google Ads ficam **independentes por etapa** (trigger separado): uma etapa pode ter só Meta, só Google, ambos ou nenhum.

## Implementação

### 1. Migration (nova em `supabase/migrations/`)

- **`crm_pipeline_stages`**: `ADD COLUMN IF NOT EXISTS google_ads_conversion_action_id TEXT` (null = desligado, igual ao padrão `meta_event_name` null = off).
- **`companies`** (padrão de credencial multi-tenant, AES-GCM com `company_id` como passphrase — ver `src/lib/crypto.ts` e `decryptToken` em `meta-conversions-api/index.ts`):
  - `google_ads_developer_token TEXT` (encriptado)
  - `google_ads_client_id TEXT` (plain — segue `google_client_id` do Calendar)
  - `google_ads_client_secret TEXT` (encriptado)
  - `google_ads_refresh_token TEXT` (encriptado)
  - `google_ads_customer_id TEXT` (plain — só dígitos)
  - `google_ads_login_customer_id TEXT` (plain, opcional/MCC)
  - `has_google_ads_credentials BOOLEAN GENERATED ALWAYS AS (google_ads_developer_token IS NOT NULL AND google_ads_refresh_token IS NOT NULL AND google_ads_customer_id IS NOT NULL) STORED` (espelha `has_meta_access_token`)
- **Tabela de log** `google_ads_conversion_events` (espelha `meta_capi_events`): `id`, `crm_lead_id`, `contact_id`, `workspace_id`, `conversion_action_id`, `user_identifiers jsonb`, `value numeric`, `currency text`, `order_id text`, `response_status int`, `response_body text`, `created_at`. + RLS (SELECT admin/super_admin + membros do workspace, conforme convenção do projeto).
- **Trigger** `notify_google_ads_conversion_on_stage_change()` + `CREATE TRIGGER trg_google_ads_conversion_on_stage_change AFTER UPDATE OF stage_id ON crm_leads FOR EACH ROW ...` — modelar em `supabase/migrations/20260518203327_*.sql` (função Meta atual). Skip se `google_ads_conversion_action_id` nulo/vazio. Payload: `{ crm_lead_id, conversion_action_id, workspace_id, custom_data: { value: NEW.value } }`. Usa `net.http_post` (pg_net já habilitado pelo trigger do Meta).
  - **Atenção (dívida herdada):** o trigger do Meta tem o JWT anon hardcoded no SQL. Espelhar o padrão existente, mas registrar como ponto de segurança a revisar.

### 2. Edge function `supabase/functions/google-ads-conversions/index.ts` (nova)

Modelar em `supabase/functions/meta-conversions-api/index.ts` (reusar `decryptToken`, `sha256Hash`, resolução workspace→company, exclusão de e-mails `@dnia.ai`, log de evento). Diferenças:
- Buscar credenciais Google Ads da `companies` e decriptar (developer_token, client_secret, refresh_token).
- `getAccessToken(refreshToken, clientId, clientSecret)` → `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`).
- Montar `userIdentifiers`: `[{ hashedEmail }, { hashedPhoneNumber }]` (SHA-256; email `.toLowerCase().trim()`; phone dígitos → E.164 `+55...`).
- `conversionAction`: `customers/{customer_id}/conversionActions/{conversion_action_id}` (ID vem do payload por etapa).
- `conversionDateTime` no formato exigido `yyyy-MM-dd HH:mm:ss+00:00`.
- `orderId` = `${crm_lead_id}:${conversion_action_id}` (dedup — conta 1x por lead por ação; espelha a lógica de `transaction_id` do widget).
- `POST https://googleads.googleapis.com/v{N}/customers/{customer_id}:uploadClickConversions` com headers `Authorization: Bearer {access_token}`, `developer-token`, `login-customer-id` (se houver), `partialFailure: true`.
- Abortar com 400 (como o Meta) se faltar `has_google_ads_credentials` → mantém tudo inerte até o usuário configurar.
- Registrar em `supabase/config.toml` com `verify_jwt = false` (padrão do projeto).
- **Confirmar a versão atual da Google Ads API** (`v{N}`, ex.: v21) na doc oficial/Context7 no momento da implementação.

### 3. Frontend — seção "Evento Google Ads" no modal

`src/pages/CRMPipelineSettings.tsx` (espelhar a seção Meta Ads, linhas ~545-588):
- `interface Stage`: adicionar `google_ads_conversion_action_id: string | null`.
- `formData`: adicionar `google_ads_conversion_action_id: ""` (e resetar em `saveStage.onSuccess`, `openNewDialog`, `openEditDialog`).
- `saveStage.stageData`: incluir `google_ads_conversion_action_id: formData.google_ads_conversion_action_id.trim() || null`.
- Nova seção UI (após a seção Meta, `border-t pt-4`): Label "Evento Google Ads" + texto "Disparado para o Google Ads (Enhanced Conversions for Leads) toda vez que um card entrar nesta etapa."
  - **Núcleo:** `Input` de **ID da ação de conversão** com helper text de onde copiar (Google Ads → Metas → Conversões → ação → ID). Segue o padrão semântico do DS (sem cores diretas, sem emojis).
  - **Enhancement recomendado (melhor UX):** se a empresa tiver credenciais, popular um `Select` com as conversion actions reais (nome→ID) via uma action leve na edge function (`list_conversion_actions` chamando `GoogleAdsService.search` / `ListConversionActions`); fallback para o input manual. Manter o input manual como base garantida.

### 4. Frontend — card de credenciais Google Ads na empresa

`src/components/settings/` (novo `GoogleAdsSettingsCard.tsx`, espelhar `Api4comSettingsCard`/card do Meta) + montar em `CompanySettings.tsx`. Campos: developer token, customer id, login customer id (opcional), OAuth client id/secret, refresh token. Criptografar via `src/lib/crypto.ts` antes de salvar (padrão dos demais). Botão "Testar conexão" opcional (edge function de validação que faz um `uploadClickConversions` em modo validate-only ou um `search`).
- Escrita das credenciais restrita a Owner/Admin/SuperAdmin (convenção do projeto).

### 5. Tipos + deploy

- `src/integrations/supabase/types.ts` é **auto-gerado** — regenerar após a migration (via Lovable/Supabase), não editar à mão.
- **Deploy Lovable:** migrations + edge functions **não** sobem sozinhas. Ao final, fornecer prompt explícito para o usuário colar no editor Lovable: aplicar a nova migration **primeiro**, depois deploy da edge function `google-ads-conversions` (e da função de validação, se criada).

## Arquivos-chave

- `src/pages/CRMPipelineSettings.tsx` — modal + mutation (seção nova espelhando Meta ~545-588 / save ~246-260 / openEditDialog ~385-398).
- `supabase/functions/meta-conversions-api/index.ts` — molde da nova edge function (reusar helpers).
- `supabase/functions/google-ads-conversions/index.ts` — **novo**.
- `supabase/migrations/20260518203327_*.sql` e `20260518201838_*.sql` — molde do trigger.
- `supabase/config.toml` — registrar a(s) função(ões) nova(s).
- `src/components/settings/GoogleAdsSettingsCard.tsx` (**novo**) + `src/pages/CompanySettings.tsx`.
- `src/lib/crypto.ts` — criptografia das credenciais (frontend).

## Verificação (end-to-end)

1. **Migration:** `list_tables` / `execute_sql` confirmando as colunas em `crm_pipeline_stages`, `companies` e a tabela `google_ads_conversion_events`.
2. **UI config:** abrir "Editar Estágio", preencher o ID da ação de conversão, salvar, reabrir e confirmar persistência (igual ao teste manual do Meta).
3. **Credenciais:** salvar no card da empresa e confirmar que gravou encriptado (colunas `*_encrypted` não legíveis; `has_google_ads_credentials = true`).
4. **Disparo (após credenciais reais):** mover um lead (com email/telefone) para a etapa configurada → verificar linha em `google_ads_conversion_events` com `response_status` 200 e, no Google Ads (Metas → Conversões / diagnóstico de Enhanced Conversions), o recebimento. Sem credenciais, confirmar que a edge function retorna 400 e **não** quebra a mudança de etapa.
5. **Isolamento Meta:** confirmar que o disparo do Meta continua funcionando independentemente (uma etapa com ambos configurados dispara os dois).

## Fora de escopo / notas

- Não há entrada em `scripts/test-api.ts` / `openapi.yaml` (não é endpoint do `api-gateway`).
- O disparo real depende dos pré-requisitos externos (developer token etc.); até lá o sistema fica inerte por design.
- Reavaliar necessidade de sinais de consentimento (consent) exigidos pela Google Ads API no momento da implementação.
