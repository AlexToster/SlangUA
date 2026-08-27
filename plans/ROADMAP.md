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

## Stage 8 — Integration & Testing `[done]`

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

The automated half of this stage is in place: the happy path runs as one HTTP journey where every id travels from the previous response (`test/integration/flow.integration.test.ts`), token forgery, cross-user history reads and the rate limiter's fail-closed branch have their own suite with a control case per assertion (`test/integration/security.integration.test.ts`), the whole `PROMPT_INJECTION_PATTERNS` array is covered sample-by-sample plus benign Ukrainian text (`test/unit/prompt-injection.test.ts`), and the frontend gaps are closed by tests for the bootstrap/router, the `401 → refresh → one retry` interceptor and the Translate screen's debounce and 403 recovery.

**Closed on 2026-08-27.** Every automated suite ran green on the owner's machine — typecheck, the Style Engine smoke check, 176 unit tests across 10 files, the integration suites against throwaway Postgres and Redis containers, and the frontend's lint, typecheck, tests and build — and the rebuilt `frontend/dist` was pushed, which also retired the stale bundle that used to bounce an authenticated admin back to the root screen. The gate for closing the stage is that no machine-checkable claim is left unverified; that is now true.

Four items from the list above are **not** claimed as done and move into Stage 9 as [9.8](#stage-9--deployment-in-progress): the on-device Telegram pass on real Android and iOS, UX edge cases by hand, response times under load, and the slang-quality matrix per provider. They are not deferred out of convenience — each of them needs the deployed instance to mean anything. A latency number measured against `localhost` with no TLS, no reverse proxy and no shared CPU says nothing about production, and the Telegram host behaviour that Stage 7 could not assert (microphone permission, the share sheet, theme switching) is exactly what changes when the Mini App is loaded from a public HTTPS origin instead of a dev tunnel. Measuring them twice would be honest but wasteful; measuring them on the real deployment is the point.

---

## Stage 9 — Deployment `[in progress]`

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

### What was already in place when the stage opened

Parts of this stage were built while earlier stages were running, because a feature that cannot be deployed is not finished: the four-service `docker-compose.production.yml` (Postgres and Redis with healthchecks, the API with `prisma migrate deploy` and a readiness probe, the built frontend behind its own nginx, application ports bound to loopback), the multi-stage `Dockerfile` pinned through one `ARG NODE_IMAGE`, the three versioned nginx templates under `deploy/nginx/`, the configuration contract (Zod schema, `.env.example`, placeholders rejected under `NODE_ENV=production`), `GET /health` and `GET /health/ready`, and the operator panel that already answers "how loaded is it" and "what failed" (Stage 10, steps C and D). The stage is therefore not a blank slate — it is the gap between "there is a compose file" and "there is a service somebody else can rely on".

### Order

The order is not the order of the bullet list. It runs from the failures that cannot be undone, through the failures a user would find before we did, to the ones that only matter once the thing is public.

- **9.1 — Postgres backups with a written restore** `[done]`
  A `db-backup` service in `docker-compose.production.yml` runs `scripts/backup-postgres.sh`: one `pg_dump` per day at `BACKUP_AT` (UTC), written to a temporary file and moved into place only once complete, gzipped, with seven daily copies and four Sunday copies kept in the bind-mounted `BACKUP_DIR`. First in the order because it is the only item on this list whose absence is irreversible: every other gap costs an outage, this one costs the data. The restore procedure is written down in [docs/operations.md](../docs/operations.md), together with an explicit list of what has been verified (the script's own branches, against stubbed `pg_dump`) and what has not: **performing** a restore needs the deployed instance and is part of [9.9](#stage-9--deployment-in-progress). Until then this covers taking copies, not proving they restore — an untested dump is a belief, not a backup.
- **9.2 — Reverse-proxy correctness** `[done]`
  Two defaults in the nginx templates were wrong for this application, and both would have surfaced as a user-visible failure with a healthy application behind it: `client_max_body_size` (nginx's 1 MiB against the base64 audio body that `/transcribe` accepts up to ≈1.34 MiB — the user would get nginx's HTML 413 instead of the named error the client knows how to show) and `proxy_read_timeout` (60 s against a provider fallback chain that can legitimately run longer — nginx's own 504 while the request is still being served). The static side came with the same edit: `deploy/nginx/frontend.conf` now serves the hashed `/assets/` filenames `immutable` for a year and `index.html` with `no-store`, which is the whole release mechanism — a changed file has a changed URL, and the document naming those URLs is never cached. Second because these are cheap to fix now and expensive to diagnose from a bug report. Both are documented in [docs/operations.md](../docs/operations.md), including what to change when `STT_MAX_AUDIO_BYTES` moves.
- **9.3 — Log retention** `[done]`
  Every service in `docker-compose.production.yml` now carries a `logging:` cap: `max-size: 10m` with three files kept, five for `api`, a 170 MB ceiling across the stack. Docker's default `json-file` driver has no limit of its own, and pino writes a JSON line per request, so the only thing bounding growth was the disk — and this stack does not degrade gracefully when the disk fills: Postgres refuses writes and `pg_dump` produces a truncated file, so the copy that would have saved the situation is the first thing to break. That is why this sits with the backups rather than with housekeeping. `api` gets the deeper window because pino's stdout is the only place holding a stack trace: the admin error feed is a capped, expiring window, not an archive. The four remaining services share one YAML anchor, so a service added without logging is visible at a glance. Documented in [docs/operations.md](../docs/operations.md), including the part an operator would otherwise learn the hard way — log options are fixed when the container is created, so `up -d` applies a change and `restart` silently does not, and rotation deletes rather than archives, which makes the ceiling the limit of any later investigation. Verified by parsing the compose file (all five services capped, anchor resolved, arithmetic checked); `docker compose config` itself cannot run in this environment, and the caps have never been exercised against real traffic.
- **9.4 — Monitoring that reaches a human** `[next]`
  An external probe of `GET /health/ready` and an alert channel (Telegram to the admin ids that already exist in `ADMIN_TELEGRAM_IDS`). The operator panel is a *pull* view: it answers only while somebody is looking at it. The backup job, the readiness probe and the `5xx` feed all become useful when something announces them.
- **9.5 — Deployment runbook** `[planned]`
  Extend [docs/operations.md](../docs/operations.md) with the full sequence: certificate issuance and renewal with certbot, `__SERVER_NAME__` substitution, the first `.env` on the server (including the deployment-only variables), the first admin, upgrades, and rollback. Server-specific scripts stay outside the repository as before ([10-repository-hygiene.md](docs/10-repository-hygiene.md)); the procedure does not have to.
- **9.6 — CI builds the production image** `[planned]`
  CI currently proves the source is good and never touches `Dockerfile` or `docker-compose.production.yml`, so both can rot silently between deployments. A `docker build` of the `api` and `frontend` targets in the existing workflow is enough to catch it on the pull request instead of on the server.
- **9.7 — Public deployment** `[planned]`
  Domain, TLS via certbot, the HTTPS template in place of the bootstrap one, `.env` with real secrets, `CORS_ALLOWED_ORIGINS` and `TRUST_PROXY` set for the real origin, and the Mini App URL registered in BotFather.
- **9.8 — Pre-flight on the real deployment** `[planned]`
  The four items carried over from Stage 8: the on-device pass on real Android and iOS clients, UX edge cases by hand, response times under load, and the slang-quality matrix per provider. Plus one case the deployment adds by itself: on Telegram Web the Mini App runs in a cross-site iframe, where a `SameSite=Lax` refresh cookie is not sent, so the session recovers through a full reload instead of a silent refresh. Verify it on Telegram Web and decide deliberately whether that is acceptable or whether the cookie needs `SameSite=None`.
- **9.9 — Sign-off** `[planned]`
  The deliverable is not "it is running" but "it can be operated": a restore that has been performed, an alert that has fired, logs that stop growing, and a runbook somebody else could follow.

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
