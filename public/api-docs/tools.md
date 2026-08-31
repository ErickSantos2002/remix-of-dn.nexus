# Tools

Parte da API Nexus AI API. 2 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /tools`

Listar ferramentas disponiveis

operationId: `listTools`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de ferramentas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /tools/{id}`

Detalhes da ferramenta

operationId: `getTool`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da ferramenta -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Ferramenta nao encontrada -> ErrorResponse

