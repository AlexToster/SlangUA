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
- Enums (Slang styles, AI providers)
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

## Stage 7 — Frontend Implementation + Telegram Mini App Integration `[in progress]`

**Purpose:**
Implement the Telegram Mini App.

**Include:**
- React/Vite project setup
- Telegram SDK integration
- InitData authentication
- Theme support (Sync with Telegram theme)
- Viewport handling
- Main Button usage
- Haptic Feedback
- Deep Links support
- Backend API integration
- Explicit Telegram inline sharing for eligible previews and saved History results

*After every completed feature perform manual verification inside the Telegram client.*

**Deliverable:**
Working Telegram Mini App.

---

## Stage 8 — Integration & Testing `[next]`

**Purpose:**
Validate the complete system.

**Include:**
- End-to-end testing (Happy path: Auth -> Translate -> History)
- Integration testing (Backend-DB, Backend-AI)
- Unit testing (Business logic, Adapters)
- Manual testing (UX/UI edge cases)
- Performance testing (Response times)
- Security testing (JWT validity, API protection)
- AI provider validation (Quality of slang)

**Deliverable:**
Production-ready application.

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

---

## Development Principles

- **Complete stages sequentially.** Do not skip ahead.
- **Finish each stage with an approved deliverable.** Clear milestones.
- **Work in small reviewable iterations.** Frequent updates.
- **Validate every completed feature.** Continuous verification.
- **Keep [architecture.md](architecture.md) and [ROADMAP.md](ROADMAP.md) synchronized.** Reflect changes in both.
- **Keep both documents separate.** Do not merge them.
