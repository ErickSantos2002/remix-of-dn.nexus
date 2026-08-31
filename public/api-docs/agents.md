# Agents

Parte da API Nexus AI API. 10 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

