import { generateUUID } from './utils.js';

const DB_NAME = 'GoldSaverDB';
const DB_VERSION = 1;
const STORE_TRANSACTIONS = 'transactions';
const STORE_PRICE_CACHE = 'goldPriceCache';

let db = null;

export async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_TRANSACTIONS)) {
        const txnStore = database.createObjectStore(STORE_TRANSACTIONS, { keyPath: 'id' });
        txnStore.createIndex('date', 'date', { unique: false });
        txnStore.createIndex('type', 'type', { unique: false });
        txnStore.createIndex('metal', 'metal', { unique: false });
        txnStore.createIndex('dateMetal', ['date', 'metal'], { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE_PRICE_CACHE)) {
        database.createObjectStore(STORE_PRICE_CACHE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function getStore(name, mode = 'readonly') {
  const tx = db.transaction(name, mode);
  return tx.objectStore(name);
}

export async function addTransaction(data) {
  await openDB();
  const store = getStore(STORE_TRANSACTIONS, 'readwrite');
  const record = {
    ...data,
    id: generateUUID(),
    images: data.images || [],
    createdAt: new Date().toISOString()
  };
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function updateTransaction(id, data) {
  await openDB();
  const store = getStore(STORE_TRANSACTIONS, 'readwrite');
  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error('Record not found')); return; }
      const updated = { ...existing, ...data, id };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteTransaction(id) {
  await openDB();
  const store = getStore(STORE_TRANSACTIONS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTransaction(id) {
  await openDB();
  const store = getStore(STORE_TRANSACTIONS);
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllTransactions() {
  await openDB();
  const store = getStore(STORE_TRANSACTIONS);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result || [];
      records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getTransactionsByFilter({ type, metal } = {}) {
  const all = await getAllTransactions();
  return all.filter(r => {
    if (type && r.type !== type) return false;
    if (metal && r.metal !== metal) return false;
    return true;
  });
}

export async function getTransactionsByDateRange(startDate, endDate) {
  const all = await getAllTransactions();
  return all.filter(r => r.date >= startDate && r.date <= endDate);
}

export async function getCachedPrice(metal) {
  await openDB();
  const store = getStore(STORE_PRICE_CACHE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const match = all.filter(p => p.metal === metal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      resolve(match || null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function savePriceCache(data) {
  await openDB();
  const store = getStore(STORE_PRICE_CACHE, 'readwrite');
  return new Promise((resolve, reject) => {
    const record = { ...data, updatedAt: new Date().toISOString() };
    const req = store.add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getPriceHistory(metal, days = 7) {
  await openDB();
  const store = getStore(STORE_PRICE_CACHE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []).filter(p => p.metal === metal);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const recent = all.filter(p => new Date(p.updatedAt) >= cutoff);
      recent.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      resolve(recent);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPricesOnDate(dateStr) {
  await openDB();
  const store = getStore(STORE_PRICE_CACHE);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const result = {};
      for (const p of all) {
        const d = new Date(p.updatedAt);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (dStr === dateStr) {
          if (!result[p.metal] || new Date(p.updatedAt) > new Date(result[p.metal].updatedAt)) {
            result[p.metal] = p;
          }
        }
      }
      resolve(result);
    };
    req.onerror = () => reject(req.error);
  });
}
