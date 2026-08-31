# WhatsApp Official

Parte da API Nexus AI API. 3 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `POST /connections/whatsapp`

Criar conexao WhatsApp oficial

operationId: `createWhatsAppConnection`

**Body** (`application/json`, obrigatorio)

- `name` _string_ **obrigatorio**
- `phone_number` _string_ **obrigatorio**
- `workspace_id` _string<uuid>_

**Respostas**

- `201` Conexao criada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse

### `PUT /connections/whatsapp/{id}`

Atualizar conexao WhatsApp oficial

operationId: `updateWhatsAppConnection`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone_number` _string_

**Respostas**

- `200` Conexao atualizada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `403` Sem permissao -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

### `POST /connections/whatsapp/{id}/send`

Enviar mensagem via WhatsApp oficial

operationId: `sendWhatsAppMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Body** (`application/json`, obrigatorio)

- `to` _string_ **obrigatorio**
- `content` _string_ **obrigatorio**
- `type` _string_ **obrigatorio**

**Respostas**

- `200` Mensagem enviada -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Conexao nao encontrada -> ErrorResponse

