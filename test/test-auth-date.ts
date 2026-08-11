import { createHmac } from 'crypto';

const TELEGRAM_BOT_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
const AUTH_DATE_TTL = 86400;

function generateInitData(authDate: string | number): string {
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
  params.append('auth_date', String(authDate));

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

const now = Math.floor(Date.now() / 1000);

console.log('=== Test Case 1: Non-numeric auth_date ===');
console.log(generateInitData('notanumber'));

console.log('\n=== Test Case 2: auth_date 10 minutes in future (600 seconds) ===');
console.log(generateInitData(now + 600));

console.log('\n=== Test Case 3: auth_date 60 seconds in future (within tolerance) ===');
console.log(generateInitData(now + 60));

console.log('\n=== Test Case 4: auth_date older than TTL (expired) ===');
console.log(generateInitData(now - AUTH_DATE_TTL - 100));

console.log('\n=== Test Case 5: Valid auth_date (current time) ===');
console.log(generateInitData(now));