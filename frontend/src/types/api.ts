export type SlangStyle = 'GEN_Z' | 'STREET' | 'IT_SLANG' | 'POFENI' | 'KANCLER';
export type AIProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA';

export interface Style {
  id: SlangStyle;
  title: string;
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

export interface InlineShareResult {
  inlineQuery: string;
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
