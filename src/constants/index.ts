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