// Cache layer: Redis bila REDIS_URL tersedia, fallback memory.
// Tanpa dependency wajib — coba require('redis') secara opsional.
const memory = new Map();

let redisClient = null;
let redisReady = false;

async function initCache() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const redis = require('redis');
    redisClient = redis.createClient({ url });
    redisClient.on('error', () => { redisReady = false; });
    await redisClient.connect();
    redisReady = true;
    console.log('[cache] Redis connected');
  } catch (err) {
    console.warn('[cache] Redis unavailable, fallback memory:', err.message);
    redisClient = null;
    redisReady = false;
  }
  return redisClient;
}

async function cacheGet(key) {
  if (redisClient && redisReady) {
    try {
      const v = await redisClient.get(key);
      return v ? JSON.parse(v) : null;
    } catch { return memory.get(key) ?? null; }
  }
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { memory.delete(key); return null; }
  return hit.val;
}

async function cacheSet(key, val, ttlSec = 30) {
  if (redisClient && redisReady) {
    try { await redisClient.setEx(key, ttlSec, JSON.stringify(val)); return; }
    catch { /* fallback */ }
  }
  memory.set(key, { val, exp: Date.now() + ttlSec * 1000 });
}

async function cacheDel(prefixOrKey) {
  if (redisClient && redisReady) {
    try {
      // hapus by key; untuk prefix gunakan SCAN sederhana
      if (prefixOrKey.endsWith('*')) {
        const prefix = prefixOrKey.slice(0, -1);
        for await (const k of redisClient.scanIterator({ MATCH: prefix + '*' })) {
          await redisClient.del(k);
        }
      } else {
        await redisClient.del(prefixOrKey);
      }
    } catch { /* abaikan */ }
  }
  if (prefixOrKey.endsWith('*')) {
    const prefix = prefixOrKey.slice(0, -1);
    for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  } else {
    memory.delete(prefixOrKey);
  }
}

function cacheStats() {
  return { backend: redisClient && redisReady ? 'redis' : 'memory', keys: memory.size };
}

module.exports = { initCache, cacheGet, cacheSet, cacheDel, cacheStats };
