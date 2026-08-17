export type SlangStyle = 'GEN_Z' | 'STREET' | 'IT_SLANG' | 'POFENI' | 'KANCLER' | 'GALICIAN';
export type AIProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA' | 'OPENROUTER';

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
  aiProvider: AIProvider;
  previewId: string;
}

export interface Translation {
  id: number;
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  aiProvider: AIProvider;
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
  aiProvider: AIProvider;
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
  inlineQuery: string;
  /**
   * The finished message rendered by the server ("SlangUA · <style>\n\n<text>").
   * Optional so an older API build still type-checks; the client falls back to
   * the inline-query path when it is missing.
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
