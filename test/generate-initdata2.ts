import { createHmac } from 'crypto';

const TELEGRAM_BOT_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
const now = Math.floor(Date.now() / 1000);
const user = { id: 987654321, first_name: 'Test2', last_name: 'User2', username: 'testuser2', language_code: 'en', is_premium: false };
const params = new URLSearchParams();
params.append('user', JSON.stringify(user));
params.append('auth_date', String(now));
const dataCheckStringParts = [];
for (const [key, value] of params.entries()) { dataCheckStringParts.push(key + '=' + value); }
dataCheckStringParts.sort();
const dataCheckString = dataCheckStringParts.join('\n');
const secretKey = createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
params.append('hash', hash);
console.log('auth_date:', now);
console.log('hash:', hash);
console.log('initData:', params.toString());