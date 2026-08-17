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
  plugins/rate-limit.ts    Redis sliding-window limiter factory
  routes/                  auth, translate, history, user, styles, share
  services/                auth, translation, history, user,
                           preview-cache, share-payload, telegram-inline
  services/ai/             ai.service, provider.factory, base.adapter, key-pool,
                           errors, openai-compatible/claude/gemini.adapter, types
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

**Stage 8 — Integration & testing — is next.** Stage 9 is deployment (Docker Compose, nginx reverse proxy with TLS termination, monitoring, Postgres backups). Stage 10 collects post-MVP ideas: speech-to-text, OCR, premium tier, admin panel, analytics.

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
      ├── Redis          (rate limits, encrypted preview/share payloads, jti denylist)
      └── AI Service     → Provider Factory → Adapter → LLM
```

Layer rules, enforced by review rather than tooling:

- **Routes** register endpoints, validate input, shape responses, and own HTTP-only concerns. A route may set cookies; it may not contain business logic. Example of the split: `AuthService` returns `{accessToken, refreshToken}`, and the route decides that the refresh token goes into an HttpOnly cookie and only the access token into the JSON body.
- **Services** hold all logic and are the only callers of Prisma, Redis and the AI layer.
- **Prisma is the only database access layer.** Raw SQL appears only in migrations.
- **The AI adapter subsystem** owns provider selection, timeouts, retries, fallback and circuit breaking.
- **The Style Engine is a library, not a stage in this chain.** See §8.

There are no repository or use-case layers. `plans/docs/05-decisions.md` records this as a proactive choice for a solo-developer MVP, not an accidental shortcut.

`src/app.ts` boot order matters: Zod compilers → CORS (origins split from `CORS_ALLOWED_ORIGINS`, `credentials: true`) → `await connectRedis()` → `await initializeStyleEngine()` → global per-IP rate limiter as an `onRequest` hook (skips `/health`) → error handler → `GET /health` (unmetered) → all six route groups under prefix `/api/v1`. SIGTERM/SIGINT disconnect Redis and close the app. Redis is awaited before serving because the API must not run LLM routes without a working rate limiter.

The central error handler maps: Zod/Fastify validation → 400 `VALIDATION_ERROR`; expired or invalid JWT → 401 `TOKEN_INVALID`; `RATE_LIMIT_EXCEEDED` → 429; `RATE_LIMITER_UNAVAILABLE` → 503; then 404 `NOT_FOUND`, 403 `FORBIDDEN`, 422 `SEMANTIC_VALIDATION_ERROR`, 503 `AI_PROVIDERS_UNAVAILABLE`, and a 500 `INTERNAL_ERROR` fallback that only leaks the raw message in `development`.

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

Redis owns: rate-limit counters, the revoked-`jti` denylist, and encrypted preview/share payloads. PostgreSQL is the source of truth; flushing Redis must not break core functionality (it will only drop in-flight previews and rate-limit state).

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
- **`POST /translate`** — JWT. Same request DTO; translates **and** persists in one call. Returns the full `Translation`. Same error family plus its own 10/min limit. Currently unused by the UI.
- **`POST /share/inline`** — JWT. Body is exactly one of `{ previewId }` or `{ translationId }`. Returns `{ inlineQuery: "s_<uuid>", shareText, expiresAt }`, where `shareText` is the translation alone. No LLM call, no History write. Errors: 400; 401; 403 `AGE_RESTRICTED_SHARE` (age-restricted style without `ageConfirmedAdult`); 404 `SHARE_SOURCE_NOT_FOUND`; 410; 422 `SHARE_TEXT_TOO_LONG`; 429 (10/min); 503 `TELEGRAM_INLINE_UNAVAILABLE`.
- **`POST /telegram/webhook`** — no JWT; authenticated by the `x-telegram-bot-api-secret-token` header. Returns 404 when inline sharing is disabled. Handles `inline_query` updates and always answers `{ ok: true }`.

### Styles, History, User

- **`GET /styles`** — JWT. Returns every `enabled` registry entry as `{ id: <UPPERCASE>, title, ageRestricted }`. `id` is usable verbatim as the `style` field. Locking of restricted styles is left to the client, but the server re-checks independently.
- **`GET /history`** — JWT. Query: `cursor?`, `limit` (default 20, max 100), `favorite?`, `search?` (case-insensitive partial match across both texts). Returns `{ data, nextCursor, totalCount }`, newest first, `totalCount` computed over the active filters and independent of the cursor.
- **`PATCH /history/:id/favorite`** — JWT. **Toggles** the flag; the request body is ignored. 404 when the row is missing or not owned.
- **`DELETE /history/:id`** — JWT. 204, or 404 when missing/not owned.
- **`GET /user/me`** — JWT. Returns the profile including `ageConfirmedAdult`.
- **`PATCH /user/me`** — JWT, strict body. Accepts only `defaultSlangStyle`, `notificationsEnabled`, `ageConfirmedAdult`. Telegram-sourced identity fields (`telegramId`, `username`, `firstName`, `lastName`, `languageCode`) are immutable; unknown fields are rejected with 400.

Rate limits are separate Redis key prefixes per concern: `ratelimit:global` (100/min per IP, all routes except `/health`), plus `auth`, `refresh`, `translate`, `preview` (12/min), `save` (10/min), `share` (10/min), `history`, `user`, `styles`, `webhook` (30/min). Every response carries `X-RateLimit-Limit/Remaining/Reset`; a 429 also carries `Retry-After`.

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

**`BaseAdapter`** provides `isAvailable()` (enabled, and either has at least one api key or declares `requiresApiKey: false`), `withTimeout()`, `withRetry()` (exponential backoff `retryDelayMs * 2^(attempt-1)`), `isNonRetryableError()` (matches invalid api key / unauthorized / forbidden / bad request / quota exceeded / insufficient_quota), `withKeyRotation()` (leases a key from the pool, classifies a refusal as `rate` / `quota` / `invalid`, parks it and rotates instead of sleeping when a spare key exists, and throws `AllKeysExhaustedError` when none is usable), and `buildSystemPrompt(style)` which is the single call site of `loadStyle()`. `BaseAdapter` is the **only** retry owner: every SDK client is constructed with `maxRetries: 0`, because the SDK default of 2 would multiply into up to 9 HTTP calls per translation.

**`KeyPool`** (`key-pool.ts`) turns each comma-separated `*_API_KEY` into a rotating pool. Keys are leased round-robin; a refused key is parked for `AI_KEY_COOLDOWN_RATE_MS` / `_QUOTA_MS` / `_INVALID_MS` depending on how the provider refused it. Cooldowns are keyed by pool id plus key **index**, never by the key value, so no secret reaches a map key or a log line. A keyless instance is modelled as a single keyless entry. The `KeyCooldownStore` seam defaults to an in-memory store and can be swapped for a shared one.

**`ProviderFactory`** reads `AI_PROVIDER_PRIORITY` as lowercase instance ids, dropping unknown ones with a warning; an id it does not mention still participates but sorts last (priority 999). It builds per-instance configs — `enabled = at least one parsed key`, Ollama instead following `OLLAMA_ENABLED ?? NODE_ENV !== 'production'` with `requiresApiKey: false` — and exposes `getProviders()` filtered by `isAvailable()` in priority order. It also owns the table of OpenAI-compatible instances, derives Ollama's base URL as `<OLLAMA_BASE_URL>/v1`, and appends every `AI_EXTRA_INSTANCES` id (each needing `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY`, optional `AI_TIMEOUT_<ID>`; an incomplete one is logged and skipped, never fatal).

**`AIService`** adds a per-instance circuit breaker: failures accumulate, the breaker opens at `CIRCUIT_BREAKER_FAILURE_THRESHOLD`, and goes half-open after `CIRCUIT_BREAKER_RESET_MS`. `translate()` walks eligible providers sequentially; if every breaker is open it retries the whole chain as a last resort. `AllKeysExhaustedError` is deliberately **not** counted as a failure: spent keys recover on their own, and the wasted attempt costs nothing because the pool refuses the lease without an HTTP call.

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

## 11. Telegram-native sharing

Sharing is an explicit, user-initiated action on a finished result, and the only channel in v1 is **Telegram inline mode**. Three implementations are explicitly forbidden: putting the translated text in a deep link, using the generic browser share sheet, and silently creating any public URL.

Flow: a completed preview offers Copy / Send in Telegram / Save as distinct actions → "Send" appears only when `Telegram.WebApp.switchInlineQuery` exists and the result is eligible → the client calls `POST /share/inline` with `previewId` or `translationId` → the backend resolves an owned result, writes a short-lived encrypted payload and returns an opaque token → the client calls `switchInlineQuery(token, ['users','bots','groups','channels'])` → the bot receives the token, resolves it server-side, and answers with exactly one `InlineQueryResultArticle` → the user explicitly picks it.

The token is a random UUID containing no text, user id or style. Payloads are bound to **both** the SlangUA user and the Telegram user, and the inline handler verifies `inlineQuery.from.id` against the payload creator, so a leaked token is useless to another account. Invalid, expired and foreign tokens all return zero results, and the handler must not reveal which condition applied. `answerInlineQuery` is called with `cache_time: 0` and `is_personal: true`.

The rendered message is the translated text alone. The `SlangUA · <style title>` header was removed: Telegram rendered the app name as a link to the bot inside what looked like the user's own message. The style label survives only as the title of the inline result card in the picker, which is never sent. The original input is never included. Sharing never creates a `Translation` row, and Copy is the universal fallback for every error path.

Two policy limits: **an `ageRestricted` result is shareable only by a user with `ageConfirmedAdult: true`** — `POST /share/inline` reads the flag from the profile and returns 403 `AGE_RESTRICTED_SHARE` otherwise (a recipient still cannot be age-gated, so the sender carries it through the same self-attestation that unlocked the style; the UI only hides the button). And the server counts the **final rendered message** in grapheme clusters, rejecting anything above a conservative **3800** with 422 `SHARE_TEXT_TOO_LONG` — never truncating silently. That limit matters most for KANCLER's 2–4× expansion.

Deployment prerequisites before the client button can be trusted: inline mode enabled in BotFather, a configured bot token with an HTTPS webhook (or a deliberately operated long-polling worker) handling `inline_query`, and a bot username/domain consistent with the Mini App deployment.

---

## 12. Frontend

Three screens, exactly three bottom-nav items, no Home tab and no admin screen: **Translate** at `/` (the root), **History** at `/history`, **Settings** at `/settings`. Mobile-first from 320 px. The nav must not overlap the result area or the Telegram safe area.

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

One cross-field rule: `TELEGRAM_INLINE_ENABLED=true` requires a non-blank `TELEGRAM_WEBHOOK_SECRET`.

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
npm run test:unit           # vitest, no Docker — AI layer: key pool, rotation, fallback
npm run test:integration    # vitest + Testcontainers — REQUIRES Docker Desktop
npm test                    # all four in sequence
```

Frontend, in `frontend/`:

```bash
npm install
npm run dev                 # :5173, proxies /api to :3000
npm run lint                # oxlint
npm run test -- --run       # vitest + jsdom
npm run typecheck           # tsc -b — app, node and test projects
npm run build               # tsc -b tsconfig.app.json tsconfig.node.json && vite build
```

`build` deliberately leaves the test project out: the production image must not fail over a test file, and the Docker build context can contain stale ones (a server deploy that overlays an archive on the target directory without deleting removed files leaves them behind). `.dockerignore` therefore drops `frontend/src/**/*.test.*` outright, so the image never depends on the deploy procedure being careful. Deployment scripts themselves live outside the repository — they hold production server details — and only `deploy/nginx/` is versioned here.

**Integration tests are hermetic by design.** Testcontainers spins up throwaway `postgres:16-alpine` and `redis:7-alpine` instances, runs `prisma migrate deploy`, and starts an in-process Ollama-compatible mock with deterministic canned replies per style. There are **no external network calls** — not to Telegram, OpenAI, Anthropic, Gemini, a real Ollama, or anything else. All secrets are deterministic test values. Tests run serially (`fileParallelism: false`) because the app config and service singletons are process-global, and Redis plus Postgres are cleaned between tests. Consequently, **real-provider output quality is never tested**.

Coverage today: auth (HMAC failure, expired `auth_date`, malformed initData, cookie rotation, replay of a rotated-out token, refresh after logout, rate limits), translate (all styles, age gate, prompt injection, AI failure, grapheme boundaries including emoji/ZWJ/flag/skin-tone sequences, cache hits, no cross-user or cross-style cache reuse, per-endpoint rate limits, WYSIWYG persistence, duplicate save), history (keyset pagination with tied timestamps, cursor round-trip, filters, ownership, delete, `totalLimit`, server-side pruning at the cap and the favorites exemption) and `PATCH /user/me` immutability. Share coverage is thin — one happy path, one ownership case, and one asserting the server-rendered `shareText` never leaks the inline token.

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
6. Sharing is Telegram inline mode only — no deep links carrying text, no browser share sheet, no implicitly created public URL.
7. Refresh tokens exist only as HMAC hashes in Postgres and only travel in an HttpOnly cookie guarded by double-submit CSRF.
8. Preview and share payloads stay encrypted, key-versioned, unlogged, and keyed by HMAC so no plaintext appears in Redis keys.
9. Length limits are counted in Unicode grapheme clusters (1000 for input, 3800 for a rendered share message) and are never silently truncated.
10. Prisma is the only database access path; raw SQL only in migrations.
11. AI keys stay server-side.
12. Documentation moves with the code it describes.

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

### Closed after the audit

- **`.env` in git history — history rewritten, rotation declined.** `main` and `origin/main` are clean; only local `refs/original/*` filter-branch backups still reach the old commits. The repository was private throughout and was deleted and recreated after the leak was noticed, so the owner decided the keys need no rotation. Settled — do not re-raise. See `plans/docs/10-repository-hygiene.md`.
- **`node_modules` is no longer tracked.** The ~8788 inherited paths were removed from the index in an isolated commit; the installed directory was left on disk. This is what used to make `git status` at the repository root time out.
- **`verify-style-engine.mjs` no longer touches the build output.** It copies `dist/style-engine/` into a `mkdtemp` sibling, disables `pofeni` in the copy and imports *that* `loader.js` — a different module path, hence a separate snapshot cache — then asserts the real `registry.json` is untouched. A crash can now leave at most a stray temp directory, never a broken registry.
- **The documentation-language policy now covers the two Ukrainian specs explicitly** (see §15) instead of counting them as violations.

### Still open

- Share coverage is still thin (one happy path, one ownership case, one rendered-`shareText` case), and real-provider output quality is never tested by design.
- `package-lock.json` was not regenerated after the dependency removals — run `npm install` once on the development machine; a Linux run would resolve different optional native packages.
- POFENI's rewritten `prompt.md` still needs a native-speaker read for register and word choice. Nothing automated can judge it.
- `slangua-deploy.tar.gz` is still in the working tree. It is untracked (so it was left alone) and `*.tar.gz` is now gitignored.

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
| Age gate, injection check, preview/save | `src/services/translation.service.ts` |
| Auth, tokens, CSRF | `src/services/auth.service.ts` (initData HMAC, `jose` JWT, refresh rotation), `src/routes/auth.ts` (cookies) |
| Encryption and key derivation | `src/lib/preview-keys.ts`, `src/services/preview-cache.service.ts`, `src/services/share-payload.service.ts` |
| Rate limiting | `src/plugins/rate-limit.ts` (`createRateLimiter`), used per route and globally in `src/app.ts` |
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
