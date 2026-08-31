# Webhooks

Parte da API Nexus AI API. 4 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /webhooks/whatsapp`

Verificacao de webhook WhatsApp

operationId: `verifyWhatsAppWebhook`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `hub.mode` | query | nao | string |  |
| `hub.verify_token` | query | nao | string |  |
| `hub.challenge` | query | nao | string |  |

**Respostas**

- `200` Verificacao concluida
- `403` Token invalido -> ErrorResponse

### `POST /webhooks/whatsapp`

Receber webhook WhatsApp

operationId: `receiveWhatsAppWebhook`

**Body** (`application/json`, obrigatorio)

- object

**Respostas**

- `200` Webhook processado -> SuccessResponse
- `400` Payload invalido -> ErrorResponse

### `GET /webhooks/zapi`

Verificacao de webhook Z-API

operationId: `verifyZapiWebhook`

**Respostas**

- `200` Webhook ativo -> SuccessResponse

### `POST /webhooks/zapi`

Receber webhook Z-API

operationId: `receiveZapiWebhook`

**Body** (`application/json`, obrigatorio)

- object

**Respostas**

- `200` Webhook processado -> SuccessResponse
- `400` Payload invalido -> ErrorResponse

