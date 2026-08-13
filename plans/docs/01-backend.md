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
                ├── OpenAI
                ├── Anthropic
                ├── Gemini
                ├── Ollama
                └── OpenRouter
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
    - Manages JWT Access and Hashed Refresh tokens (stored in PostgreSQL with expiration).
    - Extensible `AuthStrategy` for future providers.
- **`Translation Module`**:
    - Validates input text (length, content) and performs basic prompt injection protection.
    - Manages "Slang Styles" (e.g., "Gen-Z", "Street", "IT-Slang").
    - Orchestrates AI calls and database logging.
- **`AI Service & Adapters`**:
    - **`IAIProvider`**: Interface defining `translate(text, style)` method.
    - **`AIService`**: Implements provider fallback strategy, timeout handling, and retry policy.
    - **`OpenAIAdapter`**, **`ClaudeAdapter`**, **`GeminiAdapter`**, **`OllamaAdapter`**, **`OpenRouterAdapter`**: Implementation details for each provider.
    - **`ProviderFactory`**: Resolves implementation based on priority and availability.
- **`History Module`**:
    - Provides paginated access to user-specific translations.
    - Handles "Favorite" flagging and search.
- **`User Module`**:
    - Basic profile management (settings, preferences).

## Communication Flow

1. **Handshake**: Frontend retrieves `initData` from Telegram, sends to `/api/v1/auth/telegram`.
2. **Session**: Backend verifies data, checks/creates user in PostgreSQL, stores hashed Refresh Token, returns JWTs.
3. **Translation Request**:
    - User selects "Gen-Z" style and types "Привіт".
    - Frontend sends POST `/api/v1/translate` with payload and JWT.
4. **AI Processing**:
    - Backend validates input and sanities against prompt injection.
    - `AIService` selects the primary provider (e.g., `OpenAIAdapter`).
    - Generates system prompt based on selected style.
    - Calls OpenAI API.
5. **Persistence & Response**:
    - Backend saves both original and slang version to PostgreSQL.
    - Returns JSON response to Frontend.
6. **Rate Limiting**: Redis tracks request frequency per user ID to prevent abuse.

```mermaid
sequenceDiagram
    participant User as Telegram User
    participant App as React WebApp
    participant API as Fastify Backend
    participant AI as AI Provider (OpenAI)
    participant DB as PostgreSQL

    User->>App: Opens App
    App->>API: POST /api/v1/auth/telegram (initData)
    API->>API: Verify HMAC
    API->>DB: Upsert User & Store Hashed Refresh Token
    API-->>App: JWT Access + Refresh
    User->>App: Enters text + style
    App->>API: POST /api/v1/translate (text, style) + JWT
    API->>API: Validate & Sanitize Input
    API->>AI: Request Translation (Fallback Strategy)
    AI-->>API: Slang Result
    API->>DB: Save History Record
    API-->>App: Translation Result
    App-->>User: Show Slang
```

## AI Provider Configuration

The `AIService` is managed via a central configuration that defines the operational parameters for all adapters:

- **Provider Priority**: An ordered list determining which provider to attempt first.
- **Enable/Disable Flags**: Granular control to toggle specific providers (e.g., disabling a provider during maintenance).
- **API Keys**: Injected via environment variables (e.g., `OPENAI_API_KEY`).
- **Timeouts**: Specific duration limits for each provider to prevent hanging requests.
- **Retry Policy**: Defined number of attempts and backoff intervals for transient error handling.
- **Fallback Behavior**: Automatic escalation to the next highest-priority enabled provider upon failure or timeout.

For architectural rationale, see [Architectural Decisions](05-decisions.md).

For security considerations related to authentication and rate limiting, see [Security](06-security.md).