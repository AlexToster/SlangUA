# SlangUA Development Roadmap

This document defines the recommended implementation order for the SlangUA project and complements [architecture.md](architecture.md). It serves as a guide for building the system sequentially, from data design to deployment.

---

## Stage 1 — Architecture `[done]`

**Purpose:**
Finalize the system architecture.

**Include:**
- Technology stack (Fastify, React, Prisma, Postgres, Redis)
- System architecture (Client-Server-Storage-AI)
- Backend (Layered architecture: Route-Service-Prisma)
- Frontend (React SPA inside Telegram)
- Communication flow (Auth handshake, Translation flow)
- Security (JWT, HMAC validation, Input sanitization)
- AI provider strategy (Adapter pattern, Fallback, Priority)
- Architectural decisions (Simplified MVP layers)

**Deliverable:**
Approved [architecture.md](architecture.md)

---

## Stage 2 — Database Design (Conceptual) `[done]`

**Purpose:**
Design the conceptual database model.

**Include:**
- Data model (Users, Translations, Refresh Tokens)
- Entities and Attributes
- Relationships (One-to-many for user translations)
- Constraints (Unique IDs, non-nullable fields)
- Data lifecycle (Token expiration, history retention)
- Redis responsibilities (Rate limiting, caching)
- Scalability considerations

**Deliverable:**
Approved conceptual database model.

---

## Stage 3 — Prisma Schema Design `[done]`

**Purpose:**
Convert the conceptual model into Prisma.

**Include:**
- Prisma models (`User`, `Translation`, `RefreshToken`)
- Relations and Referential integrity
- Enum for slang styles; provider ids kept as a plain string on purpose
- Indexes (Performance optimization)
- Constraints (Database-level validation)
- Migrations (Initial schema setup)
- Prisma Client generation
- Seed strategy for development data

**Deliverable:**
Approved `schema.prisma`

---

## Stage 4 — Backend API Design `[done]`

**Purpose:**
Design backend contracts.

**Include:**
- Routes (Auth, Translate, History, User)
- Request/Response DTOs (TypeBox/Zod)
- Validation rules
- Error handling (Standardized error responses)
- Authentication flow (JWT issue/refresh)
- Services interfaces
- OpenAPI/Swagger documentation

**Deliverable:**
Approved backend API design.

---

## Stage 5 — Backend Implementation `[done]`

**Purpose:**
Implement the backend logic.

**Include:**
- Fastify server setup
- Prisma integration
- Redis for rate limiting
- AI Adapter (OpenAI, Gemini, etc.)
- Authentication (Telegram HMAC validation)
- Translation logic (prompt engineering and validated, cached Style Engine)
- Non-persistent preview, explicit save, encrypted Redis payloads, and Telegram inline-share backend
- History management
- User profile management
- Background jobs (if required for logging/cleanup)

*After every completed feature perform a quick manual verification (Postman/curl).*

**Deliverable:**
Working backend API.

---

## Stage 6 — Frontend Design `[done]`

**Purpose:**
Design the Telegram Mini App UI.

**Include:**
- UI structure (Translate as root, History, Settings; no separate Home or admin screen)
- Navigation flow
- Components (Input area, Style selector, Result card)
- State management (React Query, Local state)
- Telegram UX (Theme alignment)
- Responsive layout (Mobile-first)

**Deliverable:**
Approved [frontend design specification](docs/08-frontend-design.md).

---

## Stage 7 — Frontend Implementation + Telegram Mini App Integration `[done]`

**Purpose:**
Implement the Telegram Mini App.

**Include:**
- React/Vite project setup
- Telegram SDK integration
- InitData authentication
- Theme support (Sync with Telegram theme)
- Viewport handling
- Haptic Feedback
- Backend API integration
- Explicit Telegram sharing for eligible previews and saved History results
- Voice input on the Translate screen as an input method (see the exception in Stage 10)

*After every completed feature perform manual verification inside the Telegram client.*

Two items were dropped from this stage rather than left as open promises: `MainButton` (the app drives its own in-flow buttons, and a floating native button duplicated them) and deep-link support (nothing in the product needs an inbound link, and a link that resolves to a result would contradict the sharing rule in [09](docs/09-telegram-sharing.md)).

The stage is closed on the strength of the shipped app: all three screens, the admin route, Telegram bootstrap/theme/safe-area/haptics, sharing and voice input are implemented and covered by the automated suites. What is *not* claimed here is the on-device pass on real Android and iOS clients — microphone permission, the share sheet and theme switching behave differently per host — so that verification is tracked as its own Stage 8 item instead of holding this stage open indefinitely.

**Deliverable:**
Working Telegram Mini App.

---

## Stage 8 — Integration & Testing `[in progress]`

**Purpose:**
Validate the complete system.

**Include:**
- End-to-end testing (Happy path: Auth -> Translate -> History)
- Integration testing (Backend-DB, Backend-AI)
- Unit testing (Business logic, Adapters)
- Frontend testing (bootstrap and router, the `services/api.ts` 401→refresh interceptor, Translate screen states)
- Manual testing (UX/UI edge cases)
- **On-device Telegram verification** carried over from Stage 7: the real Android and iOS clients, where microphone permission, the share sheet and light/dark theme switching are host-specific and cannot be asserted from CI
- Performance testing (Response times)
- Security testing (JWT validity, API protection)
- AI provider validation (Quality of slang)

**Deliverable:**
Production-ready application.

The automated half of this stage is in place: the happy path runs as one HTTP journey where every id travels from the previous response (`test/integration/flow.integration.test.ts`), token forgery, cross-user history reads and the rate limiter's fail-closed branch have their own suite with a control case per assertion (`test/integration/security.integration.test.ts`), the whole `PROMPT_INJECTION_PATTERNS` array is covered sample-by-sample plus benign Ukrainian text (`test/unit/prompt-injection.test.ts`), and the frontend gaps are closed by tests for the bootstrap/router, the `401 → refresh → one retry` interceptor and the Translate screen's debounce and 403 recovery. What remains is what a machine cannot answer here: the on-device Telegram pass, UX edge cases by hand, performance numbers under load, and the slang-quality matrix per provider.

---

## Stage 9 — Deployment `[planned]`

**Purpose:**
Deploy the application.

**Include:**
- Docker Compose configuration
- Environment configuration (.env management)
- Nginx reverse proxy: HTTPS/TLS termination, static frontend serving, `/api/v1` proxying, trusted client IP forwarding, and same-site cookie delivery
- Production deployment (VPS/Cloud)
- Monitoring setup
- Logging (Fastify/System logs)
- Backups strategy (Postgres dumps)

**Deliverable:**
Production deployment.

---

## Stage 10 — Future Features

**Include:**
- Ukrainian Speech-to-Text (Voice messages)
- OCR (Image translation)
- Premium subscription (Limits, Exclusive styles)
- Admin panel (Statistics, User management)
- Analytics (Usage patterns)
- Additional AI providers (Local LLMs)

*Note: These features are outside the MVP scope.*

**Exception, in progress:** the admin panel is being built ahead of this stage, at the repository owner's request, in four steps — A: access layer (Telegram allowlist + password step-up, `404` for everyone else, read-only provider overview) `[done]`; B: operator kill-switch for AI providers (`PATCH /admin/providers/:providerId`, a Redis switch with no TTL that outranks the circuit breaker and is cleared only by a human) `[done]`; C: usage metrics (`GET /admin/metrics` — requests and `5xx` per minute, over a rolling 24 hours and per UTC day, users per day with the average per user, today's heaviest users by internal id, and the all-time account count from Postgres) `[done]`; D: error feed (`GET /admin/errors` — the last `ADMIN_ERROR_FEED_MAX` failures, newest first, with the code and technical message the client was never told, and no `DELETE`) `[done]`. Everything it needs lives in Redis: no Postgres migration, no admin column, no user role — the one relational read it added is a `COUNT` over the existing `User` table for the all-time total. Both observability views are read-only and are fed by one `onResponse` hook that writes after the reply, so a Redis failure costs a data point rather than a request; neither stores request text or a Telegram id, and neither counts `/health*`, `OPTIONS` preflights or the panel's own reads. Contract: [04-api.md §8](docs/04-api.md#8-admin-routes); rules: [06-security.md](docs/06-security.md#admin-access). Statistics and user management in the bullet above remain post-MVP in the broader sense — steps C and D cover operator-facing load and error visibility, not user administration.

**Second exception:** Ukrainian speech-to-text from the bullet list above was built ahead of this stage as well, at the repository owner's request, and deliberately in its narrowest useful form: an **input method** on Translate, not the "voice messages" feature the bullet names. The client records with `MediaRecorder` and posts the clip to `POST /api/v1/transcribe`; the transcript is appended to the draft and becomes a `Translation` row only if the user then previews and saves it like typed text, so nothing in the preview/save contract changed. Five steps — 1: the endpoint with its own STT `KeyPool` (`STT_API_KEY`, pool id `stt`), an OpenAI-compatible provider behind `STT_BASE_URL` + `STT_MODEL` (Groq `whisper-large-v3-turbo` by default), its own per-minute budget, a container allowlist and a size ceiling `[done]`; 2: the recording mechanics on the client (`useAudioRecorder`, 30-second cap, platform container detection, microphone released on stop) `[done]`; 3: the microphone button in the editor footer, in the slot «Вставити» held, with the transcript appended to the end of the draft `[done]`; 4: documentation and scope `[done]`; 5: the recording row — the first version's red-filled square read as an error, so the pill now expands into a blinking dot, a count-up timer and a live level meter, with a cancel chip and a blue plate at rest `[done]`. Audio is never persisted — not Postgres, not Redis, not a log line — and a deployment without `STT_API_KEY` has no microphone at all rather than one that answers `503`. Real-time dictation, TTS, voice commands and speaker recognition stay out of scope. Contract: [04-api.md §7](docs/04-api.md#7-voice-input-routes); rules: [06-security.md](docs/06-security.md#voice-input); rationale: [05-decisions.md](docs/05-decisions.md#voice-input-goes-through-our-own-endpoint).

---

## Development Principles

- **Complete stages sequentially.** Do not skip ahead.
- **Finish each stage with an approved deliverable.** Clear milestones.
- **Work in small reviewable iterations.** Frequent updates.
- **Validate every completed feature.** Continuous verification.
- **Keep [architecture.md](architecture.md) and [ROADMAP.md](ROADMAP.md) synchronized.** Reflect changes in both.
- **Keep both documents separate.** Do not merge them.
