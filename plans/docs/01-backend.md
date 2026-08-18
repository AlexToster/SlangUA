# Backend Architecture

## Main Modules – Backend (Node.js/Fastify)

### Backend Layering

```text
Telegram Mini App
        ↓
Fastify Route (Plugin + TypeBox/Zod validation)
        ↓
Service (Business Logic)
        ├── Prisma Client
        ├── Redis
        └── AI Adapter
                ├── OpenAI-compatible (OpenAI, OpenRouter, local Ollama)
                ├── Anthropic
                └── Gemini
        ↓
PostgreSQL
```

> **Note:** For simplicity, the **"AI Adapter"** block in this layering diagram represents the complete AI integration subsystem described later in the **AI Service & Adapters** section, including the AI Service, Provider Factory, provider adapters, and concrete AI providers.

- **Fastify Routes**
  - endpoint registration
  - request validation
  - response formatting
  - no business logic

- **Services**
  - business logic
  - direct Prisma Client access
  - direct Redis access where appropriate
  - AI Adapter usage
  - transaction coordination

- **Prisma Client**
  - the only database access layer

- **AI Adapter**
  - abstraction over AI providers
  - provider selection
  - retry
  - timeout
  - fallback

See [Architectural Decisions](05-decisions.md) for the rationale behind the simplified Route → Service → Prisma architecture.

- **`Auth Module`**:
    - Validates `WebAppData` using HMAC-SHA256 (Telegram Secret).
    - After successful HMAC verification, `auth_date` must be validated against a configurable TTL (configured via an environment variable) to mitigate replay attacks.
    - Requests with an expired `auth_date` must be rejected.
    - Returns the JWT access token in the response body and keeps it in frontend memory only. The refresh token never appears in JSON: it is set as the HttpOnly `slangua_refresh` cookie, stored HMAC-hashed in PostgreSQL with an expiry, and rotated on every refresh.
    - Pairs that cookie with a readable `slangua_csrf` cookie; `POST /auth/refresh` requires the matching `X-CSRF-Token` header (double-submit), so a cross-site request cannot mint tokens.
    - Access tokens carry a `jti` naming the `RefreshToken` record they came from, which makes per-device logout possible without touching other sessions.
    - Extensible `AuthStrategy` for future providers.
- **`Translation Module`**:
    - Validates input text (length, content) and performs basic prompt injection protection.
    - Manages "Slang Styles" (e.g., "Gen-Z", "Street", "IT-Slang").
    - Serves the Mini App through the preview/save split: `POST /translate/preview` calls the AI and returns an unsaved result held in encrypted Redis, `POST /translate/save` persists it by `previewId` alone. `POST /translate` remains as the one-shot translate-and-persist contract for non-Mini-App callers.
    - Orchestrates AI calls and database logging.
- **`AI Service & Adapters`**:
    - **`IAIProvider`**: Interface defining `translate(request)` plus the instance's `id` — a lowercase string matching `PROVIDER_ID_PATTERN`, persisted as `Translation.providerId`.
    - **`AIService`**: Implements provider fallback strategy, timeout handling, retry policy and a per-instance circuit breaker (keyed by `id`).
    - **`OpenAICompatibleAdapter`**: One parameterized class for every provider that speaks the OpenAI Chat Completions format. Configured instances today: `openai`, `openrouter` and `ollama` (a local server via its `/v1` endpoint), plus anything listed in `AI_EXTRA_INSTANCES`. Per-instance options: base URL, model, key requirement, temperature, output-cap field name, extra body fields and extra headers.
    - **`ClaudeAdapter`**, **`GeminiAdapter`**: The two providers that keep a native SDK — Anthropic for prompt caching, Gemini because its native API has no system role and needs its own error classification.
    - **`KeyPool`**: Each adapter holds one. `*_API_KEY` accepts a comma-separated list of keys; the pool leases them in turn and parks a key the provider refused for a cooldown (`AI_KEY_COOLDOWN_*`), so a spent free-tier key does not take the whole instance down. With a single key the behaviour is unchanged.
    - **`ProviderFactory`**: Builds one instance per configured id and orders them by `AI_PROVIDER_PRIORITY`. An instance the list does not mention still participates, sorted last; an instance missing its base URL, model or key is skipped with an error log rather than failing boot.
- **`History Module`**:
    - Provides paginated access to user-specific translations.
    - Handles "Favorite" flagging and search.
    - Caps a user's history at `HISTORY_MAX_ENTRIES` (100, a server constant — not configurable per deployment) by pruning the oldest non-favorite rows after every insert. Favorites are never pruned, so a user who stars everything can exceed the cap. `GET /history` echoes the cap as `totalLimit` so the client never hardcodes it.
- **`User Module`**:
    - Basic profile management (settings, preferences).

## Communication Flow

1. **Handshake**: Frontend retrieves `initData` from Telegram, sends to `/api/v1/auth/telegram`.
2. **Session**: Backend verifies the HMAC and `auth_date`, checks/creates the user in PostgreSQL, stores the hashed refresh token, and answers with the access token in the body plus the `slangua_refresh` (HttpOnly) and `slangua_csrf` cookies.
3. **Preview Request**:
    - User selects "Gen-Z" style and types "Привіт".
    - Frontend sends POST `/api/v1/translate/preview` with payload and JWT.
4. **AI Processing**:
    - Backend validates input and sanities against prompt injection.
    - `AIService` selects the primary provider (e.g., the `openai` instance of `OpenAICompatibleAdapter`).
    - Generates system prompt based on selected style.
    - Calls OpenAI API.
5. **Preview & Save**:
    - Backend encrypts the result into Redis under a 10-minute TTL and returns it with an opaque `previewId`. Nothing is persisted yet.
    - If the user keeps the result, the frontend sends POST `/api/v1/translate/save` with that `previewId` and no text; the backend writes the History record from the payload it stored itself.
6. **Rate Limiting**: Redis tracks request frequency per user ID to prevent abuse.

`POST /api/v1/translate` collapses steps 3–5 into one call that translates and persists at once. It stays available for callers outside the Mini App; see [API](04-api.md).

```mermaid
sequenceDiagram
    participant User as Telegram User
    participant App as React WebApp
    participant API as Fastify Backend
    participant AI as AI Provider (OpenAI)
    participant Cache as Redis
    participant DB as PostgreSQL

    User->>App: Opens App
    App->>API: POST /api/v1/auth/telegram (initData)
    API->>API: Verify HMAC + auth_date
    API->>DB: Upsert User & Store Hashed Refresh Token
    API-->>App: Access token (body) + refresh & CSRF cookies
    User->>App: Enters text + style
    App->>API: POST /api/v1/translate/preview (text, style) + JWT
    API->>API: Validate & Sanitize Input
    API->>AI: Request Translation (Fallback Strategy)
    AI-->>API: Slang Result
    API->>Cache: Store encrypted preview (10 min TTL)
    API-->>App: Translation Result + previewId
    App-->>User: Show Slang
    User->>App: Taps Save
    App->>API: POST /api/v1/translate/save (previewId) + JWT
    API->>Cache: Resolve & delete preview
    API->>DB: Save History Record
    API-->>App: Saved Translation
```

## AI Provider Configuration

The `AIService` is managed via a central configuration that defines the operational parameters for all adapters:

- **Provider Priority**: `AI_PROVIDER_PRIORITY`, an ordered list of instance ids determining which one to attempt first. Ids it omits sort last rather than being disabled.
- **Enable/Disable Flags**: Granular control to toggle specific providers (e.g., disabling a provider during maintenance). For key-bearing providers, presence of a key is the switch; `OLLAMA_ENABLED` exists because a local server has no key to check.
- **API Keys**: Injected via environment variables (e.g., `OPENAI_API_KEY`), each accepting a comma-separated pool of keys that the adapter rotates through. A provider that authenticates nobody declares `requiresApiKey: false` instead of carrying a placeholder key.
- **Key Cooldowns**: `AI_KEY_COOLDOWN_RATE_MS`, `AI_KEY_COOLDOWN_QUOTA_MS` and `AI_KEY_COOLDOWN_INVALID_MS` — how long a refused key stays parked before the pool offers it again.
- **Extra Instances**: `AI_EXTRA_INSTANCES` names additional OpenAI-compatible endpoints; each id `<ID>` reads `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY` and the optional `AI_TIMEOUT_<ID>`.
- **Base URLs**: `AI_BASE_URL_*` per OpenAI-compatible instance, including the API version segment. Ollama has no variable of its own — `/v1` is appended to `OLLAMA_BASE_URL`.
- **Timeouts**: Specific duration limits for each provider to prevent hanging requests. The same value is passed to the SDK client so an in-flight HTTP request is aborted, not merely abandoned.
- **Retry Policy**: Defined number of attempts and backoff intervals for transient error handling. Retries belong to `BaseAdapter` alone: every SDK client is constructed with `maxRetries: 0`, otherwise the SDK's own default of 2 multiplies into up to 9 HTTP calls per translation.
- **Fallback Behavior**: Automatic escalation to the next highest-priority enabled provider upon failure or timeout.

For architectural rationale, see [Architectural Decisions](05-decisions.md).

For security considerations related to authentication and rate limiting, see [Security](06-security.md).