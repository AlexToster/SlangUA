// The component tests use vitest's globals (`describe`, `it`, `expect`, …),
// enabled by `test.globals: true` in vite.config.ts. Referenced by path because
// vitest exports that entry with a `types` condition only, which the bundler
// type-library resolution (`types: ["vitest/globals"]`) rejects here.
/// <reference path="../../node_modules/vitest/globals.d.ts" />
export {};
