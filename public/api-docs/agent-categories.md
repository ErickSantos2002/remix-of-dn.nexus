# Agent Categories

Parte da API Nexus AI API. 4 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

