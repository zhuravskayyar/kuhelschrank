import { requestSharedStore } from '../lib/shared-store.js';

function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

function berlinDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function dayDifference(date, today) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(date || ''))) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function reminderText(state, today) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const expired = items.filter(item => Number(item.qty) > 0 && item.expiry && dayDifference(item.expiry, today) < 0);
  const expiring = items.filter(item => Number(item.qty) > 0 && item.expiry && dayDifference(item.expiry, today) >= 0 && dayDifference(item.expiry, today) <= 3);
  const low = items.filter(item => Number(item.qty) <= Number(item.min) && Number(item.target) > Number(item.qty));
  if (!expired.length && !expiring.length && !low.length) return '';

  const lines = ['🥬 Поличка — нагадування'];
  const list = (label, values, format) => {
    if (!values.length) return;
    lines.push('', `${label} (${values.length}):`);
    values.slice(0, 5).forEach(item => lines.push(`• ${String(item.name || 'Продукт').replace(/[\r\n]+/g, ' ').slice(0, 65)}${format(item)}`));
    if (values.length > 5) lines.push(`• Ще ${values.length - 5} позицій`);
  };
  list('Термін минув — перевір упаковку', expired, () => '');
  list('Термін спливає до 3 днів', expiring, item => {
    const days = dayDifference(item.expiry, today);
    return days === 0 ? ' · сьогодні' : days === 1 ? ' · завтра' : ` · за ${days} дні`;
  });
  list('Час поповнити запаси', low, item => ` · є ${Number(item.qty) || 0} ${String(item.unit || '')}`.trimEnd());
  lines.push('', 'Щоб вимкнути нагадування, напиши боту /stop.');
  return lines.join('\n').slice(0, 3800);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return respond(res, 405, { error: 'Потрібен GET-запит' });

  const secret = process.env.CRON_SECRET;
  if (!secret) return respond(res, 503, { error: 'CRON_SECRET не налаштований' });
  if (req.headers.authorization !== `Bearer ${secret}`) return respond(res, 401, { error: 'Unauthorized' });
  if (!process.env.TELEGRAM_BOT_TOKEN) return respond(res, 503, { error: 'Telegram-бот не налаштований' });

  try {
    const today = berlinDate();
    const { state, members = [] } = await requestSharedStore('notifications.list');
    const text = reminderText(state, today);
    if (!text) return respond(res, 200, { ok: true, sent: 0, reason: 'Немає термінових продуктів або низьких запасів' });

    const sentIds = [];
    const failures = [];
    for (const member of members) {
      if (!member.enabled || !member.chat_id || member.last_notified_on === today) continue;
      try {
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: member.chat_id, text })
        });
        const result = await response.json();
        if (!response.ok || !result?.ok) throw Error(`Telegram ${response.status}`);
        sentIds.push(String(member.telegram_id));
      } catch (error) {
        failures.push(String(member.telegram_id));
        console.error('Reminder delivery failed:', String(error?.message || error).slice(0, 120));
      }
    }

    if (sentIds.length) await requestSharedStore('notifications.mark', { telegramIds: sentIds, date: today });
    return respond(res, failures.length ? 207 : 200, { ok: failures.length === 0, sent: sentIds.length, failed: failures.length, date: today });
  } catch (error) {
    console.error('Reminder job failed:', String(error?.message || error).slice(0, 160));
    return respond(res, 503, { error: 'Не вдалося підготувати Telegram-нагадування' });
  }
}
