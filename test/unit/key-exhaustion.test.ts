/**
 * Key-exhaustion classifier unit tests.
 *
 * This heuristic decides whether a failed upstream call parks the current key
 * and rotates, or propagates untouched. It was previously two `protected`
 * methods reachable only through a live adapter, and therefore untested; it is
 * pinned here because it is now shared by the AI adapters and the STT service,
 * so a wrong widening would misbehave in two places at once.
 *
 * The two failure directions matter differently: a false negative only costs a
 * failed request, while a false positive silently parks a healthy key for up to
 * an hour and hides the real error.
 */

import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import {
  classifyKeyExhaustionFromMessage,
  classifyOpenAIKeyExhaustion,
} from '../../src/services/ai/key-exhaustion';

/** `new APIError(status, error, message, headers)` - `error` is the inner body object. */
function apiError(status: number | undefined, message: string, code?: string) {
  return new OpenAI.APIError(status, { message, ...(code ? { code } : {}) }, message, undefined);
}

describe('classifyKeyExhaustionFromMessage', () => {
  it('reads a spent budget as quota', () => {
    for (const message of [
      'insufficient_quota: you exceeded your current quota',
      'Quota exceeded for this project',
      'You exceeded your current quota, please check your plan',
      'Billing hard limit reached: quota unavailable',
    ]) {
      expect(classifyKeyExhaustionFromMessage(new Error(message)), message).toBe('quota');
    }
  });

  it('reads a rejected key as invalid', () => {
    for (const message of [
      'Invalid API key provided',
      'API key not valid. Please pass a valid API key.',
      'Your API key expired',
      'invalid_api_key',
      'API_KEY_INVALID',
    ]) {
      expect(classifyKeyExhaustionFromMessage(new Error(message)), message).toBe('invalid');
    }
  });

  it('reads a short-term limit as rate', () => {
    for (const message of [
      'Rate limit reached for requests',
      'rate_limit_exceeded',
      'Too Many Requests',
      'Resource has been exhausted (e.g. check quota).',
      'RESOURCE_EXHAUSTED',
      'Request failed with status code 429',
    ]) {
      expect(classifyKeyExhaustionFromMessage(new Error(message)), message).toBe('rate');
    }
  });

  it('parks Gemini\'s exhausted free-tier day for a minute, not an hour', () => {
    // Gemini words a spent daily allowance as RESOURCE_EXHAUSTED, which also
    // means a per-minute limit. The cheap classification is deliberate: a wrong
    // 'quota' here would park a working key for an hour.
    const error = new Error('429 Resource has been exhausted (e.g. check quota).');
    expect(classifyKeyExhaustionFromMessage(error)).toBe('rate');
  });

  it('leaves anything else alone', () => {
    for (const message of [
      'socket hang up',
      'translation timed out after 30000ms',
      'Internal server error',
      // A content refusal mentions neither the key nor a limit, and "forbidden"
      // on its own is deliberately not matched.
      'Request forbidden by safety settings',
      'The model produced no output',
    ]) {
      expect(classifyKeyExhaustionFromMessage(new Error(message)), message).toBeNull();
    }
  });

  it('ignores non-Error values', () => {
    for (const value of ['rate limit', { message: 'quota exceeded' }, null, undefined, 429]) {
      expect(classifyKeyExhaustionFromMessage(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('classifyOpenAIKeyExhaustion', () => {
  it('treats 402 as a spent budget', () => {
    expect(classifyOpenAIKeyExhaustion(apiError(402, 'Payment required'))).toBe('quota');
  });

  it('splits 429 by whether it names the budget', () => {
    expect(classifyOpenAIKeyExhaustion(apiError(429, 'Rate limit reached for whisper-large-v3-turbo'))).toBe('rate');
    expect(classifyOpenAIKeyExhaustion(apiError(429, 'You exceeded your current quota'))).toBe('quota');
    expect(classifyOpenAIKeyExhaustion(apiError(429, 'Insufficient credit balance'))).toBe('quota');
    expect(classifyOpenAIKeyExhaustion(apiError(429, 'Too many requests', 'insufficient_quota'))).toBe('quota');
  });

  it('treats 401 as a rejected key', () => {
    expect(classifyOpenAIKeyExhaustion(apiError(401, 'Incorrect API key provided'))).toBe('invalid');
  });

  it('does not rotate on 403', () => {
    // On compatible endpoints a 403 is at least as often a model or region
    // restriction, which every key in the pool shares.
    expect(classifyOpenAIKeyExhaustion(apiError(403, 'Model not available in your region'))).toBeNull();
  });

  it('stops at a decided status instead of falling through to string matching', () => {
    // The whole point of checking the status first: a 500 whose body quotes the
    // word "quota" is a server fault, not an exhausted key.
    expect(classifyOpenAIKeyExhaustion(apiError(500, 'Internal error while checking quota'))).toBeNull();
    expect(classifyOpenAIKeyExhaustion(apiError(400, 'invalid_api_key shaped body on a bad request'))).toBeNull();
  });

  it('falls back to the message when the SDK error carries no status', () => {
    // A connection-level APIError has status undefined.
    expect(classifyOpenAIKeyExhaustion(apiError(undefined, 'Rate limit reached'))).toBe('rate');
    expect(classifyOpenAIKeyExhaustion(new Error('insufficient_quota'))).toBe('quota');
    expect(classifyOpenAIKeyExhaustion(new Error('socket hang up'))).toBeNull();
  });
});
