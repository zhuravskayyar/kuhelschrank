import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 86400;

export function verifyTelegramInitData(initData, token) {
  if (typeof initData !== 'string' || initData.length < 1 || initData.length > 10000 || !token) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isFinite(authDate)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > MAX_AGE_SECONDS) return null;

  params.delete('hash');
  params.delete('signature');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const supplied = Buffer.from(hash, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return Number.isSafeInteger(user?.id) ? user : null;
  } catch {
    return null;
  }
}

export function isAllowedTelegramUser(user, env = process.env) {
  if (!Number.isSafeInteger(user?.id)) return false;
  const ids = String(env.ALLOWED_TELEGRAM_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (ids.includes(String(user.id))) return true;

  const usernames = String(env.ALLOWED_TELEGRAM_USERNAMES || '')
    .split(',')
    .map(value => value.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  return Boolean(user.username && usernames.includes(String(user.username).toLowerCase()));
}

export function isAllowedTelegramUsername(username, env = process.env) {
  if (!username) return false;
  const allowed = String(env.ALLOWED_TELEGRAM_USERNAMES || '')
    .split(',')
    .map(value => value.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  return allowed.includes(String(username).replace(/^@/, '').toLowerCase());
}
