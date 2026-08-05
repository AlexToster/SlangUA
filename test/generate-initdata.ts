import { createHmac } from 'crypto';

// Test configuration matching .env
const TELEGRAM_BOT_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
const AUTH_DATE_TTL = 86400;

// Generate a valid initData string
function generateValidInitData(): string {
  const now = Math.floor(Date.now() / 1000);
  
  const user = {
    id: 123456789,
    first_name: 'Test',
    last_name: 'User',
    username: 'testuser',
    language_code: 'en',
    is_premium: false,
  };
  
  const params = new URLSearchParams();
  params.append('user', JSON.stringify(user));
  params.append('auth_date', String(now));
  // We'll add hash after computing it
  
  // Create data_check_string (sorted key=value pairs)
  const dataCheckStringParts: string[] = [];
  for (const [key, value] of params.entries()) {
    dataCheckStringParts.push(`${key}=${value}`);
  }
  dataCheckStringParts.sort();
  const dataCheckString = dataCheckStringParts.join('\n');
  
  // Compute secret key: HMAC-SHA256(bot_token, "WebAppData")
  const secretKey = createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
  
  // Compute hash: HMAC-SHA256(secret_key, data_check_string)
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  // Add hash to params
  params.append('hash', hash);
  
  return params.toString();
}

// Generate expired initData (auth_date older than TTL)
function generateExpiredInitData(): string {
  const expiredDate = Math.floor(Date.now() / 1000) - AUTH_DATE_TTL - 100; // 100 seconds past TTL
  
  const user = {
    id: 123456789,
    first_name: 'Test',
    last_name: 'User',
    username: 'testuser',
    language_code: 'en',
    is_premium: false,
  };
  
  const params = new URLSearchParams();
  params.append('user', JSON.stringify(user));
  params.append('auth_date', String(expiredDate));
  
  const dataCheckStringParts: string[] = [];
  for (const [key, value] of params.entries()) {
    dataCheckStringParts.push(`${key}=${value}`);
  }
  dataCheckStringParts.sort();
  const dataCheckString = dataCheckStringParts.join('\n');
  
  const secretKey = createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  params.append('hash', hash);
  
  return params.toString();
}

// Generate invalid HMAC initData
function generateInvalidHmacInitData(): string {
  const now = Math.floor(Date.now() / 1000);
  
  const user = {
    id: 123456789,
    first_name: 'Test',
    last_name: 'User',
    username: 'testuser',
    language_code: 'en',
    is_premium: false,
  };
  
  const params = new URLSearchParams();
  params.append('user', JSON.stringify(user));
  params.append('auth_date', String(now));
  params.append('hash', 'invalidsignature');
  
  return params.toString();
}

console.log('=== Valid initData ===');
console.log(generateValidInitData());
console.log('\n=== Expired initData ===');
console.log(generateExpiredInitData());
console.log('\n=== Invalid HMAC initData ===');
console.log(generateInvalidHmacInitData());