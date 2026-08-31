# Workspaces

Parte da API Nexus AI API. 8 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

