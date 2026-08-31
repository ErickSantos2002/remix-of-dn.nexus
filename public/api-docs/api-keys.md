# API Keys

Parte da API Nexus AI API. 3 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

