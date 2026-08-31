# Admin

Parte da API Nexus AI API. 6 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /admin/companies`

Listar todas as empresas (admin)

operationId: `adminListCompanies`

**Respostas**

- `200` Lista de empresas -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse

### `GET /admin/companies/{id}`

Detalhes da empresa (admin)

operationId: `adminGetCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Detalhes da empresa -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `PUT /admin/companies/{id}`

Atualizar empresa (admin)

operationId: `adminUpdateCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `slug` _string_
- `is_active` _boolean_

**Respostas**

- `200` Empresa atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `DELETE /admin/companies/{id}`

Remover empresa (admin)

operationId: `adminDeleteCompany`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Empresa removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Empresa nao encontrada -> ErrorResponse

### `GET /admin/users`

Listar todos os usuarios (admin)

operationId: `adminListUsers`

**Respostas**

- `200` Lista de usuarios -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse

### `PUT /admin/users/{id}/role`

Alterar role de usuario (admin)

operationId: `adminUpdateUserRole`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `role` _string (super_admin | admin | member)_ **obrigatorio**

**Respostas**

- `200` Role atualizado -> SuccessResponse
- `400` Role invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Requer super_admin -> ErrorResponse
- `404` Usuario nao encontrado -> ErrorResponse

