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

For a full description of Redis responsibilities, see [Database Design](03-database.md#redis-responsibilities).

## Input Validation & Sanitization

- The Translation Module validates input text (length, content) and performs basic prompt‑injection protection.
- All user‑provided strings are sanitized before being passed to AI providers.

## Data Protection

- **PostgreSQL**: Stores hashed refresh tokens (never plain‑text) using HMAC-SHA256 with a server-side secret. User‑identifying data (telegramId) is not treated as a secret; it is protected via database access controls rather than encryption, since it must remain directly searchable.
- **Redis**: Contains only ephemeral, non‑sensitive data (counters, cache flags). No personally identifiable information (PII) is kept in Redis beyond transient request counters.

## Replay Attack Mitigation

The `auth_date` field in Telegram `WebAppData` is validated against a configurable TTL (environment‑variable driven). Requests that present an old `auth_date` are rejected outright, preventing replay of captured authentication payloads.

## Future Security Considerations

- **API Keys**: AI‑provider API keys are injected via environment variables and never exposed in client‑side code.
- **Monitoring**: Logging of authentication failures, rate‑limit hits, and unexpected errors for anomaly detection.
- **Security Headers**: The frontend will enforce Content‑Security‑Policy, X‑Frame‑Options, and other modern browser‑security headers.