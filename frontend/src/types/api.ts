export type SlangStyle = 'GEN_Z' | 'STREET' | 'IT_SLANG' | 'POFENI' | 'KANCLER' | 'GALICIAN';

/**
 * Id of the AI instance that produced a translation, e.g. "openai", "gemini",
 * "openrouter". A free-form lowercase string, not a union: which instances exist
 * is a server deployment concern, so a closed union here would break the client
 * the moment the backend gains a provider. Render it through providerLabel().
 */
export type ProviderId = string;

export interface Style {
  id: SlangStyle;
  title: string;
  ageRestricted: boolean;
}

export interface UserProfile {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  defaultSlangStyle: SlangStyle | null;
  notificationsEnabled: boolean;
  ageConfirmedAdult: boolean;
  createdAt: string;
}

export interface PreviewResult {
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  providerId: ProviderId;
  previewId: string;
}

export interface Translation {
  id: number;
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  providerId: ProviderId;
  favorite: boolean;
  createdAt: string;
}

export interface HistoryResponse {
  data: Translation[];
  nextCursor: string | null;
  totalCount: number;
  /**
   * Server-owned cap on stored translations (see HISTORY_MAX_ENTRIES on the
   * backend). Optional so an older API build still type-checks; the UI falls
   * back to HISTORY_LIMIT_FALLBACK when it is absent.
   */
  totalLimit?: number;
}

export interface SaveFromPreviewResult {
  id: number;
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  providerId: ProviderId;
  favorite: boolean;
  createdAt: string;
}

export type ShareSource =
  | { previewId: string }
  | { translationId: number };

// Explicit body for PATCH /history/:id/favorite — the server SETS this value,
// so retries and double clicks stay idempotent.
export interface FavoriteUpdate {
  favorite: boolean;
}

export interface InlineShareResult {
  /** Opaque token for the inline fallback (`switchInlineQuery`). Never displayed. */
  inlineQuery: string;
  /**
   * The finished message rendered by the server — the translation and nothing
   * else, with no `SlangUA · <style>` header. This is the primary share path:
   * the client hands it to Telegram's own chat chooser. Optional so an older API
   * build still type-checks; the client falls back to `inlineQuery` without it.
   */
  shareText?: string;
  expiresAt: string;
}

export interface ApiError {
  error: string;
  code: string;
  message: string;
}

export interface AuthTokens {
  accessToken: string;
}
