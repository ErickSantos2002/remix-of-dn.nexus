# Widgets

Parte da API Nexus AI API. 6 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /widgets`

Listar widgets do workspace

operationId: `listWidgets`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de widgets -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /widgets`

Criar widget

operationId: `createWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `slug` _string_ **obrigatorio**
- `welcome_message` _string_
- `theme_color` _string_
- `position` _string_
- `is_active` _boolean_

**Respostas**

- `201` Widget criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /widgets/{id}`

Atualizar widget

operationId: `updateWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `slug` _string_
- `welcome_message` _string_
- `theme_color` _string_
- `position` _string_
- `is_active` _boolean_

**Respostas**

- `200` Widget atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Widget nao encontrado -> ErrorResponse

### `DELETE /widgets/{id}`

Remover widget

operationId: `deleteWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Widget removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Widget nao encontrado -> ErrorResponse

### `GET /public/widgets/{slug}`

Obter widget publico pelo slug

operationId: `getPublicWidget`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `slug` | path | sim | string |  |

**Respostas**

- `200` Dados do widget -> SuccessResponse & object
- `404` Widget nao encontrado -> ErrorResponse

### `POST /public/widgets/{slug}/sessions`

Criar sessao no widget publico

operationId: `createPublicWidgetSession`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `slug` | path | sim | string |  |

**Body** (`application/json`)

- `visitor_name` _string_
- `visitor_email` _string_

**Respostas**

- `201` Sessao criada -> SuccessResponse
- `404` Widget nao encontrado -> ErrorResponse

