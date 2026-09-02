# Configuration

Full reference for every SlangUA environment variable.

The source of truth is the Zod schema in [`src/config/index.ts`](../src/config/index.ts):
invalid configuration deliberately refuses to let the process start. A list of
every key with inline comments, kept in sync with that schema, lives in
[`.env.example`](../.env.example); this document covers the same keys in more
depth, grouped by purpose.

The minimal set of keys and how to generate the secrets are in
[CONTRIBUTING.md](../CONTRIBUTING.md#локальний-запуск) (in Ukrainian).

> **Wrap any value that contains `$` in single quotes.** In production this file
> is read not by `dotenv` but by Docker Compose's own parser (`env_file` in
> [`docker-compose.production.yml`](../docker-compose.production.yml)), and that
> parser interpolates: inside an unquoted or double-quoted value, `$N` is treated
> as a reference to a variable named `N`, which does not exist, and is replaced
> with an empty string. Single quotes disable interpolation, and both parsers
> strip the quotes themselves — so one and the same line works locally and in the
> container. The hint is in the logs: Compose prints `The "N" variable is not set.
> Defaulting to a blank string.` at the very start of `docker compose up`, long
> before the application's own error. The classic `$$` escape does not help here:
> `dotenv` does not unescape it, so local development breaks on the same value.

## Required

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `REDIS_URL` | Redis connection URL. |
| `JWT_SECRET` | Secret used to sign JWTs (at least 32 characters). |
| `REFRESH_TOKEN_HMAC_SECRET` | Secret for HMAC-hashing refresh tokens (at least 32 characters). |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token, used to verify `initData`. |
| `PREVIEW_ROOT_KEY` | Base64-encoded 32-byte key that encrypts the preview cache. |

> Placeholder values from [`.env.example`](../.env.example) — everything marked `example-only`, plus the demo `PREVIEW_ROOT_KEY` — are rejected at startup when `NODE_ENV=production`. A copy of the example cannot be deployed as it is.

## Key optional settings (with defaults)

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `NODE_ENV` | `development` | Runtime mode (`development` / `production` / `test`). It controls more than logging: under `production` the session cookie gains `SameSite=None; Secure; Partitioned` — without that the Mini App inside Telegram Web (a cross-site iframe) loses its session. In [`docker-compose.production.yml`](../docker-compose.production.yml) the value is set in `environment:`, so editing `.env` has no effect on it. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Address the backend server binds to. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `7d` | Lifetime of the access and refresh tokens. |
| `AUTH_DATE_TTL` | `86400` | TTL of Telegram's `auth_date` in seconds (replay protection). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | — | AI provider keys (all optional, but at least one provider is needed). Each variable accepts **several comma-separated keys** — an exhausted key is parked and the next one serves the request. |
| `AI_KEY_COOLDOWN_RATE_MS` | `60000` | How long a key that hit a rate limit is parked for. |
| `AI_KEY_COOLDOWN_QUOTA_MS` | `3600000` | The same, for a key whose quota is exhausted. |
| `AI_KEY_COOLDOWN_INVALID_MS` | `3600000` | The same, for a key the provider rejected as invalid. |
| `AI_MODEL_*` | see the config | Model names per provider. |
| `AI_BASE_URL_OPENAI` | `https://api.openai.com/v1` | Base URL of an OpenAI-compatible instance, API version included. Can point at any compatible endpoint (Groq, DeepSeek, vLLM, a proxy) without touching the code. |
| `AI_BASE_URL_OPENROUTER` | `https://openrouter.ai/api/v1` | The same for OpenRouter. |
| `AI_EXTRA_INSTANCES` | — | Additional OpenAI-compatible instances, comma-separated, e.g. `groq,deepseek`. An id matches `[a-z0-9_-]`, up to 32 characters, and may not collide with a built-in one (`openai`, `anthropic`, `gemini`, `ollama`, `openrouter`). Each `<ID>` is configured through `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY` and an optional `AI_TIMEOUT_<ID>`; an instance missing its URL, model or key is skipped with an error log rather than breaking startup. |
| `AI_PROVIDER_PRIORITY` | `openai,anthropic,gemini,ollama,openrouter` | Fallback order between providers. Every configured instance takes part: one that is not named in the list goes to the end, it is not disabled. An unknown id is ignored with a warning. |
| `AI_MAX_FALLBACK_ATTEMPTS` | — | Maximum providers tried per request; with no value, as many as are available. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Address of a local Ollama. There is no `AI_BASE_URL_OLLAMA` of its own: the OpenAI-compatible `/v1` path is appended to this host. |
| `OLLAMA_ENABLED` | — | `true`/`false`. With no value: enabled outside production, disabled in production (Ollama has no API key from which "configured" could be inferred). |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` / `CIRCUIT_BREAKER_RESET_MS` | `5` / `60000` | How many consecutive failures open a provider's breaker, and for how long. |
| `TELEGRAM_INLINE_ENABLED` | `false` | Enables Telegram inline sharing. |
| `TELEGRAM_WEBHOOK_SECRET` | — | Required when `TELEGRAM_INLINE_ENABLED=true`: the expected `x-telegram-bot-api-secret-token`. |
| `WEBHOOK_RATE_LIMIT_WINDOW_MS` / `WEBHOOK_RATE_LIMIT_MAX_REQUESTS` | `60000` / `30` | Request budget for `POST /telegram/webhook`. |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX_REQUESTS` | `60000` / `20` | Budget for `POST /auth/telegram` per IP — separate from the general `RATE_LIMIT_*`, because that endpoint hands out tokens. |
| `REFRESH_RATE_LIMIT_WINDOW_MS` / `REFRESH_RATE_LIMIT_MAX_REQUESTS` | `60000` / `20` | The same for `POST /auth/refresh`. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Origins allowed by CORS. |
| `TRUST_PROXY` | `false` | Trust proxy headers when resolving the client IP. |
| `LOG_LEVEL` | `info` | Log level, and with it the log volume: container logs are capped, so `debug` in production does not grow the archive — it shortens the window. See [operations.md](operations.md#логи-стеля-і-ротація) (in Ukrainian). |

> Rate limiting, the preview/save/share TTLs and other fine-grained settings are configurable through env as well — for the complete list see [`src/config/index.ts`](../src/config/index.ts).

## Voice input (STT)

The microphone in the input field is off by default: while `STT_API_KEY` is empty, `POST /api/v1/transcribe` answers `503 STT_UNAVAILABLE` and `GET /api/v1/user/me` returns `voiceInputAvailable: false` — so the client simply does not draw the button. The endpoint speaks the OpenAI-compatible `/v1/audio/transcriptions`, so the provider is swapped with two variables (`STT_BASE_URL` + `STT_MODEL`) and no code change; the default is Groq with `whisper-large-v3-turbo`.

The keys here are **separate from the AI providers'** and also accept a comma-separated list with the same rotation: an exhausted transcription quota must not park a key the translator needs, even when both share one account at the provider.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `STT_API_KEY` | — (empty) | Comma-separated keys for the transcription provider. An empty value means voice input does not exist. Its own pool (`stt`), independent of the AI layer's `*_API_KEY`. |
| `STT_BASE_URL` | `https://api.groq.com/openai/v1` | Base URL of an OpenAI-compatible instance, API version included. Any compatible endpoint works (Groq, OpenAI, a local Whisper server, a proxy). |
| `STT_MODEL` | `whisper-large-v3-turbo` | Model name requested from the provider. Returned to the client in the `model` field. |
| `STT_LANGUAGE` | `uk` | Language pinned explicitly rather than auto-detected: on a short Ukrainian recording Whisper hears Russian far too often. |
| `STT_TIMEOUT_MS` | `30000` | Timeout for a single request to the provider. |
| `STT_MAX_AUDIO_BYTES` | `1048576` | Ceiling on the size of the already-decoded audio (413 `STT_AUDIO_TOO_LARGE`). The route's own `bodyLimit` is derived from the same value, so an over-long recording is cut off before the body is buffered. |
| `STT_KEY_COOLDOWN_RATE_MS` | `60000` | How long a key that hit a rate limit is parked for. |
| `STT_KEY_COOLDOWN_QUOTA_MS` | `3600000` | The same, for a key whose quota is exhausted. |
| `STT_KEY_COOLDOWN_INVALID_MS` | `3600000` | The same, for a key the provider rejected as invalid. |
| `STT_RATE_LIMIT_WINDOW_MS` / `STT_RATE_LIMIT_MAX_REQUESTS` | `60000` / `6` | A per-user budget of its own for `POST /api/v1/transcribe`. Separate from the general one, because every call spends provider quota that the whole deployment shares. |
| `STT_RATE_LIMIT_KEY_PREFIX` | `ratelimit:stt` | Prefix of the limiter's keys in Redis. |

> Audio is stored nowhere: not in Postgres, not in Redis, not in a file, not in a log. The buffer lives inside the handler for exactly one request to the provider, and the recognised text is returned to the client and not written either — it becomes a row in the database only once the user sends it for translation as ordinary typed text. Details in [`plans/docs/06-security.md`](../plans/docs/06-security.md).

## Admin panel

The admin panel is off by default: while `ADMIN_TELEGRAM_IDS` is empty, every `/api/v1/admin/*` route answers **404** — the same 404 a non-existent path gets. Access takes two independent factors: a Telegram id from the list, and a password whose hash lives in `.env`. There is no role in the database — deployment configuration makes an admin, not a row in Postgres. The route contract is in [`plans/docs/04-api.md`](../plans/docs/04-api.md).

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `ADMIN_TELEGRAM_IDS` | — (empty) | Comma-separated numeric Telegram ids allowed to sign in. An empty value means the admin panel does not exist. Ids only: a username can be changed by its owner, and Telegram does not sign it in `initData`. |
| `ADMIN_PASSWORD_HASH` | — (empty) | scrypt hash of the password, in the form `scrypt$N=…,r=…,p=…$<salt>$<key>`. Generated locally with `node scripts/hash-admin-password.mjs` (the password is read from stdin, minimum 12 characters, and never appears in the output). In `.env` put the value in **single quotes** — it always contains three `$`, so without quotes Compose strips `$N` and `$p` out of it (see the interpolation note at the top of this document). The hash's shape is checked at startup, so a mangled paste fails the boot instead of looking like a forever-wrong password. Required whenever `ADMIN_TELEGRAM_IDS` is set: an allowlist without a password would be a single factor. |
| `ADMIN_SESSION_TTL_SECONDS` | `900` | Idle window of an admin session: extended on every request to the panel. |
| `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | Hard window: never extended, so a stolen admin token dies within 8 hours even under constant use. Cannot be smaller than the idle window. |
| `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_LOGIN_RATE_LIMIT_MAX` | `300000` / `5` | Password attempt budget (429). Separate from the general one, because 100 requests/min is no obstacle to brute force. |
| `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_LOCKOUT_MS` | `5` / `900000` | Lockout after N wrong passwords. Counted **per Telegram id**, so one admin cannot lock out another; the counter expires together with the lockout. |
| `ADMIN_RATE_LIMIT_WINDOW_MS` / `ADMIN_RATE_LIMIT_MAX_REQUESTS` | `60000` / `120` | Budget for admin routes that are already authenticated. |
| `METRICS_MINUTE_SERIES_LENGTH` | `60` | How many minutes the load chart shows (1440 maximum). This is both the depth of the series and the lifetime of the per-minute counters: each key's expiry is computed from its own bucket, so "the last hour" means the same thing for every key. |
| `METRICS_RETENTION_DAYS` | `7` | How many daily rows (UTC) `GET /admin/metrics` returns, and how long the daily counters live. There is no cleanup job — retention **is** the key's lifetime. |
| `METRICS_TOP_USERS_LIMIT` | `10` | How many of today's most active users to show. The row carries the internal numeric id only — never a Telegram id, never a username. |
| `ADMIN_ERROR_FEED_MAX` | `100` | Length of the error feed: the Redis list is trimmed to this on every write, so it cannot grow. A `?limit=` larger than this is not an error — it is simply clamped. |
| `ADMIN_ERROR_FEED_TTL_SECONDS` | `604800` | Lifetime of the whole feed key, renewed on every write: a week without failures empties it by itself. |

> `ADMIN_PASSWORD_HASH` is deliberately **not** among the "placeholders" rejected in production: in [`.env.example`](../.env.example) the variable is empty, because any well-formed example value would be the hash of a password published in this repository. A different rule covers it at startup instead — an allowlist without a hash refuses to boot.

> The provider kill switch has no environment variable at all, on purpose: it is an operator decision taken while the system is running, not a deployment setting. The state lives in Redis (the `ai:provider:disabled` hash) **without a TTL** and survives restarts; a provider can only be switched off and on again through `PATCH /api/v1/admin/providers/:providerId` (or by hand with `HDEL`). One caveat: `FLUSHDB` turns everything that was disabled back on — a conscious trade for keeping the AI layer independent of Postgres.

> The rolling 24 hours in the load section has no variable either: the window length is hard-coded (24 hourly buckets), because the panel draws it as a fixed row of bars, not as a chart of variable width. The hourly keys (`metrics:req:h:*`, `metrics:err:h:*`, `metrics:users:h:*`) live for about 26 hours — two hours longer than the window, so the oldest bucket does not vanish exactly when it is being read. The «Усього людей за весь час» ("people in total, all time") row is the admin panel's only figure that comes from Postgres (a `COUNT` over `User`): the buckets cannot supply it, because they expire, and after a quiet week the all-time total would go down.

> Neither overview section writes anything to Postgres — everything they accumulate sits in Redis: the counters (`metrics:req:*`, `metrics:err:*`, `metrics:users:h:*`, `metrics:users:d:*`) and the error feed (`admin:errors`) expire on their own by the terms above, so there is no separate cleanup. What ends up in there is limited to an allowlist: status code, route template, our error code, a truncated technical message, the internal user id and the `requestId`. No request text, no headers, no Telegram id — see [`plans/docs/06-security.md`](../plans/docs/06-security.md).

## Frontend (Vite, build time)

These variables are **not part** of the backend's Zod schema: Vite inlines them into the bundle at build time (`VITE_*`), so they are public by definition — there can be no secrets here. The source of truth for their types is [`frontend/src/vite-env.d.ts`](../frontend/src/vite-env.d.ts).

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | Base for requests to the backend. In production it is passed as a build arg in the [`Dockerfile`](../Dockerfile). |
| `VITE_FEEDBACK_URL` | `https://t.me/+1lYdnphwsLBlZWMy` | Link to the discussion channel in the «Зворотний зв'язок» ("Feedback") section of Settings. Telegram links are opened through `openTelegramLink`. |
| `VITE_SHARE_URL` | `https://t.me/SlangUA_bot` | Link to the app, appended **after** a shared translation. Point it at your own bot if you deploy your own instance. |

## Deployment only (read by Docker Compose, not by the app)

These are **not part** of the Zod schema either: Compose itself reads them while parsing [`docker-compose.production.yml`](../docker-compose.production.yml), so locally they change nothing. They live in the same `.env` because in production Compose reads that file twice — as the `env_file` for the `api` container, and as its own substitution source for `${…}` in the remaining services.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `POSTGRES_PASSWORD` | — (required in production) | Password of the `slangua` user for the `db` service, and the same value inside the `DATABASE_URL` that Compose assembles for `api`. Without it `docker compose up` fails with a named error instead of starting a database with an empty password. Not needed for a local run against an existing Postgres: `DATABASE_URL` carries the credentials itself. |
| `BACKUP_DIR` | `./backups` | Host directory mounted into the `db-backup` container as `/backups`. Dumps appear in `daily/` and `weekly/`, owned by `root`. On a real server prefer a path **outside** the repository (`/var/backups/slangua`, say): a dump inside the working copy sits on the same disk as the database it insures, and a single `docker compose down -v` can leave it the only copy. |
| `BACKUP_AT` | `03:30` | Time of the daily dump, `HH:MM` in UTC. Anything else stops the container with a readable error at startup — so that a typo does not quietly mean "never take a backup". |
| `BACKUP_KEEP_DAILY` | `7` | How many daily dumps to keep. |
| `BACKUP_KEEP_WEEKLY` | `4` | How many weekly ones. The Sunday dump additionally gets a **hard link** in `weekly/`, so 7 + 4 cover a week by day and a month by Sundays without storing Sunday twice. |
| `BACKUP_HEARTBEAT_URL` | — (empty) | An optional dead man's switch: a URL requested **only after a successful dump**. An empty value changes nothing. The service on the other end (Healthchecks.io, Better Stack, UptimeRobot's heartbeat monitor) alerts **on silence** — the only way to learn that backups stopped happening, because a job that did not run reports nothing. The value is a secret: whoever holds it can keep the monitor quiet while no dumps are being taken, so it never reaches a log. A 10 s timeout is hard-coded in the script; a failed request logs `ERROR` and does **not** mark the dump as failed. How to set it up and verify it — [operations.md](operations.md#бекапи-сповіщення-за-тишею) (in Ukrainian). |

> The weekday for the weekly copy (`BACKUP_WEEKLY_DAY`, ISO: 1 = Monday … 7 = Sunday) is deliberately not surfaced in Compose: it is a value that gets set once and for all, and an extra line in `.env` costs more than editing one line in [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh).

> How backups actually work, the verified restore procedure, and what these variables **do not** do (Redis is not dumped, there is no encryption) — [operations.md](operations.md) (in Ukrainian). It also holds the step-by-step runbooks for the [first deployment](operations.md#перше-розгортання), for updates and for rollback.

