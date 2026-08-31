# Agent Calendars

Parte da API Nexus AI API. 5 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

