# Connections

Parte da API Nexus AI API. 6 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

