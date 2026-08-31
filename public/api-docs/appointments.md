# Appointments

Parte da API Nexus AI API. 8 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

