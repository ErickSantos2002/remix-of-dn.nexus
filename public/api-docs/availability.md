# Availability

Parte da API Nexus AI API. 3 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /availability`

Obter disponibilidade do usuario

operationId: `getAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Disponibilidade do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /availability`

Atualizar disponibilidade

operationId: `updateAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `status` _string_
- `is_accepting_leads` _boolean_
- `max_concurrent_leads` _integer_

**Respostas**

- `200` Disponibilidade atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /availability/{userId}`

Obter disponibilidade de um usuario

operationId: `getUserAvailability`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `userId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Disponibilidade do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Usuario nao encontrado -> ErrorResponse

