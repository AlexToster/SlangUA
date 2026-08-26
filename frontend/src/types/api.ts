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
  ageConfirmedAdult: boolean;
  /**
   * Derived server-side from the deployment allowlist, not stored on the user.
   * It only decides whether the admin entry point is rendered - the panel itself
   * answers 404 to anyone the server does not recognise as an admin.
   */
  isAdmin: boolean;
  /**
   * Also deployment-derived: `true` only when the server holds an STT key. A
   * deployment without one has no voice input at all, so the microphone is not
   * rendered rather than rendered and failing with `503 STT_UNAVAILABLE`.
   */
  voiceInputAvailable: boolean;
  createdAt: string;
}

export interface TranscriptionResult {
  text: string;
  /** Echoed back by the server so a support report says which model produced this. */
  model: string;
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

/** Answer of `POST /admin/session`. The token is held in memory only. */
export interface AdminSession {
  token: string;
  /** Idle deadline; slides forward with every admin request. */
  expiresAt: string;
  /** Hard deadline; never moves, so the panel always closes eventually. */
  absoluteExpiresAt: string;
}

export interface AdminProviderStatus {
  id: string;
  /** False while the circuit breaker holds the provider open. */
  available: boolean;
  /** False when the deployment has no API key for it. */
  configured: boolean;
  /** Position in the fallback chain; lower is tried first. */
  priority: number;
  /** True while an operator has switched the provider off; outranks the breaker. */
  disabled: boolean;
  /** ISO moment the switch was flipped, when the record carries one. */
  disabledAt: string | null;
  /** Telegram id of the operator who flipped it, when known. */
  disabledBy: string | null;
  disabledReason: string | null;
}

export interface AdminOverview {
  admin: {
    telegramId: string;
    sessionExpiresAt: string;
    sessionAbsoluteExpiresAt: string;
  };
  providers: AdminProviderStatus[];
  generatedAt: string;
}

/** Answer to a kill-switch change: the whole chain, not just the row that moved. */
export interface AdminProviderList {
  providers: AdminProviderStatus[];
  generatedAt: string;
}

/** One minute of traffic. Idle minutes are present as zeros, not omitted. */
export interface AdminMetricsMinute {
  /** ISO start of the minute. */
  startedAt: string;
  requests: number;
  /** Responses with status >= 500. */
  errors: number;
}

/** One UTC day. The panel labels the date as UTC rather than reformatting it. */
export interface AdminMetricsDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  requests: number;
  errors: number;
  /** Distinct authenticated users seen that day. */
  users: number;
  averagePerUser: number;
}

/** One hour of the rolling window. Zero-filled exactly like the minutes. */
export interface AdminMetricsHour {
  /** ISO start of the hour. */
  startedAt: string;
  requests: number;
  errors: number;
}

/**
 * The rolling 24 hours: independent of the UTC day boundary, which is useless at
 * 01:00 UTC when "today" is one hour old. `users` is an exact distinct count over
 * the whole window, not a sum of the hours.
 */
export interface AdminMetricsWindow {
  hours: number;
  requests: number;
  errors: number;
  users: number;
  /** Oldest hour first; the last bucket is the hour in progress. */
  series: AdminMetricsHour[];
}

/** Internal user id only - the server never sends a Telegram id here. */
export interface AdminMetricsTopUser {
  userId: string;
  requests: number;
}

/** Answer of `GET /admin/metrics`. `daily` is newest first, so today is `daily[0]`. */
export interface AdminMetrics {
  generatedAt: string;
  retentionDays: number;
  /** Accounts that have ever existed. From the database, so it never shrinks. */
  totalUsers: number;
  perMinute: {
    minutes: number;
    series: AdminMetricsMinute[];
  };
  last24h: AdminMetricsWindow;
  daily: AdminMetricsDay[];
  topUsers: AdminMetricsTopUser[];
}

/** One entry of the error feed. Never carries request or translation text. */
export interface AdminErrorEntry {
  at: string;
  method: string;
  /** Route pattern, not the concrete path. */
  route: string;
  statusCode: number;
  code: string | null;
  message: string | null;
  userId: number | null;
  /** Fastify request id - the handle for finding the full entry in the logs. */
  requestId: string | null;
}

/** Answer of `GET /admin/errors`. `max` and retention come from the server. */
export interface AdminErrorFeed {
  generatedAt: string;
  max: number;
  retentionSeconds: number;
  entries: AdminErrorEntry[];
}

