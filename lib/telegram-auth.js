import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 86400;

export function inspectTelegramInitData(initData, token) {
  if (typeof initData !== 'string' || initData.length < 1 || initData.length > 10000 || !token) return { user: null, reason: 'missing' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { user: null, reason: 'invalid_signature' };
  if (!Number.isFinite(authDate)) return { user: null, reason: 'invalid_date' };

  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60) return { user: null, reason: 'future_date' };
  if (now - authDate > MAX_AGE_SECONDS) return { user: null, reason: 'expired' };

  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', token).update('WebAppData').digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const supplied = Buffer.from(hash, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { user: null, reason: 'invalid_signature' };

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return Number.isSafeInteger(user?.id) ? { user, reason: null } : { user: null, reason: 'invalid_user' };
  } catch {
    return { user: null, reason: 'invalid_user' };
  }
}

export function verifyTelegramInitData(initData, token) {
  return inspectTelegramInitData(initData, token).user;
}

export function telegramInitDataError(reason) {
  if (reason === 'expired') return 'Сесія Telegram застаріла. Повністю закрий Поличку й відкрий її знову кнопкою в чаті бота.';
  return 'Не вдалося підтвердити Telegram-вхід. Відкрий Поличку кнопкою в приватному чаті бота.';
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
