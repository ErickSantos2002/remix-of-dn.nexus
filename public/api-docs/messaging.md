# Messaging

Parte da API Nexus AI API. 2 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `POST /messages/send`

Enviar mensagem

operationId: `sendMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Body** (`application/json`, obrigatorio)

- `lead_id` _string<uuid>_ **obrigatorio**
- `content` _string_ **obrigatorio**
- `media_type` _string_
- `media_url` _string<uri>_

**Respostas**

- `201` Mensagem enviada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /messages/send-media`

Enviar mensagem com midia

operationId: `sendMediaMessage`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `X-Workspace-Id` | header | sim | string<uuid> | ID do workspace ativo |

**Respostas**

- `201` Mensagem enviada -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

