# Google Calendar

Parte da API Nexus AI API. 4 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /integrations/google-calendar/auth-url`

Obter URL de autorizacao do Google Calendar

operationId: `getGoogleCalendarAuthUrl`

**Respostas**

- `200` URL de autorizacao -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `POST /integrations/google-calendar/callback`

Callback de autorizacao do Google Calendar

operationId: `googleCalendarCallback`

**Body** (`application/json`, obrigatorio)

- `code` _string_ **obrigatorio**

**Respostas**

- `200` Integracao concluida -> SuccessResponse
- `400` Codigo invalido -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `GET /integrations/google-calendar/status`

Status da integracao Google Calendar

operationId: `getGoogleCalendarStatus`

**Respostas**

- `200` Status da integracao -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `DELETE /integrations/google-calendar`

Desconectar Google Calendar

operationId: `disconnectGoogleCalendar`

**Respostas**

- `200` Integracao removida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

