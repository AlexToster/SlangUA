# API Design

This document defines the backend API contracts, routes, request/response DTOs, validation, and error handling.

## 1. Conventions

- **Base path**: `/api/v1`
- **Format**: JSON request/response bodies
- **Standard error response shape**:
  ```json
  { "error": "string", "code": "string", "message": "string" }
  ```
- **Standard HTTP codes** (used across all routes):
  - `400` — validation error (malformed request, missing required fields)
  - `401` — missing/invalid JWT access token
  - `403` — forbidden (authenticated but not authorized for resource)
  - `404` — resource not found
  - `422` — semantic validation failure (e.g., business rule violation)
  - `429` — rate limit exceeded (see [Security](06-security.md#rate-limiting--abuse-prevention))
  - `503` — AI provider unavailable (all fallback providers exhausted)
- **Pagination**: cursor-based pagination for all list endpoints. Response includes `data`, `nextCursor` (null if no more pages), and `totalCount` (optional, for UI hints). Clients pass `cursor` and `limit` query parameters.

## 2. Auth routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/telegram` | No | Exchange Telegram `initData` for JWT access + refresh token pair |
| `POST` | `/auth/refresh` | No (refresh token in body) | Rotate refresh token, issue new JWT access token |
| `POST` | `/auth/logout` | Yes (JWT) | Invalidate current refresh token |

### `POST /auth/telegram`
- **Request body**: `{ "initData": "string" }` — raw Telegram `WebAppData` string
- **Validation**: HMAC-SHA256 verification + `auth_date` TTL check per [Security](06-security.md#authentication--authorization)
- **Success response (200)**:
  ```json
  {
    "accessToken": "string (JWT)",
    "refreshToken": "string (opaque, rotate on each refresh)"
  }
  ```
- **Error codes**: `400` (missing/invalid `initData`), `401` (HMAC failure or expired `auth_date`), `429` (rate limit exceeded)

### `POST /auth/refresh`
- **Request body**: `{ "refreshToken": "string" }`
- **Validation**: Lookup hashed token in `RefreshToken` record per [Database Design](03-database.md#entity-refreshtoken); verify not expired
- **Success response (200)**:
  ```json
  { "accessToken": "string (JWT)", "refreshToken": "string (opaque, rotated)" }
  ```
  - Refresh token is rotated: old record invalidated, new `RefreshToken` created with new `hashedToken` and `expiresAt`; new opaque refresh token returned to client
- **Error codes**: `400` (missing token), `401` (invalid/expired/revoked token), `429` (rate-limited)

### `POST /auth/logout`
- **Auth**: JWT required
- **Action**: Invalidate the `RefreshToken` record identified by the `jti` claim in the current access token
- **Success response (204)**: No content
- **Error codes**: `401` (invalid JWT)

## 3. Translate routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/translate` | Yes (JWT) | Translate text to selected slang style |

### `POST /translate`
- **Request DTO**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `text` | `string` | Yes | Length-validated per [Security](06-security.md#input-validation--sanitization); sanitized for prompt injection |
  | `style` | `SlangStyle` | Yes | Enum: `GEN_Z`, `STREET`, `IT_SLANG`, `POFENI`, `KANCLER` (see [Database Design](03-database.md#enum-slangstyle)) |

- **Success response (200)** — `Translation` record:
  | Field | Type | Description |
  |-------|------|-------------|
  | `id` | `integer` | Primary key |
  | `originalText` | `string` | Source Ukrainian text |
  | `translatedText` | `string` | Generated slang text |
  | `slangStyle` | `SlangStyle` | Style used |
  | `aiProvider` | `AIProvider` | Provider that succeeded (see [Database Design](03-database.md#enum-aiprovider)) |
  | `favorite` | `boolean` | Always `false` on creation |
  | `createdAt` | `datetime` | ISO 8601 timestamp |

- **Error codes**:
  - `400` — validation error (missing/invalid `text` or `style`)
  - `401` — missing/invalid JWT
  - `422` — semantic validation failure (content rejected as potential prompt injection)
  - `429` — rate limit exceeded
  - `503` — all AI providers failed (fallback exhausted)

## 4. History routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/history` | Yes (JWT) | Paginated list of user's translations with optional search and favorite filter |
| `PATCH` | `/history/:id/favorite` | Yes (JWT) | Toggle `favorite` flag on a translation |
| `DELETE` | `/history/:id` | Yes (JWT) | Delete a translation record |

### `GET /history`
- **Query parameters**:
  | Param | Type | Required | Description |
  |-------|------|----------|-------------|
  | `cursor` | `string` | No | Opaque cursor for pagination |
  | `limit` | `integer` | No | Page size (default: 20, max: 100) |
  | `favorite` | `boolean` | No | Filter to only favorited translations |
  | `search` | `string` | No | Case-insensitive, partial-match text search over `originalText` and `translatedText` |

- **Note**: Partial-match search requires a `pg_trgm` GIN index on `originalText` and `translatedText`, deferred to Stage 5.

- **Success response (200)**:
  ```json
  {
    "data": [Translation, ...],
    "nextCursor": "string | null",
    "totalCount": "integer"
  }
  ```
  - `Translation` fields per [Database Design](03-database.md#entity-translation)

### `PATCH /history/:id/favorite`
- **Path parameter**: `id` — Translation primary key
- **Action**: Toggle `favorite` boolean (per [Database Design](03-database.md#business-rules-for-the-data-model): "Update: Limited to toggling the favorite flag")
- **Success response (200)**: Updated `Translation` record
- **Error codes**: `404` — not found or not owned by authenticated user

### `DELETE /history/:id`
- **Path parameter**: `id` — Translation primary key
- **Success response (204)**: No content
- **Error codes**: `404` — not found or not owned by authenticated user

## 5. User routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/user/me` | Yes (JWT) | Current user's profile |
| `PATCH` | `/user/me` | Yes (JWT) | Update application-level preferences |

### `GET /user/me`
- **Success response (200)** — `User` profile (per [Database Design](03-database.md#entity-user)):
  | Field | Type | Description |
  |-------|------|-------------|
  | `telegramId` | `string` | Unique Telegram identifier |
  | `username` | `string \| null` | Telegram handle |
  | `firstName` | `string \| null` | First name from Telegram |
  | `lastName` | `string \| null` | Last name from Telegram |
  | `languageCode` | `string \| null` | Preferred language from Telegram |
  | `defaultSlangStyle` | `SlangStyle \| null` | User's preferred slang style |
  | `notificationsEnabled` | `boolean` | Whether notifications are enabled |
  | `createdAt` | `datetime` | Registration timestamp |

### `PATCH /user/me`
- **Request body**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `defaultSlangStyle` | `SlangStyle` | No | Enum: `GEN_Z`, `STREET`, `IT_SLANG`, `POFENI`, `KANCLER` (see [Database Design](03-database.md#enum-slangstyle)) |
  | `notificationsEnabled` | `boolean` | No | |
  **Excludes**: `telegramId`, `username`, `firstName`, `lastName`, `languageCode` (Telegram-sourced identity fields are immutable via API)
- **Success response (200)**: Updated `User` profile (same shape as `GET /user/me`)
- **Error codes**: `400` — validation error (including attempts to modify immutable fields), `422` — semantic business-rule violation

## 6. Service Responsibilities

This section describes the Service-layer responsibilities for each module, consistent with the Backend Layering established in [Backend Architecture](01-backend.md#backend-layering) (Fastify Route → Service → Prisma Client). Route-layer responsibilities (validation, response formatting) are covered there and not repeated here.

### AuthService
- **Business logic owned**:
  - Telegram `initData` HMAC-SHA256 verification using the bot token secret
  - `auth_date` TTL validation to prevent replay attacks
  - User upsert (create or retrieve) by `telegramId`
  - JWT access token generation (short-lived, signed) including a `jti` claim that references the specific `RefreshToken` record for the session
  - Refresh token generation, hashing (HMAC-SHA256 with a server-side secret), and storage in `RefreshToken` table with expiration
  - Refresh token rotation on `/auth/refresh` (invalidate old, create new)
  - Session invalidation on logout
- **Prisma models read/written**:
  - `User` — read (lookup by `telegramId`), write (create on first login)
  - `RefreshToken` — write (create on login/refresh), read (validate on refresh), delete (invalidate on logout/refresh)
- **Other components called**: None (pure auth logic + Prisma)
- **Returns to Route layer**:
  - `POST /auth/telegram` → `{ accessToken, refreshToken }`
  - `POST /auth/refresh` → `{ accessToken, refreshToken }`
  - `POST /auth/logout` → `void` (204)

### TranslationService
- **Business logic owned**:
  - Input validation (content policy) and prompt injection sanitization
  - Slang style resolution and system prompt construction per style
  - Orchestration of AI translation via the AI Adapter (provider selection, fallback, retry, timeout)
  - Persistence of translation result: create `Translation` record linking `userId`, `originalText`, `translatedText`, `slangStyle`, `aiProvider`, `favorite: false`
- **Prisma models read/written**:
  - `Translation` — write (create)
  - `User` — read (verify user exists / get preferences if needed)
- **Other components called**:
  - **AI Adapter** (`AIService.translate(text, style)`) — executes provider fallback strategy, returns `{ translatedText, aiProvider }`
- **Returns to Route layer**:
  - `POST /translate` → Full `Translation` record (id, originalText, translatedText, slangStyle, aiProvider, favorite, createdAt)

### HistoryService
- **Business logic owned**:
  - Paginated, user-scoped retrieval of `Translation` records (cursor-based, newest first)
  - Optional filtering by `favorite` flag
  - Optional text search over `originalText` and `translatedText` (case-insensitive, partial match)
  - Toggle `favorite` boolean on a user-owned translation
  - Soft authorization: ensure all operations are scoped to the authenticated `userId`
  - Deletion of a user-owned translation record
- **Prisma models read/written**:
  - `Translation` — read (list with filters/search, find by id), write (update `favorite`), delete
- **Other components called**: None (direct Prisma access)
- **Returns to Route layer**:
  - `GET /history` → `{ data: Translation[], nextCursor, totalCount }`
  - `PATCH /history/:id/favorite` → Updated `Translation` record
  - `DELETE /history/:id` → `void` (204)

### UserService
- **Business logic owned**:
  - Retrieval of current user's profile (Telegram-sourced identity fields + preferences)
  - Update of application-level preferences only (e.g., default slang style, notification settings)
  - Enforcement of immutable fields: `telegramId`, `username`, `firstName`, `lastName`, `languageCode` cannot be modified via API
- **Prisma models read/written**:
  - `User` — read (find by id), write (update preference fields only)
- **Other components called**: None (direct Prisma access)
- **Returns to Route layer**:
  - `GET /user/me` → `User` profile (telegramId, username, firstName, lastName, languageCode, createdAt, preferences)
  - `PATCH /user/me` → Updated `User` profile (same shape)

## 7. Cross-references

See [Backend Architecture](01-backend.md) for module responsibilities, [Database Design](03-database.md) for entity and enum definitions, and [Security](06-security.md) for authentication and rate-limiting rules.

## 8. Out of scope / deferred

Full OpenAPI/Swagger spec generation deferred to Stage 5 implementation (generated from TypeBox/Zod schemas), not hand-written here.

The backend API design is approved and ready for Stage 5 — Backend Implementation.