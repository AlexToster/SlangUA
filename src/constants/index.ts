import { SlangStyle, AIProvider } from '@prisma/client';

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
 * Shared constant for all valid AIProvider enum values.
 * Derived from the Prisma AIProvider enum to prevent drift across routes.
 */
export const AI_PROVIDER_VALUES = [
  'OPENAI',
  'ANTHROPIC',
  'GEMINI',
  'OLLAMA',
  'OPENROUTER',
] as const satisfies readonly AIProvider[];

/**
 * TypeScript union type derived from AI_PROVIDER_VALUES.
 * Use this type for type-safe AI provider handling.
 */
export type AIProviderValue = (typeof AI_PROVIDER_VALUES)[number];

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
