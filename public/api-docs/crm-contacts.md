# CRM Contacts

Parte da API Nexus AI API. 11 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /crm/contacts`

Listar contatos do CRM

operationId: `listCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `search` | query | nao | string | Termo de busca |
| `source` | query | nao | string |  |
| `status` | query | nao | string |  |
| `tags` | query | nao | string | Tags separadas por virgula |
| `sort` | query | nao | string | Campo de ordenacao |
| `page` | query | nao | integer | Pagina atual |
| `per_page` | query | nao | integer | Itens por pagina |

**Respostas**

- `200` Lista de contatos -> PaginatedResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /crm/contacts`

Criar contato

operationId: `createCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `phone` _string_ **obrigatorio**
- `email` _string<email>_
- `source` _string_
- `company` _string_ - Nome da empresa do contato
- `job_title` _string_ - Cargo do contato
- `employee_count` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Porte da empresa (lista de seleção)
- `company_size` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Alias de employee_count (aceito na entrada). Mesmos valores do enum.
- `revenue` _string (Ate 100k/mes | Entre 100k e 500k/mes | Entre 500k e 1MM/mes | Entre 1MM e 3MM/mes | Entre 3MM e 5MM/mes | Acima de 5MM/mes)_ - Faturamento mensal estimado (lista de seleção)
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_

**Respostas**

- `201` Contato criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /crm/contacts/upsert`

Criar ou atualizar contato (upsert por telefone/e-mail)

Busca um contato existente na empresa pelo telefone ou e-mail informado. Se encontrar, sobrescreve os campos enviados e reativa o contato caso esteja inativo. Se nao encontrar, cria um novo contato (campo 'name' obrigatorio). A resposta inclui 'meta.created' e 'meta.updated'.

operationId: `upsertCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `name` _string_ - Obrigatorio quando o contato ainda nao existe
- `phone` _string_ - Telefone (normalizado com DDI 55). Obrigatorio se 'email' nao for enviado
- `email` _string<email>_ - Obrigatorio se 'phone' nao for enviado
- `source` _string_
- `company` _string_
- `job_title` _string_
- `position` _string_
- `employee_count` _string_
- `company_size` _string_ - Alias de employee_count
- `revenue` _string_
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_
- `custom_fields` _object_

**Respostas**

- `200` Contato existente atualizado -> SuccessResponse & object
- `201` Contato criado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/contacts/{id}`

Detalhes do contato

operationId: `getCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes do contato -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `PUT /crm/contacts/{id}`

Atualizar contato

operationId: `updateCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone` _string_
- `email` _string<email>_
- `source` _string_
- `company` _string_
- `job_title` _string_
- `employee_count` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_
- `company_size` _string (Eu S.A. | 1-10 funcionarios | 11-50 funcionarios | 51-200 funcionarios | +200 funcionarios)_ - Alias de employee_count
- `revenue` _string (Ate 100k/mes | Entre 100k e 500k/mes | Entre 500k e 1MM/mes | Entre 1MM e 3MM/mes | Entre 3MM e 5MM/mes | Acima de 5MM/mes)_
- `tags` _ContactTag[]_
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**
- `notes` _string_

**Respostas**

- `200` Contato atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `DELETE /crm/contacts/{id}`

Remover contato

operationId: `deleteCRMContact`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Contato removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `POST /crm/contacts/import`

Importar contatos via CSV

operationId: `importCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Importacao iniciada -> SuccessResponse
- `400` Arquivo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /crm/contacts/export`

Exportar contatos em CSV

operationId: `exportCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `200` Arquivo CSV com contatos
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /crm/contacts/{id}/tags`

Atualizar tags do contato

operationId: `updateCRMContactTags`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `tags` _ContactTag[]_ **obrigatorio**
  - `name` _string_ **obrigatorio**
  - `color` _string_ **obrigatorio**

**Respostas**

- `200` Tags atualizadas -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `PUT /crm/contacts/{id}/opt-out`

Atualizar opt-out do contato

operationId: `updateCRMContactOptOut`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `is_opted_out` _boolean_ **obrigatorio**

**Respostas**

- `200` Opt-out atualizado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Contato nao encontrado -> ErrorResponse

### `POST /crm/contacts/backfill`

Backfill de contatos

operationId: `backfillCRMContacts`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `contact_ids` _string<uuid>[]_ **obrigatorio**

**Respostas**

- `200` Backfill concluido -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

