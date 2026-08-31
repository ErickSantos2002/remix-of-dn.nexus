# Analytics

Parte da API Nexus AI API. 10 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /analytics/overview`

Visao geral de metricas

operationId: `getAnalyticsOverview`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date> |  |
| `end_date` | query | nao | string<date> |  |

**Respostas**

- `200` Metricas gerais -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/sales-cycle`

Ciclo de compra (dias entre criacao do card e o ganho)

Retorna o tempo medio e mediano de fechamento dos cards ganhos (`status = won`) no periodo,
calculado como a diferenca entre `crm_leads.created_at` e `crm_leads.closed_at`.
Inclui distribuicao por faixas de dias, quebra por origem do contato e por canal (`utm_source`),
e comparacao com o periodo imediatamente anterior de mesma duracao.
Inclui tambem `by_month` - evolucao mes a mes dos ultimos 12 meses (won_count, avg_days, median_days),
independente do periodo informado, para leitura de tendencia.

operationId: `getAnalyticsSalesCycle`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Inicio do periodo (filtra por closed_at). Padrao - 30 dias atras. |
| `end_date` | query | nao | string<date-time> | Fim do periodo (filtra por closed_at). Padrao - agora. |
| `source` | query | nao | string | Filtra pela origem do contato (crm_contacts.source), case-insensitive. |
| `utm_source` | query | nao | string | Filtra pelo canal do card (alias - channel). |
| `channel` | query | nao | string | Alias de utm_source. |
| `compare` | query | nao | boolean | Quando false, nao calcula o periodo anterior. |

**Respostas**

- `200` Metricas de ciclo de compra -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/leads`

Metricas de leads

operationId: `getAnalyticsLeads`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de leads -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/messages`

Metricas de mensagens

operationId: `getAnalyticsMessages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de mensagens -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/funnel-by-seller`

Funil (Lead - MQL - SQL - Venda) fatiado por vendedor

Quebra do funil comercial **por vendedor** (dono do card em `crm_leads.assigned_to`),
com contagem por etapa e taxas de conversao. Alias: `/analytics/sellers`.

**Como cada numero e calculado**
- `leads_created`: cards do vendedor criados dentro de [start_date, end_date)
- `stage_counts[].count`: cards que ENTRARAM na etapa dentro da janela
  (primeira entrada registrada em `crm_lead_history.to_stage_id`)
- `won` / `lost`: `crm_leads.status = won|lost` com `closed_at` dentro da janela
- `avg_days_to_won`: media de dias entre `created_at` e `closed_at` dos ganhos
- `sequential_rates`: taxa entre etapas adjacentes na ordem do pipeline

**Atribuicao**: dono ATUAL do card (`attribution: current_owner`). Trocar o responsavel
reatribui o historico do lead retroativamente — nao ha snapshot do dono por transicao.

**Atencao a `stage_rates.lead_to_mql`**: o denominador sao os leads criados na janela,
mas o numerador inclui cards criados antes que viraram MQL agora. Por isso a taxa pode
passar de 100% em janelas curtas. Para conversao de coorte real use `/analytics/cohort`.

operationId: `getAnalyticsFunnelBySeller`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Default = ultimos 30 dias |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `assigned_to` | query | nao | string<uuid> | Filtra um unico vendedor (`profiles.id`). Alias: `seller_id`. Ausente = todos. |

**Respostas**

- `200` Funil por vendedor -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/sellers`

Alias de /analytics/funnel-by-seller

Mesma resposta de `GET /analytics/funnel-by-seller`.

operationId: `getAnalyticsSellers`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `assigned_to` | query | nao | string<uuid> |  |

**Respostas**

- `200` Funil por vendedor -> SuccessResponse

### `GET /analytics/cohort`

Coortes mensais de leads com conversao por etapa

Agrupa os cards por mes de criacao (coorte) e mede quantos alcancaram cada etapa,
alem do tempo medio ate cada etapa. Aceita recorte por vendedor e por UTM.

operationId: `getAnalyticsCohort`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `months_back` | query | nao | integer |  |
| `assigned_to` | query | nao | string<uuid> | Filtra pelo dono atual do card. Alias: `seller_id`. |
| `utm_source` | query | nao | string |  |
| `utm_campaign` | query | nao | string |  |

**Respostas**

- `200` Coortes com conversao por etapa -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/agents`

Desempenho comercial por vendedor (com etapas e taxas)

Por padrao retorna o desempenho dos **vendedores humanos** a partir de `crm_leads.assigned_to`
(mesma base de `/analytics/funnel-by-seller`), incluindo `stage_counts` e `stage_rates`.

Campos `agent_id`, `total` e `closed` sao mantidos por compatibilidade
(`total` = cards criados na janela, `closed` = ganhos + perdidos na janela).

Use `?source=ai` para o comportamento antigo: conversas da tabela `leads`
agrupadas por `assigned_agent_id` (agente de IA), retornando apenas `{agent_id, total, closed}`.

operationId: `getAnalyticsAgents`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> |  |
| `end_date` | query | nao | string<date-time> |  |
| `assigned_to` | query | nao | string<uuid> | Filtra um unico vendedor |
| `source` | query | nao | string (crm \| ai) | `crm` = vendedores humanos; `ai` = agentes de IA (formato legado) |

**Respostas**

- `200` Metricas por vendedor (ou por agente de IA quando `source=ai`) -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/delivery`

Metricas de entrega de mensagens

operationId: `getAnalyticsDelivery`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de entrega -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /analytics/connection-health`

Metricas de saude das conexoes

operationId: `getAnalyticsConnectionHealth`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Metricas de saude -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

