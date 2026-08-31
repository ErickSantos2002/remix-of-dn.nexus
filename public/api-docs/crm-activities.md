# CRM Activities

Parte da API Nexus AI API. 2 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/activities`

Listar atividades do CRM

Lista atividades (reunioes, demos, calls, etc.) com filtros por tipo, status e periodo. Suporta paginacao.

operationId: `listCRMActivities`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `type` | query | nao | string (meeting \| demo \| call \| reschedule \| task \| note \| email \| whatsapp) |  |
| `status` | query | nao | string (scheduled \| completed \| no_show \| cancelled \| pending \| rescheduled) |  |
| `start_date` | query | nao | string<date-time> | Filtro por scheduled_at >= start_date (ISO 8601) |
| `end_date` | query | nao | string<date-time> |  |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista paginada de atividades -> PaginatedResponse

### `GET /crm/activities/stats`

Estatisticas de reunioes (paridade com Analytics interno)

Retorna estatisticas agregadas de atividades do tipo `meeting`, `demo` e `reschedule`,
replicando 100% a logica do Analytics interno (baseada em `crm_lead_activities.status`).
Inclui drill-down via `lead_ids` e `activity_ids`.

operationId: `getCRMActivitiesStats`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |

**Respostas**

- `200` Estatisticas + IDs para drill-down -> SuccessResponse & object

