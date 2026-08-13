export const MAX_AUTOMATIC_PREVIEW_ATTEMPTS = 3;

export interface PreviewAttemptState {
  key: string;
  retryNonce: number;
  count: number;
}

/** Returns the next allowed automatic attempt, or null once the cap is reached. */
export function consumePreviewAttempt(
  previous: PreviewAttemptState,
  key: string,
  retryNonce: number,
): PreviewAttemptState | null {
  const current = previous.key === key && previous.retryNonce === retryNonce
    ? previous
    : { key, retryNonce, count: 0 };

  if (current.count >= MAX_AUTOMATIC_PREVIEW_ATTEMPTS) return null;
  return { ...current, count: current.count + 1 };
}
