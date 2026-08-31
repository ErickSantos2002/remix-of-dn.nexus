# Auth

Parte da API Nexus AI API. 7 endpoints.
Atualizado em: `2026-08-14T00:33:00-03:00`

Indice geral: https://nexus.dnia.ai/api-docs/index.md

### `POST /auth/login`

Login com email e senha

operationId: `authLogin`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**

**Respostas**

- `200` Login realizado com sucesso -> AuthTokenResponse
- `400` Dados invalidos -> ErrorResponse
- `401` Credenciais invalidas -> ErrorResponse

### `POST /auth/register`

Registrar novo usuario

operationId: `authRegister`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**
- `password` _string<password>_ **obrigatorio**
- `full_name` _string_ **obrigatorio** - Maps to 'name' in profiles table

**Respostas**

- `201` Usuario criado com sucesso -> AuthTokenResponse
- `400` Dados invalidos -> ErrorResponse

### `POST /auth/logout`

Encerrar sessao do usuario

operationId: `authLogout`

**Respostas**

- `200` Sessao encerrada -> SuccessResponse
- `401` Nao autenticado -> ErrorResponse

### `POST /auth/refresh`

Renovar token de acesso

operationId: `authRefreshToken`

**Body** (`application/json`, obrigatorio)

- `refresh_token` _string_ **obrigatorio**

**Respostas**

- `200` Token renovado -> AuthTokenResponse
- `400` Token invalido -> ErrorResponse

### `POST /auth/reset-password`

Solicitar reset de senha

operationId: `authResetPassword`

**Body** (`application/json`, obrigatorio)

- `email` _string<email>_ **obrigatorio**

**Respostas**

- `200` Email de reset enviado -> SuccessResponse
- `400` Email invalido -> ErrorResponse

### `GET /auth/me`

Obter perfil do usuario autenticado

operationId: `authGetProfile`

**Respostas**

- `200` Perfil do usuario -> SuccessResponse & object
- `401` Nao autenticado -> ErrorResponse

### `PUT /auth/me`

Atualizar perfil do usuario

operationId: `authUpdateProfile`

**Body** (`application/json`, obrigatorio)

- `name` _string_
- `phone` _string_
- `availability_status` _string_

**Respostas**

- `200` Perfil atualizado -> SuccessResponse & object
- `400` Dados invalidos -> ErrorResponse
- `401` Nao autenticado -> ErrorResponse

