# Companies

Parte da API Nexus AI API. 14 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /companies`

Listar empresas do usuario

operationId: `listCompanies`

**Respostas**

- `200` Lista de empresas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /companies`

Criar nova empresa

operationId: `createCompany`

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `description` _string_
- `icon` _string_

**Respostas**

- `201` Empresa criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /companies/{id}`

Detalhes da empresa

operationId: `getCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da empresa -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `PUT /companies/{id}`

Atualizar empresa

operationId: `updateCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `description` _string_
- `icon` _string_
- `slug` _string_
- `logo_url` _string<uri>_

**Respostas**

- `200` Empresa atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `DELETE /companies/{id}`

Remover empresa

operationId: `deleteCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Empresa removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `GET /companies/{id}/members`

Listar membros da empresa

operationId: `listCompanyMembers`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de membros -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `POST /companies/{id}/members`

Adicionar membro a empresa

operationId: `addCompanyMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**
- `full_name` _string_ **obrigatorio**
- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `201` Membro adicionado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /companies/{id}/members/{userId}`

Alterar role de membro da empresa

operationId: `updateCompanyMemberRole`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `userId` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `200` Role atualizado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Membro nao encontrado -> ErrorResponse

### `DELETE /companies/{id}/members/{userId}`

Remover membro da empresa

operationId: `removeCompanyMember`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `userId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Membro removido -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Membro nao encontrado -> ErrorResponse

### `GET /companies/{id}/invites`

Listar convites da empresa

operationId: `listCompanyInvites`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Lista de convites -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `POST /companies/{id}/invites`

Enviar convite para a empresa

operationId: `sendCompanyInvite`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `role` _string (admin | member)_ **obrigatorio**

**Respostas**

- `201` Convite enviado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `DELETE /companies/{id}/invites/{inviteId}`

Cancelar convite

operationId: `cancelCompanyInvite`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |
| `inviteId` | path | sim | string<uuid> |  |

**Respostas**

- `200` Convite cancelado -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Convite nao encontrado -> ErrorResponse

### `POST /invites/accept`

Aceitar convite de empresa

operationId: `acceptInvite`

**Body** (`application/json`, obrigatorio)

- `token` _string_ **obrigatorio**

**Respostas**

- `200` Convite aceito -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `PUT /companies/{id}/zapi-token`

Configurar token Z-API da empresa

operationId: `updateCompanyZapiToken`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `account_token` _string_ **obrigatorio**

**Respostas**

- `200` Token atualizado -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

