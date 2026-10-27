import { isAllowedTelegramUsername } from '../lib/telegram-auth.js';
import { requestSharedStore } from '../lib/shared-store.js';

const APP_URL = 'https://kuhelschrank.vercel.app';
const API = 'https://api.telegram.org/bot';

function respond(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(obj);
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw Error('Telegram bot is not configured');
  const response = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw Error(`Telegram ${method}: ${data.description || response.status}`);
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { ok: false });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) return respond(res, 401, { ok: false });

  const message = req.body?.message;
  if (!message?.chat?.id || !message?.from?.id) return respond(res, 200, { ok: true });

  const rawText = String(message.text || '').trim();
  const [rawCommand = ''] = rawText.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  const username = String(message.from.username || '').replace(/^@/, '').slice(0, 64).toLowerCase();
  const allowed = message.chat.type === 'private' && isAllowedTelegramUsername(username);
  let registrationFailed = false;

  if (allowed) {
    try {
      await requestSharedStore('member.register', {
        member: {
          telegramId: String(message.from.id),
          username,
          firstName: String(message.from.first_name || '').slice(0, 80),
          chatId: String(message.chat.id),
          ...(command === '/start' ? { enabled: true } : {})
        }
      });
      if (command === '/stop') {
        await requestSharedStore('member.set-notifications', { telegramId: String(message.from.id), enabled: false });
      } else if (command === '/notify') {
        await requestSharedStore('member.set-notifications', { telegramId: String(message.from.id), enabled: true });
      }
    } catch (error) {
      registrationFailed = true;
      console.error('Telegram member registration failed:', String(error?.message || error).slice(0, 120));
    }
  }

  const welcome = allowed
    ? 'Привіт! Це Поличка — спільний холодильник для тебе та родини. Запаси й покупки синхронізуються, а щоранку бот нагадає про терміни та продукти, які час докупити. Відкрий застосунок кнопкою нижче.\n\n/stop — вимкнути нагадування · /notify — увімкнути знову.'
    : 'Привіт! Це Поличка — запаси, покупки та терміни придатності в одному місці. Натисни кнопку нижче, щоб відкрити застосунок.';
  let answer = null;
  if (command === '/start') answer = allowed && registrationFailed
    ? 'Бот зараз не зміг зареєструвати сповіщення. Спробуй /start трохи пізніше.'
    : welcome;
  else if (command === '/id') answer = `Твій Telegram ID: ${message.from.id}`;
  else if (command === '/help') answer = 'Команди: /start — відкрити Поличку, /id — показати Telegram ID, /notify — увімкнути нагадування, /stop — вимкнути нагадування.';
  else if (command === '/app') answer = 'Відкрий застосунок кнопкою нижче.';
  else if (command === '/notify') answer = allowed && !registrationFailed ? 'Щоденні нагадування увімкнено.' : 'Нагадування доступні лише для підключених акаунтів Полички.';
  else if (command === '/stop') answer = allowed && !registrationFailed ? 'Щоденні нагадування вимкнено. Напиши /notify, щоб увімкнути знову.' : 'Не вдалося змінити налаштування нагадувань.';

  if (answer) {
    try {
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: answer,
        reply_markup: { inline_keyboard: [[{ text: 'Відкрити Поличку', web_app: { url: APP_URL } }]] }
      });
    } catch (error) {
      console.error('Bot reply failed:', String(error?.message || error).slice(0, 120));
    }
  }
  return respond(res, 200, { ok: true });
}
