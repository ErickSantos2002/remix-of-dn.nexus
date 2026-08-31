# CRM Tags

Parte da API Nexus AI API. 3 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/tags`

Listar tags do workspace

operationId: `listCRMTags`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de tags -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /crm/tags/rename`

Renomear tag

operationId: `renameCRMTag`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `old_name` _string_ **obrigatorio**
- `new_name` _string_ **obrigatorio**

**Respostas**

- `200` Tag renomeada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /crm/tags/{name}`

Remover tag

operationId: `deleteCRMTag`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `name` | path | sim | string |  |

**Respostas**

- `200` Tag removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Tag nao encontrada -> ErrorResponse

