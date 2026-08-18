// The component tests use vitest's globals (`describe`, `it`, `expect`, …),
// enabled by `test.globals: true` in vite.config.ts. A side-effect import, not a
// `/// <reference>`: vitest exports that entry with a `types` condition only,
// which the type-library form (`types: ["vitest/globals"]`) rejects here, while
// module resolution reads the condition fine. The module declares globals only,
// so there is nothing to name in the import.
import 'vitest/globals';
