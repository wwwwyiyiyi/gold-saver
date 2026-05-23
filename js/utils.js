export function $(sel, ctx = document) { return ctx.querySelector(sel); }
export function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

export function formatDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateCN(date) {
  const d = new Date(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatMoney(n) {
  if (n == null || isNaN(n)) return '¥0';
  const abs = Math.abs(n);
  if (abs >= 10000) {
    return (n < 0 ? '-¥' : '¥') + (abs / 10000).toFixed(2) + '万';
  }
  return (n < 0 ? '-¥' : '¥') + Number(abs.toFixed(2)).toLocaleString('zh-CN');
}

export function formatWeight(n) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toFixed(2);
}

export function formatPercent(n) {
  if (n == null || isNaN(n)) return '0.00%';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function vibrate(ms = 10) {
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

export function showToast(msg, duration = 2000) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function getToday() {
  return formatDate(new Date());
}

export const GOLD_PRICE_FALLBACK = 580;
export const SILVER_PRICE_FALLBACK = 7.5;
export const USD_CNY_RATE = 7.25;
export const OUNCE_TO_GRAM = 31.1035;
