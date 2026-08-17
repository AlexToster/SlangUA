// The integration suites use vitest's globals (`describe`, `it`, `expect`, …),
// which are declared in vitest's own `globals.d.ts`. It is referenced by path
// because vitest exports that entry with a `types` condition only, which
// NodeNext type-library resolution (`types: ["vitest/globals"]`) rejects.
/// <reference path="../node_modules/vitest/globals.d.ts" />
export {};
