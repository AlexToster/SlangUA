import { createHmac } from 'crypto';

const TEST_BOT_TOKEN = '123456789:TEST_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface InitDataOptions {
  user?: TelegramUser;
  authDate?: number;
  expired?: boolean;
  futureAuthDate?: boolean;
  invalidHmac?: boolean;
  malformed?: boolean;
}

/**
 * Generates a valid Telegram WebApp initData string for testing.
 * Uses the test bot token defined in the test environment.
 */
export function generateValidInitData(options: InitDataOptions = {}): string {
  const {
    user = { id: 123456789, first_name: 'Test', last_name: 'User', username: 'testuser' },
    authDate = Math.floor(Date.now() / 1000),
  } = options;

  const userJson = JSON.stringify(user);
  const params = new URLSearchParams();
  params.append('user', userJson);
  params.append('auth_date', authDate.toString());
  params.append('query_id', `query_${Date.now()}_${Math.random().toString(36).substring(7)}`);

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.append('hash', hash);

  return params.toString();
}

/**
 * Generates initData with a custom user object.
 */
export function generateInitDataWithCustomUser(user: TelegramUser, authDate?: number): string {
  return generateValidInitData({ user, authDate });
}

/**
 * Generates expired initData (auth_date older than 24 hours).
 */
export function generateExpiredInitData(user?: TelegramUser): string {
  const authDate = Math.floor(Date.now() / 1000) - 86400 - 1; // 24 hours + 1 second ago
  return generateValidInitData({ user, authDate });
}

/**
 * Generates initData with future auth_date (more than 1 hour in future).
 */
export function generateFutureAuthDateInitData(user?: TelegramUser): string {
  const authDate = Math.floor(Date.now() / 1000) + 3600 + 1; // 1 hour + 1 second in future
  return generateValidInitData({ user, authDate });
}

/**
 * Generates initData with invalid HMAC.
 */
export function generateInvalidHmacInitData(user?: TelegramUser): string {
  const initData = generateValidInitData({ user });
  // Corrupt the hash
  return initData.replace(/hash=[^&]+/, 'hash=invalidhash1234567890abcdef1234567890abcdef1234567890abcdef');
}

/**
 * Generates malformed initData (missing required fields).
 */
export function generateMalformedInitData(): string {
  return 'user=%7B%22id%22%3A123%7D'; // Missing auth_date and hash
}

/**
 * Generates initData with specific auth_date.
 */
export function generateInitDataWithAuthDate(authDate: number, user?: TelegramUser): string {
  return generateValidInitData({ user, authDate });
}

/**
 * Validates initData format (for testing the helper itself).
 */
export function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Gets the test bot token (for verification in tests).
 */
export function getTestBotToken(): string {
  return TEST_BOT_TOKEN;
}