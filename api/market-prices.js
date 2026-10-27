// Community-observed shelf/receipt prices, never represented as live retailer feeds.
const BASE = 'https://prices.openfoodfacts.org/api/v1/prices';
const PAGE_SIZE = 100;
const MAX_PAGES = 4;
const RETAILERS = [
  ['aldi-sued', /\baldi\s*(s[uü]d|sued|south)\b/i, 'Aldi Süd'],
  ['aldi-nord', /\baldi\s*nord\b/i, 'Aldi Nord'],
  ['lidl', /\blidl\b/i, 'Lidl'],
  ['rewe', /\brewe\b/i, 'REWE'],
  ['penny', /\bpenny\b/i, 'Penny'],
  ['netto', /\bnetto\b/i, 'Netto'],
  ['kaufland', /\bkaufland\b/i, 'Kaufland'],
  ['edeka', /\bedeka\b/i, 'EDEKA'],
  ['aldi', /\baldi\b/i, 'Aldi']
];

function storeOf(location) {
  const details = [location?.osm_name, location?.osm_brand, location?.osm_display_name, location?.osm_tags?.join(' ')]
    .filter(Boolean)
    .join(' ');
  const found = RETAILERS.find(([, regex]) => regex.test(details));
  if (found) return { id: found[0], name: found[2] };

  const name = String(location?.osm_brand || location?.osm_name || 'Магазин').trim().slice(0, 80);
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
  return { id: `open-${slug || location?.id || 'store'}`, name };
}

function storeMatches(requested, actual) {
  if (!requested) return true;
  if (requested === 'aldi') return actual.startsWith('aldi');
  return requested === actual || (actual === 'aldi' && requested.startsWith('aldi'));
}

function countryOf(location) {
  const code = String(location?.osm_address_country_code || '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=43200');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

  const barcode = String(req.query?.barcode || '').replace(/\D/g, '');
  const requested = String(req.query?.store || '').toLowerCase().trim().slice(0, 32);
  if (!/^\d{8,14}$/.test(barcode)) return res.status(400).json({ error: 'Для надійного порівняння потрібен штрихкод EAN/GTIN' });
  if (requested && !RETAILERS.some(([id]) => id === requested)) return res.status(400).json({ error: 'Невідомий магазин' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Polychka/2.4 (https://github.com/zhuravskayyar/kuhelschrank)'
  };
  const fetchPage = async page => {
    const params = new URLSearchParams({ product_code: barcode, currency: 'EUR', size: String(PAGE_SIZE), order_by: '-date', page: String(page) });
    const upstream = await fetch(`${BASE}?${params}`, { signal: controller.signal, headers });
    if (!upstream.ok) throw new Error(`Open Prices ${upstream.status}`);
    return upstream.json();
  };

  try {
    const first = await fetchPage(1);
    const pageCount = Math.min(MAX_PAGES, Math.max(1, Number(first?.pages) || Math.ceil(Number(first?.total || 0) / PAGE_SIZE)));
    const rest = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) =>
      fetchPage(index + 2).catch(() => ({ items: [] }))
    ));
    const sourceRows = [ ...(Array.isArray(first?.items) ? first.items : []), ...rest.flatMap(page => Array.isArray(page?.items) ? page.items : []) ];
    const now = new Date().toISOString().slice(0, 10);
    const allRecords = sourceRows.filter(price => {
      const date = String(price?.date || '');
      const amount = Number(price?.price);
      return String(price?.product_code || '') === barcode && price.currency === 'EUR' &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= now &&
        Number.isFinite(amount) && amount > 0 && amount < 1000 && !price?.duplicate_of;
    }).map(price => {
      const shop = storeOf(price.location);
      return {
        price: Math.round(Number(price.price) * 100) / 100,
        date: price.date,
        discount: !!price.price_is_discounted,
        pricePer: price.price_per || 'UNIT',
        shopId: shop.id,
        shop: shop.name,
        city: String(price.location?.osm_address_city || '').slice(0, 80),
        countryCode: countryOf(price.location),
        sourceUrl: `https://prices.openfoodfacts.org/prices/${encodeURIComponent(price.id)}`
      };
    }).filter(price => storeMatches(requested, price.shopId)).sort((a, b) => b.date.localeCompare(a.date));

    const germanRecords = allRecords.filter(price => price.countryCode === 'DE');
    const records = germanRecords.length ? germanRecords : allRecords;
    const shops = new Map();
    for (const record of records) if (!shops.has(record.shopId)) shops.set(record.shopId, record);
    const hasGermanPrices = germanRecords.length > 0;

    return res.status(200).json({
      barcode,
      source: 'Open Prices',
      kind: 'crowdsourced-observation',
      scope: hasGermanPrices ? 'DE' : records.length ? 'international' : 'none',
      checkedAt: now,
      prices: [...shops.values()].slice(0, 12),
      history: records.slice(0, 25),
      notice: hasGermanPrices
        ? 'Це добровільно зібрані спостереження, не офіційні поточні ціни магазину. Дивись дату, магазин і місто.'
        : records.length
          ? 'Німецьких спостережень для цього штрихкоду не знайдено. Нижче наведені ціни з інших країн лише як орієнтир; це не поточні ціни.'
          : 'У відкритій базі поки немає спостережень для цього штрихкоду.'
    });
  } catch {
    return res.status(503).json({ error: 'Сервіс цін тимчасово недоступний. Збережені ціни з чеків залишаються.', kind: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
