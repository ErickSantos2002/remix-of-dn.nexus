# CRM Automove

Parte da API Nexus AI API. 5 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/automove-rules`

Listar regras de automove

operationId: `listCRMAutomoveRules`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de regras -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/automove-rules`

Criar regra de automove

operationId: `createCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `source_stage_id` _string<uuid>_ **obrigatorio**
- `target_stage_id` _string<uuid>_ **obrigatorio**
- `condition_type` _string_ **obrigatorio**
- `condition_value` _string_
- `is_active` _boolean_

**Respostas**

- `201` Regra criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/automove-rules/{id}`

Atualizar regra de automove

operationId: `updateCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `source_stage_id` _string<uuid>_
- `target_stage_id` _string<uuid>_
- `condition_type` _string_
- `condition_value` _string_
- `is_active` _boolean_

**Respostas**

- `200` Regra atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Regra nao encontrada -> ErrorResponse

### `DELETE /crm/automove-rules/{id}`

Remover regra de automove

operationId: `deleteCRMAutomoveRule`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Regra removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Regra nao encontrada -> ErrorResponse

### `GET /crm/automove-log`

Listar log de automove

operationId: `listCRMAutomoveLog`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Log de automove -> PaginatedResponse
- `401` Nao autenticado -> ErrorResponse

