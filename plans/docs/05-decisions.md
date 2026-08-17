# Architectural Decisions

## Architectural Rationale

- **Fastify**: Chosen for its industry-leading performance and built-in schema validation. During development, it runs directly on the host for better debugging and performance.
- **Prisma**: Provides a type-safe ORM that perfectly complements TypeScript, reducing runtime database errors.
- **Redis**: Used exclusively for caching, rate limiting, and ephemeral data to ensure low-latency performance.
- **Adapter Pattern & AIService**: Provides high availability. The fallback strategy ensures that if the primary AI provider fails, the system automatically switches to a backup, maintaining service continuity.
- **Hybrid Docker Workflow**:
    - **Development**: PostgreSQL and Redis run in Docker; Fastify backend runs on the host.
    - **Production**: Full Docker Compose stack for consistent deployment and integration testing.

## Three Adapter Classes, N Configured Instances

`src/services/ai/` has one adapter class per **wire protocol**, not per vendor:

- `OpenAICompatibleAdapter` — every provider speaking the OpenAI Chat Completions format. Configured instances today: `openai`, `openrouter`, and a local Ollama through its `/v1` endpoint. It replaced `OpenAIAdapter`, `OllamaAdapter` and `OpenRouterAdapter`, which were three copies of the same request/response handling differing only in base URL, key requirement and a couple of body fields.
- `ClaudeAdapter` — native Anthropic SDK, kept for the prompt-caching option (`cache_control`), which the OpenAI format has no equivalent for.
- `GeminiAdapter` — native Google SDK, kept because the Gemini API has no system role (the style prompt has to be folded into the request differently) and its errors need their own classification.

An instance is a set of parameters — `id`, `baseURL`, `model`, `requiresApiKey`, `temperature`, output-cap field name, `extraBody`, `defaultHeaders` — so pointing at another compatible endpoint (Groq, DeepSeek, vLLM, a proxy) is an `.env` change, not new code. `AI_EXTRA_INSTANCES` makes that explicit: a comma-separated list of ids, each configured through `AI_BASE_URL_<ID>`, `AI_MODEL_<ID>`, `<ID>_API_KEY` and the optional `AI_TIMEOUT_<ID>`.

Consequences accepted with this decision:

- **There is no provider enum.** `Translation.providerId` is a free-form lowercase string validated against `PROVIDER_ID_PATTERN`, because `AI_EXTRA_INSTANCES` can name an instance the code has never seen — an enum would make every deployment-level addition a Prisma migration and a frontend union change. The `provider_id_free_form` migration renamed the column and lowercased its values; the frontend renders ids through `getProviderLabel()`, which falls back to the uppercased id for anything it has no label for. The cost is that the database no longer rejects a typo'd id, so validation lives in the constant and in the response schemas.
- **The id, not the vendor, is the unit of configuration.** Two instances of the same vendor (say, two accounts for one API) differ only by id, which keeps that a config change rather than a refactor. The id keys the circuit breaker, the key pool and the logs.
- **`requiresApiKey: false` replaces placeholder keys.** A local server authenticates nobody; `isAvailable()` asks the config instead of inspecting a fake key such as the former `'ollama-local'`.
- **`maxRetries: 0` on every SDK client.** `BaseAdapter.withRetry` is the single retry owner, so all providers observe the same `AI_MAX_RETRIES` / `AI_RETRY_DELAY_MS`. Left at the SDK default of 2, the two layers multiplied into up to 9 HTTP calls per translation — and an SDK-internal retry would also reuse a key that the outer layer already knows is exhausted.

The integration harness exercises this path end to end: the deterministic mock serves `POST /v1/chat/completions` and is injected as the Ollama base URL, so tests run through the same `OpenAICompatibleAdapter` as production.

## A Pool of Keys per Instance, Not One Key

Production starts on free tiers, where the quota belongs to the key rather than to the provider. So every `*_API_KEY` variable accepts a comma-separated list of keys, and each adapter holds a `KeyPool` (`src/services/ai/key-pool.ts`) that leases them in turn and parks a key the provider has just refused until its cooldown (`AI_KEY_COOLDOWN_*`) expires. With one key the behaviour is unchanged.

Pooling keys is a deployment decision with a legal edge: some vendors forbid holding several free-tier accounts, and rotation cannot make that acceptable. `.env.example` says so where the variables are documented.

## Simplified Backend Layering

This project intentionally uses a simplified Route → Service → Prisma architecture suitable for a solo-developer MVP. This is a proactive architectural decision.

See [Backend Architecture](01-backend.md) for the full layering diagram and module breakdown.

See [Security](06-security.md) for authentication and rate‑limiting considerations.