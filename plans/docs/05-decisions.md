# Architectural Decisions

## Architectural Rationale

- **Fastify**: Chosen for its industry-leading performance and built-in schema validation. During development, it runs directly on the host for better debugging and performance.
- **Prisma**: Provides a type-safe ORM that perfectly complements TypeScript, reducing runtime database errors.
- **Redis**: Used exclusively for caching, rate limiting, and ephemeral data to ensure low-latency performance.
- **Adapter Pattern & AIService**: Provides high availability. The fallback strategy ensures that if the primary AI provider fails, the system automatically switches to a backup, maintaining service continuity.
- **Hybrid Docker Workflow**:
    - **Development**: PostgreSQL and Redis run in Docker; Fastify backend runs on the host.
    - **Production**: Full Docker Compose stack for consistent deployment and integration testing.

## Simplified Backend Layering

This project intentionally uses a simplified Route → Service → Prisma architecture suitable for a solo-developer MVP. This is a proactive architectural decision.

See [Backend Architecture](01-backend.md) for the full layering diagram and module breakdown.

See [Security](06-security.md) for authentication and rate‑limiting considerations.