# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow Rules

- O sistema roda dentro do **Lovable** em modo Cloud. Alteracoes no frontend sao feitas via Lovable.
- Usar o plugin **Context7** para consultar documentacao atualizada das ferramentas: **Lovable**, **Z-API**, **Daily.co**
- Quando uma alteracao estiver pronta para teste, fazer **push na branch main**
- **Verificacao de ortografia obrigatoria**: Ver `.claude/rules/spelling.mdc` para detalhes completos
- A referencia visual do Design System esta em `public/design_system/index.html` — consultar este arquivo para padroes de UI
- **Lint gradual**: Ao editar qualquer arquivo, corrigir os erros de lint existentes nesse arquivo antes de commitar. Prioridade: `prefer-const` > `no-empty` > `no-explicit-any`

### API Tests Sync Rule
- Ao criar ou modificar endpoints em `supabase/functions/api-gateway/`, atualizar `scripts/test-api.ts` com o teste correspondente
- Novos endpoints POST/PUT precisam de dados de teste + cleanup
- Novos endpoints GET precisam de chamada de teste na fase correta
- Novos endpoints DELETE precisam de entrada na lista de cleanup

## Development Commands

```bash
npm run dev        # Start dev server (Vite, port 8080, host "::")
npm run build      # Production build (vite build)
npm run build:dev  # Dev mode build (vite build --mode development)
npm run lint       # ESLint check
npm run preview    # Preview production build
```

No test framework is configured. No test files exist in the project.

## Architecture Overview

**Nexus AI** is a multi-tenant AI customer service platform with intelligent agents, CRM, WhatsApp integration, and knowledge management. Built with Lovable.dev.

**Stack**: React 18 + TypeScript + Vite (SWC) + Supabase + TanStack Query + shadcn/ui + Tailwind CSS

## Lovable Platform (Desenvolvimento e Hospedagem)

O Nexus AI usa **Lovable** (lovable.dev) como plataforma primaria de desenvolvimento e hospedagem em producao.

### Arquitetura da Plataforma

- **Lovable Cloud**: Ambiente de desenvolvimento visual no-code/low-code que opera sobre o repositorio Git. Alteracoes feitas no editor Lovable geram commits automaticos na branch `main`. O fluxo inverso tambem funciona: pushes feitos via CLI/IDE sao refletidos no editor Lovable.
- **Hospedagem**: O frontend e servido pelo Lovable Cloud em `https://nexus-ai-schema.lovable.app`. O deploy e automatico a cada push na `main` — nao ha pipeline CI/CD separado. O Lovable faz build e deploy internamente.
- **Backend (Supabase)**: O Lovable provisiona e gerencia a instancia Supabase (projeto `apbvnbubxyaihygnxdev`). As edge functions, migrations, RLS policies e realtime subscriptions rodam no Supabase Cloud gerenciado pelo Lovable. O `supabase/config.toml` configura o projeto localmente mas a instancia de producao e gerenciada pela plataforma.

### Build Pipeline do Lovable

```
Push na main → Lovable detecta → Vite build (producao) → Deploy automatico
                                → Supabase migrations aplicadas automaticamente
```

- **Bundler**: Vite com `@vitejs/plugin-react-swc` (SWC para compilacao rapida de JSX/TSX)
- **Lovable Tagger**: Plugin `lovable-tagger@^1.1.11` ativo apenas em dev mode (`mode === "development"`). Injeta atributos de rastreamento nos componentes para o editor visual mapear elementos da UI ao codigo-fonte.
- **Global shim**: `global: globalThis` definido no `vite.config.ts` para compatibilidade com bibliotecas Node.js que referenciam `global` (necessario no ambiente browser).

### Integracao Git ↔ Lovable

- **Bidirecional**: Lovable editor → commits automaticos na `main`; pushes externos na `main` → refletidos no editor
- **Branch de trabalho**: Sempre `main`. O Lovable nao suporta branches de feature nativamente — todo o fluxo e trunk-based.
- **Commits do Lovable**: Aparecem no historico como "Lovable update" ou similar
- **Commits via Claude Code/IDE**: Funcionam normalmente, o Lovable sincroniza na proxima abertura do editor

### Supabase Auth no Lovable

- `additional_redirect_urls` no `config.toml` inclui `https://lovable.dev` para permitir login via preview do Lovable
- JWT verification desabilitado em todas as edge functions (`verify_jwt = false`) — a seguranca e aplicada via RLS no banco

### Implicacoes para Desenvolvimento

- **Nao usar Vercel/Netlify** — o deploy e 100% via Lovable Cloud
- **Nao criar branches de feature** — trabalhar direto na `main` ou em branches temporarias com merge rapido
- **Edge functions**: Deployadas automaticamente pelo Supabase integrado ao Lovable. Para testar localmente, usar `supabase functions serve`
- **Variaveis de ambiente**: Gerenciadas no dashboard do Supabase (integrado ao Lovable), nao em `.env` local para producao
- **OG Images**: Apontam para `lovable.dev/opengraph-image-p98pqg.png` (hospedadas no CDN do Lovable)

### Frontend Structure

```
src/
  App.tsx              # Routing (React Router v6) with role-based protection
  main.tsx             # React 18 entry point
  contexts/            # CompanyContext, WorkspaceContext (multi-tenancy state)
  components/          # Feature-organized: agents/, chat/, crm/, layout/, auth/, ui/, effects/
  pages/               # ~38 route pages (Inbox, Agents, CRM, Knowledge, Settings, Admin)
  hooks/               # useUserRole, useAgentCategories, useAnalyticsData, usePersistedFilters,
                       # useActivityReminders, useMeetingsReport, useCohortAnalytics,
                       # useLeadAttributeSections, usePainsObjectionsReport, etc.
  integrations/        # Supabase client + auto-generated types (types.ts ~4000 lines)
  lib/routing/         # Só transferência manual + espelho puro da jornada/presença
                       # (a decisão de roteamento vive em _shared/routing/ no backend)
  lib/phone.ts         # Phone normalization (Brazilian format, 55 prefix)
  lib/crypto.ts        # AES-GCM + PBKDF2 encryption for tokens (Z-API, Api4com, etc.)
  lib/freeSlotOnNoShow.ts  # Unlink activity from appointment before delete (preserves audit trail)
  docs/                # DESIGN_SYSTEM.md, ANTI_BAN_PLAN.md
  types/tags.ts        # Contact tag types, TAG_COLOR_PALETTE, parseTags helper
```

### Backend Structure

```
supabase/
  config.toml          # Project config (JWT verify disabled on all functions)
  functions/           # ~50+ Deno edge functions
    _shared/           # Cross-function helpers (credentials, dnmarketing, onGuestJoinedMeeting)
  migrations/          # 200+ SQL migrations (RLS, triggers, indexes)
```

### Data Flow

```
Supabase Auth → User Session
  → CompanyContext (multi-company, localStorage persistence)
    → WorkspaceContext (workspace isolation, agent unification)
      → Page Components → Supabase Queries (filtered by workspace_id)
        → Real-time subscriptions (postgres_changes)
```

## Multi-Tenancy Model

**Hierarchy**: User → Companies → Workspaces → Resources (agents, leads, contacts, knowledge)

- `CompanyContext`: Manages company selection, ownership, admin permissions. Does NOT auto-create companies.
- `WorkspaceContext`: Auto-creates default "Principal" workspace for owners. Unifies legacy `agents` and new `agent_instances` tables. Owner/admin see all workspaces; members see only assigned.

## Auth & Roles

Three-tier role system checked via `useUserRole` hook and `user_roles` table:

| Role | Access |
|------|--------|
| `super_admin` | Admin panel, all companies, template management |
| `admin` | Team settings, company management, all workspace data |
| `member` | Assigned workspace data only |

Route protection: `ProtectedRoute` (auth), `AdminRoute` (admin+), `SuperAdminRoute` (super_admin only).

### Bootstrap do primeiro admin

`Login.tsx` chama `bootstrap-admin` com `{action: "status"}` no mount. Se `needs_setup` for `true` (sem linhas em `profiles` **e** sem usuários no auth), aparece o card "Configurar sistema" que abre o `FirstSetupDialog` e cria, em sequência, usuário → `profiles` → `user_roles` → `companies` → `company_members` → `workspaces` → `workspace_members`. A ação `setup` é rejeitada com 409 assim que existir qualquer usuário.

- **Uma role por usuário**: o trigger `on_auth_user_created` insere `user_roles` = `member` automaticamente. Como a constraint é `UNIQUE (user_id, role)`, um upsert de outra role **acrescenta** uma linha em vez de substituir. Toda troca de role deve **deletar as roles do usuário e depois inserir** a nova — padrão em `api-gateway`, `TeamSettings`, `MemberEditDialog` e `bootstrap-admin`.
- **Leitura de role**: `has_role()` é um `EXISTS` e tolera múltiplas linhas, mas `.single()`/`.maybeSingle()` no frontend falham com mais de uma. `useUserRole` lê todas as roles e escolhe a de maior privilégio; os contexts filtram por `role = 'super_admin'` antes do `maybeSingle()`.
- **`workspace_members.role`**: o CHECK admite apenas `('admin','member')`. `'owner'` viola a constraint — a propriedade fica em `workspaces.owner_id`, e as RLS tratam `admin` e `owner` da mesma forma.

## Public REST API

External-facing REST gateway implemented in a single edge function.

- **Entry point**: `supabase/functions/api-gateway/index.ts` (~5600 lines, single-router pattern)
- **Authoritative schema**: `public/openapi.yaml` + `public/openapi.json` (served alongside the SPA). `src/docs/openapi.*` is a frontend copy used by the docs viewer.
- **Dual auth**:
  - **JWT**: `Authorization: Bearer {token}` obtained via `POST /auth/login`
  - **API Key**: `X-API-Key: {key}` — keys are stored as SHA-256 hash in `api_keys`; only `key_prefix` is recoverable after creation. The raw key is shown to the user exactly once.
- **Workspace scoping**: most internal endpoints require `X-Workspace-Id: {uuid}` header. Endpoints fail with 400 if missing.
- **Pagination**: `?page=N&per_page=M` (max 100/page).
- **API key permissions**: `permissions` array on the key gates access per resource group (`inbox`, `agents`, `crm`, etc.). Optional `expires_at`.
- **Triple sync rule** (extends the API Tests Sync Rule above): new/changed endpoints must be reflected in **(1)** `supabase/functions/api-gateway/index.ts`, **(2)** `scripts/test-api.ts`, and **(3)** `public/openapi.yaml` (+ regenerate `public/openapi.json` if used).

### Upsert Endpoints

Two idempotent endpoints exist for external integrations that cannot track internal IDs:

- **`POST /crm/contacts/upsert`**: dedupe by phone/email **across all workspaces of the company** (not just the current workspace). Requires `phone` or `email`; `name` is only required when creating. Fields sent overwrite current values; omitted fields are preserved. Reactivates `is_active = false` contacts. Response meta carries `{created, updated}`.
- **`POST /crm/leads/upsert`**: targets the lead by `lead_id`/`id`, or falls back to the most recent **open** lead of `contact_id`. Falls through to create when no target is found.
- Both share the `createLeadFromBody` / `updateLeadFromBody` helpers with `POST /crm/leads` and `PUT /crm/leads/{id}`.

### Lead Field Validation (API)

`POST`/`PUT`/`UPSERT` on cards resolve catalog fields against workspace/company registries. **Invalid values never block the write** — they fall back and return a warning in `meta.warnings`:

- **`source`** (`resolveLeadSource`): validated against active `crm_contact_sources` of the company (`/settings/company` > "Origens do Lead"), case-insensitive. Unknown values become `"Não identificado"`. Applied to the contact **only when the contact has no source yet** (origin is immutable after first set).
- **`segment`** / **`segment_id`** (`resolveLeadSegment`): accepts name or UUID, compared accent- and case-insensitively against `crm_segments`. Unknown values fall back to the segment flagged `is_default`; without a default, the field stays empty.
- **`channel`**: alias for `utm_source` (the field displayed as "Canal" on the card). Handled by `buildUtmUpdates` along with `utm_source|medium|campaign|content|term`.
- **`note`**: max 5000 chars; recorded in the card timeline as `crm_lead_history.action = 'note'` (same shape the UI produces).
- **`tags`**: array of strings applied to the lead's **contact**, not the lead.

## Design System Rules — DN.IA V3

Referência canônica: `E:\Projetos\desing-system` (`DESIGN-SYSTEM.md`, `IMPLEMENTACAO-V3.md`, `DATAVIZ.md`).
Guia de aplicação deste produto: `docs/DESIGN-SYSTEM-NEXUS.md`.

- **Temas**: `dark` (padrão) e `premium` (o tema claro do Nexus, Neutral Warm), alternados por `data-theme` no `<html>` via next-themes. Não existe um `light` neutro — o claro **é** o premium.
- **Tokens**: tudo em `src/index.css`. `:root` = dark, `[data-theme="premium"]` = claro. Camadas: primitivos `--dn-*`, semânticos (`--canvas`, `--surface`, `--line`, `--text`, `--muted-ink`, `--accent-ink`) e a ponte shadcn em HSL (`--background`, `--primary`, `--border`…), que é o que os componentes de `ui/` consomem.
- **Fontes**: Sora (display + body), Space Mono (labels, IDs, status, métricas), Video só na marca (`font-brand`).
- **Cores da marca**: azul `#3D61FF`, azul claro `#7D97FF`, azul profundo `#2F4FD1`, vermelho `#E41A11`, verde `#20A878`, âmbar `#C98A16`.
- **Vermelho é semântico**: erro, urgência real ou ação irreversível. Nunca decoração, nunca série comum de gráfico. `--accent` é **azul** — o vermelho vive em `destructive`.
- **Geometria**: containers e botões 16px, cards `var(--card-radius)` (12px dark / 16px premium), inputs `rounded-full`, pills 8px.
- **NUNCA** usar cor crua (`text-white`, `bg-red-500`, `bg-[#...]`) nem emoji. Ícones só `lucide-react`.
- **Estado ativo** nunca é marcado só pela cor: soma cor, peso e barra de 2px (sidebar e abas).
- **Um CTA preenchido por tela/dobra**; secundárias em `outline` (ghost mono) ou `ghost`.
- **Gráficos**: reger por `DATAVIZ.md`. Cor identifica série (`--series-1..5`, slots fixos, a série 1 é sempre o azul da marca); verde/âmbar/vermelho são reservados para **estado** e sempre acompanhados de ícone ou rótulo.
- **Primitivos de marca** em `src/components/dn/`: `Pill` (status), `TabCount` (zero não vira badge), `EmptyState`.
- **Classes utilitárias**: `glass-card`, `text-gradient`, `glow-primary`, `status-*`, `badge-*` — todas parametrizadas por token; ajustar o token, não a classe.
- **Exceções declaradas** (não são dívida): `MeetingRoom.tsx` é superfície de tema único; cor escolhida pelo usuário (etapa do pipeline, categoria de agente, tag, tema do widget) é dado, não tema; `RichTextEditor` e o CSS do e-mail não têm tema; `confetti.tsx` não resolve `var()` em `<canvas>`.
- **Auditoria antes de commitar**: `grep -rnE "(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-[0-9]{2,3}" src --include=*.tsx` não deve retornar nada fora das exceções.

## Key Conventions

- **Language**: UI is in Portuguese (Brazilian). All user-facing text in Portuguese.
- **Path alias**: `@/*` maps to `src/*`
- **UI components**: shadcn/ui (~52 components in `src/components/ui/`)
- **Data fetching**: TanStack Query (React Query) for caching and server state
- **Forms**: React Hook Form + Zod validation
- **State**: React Context for global state (Company, Workspace), TanStack Query for server state
- **Supabase types**: Auto-generated in `src/integrations/supabase/types.ts` - do not edit manually
- **Edge functions**: Deno runtime, ESM imports. Cross-function helpers live in `supabase/functions/_shared/` (credential lookups, dn.marketing client, meeting side-effects). For function-internal logic, duplication is still preferred over premature abstraction.
- **Security**: RLS (Row Level Security) at database level. JWT verification disabled on edge functions; security enforced via RLS policies.
- **RLS Convention**: All CRM table policies (SELECT, INSERT, UPDATE, DELETE) must include `has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admin')` checks to ensure admin/super_admin access regardless of workspace membership.

## Business Domain

Full reference: `src/docs/DESIGN_SYSTEM.md` (no separate BUSINESS_RULES.md file exists)

### Core Systems

1. **AI Orchestrator** (`supabase/functions/orchestrator/`): 11-module pipeline handling message reception, intent analysis, agent selection, RAG retrieval, tool execution, response generation, and message splitting with interruption detection.

2. **Lead Routing — centralizado** (`supabase/functions/_shared/routing/`): um único módulo decide "quem atende", consumido pelo handoff do orchestrator, pelos dois agendadores e pelo worker da fila. Regras em `workspace_routing_config` (uma linha por workspace), editáveis em `/settings/routing`. Ver "Roteamento Centralizado" abaixo.

### Roteamento Centralizado (spec: `docs/superpowers/specs/2026-08-28-centralizar-roteamento-design.md`)

Antes existiam **quatro** decisores independentes de "quem atende este lead", nenhum governado pela página de configuração. Hoje há um só módulo e uma só tabela de regras.

- **Módulo**: `supabase/functions/_shared/routing/` — `config` (lê `workspace_routing_config`), `workhours` (jornada), `load` (carga via RPC), `owner` (dono do card), `select` (estratégia), `chat` (funil do chat), `assign` (**escritor único** da atribuição).
- **Consumidores**: `orchestrator/routing-handler.ts` (handoff IA→humano), `schedule-appointment` (agenda via WhatsApp), `schedule-widget` (widget público), `routing-queue-worker` (esvazia a fila, cron de 5 min).
- **Disponibilidade de chat é derivada**, nunca um toggle: `crm_agent_calendars` (dias, horário, fuso) + `crm_holidays` do workspace + `is_accepting_leads` (pausa manual) + capacidade. As colunas `agent_availability.status` e `current_leads_count` **foram removidas** — não recriar; a carga sai da RPC `chat_load_by_user`.
- **Pool de agendamento ≠ pool de chat**: agendamento usa o time do widget (`scheduling_widget_members`) ou `agent_tools.config.allowed_attendants` do agente de IA, e a elegibilidade é ter slot livre — presença de chat não entra.
- **Dono do card vence o rodízio** (`respect_card_owner`, padrão ligado) nos quatro caminhos.
- **Estratégias reais**: só `least_loaded` e `round_robin`. `skill_based`, `performance_based`, `category_based`, `require_approval`, `queue_timeout_minutes` e `skill_matching` ficam **visíveis e desabilitados** na UI — não implementá-los sem spec própria.
- **`src/lib/routing/`** contém apenas `transferLead` (ação humana explícita, nunca bloqueada por presença) e `workhours.ts`/`presence.ts`, que são **espelho** do backend para rotular a UI. Alterou a jornada num lado, altere no outro.
- **Armadilha de schema**: `lead_queues.lead_id` e `lead_assignments.lead_id` são **`text`**, não uuid — toda comparação com `leads.id` precisa de `::text`.
- **Dívida conhecida**: o rodízio não é atômico (dois agendamentos simultâneos podem escolher a mesma pessoa).
- Testes: `scripts/test-routing-unit.ts` (puro, roda com `npx tsx`) e `scripts/test-routing.ts` (smoke, exige service key).

3. **Agent System**: Dual tables (`agents` legacy + `agent_instances` template-based). Categories (VENDAS, SUPORTE, RH, MARKETING, GERAL, OBJECAO, HUMANO + dynamic). Tool catalog with function calling (schedule_appointment).

4. **CRM Pipeline**: Drag-and-drop stages, lead psychology (DNIA - 6 dimensions), automove rules based on propensity/risk/opportunity scores, products, loss reasons, segments, pains and objections (see Lead Attribute Catalogs).

5. **Contact Tags System** (`src/components/crm/tags/`):
   - JSONB column `tags` in `crm_contacts` table with structure `[{name: string, color: string}]`
   - Components: `ContactTagBadge`, `ContactTagList`, `ContactTagEditor`, `TagColorPicker`
   - Types and helpers in `src/types/tags.ts` (includes `TAG_COLOR_PALETTE` and `parseTags`)
   - Hook `useWorkspaceTags` for autocomplete suggestions
   - Management page at `/crm/settings/tags` (`CRMTagsSettings.tsx`)
   - Inline editing in `LeadDetailSheet.tsx` via `ContactTagEditor`
   - Tags column displayed in `CRMContacts.tsx` table
   - **Contacts Filter & Pagination** (`src/components/crm/ContactsFilter.tsx`, `ContactsPagination.tsx`):
     - Server-side pagination with 50 items per page using Supabase `.range()`
     - Filters: text search, source (whatsapp/manual), conversation status, tags, company, sort order
     - Tags filter uses client-side filtering due to JSONB complexity
     - Active filters displayed as removable badges below search
   - **Pipeline Tags Filter** (inline in `CRMPipeline.tsx`):
     - Tags filter integrated with existing pipeline filters (status, product, assignee)
     - Uses `useWorkspaceTags` hook for tag list
     - Popover with checkboxes for multi-select tags
   - **Contacts Import/Export** (`src/components/crm/contacts/`):
     - Export: CSV with `;` separator, UTF-8 BOM, tags separated by `,`
     - Export permission: Owner, Admin, or SuperAdmin only
     - Export scope: Modal asks "filtered" or "all" when filters active
     - Import: 5-step stepper modal (Method → Upload → Validate Columns → Validate Data → Progress)
     - Import permission: All workspace users
     - Import validates: required fields (nome, telefone), duplicates in file and database
     - Duplicate handling: user chooses "Ignore" or "Overwrite"
     - Common tag: optional tag added to all imported contacts
     - Source field: set to `"importacao"` for imported contacts
     - Hooks: `useContactsExport.ts`, `useContactsImport.ts`
   - **Phone Normalization** (`src/lib/phone.ts`, `supabase/migrations/20260204170000_normalize_phone_add_ddi.sql`):
     - Phones stored as digits only with 55 country code prefix
     - Brazilian country code (55) added if not present (10-11 digit numbers)
     - Database triggers auto-normalize on INSERT/UPDATE for `crm_contacts` and `leads`
     - `normalizePhone()`: strips non-digits, adds 55 prefix if missing, converts old 8-digit mobile to 9-digit (adds leading "9" after DDD for numbers starting with [6-9])
     - `formatPhoneForDisplay()`: formats for UI display (11) 99999-9999 (strips 55 for display)
     - `isValidBrazilianPhone()`: validates 12-13 digit (with 55) or 10-11 digit Brazilian format
     - `normalizeBrazilianPhone()` in `zapi-webhook`: same logic as `normalizePhone()` but for Deno edge functions (also strips `@c.us` suffix from Z-API format)

6. **Inbox**: Lead lifecycle (new → ai_talking → needs_human → human_talking → closed). Real-time insights (sentiment, intent, urgency, objections). AI/human handoff. Simulation mode for testing. Audio recording with volume indicator, pause/resume, and Z-API waveform/viewOnce options.

7. **Knowledge Base**: 10 file formats, chunking (1000 chars/200 overlap), OpenAI embeddings (`text-embedding-3-small`), hybrid RAG (keyword + semantic search).

8. **Connections**: WhatsApp Official API, Z-API (unofficial), Google Calendar OAuth. Multi-workspace keyword routing with priority and fallback.
   - **Connection-Workspace mapping**: `connection_workspaces` junction table is the source of truth (many-to-many). `zapi_connections.workspace_id` is a legacy field and MUST NOT be used for lookups. All queries for "which connection serves this workspace" must use `connection_workspaces` filtered by `workspace_id`, `connection_type`, and `is_active`.

9. **Z-API Integration**: Two-level security model:
   - **Company level**: `zapi_account_token` (Account Security Token) stored encrypted in `companies` table. Configured in `/settings/company`.
   - **Instance level**: `instance_id` + `api_token` stored encrypted in `zapi_connections` table. Adding new connection requires 2-step validation flow:
     1. Enter instance_id + api_token → edge function `zapi-validate-instance` validates against Z-API `/me` endpoint using company's decrypted account token
     2. On success, display instance metadata (name, connected, paymentStatus, due) and select workspace to link
   - **Revalidation**: Edit modal includes "Revalidar" button that calls `zapi-validate-instance` with `connection_id` to refresh instance status (connected, paymentStatus, due) from Z-API
   - **Credential Update**: Only `super_admin` users can update `instance_id` and `api_token` in edit modal. New credentials are validated before saving.
   - All tokens encrypted with AES-GCM + PBKDF2 using company_id as passphrase (`src/lib/crypto.ts`)
   - **Supported Media Types** (via `zapi-webhook`):
     - `image`: Photos with expandable preview
     - `audio`: Voice messages with Gemini transcription (auto-retry available)
     - `video`: Video files with inline player
     - `ptv`: Video notes (circular "recado de video") with Gemini transcription
     - `sticker`: Animated/static stickers with preview
     - `document`: File attachments with download link
     - `vcard`: Contact cards with modal preview and "Add to Leads" option
     - `location`: Location messages with Google Maps modal (lat, lng, address)
   - **Audio Recording** (via `useAudioRecorder` hook + `AudioRecorder` component):
     - opus-media-recorder library for OGG Opus format (WhatsApp compatible)
     - Real-time volume indicator using AudioContext + AnalyserNode
     - Pause/resume support with timer
     - 5-minute max duration with warning at 4:30
     - Z-API options: `waveform` (always true), `viewOnce` (disappearing audio)
   - **Audio Transcription** (single edge function `transcribe-audio`):
     - Accepts `audio_base64` for direct transcription (new recordings)
     - Accepts `message_id` for re-transcription (retry failed transcriptions)
     - Uses Gemini multimodal API for Portuguese transcription
     - Re-transcription button appears on all audio messages in Inbox
   - **Health Check** (`zapi-health-check` edge function + pg_cron every 5 min):
     - Monitors all active Z-API connections via `/me` endpoint
     - Updates `zapi_connected`, `zapi_payment_status`, `zapi_due`, `zapi_validated_at` in `zapi_connections`
     - Caches company tokens per workspace to avoid repeated queries
     - `zapi_connections` added to `supabase_realtime` publication for live status updates
   - **Outbound message flow**: `handleSendMessage()` → INSERT `messages` → trigger `notify_whatsapp_on_outbound_message()` → `send-to-whatsapp-channel` → finds `zapi_conversations` by `lead_id` → calls `zapi-send` → Z-API HTTP API. Fallback: if no `zapi_conversations` exists, auto-creates one using lead phone + `connection_workspaces` lookup.

10. **Anti-Ban Protections** (`src/docs/ANTI_BAN_PLAN.md`): Rate limiter (20 msg/min per connection, 1 msg/sec per lead), health score monitoring, opt-out system, message humanization, circuit breaker, warm-up for new numbers, and analytics dashboard. Applies to both Z-API and WhatsApp Official connections.

11. **Api4com (VoIP/Telephony)**:
    - 9 edge functions `api4com-*`: `dial`, `webhook`, `configure-webhook`, `test-connection`, `transcribe`, `analyze-call` (OpenAI), `audio-proxy`, `list-extensions`, `list-integrations`
    - Per-company credentials: `companies.api4com_token_encrypted` + `api4com_webhook_secret` (same AES-GCM pattern as Z-API)
    - Each call produces a `crm_lead_activities` row automatically; webhook receives lifecycle events (`call-started`, `call-ended`, etc.)
    - UI: `src/components/crm/CallActivitySection.tsx`, `src/components/settings/Api4comSettingsCard.tsx`, `src/components/team/Api4comExtensionPicker.tsx`

12. **DN Marketing (external CRM sync)**:
    - Notified on key events: scheduling widget bookings, guest joined meeting, contact lifecycle
    - Centralized helper `supabase/functions/_shared/dnmarketing.ts` with 60s in-memory config cache (`TTL_MS`)
    - **Silent fallback**: if company config is inactive, `notifyDnMarketing()` returns `null` without throwing — never blocks the primary flow
    - Per-company config: `companies.dnmarketing_token_encrypted`, `dnmarketing_base_url`, `dnmarketing_is_active`
    - `backfill-dnia/index.ts`: batches 10 contacts per run, idempotent via `dnia_id IS NULL`. DNIA = the lead-psychology ID returned by dn.marketing.

13. **Daily.co Meetings & Recording**:
    - Orchestration: `daily-room/index.ts` (actions: `create`, `token`, `guest-token`, `validate-guest`, `start-recording`, `start-transcription`, `fetch-recordings`, `get-access-link`, `debug-*`, etc.)
    - Background processing: `daily-webhook`, `daily-webhook-monitor` (circuit breaker), `daily-recording-worker`, `process-daily-recording`
    - **Guarded side-effect** in `supabase/functions/_shared/onGuestJoinedMeeting.ts`: when the guest joins, applies the workspace's `crm_automove_rules` with `condition_type = 'guest_joined_meeting'` (configurable at `/crm/settings/automove`; default seeded rule: MQL stage → first SQL stage). No active rule = no move. The host guard (`meeting_started_at`) and the `contact_joined_at` NULL→value idempotency stay in code. Moves are logged to `crm_automove_log` + `crm_lead_history`.
    - Pages: `MeetingGate.tsx` (public access via `meeting-gate-info` edge function), `MeetingRoom.tsx`

14. **Public Schedule Widget**:
    - No-auth scheduling widget; the `widget_id` is the secret key
    - Edge function `schedule-widget/index.ts` (~950 lines) orchestrates: contact → lead → appointment → Daily room → Google Calendar event → confirmation email (Resend) → WhatsApp confirmation → Meta Conversions API
    - Admin pages: `SchedulingWidgets.tsx`, `SchedulingWidgetHistory.tsx`; public page: `PublicSchedule.tsx`
    - Race-condition handling: duplicate-key triggers on `crm_contacts`/`crm_leads` are caught with recovery queries (retry-select after conflict)
    - Pipeline placement: moves lead to "MQL - Reunião agendada" with 3 fallbacks (exact name → ilike patterns)

15. **LGPD Data Management** (`supabase/functions/lgpd-data-management/index.ts`):
    - Actions: `search` (locate + count related rows), `anonymize` (SHA-256 hash phone across ~8 tables), `delete` (FK-aware cascade: messages → leads → contacts → crm_leads → appointments)
    - All actions are admin/super_admin only
    - Immutable audit log in `data_deletion_log` (tables affected, record counts, status, error details)
    - UI: `src/pages/DataPrivacy.tsx`

16. **Lead Attribute Catalogs (Segments, Pains, Objections)**:
    - **Catalog tables** (per workspace, `UNIQUE (workspace_id, name)`, `is_active` flag): `crm_segments`, `crm_pains`, `crm_objections`
    - **Link tables** (many-to-many with the card, `ON DELETE CASCADE`, `UNIQUE (lead_id, *_id)`): `crm_lead_pains`, `crm_lead_objections`. Segment is a **single** value — `crm_leads.segment_id` FK (`ON DELETE SET NULL`), not a link table.
    - **Default segment**: `crm_segments.is_default` guarded by a partial unique index (`WHERE is_default`) — at most one default per workspace. Used as the API fallback for unregistered values.
    - **Section visibility**: `crm_lead_attribute_sections` (`section_key IN ('segments','pains','objections')`) toggles whether each block appears in the card detail. **Absence of a row means the section is active** — `useLeadAttributeSections` defaults `isActive()` to `true`.
    - **Generic CRUD UI**: `CatalogCrudCard.tsx` is parameterized by `table` + `sectionKey` and reused by `SegmentsCard`, `PainsCard` and `ObjectionsCard` in `/settings/company`. `supportsDefault` enables the star toggle; `requireDefault` (Segments) blocks activating the section until a default exists.
    - **Card UI**: `LeadPainsObjectionsSection.tsx` (inside `LeadDetailSheet`) + `MultiCatalogSelect.tsx` for multi-select
    - **Analytics**: `PainsObjectionsTab.tsx` (Analytics page) with `usePainsObjectionsReport.ts` — filters by stage/status/assignee, drill-down per item, CSV export
    - Adding a new catalog: create the table + link table + RLS, add the `section_key` to the CHECK constraint, then mount a `CatalogCrudCard` — do not duplicate the CRUD component.

17. **Meeting Transcripts Export** (`src/components/appointments/ExportTranscriptsDialog.tsx`):
    - Accessed from `/crm/appointments`; exports Daily.co recording transcriptions by date range (presets: 7d, 30d, this month, 90d)
    - Two formats: CSV (`;` separator, UTF-8 BOM) and TXT
    - **Attendee notification toggle**: `AppointmentDialog` exposes "Notificar convidados por e-mail", forwarded as `notify_attendees` to `google-calendar-create-event`, which maps it to the Google Calendar `sendUpdates=all|none` query param (defaults to `true`).

18. **CRM Flows v2 (motor)** (`supabase/functions/flow-worker/`):
    - Tabelas `crm_flows` (grafo JSONB validado por `validate_crm_flow_graph`: ciclo, ponteiros, config por tipo), `crm_flow_runs` (um run aberto por flow+lead, claim com lease + fencing token), `crm_flow_step_log` (métricas por nó)
    - Gatilho: entrada em etapa do pipeline (`trg_crm_flow_lead_stage` em `crm_leads`); saída configurável por `exit_on_stage_change`; `won`/`lost` encerra runs (`trg_crm_flow_lead_close`)
    - Worker via pg_cron 1/min (`flow-worker-every-minute`, versionado em migration); nós: `delay`, `branch`, `send_whatsapp` (paridade v1 + áudio), `send_email`, `close_lead`
    - Fora da janela de envio → reagenda (nunca descarta); falha de envio → backoff 5min/15min/1h e segue o fluxo
    - Convive com as réguas v1 — tabelas e triggers da v1 permanecem intactos (a única alteração é a guarda de migração descrita abaixo, dentro de `enqueue_stage_cadence`); teste: `scripts/test-flows.ts`
    - **Migração da régua de Etapa (v1 → v2)**: `enqueue_stage_cadence` desiste de inscrever quando existe um `crm_flows` com `status = 'active'` e `entry_node_id IS NOT NULL` para a mesma `stage_id` — a etapa migrada para de aceitar **novos** leads na régua v1, mas os já enfileirados terminam (o `cadence-dispatcher` varre `cadence_scheduled_messages` por `status = 'pending'` e nunca relê `cadence_rules`). A guarda fica **depois** do cancelamento dos pendentes de etapa do lead, preservando o comportamento v1 de cancelar ao mudar de etapa. `StageCadencesPanel` reflete o mesmo predicado: badge "Inativa — migrada para Fluxos", switch travado (sem gravar `is_active`, para que despausar o fluxo devolva a régua sozinha), `CadenceTemplateEditor` em `readOnly` e a etapa some do select "Nova régua".
    - **Builder (Fase 2)**: lista em `/crm/settings/flows` (`CRMFlows.tsx`) e builder em `/crm/settings/flows/:id` (`CRMFlowBuilder.tsx`); componentes em `src/components/crm/flows/`; contrato do grafo em `src/lib/flows.ts` (BRANCH_FIELDS espelha conditions.ts do worker); dados via `src/hooks/useFlows.ts` (`from("crm_flows" as any)` — tabela fora do types.ts gerado). `close_lead` é terminal na UI; agente IA do nó WhatsApp lista só agentes do workspace do fluxo; erro de validação do banco aparece no toast tal como veio.
    - **E-mail (Fase 3)**: nó `send_email` com editor rich-text TipTap (`RichTextEditor.tsx` — negrito/itálico/título/listas/link/imagem por URL/variáveis) e pré-visualização em `<iframe sandbox>` (HTML do e-mail nunca é injetado no DOM do app). Envio pelo Resend da empresa.
    - **Observabilidade (Fase 4)**: `src/hooks/useFlowObservability.ts` — `useFlowMetrics` agrega `crm_flow_step_log` por nó (paging de 1000, polling 60s, só fora de rascunho) e alimenta os contadores no `FlowNodeCard`; `useFlowRuns` + `FlowRunsDrawer.tsx` listam os leads no fluxo (estado, passo atual, motivo de saída, link para o card).
    - **Atributo ICP** (`crm_leads.is_icp`, null = não avaliado): marcado pelo `schedule-widget` nos dois gates de ICP e manualmente no `LeadDetailSheet`; alteração restrita a admin/super_admin pelo trigger `trg_guard_crm_lead_is_icp` (service_role liberado). Disponível como condição no fluxo, junto de Cargo/Faturamento/Tamanho da empresa (vocabulários em `src/lib/widgetVocabulary.ts`, compartilhados com a config do widget).

## Credential Management Pattern

External-integration credentials follow a unified multi-tenant pattern.

- **Storage**: all third-party tokens live encrypted in the `companies` table (`{integration}_*_encrypted` columns), using AES-GCM + PBKDF2 from `src/lib/crypto.ts`. The company UUID is the passphrase.
- **Lookup chain**: always resolve `workspace_id → company_id → companies[credential_field]`. Never key credentials directly by `workspace_id`.
- **Per-integration Deno helpers** in `supabase/functions/_shared/`:
  - `googleCredentials.ts` (`google_client_id`, `google_client_secret`, OAuth refresh handling)
  - `openaiCredentials.ts` (`openai_api_key`)
  - `resendCredentials.ts` (`resend_api_key`, `resend_from_email`)
  - `dnmarketing.ts` (`dnmarketing_token_encrypted`, `dnmarketing_base_url`)
- Each helper exposes a typed error class (`OpenAIError`, `ResendError`, `GoogleOAuthError`) and an `*ErrorResponse()` builder so edge functions return consistent HTTP shapes.
- **UI**: each integration has a `*IntegrationCard` / `*SettingsCard` in `src/components/settings/` and edge function `*-validate-token` (or `test-connection`) for save-time validation.

## Important Patterns

- **Agent selection protection**: First 4 messages stay with current agent regardless of intent (prevents premature transfers)
- **Scheduling confirmation gate**: `cancel`/`reschedule` via IA nunca executam no primeiro tool call. O `tool-executor` grava a ação em `leads.pending_scheduling_action` (JSONB, TTL 10 min) e devolve uma pergunta de confirmação; o orchestrator só executa (`confirmed=true`) se a mensagem seguinte for uma confirmação estrita (`isStrictConfirmation`: curta, sem dígitos). Qualquer outra mensagem limpa a ação pendente — pendência antiga nunca autoriza chamada posterior. O resultado da ferramenta é devolvido ao modelo via `composeToolResponse` antes de responder (fallback: mensagem crua da tool).
- **Lead reactivation**: Lost CRM leads automatically reactivated when contact re-engages
- **Message splitting**: Responses > 300 chars split into chunks with typing delays; interrupted if lead changes subject
- **Session detection**: LLM-first approach, no forced resets based on time gaps
- **Dual agent tables**: Always check both `agents` and `agent_instances` when working with agents
- **Workspace isolation**: All queries must filter by `workspace_id`
- **Media delivery tracking**: When sending media via Z-API, always save `external_message_id` from the response to enable status callbacks (delivered/read)
- **Public auth-less endpoints**: `MeetingGate` (via `meeting-gate-info`) and `PublicSchedule` (via `schedule-widget`) accept no JWT. Security is by ID secrecy (`appointment_id`, `widget_id`). These endpoints never return sensitive data; Daily.co tokens are only issued by a separate endpoint after email validation.
- **Phone normalization at API boundary**: `src/lib/phone.ts` and DB triggers also upgrade legacy 8-digit mobile numbers to 9 digits (prepend "9" after DDD when first digit is in `[6-9]`). API normalizes before persisting; the frontend uses `formatPhoneForDisplay()` for UI only — never store the formatted form.
- **Non-blocking catalog validation**: when the API receives a catalog value (`source`, `segment`) that is not registered, never reject the request. Fall back (`"Não identificado"` / default segment) and surface the reason in `meta.warnings`. Integrations must not lose leads over a typo in a dropdown value.
- **Immutable contact origin**: `crm_contacts.source` is written once. Every write path (upsert, lead create/update) only fills it when it is still empty — first-touch attribution must survive later interactions.
- **Absence means enabled**: feature-visibility tables (`crm_lead_attribute_sections`) store only explicit overrides. A missing row is treated as active, so new workspaces get the feature without a backfill.
- **LLM-extracted contact data must prove provenance** (`supabase/functions/_shared/contactDataGuard.ts`): anything the AI extracts from a conversation (`company`, `name`, `email`, `phone`) is only written after passing two independent checks — the value must appear in a message from the **lead** (`role === "user"`), and it must not match the tenant blocklist (company/workspace/agent names + product domains). Prompt wording is mitigation only; `gemini-2.5-flash-lite` is too weak to be the sole defense. Reason: the agent introduces itself with the tenant's name and meeting reminders carry `nexus.dnia.ai` links, so the extractor was reading the assistant's own lines and overwriting `crm_contacts.company` with `"dn.ia"` — which renamed the pipeline card via `trg_sync_contact_title_to_lead`. Two-form normalization (`normalizeForMatch` keeps separators, `squash` drops them) is required: `"dn.ia"` and `"dnia.ai"` only match once squashed.
- **AI never overwrites a filled contact field**: `company` follows the same rule as `employee_count`/`revenue` — the orchestrator only fills it when empty. When the lead states a different company, the orchestrator writes a `crm_lead_history` note (`action = 'note'`) on the open card instead of updating; changing a registered company is a human decision.
- **Contact field audit** (`crm_contact_field_history`): trigger `trg_log_crm_contact_field_changes` records old/new values of `company`/`name`/`email` with author (`auth.uid()`), `changed_by_kind` (`user`/`service`/`unknown`, derived from the JWT `role` claim since `auth.uid()` is NULL under service_role) and `source` (header `x-nexus-source`). RLS grants **SELECT only** — no write policy exists, so the trail cannot be edited by the audited user. `crm_lead_history` is not a substitute: it requires a `lead_id` (contacts may have none or many), its RLS grants UPDATE/DELETE to members, and it has no field-level columns. Any new writer of these fields must be added to `lgpd-data-management` anonymization.

## Reusable Patterns

Established hooks/utilities — reuse before inventing new ones.

- **`usePersistedFilters(name, defaultValue)`** (`src/hooks/usePersistedFilters.ts`): localStorage-backed filter state keyed as `nexus:filters:{name}:{userId}:{workspaceId}`. Behaves like `useState` while auth is loading; auto-rehydrates when scope changes. Already used in `CRMContacts.tsx` and `CRMPipeline.tsx`.
- **Supabase `.in()` chunking** (see `src/hooks/useCohortAnalytics.ts`): Supabase's `.in()` breaks past ~1000 values. Chunk in batches of 200 IDs when querying analytics over large lead sets.
- **Domain enums over booleans** (see `src/hooks/useMeetingsReport.ts`): `MeetingStatus = "rolou" | "reagendou" | "no_show"` — rescheduling ≠ cancellation. Prefer semantic enums to boolean flags for any lifecycle state.
- **Union-find deduplication** (`supabase/functions/merge-duplicates/index.ts`): two-phase grouping (phone, then email) with union-find; the oldest contact becomes the root. Reuse this rather than rolling new duplicate-detection logic.
- **Notifications via central table** (`src/hooks/useActivityReminders.ts`): instead of firing UI notifications directly, insert into `user_notifications` (`type` discriminator). `NotificationBell` reacts via realtime. Use this for any new notification source.
- **Unlink before delete** (`src/lib/freeSlotOnNoShow.ts`): when removing a `crm_appointments` row that has linked activities, first `UPDATE` activities setting `appointment_id = NULL`, then delete — preserves audit trail in activities while freeing the slot.
- **`fetchAllRows` paging loop** (`src/hooks/usePainsObjectionsReport.ts`): Supabase caps a single `select` at 1000 rows. Page with `.range(from, from + 999)` until a page returns fewer than 1000. Always `.order()` by a stable column first, otherwise pages can repeat or skip rows.
- **Existence questions belong in the database** (`public.meeting_ids_with_chunks`, used by `src/hooks/useActivitiesOperations.ts`): when the question is "which of these N parents have at least one child row", never `select` the children and dedupe client-side — the 1000-row cap truncates the answer **silently** (no error, partial data) and the missing parents look like they have nothing. Prefer a `stable` / `security invoker` RPC with `unnest(...) + EXISTS`, which returns one row per parent. PostgREST aggregates (`select=col,count()`) are **disabled** on this instance (`PGRST123`) and are not an alternative.
- **Parameterized CRUD component** (`src/components/settings/CatalogCrudCard.tsx`): workspace catalogs (segments, pains, objections) share one component driven by props (`table`, `queryKey`, `sectionKey`, `supportsDefault`). New catalogs mount a wrapper card — never a copy of the CRUD logic.
- **Memoize derived date ranges** (`src/hooks/usePainsObjectionsReport.ts`): computing `new Date()` inside a hook body makes the value change every render. Wrap period → ISO conversion in `useMemo` keyed by the period and by the range's ISO strings (not the `Date` objects) to avoid an infinite effect loop.
