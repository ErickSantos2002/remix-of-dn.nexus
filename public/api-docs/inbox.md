# Inbox

Parte da API Nexus AI API. 12 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

