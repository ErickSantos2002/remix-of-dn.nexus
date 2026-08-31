# CRM Psychology

Parte da API Nexus AI API. 2 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/leads/{id}/psychology`

Obter perfil psicologico do lead

operationId: `getCRMLeadPsychology`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Perfil psicologico -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /crm/leads/{id}/psychology/analyze`

Analisar perfil psicologico do lead

operationId: `analyzeCRMLeadPsychology`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Analise concluida -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

