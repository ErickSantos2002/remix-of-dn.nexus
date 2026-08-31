# CRM Funnel

Parte da API Nexus AI API. 1 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/funnel/stats`

Estatisticas do funil (paridade com Analytics interno)

Retorna o funil completo replicando 100% a logica usada no Analytics interno do Nexus
(componentes `useCRMAnalytics` + `FunnelStageLeadsDialog`).

Para cada etapa retorna:
- **current_count**: snapshot atual de leads `status=open` no estagio
- **period_count**: leads que ENTRARAM no estagio durante [start_date, end_date) via `crm_lead_history.to_stage_id`
- **current_lead_ids / period_lead_ids**: drill-down qualitativo

Tambem retorna `won` / `lost` agregados a partir de `crm_lead_history.action`
(`won|marked_won|closed_won` e `lost|marked_lost|closed_lost`) com fallback para
`crm_leads.status` + `closed_at` — cards fechados sem registro no historico entram
no agregado do mesmo jeito. Retorna ainda a taxa de conversao entre etapas adjacentes.

**NAO use mais `/crm/leads` paginado para montar o funil** — esse metodo ignora paginacao
>1000, leads `won/lost` parados em estagios intermediarios, e a metrica de periodo (PROJ).

operationId: `getCRMFunnelStats`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `start_date` | query | nao | string<date-time> | Default = ultimos 30 dias |
| `end_date` | query | nao | string<date-time> | Default = agora |
| `assigned_to` | query | nao | string<uuid> | Recorta o funil por dono atual do card (`crm_leads.assigned_to`). Alias: `seller_id`. Ausente = agregado do workspace. Para comparar todos os vendedores de uma vez use `GET /analytics/funnel-by-seller`.  |
| `include_ids` | query | nao | boolean | Se `false`, omite arrays de IDs para resposta menor |

**Respostas**

- `200` Funil agregado com drill-down por etapa -> SuccessResponse & object

