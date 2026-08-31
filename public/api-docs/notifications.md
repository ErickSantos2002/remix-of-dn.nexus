# Notifications

Parte da API Nexus AI API. 3 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `GET /notifications`

Listar notificacoes do usuario

operationId: `listNotifications`

**Respostas**

- `200` Lista de notificacoes -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /notifications/{id}/read`

Marcar notificacao como lida

operationId: `markNotificationRead`

**Parametros**

| Nome | Em | Obrigatorio | Tipo | Descricao |
| --- | --- | --- | --- | --- |
| `id` | path | sim | string<uuid> |  |

**Respostas**

- `200` Notificacao marcada como lida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse
- `404` Notificacao nao encontrada -> ErrorResponse

### `PUT /notifications/read-all`

Marcar todas notificacoes como lidas

operationId: `markAllNotificationsRead`

**Respostas**

- `200` Notificacoes marcadas como lidas -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

