# Nexus AI API — Referencia da API
Versao: `1.0.0`
Atualizado em: `2026-08-14T00:33:00-03:00`
Endpoints: 217 em 36 grupos
Base URLs:
- `https://nexus-ai-schema.lovable.app/api/v1` (Producao)
- `http://localhost:8080/api/v1` (Desenvolvimento)
Especificacao OpenAPI: https://nexus.dnia.ai/openapi.yaml | https://nexus.dnia.ai/openapi.json

_Documentacao atualizada em 14/08/2026 00:33 (Brasilia)




API da plataforma Nexus AI — sistema multi-tenant de atendimento ao cliente com agentes inteligentes,
CRM, integracao WhatsApp e gestao de conhecimento.

## Autenticacao

A API suporta dois metodos de autenticacao:

- **JWT (Bearer Token)**: Obtido via `POST /auth/login`. Enviar no header `Authorization: Bearer {token}`.
- **API Key**: Criada em `/settings/api-keys`. Enviar no header `X-API-Key: {chave}`.

## Fluxo de autenticacao

1. `POST /auth/login` com email e password → recebe `token` (JWT)
2. `GET /companies` com Bearer token → lista empresas do usuario → pega `company_id`
3. `GET /workspaces?company_id={id}` → lista workspaces → pega o `id` desejado
4. Usar `X-Workspace-Id: {workspace_id}` nos endpoints que exigem workspace

## Header X-Workspace-Id

Endpoints que operam dentro de um workspace exigem o header `X-Workspace-Id` (UUID).

**NAO exigem** X-Workspace-Id:
- Auth (`/auth/*`)
- Companies (`/companies/*`)
- Workspaces (`/workspaces/*`)
- Connections (`/connections/*`)
- Invites (`/invites/*`)
- Notifications (`/notifications/*`)
- Admin (`/admin/*`)
- Agent Templates (`/agent-templates/*`)
- Public (`/public/*`)
- Webhooks (`/webhooks/*`)

**Exigem** X-Workspace-Id:
- Agents, Agent Categories, Inbox, CRM (contacts, pipeline, psychology, products, loss-reasons, tags, automove),
  Appointments, Agent Calendars, Knowledge Base, Messages, Routing, Chat Categories,
  Availability, Analytics, Tools, Widgets, API Keys, Integrations

## Agenda e disponibilidade do vendedor

Existem tres blocos complementares para tudo que envolve agenda:

**1. Agendamentos (`/appointments`)** — reunioes propriamente ditas.
- `GET /appointments` — lista com filtros de `status`, `agent_id` (responsavel), `start_date`, `end_date` e `derived_status`
  (`realized`, `no_show`, `cancelled`, `upcoming`, `scheduled`)
- `POST /appointments` — cria a reuniao (titulo, `start_time`, `end_time`, participantes, `lead_id`, `agent_id`)
- `GET /appointments/{id}` — detalhes | `PUT /appointments/{id}` — atualiza | `DELETE /appointments/{id}` — cancela
- `POST /appointments/{id}/attendees` — adiciona participante
- `GET /appointments/availability` — horarios livres (slots) de um responsavel em uma data
- `POST /appointments/{id}/sync-calendar` — sincroniza com o Google Calendar

Datas relevantes: `created_at` do agendamento e **quando a reuniao foi marcada**; `start_time` e **para quando ela foi marcada**.

**2. Disponibilidade operacional (`/availability`)** — se o vendedor esta apto a receber leads agora.
- `GET /availability` — disponibilidade do usuario autenticado
- `PUT /availability` — atualiza `status`, `is_accepting_leads` e `max_concurrent_leads`
- `GET /availability/{userId}` — disponibilidade de um usuario especifico

Esses campos alimentam o roteamento de leads (`/routing`): um atendente com `is_accepting_leads = false`
ou que atingiu o `max_concurrent_leads` deixa de ser elegivel nas estrategias de distribuicao.

**3. Janelas de trabalho (`/agent-calendars`)** — horarios, intervalos e fuso de cada atendente,
usados como base para calcular os slots retornados em `GET /appointments/availability`.
O tamanho do slot (passo entre horarios candidatos) e uma configuracao geral do workspace
definida em `/crm/settings/agent-calendars`; feriados sao respeitados tanto no widget publico
quanto no agendamento feito pela IA.

## Grupos de endpoints

- [Admin](https://nexus.dnia.ai/api-docs/admin.md) — 6 endpoints
- [Agent Calendars](https://nexus.dnia.ai/api-docs/agent-calendars.md) — 5 endpoints
- [Agent Categories](https://nexus.dnia.ai/api-docs/agent-categories.md) — 4 endpoints
- [Agent Templates](https://nexus.dnia.ai/api-docs/agent-templates.md) — 5 endpoints
- [Agents](https://nexus.dnia.ai/api-docs/agents.md) — 10 endpoints
- [Analytics](https://nexus.dnia.ai/api-docs/analytics.md) — 10 endpoints
- [API Keys](https://nexus.dnia.ai/api-docs/api-keys.md) — 3 endpoints
- [Appointments](https://nexus.dnia.ai/api-docs/appointments.md) — 8 endpoints
- [Auth](https://nexus.dnia.ai/api-docs/auth.md) — 7 endpoints
- [Availability](https://nexus.dnia.ai/api-docs/availability.md) — 3 endpoints
- [Chat Categories](https://nexus.dnia.ai/api-docs/chat-categories.md) — 4 endpoints
- [Companies](https://nexus.dnia.ai/api-docs/companies.md) — 14 endpoints
- [Connections](https://nexus.dnia.ai/api-docs/connections.md) — 6 endpoints
- [CRM Activities](https://nexus.dnia.ai/api-docs/crm-activities.md) — 2 endpoints
- [CRM Automove](https://nexus.dnia.ai/api-docs/crm-automove.md) — 5 endpoints
- [CRM Contacts](https://nexus.dnia.ai/api-docs/crm-contacts.md) — 11 endpoints
- [CRM Funnel](https://nexus.dnia.ai/api-docs/crm-funnel.md) — 1 endpoints
- [CRM Loss Reasons](https://nexus.dnia.ai/api-docs/crm-loss-reasons.md) — 4 endpoints
- [CRM Performance](https://nexus.dnia.ai/api-docs/crm-performance.md) — 9 endpoints
- [CRM Pipeline](https://nexus.dnia.ai/api-docs/crm-pipeline.md) — 19 endpoints
- [CRM Products](https://nexus.dnia.ai/api-docs/crm-products.md) — 4 endpoints
- [CRM Psychology](https://nexus.dnia.ai/api-docs/crm-psychology.md) — 2 endpoints
- [CRM Tags](https://nexus.dnia.ai/api-docs/crm-tags.md) — 3 endpoints
- [Google Calendar](https://nexus.dnia.ai/api-docs/google-calendar.md) — 4 endpoints
- [Inbox](https://nexus.dnia.ai/api-docs/inbox.md) — 12 endpoints
- [Internal](https://nexus.dnia.ai/api-docs/internal.md) — 6 endpoints
- [Knowledge Base](https://nexus.dnia.ai/api-docs/knowledge-base.md) — 11 endpoints
- [Messaging](https://nexus.dnia.ai/api-docs/messaging.md) — 2 endpoints
- [Notifications](https://nexus.dnia.ai/api-docs/notifications.md) — 3 endpoints
- [Routing](https://nexus.dnia.ai/api-docs/routing.md) — 4 endpoints
- [Tools](https://nexus.dnia.ai/api-docs/tools.md) — 2 endpoints
- [Webhooks](https://nexus.dnia.ai/api-docs/webhooks.md) — 4 endpoints
- [WhatsApp Official](https://nexus.dnia.ai/api-docs/whatsapp-official.md) — 3 endpoints
- [Widgets](https://nexus.dnia.ai/api-docs/widgets.md) — 6 endpoints
- [Workspaces](https://nexus.dnia.ai/api-docs/workspaces.md) — 8 endpoints
- [Z-API](https://nexus.dnia.ai/api-docs/z-api.md) — 7 endpoints

Documentacao completa em um arquivo: https://nexus.dnia.ai/api-docs/full.md
