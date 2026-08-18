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
  - `409` — conflict (e.g., a preview that has already been saved)
  - `410` — gone (e.g., an expired preview)
  - `422` — semantic validation failure (e.g., business rule violation)
  - `429` — rate limit exceeded (see [Security](06-security.md#rate-limiting--abuse-prevention))
  - `503` — AI provider unavailable (all fallback providers exhausted), or the Redis-backed rate limiter is unavailable and the request fails closed (`RATE_LIMITER_UNAVAILABLE`)
- **Pagination**: cursor-based pagination for all list endpoints. `nextCursor` is an opaque, stable keyset cursor derived from `createdAt` and `id`; clients pass it unchanged as `cursor`. Response includes `data`, `nextCursor` (null if no more pages), and `totalCount` for all records matching the active filters.

## 2. Auth routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/telegram` | No | Exchange Telegram `initData` for a JWT access token and an HttpOnly refresh cookie |
| `POST` | `/auth/refresh` | No (HttpOnly refresh cookie + CSRF header) | Rotate refresh cookie, issue new JWT access token |
| `POST` | `/auth/logout` | Yes (JWT) | Invalidate current refresh token |

### `POST /auth/telegram`
- **Request body**: `{ "initData": "string" }` — raw Telegram `WebAppData` string
- **Validation**: HMAC-SHA256 verification + `auth_date` TTL check per [Security](06-security.md#authentication--authorization)
- **Success response (200)**:
  ```json
  {
    "accessToken": "string (JWT)"
  }
  ```
  The response also sets `slangua_refresh` (`HttpOnly`, `SameSite=Lax`, `Secure` in production) and a readable `slangua_csrf` cookie.
- **Error codes**: `400` (missing/invalid `initData`), `401` (HMAC failure or expired `auth_date`), `429` (rate limit exceeded — own IP-keyed budget, `AUTH_RATE_LIMIT_*`, 20 req/min by default), `503` (rate limiter unavailable)

### `POST /auth/refresh`
- **Request body**: `{}`; the opaque refresh token is sent only in the `slangua_refresh` HttpOnly cookie. The client must send the matching `X-CSRF-Token` header from `slangua_csrf`.
- **Validation**: Lookup hashed token in `RefreshToken` record per [Database Design](03-database.md#entity-refreshtoken); verify not expired
- **Success response (200)**:
  ```json
  { "accessToken": "string (JWT)" }
  ```
  - Refresh token is rotated: old record invalidated, new `RefreshToken` created with new `hashedToken` and `expiresAt`; the replacement is set only in the HttpOnly cookie.
- **Error codes**: `400` (missing refresh cookie), `401` (invalid/expired/revoked token), `403` (CSRF validation), `429` (rate-limited — own IP-keyed budget, `REFRESH_RATE_LIMIT_*`, 20 req/min by default), `503` (rate limiter unavailable)

### `POST /auth/logout`
- **Auth**: JWT required
- **Action**: Invalidate the `RefreshToken` record identified by the `jti` claim in the current access token
- **Success response (204)**: No content
- **Error codes**: `401` `INVALID_TOKEN` (missing, malformed or expired JWT), `500` `LOGOUT_FAILED` (database/Redis failure — the raw error is logged, never returned)

## 3. Translate routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/translate/preview` | Yes (JWT) | Translate text for preview (no persistence), returns `previewId` |
| `POST` | `/translate/save` | Yes (JWT) | Save translation from preview (idempotent, no LLM call) |
| `POST` | `/translate` | Yes (JWT) | Translate text to selected slang style and persist (direct path) |
| `POST` | `/share/inline` | Yes (JWT) | Create a short-lived opaque token for a user-initiated Telegram inline share; requires production inline-bot configuration, see `09-telegram-sharing.md` |
| `POST` | `/telegram/webhook` | No (Telegram secret-token header) | Telegram update callback that answers inline queries; enabled only when `TELEGRAM_INLINE_ENABLED=true` |

All three `/translate*` endpoints share one error-response schema (`400`, `401`, `403`, `404`, `409`, `410`, `422`, `429`, `503`) and one status→reason-phrase table, so a `404`/`409`/`410` is serialized with its own reason phrase (`Not Found`, `Conflict`, `Gone`) instead of `Internal Server Error`. The per-endpoint lists below name the statuses each endpoint actually emits.

### `POST /translate/preview`
- **Request DTO**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `text` | `string` | Yes | 1–1000 Unicode grapheme clusters after trim (Intl.Segmenter); whitespace-only rejected; sanitized for prompt injection |
  | `style` | `SlangStyle` | Yes | Enum: `GEN_Z`, `STREET`, `IT_SLANG`, `POFENI`, `KANCLER`, `GALICIAN` (see [Database Design](03-database.md#enum-slangstyle)) |

- **Success response (200)** — Preview result (no database record created):
  | Field | Type | Description |
  |-------|------|-------------|
  | `originalText` | `string` | Source Ukrainian text (trimmed, normalized) |
  | `translatedText` | `string` | Generated slang text |
  | `slangStyle` | `SlangStyle` | Style used |
  | `providerId` | `string` | Id of the AI instance that succeeded, lowercase (see [Database Design](03-database.md#provider-ids)) |
  | `previewId` | `string (UUID)` | Opaque identifier for saving this exact preview result |

- **Error codes**:
  - `400` — validation error (`VALIDATION_ERROR` for a malformed body, `EMPTY_TEXT`, `INVALID_TEXT_LENGTH`, `STYLE_UNAVAILABLE`)
  - `401` — missing/invalid JWT
  - `403` — `AGE_RESTRICTED_STYLE` (attempted to use an age-restricted style without confirmed adult status)
  - `422` — `PROMPT_INJECTION_DETECTED` (content rejected as potential prompt injection)
  - `429` — rate limit exceeded (separate preview limit: 12 req/min per user by default)
  - `503` — `AI_PROVIDER_UNAVAILABLE` (fallback exhausted) or `RATE_LIMITER_UNAVAILABLE`

- **Side effects**:
  - Does not create or update any `Translation` record in the database.
  - Stores encrypted preview result in Redis (TTL 10 min) keyed by HMAC of `userId:normalizedText:style:styleVersion` for deduplication.
  - Returns cryptographically random `previewId` for subsequent save.

- **Caching**: Identical requests (same userId, normalized text, style, styleVersion) return cached previewId without LLM call. The cache is not a way around the checks that guard the endpoint: the age gate, the prompt-injection check and the operator kill-switch all run *before* the lookup, so a warm entry cannot serve an 18+ style to a user whose confirmation was revoked, and cannot answer `200` while every configured provider is switched off (that case is `503 AI_PROVIDER_UNAVAILABLE`, exactly like an outage). Circuit-breaker state is deliberately *not* consulted here — a cached answer is what should still be served through a real outage.

### `POST /translate/save`
- **Request DTO**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `previewId` | `string (UUID)` | Yes | Opaque preview identifier from `POST /translate/preview` |

- **Success response (200)** — `Translation` record (exact text from preview, WYSIWYG):
  | Field | Type | Description |
  |-------|------|-------------|
  | `id` | `integer` | Primary key |
  | `originalText` | `string` | Source Ukrainian text (exactly as shown in preview) |
  | `translatedText` | `string` | Generated slang text (exactly as shown in preview) |
  | `slangStyle` | `SlangStyle` | Style used |
  | `providerId` | `string` | Id of the AI instance that succeeded, lowercase |
  | `favorite` | `boolean` | Always `false` on creation |
  | `createdAt` | `datetime` | ISO 8601 timestamp |

- **Error codes**:
  - `400` — validation error (missing/invalid `previewId`)
  - `401` — missing/invalid JWT
  - `404` — `PREVIEW_NOT_FOUND` (unknown `previewId`, or the preview belongs to another user)
  - `409` — `PREVIEW_ALREADY_SAVED` (idempotency: duplicate save returns conflict)
  - `410` — `PREVIEW_EXPIRED` (TTL exceeded, 10 min default)
  - `429` — rate limit exceeded (separate save limit: 10 req/min per user by default)
  - `503` — `RATE_LIMITER_UNAVAILABLE` (Redis unreachable, request fails closed)

- **`409 PREVIEW_ALREADY_SAVED` response**: the conflict carries the row the first save created, so the client renders the saved translation instead of re-running the preview:
  ```json
  {
    "error": "Conflict",
    "code": "PREVIEW_ALREADY_SAVED",
    "message": "This preview has already been saved",
    "translation": {
      "id": 42,
      "originalText": "string",
      "translatedText": "string",
      "slangStyle": "GEN_Z",
      "providerId": "openai",
      "favorite": false,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
  - `translation` has the same shape as the `200` body and is **optional**: in the rare case where the idempotency marker (or the unique-constraint violation) exists but the row cannot be found, the response carries only `error`, `code`, and `message`.

- **Behavior**:
  - Verifies preview ownership (userId match) and TTL (not expired).
  - Creates `Translation` with **exact text from preview** — no LLM call, no re-translation.
  - **Idempotent**: Repeat save with same `previewId` returns `409 PREVIEW_ALREADY_SAVED` together with the already-saved `translation` (never a duplicate record; a unique index on `previewId` is the final guard).
  - Does NOT accept `originalText` or `translatedText` from client.
  - Deletes preview data after successful save (keeps short-lived idempotency marker).

### `POST /translate`
- **Request DTO**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `text` | `string` | Yes | 1–1000 Unicode grapheme clusters after trim (Intl.Segmenter); whitespace-only rejected; sanitized for prompt injection |
  | `style` | `SlangStyle` | Yes | Enum: `GEN_Z`, `STREET`, `IT_SLANG`, `POFENI`, `KANCLER`, `GALICIAN` (see [Database Design](03-database.md#enum-slangstyle)) |

- **Success response (200)** — `Translation` record:
  | Field | Type | Description |
  |-------|------|-------------|
  | `id` | `integer` | Primary key |
  | `originalText` | `string` | Source Ukrainian text |
  | `translatedText` | `string` | Generated slang text |
  | `slangStyle` | `SlangStyle` | Style used |
  | `providerId` | `string` | Id of the AI instance that succeeded, lowercase (see [Database Design](03-database.md#provider-ids)) |
  | `favorite` | `boolean` | Always `false` on creation |
  | `createdAt` | `datetime` | ISO 8601 timestamp |

- **Error codes**:
  - `400` — validation error (`VALIDATION_ERROR` for a malformed body, `EMPTY_TEXT`, `INVALID_TEXT_LENGTH`, `STYLE_UNAVAILABLE`)
  - `401` — missing/invalid JWT
  - `403` — `AGE_RESTRICTED_STYLE` (attempted to use an age-restricted style without confirmed adult status)
  - `422` — `PROMPT_INJECTION_DETECTED` (content rejected as potential prompt injection)
  - `429` — rate limit exceeded (persistent translate limit, separate from preview/save)
  - `503` — `AI_PROVIDER_UNAVAILABLE` (fallback exhausted) or `RATE_LIMITER_UNAVAILABLE`

- **Note**: The server performs the translation and persists the result. The client must not send `translatedText` for persistence; the server generates and stores its own translation result. This endpoint is independent of the preview/save flow.

- **Client usage**: none. The Mini App translates exclusively through preview/save, so it can show a result before deciding to keep it. `translateDirect` was removed from `frontend/src/services/api.ts` in 2026-08 because it was never called and duplicated the flow with different semantics. The endpoint itself stays: it is the one-shot contract for non-Mini-App callers, is covered by its own tests and its own rate limit, and removing it would be a breaking API change made for no reason. A future client that adds a caller must not reintroduce it as a silent alternative to preview/save on the same screen.

### `POST /share/inline`
- **Auth**: JWT required.
- **Request body**: exactly one source, `{ "previewId": "UUID" }` or `{ "translationId": integer }`; raw text is never accepted.
- **Success response (200)**: `{ "inlineQuery": "s_<opaque-token>", "shareText": "<translation>", "expiresAt": "datetime" }`. `shareText` is the translation alone — the former `SlangUA · <style>` header was removed because Telegram turned the app name into a link to the bot inside the user's own message.
- **Behavior**: Resolves only an owned preview or Translation, stores an encrypted 10-minute share payload, and returns no text in the client-visible token. It does not call an LLM or create a History record.
- **Error codes**: `400` invalid source body (not exactly one of `previewId`/`translationId`, or unknown keys); `401` missing/invalid JWT; `403 AGE_RESTRICTED_SHARE` (an `ageRestricted` style shared by a user whose `ageConfirmedAdult` is false — the flag is read from the profile, since the JWT context carries only `{ id, telegramId }`); `404 SHARE_SOURCE_NOT_FOUND` (missing, expired, or not-owned source — an expired preview is reported as `404`, not `410`); `422 SHARE_TEXT_TOO_LONG` (rendered message over 3800 grapheme clusters); `429` share rate limit; `503 TELEGRAM_INLINE_UNAVAILABLE` when `TELEGRAM_INLINE_ENABLED` is false.
- **Telegram delivery**: the client hands `shareText` to Telegram's own share sheet (`t.me/share/url`) via `WebApp.openTelegramLink`, so the chosen chat receives a finished, sendable message. `shareText` is rendered server-side — the age-restriction and length rules are enforced in the same place — and the client never composes it. `inlineQuery` remains for the inline-bot path (`Telegram.WebApp.switchInlineQuery`), which only *types* `@bot s_<token>` into the composer and needs a configured inline bot to answer it; it is used only when `shareText` is absent. See [Telegram-native Sharing Architecture](09-telegram-sharing.md).

### `POST /telegram/webhook`
- **Auth**: none (no JWT). Telegram is authenticated by the `x-telegram-bot-api-secret-token` header, compared against `TELEGRAM_WEBHOOK_SECRET` in constant time (both sides are SHA-256 hashed first, so neither the secret's length nor a byte-by-byte timing signal leaks). An unset expected secret never matches.
- **Request body**: a raw Telegram `Update`. The Zod schema is deliberately permissive — `update_id` and `inline_query` (`id`, `query`, `from.id`) are the only fields read, and unknown Telegram fields pass through untouched. A body that is not an object at all is rejected with `400 VALIDATION_ERROR`.
- **Success response (200)**: `{ "ok": true }` — also returned when the update is not an `inline_query`, and when answering the inline query fails (the error is logged server-side; Telegram is never asked to retry).
  ```json
  { "ok": true }
  ```
- **Error responses**:
  - `404` — empty body; returned whenever `TELEGRAM_INLINE_ENABLED` is false, so a disabled deployment is indistinguishable from a missing route
  - `401` — empty body; the `x-telegram-bot-api-secret-token` header is absent or does not match `TELEGRAM_WEBHOOK_SECRET`
  - `400` — `VALIDATION_ERROR` (body is not a JSON object)
  - `429` — webhook rate limit exceeded; keyed by caller IP and configured with `WEBHOOK_RATE_LIMIT_WINDOW_MS`, `WEBHOOK_RATE_LIMIT_MAX_REQUESTS`, `WEBHOOK_RATE_LIMIT_KEY_PREFIX` (30 req/min by default), on top of the coarse per-IP global limit that covers every route except `/health`
  - `503` — `RATE_LIMITER_UNAVAILABLE` (Redis unreachable, request fails closed)

## 4. Styles routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/styles` | Yes (JWT) | List available slang styles filtered by user age confirmation |

### `GET /styles`
- **Auth**: JWT required
- **Behavior**: Returns every style with `enabled: true`, each annotated with its `ageRestricted` flag; the client renders age-restricted entries as locked. The age gate itself is enforced on translation (`403 AGE_RESTRICTED_STYLE`), not by filtering this list.
- **Success response (200)**:
  ```json
  [
    { "id": "string", "title": "string", "ageRestricted": false },
    ...
  ]
  ```
  - `id` — identifier matching `SlangStyle` enum value (uppercase, e.g., `GEN_Z`); it can be sent unchanged as `style` to `POST /translate`
  - `title` — human-readable display name
  - `ageRestricted` — whether the style requires `ageConfirmedAdult`
- **Error codes**: `401` — missing/invalid JWT; `404 USER_NOT_FOUND` — the authenticated user no longer exists; `429` — styles rate limit (30 req/min per user); `503 RATE_LIMITER_UNAVAILABLE`

## 5. History routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/history` | Yes (JWT) | Paginated list of user's translations with optional search and favorite filter |
| `PATCH` | `/history/:id/favorite` | Yes (JWT) | Set the `favorite` flag on a translation (or toggle it, when the body is omitted) |
| `DELETE` | `/history/:id` | Yes (JWT) | Delete a translation record |
| `DELETE` | `/history` | Yes (JWT) | Clear the whole history of the authenticated user |

### `GET /history`
- **Query parameters**:
  | Param | Type | Required | Description |
  |-------|------|----------|-------------|
  | `cursor` | `string` | No | Opaque keyset cursor returned as `nextCursor`; clients must not construct or modify it |
  | `limit` | `integer` | No | Page size (default: 20, max: 100) |
  | `favorite` | `"true" \| "false"` | No | **String enum, not a loose boolean.** `?favorite=true` returns only favorites, `?favorite=false` returns only non-favorites, omitting it returns both. Any other value (`1`, `0`, `yes`, empty) is rejected with `400 VALIDATION_ERROR` — the parameter is deliberately not coerced, because `Boolean("false")` is `true` and `?favorite=false` used to be read as "only favorites" |
  | `search` | `string` | No | Case-insensitive, partial-match text search over `originalText` and `translatedText` |

- **Note**: Partial-match search requires a `pg_trgm` GIN index on `originalText` and `translatedText`, deferred to Stage 5.

- **Success response (200)**:
  ```json
  {
    "data": [Translation, ...],
    "nextCursor": "string | null",
    "totalCount": "integer",
    "totalLimit": "integer"
  }
  ```
  - `Translation` fields per [Database Design](03-database.md#entity-translation)
  - `totalCount` counts all records matching `favorite` and `search`, independent of the current cursor
  - `totalLimit` echoes the server-owned cap on stored translations (`HISTORY_MAX_ENTRIES`, 100). It is constant per deployment and exists so the UI can render `5/100` without hardcoding the number. After every insert the service prunes the oldest **non-favorite** rows back to the cap; favorites are never pruned, so a user who favorites everything can hold more than `totalLimit`. The row the insert just created is excluded from the prune as well — it is what the prune is making room for, and when every other row is starred it would otherwise be the only candidate, leaving a `200` answer with nothing behind it in history

- **Error codes**: `400 VALIDATION_ERROR` (bad `favorite`/`limit` value) or `400 INVALID_CURSOR` (cursor not produced by this API); `401` missing/invalid JWT; `429` history rate limit; `503 RATE_LIMITER_UNAVAILABLE`

### `PATCH /history/:id/favorite`
- **Path parameter**: `id` — Translation primary key
- **Scope**: `favorite` is the only mutable field on a `Translation` (per [Database Design](03-database.md#business-rules-for-the-data-model)).
- **Request body**: optional.
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | `favorite` | `boolean` | Yes, when a body is sent | Value to store. Sending the body is the preferred form: it is idempotent, so a retried or double-clicked request cannot flip the flag back |

  With a body the flag is **set** to the given value:
  ```json
  { "favorite": true }
  ```
  With no body at all the legacy **toggle** behaviour is kept — the stored flag is inverted:
  ```
  PATCH /api/v1/history/42/favorite
  (no body)
  ```
  An empty JSON object `{}` is not a valid body: `favorite` is required once the body is present, so `{}` is rejected with `400 VALIDATION_ERROR`.
- **Success response (200)**: the updated `Translation` record, in both forms:
  ```json
  {
    "id": 42,
    "originalText": "string",
    "translatedText": "string",
    "slangStyle": "GEN_Z",
    "providerId": "openai",
    "favorite": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
  ```
- **Error codes**: `400 VALIDATION_ERROR` (non-integer `id`, or a body that is not `{ "favorite": boolean }`); `401` missing/invalid JWT; `404 NOT_FOUND` — not found or not owned by the authenticated user; `429` history rate limit; `503 RATE_LIMITER_UNAVAILABLE`

### `DELETE /history/:id`
- **Path parameter**: `id` — Translation primary key
- **Success response (204)**: No content
- **Error codes**: `400 VALIDATION_ERROR` (non-integer `id`); `401` missing/invalid JWT; `404 NOT_FOUND` — not found or not owned by the authenticated user; `429` history rate limit; `503 RATE_LIMITER_UNAVAILABLE`

### `DELETE /history`
Clears the whole history of the authenticated user, favorites included. Scoped to `userId`, so it can never touch another user's rows.

- **Request body**: none
- **Success response (200)**: `{ "deletedCount": number }` — how many rows were removed
- **Idempotent**: clearing an already empty history is a success with `deletedCount: 0`, never a `404`. The client asks for an empty history as an end state, not for the removal of a specific row — which is also why this endpoint returns a body instead of `204`.
- **Error codes**: `401` missing/invalid JWT; `429` history rate limit; `503 RATE_LIMITER_UNAVAILABLE`

## 6. User routes

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
  | `ageConfirmedAdult` | `boolean` | User has confirmed they are an adult (mutable preference) |
  | `isAdmin` | `boolean` | Server-computed: this Telegram id is on the `ADMIN_TELEGRAM_IDS` allowlist **and** the deployment has an admin password hash. Not stored in Postgres and not settable by the client; it only tells the client whether to render the admin entry point. See [§7 Admin routes](#7-admin-routes) |
  | `createdAt` | `datetime` | Registration timestamp |
- **Error codes**: `401` — missing/invalid JWT; `404 USER_NOT_FOUND` — the authenticated user no longer exists; `429` — user rate limit (30 req/min per user); `503 RATE_LIMITER_UNAVAILABLE`

### `PATCH /user/me`
- **Request body**:
  | Field | Type | Required | Constraints |
  |-------|------|----------|-------------|
  | `defaultSlangStyle` | `SlangStyle \| null` | No | Enum: `GEN_Z`, `STREET`, `IT_SLANG`, `POFENI`, `KANCLER`, `GALICIAN` (see [Database Design](03-database.md#enum-slangstyle)); `null` clears the preference |
  | `notificationsEnabled` | `boolean` | No | |
  | `ageConfirmedAdult` | `boolean` | No | Mutable preference field (not immutable like Telegram-sourced fields) |
  **Excludes**: `telegramId`, `username`, `firstName`, `lastName`, `languageCode` (Telegram-sourced identity fields are immutable via API), and `isAdmin` (deployment configuration, not user data — sending it is a `400 VALIDATION_ERROR` like any other unknown field)
- Unknown request fields are rejected with `400`.
- `ageConfirmedAdult` is self-attestation for the product age gate; it is not external identity or age verification.
- **Success response (200)**: Updated `User` profile (same shape as `GET /user/me`, `isAdmin` included — the client replaces its cached profile with this body, so omitting the flag here would make the admin entry point disappear after any settings change)
- **Error codes**: `400 VALIDATION_ERROR` (unknown or wrongly typed fields) and `400 IMMUTABLE_FIELD` (attempt to modify a Telegram-sourced field); `401` missing/invalid JWT; `404 USER_NOT_FOUND`; `429` user rate limit; `503 RATE_LIMITER_UNAVAILABLE`

## 7. Admin routes

Admin access is deployment configuration, not a user role: membership comes from `ADMIN_TELEGRAM_IDS` in the environment, and nothing in Postgres can grant it. That variable is empty by default, and while it is empty the whole surface behaves as if it had never been registered. The routes below cover the Stage A access layer, the Stage B operator kill-switch for AI providers, and the Stage C/D read-only observability views.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/admin/session` | JWT + allowlist | Exchange the admin password for a step-up session token |
| `DELETE` | `/admin/session` | JWT + allowlist + `X-Admin-Token` | Close the admin session ("lock the panel") |
| `GET` | `/admin/overview` | JWT + allowlist + `X-Admin-Token` | Read-only status of the AI provider chain |
| `PATCH` | `/admin/providers/:providerId` | JWT + allowlist + `X-Admin-Token` | Switch an AI provider out of the fallback chain, or back into it |
| `GET` | `/admin/metrics` | JWT + allowlist + `X-Admin-Token` | Request volume per minute and per UTC day, plus today's heaviest users |
| `GET` | `/admin/errors` | JWT + allowlist + `X-Admin-Token` | The last few `5xx` responses, newest first |

### Two independent factors

1. **Allowlist** — the `telegramId` carried by the verified JWT must appear in `ADMIN_TELEGRAM_IDS`. Numeric ids only: a username can be changed by its owner and is not what Telegram signs into `initData`.
2. **Step-up password** — every route except the login itself additionally requires the `X-Admin-Token` header. That token is issued by `POST /admin/session` against the scrypt hash in `ADMIN_PASSWORD_HASH` (generated by `scripts/hash-admin-password.mjs`; see [Security](06-security.md)). Sessions live in Redis under an HMAC of the token — the token itself is never stored — and are bound to the `userId` that opened them, so a token presented under another account is refused *and revoked*. They expire on two deadlines: an idle window (`ADMIN_SESSION_TTL_SECONDS`, slides forward on every admin request) and an absolute one (`ADMIN_SESSION_ABSOLUTE_TTL_SECONDS`, never slides). The allowlist is re-checked on every request, so removing an id and restarting closes the door mid-session.

Holding one factor is never enough: the Telegram JWT proves *who* the caller is, not that they meant to open the panel, so a stolen access token or an unlocked phone does not get in.

### `404`, not `403`

To anyone who is not on the allowlist, every `/admin/*` route answers exactly what Fastify answers for a path that was never registered:

```json
{ "message": "Route POST:/api/v1/admin/session not found", "error": "Not Found", "statusCode": 404 }
```

Same status, same body, same key order, same `content-type`. A `401` or `403` would confirm that the panel exists and that only the password is missing.

Two consequences are load-bearing for anyone changing these routes:

- The gate is an **`onRequest`** hook, not a `preHandler`. Fastify parses and validates the body before `preHandler` runs, so a stranger posting `{"password": ""}` used to be answered `400 VALIDATION_ERROR` — which reveals the route just as plainly as a `403` would. At `onRequest` the body is never even read, so a malformed payload, unparseable JSON and a valid body are all answered identically. The rate limiters stay in `preHandler` because they need the `request.user` the gate sets.
- The gate verifies the JWT itself instead of deferring to the shared `authenticate` hook, which answers `401`. An expired or malformed access token therefore also yields `404` on `/admin/*`. The client consequence: on admin paths the axios interceptor treats **`404`** (not `401`) as the retriable status — refresh the access token, then retry once.

### `POST /admin/session`
- **Request body**: `{ "password": "string" }` — 1 to 512 characters. The upper bound only keeps an absurd payload out of the KDF; the real policy (minimum 12 characters) is enforced by the hash generator, since the server only ever sees a hash.
- **Success response (200)**:
  ```json
  { "token": "string (opaque, base64url)", "expiresAt": "ISO-8601", "absoluteExpiresAt": "ISO-8601" }
  ```
  `expiresAt` is the idle deadline clamped to the absolute one, so it never exceeds `absoluteExpiresAt`. The token is returned once and is not recoverable afterwards; the client keeps it in memory only, never in `localStorage`.
- **Error codes**: `400 VALIDATION_ERROR` — empty or wrongly typed `password` (only ever seen by an allowlisted admin); `401 ADMIN_PASSWORD_INVALID` — wrong password **or** an active lockout, deliberately indistinguishable, with `Retry-After` in seconds present only in the lockout case; `404` — caller is not an allowlisted admin; `429 RATE_LIMIT_EXCEEDED`; `503 RATE_LIMITER_UNAVAILABLE`
- **Guessing defences** (both keyed per Telegram id, so one admin cannot lock out another): a sliding window of `ADMIN_LOGIN_RATE_LIMIT_MAX` attempts per `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS`, and a lockout of `ADMIN_LOGIN_LOCKOUT_MS` after `ADMIN_LOGIN_MAX_FAILURES` wrong passwords. The failure counter expires with the lockout duration, so isolated typos months apart never accumulate. A correct password clears the counter.

### `DELETE /admin/session`
- **Headers**: `Authorization: Bearer <JWT>` and `X-Admin-Token: <session token>`
- **Success response (204)**: No content. This locks the panel only — the Telegram login is untouched, so `/user/me` and the rest of the API keep working. Idempotent: an unknown or already expired token is a no-op.
- **Error codes**: `401 ADMIN_SESSION_REQUIRED` — header absent; `401 ADMIN_SESSION_INVALID` — unknown, expired or foreign token; `404` — not an allowlisted admin; `429`; `503`

### `GET /admin/overview`
- **Headers**: `Authorization: Bearer <JWT>` and `X-Admin-Token: <session token>`
- **Success response (200)**:
  ```json
  {
    "admin": { "telegramId": "string", "sessionExpiresAt": "ISO-8601", "sessionAbsoluteExpiresAt": "ISO-8601" },
    "providers": [{
      "id": "string",
      "available": true,
      "configured": true,
      "priority": 0,
      "disabled": false,
      "disabledAt": null,
      "disabledBy": null,
      "disabledReason": null
    }],
    "generatedAt": "ISO-8601"
  }
  ```
  `providers` is sorted by the fallback order the AI service actually uses (`priority` ascending, ties by id), so the panel shows the chain rather than an arbitrary object order. It carries no API keys, key counts or base URLs — nothing that would turn a read-only view into a credential leak.

  The eight fields answer three different questions and must not be collapsed into one: `configured` is "does this deployment have credentials for it", `available` is "is the circuit breaker letting traffic through" (health, decided by the service itself), and `disabled` is "did an operator forbid traffic" (intent, decided by a human). A provider can be `available: true, disabled: true` — healthy and deliberately switched off. `disabledAt` / `disabledBy` / `disabledReason` are the provenance of the switch and are all `null` while `disabled` is `false`; each can also be `null` on a `disabled` row, because a switch flipped straight in Redis during an incident still counts (see [§7 of the security doc](06-security.md)).

  Ids known only to the kill-switch are listed too, with `configured: false` and `priority: 999` — otherwise a switch left behind by a renamed or removed instance could never be found or cleared.
- **Error codes**: `401 ADMIN_SESSION_REQUIRED`; `401 ADMIN_SESSION_INVALID`; `404`; `429`; `503`

### `PATCH /admin/providers/:providerId`
- **Headers**: `Authorization: Bearer <JWT>` and `X-Admin-Token: <session token>`
- **Path parameter**: `providerId` — must match `PROVIDER_ID_PATTERN` (`^[a-z0-9][a-z0-9_-]{0,31}$`), the same shape the AI layer accepts for `AI_EXTRA_INSTANCES`. Shape only; whether the id means anything in this deployment is answered against the live provider list.
- **Request body**: `{ "disabled": true, "reason": "string | null" }` — `disabled` is required and is a *set*, not a toggle, so a retry or a double tap is idempotent. `reason` is optional (up to 200 characters): during an incident, typing a justification is friction, but a switch nobody can explain months later tends to be flipped back by guesswork.
- **Success response (200)**: the whole chain, in the same shape as the `providers` array of `GET /admin/overview`, plus `generatedAt`. The whole list rather than the row that changed, because switching one provider off changes what the rest of the chain means — and the panel should not have to infer that.
- **Error codes**: `400 VALIDATION_ERROR` — malformed id or body; `400 ADMIN_PROVIDER_UNKNOWN` — the id is well-formed but this deployment has never heard of it; `401 ADMIN_SESSION_REQUIRED`; `401 ADMIN_SESSION_INVALID`; `404` — not an allowlisted admin; `429`; `503`
- **Why an unknown id is `400` and not `404`**: on `/admin/*` a `404` means "there is no panel for you", and the client answers one by refreshing the access token and, failing that, asking for the password again. Reusing it for a typo would send the operator through a pointless step-up and hide the real mistake. A currently switched-off id counts as known even if its instance is no longer configured, so a stale switch can always be cleared.
- **Effect on the rest of the API**: immediate and deployment-wide. The switch lives in Redis with no TTL, so it survives a restart and every replica sees it; `AIService` reads it once per request *before* the circuit breakers and never sends traffic to a switched-off provider, including as the recovery probe when every breaker is open. Switching off the last usable provider is allowed and makes `POST /translate/preview`, `POST /translate` and inline sharing answer `503 AI_PROVIDER_UNAVAILABLE` — the same code an outage produces, since an operator decision needs no new error code and the client already handles this one. The server logs it at `error` level; the panel says so out loud before asking for confirmation.
- **What it deliberately does not touch**: `GET /health` and `GET /ready`. Neither consults the provider chain, so a deliberately quiet instance never looks like an outage to a load balancer and does not get restarted out from under the operator.

### `GET /admin/metrics`
- **Headers**: `Authorization: Bearer <JWT>` and `X-Admin-Token: <session token>`
- **Success response (200)**:
  ```json
  {
    "generatedAt": "ISO-8601",
    "retentionDays": 7,
    "perMinute": {
      "minutes": 60,
      "series": [{ "startedAt": "ISO-8601", "requests": 0, "errors": 0 }]
    },
    "daily": [{ "date": "YYYY-MM-DD", "requests": 0, "errors": 0, "users": 0, "averagePerUser": 0 }],
    "topUsers": [{ "userId": "string", "requests": 0 }]
  }
  ```
  `perMinute.series` is oldest first and always exactly `METRICS_MINUTE_SERIES_LENGTH` long, gaps included as zeros — a graph must not silently compress idle minutes. `daily` is newest first, so the client reads today as `daily[0]` instead of computing a date, and is at most `METRICS_RETENTION_DAYS` long. `topUsers` is today's list, descending, capped at `METRICS_TOP_USERS_LIMIT`.
- **Error codes**: `401 ADMIN_SESSION_REQUIRED`; `401 ADMIN_SESSION_INVALID`; `404` — not an allowlisted admin; `429`; `503`
- **`userId` is the internal numeric id, as a string.** Never a Telegram id, never a username: the panel needs to tell heavy users apart, not to identify them, and metrics are the last place that should accumulate identity. The id is a string in the response because it is an opaque handle to the client, not a number to do arithmetic on.
- **Day boundaries are UTC**, labelled as such in the panel. A local-time boundary would move with the server's timezone and make yesterday's row change value after a deploy.
- **What is not counted**: `OPTIONS` preflights (browser bookkeeping that would double every Mini App request), `/health*` (a fixed probe interval would put a constant floor under the graph) and `/api/v1/admin/*` itself — the panel polls, and an operator watching this page must not be able to inflate it. A failure on an admin route is therefore absent from both the counters and the error feed; it lives in the logs.
- **`errors` means `statusCode >= 500`** — the same definition the error feed uses. A `400`, a `401` or a `429` is the API working as designed, and folding those in would make the error line track client behaviour rather than service health.
- **Where the numbers come from**: an `onResponse` hook, i.e. after the reply has been sent. Counters are Redis keys with an absolute expiry derived from their own bucket (`metrics:req:m:<epoch minute>`, `metrics:req:d:<YYYY-MM-DD>`, plus `err:` counterparts and a sorted set per day for users). Nothing is written to Postgres and nothing is pruned by a job: retention is the expiry. A Redis failure while *writing* loses a data point and is logged at `debug`, because the reply is already out and the outage is being announced by the rate limiter anyway; a Redis failure while *reading* surfaces as an error rather than a page of zeros, which would read as "no traffic" instead of "no data".

### `GET /admin/errors`
- **Headers**: `Authorization: Bearer <JWT>` and `X-Admin-Token: <session token>`
- **Query parameters**: `limit` — optional, 1 to `ADMIN_ERROR_FEED_MAX` (100 by default), clamped to that maximum rather than rejected, since the client cannot know a deployment's cap.
- **Success response (200)**:
  ```json
  {
    "generatedAt": "ISO-8601",
    "max": 100,
    "retentionSeconds": 604800,
    "entries": [{
      "at": "ISO-8601",
      "method": "POST",
      "route": "/api/v1/translate/preview",
      "statusCode": 503,
      "code": "AI_PROVIDER_UNAVAILABLE",
      "message": "string | null",
      "userId": 1,
      "requestId": "req-7"
    }]
  }
  ```
  Newest first. `max` and `retentionSeconds` are echoed so the panel can say "the last 100 failures, kept for 7 days" without hardcoding a deployment's configuration.
- **Error codes**: `401 ADMIN_SESSION_REQUIRED`; `401 ADMIN_SESSION_INVALID`; `404`; `429`; `503`
- **What an entry may contain, and why that list is short**: the route *pattern* (`/api/v1/history/:id`) and never the concrete path, which would carry record ids; the internal `userId` or `null`; the status code; our error code; a technical message truncated to 300 characters; and the Fastify `requestId`, which is the whole point of the feed — it is the handle for finding the full entry, with its stack, in the pino logs. No request body, no headers, no query string and no translation text. A feed that quoted user text would rebuild in Redis exactly what the preview/save split exists to keep out of places it does not belong.
- **The message is kept even in production**, where the client is told only "An unexpected error occurred". That asymmetry is deliberate: it is readable only behind both admin factors, and a feed that hid the reason would be a list of timestamps.
- **There is no `DELETE`.** The feed is a capped Redis list (`admin:errors`): every write trims it to `ADMIN_ERROR_FEED_MAX` and refreshes a whole-key TTL of `ADMIN_ERROR_FEED_TTL_SECONDS`, so a quiet week empties it by itself. A clear button on a diagnostic view mostly invites hiding the evidence, and anything it removed would return on the next failure.
- **Where `code` and `message` come from**: whatever produced the reply leaves a two-string snapshot on the request (`captureErrorSnapshot(request, code, message)`, exported by `plugins/observability.ts`), and the hook reads it once the reply is out. The global error handler does this for everything that reaches it, but the translate routes and the inline-share route catch their own errors and answer directly, so they capture explicitly — which is why the example above carries `AI_PROVIDER_UNAVAILABLE`, the code the client saw, rather than the plural `AI_PROVIDERS_UNAVAILABLE` the error handler uses for a `503` that propagated to it. A `5xx` sent by code that captures nothing is still recorded, with both fields `null`: the status code is the fact that matters and the rest is commentary.
- **Entries are best-effort.** They are written in the same `onResponse` hook as the metrics, after the reply; a Redis failure loses the entry and is logged at `debug`. An unparseable record — a line put there by hand during an incident — is dropped from the view rather than failing the read. The logs, not this list, are the record of what happened.

### Rate limiting

Both admin limiters run after the gate, so they are keyed by the admin's own user id and a stranger can never consume someone else's budget: `ADMIN_LOGIN_RATE_LIMIT_*` for the login endpoint and `ADMIN_RATE_LIMIT_*` (120 req/min by default) for the authenticated routes. Like everywhere else, the Redis-backed limiter fails closed with `503 RATE_LIMITER_UNAVAILABLE`.

## 8. Service Responsibilities

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
- **Returns to Route layer** (internal Service → Route return values, not the HTTP response body):
  - `POST /auth/telegram` → `{ accessToken, refreshToken }`
  - `POST /auth/refresh` → `{ accessToken, refreshToken }`
  - `POST /auth/logout` → `void` (204)
  - **Note:** The Route layer sends only `{ accessToken }` in the HTTP response body; `refreshToken` is delivered in the `slangua_refresh` HttpOnly cookie (alongside a readable `slangua_csrf` cookie), never in the body. See the endpoint contracts in [§2 Auth routes](#2-auth-routes).

### TranslationService
- **Business logic owned**:
  - Input validation (content policy) and prompt injection sanitization
  - Slang style resolution and system prompt construction per style
  - Orchestration of AI translation via the AI Adapter (provider selection, fallback, retry, timeout)
  - Core translation logic shared by preview and persistent translation (age gate, sanitization, AI call)
  - Persistence of translation result: create `Translation` record linking `userId`, `originalText`, `translatedText`, `slangStyle`, `providerId`, `favorite: false`
- **Prisma models read/written**:
  - `Translation` — write (create)
  - `User` — read (verify user exists / get preferences if needed)
- **Other components called**:
  - **AI Adapter** (`AIService.translate(text, style)`) — executes provider fallback strategy, returns `{ translatedText, providerId, model }`
- **Returns to Route layer**:
  - `POST /translate/preview` → Preview result (originalText, translatedText, slangStyle, providerId) — no persistence
  - `POST /translate/save` → `{ translation, fromPreview }`; on a duplicate save it throws a `409 PREVIEW_ALREADY_SAVED` error carrying the already-saved row, which the Route layer serializes as the optional `translation` field
  - `POST /translate` → Full `Translation` record (id, originalText, translatedText, slangStyle, providerId, favorite, createdAt)

### HistoryService
- **Business logic owned**:
  - Paginated, user-scoped retrieval of `Translation` records (cursor-based, newest first)
  - Optional filtering by `favorite` flag
  - Optional text search over `originalText` and `translatedText` (case-insensitive, partial match)
  - Set or toggle the `favorite` boolean on a user-owned translation (`setFavorite(userId, id, favorite?)`: an explicit value is idempotent, an omitted value inverts the stored flag)
  - Soft authorization: ensure all operations are scoped to the authenticated `userId`
  - Deletion of a user-owned translation record
- **Prisma models read/written**:
  - `Translation` — read (list with filters/search, find by id), write (update `favorite`), delete
- **Other components called**: None (direct Prisma access)
- **Returns to Route layer**:
  - `GET /history` → `{ data: Translation[], nextCursor, totalCount }`; the Route layer adds the constant `totalLimit` (`HISTORY_MAX_ENTRIES`)
  - `PATCH /history/:id/favorite` → Updated `Translation` record, or `null` when the record does not exist or is not owned by the user (the Route layer turns `null` into `404`)
  - `DELETE /history/:id` → `void` (204)
  - `DELETE /history` → `number` — the count of removed rows, which the Route layer returns as `{ deletedCount }` (200)

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

### AdminAuthService
- **Business logic owned**:
  - Allowlist membership (`ADMIN_TELEGRAM_IDS`, parsed once and cached) and the `isConfigured()` / `hasAdminAccess()` decisions that `GET|PATCH /user/me` report as `isAdmin`
  - Admin password verification against `ADMIN_PASSWORD_HASH` (scrypt, constant-time comparison)
  - Per-Telegram-id failure counting and lockout
  - Step-up session lifecycle in Redis: open, verify (with user binding and the sliding idle window clamped to the absolute deadline), revoke
- **Prisma models read/written**: None — admin-ness is deployment configuration, never user data. A database row could be edited by anything with write access, and a restore from backup could resurrect a former admin.
- **Other components called**: Redis (`admin:session:*`, `admin:failures:*`, `admin:lockout:*`), `lib/password` (scrypt), `lib/preview-keys` (HKDF key for the session-token HMAC)
- **Returns to Route layer**:
  - `login(userId, telegramId, password)` → `{ ok: true, session }` or `{ ok: false, reason: 'invalid_password' }` / `{ ok: false, reason: 'locked_out', retryAfterMs }`; the Route layer collapses both failures into one neutral `401`
  - `verifySession(token, userId)` → `AdminSession | null` (consumed by the `requireAdminSession` hook, not by a handler)
  - `revokeSession(token)` → `void` (204)

### ProviderSwitchService
- **Business logic owned**:
  - The operator kill-switch for AI provider instances: one Redis hash (`ai:provider:disabled`), field = provider id, value = a JSON record of `{ by, at, reason }`
  - Reading the whole switch as a snapshot (`list()`), which `AIService` does once per request before consulting its circuit breakers
  - Tolerating a hand-written record: an unparseable or wrongly typed value still disables the provider and simply carries no provenance. Presence of the field is the switch; the metadata is documentation.
- **Prisma models read/written**: None. The switch is runtime state shared between replicas, not user data, and it must be as cheap to inspect and clear during an incident as a `redis-cli` command.
- **Other components called**: Redis only.
- **Returns to Service layer**:
  - `list()` → `Map<providerId, { by, at, reason }>`. A Redis failure **propagates** instead of resolving to "nothing is disabled": guessing "no" would send traffic exactly where an operator forbade it. On the translation path the caller turns that into the same `503 AI_PROVIDER_UNAVAILABLE` an outage produces — and those requests have already passed a Redis-backed rate limiter, so a Redis outage was never going to let them through anyway.
  - `disable(providerId, by, reason)` → the stored record; `enable(providerId, by)` → `void`. Both are idempotent, both log at `warn` level with the operator's Telegram id, and neither has a TTL: an expiring kill-switch would put a provider back into the chain at an arbitrary moment with nobody watching.
- **Why it is not the circuit breaker**: the breaker answers "is this provider failing?" and heals itself after `CIRCUIT_BREAKER_RESET_MS`. The switch answers "does the operator want traffic there at all?" and must never heal. Sharing one mechanism would mean a provider switched off because a key leaked or a bill ran away comes back on its own a minute later.

### MetricsService
- **Business logic owned**:
  - Counting one finished request: minute and UTC-day counters for requests and for `5xx`, plus a `ZINCRBY` on that day's user sorted set when the request was authenticated
  - Bucket expiry: every write sets an absolute `EXPIREAT` computed from the bucket itself, never a TTL refreshed per write — otherwise a busy minute would outlive a quiet one and "the last hour" would mean something different for every key
  - Assembling the panel snapshot: the minute series (zero-filled), the daily rows with `averagePerUser`, and today's top users
- **Prisma models read/written**: None. These numbers are a load picture with a one-week life, and a per-request insert into Postgres would buy durability nobody asked for at the price of a write on the hot path.
- **Other components called**: Redis only (`metrics:req:m:*`, `metrics:err:m:*`, `metrics:req:d:*`, `metrics:err:d:*`, `metrics:users:d:*`).
- **Returns to Route layer**:
  - `record({ userId, isError })` → `void`. Called from the `onResponse` hook, which swallows failures: the reply is already sent, so a lost data point is cheaper than anything else that could happen here.
  - `snapshot()` → the `GET /admin/metrics` body. Four Redis round trips: two `MGET`s for the series, one pipeline for the daily rows, one `ZREVRANGE` for the top users. A failed pipeline command is rethrown rather than read as a zero.

### ErrorFeedService
- **Business logic owned**:
  - Appending one failure to a capped Redis list (`LPUSH` + `LTRIM` + `EXPIRE`, in one `MULTI`), so the feed cannot grow and empties itself when nothing fails
  - Normalising what may be stored: truncating the message and the code, coercing the status code, defaulting the rest to `null`
  - Reading the newest entries and dropping any record that does not parse
- **Prisma models read/written**: None. The pino logs are the archive; this is a window an operator can open without shell access.
- **Other components called**: Redis only (`admin:errors`).
- **Returns to Route layer**:
  - `record(entry)` → `void`, called from the same `onResponse` hook and equally best-effort
  - `list(limit)` → `ErrorFeedEntry[]`, newest first, clamped to `ADMIN_ERROR_FEED_MAX`. A Redis failure propagates: an empty feed must mean "nothing failed", not "nothing could be read".
- **Why the entry shape is a whitelist, not a filter**: the fields are built one by one from the request and a sanitized snapshot left on it by whichever code produced the reply (the global error handler, or a handler that answers `5xx` itself — see [`GET /admin/errors`](#get-adminerrors)), rather than copied from the error object. That snapshot is two strings on purpose: holding a reference to the error would make it a one-line change for someone later to log a stack, a body or a translation into Redis.

## 9. Ops endpoints

These two live outside `/api/v1` and outside the versioned contract: they exist for orchestrators and deploy scripts, not for the Mini App. No auth, no request body, no cursor.

| Method | Path | Metered | Purpose |
|--------|------|---------|---------|
| `GET` | `/health` | No | Liveness — the process is up |
| `GET` | `/health/ready` | Yes (global per-IP limit) | Readiness — Postgres and Redis both answer |

### `GET /health`
- **Success (200)**: `{ "status": "ok", "timestamp": "ISO-8601" }`
- Answers from the process alone and is the one route the global rate limiter skips, so a probe can never be throttled into reporting a false outage.

### `GET /health/ready`
- **Success (200)**: `{ "status": "ok", "checks": { "database": "up", "redis": "up" }, "timestamp": "ISO-8601" }`
- **Not ready (503)**: same shape with `"status": "degraded"` and `"down"` on whichever dependency failed. Individual probe errors are logged at `warn` with the check name; the response body never carries error text, so it cannot leak a connection string.
- Checks are a one-row indexed read on `User` through Prisma and `PING` against Redis, run in parallel. Not `$queryRaw('SELECT 1')`: raw SQL belongs in migrations, and a one-row read proves the same round-trip while staying cheap as the table grows. Redis is treated as fatal rather than degraded on purpose: with it unreachable the rate limiter fails closed and every metered route returns `503 RATE_LIMITER_UNAVAILABLE`, so the instance belongs out of rotation.
- Unlike liveness it stays behind the coarse per-IP limiter, because it touches both stores. A probe interval measured in seconds is orders of magnitude below the budget.
- Consumed by the `api` service healthcheck in `docker-compose.production.yml` via `node -e "fetch(...)"` — the slim base image ships neither curl nor wget.

## 10. Cross-references

See [Backend Architecture](01-backend.md) for module responsibilities, [Database Design](03-database.md) for entity and enum definitions, and [Security](06-security.md) for authentication and rate-limiting rules.

## 11. Out of scope / deferred

Full OpenAPI/Swagger spec generation deferred to Stage 5 implementation (generated from TypeBox/Zod schemas), not hand-written here.

The backend API design is approved and ready for Stage 5 — Backend Implementation.
