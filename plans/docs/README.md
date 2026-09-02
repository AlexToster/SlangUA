# SlangUA Documentation

Architectural documentation for SlangUA: backend, frontend, database, API, architectural decisions, security and the Style Engine specification.

---

Navigation is hub-and-spoke across three levels (README.md → this index → architecture.md / 01-10); the links that run both ways between neighbouring levels are deliberate, not duplication.

## Documents

| File | Description |
| ---- | ---- |
| **01-backend.md** | Backend Architecture — Node.js/Fastify backend, modules, communication flow, AI Provider configuration. |
| **02-frontend.md** | Frontend Architecture — client structure, Telegram Mini App, UI. |
| **03-database.md** | Database Design — the conceptual data model and the Prisma schema. |
| **04-api.md** | API Design — routes, DTOs, API contracts and validation. |
| **05-decisions.md** | Architectural Decisions — the decisions taken and the reasoning behind them. |
| **06-security.md** | Security — authentication, authorization, rate limiting, data protection. |
| **07-styles.md** | Style Engine Specification — the style system's architecture, the Style Engine's structure and the specification of each style. **Written in Ukrainian.** |
| **08-frontend-design.md** | Frontend Design Specification (Stage 6) — UX, states, Telegram behavior, API gaps and acceptance criteria for the Mini App. **Written in Ukrainian.** |
| **09-telegram-sharing.md** | Telegram-native Sharing Architecture — explicit share flow, privacy model, inline bot contract and rollout criteria. |
| **10-repository-hygiene.md** | Repository hygiene audit and separately reviewable cleanup plan for tracked secrets and dependencies. |

> Two documents are in Ukrainian on purpose: their subject **is** Ukrainian text — the style lexicons, forbidden words and before/after examples in 07, and the interface copy in 08. Translating them would distort the very material they specify. The language policy for the whole repository is in [CONTRIBUTING.md](../../CONTRIBUTING.md) (in Ukrainian).

---

## Links

- [ROADMAP.md](../ROADMAP.md) — the staged technical implementation plan.
- [architecture.md](../architecture.md) — the architectural design of the project, a Telegram web application.
- [prisma/schema.prisma](../../prisma/schema.prisma) — the database schema.
