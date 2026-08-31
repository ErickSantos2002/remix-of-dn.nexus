# CRM Pipeline

Parte da API Nexus AI API. 19 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/pipeline/stages`

Listar estagios do pipeline

operationId: `listCRMPipelineStages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Lista de estagios -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/pipeline/stages`

Criar estagio no pipeline

operationId: `createCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `position` _integer_
- `color` _string_
- `is_default` _boolean_
- `is_won` _boolean_
- `is_lost` _boolean_

**Respostas**

- `201` Estagio criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/pipeline/stages/{id}`

Atualizar estagio do pipeline

operationId: `updateCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `position` _integer_
- `color` _string_
- `is_default` _boolean_
- `is_won` _boolean_
- `is_lost` _boolean_

**Respostas**

- `200` Estagio atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Estagio nao encontrado -> ErrorResponse

### `DELETE /crm/pipeline/stages/{id}`

Remover estagio do pipeline

operationId: `deleteCRMPipelineStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Estagio removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Estagio nao encontrado -> ErrorResponse

### `PUT /crm/pipeline/stages/reorder`

Reordenar estagios do pipeline

operationId: `reorderCRMPipelineStages`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `stage_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Estagios reordenados -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `GET /crm/leads`

Listar leads do CRM

operationId: `listCRMLeads`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `stage_id` | query | nao | string<uuid> |  |
| `search` | query | nao | string | Termo de busca |
| `assigned_to` | query | nao | string<uuid> |  |
| `product_id` | query | nao | string<uuid> |  |
| `tags` | query | nao | string |  |
| `source` | query | nao | string | Filtra pela origem do contato vinculado (crm_contacts.source). |
| `utm_source` | query | nao | string | Filtra pelo UTM Source do card. Alias aceito&#58; `channel`. |
| `channel` | query | nao | string | Alias de `utm_source` (campo exibido como "Canal" no card). |
| `utm_medium` | query | nao | string |  |
| `utm_campaign` | query | nao | string |  |
| `include_incomplete_contacts` | query | nao | boolean | Quando `false` (padrao), aplica os mesmos filtros da UI do Pipeline: exclui leads cujo contato esteja sem nome ou com nome generico (Visitante Widget, Visitante, Contato, Anonimo, Lead) e sem email/telefone. Use `true` para receber todos os leads da etapa, ignorando esses filtros de qualidade de contato.  |
| `sort` | query | nao | string | Campo de ordenacao |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de leads do CRM -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/leads`

Criar lead no CRM

operationId: `createCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_ **obrigatorio**
- `stage_id` _string<uuid>_ **obrigatorio**
- `title` _string_
- `value` _number<double>_
- `product_id` _string<uuid>_
- `assigned_to` _string<uuid>_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem do lead. Validada contra as origens ATIVAS cadastradas em /settings/company > "Origens do Lead" (GET /crm/contact-sources). Valores fora da lista sao registrados como "Nao identificado" (com aviso em meta.warnings). Aplicada ao contato quando ele ainda nao possui origem.
- `channel` _string_ - Canal do card (exibido como "Canal" no detalhe do lead). Alias de utm_source; se ambos forem enviados, utm_source prevalece.
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_ - Tags aplicadas ao contato do lead (max. 20 por requisicao, 50 caracteres cada). Tags ja existentes sao ignoradas e retornadas em meta.tags_skipped.
- `note` _string_ - Nota registrada na timeline do card (aparece em "Notas e atualizacoes"). O id gerado retorna em meta.note_id.
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.

**Respostas**

- `201` Lead criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /crm/leads/upsert`

Criar ou atualizar card do pipeline (upsert)

Atualiza o card existente ou cria um novo. A resolucao do card segue
esta ordem: `lead_id`/`id` informado, senao o card **aberto** do
`contact_id` no workspace. Quando nenhum card e encontrado, um novo e
criado (nesse caso `stage_id` e obrigatorio).

Aceita `source` (origem), `channel` (canal), `utm_*`, `tags`, `note` e
`segment`/`segment_id`.

operationId: `upsertCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_
- `stage_id` _string<uuid>_ - Ao mudar de etapa, a movimentacao e registrada no historico do card.
- `title` _string_
- `value` _number<double>_
- `assigned_to` _string<uuid>_
- `product_id` _string<uuid>_
- `loss_reason_id` _string<uuid>_
- `status` _string_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem validada contra "Origens do Lead". Aplicada ao contato somente quando ele ainda nao possui origem.
- `channel` _string_ - Alias de utm_source (campo "Canal" do card).
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_
- `note` _string_
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.
- `lead_id` _string<uuid>_ - Id do card a atualizar. Se omitido, o card aberto do contact_id no workspace e usado; se nao existir, um novo card e criado (stage_id obrigatorio nesse caso).

**Respostas**

- `200` Card atualizado -> SuccessResponse & object
- `201` Card criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/leads/without-appointment`

Leads em uma etapa sem reuniao agendada

Retorna os leads de uma etapa do pipeline que **nao possuem reuniao
agendada** (`crm_appointments` ativo). Aplica os mesmos filtros da UI
do Pipeline (ver `include_incomplete_contacts` em `GET /crm/leads`).

Se `stage_id` for omitido, o backend resolve automaticamente a etapa
`MQL - Reuniao agendada` no workspace informado.

Por padrao considera apenas reunioes futuras (`start_time >= now()`),
ignorando agendamentos `cancelled`. Use `include_past=true` para
considerar tambem reunioes passadas (qualquer agendamento nao
cancelado serve como "tem reuniao").

operationId: `listCRMLeadsWithoutAppointment`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `stage_id` | query | nao | string<uuid> | UUID da etapa. Se omitido, usa "MQL - Reuniao agendada". |
| `include_incomplete_contacts` | query | nao | boolean | Mesmo comportamento de `GET /crm/leads`. |
| `include_past` | query | nao | boolean | Quando true, considera tambem reunioes passadas (nao cancelladas) como "tem reuniao". |

**Respostas**

- `200` Lista de leads sem reuniao agendada na etapa -> object
- `401` Nao autenticado -> ErrorResponse
- `404` Etapa nao encontrada -> ErrorResponse

### `GET /crm/leads/{id}`

Detalhes do lead do CRM

operationId: `getCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do lead -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}`

Atualizar lead do CRM

operationId: `updateCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `contact_id` _string<uuid>_
- `stage_id` _string<uuid>_ - Ao mudar de etapa, a movimentacao e registrada no historico do card.
- `title` _string_
- `value` _number<double>_
- `assigned_to` _string<uuid>_
- `product_id` _string<uuid>_
- `loss_reason_id` _string<uuid>_
- `status` _string_
- `description` _string_
- `notes` _string_
- `source` _string_ - Origem validada contra "Origens do Lead". Aplicada ao contato somente quando ele ainda nao possui origem.
- `channel` _string_ - Alias de utm_source (campo "Canal" do card).
- `utm_source` _string_
- `utm_medium` _string_
- `utm_campaign` _string_
- `utm_content` _string_
- `utm_term` _string_
- `tags` _string[]_
- `note` _string_
- `segment` _string_ - Segmento de mercado (nome ou UUID). Validado contra os segmentos ATIVOS de /settings/company > "Segmentos". Valores fora do catalogo caem no segmento marcado como "Padrao" (aviso em meta.warnings). O segmento aplicado retorna em meta.segment.
- `segment_id` _string<uuid>_ - Id do segmento. Tem precedencia sobre `segment`.

**Respostas**

- `200` Lead atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/stage`

Mover lead para outro estagio

operationId: `moveCRMLeadStage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `stage_id` _string<uuid>_ **obrigatorio**
- `loss_reason_id` _string<uuid>_

**Respostas**

- `200` Lead movido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/assign`

Atribuir lead do CRM

operationId: `assignCRMLead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `user_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Lead atribuido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/utm`

Ler UTMs, canal e origem do lead

Retorna os UTMs e o canal do card, alem da origem (source) do contato vinculado.

operationId: `getCRMLeadUtm`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` UTMs do lead -> object
- `404` Lead nao encontrado -> ErrorResponse

### `PATCH /crm/leads/{id}/utm`

Atualizar somente UTMs/canal do lead

Atualiza apenas os campos de UTM enviados, sem precisar reenviar o card completo.

operationId: `updateCRMLeadUtm`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `channel` _string_ nullable - Alias de utm_source
- `utm_source` _string_ nullable
- `utm_medium` _string_ nullable
- `utm_campaign` _string_ nullable
- `utm_content` _string_ nullable
- `utm_term` _string_ nullable

**Respostas**

- `200` UTMs atualizados -> object
- `400` Nenhum campo de UTM informado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/history`

Historico do lead

operationId: `getCRMLeadHistory`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Historico do lead -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `GET /crm/leads/{id}/activities`

Listar atividades do lead

operationId: `listCRMLeadActivities`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de atividades -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `POST /crm/leads/{id}/activities`

Criar atividade do lead

operationId: `createCRMLeadActivity`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `type` _string_ **obrigatorio**
- `title` _string_ **obrigatorio**
- `description` _string_
- `due_date` _string<date-time>_

**Respostas**

- `201` Atividade criada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Lead nao encontrado -> ErrorResponse

### `PUT /crm/leads/{id}/activities/{actId}`

Atualizar atividade do lead

operationId: `updateCRMLeadActivity`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |
| `actId` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `type` _string_
- `title` _string_
- `description` _string_
- `due_date` _string<date-time>_

**Respostas**

- `200` Atividade atualizada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Atividade nao encontrada -> ErrorResponse

