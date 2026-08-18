# SlangUA — Full Technical Briefing

**Purpose of this document.** A single self-contained context dump about the SlangUA codebase, written to be handed to any AI model or new engineer with no other files attached. It describes what exists, why it was built that way, what the non-negotiable rules are, and what is currently broken. It is written to survive being pasted into a chat window on its own.

**Snapshot.** Audited at commit `604d880` ("Update project") on branch `main` on 2026-08-15, then updated the same day after a remediation pass that fixed most of the defects the audit found — see section 17, which now records both what was fixed and what remains. Line-level details may drift; the invariants and rationale should not. Where this document and the code disagree, the code wins — but treat the disagreement as a signal that something was changed without updating the docs, which this project treats as a defect.

**Companion files in the repo.** `README.md` (product overview, Ukrainian), `AGENTS.md` (working rules for agents, Ukrainian), `CONTRIBUTING.md` (Ukrainian), `plans/architecture.md`, `plans/ROADMAP.md`, and `plans/docs/01`–`10` (English technical specs).

---

## 1. What the product is

SlangUA is an **AI style translator** for Ukrainian, delivered as a Telegram Mini App. It rewrites ordinary Ukrainian text into sharply contrasting registers of modern Ukrainian.

The governing rule of the product: **maximally change the form, fully preserve the meaning.** Every style must be instantly recognizable, and styles must be contrastive with each other.

SlangUA is explicitly **not** a dictionary, not a chatbot, not a text generator, and not a machine translator. It does not translate between languages: input is Ukrainian, output is Ukrainian.

Six styles ship today. Registry keys are lowercase; the Prisma enum and the API use uppercase:

| Enum | Registry key | Title (uk) | Notes |
| ---- | ------------ | ---------- | ----- |
| `GEN_Z` | `gen_z` | Молодіжний тікток-сленг | TikTok/Instagram/Discord register; output length roughly preserved |
| `STREET` | `street` | Вуличний базар | Street-market speech |
| `IT_SLANG` | `it_slang` | АйТІшний спіч | Ukrainian IT jargon |
| `POFENI` | `pofeni` | Зеківський жаргон | **18+**, `ageRestricted: true`, not shareable in v1. Ukrainian prison speech — both inside a penal colony and the register people keep after release. Distinct from STREET: hierarchy and «поняття», not the yard. Registry version `1.1.0` after the prompt rewrite |
| `KANCLER` | `kancler` | Бюрократична радянщина | Deliberately expands output 2–4× |
| `GALICIAN` | `galician` | Галицька ґвара | Lviv dialect; added last, registry version `1.0.0` while GEN_Z/STREET/IT_SLANG/KANCLER are `1.0.1` |

Styles transform text unequally on purpose. KANCLER inflating length and POFENI sounding coarser are features, not bugs.

Development philosophy, stated in the README and honored in the code: **simple solution first, then stabilization, only then new abstractions.** This is a solo-developer MVP; several places that look under-engineered are deliberate and documented as such.

---

## 2. Repository facts

- Local path: `D:\Projects\SlangUA` (Windows host).
- Remote: `https://github.com/AlexToster/SlangUA.git`, branch `main`.
- History is short and terse: `Initial commit`, `Додано архітектуру, roadmap та схему prisma`, `Stage 5 passed`, `Upd`, `Upd2`, `до впровадження Style Engine`, `Refactor project structure and remove obsolete code`, `production`, `120825`, `MVP`, `Update project`.
- Backend and frontend are **two separate npm packages**: root (`slangua-backend`, CommonJS output) and `frontend/` (`"type": "module"`).

Layout of what matters:

```
src/
  app.ts                  Fastify bootstrap, plugin + route registration, error handler
  config/index.ts          Zod env schema — single source of truth for configuration
  constants/index.ts       SLANG_STYLE_VALUES, PROVIDER_ID_PATTERN, BUILTIN_PROVIDER_IDS, zod enums
  lib/                     prisma.ts, redis.ts, preview-keys.ts (HKDF key derivation)
  plugins/authenticate.ts  JWT preHandler
  plugins/rate-limit.ts    Redis sliding-window limiter factory
  plugins/require-admin.ts onRequest gates: allowlist (404) + step-up session (401)
  plugins/observability.ts onResponse hook feeding the metrics and the error feed,
                           plus captureErrorSnapshot()
  routes/                  auth, translate, history, user, styles, share, admin
  services/                auth, translation, history, user,
                           preview-cache, share-payload, telegram-inline
  services/admin/          admin-auth.service, metrics.service, error-feed.service
  services/ai/             ai.service, provider.factory, provider-switch.service,
                           base.adapter, key-pool, errors,
                           openai-compatible/claude/gemini.adapter, types
  style-engine/            loader.ts, registry.json, base-rules.md, styles/<id>/
prisma/                    schema.prisma + 11 migrations
scripts/copy-style-assets.mjs
test/                      integration/ (vitest + Testcontainers), unit/ (plain vitest), helpers/, verify-style-engine.mjs
frontend/src/              App.tsx, pages/, components/, services/, utils/, types/, data/
deploy/nginx/              HTTP/HTTPS templates + frontend.conf
plans/                     architecture.md, ROADMAP.md, docs/01–10, this briefing
```

## 3. Stack

**Backend:** Node ≥ 20, TypeScript 5.5 (ES2022 target, NodeNext modules, CJS emit, `strict`), Fastify 4, `fastify-type-provider-zod` + Zod 3, Prisma 5 + PostgreSQL, Redis via ioredis, `jose` for JWT, pino for logging, Vitest 4 + Testcontainers for integration tests.

**Frontend:** React 19, Vite 8, React Query 5, react-router 7, `@telegram-apps/sdk` 3, axios, date-fns, lucide-react, oxlint, Vitest + jsdom + Testing Library. Styling is **plain per-component CSS**; Tailwind is deliberately not used.

**AI:** OpenAI, Anthropic, Google Gemini, Ollama (local), OpenRouter — all behind an adapter pattern. The provider list is deliberately open-ended; adding one must not require architectural change.

---

## 4. Roadmap position

Stages 1–6 are done: architecture, conceptual DB model, Prisma schema, API design, backend implementation, frontend design specification.

**Stage 7 — Frontend implementation + Telegram Mini App integration — is in progress.** All three screens exist and talk to the backend; what remains is polish, the inline-share button verified inside a production-configured Telegram client, and manual passes in light/dark themes at 320 px with the keyboard open.

**Stage 8 — Integration & testing — is next.** Stage 9 is deployment (Docker Compose, nginx reverse proxy with TLS termination, monitoring, Postgres backups). Stage 10 collects post-MVP ideas: speech-to-text, OCR, premium tier, analytics.

**Out of order, at the owner's request: the admin panel.** Four steps, A→D, **all four done**: A the access layer (Telegram allowlist + password step-up, `404` for everyone else, read-only provider overview); B the operator kill-switch for AI providers (`PATCH /admin/providers/:providerId`, a Redis switch with no TTL that outranks the circuit breaker and is cleared only by a human); C usage metrics (`GET /admin/metrics` — requests and `5xx` per minute and per UTC day, users per day with the average per user, today's heaviest users by internal id); D the error feed (`GET /admin/errors` — the last `ADMIN_ERROR_FEED_MAX` failures, newest first, carrying the code and technical message the client was never told, and no `DELETE`). State lives in Redis only — no migration, no admin column, no user role, which is what made building out of order possible. C and D are read-only views fed by one `onResponse` hook, so their writes cost a data point rather than a request. What remains post-MVP under Stage 10 is *user* administration, not this. See §7 (Admin) and §10.

Stages are meant to be completed sequentially with an approved deliverable each. `plans/architecture.md` and `plans/ROADMAP.md` are kept in sync but never merged.

## 5. Backend architecture

The request chain is deliberately flat:

```
Telegram Mini App
      │
      ▼
Fastify route  (Zod validation, HTTP concerns only)
      │
      ▼
Service        (all business logic)
      │
      ├── Prisma Client  → PostgreSQL
      ├── Redis          (rate limits, encrypted preview/share payloads, jti denylist,
      │                   admin sessions, provider kill-switch, usage counters, error feed)
      └── AI Service     → Provider Factory → Adapter → LLM
```

Layer rules, enforced by review rather than tooling:

- **Routes** register endpoints, validate input, shape responses, and own HTTP-only concerns. A route may set cookies; it may not contain business logic. Example of the split: `AuthService` returns `{accessToken, refreshToken}`, and the route decides that the refresh token goes into an HttpOnly cookie and only the access token into the JSON body.
- **Services** hold all logic and are the only callers of Prisma, Redis and the AI layer.
- **Prisma is the only database access layer.** Raw SQL appears only in migrations.
- **The AI adapter subsystem** owns provider selection, timeouts, retries, fallback and circuit breaking.
- **The Style Engine is a library, not a stage in this chain.** See §8.

There are no repository or use-case layers. `plans/docs/05-decisions.md` records this as a proactive choice for a solo-developer MVP, not an accidental shortcut.

`src/app.ts` boot order matters: Zod compilers → CORS (origins split from `CORS_ALLOWED_ORIGINS`, `credentials: true`) → `await connectRedis()` → `await initializeStyleEngine()` → global per-IP rate limiter as an `onRequest` hook (skips `/health`) → the observability `onResponse` hook → error handler → `GET /health` (unmetered liveness) and `GET /health/ready` (metered readiness: a one-row Prisma read plus Redis `PING` in parallel, 503 `degraded` if either fails) → all seven route groups under prefix `/api/v1`, `admin` last. SIGTERM/SIGINT disconnect Redis and close the app. Redis is awaited before serving because the API must not run LLM routes without a working rate limiter.

The central error handler maps: Zod/Fastify validation → 400 `VALIDATION_ERROR`; expired or invalid JWT → 401 `TOKEN_INVALID`; `RATE_LIMIT_EXCEEDED` → 429; `RATE_LIMITER_UNAVAILABLE` → 503; then 404 `NOT_FOUND`, 403 `FORBIDDEN`, 422 `SEMANTIC_VALIDATION_ERROR`, 503 `AI_PROVIDERS_UNAVAILABLE`, and a 500 `INTERNAL_ERROR` fallback that only leaks the raw message in `development`. On the way out it also calls `captureErrorSnapshot()`, which is how the error feed learns the code and message behind a `5xx`; handlers that catch their own errors and reply directly (the translate routes, `POST /share/inline`) have to call it themselves.

Every error response has the same shape: `{ "error": string, "code": string, "message": string }`.

## 6. Data model

Three PostgreSQL tables via Prisma. Redis is intentionally absent from the relational model.

**`User`** — `id` (autoincrement Int PK), `telegramId` String @unique, optional `username` / `firstName` / `lastName` / `languageCode`, `defaultSlangStyle SlangStyle?`, `notificationsEnabled` default `true`, `ageConfirmedAdult` default `false`, `createdAt`. Relations: `translations`, `refreshTokens`.

**`Translation`** — `id`, `userId` (FK, `onDelete: Cascade`), `previewId String? @unique` (save idempotency), `originalText`, `translatedText`, `slangStyle SlangStyle`, `styleVersion String?` (registry version captured at creation), `providerId String` (free-form lowercase instance id, **not** an enum), `favorite` default `false`, `createdAt`. Indexes: `[userId]`, `[createdAt]`, and the keyset index `[userId, createdAt, id]`. Business rule: the only mutable field is `favorite`. Retention is permanent.

**`RefreshToken`** — `id`, `userId` (FK Cascade), `hashedToken String @unique`, `expiresAt`, `deviceInfo Json?`, `createdAt`, index `[userId]`. Rows are rotated (delete + create), never updated, and deleted on logout, refresh or expiry.

The only enum is `SlangStyle { GEN_Z STREET IT_SLANG POFENI KANCLER GALICIAN }`. There is no provider enum: `providerId` is a `TEXT` column holding a lowercase id validated against `PROVIDER_ID_PATTERN` (`/^[a-z0-9][a-z0-9_-]{0,31}$/`) before it is written, because `AI_EXTRA_INSTANCES` can name an instance the code has never seen and an enum would make that a migration. The `20260817090000_provider_id_free_form` migration renamed `aiProvider`, retyped it and lowercased the stored values.

Deleting a `User` cascades to both child tables — that is the privacy-cleanup requirement, not an accident.

Two `pg_trgm` GIN indexes (`Translation_originalText_trgm_idx`, `Translation_translatedText_trgm_idx`) are commented out in `schema.prisma` and created by a raw-SQL migration instead, because Prisma cannot express them.

Migrations in order: `init` (initially only three styles and four providers) · `add_pg_trgm_index` · `add_pofeni_enum` · `add_kancler_enum` · `add_age_confirmed_adult` · `add_history_cursor_index` · `add_translation_preview_id` · `add_openrouter_enum` · `add_style_version_to_translation` · `add_galician_enum`.

Redis owns: rate-limit counters, the revoked-`jti` denylist, encrypted preview/share payloads, the admin step-up sessions (`admin:session:<HMAC of token>`), the provider kill-switch (`ai:provider:disabled`, no TTL), the usage counters (`metrics:req:m:<epoch minute>`, `metrics:err:m:…`, `metrics:req:d:<YYYY-MM-DD>`, `metrics:err:d:…`, plus the per-day sorted set `metrics:users:d:<YYYY-MM-DD>` of **internal** user ids) and the error feed (`admin:errors`, one capped list). PostgreSQL is the source of truth; flushing Redis must not break core functionality (it will drop in-flight previews, rate-limit state, admin sessions, the kill-switch and the two observability views — nothing a user can see). Every observability key carries its own expiry: counters get an absolute `EXPIREAT` derived from the bucket rather than a refreshed TTL, so retention *is* the expiry and nothing prunes.

---

## 7. API surface

All routes are under `/api/v1`. JSON only. Auth is a `Bearer` access token unless stated otherwise. List endpoints use opaque keyset cursors: the client passes `nextCursor` back verbatim and must never construct or parse it.

### Auth

- **`POST /auth/telegram`** — no auth. Body `{ initData }` (raw Telegram `WebAppData`). Verifies HMAC-SHA256, then `auth_date` freshness. Returns `{ accessToken }` and sets two cookies: `slangua_refresh` (HttpOnly, `Path=/api/v1/auth`, SameSite=Lax, Secure in production) and `slangua_csrf` (readable). Errors: 400 `INVALID_INIT_DATA`; 401 `INVALID_HMAC` / `AUTH_DATE_EXPIRED` / `AUTH_DATE_INVALID` / `AUTH_DATE_FUTURE`; 429.
- **`POST /auth/refresh`** — no JWT. Requires the refresh cookie plus an `X-CSRF-Token` header matching `slangua_csrf` (double-submit CSRF, compared with `timingSafeEqual`). Body is a strict empty object. Rotates the token inside a transaction and returns a new `{ accessToken }`. Errors: 400 `MISSING_REFRESH_TOKEN`; 401 `INVALID_REFRESH_TOKEN` / `REFRESH_TOKEN_EXPIRED`; 403 `CSRF_VALIDATION_FAILED`; 429.
- **`POST /auth/logout`** — JWT. Deletes the `RefreshToken` row identified by the access token's `jti` and adds the `jti` to a Redis denylist for its remaining lifetime. Returns 204.

### Translate

- **`POST /translate/preview`** — JWT. Body `{ text, style }`. `text` is trimmed, must be 1–1000 **grapheme clusters** measured with `Intl.Segmenter('uk')`, rejected if whitespace-only, and sanitized against prompt injection. Returns `{ originalText, translatedText, slangStyle, providerId, previewId }` — a UUID, and **no database row**. Side effect: an AES-256-GCM encrypted payload in Redis with a 10-minute TTL. Errors: 400 `EMPTY_TEXT` / `INVALID_TEXT_LENGTH` / `STYLE_UNAVAILABLE`; 401; 403 `AGE_RESTRICTED_STYLE`; 422 `PROMPT_INJECTION_DETECTED`; 429 (12/min/user); 503 `AI_PROVIDER_UNAVAILABLE`.
- **`POST /translate/save`** — JWT. Body `{ previewId }` **only**. Verifies ownership and TTL, then persists the exact preview text (WYSIWYG). No LLM call. Returns the full `Translation`. Errors: 400; 401; 404 `PREVIEW_NOT_FOUND`; 409 `PREVIEW_ALREADY_SAVED`; 410 `PREVIEW_EXPIRED`; 429 (10/min/user).
- **`POST /translate`** — JWT. Same request DTO; translates **and** persists in one call. Returns the full `Translation`. Same error family plus its own 10/min limit. **No client caller by design**: the Mini App goes through preview/save so it can show a result before deciding to keep it. The endpoint stays as the one-shot contract for non-Mini-App callers; do not reintroduce a client for it as a silent alternative to preview/save.
- **`POST /share/inline`** — JWT. Body is exactly one of `{ previewId }` or `{ translationId }`. Returns `{ inlineQuery: "s_<uuid>", shareText, expiresAt }`, where `shareText` is the translation alone. No LLM call, no History write. Errors: 400; 401; 403 `AGE_RESTRICTED_SHARE` (age-restricted style without `ageConfirmedAdult`); 404 `SHARE_SOURCE_NOT_FOUND`; 410; 422 `SHARE_TEXT_TOO_LONG`; 429 (10/min); 503 `TELEGRAM_INLINE_UNAVAILABLE`.
- **`POST /telegram/webhook`** — no JWT; authenticated by the `x-telegram-bot-api-secret-token` header. Returns 404 when inline sharing is disabled. Handles `inline_query` updates and always answers `{ ok: true }`.

### Styles, History, User

- **`GET /styles`** — JWT. Returns every `enabled` registry entry as `{ id: <UPPERCASE>, title, ageRestricted }`. `id` is usable verbatim as the `style` field. Locking of restricted styles is left to the client, but the server re-checks independently.
- **`GET /history`** — JWT. Query: `cursor?`, `limit` (default 20, max 100), `favorite?`, `search?` (case-insensitive partial match across both texts). Returns `{ data, nextCursor, totalCount }`, newest first, `totalCount` computed over the active filters and independent of the cursor.
- **`PATCH /history/:id/favorite`** — JWT. **Toggles** the flag; the request body is ignored. 404 when the row is missing or not owned.
- **`DELETE /history/:id`** — JWT. 204, or 404 when missing/not owned.
- **`GET /user/me`** — JWT. Returns the profile including `ageConfirmedAdult` and the server-computed `isAdmin`.
- **`PATCH /user/me`** — JWT, strict body. Accepts only `defaultSlangStyle`, `notificationsEnabled`, `ageConfirmedAdult`. Telegram-sourced identity fields (`telegramId`, `username`, `firstName`, `lastName`, `languageCode`) are immutable; unknown fields — `isAdmin` among them — are rejected with 400. The response repeats `isAdmin`, because the client replaces its cached profile with this body.

### Admin (`/admin/*`, invisible without both factors)

- **`POST /admin/session`** — JWT + the caller's `telegramId` in `ADMIN_TELEGRAM_IDS`. Body `{ password }` (1–512 chars). Verifies it against the scrypt hash in `ADMIN_PASSWORD_HASH` and returns `{ token, expiresAt, absoluteExpiresAt }`. Errors: 400 `VALIDATION_ERROR`; 401 `ADMIN_PASSWORD_INVALID` (wrong password *and* lockout, indistinguishable, `Retry-After` only in the lockout case); 404 for anyone not on the allowlist; 429; 503.
- **`DELETE /admin/session`** — JWT + allowlist + `X-Admin-Token`. 204. Locks the panel; the Telegram login is untouched. Errors: 401 `ADMIN_SESSION_REQUIRED` / `ADMIN_SESSION_INVALID`; 404; 429; 503.
- **`GET /admin/overview`** — same auth. Returns `{ admin: { telegramId, sessionExpiresAt, sessionAbsoluteExpiresAt }, providers: [{ id, available, configured, priority, disabled, disabledAt, disabledBy, disabledReason }], generatedAt }`, sorted by the real fallback order, with no keys, key counts or base URLs. The three booleans answer three different questions — `configured` is "does this deployment have it at all", `available` is health, `disabled` is operator intent — so `available: true, disabled: true` (healthy, deliberately off) is a normal row. The provenance fields are null unless a switch record carries them, and an id that exists only as a stale switch appears with `configured: false, priority: 999` so it can be cleared.
- **`PATCH /admin/providers/:providerId`** — same auth. The operator kill-switch. Param validated by shape only (`^[a-z0-9][a-z0-9_-]{0,31}$`), body `{ disabled: boolean, reason?: string }` where `disabled` is a **set, not a toggle**, so a repeated call is idempotent. Returns the whole chain in the same shape as the overview, because one flip changes the fallback order for the rest. Errors: 400 `VALIDATION_ERROR`; 400 `ADMIN_PROVIDER_UNKNOWN` for an id that is neither configured nor already switched (a typo answers 400 rather than 404 — inside the panel both factors are already proven, so hiding the route from an admin would only hide their own typo); 401; 404; 429; 503. Switching off the last usable provider is **allowed** — refusing would disable the panel exactly when an incident needs it — and the consequence is stated up front: the client warns, the server logs the resulting state at `error` level with the acting Telegram id, and translation answers the usual `503 AI_PROVIDER_UNAVAILABLE`. `GET /health` and `GET /health/ready` deliberately ignore the chain, so a deliberately quiet deployment is not restarted out from under the operator.
- **`GET /admin/metrics`** — same auth. Read-only usage figures: `{ generatedAt, retentionDays, perMinute: { minutes, series: [{ startedAt, requests, errors }] }, daily: [{ date, requests, errors, users, averagePerUser }], topUsers: [{ userId, requests }] }`. The minute series is oldest first and always exactly `METRICS_MINUTE_SERIES_LENGTH` long with idle minutes present as zeros, so a graph cannot silently compress them; `daily` is newest first (today is `daily[0]`, no date arithmetic on the client) with UTC day boundaries; `topUsers` is today's list, descending, capped at `METRICS_TOP_USERS_LIMIT`. `errors` means `statusCode >= 500` — a `400`, `401` or `429` is the API working as designed. `userId` is the **internal** numeric id rendered as a string: never a Telegram id, never a username, because the panel needs to tell heavy users apart, not to identify them. Not counted at all: `OPTIONS` preflights, `/health*` and `/api/v1/admin/*` itself. Errors: 401 `ADMIN_SESSION_REQUIRED` / `ADMIN_SESSION_INVALID`; 404; 429; 503.
- **`GET /admin/errors`** — same auth. The last failures, newest first: `{ generatedAt, max, retentionSeconds, entries: [{ at, method, route, statusCode, code, message, userId, requestId }] }`. `limit` is optional and **clamped** to `ADMIN_ERROR_FEED_MAX` rather than rejected, since the client cannot know a deployment's cap; `max` and `retentionSeconds` are echoed so the panel never hardcodes them. An entry holds eight fields and no more: the route **pattern** (`/api/v1/history/:id`, never the concrete path, which would carry record ids), the internal `userId` or `null`, the status code, our error code, a technical message truncated to 300 characters, and the Fastify `requestId` — the handle for finding the full entry, with its stack, in the pino logs. No body, no headers, no query string, no translation text. The message is kept **even in production**, where the client is told only "An unexpected error occurred": the feed sits behind both admin factors, and one that hid the reason would be a list of timestamps. There is deliberately **no `DELETE`** — the list is capped and the whole key expires, so a quiet week empties it, and a clear button on a diagnostic view mostly invites hiding evidence. Errors: 401 `ADMIN_SESSION_REQUIRED` / `ADMIN_SESSION_INVALID`; 404; 429; 503.

Both views are fed by one `onResponse` hook (`plugins/observability.ts`) — after the reply is out, so their writes **fail open**: a Redis error costs a data point and is logged at `debug`. Reads fail closed, because a page of zeros would read as "no traffic" rather than "no data". `code` and `message` come from a two-string snapshot left on the request by whatever produced the reply (`captureErrorSnapshot(request, code, message)`): the global error handler captures everything that reaches it, while the translate routes and `POST /share/inline` catch their own errors and must capture explicitly — which is why a failed preview appears as `AI_PROVIDER_UNAVAILABLE`, the code the client saw, and not the plural `AI_PROVIDERS_UNAVAILABLE` the error handler uses. A `5xx` from code that captures nothing is still recorded with both fields `null`.

Three properties define this surface. **Admin-ness is deployment config, not a role**: it comes from `ADMIN_TELEGRAM_IDS`, there is no column in Postgres, and an empty list (the default) means the panel does not exist. **Two independent factors**: the Telegram JWT plus a step-up session in Redis (`admin:session:<HMAC of token>` → `{ uid, tid, iat }`), bound to the user id that opened it, with a sliding idle TTL clamped to a non-sliding absolute one. **404, not 403**: to anyone outside the allowlist every admin route returns Fastify's own byte-identical not-found body, which is why the gate is an `onRequest` hook (validation runs before `preHandler` and a 400 would confirm the route) and why it verifies the JWT itself instead of using the 401-answering `authenticate`. On the client, therefore, 404 — not 401 — is the retriable status on admin paths.

### Ops (outside `/api/v1`, outside the versioned contract)

- **`GET /health`** — no auth, **unmetered**. Liveness: `{ status: 'ok', timestamp }` from the process alone. The one route the global limiter skips, so a probe can never be throttled into reporting a false outage.
- **`GET /health/ready`** — no auth, metered by the global IP limiter. Readiness: a one-row Prisma read and a Redis `PING` in parallel; 200 `{ status: 'ok', checks: { database: 'up', redis: 'up' }, timestamp }`, or 503 with `status: 'degraded'` and `'down'` on whichever failed. Probe errors are logged at `warn` and never returned in the body. Consumed by the `api` healthcheck in `docker-compose.production.yml`.

Rate limits are separate Redis key prefixes per concern: `ratelimit:global` (100/min per IP, all routes except `/health`), plus `auth`, `refresh`, `translate`, `preview` (12/min), `save` (10/min), `share` (10/min), `history`, `user`, `styles`, `webhook` (30/min), `admin-login` (5 per 5 min) and `admin` (120/min). Every response carries `X-RateLimit-Limit/Remaining/Reset`; a 429 also carries `Retry-After`.

---

## 8. Style Engine

Called "the most important decision of the spec" in `plans/docs/07-styles.md`, because it resolved a contradiction between two earlier documents.

**The Style Engine is a library, not a pipeline stage.** It is consumed only from inside `BaseAdapter.buildSystemPrompt()`. It is not a node in the `TranslationService → IAIProvider` chain, and it must never touch Prisma, Redis, HTTP or history logic. Its entire public contract is:

```ts
loadStyle(styleId: string): Promise<LoadedStyle>   // LoadedStyle = { systemPrompt: string }
```

The signature never accepts file paths, and it is `Promise`-returning even though the current implementation could be synchronous. Both choices exist so that a future database, API or admin-panel source of styles requires no contract change. `loader.ts` is the only file permitted to read style assets from disk.

**Prompt assembly order is fixed:** `base-rules.md` first (the English base prompt for Ukrainian-in / Ukrainian-slang-out, loaded once and never duplicated inside style prompts) → the style's `prompt.md` → `Use these words where natural: …` from `lexicon.preferred` → `Avoid these words: …` from `lexicon.forbidden` → one `Example: "before" → "after"` line per example. Blocks are joined by a blank line.

**File formats.** `registry.json` is a map whose key must equal the entry's own `id`, validated strictly: `{ id (lowercase, /^[a-z0-9_]+$/), title, enabled: boolean, ageRestricted: boolean, version: string }`. The key set must exactly equal the lowercased `SLANG_STYLE_VALUES` — both unknown and missing keys are startup errors, which is why schema, constants and registry must be changed together. `ageRestricted` is mandatory; a missing value is a config error, not a default. `lexicon.json` is one merged `{ preferred, forbidden }` file, deliberately merged so that "no word appears in both lists" is a local check; `preferred` must hold 20–40 of the most characteristic words for **every** style. `examples.json` is `[{ before, after }]` with a minimum of three per style, including a KANCLER length-expansion demonstration; the growth path is 3 → 50 → 100 → 300.

**No silent fallback.** `loadStyle()` never falls back to `GEN_Z`. Unknown or disabled styles always throw, and the error message includes both the raw and normalized id; `BaseAdapter` converts that into a 400 listing the available styles. This deliberately replaced an older `stylePrompts[style] || stylePrompts.GEN_Z` pattern.

**Caching and versioning.** The registry and base rules are loaded once into a frozen, memoized snapshot at startup. Each registry entry has a `version`, which is written onto `Translation.styleVersion` and is part of the preview cache key — so bumping a style version invalidates cached previews. Translation caching itself lives outside the engine, in Redis.

**Overlap resolution.** STREET and POFENI are lexically adjacent, so a fixed table splits them: `хата` and `бабло` are preferred in street / forbidden in pofeni; `братва`, `базар`/`базарити`, `авторитет` are preferred in pofeni / forbidden in street.

**Build coupling.** Assets are resolved relative to `__dirname`, so a bare `tsc` produces a `dist` that cannot boot. `npm run build` runs `scripts/copy-style-assets.mjs` to copy `registry.json`, `base-rules.md` and `styles/` into `dist/style-engine`.

**Deferred to "Version 2"** and explicitly out of scope for now: per-style `config.yaml` (`max_length_change`, `density`, `emoji_policy`, `aggression_level`), a Prompt Builder, a Character Engine, Adaptive Examples, and automated validation of model output against forbidden words.

---

## 9. AI layer

`src/services/ai/` implements the adapter pattern so that providers are interchangeable and the codebase avoids vendor lock-in. Automatic fallback to a backup provider is the stated high-availability mechanism.

**Contracts** (`types.ts`): `IAIProvider { id, model, isAvailable(), translate(req) }`, `TranslateRequest { text, style }`, `TranslateResponse { translatedText, providerId, model, usage? }`, `ProviderConfig { enabled, apiKeys?, requiresApiKey?, timeout, maxRetries, retryDelayMs, priority, keyCooldownMs?, keyCooldownStore? }`. `id` names one configured instance and is the only identity in the layer: it keys the circuit breaker and the key pool, appears in logs, and is persisted as `Translation.providerId`. It is a free-form lowercase string (`PROVIDER_ID_PATTERN`), not an enum value, so a second instance of the same vendor — or an endpoint this build has never heard of — stays a config change.

**`BaseAdapter`** provides `isAvailable()` (enabled, and either has at least one api key or declares `requiresApiKey: false`), `withTimeout()`, `withRetry()` (exponential backoff `retryDelayMs * 2^(attempt-1)`), `isNonRetryableError()` (matches invalid api key / unauthorized / forbidden / bad request / quota exceeded / insufficient_quota), `withKeyRotation()` (leases a key from the pool and switches to the next one when the provider refuses the current key), and `buildSystemPrompt(style)` which is the single call site of `loadStyle()`. `BaseAdapter` is the **only** retry owner: every SDK client is constructed with `maxRetries: 0`, because the SDK default of 2 would multiply into up to 9 HTTP calls per translation.

**`KeyPool`** (`key-pool.ts`) turns each comma-separated `*_API_KEY` into a pool: keys are leased in turn and a refused key is parked for `AI_KEY_COOLDOWN_RATE_MS` / `_QUOTA_MS` / `_INVALID_MS`. With one key the behaviour is the plain single-key one.

**`ProviderFactory`** reads `AI_PROVIDER_PRIORITY` as lowercase instance ids, dropping unknown ones with a warning; an id it does not mention still participates but sorts last (priority 999). It builds per-instance configs — `enabled = at least one parsed key`, Ollama instead following `OLLAMA_ENABLED ?? NODE_ENV !== 'production'` with `requiresApiKey: false` — and exposes `getProviders()` filtered by `isAvailable()` in priority order. It also owns the table of OpenAI-compatible instances, derives Ollama's base URL as `<OLLAMA_BASE_URL>/v1`, and appends every `AI_EXTRA_INSTANCES` id (each needing `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY`, optional `AI_TIMEOUT_<ID>`; an incomplete one is logged and skipped, never fatal).

**`AIService`** adds a per-instance circuit breaker: failures accumulate, the breaker opens at `CIRCUIT_BREAKER_FAILURE_THRESHOLD`, and goes half-open after `CIRCUIT_BREAKER_RESET_MS`. `translate()` walks eligible providers sequentially; if every breaker is open it probes only the longest-failing one rather than paying a full timeout per provider on every request. An instance whose keys are all on cooldown is skipped without counting as a provider failure.

**`ProviderSwitchService`** (`provider-switch.service.ts`) is the operator kill-switch, and it is deliberately not the circuit breaker: the breaker answers "is this provider failing?" and heals itself, while a switch flipped by a human must never heal. State is one Redis hash, `ai:provider:disabled`, field = provider id → `{ by, at, reason }`, with **no TTL** — in-memory would re-enable a provider on the next deploy, and an expiring switch would resurrect one with nobody watching. `translate()` reads the switch once per request, *before* the breakers, so one snapshot keeps a whole fallback chain consistent; a switched-off provider is excluded from the chain and from the recovery probe, and `translateWithProvider()` refuses it too. With everything switched off the service throws, which surfaces as the usual `503 AI_PROVIDER_UNAVAILABLE`; a Redis failure propagates rather than being read as "nothing is disabled". Presence of the field is the switch — an unparseable record still disables the provider, so a hand-typed `HSET` during an incident works. `getProviderOverview()` merges factory health with the switch over the union of ids, so a stale switch on an instance that is no longer configured stays visible and clearable. The panel is the normal way to flip it: `PATCH /admin/providers/:providerId`.

**Adapters.** Three classes, N configured instances. `OpenAICompatibleAdapter` serves everything speaking the OpenAI Chat Completions format — today `openai`, `openrouter` and a local Ollama through `/v1`, plus any extra instance — parameterized per instance (`id`, `baseURL`, `model`, `requiresApiKey`, `temperature`, output-cap field name, `extraBody`, `defaultHeaders`) and holding one SDK client per key. OpenRouter passes `reasoning: { effort: 'none' }` through `extraBody` so reasoning-capable models keep their chain of thought out of the message. `ClaudeAdapter` and `GeminiAdapter` keep native SDKs: Anthropic for the prompt-caching option, Gemini because its native API has no system role and needs its own error classification. Default priority order is openai (0), anthropic (1), gemini (2), ollama (3), openrouter (4); all use temperature 0.7 and a ~500-token output cap.

## 10. Security model

**Telegram authentication.** The raw `initData` string is validated with HMAC-SHA256: the data-check string is assembled from sorted key=value pairs, the secret is `HMAC('WebAppData', botToken)`, and the comparison is timing-safe. Only after HMAC success is `auth_date` checked against `AUTH_DATE_TTL` (default 86400 s) — that is the replay-attack mitigation. Timestamps more than 300 s in the future are also rejected. An `AuthStrategy` seam exists for future providers.

**Tokens.** Access tokens are short-lived HS256 JWTs signed with `jose`, carrying `jti = "rt_<refreshTokenId>"`. That claim points at a specific `RefreshToken` row, which is what makes per-device logout possible without killing other sessions. Verification also checks a Redis denylist (`revoked_jti:<jti>`) and returns null if Redis is unreachable — fail-closed.

Refresh tokens are opaque 32-byte random values, stored **only** as HMAC-SHA256 hashes keyed by `REFRESH_TOKEN_HMAC_SECRET`, never in plaintext. Every refresh rotates: inside a transaction the old row is found, expiry-checked, then deleted (the delete doubles as a concurrency guard — a Prisma `P2025` is deliberately allowed to propagate), and a new row is created. The replacement is delivered only via cookie.

**Browser storage.** The access token lives in frontend memory only. The refresh token never appears in a JSON body or in `localStorage` — only in the HttpOnly `slangua_refresh` cookie. Refresh additionally requires the readable `slangua_csrf` cookie echoed in an `X-CSRF-Token` header. Production must serve the frontend and API through the same trusted origin over HTTPS.

**Rate limiting fails closed.** The limiter is a Redis sorted-set sliding window executed in a `MULTI`. Any Redis error other than "limit exceeded" raises `RATE_LIMITER_UNAVAILABLE` → 503. Redis is a hard runtime dependency; the service never runs while pretending rate limiting is off.

**Age gate.** `User.ageConfirmedAdult` is a self-attestation, default `false`, flipped through `PATCH /user/me`. It is explicitly **not** identity or age verification. There is **one real enforcement point: `TranslationService`**. It compares the style's `ageRestricted` against the user flag **before the preview-cache lookup and before any provider call**, returning 403 `AGE_RESTRICTED_STYLE`. `GET /styles` does **not** filter — it returns every enabled style together with the `ageRestricted` flag, so the UI can show the card locked and let the user confirm their age; that lock is cosmetic and is not a defense. Sharing has its own check and its own code, `AGE_RESTRICTED_SHARE`.

**Input handling.** Length and content validation plus prompt-injection detection happen in `TranslationService` before the text reaches any provider. The pattern corpus covers English and Ukrainian phrasings — instruction-override attempts, roleplay/jailbreak/DAN/developer-mode framings, and structural markers like `<|…|>`, `[INST]…[/INST]`, `<<SYS>>…</SYS>>`. Rejections surface as 422 with no detail about the defense; the UI shows a generic "Не вдалося обробити цей текст".

**Encrypted Redis payloads.** This is the one documented exception to "Redis holds only ephemeral non-PII". Preview and share payloads are AES-256-GCM encrypted at application level with a 12-byte IV and auth tag. Keys are derived by HKDF-SHA256 from `PREVIEW_ROOT_KEY` (base64, exactly 32 decoded bytes) with domain separation: `slangua:preview-encryption:<v>`, `slangua:preview-deduplication:<v>`, `slangua:share-encryption:<v>`. Records are tagged with `PREVIEW_KEY_VERSION`, so records from another version are discarded and allowed to expire — that is the key-rotation story. Redis keys are themselves HMACs of `userId:normalizedText:style:styleVersion`, so no plaintext ever appears in a key. Payloads are never logged and are deleted after a successful save, leaving only a short idempotency marker.

`telegramId` is deliberately not treated as a secret — it must stay searchable — and is protected by database access controls rather than encryption.

**Admin access.** Two factors, neither sufficient alone: membership in `ADMIN_TELEGRAM_IDS` (numeric ids only — a username is owner-changeable and is not what Telegram signs) and the admin password, stored only as a scrypt hash in `ADMIN_PASSWORD_HASH` (`N=16384, r=8, p=1`, 16-byte salt, 32-byte key, `timingSafeEqual`). The operator generates the hash locally with `scripts/hash-admin-password.mjs`, which reads stdin rather than argv (argv would leak into shell history and the process list), enforces 12 characters minimum and prints no plaintext; the hash's shape is validated at boot, so a mangled paste fails the start instead of masquerading as a permanently wrong password. In a deployed `.env` the value must be single-quoted — it always carries three `$`, and Compose interpolates `env_file` values, so an unquoted line loses `$N` and `$p` and the shape check rejects a correct hash. The schema also refuses to boot with an allowlist and no hash. Step-up sessions live in Redis under an HMAC of the token, are bound to the user id that opened them (a mismatch refuses *and* revokes), and carry both a sliding idle deadline and a hard one. Wrong password and lockout are reported identically; failures are counted per Telegram id, so one admin cannot lock out another. Non-admins get Fastify's own 404 body, never 401 or 403 — hence the `onRequest` gate. `ADMIN_PASSWORD_HASH` is intentionally absent from the production placeholder blacklist: `.env.example` ships it empty, since any shape-valid example would be the hash of a publicly known password.

**The kill-switch as a security object.** `PATCH /admin/providers/:providerId` is the first admin capability that changes runtime behaviour rather than reporting it, so it is held apart from the self-healing circuit breaker on purpose: a provider switched off because a key leaked, a bill ran away or a model started emitting garbage must not come back on its own a minute later. Hence no TTL, Redis rather than process memory, and provenance (`by`, `at`, `reason`) stored with the switch so a flip found months later can be explained. Reading the switch fails closed — a Redis error surfaces as `503 AI_PROVIDER_UNAVAILABLE`, because resolving to "nothing is disabled" would send traffic exactly where an operator forbade it — and every flip is logged at `warn` with the acting Telegram id, an `error`-level log when the result is an empty chain. Nothing about a human's decision reaches the end user: the 503 body names no provider and carries no reason.

**What the observability views may store.** `GET /admin/metrics` and `GET /admin/errors` are read-only, but they are the two places where the system accumulates a record of what users did, so the stored fields are a **whitelist, not a filter**. The metrics carry no identity beyond an internal number: the per-day user set is keyed by `User.id` and returned as a string, never a Telegram id, never a username, never text. The feed stores eight fields — the moment, the method, the registered route **pattern** (never the concrete path, which would carry record ids), the status code, our error code, a technical message truncated to 300 characters, the internal user id, and the Fastify `requestId` — and is assembled field by field from a two-string snapshot rather than from the error object, so logging a stack, a body or a translation could never become a one-line change. A feed that quoted user text would rebuild in Redis exactly what the preview/save split exists to keep out. Failures on `/api/v1/admin/*` appear in neither view, so an operator watching the panel cannot inflate its own numbers or fill the feed it is reading; those failures live in the logs, which hold the complete record. Writes happen in an `onResponse` hook and therefore **fail open** — this is not the rate limiter's rule inverted by accident: the limiter decides whether to admit a request and must refuse when it cannot decide, while this hook only describes a request that already finished, so a Redis error costs one data point and is logged at `debug`. Reads fail closed, because a page of zeros would read as "no traffic" instead of "no data".

## 11. Telegram-native sharing

Sharing is an explicit, user-initiated action on a finished result, and it happens **only inside Telegram**. The primary channel is Telegram's own chat chooser: the server renders the finished message and the client hands it to `openTelegramLink('https://t.me/share/url?...')`. Inline mode is the fallback for clients without that bridge. Three implementations are explicitly forbidden: putting the translated text in a deep link, using the generic browser share sheet, and silently creating any public URL. Nothing but the message text may travel in a share intent — no token, no `previewId`, no app-internal link a recipient could resolve.

Flow: a completed preview offers Copy / Send in Telegram / Save as distinct actions → "Send" appears only when Telegram exposes a sharing bridge (`openTelegramLink` or `switchInlineQuery`) and the result is eligible → the client calls `POST /share/inline` with `previewId` or `translationId` → the backend resolves an owned result, writes a short-lived encrypted payload and returns both the rendered `shareText` and an opaque `inlineQuery` token → with `shareText` the client opens `t.me/share/url` and Telegram delivers a normal, sendable message to the chat the user picks; without it the client falls back to `switchInlineQuery(token, ['users','bots','groups','channels'])`, the bot resolves the token server-side and answers with exactly one `InlineQueryResultArticle` for the user to pick. The order is deliberate: `switchInlineQuery` only *types* `@bot s_<uuid>` into the composer, so with no inline mode configured the raw token sits in the input box and cannot be sent at all.

The token is a random UUID containing no text, user id or style. Payloads are bound to **both** the SlangUA user and the Telegram user, and the inline handler verifies `inlineQuery.from.id` against the payload creator, so a leaked token is useless to another account. Invalid, expired and foreign tokens all return zero results, and the handler must not reveal which condition applied. `answerInlineQuery` is called with `cache_time: 0` and `is_personal: true`.

The rendered message is the translated text alone. The `SlangUA · <style title>` header was removed: Telegram rendered the app name as a link to the bot inside what looked like the user's own message. The style label survives only as the title of the inline result card in the picker, which is never sent. The original input is never included. Sharing never creates a `Translation` row, and Copy is the universal fallback for every error path.

Two policy limits: **an `ageRestricted` result is shareable only by a user with `ageConfirmedAdult: true`** — `POST /share/inline` reads the flag from the profile and returns 403 `AGE_RESTRICTED_SHARE` otherwise (a recipient still cannot be age-gated, so the sender carries it through the same self-attestation that unlocked the style; the UI only hides the button). And the server counts the **final rendered message** in grapheme clusters, rejecting anything above a conservative **3800** with 422 `SHARE_TEXT_TOO_LONG` — never truncating silently. That limit matters most for KANCLER's 2–4× expansion.

Deployment prerequisites: the primary path needs nothing configured on the bot side beyond the Mini App itself. The **fallback** needs all of inline mode enabled in BotFather, a configured bot token with an HTTPS webhook (or a deliberately operated long-polling worker) handling `inline_query`, and a bot username/domain consistent with the Mini App deployment. If neither path is available, Copy remains the fallback — never a public URL.

---

## 12. Frontend

Three screens, exactly three bottom-nav items, no Home tab: **Translate** at `/` (the root), **History** at `/history`, **Settings** at `/settings`. Mobile-first from 320 px. The nav must not overlap the result area or the Telegram safe area. There is a fourth route, `/admin`, deliberately outside the navigation: it is the only lazily loaded page, its entry point appears in Settings only when `/user/me` returns `isAdmin: true`, the step-up token lives in memory and is attached as `X-Admin-Token` to `/admin/*` requests and nothing else, and for everyone else the panel does not exist in the API either. The page holds three independent sections — the provider chain with its kill-switch, the usage metrics, and the error feed — each with its own query, its own loading state and its own retry, so an unreachable feed does not blank the providers an operator opened the panel to switch off. A `401` from any of them means the step-up session expired and re-locks the panel; on admin paths `404`, not `401`, is the retriable status.

**Bootstrap** (`App.tsx`): hydrate the theme from `localStorage` before first paint → initialize the Telegram WebApp SDK → read theme params and safe-area insets → POST the raw `initData` to `/auth/telegram` → keep the access token in memory → load `GET /user/me` and `GET /styles` → render Translate. There is no separate auth screen. Init states are `loading`, `not-in-telegram`, `auth-failed`, `ready`.

**Translate has no translate button.** After 900 ms of no changes, if the draft has at least 3 non-whitespace characters, the client requests a preview. The previous result stays visible under an "Оновлюємо…" state. A response is applied only if it still matches the current `{text, style}` and `requestVersion`. Changing the style with non-empty text translates immediately without the debounce; with empty text it only changes the selection. "Повторити" exists only in the error state.

Cost control is explicit: the request key is the normalized `{text, style}` pair (normalization affects deduplication only, never the displayed or saved text), identical successful or in-flight requests are not repeated within a screen session, edits abort in flight via `AbortController` and bump a monotonic `requestVersion`, and automatic attempts are capped (`MAX_AUTOMATIC_PREVIEW_ATTEMPTS = 3`, with a 429 burning the remainder). Together with the server-side preview cache this is what keeps a no-button UI from being expensive.

**Save is deliberately explicit** — a secondary action in the result overflow menu — so that neither typing pauses nor copying create History entries or hide AI cost.

**Input rules.** Multiline textarea capped at 200 px with auto-resize; a grapheme counter (`123 / 1 000`) that warns from 850 and hard-stops at 1000 without silent truncation; a Paste button that touches the Clipboard API only on explicit tap and degrades to "Встав текст вручну" on denial; and "Випадкова фраза" which inserts one of ~500 locally generated Ukrainian phrases, never repeating the immediately previous one, and never creating History.

**History** shows only explicitly saved translations, newest first, with search across both texts, a favorites filter, cursor pagination passing `nextCursor` unmodified, optimistic favorite toggling with exact rollback, and a confirmed, optimistic delete.

**Settings** covers appearance (theme `Як у Telegram` / `Світла` / `Темна`), interaction (haptics on by default, sound off by default), translation and age gate (default style, notifications, the 18+ self-attestation dialog), support and about, and logout. **Persistence is split on purpose:** `defaultSlangStyle`, `notificationsEnabled` and `ageConfirmedAdult` live server-side via `GET/PATCH /user/me`; theme override, sound and haptics live in this Mini App's `localStorage` — explicitly not Telegram CloudStorage.

**Network behavior.** A 401 triggers exactly one coordinated refresh shared by all in-flight requests (single-flight promise in `services/api.ts`); on failure the session is cleared and a recoverable "Відкрий застосунок у Telegram ще раз" state is shown. Repeated 401s must not loop. Offline preserves draft, result and style, and auto-translate resumes only after a fresh debounce or explicit retry — never as a burst on reconnect.

**Accessibility requirements** are part of the acceptance criteria, not aspirational: semantic Telegram theme tokens instead of hardcoded colors, live regions for result/loading/toast but not per keystroke, `aria-label` or a visible tooltip on every icon button, ≥44×44 px touch targets, working focus states and tab order, and focus returning to the style button when the bottom sheet closes. The Telegram Main Button is explicitly **not** the translate button; it may only serve a contextual confirm inside the 18+ modal.

---

## 13. Configuration

`src/config/index.ts` is the single source of truth: a Zod schema parsed at import time. **Invalid configuration intentionally exits the process** rather than degrading. Every new variable must be added there and documented in the README.

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (≥32 chars), `REFRESH_TOKEN_HMAC_SECRET` (≥32 chars), `TELEGRAM_BOT_TOKEN`, `PREVIEW_ROOT_KEY` (base64, exactly 32 decoded bytes).

Key optional variables with defaults: `NODE_ENV` (`development`), `PORT`/`HOST` (3000 / 0.0.0.0), `JWT_ACCESS_TTL`/`JWT_REFRESH_TTL` (`15m` / `7d`), `AUTH_DATE_TTL` (86400), `LOG_LEVEL` (`info`), `TRUST_PROXY` (false), `CORS_ALLOWED_ORIGINS` (`http://localhost:5173`), `TELEGRAM_INLINE_ENABLED` (false), `TELEGRAM_WEBHOOK_SECRET` (optional), `PREVIEW_CACHE_TTL_SECONDS` / `SHARE_CACHE_TTL_SECONDS` (600), `PREVIEW_KEY_VERSION` (`v1`).

AI: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (all optional — at least one provider or a local Ollama is needed; each accepts a **comma-separated pool** of keys that the adapter rotates through), `AI_KEY_COOLDOWN_RATE_MS` (60000), `AI_KEY_COOLDOWN_QUOTA_MS` / `AI_KEY_COOLDOWN_INVALID_MS` (3600000), `AI_MODEL_OPENAI` (`gpt-4o-mini`), `AI_MODEL_ANTHROPIC` (`claude-3-haiku-20240307`), `AI_MODEL_GEMINI`, `AI_MODEL_OLLAMA` (`llama3.1:8b`), `AI_MODEL_OPENROUTER`, `AI_BASE_URL_OPENAI` / `AI_BASE_URL_OPENROUTER`, `AI_EXTRA_INSTANCES` (empty; per id `<ID>`: `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY`, optional `AI_TIMEOUT_<ID>`), `AI_PROVIDER_PRIORITY` (`openai,anthropic,gemini,ollama,openrouter`), `AI_TIMEOUT_*` (30000, Ollama 60000), `AI_MAX_RETRIES` (2), `AI_RETRY_DELAY_MS` (1000), `AI_MAX_FALLBACK_ATTEMPTS` (optional), `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (5), `CIRCUIT_BREAKER_RESET_MS` (60000), `OLLAMA_BASE_URL` (`http://localhost:11434`), `OLLAMA_ENABLED` (optional; unset means enabled outside production).

Rate limits, each with a window, a max and a key prefix: `GLOBAL_RATE_LIMIT_*` (60000/100), `RATE_LIMIT_*` (60000/100), `PREVIEW_RATE_LIMIT_*` (60000/12), `SAVE_RATE_LIMIT_*` (60000/10), `SHARE_RATE_LIMIT_*` (60000/10), `WEBHOOK_RATE_LIMIT_*` (60000/30).

Admin panel, all optional and all off by default: `ADMIN_TELEGRAM_IDS` (empty — the off switch for the whole surface), `ADMIN_PASSWORD_HASH` (empty), `ADMIN_SESSION_TTL_SECONDS` (900), `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS` (28800), `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_LOGIN_RATE_LIMIT_MAX` (300000/5), `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_LOCKOUT_MS` (5 / 900000), `ADMIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_RATE_LIMIT_MAX_REQUESTS` (60000/120). Observability, all with defaults and none of them a secret: `METRICS_MINUTE_SERIES_LENGTH` (60), `METRICS_RETENTION_DAYS` (7), `METRICS_TOP_USERS_LIMIT` (10), `ADMIN_ERROR_FEED_MAX` (100), `ADMIN_ERROR_FEED_TTL_SECONDS` (604800).

Three cross-field rules: `TELEGRAM_INLINE_ENABLED=true` requires a non-blank `TELEGRAM_WEBHOOK_SECRET`; a non-empty `ADMIN_TELEGRAM_IDS` requires `ADMIN_PASSWORD_HASH` (an allowlist alone would be single-factor); and `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS` may not be smaller than `ADMIN_SESSION_TTL_SECONDS`, which would make the idle window dead code.

## 14. Commands and testing

Backend, repo root:

```bash
npm install
cp .env.example .env        # placeholders now boot as-is; fill in the AI keys you use
npm run prisma:generate
npm run prisma:migrate
npm run dev                 # tsx watch, :3000

npm run build               # tsc && node scripts/copy-style-assets.mjs
npm start

npm run test:typecheck      # tsc --noEmit && tsc -p tsconfig.test.json (src + test/)
npm run test:smoke          # build + node test/verify-style-engine.mjs
npm run test:unit           # vitest, no Docker — AI layer (key pool, rotation, fallback, provider kill-switch), config schema, admin password hashing, metrics and the error feed on a fake Redis
npm run test:integration    # vitest + Testcontainers — REQUIRES Docker Desktop
npm test                    # all four in sequence
```

Frontend, in `frontend/`:

```bash
npm install
npm run dev                 # :5173, proxies /api to :3000
npm run lint                # oxlint
npm test                    # vitest run — jsdom component tests
npm run test:watch          # vitest in watch mode
npm run typecheck           # tsc -b — app, node and test projects
npm run build               # tsc -b tsconfig.app.json tsconfig.node.json && vite build
```

Both suites also run in CI (`.github/workflows/ci.yml`) on every push and pull request to `main`: one job for the backend (`npx prisma generate`, then typecheck → smoke → unit → integration, using the runner's Docker daemon for Testcontainers) and one for the frontend (lint → typecheck → tests → build). Two jobs rather than one so a frontend-only change does not wait on container startup. CI is a safety net, not a substitute for running the checks before opening a PR.

Frontend component tests live next to their components as `src/**/*.test.tsx` and cover `StyleDropdown` (keyboard navigation, `aria-activedescendant`, locked styles routed to the age-gate handler), `ConfirmDialog`, `BottomNav`, `Toast` (including the five-second auto-dismiss under fake timers) and `ErrorBanner` (per-code retry labels). jsdom implements no layout, so `src/test/setup.ts` stubs `Element.prototype.scrollIntoView`.

`build` deliberately leaves the test project out: the production image must not fail over a test file, and the Docker build context can contain stale ones (a server deploy that overlays an archive on the target directory without deleting removed files leaves them behind). `.dockerignore` therefore drops `frontend/src/**/*.test.*` outright, so the image never depends on the deploy procedure being careful. Deployment scripts themselves live outside the repository — they hold production server details — and only `deploy/nginx/` is versioned here.

**Integration tests are hermetic by design.** Testcontainers spins up throwaway `postgres:16-alpine` and `redis:7-alpine` instances, runs `prisma migrate deploy`, and starts an in-process Ollama-compatible mock with deterministic canned replies per style. There are **no external network calls** — not to Telegram, OpenAI, Anthropic, Gemini, a real Ollama, or anything else. All secrets are deterministic test values. Tests run serially (`fileParallelism: false`) because the app config and service singletons are process-global, and Redis plus Postgres are cleaned between tests. Consequently, **real-provider output quality is never tested**.

Coverage today: auth (HMAC failure, expired `auth_date`, malformed initData, cookie rotation, replay of a rotated-out token, refresh after logout, rate limits), translate (all styles, age gate, prompt injection, AI failure, grapheme boundaries including emoji/ZWJ/flag/skin-tone sequences, cache hits, no cross-user or cross-style cache reuse, per-endpoint rate limits, WYSIWYG persistence, duplicate save), history (keyset pagination with tied timestamps, cursor round-trip, filters, ownership, delete, `totalLimit`, server-side pruning at the cap and the favorites exemption), `PATCH /user/me` immutability, and the two health endpoints (readiness reporting both stores up, `/health` unmetered while `/health/ready` is metered). Admin access has its own suite (`test/integration/admin-auth.integration.test.ts`): a `404` byte-identical to an unregistered path for a non-admin, for a garbage access token, for unparseable JSON and even for a non-admin holding a valid step-up token; a wrong password answered with a neutral `401`, an empty one with a validation error, the correct one returning a token and both deadlines; the token never appearing in Redis itself; the lockout triggering even for the right password and counting per admin rather than globally; the login rate limit stacking on top of it; `GET /admin/overview` demanding the step-up token, refusing a made-up one, refusing one presented by a different admin, and returning the provider chain to a fully authenticated caller; `DELETE /admin/session` closing the panel without touching the Telegram login and allowing a fresh login afterwards; and `isAdmin` being true only for allowlisted ids, present in the `PATCH` answer, and unsettable by the client. Not covered: the idle window actually sliding and the absolute deadline expiring, both of which would need clock control. The admin fixture — allowlist id, password hash, TTLs — is duplicated in `test/integration/global-setup.ts` and `vitest.integration.config.mjs`, because `globalSetup` mutates `process.env` before the workers exist while the config `env` block is what reaches them; change one, change the other. Share coverage is thin — one happy path, one ownership case, and one asserting the server-rendered `shareText` never leaks the inline token.

The kill-switch is covered on both sides. `test/unit/provider-switch.test.ts` drives `ProviderSwitchService` against a fake Redis client: an empty hash, a record typed by hand (`HSET … 1`) still counting as disabled with null metadata, wrong-typed fields degrading to nulls, a Redis failure propagating instead of resolving to "nothing is disabled", and `disable`/`enable` being idempotent with trimmed reasons. `test/unit/ai-service-fallback.test.ts` injects the switch into `AIService` to prove a switched-off provider is never sent a request, never used as a last resort, never picked as the recovery probe, refused even when named explicitly, and that a switch on an unconfigured id is reported rather than hidden. `test/integration/admin-providers.integration.test.ts` then asserts the observable behaviour end to end: the flip returning the whole chain with `available: true, disabled: true` and the acting Telegram id, the Redis hash carrying `ttl === -1`, a pre-emptive switch of an unconfigured provider, `400 ADMIN_PROVIDER_UNKNOWN` for a typo versus `400 VALIDATION_ERROR` for a malformed id or body, no key or hash leaking into the response, translation going 200 → `503 AI_PROVIDER_UNAVAILABLE` → 200 as the only usable provider is switched off and back on (with the 503 body naming neither the provider nor the reason), and the whole route inheriting Stage A's door — byte-identical `404` for a non-admin, `401 ADMIN_SESSION_REQUIRED` without the step-up header.

The two observability views are covered the same way, and the harder question in both suites is not "does it record?" but "does anything else reach it?". `test/unit/metrics.test.ts` drives `MetricsService` against a fake Redis: a request counted in both the minute and the UTC day, a `5xx` counted in both the request and the error counter, the user set holding the internal id and nothing else about the user, an unauthenticated request never touching that set, the bucket's expiry fixed by the bucket rather than by the write, a zero-filled series of exactly the configured length, today first with the average taken over the users actually seen, the top-users cap honoured, no traffic reported as zeros rather than an empty page, and a broken pipeline command or transaction propagating instead of being read as a zero. `test/unit/error-feed.test.ts` covers the round trip, newest-first order, the cap that cannot be exceeded, the whole-key TTL refreshed on every write, a long message truncated rather than stored whole, a request with no user and no code stored as nulls, **only** the whitelisted fields written, a larger `limit` clamped and a smaller one honoured, a hand-written record dropped rather than failing the read, and a Redis failure propagating instead of reporting an empty feed. `test/integration/admin-metrics.integration.test.ts` then asserts it end to end: the shape and sizes the panel draws, minute buckets labelled on the minute oldest first, a real request landing in the minute and the day, a `5xx` counted as both a request and an error while a `4xx` is counted as neither, the heaviest user ranked by internal id with the average over the users seen, and the three exclusions proven rather than assumed — the panel's own reads, `/health*` probes and a CORS preflight. `test/integration/admin-errors.integration.test.ts` induces the realistic `5xx` of this application (a provider failure on `POST /translate/preview`) and checks that the entry carries the cause the client was never told, that the feed contains neither the text of the failed request nor either Telegram id nor anything resembling a key or a bearer token, that ordering is newest-first, that a `4xx` and the panel's own reads never appear, that `limit` is clamped upward and rejected as `400 VALIDATION_ERROR` for `0`, `-1`, `abc` and `1.5`, that Redis holds one capped list with a positive TTL, and that `DELETE /api/v1/admin/errors` is a `404`. Both suites re-prove Stage A's door on their own path. Two things are deliberately not covered end to end: the cap being reached (six induced `5xx` would trip the in-memory circuit breaker for later files, so the cap is proven in the unit test) and the retention window expiring, which would need clock control. Because the feed is written on `onResponse`, both suites poll for it instead of reading once, and each test starts with one successful translation to close the breaker notch its induced failures open.

**Known environment limitation.** If `node_modules` was installed on Windows, the Linux-native binaries for `oxlint` and `rolldown` are absent, so frontend lint and Vitest cannot run from a Linux container against that same tree. Pure-JS tools like `tsc` work fine. Integration tests additionally need Docker. When any of these cannot run, say so rather than reporting success.

## 15. Conventions

**Documentation language.** Ukrainian for `README.md`, `AGENTS.md`, `CONTRIBUTING.md` — the product and team context. English for technical documents under `plans/**`, so the technical contract can be handed to any tool or contributor. Deliberate exception: documents whose *subject* is Ukrainian text stay Ukrainian — `plans/docs/07-styles.md` (style lexicons, banned words, before/after examples) and `plans/docs/08-frontend-design.md` (verbatim UI copy). Translating them would falsify the material they specify; both carry a note saying so at the top.

**Git.** Branch off current `main` with `feature/`, `fix/` or `docs/` prefixes. Small cohesive commits, keeping refactor, cleanup and functional change separate. No Conventional Commits requirement. Check `git status` once at the start and treat pre-existing unrelated changes as someone else's work — do not commit, revert or clean them.

**Coupled changes.** An API contract change must update the route, the service, the integration test and `plans/docs/04-api.md` together. A security or UX change must update the corresponding document in `plans/docs/`.

**Hard rule.** Never weaken the age gate, authentication, ownership checks, rate limits, prompt-injection checks or server-side validation for the sake of the UI.

**Tests.** A failing test must be isolated first. Never mask it by editing the expectation or disabling it without evidence that the contract changed intentionally. Verification effort scales with the risk of the change.

**Secrets.** Never commit `.env` or real credentials. It was committed once early on; the history has since been rewritten and the owner declined rotation for the reasons in §17 — treat that as settled.

## 16. Non-negotiable invariants

A condensed do-not-break list, useful as a review checklist:

1. Age gate is enforced twice — list filtering plus an independent server-side re-check before the provider call.
2. The server never accepts or persists translated text supplied by the client. `save` takes `previewId`; `share` takes `previewId` or `translationId`.
3. Rate limiting fails closed. No Redis, no service.
4. Style resolution never falls back silently. Unknown or disabled → throw → 400 with the available styles.
5. The Style Engine stays a library with the `loadStyle(styleId): Promise<LoadedStyle>` contract, no filesystem paths in the signature, no Prisma/Redis/HTTP access.
6. Sharing stays inside Telegram — `t.me/share/url` first, inline mode as fallback; no deep links carrying text, no browser share sheet, no implicitly created public URL, nothing but the message text in a share intent.
7. Refresh tokens exist only as HMAC hashes in Postgres and only travel in an HttpOnly cookie guarded by double-submit CSRF.
8. Preview and share payloads stay encrypted, key-versioned, unlogged, and keyed by HMAC so no plaintext appears in Redis keys.
9. Length limits are counted in Unicode grapheme clusters (1000 for input, 3800 for a rendered share message) and are never silently truncated.
10. Prisma is the only database access path; raw SQL only in migrations.
11. AI keys stay server-side.
12. Documentation moves with the code it describes.
13. The admin surface needs two independent factors (Telegram allowlist plus password step-up) and answers a byte-identical `404` to everyone else. No admin column in Postgres, no `403`, no `401` outside the step-up itself; `isAdmin` on `/user/me` is a rendering hint, never an authorization decision.
14. The operator kill-switch is never merged into the circuit breaker and never expires. It lives in the Redis hash `ai:provider:disabled` with no TTL, is read once per request *before* the breakers, excludes a provider from both the fallback chain and the recovery probe, and is cleared only by a human. Reading it fails closed; presence of the field is the switch even when the value is unparseable.
15. Observability slows nothing down and identifies nobody. Both views are written by one `onResponse` hook, so their writes fail open (a lost data point, logged at `debug`) while their reads fail closed. What may be stored is a whitelist: status code, route **pattern**, our error code, a 300-character message, the **internal** user id and the `requestId` — never a request body, headers, a query string, translated text or a Telegram id. `OPTIONS`, `/health*` and `/api/v1/admin/*` are not counted. A handler that answers a `5xx` itself must call `captureErrorSnapshot()`, or the most common real failure shows up as a bare `5xx` with no cause.

---

## 17. Defect log

The audit of `604d880` on 2026-08-15 found 25 items. A remediation pass the same day closed most of them; this section is the reconciled record. **Re-verify against the source before acting on any entry** — this is a log, not a live ledger.

### Fixed on 2026-08-15

1. **Preview cache no longer bypasses the age gate or the injection check.** `assertAgeAllowed()` and `assertNoPromptInjection()` now run on every path in `TranslationService` — before the cache lookup and before the AI call — so a warm cache cannot serve an 18+ style to a user whose `ageConfirmedAdult` was revoked. `TranslationService` is the single real enforcement point; `GET /styles` only exposes the flag and the UI lock is cosmetic.
2. The warm-cache branch of `translate()` no longer 500s on the `Translation.previewId` unique constraint — `P2002` is handled on that path too.
3. `PROMPT_INJECTION_PATTERNS` no longer carries `/g` on shared instances; `.test()` is stateless and replacement builds a fresh `RegExp`, so the intermittent false negatives are gone.
4. `translatePreview()` reads `config.PREVIEW_CACHE_TTL_SECONDS` instead of a hardcoded 600, so the payload's own expiry and the Redis TTL cannot diverge.
5. `PATCH /history/:id/favorite` **sets** the value when a body is sent and toggles only when the body is omitted; `?favorite=false` is parsed with `z.enum(['true','false'])` rather than `z.coerce.boolean()`, which used to read `'false'` as `true`.
6. All three `/translate*` endpoints share one status→reason-phrase table, so 404/409/410 no longer serialize as `Internal Server Error`; a 409 from `POST /translate/save` now returns the already-saved translation so the client can recover it.
7. `POST /telegram/webhook` has a permissive Zod body schema and compares its secret with SHA-256 + `timingSafeEqual`. `POST /auth/logout` distinguishes a bad token (401 `INVALID_TOKEN`) from an infrastructure failure (500 `LOGOUT_FAILED`, raw error logged, never returned).
8. Ollama availability is driven by `OLLAMA_ENABLED` (default: on outside production, off in production, because Ollama has no API key to infer "configured" from). `AIService.maxFallbackAttempts` is resolved per request against the live provider list, and when every breaker is open the service probes only the least-recently-failed provider instead of retrying the whole chain.
9. The five adapters no longer duplicate `withRetry` — `BaseAdapter` owns the loop and adapters override only `isNonRetryableError()`. `authenticate` lives once in `src/plugins/authenticate.ts`; the dead `rateLimitPlugin` and its type augmentation are gone.
10. `test/integration/rate-limit.integration.test.ts` matches the route again: five webhook cases (missing header, wrong secret, correct secret, rate-limit window, disabled inline mode) instead of one that expected 200 without a secret.
11. `global-setup.ts` and `vitest.integration.config.mjs` set `TELEGRAM_WEBHOOK_SECRET` and the `WEBHOOK_RATE_LIMIT_*` values themselves, so the suite no longer depends on the developer's untracked `.env`.
12. Test suites are type-checked. `tsconfig.test.json` (root) and `frontend/tsconfig.test.json` cover `test/**` and `src/**/*.test.tsx`; `npm run test:typecheck` runs both backend projects and frontend `npm run typecheck` builds all three frontend projects. The frontend `build` script builds only the app and node projects, so tests never gate the production image.
13. Stale frontend assertions fixed: `PreviewResult.test.tsx` asserts the rendered `getStyleLabel()` output. `StyleSelector.tsx` and its test were deleted along with the component.
14. `verify-style-engine.mjs` covers all six styles including GALICIAN. The mock's style detection matches a unique phrase from each prompt's `**Voice**` line (`STYLE_MARKERS`) — matching on style ids silently hit other prompts' "Avoid" sections and mis-detected five of six styles. The stale `test/integration/setup.ts` is deleted.
15. New coverage: webhook secret handling, `favorite` set and toggle, `?favorite=false`, GALICIAN preview.
16. `HistoryPage` omits the `favorite` param entirely in the "all" view instead of sending `favorite=false`, which used to filter out every favorited translation.
17. `HistoryPage` gates sharing on the registry `ageRestricted` flag, not on a hardcoded `'POFENI'`.
18. `SettingsPage` and `localSettings.ts` share the exported `LOCAL_SETTINGS_STORAGE_KEY`, so the cross-tab `storage` listener actually fires.
19. `ReactQueryDevtools` is mounted behind `import.meta.env.DEV`. `StyleDropdown` has full keyboard handling (Escape, arrows, Enter, `role="listbox"`/`role="option"`).
20. Settings placeholders removed: the version comes from `__APP_VERSION__` (injected from `package.json`), and the feedback row stays hidden until a deployment configures a URL.
21. `.env.example` is an exact mirror of the Zod schema and boots as-is: the `PREVIEW_ROOT_KEY` placeholder is a valid 32-byte base64 value, and optional variables with no default are commented out rather than set to an empty string that fails `min(1)`.
22. `plans/docs/03-database.md` documents GALICIAN and the reworded POFENI. `README.md` no longer claims Tailwind and its env table lists `AI_MAX_FALLBACK_ATTEMPTS`, `OLLAMA_ENABLED`, `CIRCUIT_BREAKER_*`, `TELEGRAM_WEBHOOK_SECRET` and `WEBHOOK_RATE_LIMIT_*`.
23. Duplicates and clutter deleted: `vitest.integration.config.ts`, `test/verify-style-engine.ts`, the two extra Ollama mocks (`test/mock-ollama-server.ts`, `test/helpers/mock-ollama.ts`), `test/integration/setup.ts`, the ~20 loose JSON fixtures and one-off scripts in `test/`, and `auth_payload.json` at the root. `@fastify/cookie`, `jsonwebtoken` and `@types/jsonwebtoken` were removed from `package.json` — cookies are hand-rolled in `src/routes/auth.ts` and JWTs are handled by `jose`.
24. POFENI was self-contradicting: its `prompt.md` recommended «хата» and «бабло» while the appended `Avoid these words:` block (built from its own `forbidden` list) banned them. The prompt was rewritten around prison speech plus the post-release register, examples were corrected, and the registry version was bumped `1.0.1 → 1.1.0` — mandatory, because `styleVersion` is part of the preview-cache HMAC key, so a warm cache would otherwise keep serving old-prompt output.
25. All `console.*` outside `src/config` replaced with structured pino logging.

### Fixed on 2026-08-17 (audit follow-up)

A second remediation pass, split into six groups. All of it lives in the working tree; none of it is committed.

- **Dead client code removed.** `translateDirect` (no caller — see §7 for why the endpoint stays), `showMainButton`/`hideMainButton` and the equally unused `showBackButton`/`hideBackButton`. `MainButton` typings in `telegram.d.ts` were kept: they describe the host SDK, not a product promise. `MainButton` and deep links were dropped from ROADMAP Stage 7 with the reason recorded in place, so the decisions are not re-litigated.
- **Sharing documentation matched to the code.** `t.me/share/url` via `openTelegramLink` is documented as the primary path and `switchInlineQuery` as the fallback, in `AGENTS.md` §2, `plans/docs/09-telegram-sharing.md`, and §11 above. Doc 09 also promised `410` for an expired share source, while `src/routes/share.ts` answers `404 SHARE_SOURCE_NOT_FOUND` for missing, expired and not-owned alike — deliberately, so a caller cannot probe which condition it hit. The document now says so.
- **Docs 01 and 02 rewritten** to describe the real backend modules (auth cookie/CSRF model, preview/save split, `HISTORY_MAX_ENTRIES`) and the real frontend boot sequence and layering; `README.md` documents the history cap and the favorites exemption.
- **Frontend component tests added** — see §14 — plus a `scrollIntoView` stub in `src/test/setup.ts` and an `engines.node` range on `frontend/package.json` derived from the installed vite and oxlint rather than copied from the root.
- **CI added** (`.github/workflows/ci.yml`), documented in `CONTRIBUTING.md` and `README.md`. It lints only the frontend, because `oxlint` and `.oxlintrc.json` exist only there and the root has no `lint` script.
- **Health and hygiene.** `GET /health/ready` with an integration test and §8 of `plans/docs/04-api.md`; an `api` healthcheck in `docker-compose.production.yml`; the `Dockerfile` pinned through one global `ARG NODE_IMAGE`; `.gitattributes` enforcing `eol=lf`; `test-rate-limit.ps1` deleted as superseded by `test/integration/rate-limit.integration.test.ts`.

**Not yet verified on Windows** (the sandbox cannot run any of it): `npx prisma generate` — until it runs, a root `tsc` reports phantom errors on the `providerId` rename — then `prisma migrate deploy` for `20260817090000_provider_id_free_form` and `20260817120000_restore_trgm_indexes`, `npm run test:unit`, `npm run test:integration`, frontend `npm run lint` and `npm test` (the five new test files have never executed), `npm run build` in both trees, and a `docker build` to confirm the pinned base-image tag pulls. Frontend `tsc -b` and the Style Engine smoke test did pass in the sandbox. The same applies to everything added by admin-panel steps C and D: `test/unit/metrics.test.ts`, `test/unit/error-feed.test.ts`, `test/integration/admin-metrics.integration.test.ts` and `test/integration/admin-errors.integration.test.ts` have been type-checked but never executed.

### Closed after the audit

- **`.env` in git history — history rewritten, rotation declined.** `main` and `origin/main` are clean; only local `refs/original/*` filter-branch backups still reach the old commits. The repository was private throughout and was deleted and recreated after the leak was noticed, so the owner decided the keys need no rotation. Settled — do not re-raise. See `plans/docs/10-repository-hygiene.md`.
- **`node_modules` is no longer tracked.** The ~8788 inherited paths were removed from the index in an isolated commit; the installed directory was left on disk. This is what used to make `git status` at the repository root time out.
- **`verify-style-engine.mjs` no longer touches the build output.** It copies `dist/style-engine/` into a `mkdtemp` sibling, disables `pofeni` in the copy and imports *that* `loader.js` — a different module path, hence a separate snapshot cache — then asserts the real `registry.json` is untouched. A crash can now leave at most a stray temp directory, never a broken registry.
- **The documentation-language policy now covers the two Ukrainian specs explicitly** (see §15) instead of counting them as violations.

### Still open

- Share coverage is still thin (one happy path, one ownership case, one rendered-`shareText` case), and real-provider output quality is never tested by design.
- `package-lock.json` was not regenerated after the dependency removals — run `npm install` once on the development machine; a Linux run would resolve different optional native packages.
- POFENI's rewritten `prompt.md` still needs a native-speaker read for register and word choice. Nothing automated can judge it.
- `slangua-deploy.tar.gz` is still in the working tree. It is untracked (so it was left alone) and `*.tar.gz` is now gitignored. The same goes for `deploy-build.log`, covered by `*.log`.
- Nothing from either remediation pass is committed. The working tree carries both, so a `git stash` or a careless checkout would lose it.

---

## 18. Where to look for what

| Concern | Open this |
| --- | --- |
| Product intent, philosophy, env var tables | `README.md` |
| Working rules for agents and contributors | `AGENTS.md` |
| Architecture rationale and layering | `plans/architecture.md`, `plans/docs/01-backend.md`, `plans/docs/02-frontend.md` |
| What is built and what is next | `plans/ROADMAP.md` |
| Why a decision was made the way it was | `plans/docs/05-decisions.md` |
| Endpoint contracts, error codes | `plans/docs/04-api.md`, then `src/routes/*.ts` |
| Schema, indexes, migrations | `prisma/schema.prisma`, `prisma/migrations/` |
| Style definitions and lexical separation | `plans/docs/07-styles.md`, `src/style-engine/` |
| Prompt assembly | `src/services/ai/base.adapter.ts` (`buildSystemPrompt`) |
| Provider selection, retry, breakers | `src/services/ai/ai.service.ts`, `src/services/ai/provider.factory.ts` |
| Operator kill-switch for providers | `src/services/ai/provider-switch.service.ts`, read in `ai.service.ts`, flipped from `src/routes/admin.ts` |
| Age gate, injection check, preview/save | `src/services/translation.service.ts` |
| Auth, tokens, CSRF | `src/services/auth.service.ts` (initData HMAC, `jose` JWT, refresh rotation), `src/routes/auth.ts` (cookies) |
| Encryption and key derivation | `src/lib/preview-keys.ts`, `src/services/preview-cache.service.ts`, `src/services/share-payload.service.ts` |
| Rate limiting | `src/plugins/rate-limit.ts` (`createRateLimiter`), used per route and globally in `src/app.ts` |
| Admin access, step-up sessions, lockout | `src/plugins/require-admin.ts` (the `onRequest` gate), `src/services/admin/admin-auth.service.ts`, `src/routes/admin.ts` |
| Usage metrics and the error feed | `src/plugins/observability.ts` (the `onResponse` hook and `captureErrorSnapshot`), `src/services/admin/metrics.service.ts`, `src/services/admin/error-feed.service.ts` |
| Sharing | `src/services/telegram-inline.service.ts`, `src/routes/share.ts` |
| Every env var and its validation | `src/config/index.ts` |
| Frontend screens | `frontend/src/pages/` |
| Frontend API client and types | `frontend/src/services/api.ts`, `frontend/src/types/api.ts` |
| Test fixtures and the LLM mock | `test/helpers/` |
| Security posture, hygiene debt | `plans/docs/06-security.md`, `plans/docs/10-repository-hygiene.md` |

---

## 19. How to use this document

Hand it to a model together with the request. It is written to be sufficient on its own: nothing here depends on a prior conversation, an agent's memory, or tool output.

If the model is going to change code, also give it `AGENTS.md` — this briefing describes the system, `AGENTS.md` describes how to work in it. If the change touches an API contract, security behaviour, or the style set, the relevant file under `plans/docs/` is the authority and must be updated alongside the code.

Treat section 17 as a snapshot, not a ledger. Verify before you act on it.
