import { isAllowedTelegramUser, verifyTelegramInitData } from '../lib/telegram-auth.js';
import { requestSharedStore } from '../lib/shared-store.js';

function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

function userForStore(user) {
  return {
    telegramId: String(user.id),
    username: String(user.username || '').slice(0, 64).toLowerCase(),
    firstName: String(user.first_name || '').slice(0, 80),
    chatId: String(user.id)
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return respond(res, 405, { error: 'Потрібен POST-запит' });

  let body;
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    if (JSON.stringify(body).length > 2_000_000) return respond(res, 413, { error: 'Завеликий запит' });
  } catch {
    return respond(res, 400, { error: 'Некоректний JSON' });
  }

  const user = verifyTelegramInitData(body?.initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user) return respond(res, 401, { error: 'Відкрий застосунок через Telegram' });
  if (!isAllowedTelegramUser(user)) return respond(res, 403, { error: 'Цей Telegram-акаунт не має доступу до спільної Полички' });

  const member = userForStore(user);
  try {
    if (body.action === 'pull') {
      return respond(res, 200, await requestSharedStore('sync.pull', { member }));
    }

    if (body.action === 'save') {
      if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
        return respond(res, 400, { error: 'Некоректні дані синхронізації' });
      }
      return respond(res, 200, await requestSharedStore('sync.save', { member, revision: body.revision, state: body.state }));
    }

    if (body.action === 'notifications') {
      if (typeof body.enabled !== 'boolean') return respond(res, 400, { error: 'Вкажи стан сповіщень' });
      return respond(res, 200, await requestSharedStore('member.set-notifications', { telegramId: member.telegramId, enabled: body.enabled }));
    }

    return respond(res, 400, { error: 'Невідома дія' });
  } catch (error) {
    console.error('Shared fridge request failed:', String(error?.message || error).slice(0, 160));
    if (Number(error?.status) === 409 && error?.data?.conflict) return respond(res, 409, error.data);
    return respond(res, 503, { error: 'Не вдалося синхронізувати дані. Спробуй ще раз.' });
  }
}
