# Knowledge Base

Parte da API Nexus AI API. 11 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

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

