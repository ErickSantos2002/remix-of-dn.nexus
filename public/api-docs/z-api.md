# Z-API

Parte da API Nexus AI API. 7 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `POST /connections/zapi`

Criar conexao Z-API

operationId: `createZapiConnection`

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_ **obrigatorio**
- `api_token` _string_ **obrigatorio**
- `workspace_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `201` Conexao Z-API criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /connections/zapi/{id}`

Atualizar conexao Z-API

operationId: `updateZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_
- `api_token` _string_
- `name` _string_

**Respostas**

- `200` Conexao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/zapi/validate`

Validar instancia Z-API

operationId: `validateZapiInstance`

**Body** (`application/json`, obrigatorio)

- `instance_id` _string_ **obrigatorio**
- `api_token` _string_ **obrigatorio**

**Respostas**

- `200` Instancia validada -> SuccessResponse
- `400` Credenciais invalidas -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /connections/zapi/validate-token`

Validar token de conta Z-API

operationId: `validateZapiAccountToken`

**Body** (`application/json`, obrigatorio)

- `account_token` _string_ **obrigatorio**

**Respostas**

- `200` Token validado -> SuccessResponse
- `400` Token invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /connections/zapi/{id}/revalidate`

Revalidar conexao Z-API

operationId: `revalidateZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Conexao revalidada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/zapi/{id}/control`

Enviar comando de controle Z-API

operationId: `controlZapiConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `action` _string_ **obrigatorio**
- `params` _object_

**Respostas**

- `200` Comando executado -> SuccessResponse
- `400` Comando invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `GET /connections/zapi/{id}/qrcode`

Obter QR code da conexao Z-API

operationId: `getZapiQRCode`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` QR code -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

