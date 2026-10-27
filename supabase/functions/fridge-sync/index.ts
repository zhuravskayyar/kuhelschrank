const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';

function serviceKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return { key: legacy, legacy: true };
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const key = keys?.default || Object.values(keys)[0];
    if (typeof key === 'string' && key) return { key, legacy: false };
  } catch { /* Fall through to a generic setup error. */ }
  throw new Error('Supabase service key is unavailable');
}

async function dbRequest(path: string, method = 'GET', body?: unknown, prefer = '') {
  const { key, legacy } = serviceKey();
  const headers: Record<string, string> = { apikey: key };
  if (legacy) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  return data;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorize(request: Request) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (supplied.length < 32 || supplied.length > 300) return false;
  const rows = await dbRequest('polychka_sync_config?select=sync_secret_hash&id=eq.main') as Array<{ sync_secret_hash: string }>;
  const expected = rows?.[0]?.sync_secret_hash;
  return Boolean(expected && constantTimeEqual(await sha256(supplied), expected));
}

function validMember(member: any) {
  return member && /^[0-9]{1,20}$/.test(String(member.telegramId || '')) &&
    /^-?[0-9]{1,20}$/.test(String(member.chatId || '')) &&
    typeof member.username === 'string';
}

async function upsertMember(member: any) {
  if (!validMember(member)) throw new Error('Invalid Telegram member');
  const row: Record<string, unknown> = {
    telegram_id: String(member.telegramId),
    username: String(member.username).replace(/^@/, '').slice(0, 64).toLowerCase(),
    first_name: String(member.firstName || '').slice(0, 80),
    chat_id: String(member.chatId),
    updated_at: new Date().toISOString()
  };
  if (typeof member.enabled === 'boolean') row.enabled = member.enabled;
  const rows = await dbRequest('polychka_sync_members?on_conflict=telegram_id', 'POST', [row], 'resolution=merge-duplicates,return=representation') as any[];
  return rows?.[0] || null;
}

async function readState() {
  const rows = await dbRequest('polychka_sync_state?select=revision,state,updated_at&household_id=eq.main') as any[];
  if (!rows?.[0]) throw new Error('Shared fridge state is missing');
  return rows[0];
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!SUPABASE_URL) return json(503, { error: 'Supabase URL is unavailable' });

  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return json(413, { error: 'Request too large' });
    body = JSON.parse(raw || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  try {
    if (!await authorize(request)) return json(401, { error: 'Unauthorized' });

    if (body.action === 'sync.pull') {
      const member = await upsertMember(body.member);
      const snapshot = await readState();
      return json(200, { revision: Number(snapshot.revision), state: snapshot.state, member });
    }

    if (body.action === 'sync.save') {
      if (!validMember(body.member) || !Number.isSafeInteger(body.revision) || body.revision < 0 || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
        return json(400, { error: 'Invalid sync payload' });
      }
      if (JSON.stringify(body.state).length > 1_800_000) return json(413, { error: 'State too large' });
      const member = await upsertMember(body.member);
      const expected = Number(body.revision);
      const rows = await dbRequest(
        `polychka_sync_state?household_id=eq.main&revision=eq.${expected}`,
        'PATCH',
        { revision: expected + 1, state: body.state, updated_at: new Date().toISOString() },
        'return=representation'
      ) as any[];
      if (!rows?.length) {
        const current = await readState();
        return json(409, { conflict: true, revision: Number(current.revision), state: current.state });
      }
      return json(200, { revision: Number(rows[0].revision), state: rows[0].state, member });
    }

    if (body.action === 'member.register') {
      const member = await upsertMember(body.member);
      return member ? json(200, { member }) : json(500, { error: 'Member registration failed' });
    }

    if (body.action === 'member.set-notifications') {
      if (!/^[0-9]{1,20}$/.test(String(body.telegramId || '')) || typeof body.enabled !== 'boolean') {
        return json(400, { error: 'Invalid notification preference' });
      }
      const rows = await dbRequest(
        `polychka_sync_members?telegram_id=eq.${encodeURIComponent(String(body.telegramId))}`,
        'PATCH',
        { enabled: body.enabled, updated_at: new Date().toISOString() },
        'return=representation'
      ) as any[];
      return rows?.[0] ? json(200, { enabled: rows[0].enabled }) : json(404, { error: 'Member not found' });
    }

    if (body.action === 'notifications.list') {
      const [snapshot, members] = await Promise.all([
        readState(),
        dbRequest('polychka_sync_members?select=telegram_id,username,chat_id,enabled,last_notified_on&enabled=eq.true')
      ]);
      return json(200, { state: snapshot.state, members });
    }

    if (body.action === 'notifications.mark') {
      const ids = Array.isArray(body.telegramIds) ? body.telegramIds.filter((id: unknown) => /^[0-9]{1,20}$/.test(String(id))).slice(0, 20) : [];
      if (!ids.length || !/^\d{4}-\d\d-\d\d$/.test(String(body.date || ''))) return json(400, { error: 'Invalid notification receipt' });
      await dbRequest(
        `polychka_sync_members?telegram_id=in.(${ids.map((id: string) => encodeURIComponent(id)).join(',')})`,
        'PATCH',
        { last_notified_on: body.date, updated_at: new Date().toISOString() },
        'return=minimal'
      );
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('Fridge sync operation failed:', String(error?.message || error).slice(0, 160));
    return json(503, { error: 'Shared fridge service is unavailable' });
  }
});
