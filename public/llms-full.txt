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

## Admin

### `GET /admin/companies`

Listar todas as empresas (admin)

operationId: `adminListCompanies`

**Respostas**

- `200` Lista de empresas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse

### `GET /admin/companies/{id}`

Detalhes da empresa (admin)

operationId: `adminGetCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da empresa -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `PUT /admin/companies/{id}`

Atualizar empresa (admin)

operationId: `adminUpdateCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `slug` _string_
- `is_active` _boolean_

**Respostas**

- `200` Empresa atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `DELETE /admin/companies/{id}`

Remover empresa (admin)

operationId: `adminDeleteCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Empresa removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `GET /admin/users`

Listar todos os usuarios (admin)

operationId: `adminListUsers`

**Respostas**

- `200` Lista de usuarios -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse

### `PUT /admin/users/{id}/role`

Alterar role de usuario (admin)

operationId: `adminUpdateUserRole`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `role` _string (super_admin | admin | member)_ **obrigatorio**

**Respostas**

- `200` Role atualizado -> SuccessResponse
- `400` Role invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Usuario nao encontrado -> ErrorResponse

## Agent Calendars

### `GET /agent-calendars`

Listar calendarios de agentes

operationId: `listAgentCalendars`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de calendarios -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /agent-calendars/slots`

Grade de slots (livres e ocupados) por atendente

Retorna, por atendente, a grade de agenda do periodo: dias uteis, feriados,
slots livres (respeitando `slot_step_minutes` do workspace, duracao padrao,
intervalo minimo e agendamentos existentes) e blocos ocupados.
Intervalo maximo: 62 dias. Considera apenas agendamentos internos (crm_appointments);
bloqueios exclusivos do Google Calendar nao entram nesta grade.

operationId: `getAgentCalendarSlots`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `agent_id` | query | nao | string<uuid> | Filtra um atendente especifico (padrao: todos com calendario configurado) |
| `start_date` | query | nao | string<date> | Data inicial (YYYY-MM-DD). Padrao: hoje |
| `end_date` | query | nao | string<date> | Data final (YYYY-MM-DD). Padrao: start_date + 6 dias |
| `duration` | query | nao | integer | Duracao desejada da reuniao em minutos (padrao: duracao padrao do calendario) |
| `include_past` | query | nao | boolean | Inclui slots ja passados no dia corrente |

**Respostas**

- `200` Grade de slots por atendente -> SuccessResponse & object
- `400` Intervalo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /agent-calendars/capacity`

Taxa de ocupacao da agenda por atendente

Agrega capacidade (horas disponibilizadas nas janelas de trabalho, descontando
feriados e dias nao uteis) contra ocupacao (horas de agendamentos ativos) e
devolve a taxa de preenchimento por atendente e o total do workspace.
Intervalo maximo: 186 dias.

operationId: `getAgentCalendarCapacity`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `agent_id` | query | nao | string<uuid> |  |
| `start_date` | query | nao | string<date> |  |
| `end_date` | query | nao | string<date> |  |

**Respostas**

- `200` Capacidade e ocupacao -> SuccessResponse & object
- `400` Intervalo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /agent-calendars/{agentId}`

Detalhes do calendario do agente

operationId: `getAgentCalendar`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `agentId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do calendario -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Calendario nao encontrado -> ErrorResponse

### `PUT /agent-calendars/{agentId}`

Atualizar calendario do agente

operationId: `updateAgentCalendar`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `agentId` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `calendar_id` _string_
- `is_enabled` _boolean_
- `working_hours` _object_

**Respostas**

- `200` Calendario atualizado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Calendario nao encontrado -> ErrorResponse

## Agent Categories

### `GET /agent-categories`

Listar categorias de agentes

operationId: `listAgentCategories`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de categorias -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /agent-categories`

Criar categoria de agente

operationId: `createAgentCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `slug` _string_ **obrigatorio**
- `description` _string_
- `icon` _string_
- `color` _string_

**Respostas**

- `201` Categoria criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /agent-categories/{id}`

Atualizar categoria de agente

operationId: `updateAgentCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `slug` _string_
- `description` _string_
- `icon` _string_
- `color` _string_

**Respostas**

- `200` Categoria atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Categoria nao encontrada -> ErrorResponse

### `DELETE /agent-categories/{id}`

Remover categoria de agente

operationId: `deleteAgentCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Categoria removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Categoria nao encontrada -> ErrorResponse

## Agent Templates

### `GET /agent-templates`

Listar templates de agentes

operationId: `listAgentTemplates`

**Respostas**

- `200` Lista de templates -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /agent-templates`

Criar template de agente (super_admin)

operationId: `createAgentTemplate`

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `system_prompt` _string_ **obrigatorio**
- `tone` _string_
- `category` _string_
- `icon` _string_

**Respostas**

- `201` Template criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao (requer super_admin) -> ErrorResponse

### `GET /agent-templates/{id}`

Detalhes do template de agente

operationId: `getAgentTemplate`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do template -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Template nao encontrado -> ErrorResponse

### `PUT /agent-templates/{id}`

Atualizar template de agente (super_admin)

operationId: `updateAgentTemplate`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `system_prompt` _string_
- `tone` _string_
- `category` _string_
- `icon` _string_
- `is_active` _boolean_

**Respostas**

- `200` Template atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao (requer super_admin) -> ErrorResponse
- `404` Template nao encontrado -> ErrorResponse

### `DELETE /agent-templates/{id}`

Remover template de agente (super_admin)

operationId: `deleteAgentTemplate`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Template removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao (requer super_admin) -> ErrorResponse
- `404` Template nao encontrado -> ErrorResponse

## Agents

### `GET /agents`

Listar agentes do workspace

operationId: `listAgents`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de agentes -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /agents`

Criar agente

operationId: `createAgent`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `system_prompt` _string_ **obrigatorio**
- `tone` _string_
- `category_id` _string<uuid>_
- `keywords` _string[]_
- `icon` _string_

**Respostas**

- `201` Agente criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /agents/{id}`

Detalhes do agente

operationId: `getAgent`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do agente -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `PUT /agents/{id}`

Atualizar agente

operationId: `updateAgent`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `system_prompt` _string_
- `tone` _string_
- `category_id` _string<uuid>_
- `is_active` _boolean_
- `is_archived` _boolean_
- `keywords` _string[]_
- `icon` _string_
- `split_messages` _boolean_
- `activation_description` _string_
- `knowledge_base_id` _string<uuid>_

**Respostas**

- `200` Agente atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `DELETE /agents/{id}`

Remover agente

operationId: `deleteAgent`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Agente removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `POST /agents/from-template`

Criar agente a partir de template

operationId: `createAgentFromTemplate`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `template_id` _string<uuid>_ **obrigatorio**
- `name` _string_ **obrigatorio**
- `customizations` _object_

**Respostas**

- `201` Agente criado a partir do template -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Template nao encontrado -> ErrorResponse

### `GET /agents/{id}/tools`

Listar ferramentas do agente

operationId: `getAgentTools`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de ferramentas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `PUT /agents/{id}/tools`

Atualizar ferramentas do agente

operationId: `updateAgentTools`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `tool_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Ferramentas atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `GET /agents/{id}/knowledge-bases`

Listar bases de conhecimento do agente

operationId: `getAgentKnowledgeBases`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de bases de conhecimento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

### `PUT /agents/{id}/knowledge-bases`

Atualizar bases de conhecimento do agente

operationId: `updateAgentKnowledgeBases`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `knowledge_base_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Bases de conhecimento atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agente nao encontrado -> ErrorResponse

## Analytics

### `GET /analytics/overview`

Visao geral de metricas

operationId: `getAnalyticsOverview`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date> |  |
| `end_date` | query | nao | string<date> |  |

**Respostas**

- `200` Metricas gerais -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/sales-cycle`

Ciclo de compra (dias entre criacao do card e o ganho)

Retorna o tempo medio e mediano de fechamento dos cards ganhos (`status = won`) no periodo,
calculado como a diferenca entre `crm_leads.created_at` e `crm_leads.closed_at`.
Inclui distribuicao por faixas de dias, quebra por origem do contato e por canal (`utm_source`),
e comparacao com o periodo imediatamente anterior de mesma duracao.
Inclui tambem `by_month` - evolucao mes a mes dos ultimos 12 meses (won_count, avg_days, median_days),
independente do periodo informado, para leitura de tendencia.

operationId: `getAnalyticsSalesCycle`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Inicio do periodo (filtra por closed_at). Padrao - 30 dias atras. |
| `end_date` | query | nao | string<date-time> | Fim do periodo (filtra por closed_at). Padrao - agora. |
| `source` | query | nao | string | Filtra pela origem do contato (crm_contacts.source), case-insensitive. |
| `utm_source` | query | nao | string | Filtra pelo canal do card (alias - channel). |
| `channel` | query | nao | string | Alias de utm_source. |
| `compare` | query | nao | boolean | Quando false, nao calcula o periodo anterior. |

**Respostas**

- `200` Metricas de ciclo de compra -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/leads`

Metricas de leads

operationId: `getAnalyticsLeads`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de leads -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/messages`

Metricas de mensagens

operationId: `getAnalyticsMessages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de mensagens -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/funnel-by-seller`

Funil (Lead - MQL - SQL - Venda) fatiado por vendedor

Quebra do funil comercial **por vendedor** (dono do card em `crm_leads.assigned_to`),
com contagem por etapa e taxas de conversao. Alias: `/analytics/sellers`.

**Como cada numero e calculado**
- `leads_created`: cards do vendedor criados dentro de [start_date, end_date)
- `stage_counts[].count`: cards que ENTRARAM na etapa dentro da janela
  (primeira entrada registrada em `crm_lead_history.to_stage_id`)
- `won` / `lost`: `crm_leads.status = won|lost` com `closed_at` dentro da janela
- `avg_days_to_won`: media de dias entre `created_at` e `closed_at` dos ganhos
- `sequential_rates`: taxa entre etapas adjacentes na ordem do pipeline

**Atribuicao**: dono ATUAL do card (`attribution: current_owner`). Trocar o responsavel
reatribui o historico do lead retroativamente — nao ha snapshot do dono por transicao.

**Atencao a `stage_rates.lead_to_mql`**: o denominador sao os leads criados na janela,
mas o numerador inclui cards criados antes que viraram MQL agora. Por isso a taxa pode
passar de 100% em janelas curtas. Para conversao de coorte real use `/analytics/cohort`.

operationId: `getAnalyticsFunnelBySeller`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Default = ultimos 30 dias |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `assigned_to` | query | nao | string<uuid> | Filtra um unico vendedor (`profiles.id`). Alias: `seller_id`. Ausente = todos. |

**Respostas**

- `200` Funil por vendedor -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/sellers`

Alias de /analytics/funnel-by-seller

Mesma resposta de `GET /analytics/funnel-by-seller`.

operationId: `getAnalyticsSellers`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `assigned_to` | query | nao | string<uuid> |  |

**Respostas**

- `200` Funil por vendedor -> SuccessResponse

### `GET /analytics/cohort`

Coortes mensais de leads com conversao por etapa

Agrupa os cards por mes de criacao (coorte) e mede quantos alcancaram cada etapa,
alem do tempo medio ate cada etapa. Aceita recorte por vendedor e por UTM.

operationId: `getAnalyticsCohort`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `months_back` | query | nao | integer |  |
| `assigned_to` | query | nao | string<uuid> | Filtra pelo dono atual do card. Alias: `seller_id`. |
| `utm_source` | query | nao | string |  |
| `utm_campaign` | query | nao | string |  |

**Respostas**

- `200` Coortes com conversao por etapa -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/agents`

Desempenho comercial por vendedor (com etapas e taxas)

Por padrao retorna o desempenho dos **vendedores humanos** a partir de `crm_leads.assigned_to`
(mesma base de `/analytics/funnel-by-seller`), incluindo `stage_counts` e `stage_rates`.

Campos `agent_id`, `total` e `closed` sao mantidos por compatibilidade
(`total` = cards criados na janela, `closed` = ganhos + perdidos na janela).

Use `?source=ai` para o comportamento antigo: conversas da tabela `leads`
agrupadas por `assigned_agent_id` (agente de IA), retornando apenas `{agent_id, total, closed}`.

operationId: `getAnalyticsAgents`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `assigned_to` | query | nao | string<uuid> | Filtra um unico vendedor |
| `source` | query | nao | string (crm \| ai) | `crm` = vendedores humanos; `ai` = agentes de IA (formato legado) |

**Respostas**

- `200` Metricas por vendedor (ou por agente de IA quando `source=ai`) -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/delivery`

Metricas de entrega de mensagens

operationId: `getAnalyticsDelivery`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de entrega -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/connection-health`

Metricas de saude das conexoes

operationId: `getAnalyticsConnectionHealth`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de saude -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

## API Keys

### `GET /api-keys`

Listar chaves de API

operationId: `listApiKeys`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de chaves -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /api-keys`

Criar chave de API

operationId: `createApiKey`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `permissions` _string[]_
- `expires_at` _string<date-time>_

**Respostas**

- `201` Chave criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /api-keys/{id}`

Revogar chave de API

operationId: `deleteApiKey`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Chave revogada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Chave nao encontrada -> ErrorResponse

## Appointments

### `GET /appointments`

Listar agendamentos

operationId: `listAppointments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `status` | query | nao | string | Filtra pelo status bruto do agendamento (ex. scheduled, cancelled) |
| `agent_id` | query | nao | string<uuid> | Filtra pelo responsavel (assigned_to) |
| `start_date` | query | nao | string<date-time> | Data/hora minima de inicio (start_time >= valor), ISO 8601 |
| `end_date` | query | nao | string<date-time> | Data/hora maxima de fim (end_time <= valor), ISO 8601 |
| `derived_status` | query | nao | string (realized \| no_show \| cancelled \| upcoming \| scheduled) | Filtra pelo status derivado calculado pela API |

**Respostas**

- `200` Lista de agendamentos -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /appointments`

Criar agendamento

operationId: `createAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `title` _string_ **obrigatorio**
- `description` _string_
- `start_time` _string<date-time>_ **obrigatorio**
- `end_time` _string<date-time>_ **obrigatorio**
- `attendees` _object[]_
  - `name` _string_
  - `email` _string_
  - `phone` _string_
- `status` _string_
- `lead_id` _string<uuid>_
- `agent_id` _string<uuid>_

**Respostas**

- `201` Agendamento criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /appointments/{id}`

Detalhes do agendamento

operationId: `getAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do agendamento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Agendamento nao encontrado -> ErrorResponse

### `PUT /appointments/{id}`

Atualizar agendamento

operationId: `updateAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `title` _string_
- `description` _string_
- `start_time` _string<date-time>_
- `end_time` _string<date-time>_
- `attendees` _object[]_
  - `name` _string_
  - `email` _string_
  - `phone` _string_
- `status` _string_
- `lead_id` _string<uuid>_
- `agent_id` _string<uuid>_

**Respostas**

- `200` Agendamento atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agendamento nao encontrado -> ErrorResponse

### `DELETE /appointments/{id}`

Remover agendamento

operationId: `deleteAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Agendamento removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agendamento nao encontrado -> ErrorResponse

### `POST /appointments/{id}/attendees`

Adicionar participante ao agendamento

operationId: `addAppointmentAttendee`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `email` _string_
- `phone` _string_

**Respostas**

- `201` Participante adicionado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agendamento nao encontrado -> ErrorResponse

### `GET /appointments/availability`

Verificar disponibilidade para agendamento

operationId: `getAppointmentAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `agent_id` | query | nao | string<uuid> |  |
| `date` | query | nao | string<date> |  |
| `duration` | query | nao | integer | Duracao em minutos |

**Respostas**

- `200` Horarios disponiveis -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /appointments/{id}/sync-calendar`

Sincronizar agendamento com Google Calendar

operationId: `syncAppointmentCalendar`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Sincronizacao concluida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Agendamento nao encontrado -> ErrorResponse

## Auth

### `POST /auth/login`

Login com email e senha

operationId: `authLogin`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**

**Respostas**

- `200` Login realizado com sucesso -> AuthTokenResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Credenciais invalidas -> ErrorResponse

### `POST /auth/register`

Registrar novo usuario

operationId: `authRegister`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**
- `full_name` _string_ **obrigatorio** - Maps to 'name' in profiles table

**Respostas**

- `201` Usuario criado com sucesso -> AuthTokenResponse
- `400` Dados invalidos -> ErrorResponse

### `POST /auth/logout`

Encerrar sessao do usuario

operationId: `authLogout`

**Respostas**

- `200` Sessao encerrada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /auth/refresh`

Renovar token de acesso

operationId: `authRefreshToken`

**Body** (`application/json`, obrigatorio)

- `refresh_token` _string_ **obrigatorio**

**Respostas**

- `200` Token renovado -> AuthTokenResponse
- `400` Token invalido -> ErrorResponse

### `POST /auth/reset-password`

Solicitar reset de senha

operationId: `authResetPassword`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**

**Respostas**

- `200` Email de reset enviado -> SuccessResponse
- `400` Email invalido -> ErrorResponse

### `GET /auth/me`

Obter perfil do usuario autenticado

operationId: `authGetProfile`

**Respostas**

- `200` Perfil do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /auth/me`

Atualizar perfil do usuario

operationId: `authUpdateProfile`

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone` _string_
- `availability_status` _string_

**Respostas**

- `200` Perfil atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

## Availability

### `GET /availability`

Obter disponibilidade do usuario

operationId: `getAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Disponibilidade do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /availability`

Atualizar disponibilidade

operationId: `updateAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `status` _string_
- `is_accepting_leads` _boolean_
- `max_concurrent_leads` _integer_

**Respostas**

- `200` Disponibilidade atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /availability/{userId}`

Obter disponibilidade de um usuario

operationId: `getUserAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `userId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Disponibilidade do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Usuario nao encontrado -> ErrorResponse

## Chat Categories

### `GET /chat-categories`

Listar categorias de chat

operationId: `listChatCategories`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de categorias -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /chat-categories`

Criar categoria de chat

operationId: `createChatCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `keywords` _string[]_
- `is_active` _boolean_

**Respostas**

- `201` Categoria criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /chat-categories/{id}`

Atualizar categoria de chat

operationId: `updateChatCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `keywords` _string[]_
- `is_active` _boolean_

**Respostas**

- `200` Categoria atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Categoria nao encontrada -> ErrorResponse

### `DELETE /chat-categories/{id}`

Remover categoria de chat

operationId: `deleteChatCategory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Categoria removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Categoria nao encontrada -> ErrorResponse

## Companies

### `GET /companies`

Listar empresas do usuario

operationId: `listCompanies`

**Respostas**

- `200` Lista de empresas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /companies`

Criar nova empresa

operationId: `createCompany`

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `icon` _string_

**Respostas**

- `201` Empresa criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /companies/{id}`

Detalhes da empresa

operationId: `getCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da empresa -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `PUT /companies/{id}`

Atualizar empresa

operationId: `updateCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `icon` _string_
- `slug` _string_
- `logo_url` _string<uri>_

**Respostas**

- `200` Empresa atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `DELETE /companies/{id}`

Remover empresa

operationId: `deleteCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Empresa removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `GET /companies/{id}/members`

Listar membros da empresa

operationId: `listCompanyMembers`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de membros -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `POST /companies/{id}/members`

Adicionar membro a empresa

operationId: `addCompanyMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**
- `full_name` _string_ **obrigatorio**
- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `201` Membro adicionado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /companies/{id}/members/{userId}`

Alterar role de membro da empresa

operationId: `updateCompanyMemberRole`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `userId` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `200` Role atualizado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Membro nao encontrado -> ErrorResponse

### `DELETE /companies/{id}/members/{userId}`

Remover membro da empresa

operationId: `removeCompanyMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `userId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Membro removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Membro nao encontrado -> ErrorResponse

### `GET /companies/{id}/invites`

Listar convites da empresa

operationId: `listCompanyInvites`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de convites -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /companies/{id}/invites`

Enviar convite para a empresa

operationId: `sendCompanyInvite`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `201` Convite enviado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /companies/{id}/invites/{inviteId}`

Cancelar convite

operationId: `cancelCompanyInvite`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `inviteId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Convite cancelado -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Convite nao encontrado -> ErrorResponse

### `POST /invites/accept`

Aceitar convite de empresa

operationId: `acceptInvite`

**Body** (`application/json`, obrigatorio)

- `token` _string_ **obrigatorio**

**Respostas**

- `200` Convite aceito -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `PUT /companies/{id}/zapi-token`

Configurar token Z-API da empresa

operationId: `updateCompanyZapiToken`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `account_token` _string_ **obrigatorio**

**Respostas**

- `200` Token atualizado -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

## Connections

### `GET /connections`

Listar conexoes

operationId: `listConnections`

**Respostas**

- `200` Lista de conexoes -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /connections/{id}`

Detalhes da conexao

operationId: `getConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da conexao -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `DELETE /connections/{id}`

Remover conexao

operationId: `deleteConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Conexao removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `GET /connections/{id}/workspaces`

Listar workspaces da conexao

operationId: `listConnectionWorkspaces`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de workspaces -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `PUT /connections/{id}/workspaces`

Atualizar workspaces da conexao

operationId: `updateConnectionWorkspaces`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `workspace_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Workspaces atualizados -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /connections/{id}/health`

Verificar saude da conexao

operationId: `getConnectionHealth`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Status de saude -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

## CRM Activities

### `GET /crm/activities`

Listar atividades do CRM

Lista atividades (reunioes, demos, calls, etc.) com filtros por tipo, status e periodo. Suporta paginacao.

operationId: `listCRMActivities`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `type` | query | nao | string (meeting \| demo \| call \| reschedule \| task \| note \| email \| whatsapp) |  |
| `status` | query | nao | string (scheduled \| completed \| no_show \| cancelled \| pending \| rescheduled) |  |
| `start_date` | query | nao | string<date-time> | Filtro por scheduled_at >= start_date (ISO 8601) |
| `end_date` | query | nao | string<date-time> |  |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista paginada de atividades -> PaginatedResponse

### `GET /crm/activities/stats`

Estatisticas de reunioes (paridade com Analytics interno)

Retorna estatisticas agregadas de atividades do tipo `meeting`, `demo` e `reschedule`,
replicando 100% a logica do Analytics interno (baseada em `crm_lead_activities.status`).
Inclui drill-down via `lead_ids` e `activity_ids`.

operationId: `getCRMActivitiesStats`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |

**Respostas**

- `200` Estatisticas + IDs para drill-down -> SuccessResponse & object

## CRM Automove

### `GET /crm/automove-rules`

Listar regras de automove

operationId: `listCRMAutomoveRules`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de regras -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/automove-rules`

Criar regra de automove

operationId: `createCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `source_stage_id` _string<uuid>_ **obrigatorio**
- `target_stage_id` _string<uuid>_ **obrigatorio**
- `condition_type` _string_ **obrigatorio**
- `condition_value` _string_
- `is_active` _boolean_

**Respostas**

- `201` Regra criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/automove-rules/{id}`

Atualizar regra de automove

operationId: `updateCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `source_stage_id` _string<uuid>_
- `target_stage_id` _string<uuid>_
- `condition_type` _string_
- `condition_value` _string_
- `is_active` _boolean_

**Respostas**

- `200` Regra atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Regra nao encontrada -> ErrorResponse

### `DELETE /crm/automove-rules/{id}`

Remover regra de automove

operationId: `deleteCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Regra removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Regra nao encontrada -> ErrorResponse

### `GET /crm/automove-log`

Listar log de automove

operationId: `listCRMAutomoveLog`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Log de automove -> PaginatedResponse
- `401` Nao autenticado -> ErrorResponse

## CRM Contacts

### `GET /crm/contacts`

Listar contatos do CRM

operationId: `listCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `search` | query | nao | string | Termo de busca |
| `source` | query | nao | string |  |
| `status` | query | nao | string |  |
| `tags` | query | nao | string | Tags separadas por virgula |
| `sort` | query | nao | string | Campo de ordenacao |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de contatos -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/contacts`

Criar contato

operationId: `createCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `phone` _string_ **obrigatorio**
- `email` _string<email>_
- `source` _string_
- `company` _string_ - Nome da empresa do contato
- `job_title` _string_ - Cargo do contato
- `employee_count` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Porte da empresa (lista de seleção)
- `company_size` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Alias de employee_count (aceito na entrada). Mesmos valores do enum.
- `revenue` _string (Ate 100k/mes | Entre 100k e 500k/mes | Entre 500k e 1MM/mes | Entre 1MM e 3MM/mes | Entre 3MM e 5MM/mes | Acima de 5MM/mes)_ - Faturamento mensal estimado (lista de seleção)
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_

**Respostas**

- `201` Contato criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /crm/contacts/upsert`

Criar ou atualizar contato (upsert por telefone/e-mail)

Busca um contato existente na empresa pelo telefone ou e-mail informado. Se encontrar, sobrescreve os campos enviados e reativa o contato caso esteja inativo. Se nao encontrar, cria um novo contato (campo 'name' obrigatorio). A resposta inclui 'meta.created' e 'meta.updated'.

operationId: `upsertCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ - Obrigatorio quando o contato ainda nao existe
- `phone` _string_ - Telefone (normalizado com DDI 55). Obrigatorio se 'email' nao for enviado
- `email` _string<email>_ - Obrigatorio se 'phone' nao for enviado
- `source` _string_
- `company` _string_
- `job_title` _string_
- `position` _string_
- `employee_count` _string_
- `company_size` _string_ - Alias de employee_count
- `revenue` _string_
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_
- `custom_fields` _object_

**Respostas**

- `200` Contato existente atualizado -> SuccessResponse & object
- `201` Contato criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/contacts/{id}`

Detalhes do contato

operationId: `getCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do contato -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `PUT /crm/contacts/{id}`

Atualizar contato

operationId: `updateCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone` _string_
- `email` _string<email>_
- `source` _string_
- `company` _string_
- `job_title` _string_
- `employee_count` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_
- `company_size` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Alias de employee_count
- `revenue` _string (Ate 100k/mes | Entre 100k e 500k/mes | Entre 500k e 1MM/mes | Entre 1MM e 3MM/mes | Entre 3MM e 5MM/mes | Acima de 5MM/mes)_
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_

**Respostas**

- `200` Contato atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `DELETE /crm/contacts/{id}`

Remover contato

operationId: `deleteCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Contato removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `POST /crm/contacts/import`

Importar contatos via CSV

operationId: `importCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Importacao iniciada -> SuccessResponse
- `400` Arquivo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/contacts/export`

Exportar contatos em CSV

operationId: `exportCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Arquivo CSV com contatos
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/contacts/{id}/tags`

Atualizar tags do contato

operationId: `updateCRMContactTags`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `tags` _ContactTag[]_ **obrigatorio**
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**

**Respostas**

- `200` Tags atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `PUT /crm/contacts/{id}/opt-out`

Atualizar opt-out do contato

operationId: `updateCRMContactOptOut`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `is_opted_out` _boolean_ **obrigatorio**

**Respostas**

- `200` Opt-out atualizado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `POST /crm/contacts/backfill`

Backfill de contatos

operationId: `backfillCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Backfill concluido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

## CRM Funnel

### `GET /crm/funnel/stats`

Estatisticas do funil (paridade com Analytics interno)

Retorna o funil completo replicando 100% a logica usada no Analytics interno do Nexus
(componentes `useCRMAnalytics` + `FunnelStageLeadsDialog`).

Para cada etapa retorna:
- **current_count**: snapshot atual de leads `status=open` no estagio
- **period_count**: leads que ENTRARAM no estagio durante [start_date, end_date) via `crm_lead_history.to_stage_id`
- **current_lead_ids / period_lead_ids**: drill-down qualitativo

Tambem retorna `won` / `lost` agregados a partir de `crm_lead_history.action`
(`won|marked_won|closed_won` e `lost|marked_lost|closed_lost`) com fallback para
`crm_leads.status` + `closed_at` — cards fechados sem registro no historico entram
no agregado do mesmo jeito. Retorna ainda a taxa de conversao entre etapas adjacentes.

**NAO use mais `/crm/leads` paginado para montar o funil** — esse metodo ignora paginacao
>1000, leads `won/lost` parados em estagios intermediarios, e a metrica de periodo (PROJ).

operationId: `getCRMFunnelStats`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Default = ultimos 30 dias |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `assigned_to` | query | nao | string<uuid> | Recorta o funil por dono atual do card (`crm_leads.assigned_to`). Alias: `seller_id`. Ausente = agregado do workspace. Para comparar todos os vendedores de uma vez use `GET /analytics/funnel-by-seller`.  |
| `include_ids` | query | nao | boolean | Se `false`, omite arrays de IDs para resposta menor |

**Respostas**

- `200` Funil agregado com drill-down por etapa -> SuccessResponse & object

## CRM Loss Reasons

### `GET /crm/loss-reasons`

Listar motivos de perda

operationId: `listCRMLossReasons`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de motivos de perda -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/loss-reasons`

Criar motivo de perda

operationId: `createCRMLossReason`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `is_active` _boolean_

**Respostas**

- `201` Motivo de perda criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/loss-reasons/{id}`

Atualizar motivo de perda

operationId: `updateCRMLossReason`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `is_active` _boolean_

**Respostas**

- `200` Motivo de perda atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Motivo nao encontrado -> ErrorResponse

### `DELETE /crm/loss-reasons/{id}`

Remover motivo de perda

operationId: `deleteCRMLossReason`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Motivo removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Motivo nao encontrado -> ErrorResponse

## CRM Performance

### `GET /crm/performance/ranking`

Ranking de desempenho dos vendedores no atendimento

Ranking dos vendedores pelo score medio das avaliacoes de atendimento
(reunioes, demonstracoes e ligacoes avaliadas contra um playbook).

- **avg_score**: media 0-100 das avaliacoes concluidas no periodo
- **trend**: media da segunda metade do periodo menos a da primeira, em PONTOS de score
- **recurrent_points**: pontos de desenvolvimento com status `recurrent` (falhas repetidas)

Reincidencia NAO reduz o score: ela e reportada a parte para manter as notas
comparaveis entre vendedores e ao longo do tempo.

Somente atendimentos com `status=done`, score preenchido e nao desconsiderados
pelo gestor entram no calculo.

operationId: `getCRMPerformanceRanking`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) | Ignorado quando `start_date` e informado |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `analysis_id` | query | nao | string<uuid> | Filtra por um tipo de analise (playbook) especifico |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Ranking ordenado por score medio (maior primeiro) -> SuccessResponse & object
- `400` start_date ou end_date invalidos
- `404` Sub-rota desconhecida em /crm/performance

### `GET /crm/performance/overview`

Visao geral do desempenho da equipe

Mesmos numeros da aba "Visao geral" de /crm/desempenho, no escopo da EMPRESA
dona do workspace informado.

- **company_average**: media 0-100 das avaliacoes concluidas no periodo (null se nao houver)
- **trend**: media da segunda metade do periodo menos a da primeira, em PONTOS
- **by_playbook**: media e volume por tipo de analise
- **score_series**: media diaria (yyyy-MM-dd), em ordem cronologica
- **ranking**: mesma estrutura de /crm/performance/ranking, sem paginacao

Avaliacoes desconsideradas pelo gestor ficam fora de todos os calculos.

operationId: `getCRMPerformanceOverview`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `playbook_id` | query | nao | string<uuid> | Filtra por um tipo de analise (alias, `analysis_id`) |

**Respostas**

- `200` Agregados do periodo -> SuccessResponse & object
- `400` start_date ou end_date invalidos
- `404` Empresa nao encontrada para o workspace

### `GET /crm/performance/analyses`

Lista as avaliacoes de atendimento do periodo

Historico das avaliacoes do workspace, ordenado do atendimento mais recente
para o mais antigo (`occurred_at` = quando o atendimento aconteceu, nao
quando a IA avaliou).

Avaliacoes desconsideradas pelo gestor ficam de fora por padrao; use
`include_disregarded=true` para audita-las.

operationId: `listCRMPerformanceAnalyses`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `seller_id` | query | nao | string<uuid> |  |
| `playbook_id` | query | nao | string<uuid> |  |
| `lead_id` | query | nao | string<uuid> |  |
| `status` | query | nao | string (processing \| done \| failed) |  |
| `include_disregarded` | query | nao | boolean |  |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista paginada de avaliacoes -> SuccessResponse & object
- `400` start_date ou end_date invalidos

### `GET /crm/performance/analyses/{id}`

Detalhe completo de uma avaliacao

Retorna a avaliacao inteira: veredicto e evidencia por criterio, pontos fortes,
melhorias sugeridas, habitos observados, reincidencias e correcoes.

`evidence_verified=false` indica que o trecho citado nao foi localizado na
transcricao (a IA parafraseou) — o veredicto continua valido, a evidencia nao
serve como prova.

operationId: `getCRMPerformanceAnalysis`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Avaliacao completa -> SuccessResponse & object
- `404` Avaliacao nao encontrada neste workspace

### `GET /crm/performance/sellers/{sellerId}`

Painel de desempenho de um vendedor

Espelha o painel individual: media, tendencia, serie diaria de score, pontos de
desenvolvimento (abertos, recorrentes e corrigidos no periodo) e conquistas.

Um ponto corrigido pertence ao periodo da CORRECAO; abertos e recorrentes, ao
periodo da ultima ocorrencia.

operationId: `getCRMPerformanceSeller`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |
| `period` | query | nao | string (today \| 7d \| 30d \| 90d) |  |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `playbook_id` | query | nao | string<uuid> |  |

**Respostas**

- `200` Painel do vendedor -> SuccessResponse & object
- `404` Empresa nao encontrada para o workspace

### `GET /crm/performance/sellers/{sellerId}/development-points`

Pontos de desenvolvimento do vendedor

Todos os pontos rastreados do vendedor, sem recorte de periodo.

- `open`: apontado uma vez e ainda nao corrigido
- `recurrent`: voltou a ocorrer apos ja ter sido apontado
- `corrected`: atendido em uma avaliacao posterior

operationId: `listCRMPerformanceSellerPoints`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |
| `status` | query | nao | string (open \| recurrent \| corrected) |  |

**Respostas**

- `200` Pontos ordenados pela ultima ocorrencia -> SuccessResponse & object

### `GET /crm/performance/sellers/{sellerId}/brief`

Orientacao de coaching do vendedor

Ultimo brief de coaching gerado para o vendedor (material de gestao, em Markdown).
Retorna 404 quando nenhuma orientacao foi gerada ainda — a geracao acontece
sob demanda pelo gestor na tela de desempenho.

operationId: `getCRMPerformanceSellerBrief`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `sellerId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Brief mais recente -> SuccessResponse & object
- `404` Nenhuma orientacao gerada para este vendedor

### `GET /crm/performance/playbooks`

Analises (playbooks) cadastradas na empresa

Catalogo dos tipos de analise usados para avaliar atendimentos. Use o `id`
retornado aqui como `playbook_id` nos demais endpoints de desempenho.

operationId: `listCRMPerformancePlaybooks`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de analises da empresa -> SuccessResponse & object

### `GET /crm/performance/playbooks/{id}`

Analise com a rubrica ativa e seus criterios

Alem dos dados da analise, retorna a versao ATIVA da rubrica e os criterios
avaliados (com peso). O score e a soma ponderada dos veredictos calculada em
codigo — nunca pelo modelo.

operationId: `getCRMPerformancePlaybook`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Analise + rubrica ativa -> SuccessResponse & object
- `404` Analise nao encontrada nesta empresa

## CRM Pipeline

### `GET /crm/pipeline/stages`

Listar estagios do pipeline

operationId: `listCRMPipelineStages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de estagios -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/pipeline/stages`

Criar estagio no pipeline

operationId: `createCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `position` _integer_
- `color` _string_
- `is_default` _boolean_
- `is_won` _boolean_
- `is_lost` _boolean_

**Respostas**

- `201` Estagio criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/pipeline/stages/{id}`

Atualizar estagio do pipeline

operationId: `updateCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `position` _integer_
- `color` _string_
- `is_default` _boolean_
- `is_won` _boolean_
- `is_lost` _boolean_

**Respostas**

- `200` Estagio atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Estagio nao encontrado -> ErrorResponse

### `DELETE /crm/pipeline/stages/{id}`

Remover estagio do pipeline

operationId: `deleteCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Estagio removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Estagio nao encontrado -> ErrorResponse

### `PUT /crm/pipeline/stages/reorder`

Reordenar estagios do pipeline

operationId: `reorderCRMPipelineStages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `stage_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Estagios reordenados -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /crm/leads`

Listar leads do CRM

operationId: `listCRMLeads`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `stage_id` | query | nao | string<uuid> |  |
| `search` | query | nao | string | Termo de busca |
| `assigned_to` | query | nao | string<uuid> |  |
| `product_id` | query | nao | string<uuid> |  |
| `tags` | query | nao | string |  |
| `source` | query | nao | string | Filtra pela origem do contato vinculado (crm_contacts.source). |
| `utm_source` | query | nao | string | Filtra pelo UTM Source do card. Alias aceito&#58; `channel`. |
| `channel` | query | nao | string | Alias de `utm_source` (campo exibido como "Canal" no card). |
| `utm_medium` | query | nao | string |  |
| `utm_campaign` | query | nao | string |  |
| `include_incomplete_contacts` | query | nao | boolean | Quando `false` (padrao), aplica os mesmos filtros da UI do Pipeline: exclui leads cujo contato esteja sem nome ou com nome generico (Visitante Widget, Visitante, Contato, Anonimo, Lead) e sem email/telefone. Use `true` para receber todos os leads da etapa, ignorando esses filtros de qualidade de contato.  |
| `sort` | query | nao | string | Campo de ordenacao |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de leads do CRM -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/leads`

Criar lead no CRM

operationId: `createCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_ **obrigatorio**
- `stage_id` _string<uuid>_ **obrigatorio**
- `title` _string_
- `value` _number<double>_
- `product_id` _string<uuid>_
- `assigned_to` _string<uuid>_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem do lead. Validada contra as origens ATIVAS cadastradas em /settings/company > "Origens do Lead" (GET /crm/contact-sources). Valores fora da lista sao registrados como "Nao identificado" (com aviso em meta.warnings). Aplicada ao contato quando ele ainda nao possui origem.
- `channel` _string_ - Canal do card (exibido como "Canal" no detalhe do lead). Alias de utm_source; se ambos forem enviados, utm_source prevalece.
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_ - Tags aplicadas ao contato do lead (max. 20 por requisicao, 50 caracteres cada). Tags ja existentes sao ignoradas e retornadas em meta.tags_skipped.
- `note` _string_ - Nota registrada na timeline do card (aparece em "Notas e atualizacoes"). O id gerado retorna em meta.note_id.
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.

**Respostas**

- `201` Lead criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /crm/leads/upsert`

Criar ou atualizar card do pipeline (upsert)

Atualiza o card existente ou cria um novo. A resolucao do card segue
esta ordem: `lead_id`/`id` informado, senao o card **aberto** do
`contact_id` no workspace. Quando nenhum card e encontrado, um novo e
criado (nesse caso `stage_id` e obrigatorio).

Aceita `source` (origem), `channel` (canal), `utm_*`, `tags`, `note` e
`segment`/`segment_id`.

operationId: `upsertCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_
- `stage_id` _string<uuid>_ - Ao mudar de etapa, a movimentacao e registrada no historico do card.
- `title` _string_
- `value` _number<double>_
- `assigned_to` _string<uuid>_
- `product_id` _string<uuid>_
- `loss_reason_id` _string<uuid>_
- `status` _string_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem validada contra "Origens do Lead". Aplicada ao contato somente quando ele ainda nao possui origem.
- `channel` _string_ - Alias de utm_source (campo "Canal" do card).
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_
- `note` _string_
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.
- `lead_id` _string<uuid>_ - Id do card a atualizar. Se omitido, o card aberto do contact_id no workspace e usado; se nao existir, um novo card e criado (stage_id obrigatorio nesse caso).

**Respostas**

- `200` Card atualizado -> SuccessResponse & object
- `201` Card criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/leads/without-appointment`

Leads em uma etapa sem reuniao agendada

Retorna os leads de uma etapa do pipeline que **nao possuem reuniao
agendada** (`crm_appointments` ativo). Aplica os mesmos filtros da UI
do Pipeline (ver `include_incomplete_contacts` em `GET /crm/leads`).

Se `stage_id` for omitido, o backend resolve automaticamente a etapa
`MQL - Reuniao agendada` no workspace informado.

Por padrao considera apenas reunioes futuras (`start_time >= now()`),
ignorando agendamentos `cancelled`. Use `include_past=true` para
considerar tambem reunioes passadas (qualquer agendamento nao
cancelado serve como "tem reuniao").

operationId: `listCRMLeadsWithoutAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `stage_id` | query | nao | string<uuid> | UUID da etapa. Se omitido, usa "MQL - Reuniao agendada". |
| `include_incomplete_contacts` | query | nao | boolean | Mesmo comportamento de `GET /crm/leads`. |
| `include_past` | query | nao | boolean | Quando true, considera tambem reunioes passadas (nao cancelladas) como "tem reuniao". |

**Respostas**

- `200` Lista de leads sem reuniao agendada na etapa -> object
- `401` Nao autenticado -> ErrorResponse
- `404` Etapa nao encontrada -> ErrorResponse

### `GET /crm/leads/{id}`

Detalhes do lead do CRM

operationId: `getCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do lead -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}`

Atualizar lead do CRM

operationId: `updateCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_
- `stage_id` _string<uuid>_ - Ao mudar de etapa, a movimentacao e registrada no historico do card.
- `title` _string_
- `value` _number<double>_
- `assigned_to` _string<uuid>_
- `product_id` _string<uuid>_
- `loss_reason_id` _string<uuid>_
- `status` _string_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem validada contra "Origens do Lead". Aplicada ao contato somente quando ele ainda nao possui origem.
- `channel` _string_ - Alias de utm_source (campo "Canal" do card).
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_
- `note` _string_
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.

**Respostas**

- `200` Lead atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/stage`

Mover lead para outro estagio

operationId: `moveCRMLeadStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `stage_id` _string<uuid>_ **obrigatorio**
- `loss_reason_id` _string<uuid>_

**Respostas**

- `200` Lead movido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/assign`

Atribuir lead do CRM

operationId: `assignCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `user_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Lead atribuido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/utm`

Ler UTMs, canal e origem do lead

Retorna os UTMs e o canal do card, alem da origem (source) do contato vinculado.

operationId: `getCRMLeadUtm`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` UTMs do lead -> object
- `404` Lead nao encontrado -> ErrorResponse

### `PATCH /crm/leads/{id}/utm`

Atualizar somente UTMs/canal do lead

Atualiza apenas os campos de UTM enviados, sem precisar reenviar o card completo.

operationId: `updateCRMLeadUtm`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `channel` _string_ nullable - Alias de utm_source
- `utm_source` _string_ nullable
- `utm_medium` _string_ nullable
- `utm_campaign` _string_ nullable
- `utm_content` _string_ nullable
- `utm_term` _string_ nullable

**Respostas**

- `200` UTMs atualizados -> object
- `400` Nenhum campo de UTM informado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/history`

Historico do lead

operationId: `getCRMLeadHistory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Historico do lead -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/activities`

Listar atividades do lead

operationId: `listCRMLeadActivities`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de atividades -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /crm/leads/{id}/activities`

Criar atividade do lead

operationId: `createCRMLeadActivity`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `type` _string_ **obrigatorio**
- `title` _string_ **obrigatorio**
- `description` _string_
- `due_date` _string<date-time>_

**Respostas**

- `201` Atividade criada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/activities/{actId}`

Atualizar atividade do lead

operationId: `updateCRMLeadActivity`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |
| `actId` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `type` _string_
- `title` _string_
- `description` _string_
- `due_date` _string<date-time>_

**Respostas**

- `200` Atividade atualizada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Atividade nao encontrada -> ErrorResponse

## CRM Products

### `GET /crm/products`

Listar produtos do CRM

operationId: `listCRMProducts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de produtos -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/products`

Criar produto

operationId: `createCRMProduct`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `price` _number<double>_
- `is_active` _boolean_

**Respostas**

- `201` Produto criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/products/{id}`

Atualizar produto

operationId: `updateCRMProduct`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `price` _number<double>_
- `is_active` _boolean_

**Respostas**

- `200` Produto atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Produto nao encontrado -> ErrorResponse

### `DELETE /crm/products/{id}`

Remover produto

operationId: `deleteCRMProduct`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Produto removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Produto nao encontrado -> ErrorResponse

## CRM Psychology

### `GET /crm/leads/{id}/psychology`

Obter perfil psicologico do lead

operationId: `getCRMLeadPsychology`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Perfil psicologico -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /crm/leads/{id}/psychology/analyze`

Analisar perfil psicologico do lead

operationId: `analyzeCRMLeadPsychology`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Analise concluida -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

## CRM Tags

### `GET /crm/tags`

Listar tags do workspace

operationId: `listCRMTags`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de tags -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /crm/tags/rename`

Renomear tag

operationId: `renameCRMTag`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `old_name` _string_ **obrigatorio**
- `new_name` _string_ **obrigatorio**

**Respostas**

- `200` Tag renomeada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /crm/tags/{name}`

Remover tag

operationId: `deleteCRMTag`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `name` | path | sim | string |  |

**Respostas**

- `200` Tag removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Tag nao encontrada -> ErrorResponse

## Google Calendar

### `GET /integrations/google-calendar/auth-url`

Obter URL de autorizacao do Google Calendar

operationId: `getGoogleCalendarAuthUrl`

**Respostas**

- `200` URL de autorizacao -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /integrations/google-calendar/callback`

Callback de autorizacao do Google Calendar

operationId: `googleCalendarCallback`

**Body** (`application/json`, obrigatorio)

- `code` _string_ **obrigatorio**

**Respostas**

- `200` Integracao concluida -> SuccessResponse
- `400` Codigo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /integrations/google-calendar/status`

Status da integracao Google Calendar

operationId: `getGoogleCalendarStatus`

**Respostas**

- `200` Status da integracao -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `DELETE /integrations/google-calendar`

Desconectar Google Calendar

operationId: `disconnectGoogleCalendar`

**Respostas**

- `200` Integracao removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

## Inbox

### `GET /inbox/leads`

Listar leads da caixa de entrada

operationId: `listInboxLeads`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `status` | query | nao | string (new \| ai_talking \| needs_human \| human_talking \| closed) |  |
| `search` | query | nao | string | Termo de busca |
| `sort` | query | nao | string | Campo de ordenacao |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de leads -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /inbox/leads/{id}`

Detalhes do lead

operationId: `getInboxLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do lead -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /inbox/leads/{id}`

Atualizar lead

operationId: `updateInboxLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone` _string_
- `notes` _string_
- `tags` _string[]_

**Respostas**

- `200` Lead atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /inbox/leads/{id}/status`

Alterar status do lead

operationId: `updateInboxLeadStatus`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `status` _string (new | ai_talking | needs_human | human_talking | closed)_ **obrigatorio**

**Respostas**

- `200` Status atualizado -> SuccessResponse
- `400` Status invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /inbox/leads/{id}/assign`

Atribuir lead a um atendente

operationId: `assignInboxLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `user_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Lead atribuido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /inbox/leads/{id}/transfer`

Transferir lead para outro agente

operationId: `transferInboxLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `target_agent_id` _string<uuid>_ **obrigatorio**
- `reason` _string_

**Respostas**

- `200` Lead transferido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /inbox/leads/{id}/resolve`

Resolver/encerrar lead

operationId: `resolveInboxLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lead resolvido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /inbox/leads/{id}/messages`

Listar mensagens do lead

operationId: `listInboxLeadMessages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de mensagens -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /inbox/leads/{id}/messages`

Enviar mensagem ao lead

operationId: `sendInboxLeadMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `content` _string_ **obrigatorio**
- `media_type` _string_
- `media_url` _string<uri>_

**Respostas**

- `201` Mensagem enviada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /inbox/leads/{id}/messages/{msgId}/transcribe`

Transcrever audio de mensagem

operationId: `transcribeInboxMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |
| `msgId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Transcricao concluida -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Mensagem nao encontrada -> ErrorResponse

### `GET /inbox/queue`

Obter fila de atendimento

operationId: `getInboxQueue`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Fila de atendimento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /inbox/queue/process`

Processar fila de atendimento

operationId: `processInboxQueue`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Fila processada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

## Internal

### `POST /internal/orchestrator`

Acionar orquestrador de IA

operationId: `triggerOrchestrator`

**Body** (`application/json`, obrigatorio)

- `message_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Orquestracao concluida -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/cron/health-check`

Cron de verificacao de saude das conexoes

operationId: `cronHealthCheck`

**Respostas**

- `200` Verificacao concluida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/cron/health-metrics`

Cron de metricas de saude

operationId: `cronHealthMetrics`

**Respostas**

- `200` Metricas coletadas -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/process-document`

Processar documento da base de conhecimento

operationId: `processDocument`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Documento processado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/process-pdf`

Processar documento PDF

operationId: `processPdf`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` PDF processado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/generate-embeddings`

Gerar embeddings de documento

operationId: `generateEmbeddings`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Embeddings gerados -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

## Knowledge Base

### `GET /knowledge-bases`

Listar bases de conhecimento

operationId: `listKnowledgeBases`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de bases de conhecimento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /knowledge-bases`

Criar base de conhecimento

operationId: `createKnowledgeBase`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_

**Respostas**

- `201` Base criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /knowledge-bases/{id}`

Detalhes da base de conhecimento

operationId: `getKnowledgeBase`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da base -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `PUT /knowledge-bases/{id}`

Atualizar base de conhecimento

operationId: `updateKnowledgeBase`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_

**Respostas**

- `200` Base atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `DELETE /knowledge-bases/{id}`

Remover base de conhecimento

operationId: `deleteKnowledgeBase`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Base removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `GET /knowledge-bases/{id}/documents`

Listar documentos da base

operationId: `listKnowledgeBaseDocuments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de documentos -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `POST /knowledge-bases/{id}/documents`

Fazer upload de documento

operationId: `uploadKnowledgeBaseDocument`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `201` Documento enviado -> SuccessResponse & object
- `400` Arquivo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `DELETE /knowledge-bases/{id}/documents/{docId}`

Remover documento da base

operationId: `deleteKnowledgeBaseDocument`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |
| `docId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Documento removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Documento nao encontrado -> ErrorResponse

### `GET /knowledge-bases/{id}/jobs`

Listar jobs de processamento da base

operationId: `listKnowledgeBaseJobs`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de jobs -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `POST /knowledge-bases/{id}/regenerate-embeddings`

Regenerar embeddings da base

operationId: `regenerateKnowledgeBaseEmbeddings`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Regeneracao iniciada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

### `POST /knowledge-bases/{id}/search`

Buscar na base de conhecimento

operationId: `searchKnowledgeBase`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `query` _string_ **obrigatorio**
- `limit` _integer_

**Respostas**

- `200` Resultados da busca -> SuccessResponse & object
- `400` Query invalida -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Base nao encontrada -> ErrorResponse

## Messaging

### `POST /messages/send`

Enviar mensagem

operationId: `sendMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `lead_id` _string<uuid>_ **obrigatorio**
- `content` _string_ **obrigatorio**
- `media_type` _string_
- `media_url` _string<uri>_

**Respostas**

- `201` Mensagem enviada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /messages/send-media`

Enviar mensagem com midia

operationId: `sendMediaMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `201` Mensagem enviada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

## Notifications

### `GET /notifications`

Listar notificacoes do usuario

operationId: `listNotifications`

**Respostas**

- `200` Lista de notificacoes -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /notifications/{id}/read`

Marcar notificacao como lida

operationId: `markNotificationRead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Notificacao marcada como lida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Notificacao nao encontrada -> ErrorResponse

### `PUT /notifications/read-all`

Marcar todas notificacoes como lidas

operationId: `markAllNotificationsRead`

**Respostas**

- `200` Notificacoes marcadas como lidas -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

## Routing

### `GET /routing/config`

Obter configuracao de roteamento

operationId: `getRoutingConfig`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Configuracao de roteamento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /routing/config`

Atualizar configuracao de roteamento

operationId: `updateRoutingConfig`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `strategy` _string (least_loaded | round_robin | skill_based | performance_based)_
- `auto_assign` _boolean_
- `fallback_agent_id` _string<uuid>_

**Respostas**

- `200` Configuracao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /routing/agent-assignments`

Obter atribuicoes de agentes

operationId: `getRoutingAgentAssignments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Atribuicoes de agentes -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `PUT /routing/agent-assignments`

Atualizar atribuicoes de agentes

operationId: `updateRoutingAgentAssignments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `assignments` _object[]_
  - `agent_id` _string<uuid>_
  - `category_ids` _string<uuid>[]_

**Respostas**

- `200` Atribuicoes atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

## Tools

### `GET /tools`

Listar ferramentas disponiveis

operationId: `listTools`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de ferramentas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /tools/{id}`

Detalhes da ferramenta

operationId: `getTool`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da ferramenta -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Ferramenta nao encontrada -> ErrorResponse

## Webhooks

### `GET /webhooks/whatsapp`

Verificacao de webhook WhatsApp

operationId: `verifyWhatsAppWebhook`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `hub.mode` | query | nao | string |  |
| `hub.verify_token` | query | nao | string |  |
| `hub.challenge` | query | nao | string |  |

**Respostas**

- `200` Verificacao concluida
- `403` Token invalido -> ErrorResponse

### `POST /webhooks/whatsapp`

Receber webhook WhatsApp

operationId: `receiveWhatsAppWebhook`

**Body** (`application/json`, obrigatorio)

- object

**Respostas**

- `200` Webhook processado -> SuccessResponse
- `400` Payload invalido -> ErrorResponse

### `GET /webhooks/zapi`

Verificacao de webhook Z-API

operationId: `verifyZapiWebhook`

**Respostas**

- `200` Webhook ativo -> SuccessResponse

### `POST /webhooks/zapi`

Receber webhook Z-API

operationId: `receiveZapiWebhook`

**Body** (`application/json`, obrigatorio)

- object

**Respostas**

- `200` Webhook processado -> SuccessResponse
- `400` Payload invalido -> ErrorResponse

## WhatsApp Official

### `POST /connections/whatsapp`

Criar conexao WhatsApp oficial

operationId: `createWhatsAppConnection`

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `phone_number` _string_ **obrigatorio**
- `workspace_id` _string<uuid>_

**Respostas**

- `201` Conexao criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /connections/whatsapp/{id}`

Atualizar conexao WhatsApp oficial

operationId: `updateWhatsAppConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone_number` _string_

**Respostas**

- `200` Conexao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/whatsapp/{id}/send`

Enviar mensagem via WhatsApp oficial

operationId: `sendWhatsAppMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `to` _string_ **obrigatorio**
- `content` _string_ **obrigatorio**
- `type` _string_ **obrigatorio**

**Respostas**

- `200` Mensagem enviada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

## Widgets

### `GET /widgets`

Listar widgets do workspace

operationId: `listWidgets`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de widgets -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /widgets`

Criar widget

operationId: `createWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `slug` _string_ **obrigatorio**
- `welcome_message` _string_
- `theme_color` _string_
- `position` _string_
- `is_active` _boolean_

**Respostas**

- `201` Widget criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /widgets/{id}`

Atualizar widget

operationId: `updateWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `slug` _string_
- `welcome_message` _string_
- `theme_color` _string_
- `position` _string_
- `is_active` _boolean_

**Respostas**

- `200` Widget atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Widget nao encontrado -> ErrorResponse

### `DELETE /widgets/{id}`

Remover widget

operationId: `deleteWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Widget removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Widget nao encontrado -> ErrorResponse

### `GET /public/widgets/{slug}`

Obter widget publico pelo slug

operationId: `getPublicWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `slug` | path | sim | string |  |

**Respostas**

- `200` Dados do widget -> SuccessResponse & object
- `404` Widget nao encontrado -> ErrorResponse

### `POST /public/widgets/{slug}/sessions`

Criar sessao no widget publico

operationId: `createPublicWidgetSession`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `slug` | path | sim | string |  |

**Body** (`application/json`)

- `visitor_name` _string_
- `visitor_email` _string_

**Respostas**

- `201` Sessao criada -> SuccessResponse
- `404` Widget nao encontrado -> ErrorResponse

## Workspaces

### `GET /workspaces`

Listar workspaces

operationId: `listWorkspaces`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `company_id` | query | nao | string<uuid> |  |

**Respostas**

- `200` Lista de workspaces -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /workspaces`

Criar workspace

operationId: `createWorkspace`

**Body** (`application/json`, obrigatorio)

- `company_id` _string<uuid>_ **obrigatorio**
- `name` _string_ **obrigatorio**
- `description` _string_
- `icon` _string_

**Respostas**

- `201` Workspace criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /workspaces/{id}`

Detalhes do workspace

operationId: `getWorkspace`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do workspace -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Workspace nao encontrado -> ErrorResponse

### `PUT /workspaces/{id}`

Atualizar workspace

operationId: `updateWorkspace`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `icon` _string_

**Respostas**

- `200` Workspace atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Workspace nao encontrado -> ErrorResponse

### `DELETE /workspaces/{id}`

Remover workspace

operationId: `deleteWorkspace`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Workspace removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Workspace nao encontrado -> ErrorResponse

### `GET /workspaces/{id}/members`

Listar membros do workspace

operationId: `listWorkspaceMembers`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de membros -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /workspaces/{id}/members`

Adicionar membro ao workspace

operationId: `addWorkspaceMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `user_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `201` Membro adicionado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /workspaces/{id}/members/{userId}`

Remover membro do workspace

operationId: `removeWorkspaceMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `userId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Membro removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Membro nao encontrado -> ErrorResponse

## Z-API

### `POST /connections/zapi`

Criar conexao Z-API

operationId: `createZapiConnection`

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_ **obrigatorio**
- `api_token` _string_ **obrigatorio**
- `workspace_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `201` Conexao Z-API criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /connections/zapi/{id}`

Atualizar conexao Z-API

operationId: `updateZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_
- `api_token` _string_
- `name` _string_

**Respostas**

- `200` Conexao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/zapi/validate`

Validar instancia Z-API

operationId: `validateZapiInstance`

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_ **obrigatorio**
- `api_token` _string_ **obrigatorio**

**Respostas**

- `200` Instancia validada -> SuccessResponse
- `400` Credenciais invalidas -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /connections/zapi/validate-token`

Validar token de conta Z-API

operationId: `validateZapiAccountToken`

**Body** (`application/json`, obrigatorio)

- `account_token` _string_ **obrigatorio**

**Respostas**

- `200` Token validado -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /connections/zapi/{id}/revalidate`

Revalidar conexao Z-API

operationId: `revalidateZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Conexao revalidada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/zapi/{id}/control`

Enviar comando de controle Z-API

operationId: `controlZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `action` _string_ **obrigatorio**
- `params` _object_

**Respostas**

- `200` Comando executado -> SuccessResponse
- `400` Comando invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `GET /connections/zapi/{id}/qrcode`

Obter QR code da conexao Z-API

operationId: `getZapiQRCode`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` QR code -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

