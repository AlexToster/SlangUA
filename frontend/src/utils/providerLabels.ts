import type { ProviderId } from '../types/api';

/**
 * Display names for the AI instances shipped with the backend. The map is
 * deliberately not exhaustive: a deployment can add instances through
 * AI_EXTRA_INSTANCES, and the id of such an instance is unknown to this build.
 */
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

/**
 * Human-readable name of an AI instance.
 *
 * Ids are lowercase since the backend dropped the AIProvider enum, so an
 * unknown id is uppercased rather than rendered raw: "groq" reads as a label,
 * "groq" in the middle of a metadata row reads as a bug.
 */
export function getProviderLabel(providerId: ProviderId): string {
  const id = providerId.trim();
  if (!id) {
    return '';
  }
  return PROVIDER_LABELS[id.toLowerCase()] ?? id.toUpperCase();
}
