import { SlangStyle } from '@prisma/client';

/**
 * Shared constant for all valid SlangStyle enum values.
 * Derived from the Prisma SlangStyle enum to prevent drift across routes.
 */
export const SLANG_STYLE_VALUES = [
  'GEN_Z',
  'STREET',
  'IT_SLANG',
  'POFENI',
  'KANCLER',
  'GALICIAN',
] as const satisfies readonly SlangStyle[];

/**
 * TypeScript union type derived from SLANG_STYLE_VALUES.
 * Use this type for type-safe slang style handling.
 */
export type SlangStyleValue = (typeof SLANG_STYLE_VALUES)[number];

/**
 * Zod enum schema for validating slang style values.
 * Use this in validation schemas instead of inline string arrays.
 */
export const slangStyleEnum = SLANG_STYLE_VALUES;

/**
 * Shape of a provider instance id, used both for validating configuration and
 * for the `providerId` field the API returns.
 *
 * Free-form on purpose: `Translation.providerId` is text, not an enum, so adding
 * a provider is a config change instead of a database migration. The pattern is
 * what keeps that freedom from turning into arbitrary strings in the database -
 * lowercase, no spaces, short enough to log and index.
 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Instance ids the factory knows how to build without extra configuration.
 * `AI_EXTRA_INSTANCES` adds to this list; it cannot shadow an entry of it.
 */
export const BUILTIN_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'openrouter',
] as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

/**
 * Hard cap on how many translations one user keeps in history.
 *
 * Enforced server-side in TranslationService after every insert: the oldest
 * non-favorite rows are pruned so the newest HISTORY_MAX_ENTRIES survive.
 * Favorites are never pruned, so a user who favorites everything can exceed
 * the cap - that is deliberate, losing a starred translation would be worse.
 *
 * GET /history echoes this number as `totalLimit` so the client never has to
 * hardcode it.
 */
export const HISTORY_MAX_ENTRIES = 100;
