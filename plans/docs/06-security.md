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

## Rate Limiting & Abuse Prevention

Redis is used for request‑frequency counters per `userId` or `IP` with sliding‑window limits. This prevents API and AI‑provider abuse.

Redis is a required runtime dependency. If it cannot connect at startup or becomes unavailable, rate-limited requests fail closed with `503 RATE_LIMITER_UNAVAILABLE`; the service never claims to run with rate limiting disabled. A coarse global IP limiter (`GLOBAL_RATE_LIMIT_*`) covers all routes except `/health`, while sensitive routes also have narrower user-based limits. The two token-minting routes are keyed by IP rather than user, because no authenticated user exists yet, and they carry their own tighter budget (`AUTH_RATE_LIMIT_*` for `POST /auth/telegram`, `REFRESH_RATE_LIMIT_*` for `POST /auth/refresh`, 20 req/min each by default) instead of the generic per-user allowance.

## Secrets

Secrets reach the process through the environment only, and the Zod schema in `src/config/index.ts` refuses to boot on an invalid one. Shape validation is not enough on its own: every placeholder in `.env.example` is valid by shape — the dummy `PREVIEW_ROOT_KEY` really does decode to 32 bytes — so a "copy the example and edit it later" deployment used to run on secrets that are public in this repository. With `NODE_ENV=production` the schema additionally rejects those placeholder values for `JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET`, `PREVIEW_ROOT_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. The error names the variable and never echoes its value. Development and the test suites are unaffected, since they are meant to run on placeholders.

For a full description of Redis responsibilities, see [Database Design](03-database.md#redis-responsibilities).

## Input Validation & Sanitization

- The Translation Module validates input text (length, content) and performs basic prompt‑injection protection.
- All user‑provided strings are sanitized before being passed to AI providers.

## Data Protection

- **PostgreSQL**: Stores hashed refresh tokens (never plain‑text) using HMAC-SHA256 with a server-side secret. User‑identifying data (telegramId) is not treated as a secret; it is protected via database access controls rather than encryption, since it must remain directly searchable.
- **Redis**: Contains only ephemeral, non‑sensitive data (counters, cache flags). No personally identifiable information (PII) is kept in Redis beyond transient request counters.
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
