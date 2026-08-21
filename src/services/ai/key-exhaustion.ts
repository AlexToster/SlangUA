/**
 * Key-exhaustion classification
 *
 * Answers one question about a failed upstream call: was it the *key* that ran
 * out, and in which of the three ways `KeyPool` distinguishes? Anything else
 * returns null and must be re-thrown by the caller, because rotating to another
 * key cannot fix it.
 *
 * These two functions used to be `protected` methods on `BaseAdapter` and
 * `OpenAICompatibleAdapter`. They live here because the STT service speaks the
 * same OpenAI wire format over its own key pool without being an `IAIProvider`
 * (see src/services/stt/), and a second copy of this heuristic would drift from
 * the first the moment a provider changed its error strings.
 */

import OpenAI from 'openai';
import { KeyExhaustionKind } from './key-pool.js';

/**
 * Classify from the error message alone. The fallback for SDKs that throw plain
 * `Error`s with no status attached - Google's, among others.
 */
export function classifyKeyExhaustionFromMessage(error: unknown): KeyExhaustionKind | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();

  // A spent budget: hours, not seconds.
  if (message.includes('insufficient_quota') ||
      message.includes('quota exceeded') ||
      message.includes('exceeded your current quota') ||
      (message.includes('billing') && message.includes('quota'))) {
    return 'quota';
  }

  // A key that will never work until someone fixes the configuration. Kept
  // narrow on purpose: "forbidden" alone can also mean a content policy
  // refusal, which has nothing to do with the key.
  if (message.includes('invalid api key') ||
      message.includes('api key not valid') ||
      message.includes('api key expired') ||
      message.includes('invalid_api_key') ||
      message.includes('api_key_invalid')) {
    return 'invalid';
  }

  // Short-term limits. Gemini reports a spent free-tier day the same way, so
  // this is deliberately the cheap classification: a minute of cooldown, not
  // an hour.
  if (message.includes('rate limit') ||
      message.includes('rate_limit') ||
      message.includes('too many requests') ||
      message.includes('resource has been exhausted') ||
      message.includes('resource_exhausted') ||
      message.includes('429')) {
    return 'rate';
  }

  return null;
}

/**
 * Classify a key-level failure from a structured OpenAI SDK error, falling back
 * to the message heuristic for anything unstructured.
 *
 * 402 and a 429 that names the quota mean a spent budget; a plain 429 is a
 * short-term limit. 401 is a rejected key. 403 is deliberately absent: on
 * compatible endpoints it is at least as often a model or region restriction,
 * which no amount of key rotation fixes. Any other status with a value is a
 * decided "not a key problem", so it stops here rather than falling through to
 * string matching, where a 500 body quoting the word "quota" would be
 * misclassified.
 */
export function classifyOpenAIKeyExhaustion(error: unknown): KeyExhaustionKind | null {
  if (error instanceof OpenAI.APIError) {
    const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
    const message = error.message.toLowerCase();
    const namesQuota = code === 'insufficient_quota' ||
      message.includes('insufficient_quota') ||
      message.includes('quota') ||
      message.includes('credit');

    if (error.status === 402) {
      return 'quota';
    }
    if (error.status === 429) {
      return namesQuota ? 'quota' : 'rate';
    }
    if (error.status === 401) {
      return 'invalid';
    }
    if (error.status !== undefined) {
      return null;
    }
  }

  return classifyKeyExhaustionFromMessage(error);
}
