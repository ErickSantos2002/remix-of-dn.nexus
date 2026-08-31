# Routing

Parte da API Nexus AI API. 4 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /routing/config`

Obter configuracao de roteamento

operationId: `getRoutingConfig`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Configuracao de roteamento -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /routing/config`

Atualizar configuracao de roteamento

operationId: `updateRoutingConfig`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `strategy` _string (least_loaded | round_robin | skill_based | performance_based)_
- `auto_assign` _boolean_
- `fallback_agent_id` _string<uuid>_

**Respostas**

- `200` Configuracao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /routing/agent-assignments`

Obter atribuicoes de agentes

operationId: `getRoutingAgentAssignments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Atribuicoes de agentes -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `PUT /routing/agent-assignments`

Atualizar atribuicoes de agentes

operationId: `updateRoutingAgentAssignments`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `assignments` _object[]_
  - `agent_id` _string<uuid>_
  - `category_ids` _string<uuid>[]_

**Respostas**

- `200` Atribuicoes atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

