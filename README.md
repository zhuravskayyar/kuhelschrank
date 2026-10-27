# Поличка — спільний холодильник у Telegram

Статичний застосунок для запасів і покупок. У браузері без Telegram дані лишаються локальними. У Telegram Mini App вони синхронізуються між дозволеними акаунтами `@DeltaYrk` та `@yuliayans` через Supabase.

## Що працює

- Запаси, покупки, категорії, пороги поповнення, терміни, історія, чеки, бюджет, QR, JSON-резервна копія.
- NVIDIA NIM як кулінарний помічник. NVIDIA ключ зберігається лише у Vercel; API перевіряє підпис Telegram `initData` та allowlist користувачів.
- Спільна синхронізація з перевіркою ревізій, злиттям змін і tombstones для видалень. Офлайн-зміни зберігаються локально й відправляються при наступному вході в мережу.
- Щоденні Telegram-нагадування про продукти, термін яких минув або спливає за 3 дні, і про запаси нижче порога. `/stop` вимикає сповіщення, `/notify` вмикає знову.
- OCR чеків і дат працює локально в браузері. Назви та дати треба перевірити вручну.

## Налаштування Vercel

У Vercel задаються змінні з `.env.example`. Значення `TELEGRAM_BOT_TOKEN`, `NVIDIA_API_KEY`, `SYNC_SERVICE_SECRET` і `CRON_SECRET` — тільки типу Sensitive/Encrypted; не додавай їх у Git. `ALLOWED_TELEGRAM_USERNAMES` — `DeltaYrk,yuliayans`. Модель NVIDIA задається у `NVIDIA_MODEL` і має бути доступною для конкретного API-ключа.

`vercel.json` запускає `/api/notifications` щодня о 07:00 UTC. Це 08:00 взимку та 09:00 влітку за часом Берліна. Vercel Cron працює в UTC на всіх тарифах ([документація](https://vercel.com/docs/cron-jobs)).

## Supabase

- `supabase/schema.sql` створює окремі таблиці `polychka_sync_*`. Усі мають RLS; доступ до рядків виданий лише `service_role`. Ключ для доступу до таблиць бере Supabase Edge Function із власного середовища.
- Під час налаштування серверний `SYNC_SERVICE_SECRET` зберігається у Vercel, а в `polychka_sync_config` записується лише SHA-256 хеш.
- Edge Function `supabase/functions/fridge-sync/index.ts` має бути розгорнута з `verify_jwt=false`: вона перевіряє власний серверний секрет, а виклики до неї з браузера не йдуть напряму.
- На нових проєктах Supabase таблиці можуть не з’являтися в Data API автоматично. Схема явно видає доступ `service_role` і не відкриває таблиці користувачам `anon` чи `authenticated`.

## Telegram

Бот `@kuhelshrankkbot` уже має webhook на `/api/telegram`. Кожен користувач має один раз відкрити бота й натиснути **Start**. Це додає його Telegram ID до списку отримувачів і вмикає нагадування. Кнопка в bot chat відкриває Mini App. Якщо `@DeltaYrk` або `@yuliayans` ще не натискав Start, бот не зможе надіслати йому приватні повідомлення.

AI та синхронізація працюють лише при відкритті Mini App через Telegram. Для локальної розробки: `npm run dev`. Звичайний `python -m http.server` показує локальний режим, але не запускає API-функції.
