# Security

## Authentication & Authorization

### Auth Module Details

- Validates `WebAppData` using HMAC-SHA256 (Telegram Secret).
- After successful HMAC verification, `auth_date` must be validated against a configurable TTL (configured via an environment variable) to mitigate replay attacks.
- Requests with an expired `auth_date` must be rejected.
- Manages JWT Access and Hashed Refresh tokens (stored in PostgreSQL with expiration).
- JWT access tokens include a `jti` claim referencing the specific `RefreshToken` record, enabling per-device logout without affecting other active sessions.
- Extensible `AuthStrategy` for future providers.

See [Backend Architecture](01-backend.md) for the integration of the Auth Module into the communication flow.

### Admin Access

The admin surface (`/api/v1/admin/*`, contract in [API Design](04-api.md#7-admin-routes)) is governed by three rules, each answering a different failure mode.

**Admin-ness is deployment configuration, never user data.** Membership is the comma-separated numeric Telegram id list in `ADMIN_TELEGRAM_IDS`; there is no admin column in Postgres. A database row could be flipped by anything holding write access, and a restore from backup could resurrect a former admin. Ids only, never usernames: a username can be changed by its owner and is not what Telegram signs into `initData`. The list is empty by default, and while it is empty the panel does not exist.

**Two independent factors.** The Telegram JWT proves *who* the caller is; it does not prove they intended to open the panel, so a stolen access token or a Mini App left open on an unlocked phone must not be enough. Every route except the login therefore also requires `X-Admin-Token`, a step-up session obtained by posting the admin password:

- The password is stored only as a scrypt hash in `ADMIN_PASSWORD_HASH` (`N=16384, r=8, p=1`, 16-byte salt, 32-byte key, `maxmem = 256·N·r`, compared with `timingSafeEqual`). The operator generates it locally with `scripts/hash-admin-password.mjs`, which reads the password from stdin — never from argv, which would put it in the shell history and the process list — enforces a 12-character minimum, and prints no plaintext. The hash format is validated by shape at boot, so a mangled copy-paste fails the start instead of looking like a permanently wrong password. The schema also refuses to boot with an allowlist and no hash, which would be single-factor access.
- Sessions live in Redis, not in process memory: a restart during a maintenance window must not be what decides whether the operator stays logged in, and a second replica must not hold a different truth. The key is `admin:session:<HMAC-SHA256(token)>` under an HKDF-derived, domain-separated key — the token itself appears in neither the key nor the value, so a Redis dump yields nothing usable.
- A session is bound to the `userId` that opened it. A token presented under a different account is refused *and revoked*, so holding one factor never becomes holding both.
- Two deadlines: an idle window (`ADMIN_SESSION_TTL_SECONDS`, 15 min, slides on each request but never past the hard deadline) and an absolute one (`ADMIN_SESSION_ABSOLUTE_TTL_SECONDS`, 8 h, never slides), so a leaked token dies even while actively used. The allowlist is re-checked on every request: removing an id and restarting closes the door mid-session.
- `DELETE /admin/session` locks the panel without touching the Telegram login.

**Invisibility, not refusal.** To anyone outside the allowlist every admin route returns the byte-identical `404` body Fastify produces for an unregistered path — same status, same keys in the same order, same `content-type`. `401` or `403` would confirm that the panel exists and only the password is missing. Two mechanics keep that true: the gate is an `onRequest` hook (body parsing and validation happen before `preHandler`, so a stranger sending an invalid `password` field would otherwise get a route-confirming `400 VALIDATION_ERROR`), and the gate verifies the JWT itself rather than deferring to the `401`-answering shared `authenticate` hook. The `isAdmin` flag on `/user/me` only tells the client whether to render the entry point; it is not an authorization decision, and a client that lies to itself gains a `404`.

**Guessing defences.** Wrong password and active lockout are reported identically (`401 ADMIN_PASSWORD_INVALID`), differing only in the `Retry-After` a client needs in order to back off; distinguishing them would confirm that earlier guesses were being counted. Neither the hash, the attempt count nor the submitted password ever appears in a response. Failures are counted per Telegram id — never globally — so one admin cannot lock out another, and the counter expires with the lockout window so isolated typos months apart never accumulate.

See [API Design](04-api.md#7-admin-routes) for the endpoint contracts and error codes.

### The operator kill-switch for AI providers

`PATCH /admin/providers/:providerId` is the first admin capability that changes runtime behaviour rather than reporting it, so it has security properties of its own.

**Operator intent outranks automatic recovery, in both directions.** The circuit breaker in `AIService` answers "is this provider failing?" and closes itself again after `CIRCUIT_BREAKER_RESET_MS`. The switch answers "does a human want traffic going there at all?" and nothing automatic ever clears it — not a cooldown, not a restart, not a successful probe. The two therefore do not share a mechanism: the switch is read once per request, *before* the breakers, and a switched-off provider is excluded from the fallback chain and from the recovery probe that runs when every breaker is open. Sharing one mechanism would mean a provider switched off because a key leaked, a bill ran away or a model started emitting garbage comes back on its own a minute later, with nobody watching.

**State in Redis, with no TTL.** An in-memory flag would silently re-enable a provider on the next deploy, and two replicas would disagree about what is off. An expiring switch would resurrect a provider at an arbitrary moment. The record therefore lives in the hash `ai:provider:disabled` (field = provider id) and carries who flipped it, when, and optionally why, so a switch found months later can be explained rather than merely outlived. Presence of the field is the switch; the metadata is documentation — a record written by hand during an incident (`HSET ai:provider:disabled openai 1`) still disables the provider, and an unreadable value is never read as permission to send traffic.

**Fail-closed on Redis.** If the switch cannot be read, the request fails: resolving to "nothing is disabled" would send traffic exactly where an operator forbade it. The failure surfaces as the existing `503 AI_PROVIDER_UNAVAILABLE`, and since translation requests have already passed a Redis-backed rate limiter, a Redis outage was never going to let them through anyway.

**Switching everything off is allowed, and says so.** Refusing to disable the last provider would mean the panel cannot be used to stop an incident — the exact moment an operator needs it. Instead the consequence is stated before the fact: the client warns that translation will stop, the server logs the resulting state at `error` level with the operator's Telegram id, and translation answers the same `503 AI_PROVIDER_UNAVAILABLE` an outage produces. No new error code and no user-visible detail: the end user is never told which provider a human switched off, or why. `GET /health` and `GET /ready` deliberately ignore the chain, so a deliberately quiet deployment is not restarted out from under the operator by an orchestrator.

**Audit trail.** Every flip is logged at `warn` level with the provider id, the acting Telegram id and the reason; the resulting record keeps the same three facts and the panel renders them next to the provider. The switch is an operator action, so the identity behind it is part of the state, not just of the log stream.

### What the observability views may store

`GET /admin/metrics` and `GET /admin/errors` are read-only, but they are the two places where the system accumulates a record of what users did, so what may enter them is a whitelist rather than a filter.

**The metrics carry no identity at all beyond an internal number.** The per-day user set is keyed by the internal `User.id`; the response returns it as a string. Never a Telegram id, never a username, never text: the panel needs to tell heavy users apart, not to identify them. Day boundaries are UTC so that a row does not change value when a server's timezone does.

**The error feed stores eight fields and nothing else**: the moment, the method, the registered route **pattern** (`/api/v1/history/:id` — never the concrete path, which would carry record ids), the status code, our error code, a technical message truncated to 300 characters, the internal user id, and the Fastify `requestId`. No request body, no headers, no query string, no translated text. A feed that quoted user text would rebuild in Redis exactly what the preview/save split exists to keep out of places it does not belong. The entry is assembled field by field from a two-string snapshot (`captureErrorSnapshot(request, code, message)`), not from the error object: holding the error would make it a one-line change for someone later to log a stack, a body or a translation.

**The technical message is kept even in production**, where the client is told only "An unexpected error occurred". The asymmetry is deliberate — the feed is readable only behind both admin factors, and a feed that hid the reason would be a list of timestamps. It is also why there is no `DELETE`: anything cleared would return on the next failure, and a clear button on a diagnostic view mostly invites hiding evidence. The list is capped and the whole key expires, so it bounds itself instead.

**Failures on admin routes appear in neither view.** The hook skips `/api/v1/admin/*` (as well as `OPTIONS` preflights and `/health*`), so an operator watching the panel cannot inflate its own numbers or fill the feed it is reading. Those failures live in the logs, which is where the complete record has always been.

**Both writes fail open, and this is not the rate limiter's rule inverted by accident.** They run in an `onResponse` hook, after the reply is out, so a Redis failure can only cost a data point — it is logged at `debug` rather than adding one warning per request to an outage that the rate limiter and the readiness probe are already announcing. Reads fail closed: a page of zeros would read as "no traffic" instead of "no data".

## Rate Limiting & Abuse Prevention

Redis is used for request‑frequency counters per `userId` or `IP` with sliding‑window limits. This prevents API and AI‑provider abuse.

Redis is a required runtime dependency. If it cannot connect at startup or becomes unavailable, rate-limited requests fail closed with `503 RATE_LIMITER_UNAVAILABLE`; the service never claims to run with rate limiting disabled. A coarse global IP limiter (`GLOBAL_RATE_LIMIT_*`) covers all routes except `/health`, while sensitive routes also have narrower user-based limits. The two token-minting routes are keyed by IP rather than user, because no authenticated user exists yet, and they carry their own tighter budget (`AUTH_RATE_LIMIT_*` for `POST /auth/telegram`, `REFRESH_RATE_LIMIT_*` for `POST /auth/refresh`, 20 req/min each by default) instead of the generic per-user allowance.

The admin routes add two more budgets, both applied *after* the allowlist gate so that they are keyed by the admin's own user id and no stranger can consume them: `ADMIN_LOGIN_RATE_LIMIT_*` (5 attempts per 5 minutes by default) in front of the password check, and `ADMIN_RATE_LIMIT_*` (120 req/min) on the authenticated routes. The login limiter is a second, independent line of defence next to the lockout described above — the generic 100 req/min budget is no obstacle to password guessing.

## Secrets

Secrets reach the process through the environment only, and the Zod schema in `src/config/index.ts` refuses to boot on an invalid one. Shape validation is not enough on its own: every placeholder in `.env.example` is valid by shape — the dummy `PREVIEW_ROOT_KEY` really does decode to 32 bytes — so a "copy the example and edit it later" deployment used to run on secrets that are public in this repository. With `NODE_ENV=production` the schema additionally rejects those placeholder values for `JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET`, `PREVIEW_ROOT_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. The error names the variable and never echoes its value. Development and the test suites are unaffected, since they are meant to run on placeholders.

`ADMIN_PASSWORD_HASH` is deliberately outside that placeholder list: `.env.example` ships it empty, because any example value that passed the shape check would be a hash of a password published in this repository. There is no placeholder to detect, so the real failure mode is covered by a different rule — an allowlist without a hash fails the boot.

Redis also holds two admin secrets in derived form only: the step-up session key is an HMAC of the token rather than the token, and the password itself never leaves the operator's machine — only its scrypt hash does.

For a full description of Redis responsibilities, see [Database Design](03-database.md#redis-responsibilities).

## Input Validation & Sanitization

- The Translation Module validates input text (length, content) and performs basic prompt‑injection protection.
- All user‑provided strings are sanitized before being passed to AI providers.

## Data Protection

- **PostgreSQL**: Stores hashed refresh tokens (never plain‑text) using HMAC-SHA256 with a server-side secret. User‑identifying data (telegramId) is not treated as a secret; it is protected via database access controls rather than encryption, since it must remain directly searchable.
- **Redis**: Contains only ephemeral, non‑sensitive data (counters, cache flags). No personally identifiable information (PII) is kept in Redis beyond transient request counters.
  - **Note — observability keys**: the usage counters and the error feed hold an internal `User.id` and, in the feed, a truncated technical message. Neither is a Telegram id and neither carries user text; see [What the observability views may store](#what-the-observability-views-may-store).
  - **Exception — Preview Cache**: The preview cache (`POST /translate/preview` + `POST /translate/save`) stores encrypted translation text in Redis as a deliberate, documented exception to the "no PII in Redis" policy. This data is:
    - Encrypted at application level using AES-256-GCM with a key derived by HKDF from `PREVIEW_ROOT_KEY`; preview encryption, preview deduplication HMAC, and share payload encryption use distinct domain-separated derived keys
    - Stored with a 10-minute TTL (`PREVIEW_CACHE_TTL_SECONDS`)
    - Never logged (text content is excluded from logs)
    - Deleted after successful save via `POST /translate/save` (except for a short-lived idempotency marker)
    - Keyed by HMAC of `userId:normalizedText:style:styleVersion` — **no plaintext text in Redis keys**
    - Carries `PREVIEW_KEY_VERSION`; records from another key version are discarded and naturally expire during key rotation
    - Rate-limited separately from persistent translate endpoints

## Replay Attack Mitigation

The `auth_date` field in Telegram `WebAppData` is validated against a configurable TTL (environment‑variable driven). Requests that present an old `auth_date` are rejected outright, preventing replay of captured authentication payloads.

## Future Security Considerations

- **Browser session storage**: Access tokens stay only in frontend memory. Refresh tokens are never returned in JSON or stored in localStorage; they use the `slangua_refresh` HttpOnly cookie. Refresh requests require the matching `slangua_csrf` cookie and `X-CSRF-Token` header. Production deployment must serve frontend and API through the same trusted site/reverse proxy, with HTTPS.

- **API Keys**: AI‑provider API keys are injected via environment variables and never exposed in client‑side code.
- **Monitoring**: Logging of authentication failures, rate‑limit hits, and unexpected errors for anomaly detection.
- **Security Headers**: The frontend will enforce Content‑Security‑Policy, X‑Frame‑Options, and other modern browser‑security headers.
