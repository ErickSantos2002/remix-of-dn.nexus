# Internal

Parte da API Nexus AI API. 6 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `POST /internal/orchestrator`

Acionar orquestrador de IA

operationId: `triggerOrchestrator`

**Body** (`application/json`, obrigatorio)

- `message_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Orquestracao concluida -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/cron/health-check`

Cron de verificacao de saude das conexoes

operationId: `cronHealthCheck`

**Respostas**

- `200` Verificacao concluida -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/cron/health-metrics`

Cron de metricas de saude

operationId: `cronHealthMetrics`

**Respostas**

- `200` Metricas coletadas -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/process-document`

Processar documento da base de conhecimento

operationId: `processDocument`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Documento processado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/process-pdf`

Processar documento PDF

operationId: `processPdf`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` PDF processado -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /internal/generate-embeddings`

Gerar embeddings de documento

operationId: `generateEmbeddings`

**Body** (`application/json`, obrigatorio)

- `document_id` _string<uuid>_ **obrigatorio**

**Respostas**

- `200` Embeddings gerados -> SuccessResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

