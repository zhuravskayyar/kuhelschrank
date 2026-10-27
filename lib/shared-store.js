export async function requestSharedStore(action, payload = {}) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SYNC_SERVICE_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SYNC_SERVICE_SECRET) {
    throw new Error('Спільне сховище ще не налаштоване');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/fridge-sync`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SYNC_SERVICE_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, ...payload })
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data?.error || `Помилка спільного сховища (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
