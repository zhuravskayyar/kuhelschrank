import { inspectTelegramInitData, isAllowedTelegramUser, telegramInitDataError } from '../lib/telegram-auth.js';
import { requestSharedStore } from '../lib/shared-store.js';

function respond(res, code, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(data);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { error: 'POST required' });
  let body;
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    if (JSON.stringify(body).length > 18000) return respond(res, 413, { error: 'Too large' });
  } catch {
    return respond(res, 400, { error: 'Invalid JSON' });
  }

  const auth = inspectTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!auth.user) return respond(res, 401, { error: telegramInitDataError(auth.reason) });
  if (!isAllowedTelegramUser(auth.user)) return respond(res, 403, { error: 'Немає доступу до Полички' });

  const query = String(body.query || '').trim().replace(/\s+/g, ' ').slice(0, 65);
  const category = String(body.category || 'all').slice(0, 30);
  const categories = ['all', 'Супи', 'Основні', 'Салати', 'Сніданки', 'Випічка', 'Десерти', 'Гарніри', 'Соуси', 'Закуски', 'Напої'];
  const resultCount = body.resultCount === null ? null : Number(body.resultCount);
  const suggested = body.suggested === true;
  const ingredients = String(body.ingredients || '').trim().slice(0, 600);
  if (query.length < 2 || !/^[\p{L}\p{N}\s'’,-]+$/u.test(query) || !categories.includes(category) ||
     (resultCount !== null && (!Number.isInteger(resultCount) || resultCount < 0 || resultCount > 100))) {
    return respond(res, 400, { error: 'Некоректний запит рецепта' });
  }
  const member = {
    telegramId: String(auth.user.id),
    chatId: String(auth.user.id),
    username: String(auth.user.username || '').slice(0, 64).toLowerCase(),
    firstName: String(auth.user.first_name || '').slice(0, 80)
  };
  try {
    await requestSharedStore('recipes.track', { member, query, category, resultCount, suggested, ingredients });
    return respond(res, 200, { ok: true });
  } catch (error) {
    console.error('Recipe request logging failed:', String(error?.message || error).slice(0, 130));
    return respond(res, 503, { error: 'Не вдалося записати пошук' });
  }
}
