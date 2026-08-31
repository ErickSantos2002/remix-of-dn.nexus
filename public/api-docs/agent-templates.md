# Agent Templates

Parte da API Nexus AI API. 5 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

