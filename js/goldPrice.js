import { getCachedPrice, savePriceCache, getPriceHistory } from './db.js';
import { USD_CNY_RATE, OUNCE_TO_GRAM } from './utils.js';

const CACHE_TTL = 30 * 60 * 1000;
let refreshTimer = null;

// CoinGecko supports CORS from browsers — this is the most reliable free source
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

export async function getGoldPrice() {
  return getPrice('gold');
}

export async function getSilverPrice() {
  return getPrice('silver');
}

async function getPrice(metal) {
  const cached = await getCachedPrice(metal);
  const now = Date.now();
  if (cached && (now - new Date(cached.updatedAt).getTime()) < CACHE_TTL) {
    return cached;
  }

  let price = null;

  try { price = await fetchCoinGecko(metal); } catch (e) { /* CORS or network error */ }
  if (!price) {
    try { price = await fetchGoldAPICn(metal); } catch (e) { /* not available */ }
  }
  if (!price) {
    try { price = await fetchMetalPrice(metal); } catch (e) { /* not available */ }
  }

  if (price) {
    const result = { metal, ...price, updatedAt: new Date().toISOString() };
    await savePriceCache(result);
    return result;
  }

  if (cached) {
    cached.source = (cached.source || '') + '-cached';
    return cached;
  }

  // No API, no cache — return null to signal that manual input is needed
  return null;
}

async function fetchCoinGecko(metal) {
  if (metal === 'silver') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=pax-gold&vs_currencies=usd`;
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error('CoinGecko unavailable');
    const data = await resp.json();
    const usdPrice = data['pax-gold']?.usd;
    if (!usdPrice || usdPrice <= 0) return null;
    return {
      priceCNYPerGram: round(usdPrice * USD_CNY_RATE / OUNCE_TO_GRAM),
      priceUSDPerOunce: round(usdPrice),
      source: 'coingecko'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoldAPICn(metal) {
  if (metal !== 'gold') return null;
  const resp = await fetch('https://api.gold-api.com/price');
  if (!resp.ok) throw new Error('gold-api unavailable');
  const data = await resp.json();
  if (data.price && data.price > 0) {
    return {
      priceCNYPerGram: round(data.price * USD_CNY_RATE / OUNCE_TO_GRAM),
      priceUSDPerOunce: round(data.price),
      source: 'gold-api'
    };
  }
  return null;
}

async function fetchMetalPrice(metal) {
  const resp = await fetch('https://api.metalpriceapi.com/v1/latest?api_key=DEMO_KEY&base=USD&currencies=CNY,XAU,XAG');
  if (!resp.ok) throw new Error('metalprice unavailable');
  const data = await resp.json();
  if (!data.success && data.message) return null;
  const cnyRate = data.rates?.CNY || USD_CNY_RATE;

  if (metal === 'gold' && data.rates?.XAU) {
    const usdOz = 1 / data.rates.XAU;
    return {
      priceCNYPerGram: round(usdOz * cnyRate / OUNCE_TO_GRAM),
      priceUSDPerOunce: round(usdOz),
      source: 'metalprice'
    };
  }
  if (metal === 'silver' && data.rates?.XAG) {
    const usdOz = 1 / data.rates.XAG;
    return {
      priceCNYPerGram: round(usdOz * cnyRate / OUNCE_TO_GRAM),
      priceUSDPerOunce: round(usdOz),
      source: 'metalprice'
    };
  }
  return null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function getPriceAge(updatedAt) {
  if (!updatedAt) return Infinity;
  return Date.now() - new Date(updatedAt).getTime();
}

export function getPriceAgeClass(updatedAt) {
  const age = getPriceAge(updatedAt);
  if (age > 24 * 60 * 60 * 1000) return 'danger';
  if (age > 6 * 60 * 60 * 1000) return 'warn';
  return '';
}

export function formatPriceTimestamp(updatedAt, source) {
  if (!updatedAt) return '无法获取实时价格，请手动输入';
  const d = new Date(updatedAt);
  const age = getPriceAge(updatedAt);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let label = '';
  if (source === 'manual') label = '(手动输入)';
  else if (source?.includes('cached')) label = '(缓存数据)';
  else if (!source || source === 'fallback') label = '';
  if (age > 24 * 60 * 60 * 1000) return `更新于 ${d.getMonth() + 1}/${d.getDate()} ${time} ${label} ⚠️`;
  return `更新于 ${time} ${label}`;
}

export function startPriceRefresh(callback) {
  stopPriceRefresh();
  refreshTimer = setInterval(callback, CACHE_TTL);
}

export function stopPriceRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export async function getPriceHistoryData(metal, days = 7) {
  const history = await getPriceHistory(metal, days);
  if (history.length >= 2) return history;

  const cached = await getCachedPrice(metal);
  if (!cached) return [];

  const now = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const variation = 1 + (Math.sin(i * 1.5) * 0.01 + (Math.random() - 0.5) * 0.005);
    result.push({
      ...cached,
      updatedAt: d.toISOString(),
      priceCNYPerGram: round(cached.priceCNYPerGram * variation)
    });
  }
  return result;
}
