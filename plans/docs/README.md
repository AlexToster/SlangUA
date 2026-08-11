# SlangUA Documentation

Архітектурна документація проєкту SlangUA: backend, frontend, база даних, API, архітектурні рішення, безпека та специфікація Style Engine.

---

Навігація — hub-and-spoke між трьома рівнями (README.md → цей індекс → architecture.md/01-08); посилання в обидва боки між сусідніми рівнями є навмисними, не дублюванням.

## Документи

| Файл | Опис |
| ---- | ---- |
| **01-backend.md** | Backend Architecture — Node.js/Fastify backend, modules, communication flow, AI Provider configuration. |
| **02-frontend.md** | Frontend Architecture — структура клієнта, Telegram Mini App, UI. |
| **03-database.md** | Database Design — концептуальна модель БД та Prisma Schema. |
| **04-api.md** | API Design — маршрути, DTO, контракти API та валідація. |
| **05-decisions.md** | Architectural Decisions — прийняті архітектурні рішення та їх обґрунтування. |
| **06-security.md** | Security — автентифікація, авторизація, rate limiting, захист даних. |
| **07-styles.md** | Style Engine Specification — архітектура системи стилів, структура Style Engine та специфікація стилів. |
| **08-frontend-design.md** | Frontend Design Specification (Stage 6) — UX, стани, Telegram behavior, API gaps та acceptance criteria для Mini App. |
| **09-telegram-sharing.md** | Telegram-native Sharing Architecture — explicit share flow, privacy model, inline bot contract and rollout criteria. |
| **10-repository-hygiene.md** | Repository hygiene audit and separately reviewable cleanup plan for tracked secrets and dependencies. |

---

## Посилання

- [ROADMAP.md](../ROADMAP.md) — поетапний план технічної реалізації для Roo Code.
- [architecture.md](../architecture.md) — архітектурний дизайн проекту, веб-застосунку Telegram.
- [prisma/schema.prisma](../../prisma/schema.prisma) — схема бази даних.
