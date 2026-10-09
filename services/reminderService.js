// Reminder reservasi H-1 & H-2 jam via WhatsApp (Blueprint BR-RES: reminder)
// Tanpa node-cron: interval bawaan Node. Provider WA generik via env:
//   WA_PROVIDER=fonnte (default) | whapi | generic
//   WA_API_URL + WA_API_KEY
//   fonnte : POST {target, message}, header Authorization: <key>
//   whapi  : POST {to, body},        header Authorization: <key>
//   generic: POST {phone, text},     header Authorization: <key>
// Bila tidak diset → mode mock (log + wa.me link), tetap tercatat di reminder_logs.
// Kirim dengan retry 3x (backoff 1s → 3s) sebelum ditandai gagal.
const pool = require('../config/db');
const eventBus = require('../events/eventBus');

const INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS) || 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFFS = [1000, 3000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function buildMessage(r, kind) {
  const d = r.reservation_date.toISOString ? r.reservation_date.toISOString().slice(0, 10) : r.reservation_date;
  const t = String(r.reservation_time).slice(0, 5);
  const head = `Halo ${r.who}! Ini ODGJ Street Coffee ☕`;
  if (kind === 'H-1') {
    return `${head}\nPengingat reservasi *${r.booking_code}*: BESOK ${d} jam ${t} untuk ${r.party_size} orang.` +
      `\nBalas BATAL / MUNDUR jika berubah (maks 1x, min. H-6 jam).` +
      `\nSaat tiba, scan QR check-in: ${baseUrl()}/checkin?id=${r.id}` +
      `\nSampai jumpa!`;
  }
  return `${head}\nReservasi *${r.booking_code}* kurang ±2 jam lagi (hari ini jam ${t}, ${r.party_size} orang).` +
    `\nTunjukkan kode ini saat tiba.` +
    `\nCheck-in cepat: ${baseUrl()}/checkin?id=${r.id}`;
}

async function dueReminders() {
  // H-1: reservasi confirmed/paid untuk BESOK yang belum diingatkan
  // H-2: reservasi hari INI dalam 2 jam ke depan yang belum diingatkan
  const { rows } = await pool.query(`
    SELECT r.id, r.booking_code, r.reservation_date, r.reservation_time, r.party_size,
           COALESCE(r.guest_name, u.full_name, 'Kak') AS who,
           COALESCE(r.guest_phone, u.phone, '') AS phone
    FROM reservations r LEFT JOIN users u ON u.id = r.customer_id
    WHERE r.status IN ('confirmed','paid')
      AND (r.reservation_date = CURRENT_DATE + INTERVAL '1 day'
           OR (r.reservation_date = CURRENT_DATE
               AND (r.reservation_date + r.reservation_time) BETWEEN NOW() AND NOW() + INTERVAL '2 hours'))
      AND NOT EXISTS (SELECT 1 FROM reminder_logs l WHERE l.reservation_id = r.id
                      AND l.kind = CASE WHEN r.reservation_date = CURRENT_DATE + INTERVAL '1 day' THEN 'H-1' ELSE 'H-2' END)`);
  return rows.map(r => ({
    ...r,
    kind: String(r.reservation_date.toISOString ? r.reservation_date.toISOString().slice(0, 10) : r.reservation_date) ===
      new Date(Date.now() + 864e5).toISOString().slice(0, 10) ? 'H-1' : 'H-2',
  }));
}

function providerPayload(target, message) {
  const provider = (process.env.WA_PROVIDER || 'fonnte').toLowerCase();
  if (provider === 'whapi') return { body: { to: target, body: message } };
  if (provider === 'generic') return { body: { phone: target, text: message } };
  return { body: { target, message } }; // fonnte
}

async function sendOnce(target, message) {
  const url = process.env.WA_API_URL;
  const key = process.env.WA_API_KEY;
  if (!url || !key) return { mock: true };
  const { body } = providerPayload(target, message);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `WA provider ${res.status}`);
  return { mock: false, ref: data.id || data.message_id || data.messageId || null };
}

async function sendWithRetry(target, message) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const out = await sendOnce(target, message);
      if (out.mock) return out;
      return { ...out, attempts: attempt };
    } catch (err) {
      lastErr = err;
      console.warn(`[reminder] percobaan ${attempt}/${MAX_ATTEMPTS} gagal: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFFS[attempt - 1] || 3000);
    }
  }
  throw lastErr;
}

async function runReminders() {
  let list = [];
  try {
    list = await dueReminders();
  } catch (err) {
    console.error('[reminder] query gagal:', err.message);
    return { sent: 0, mock: 0, failed: 0 };
  }
  let sent = 0, mock = 0, failed = 0;
  for (const r of list) {
    const message = buildMessage(r, r.kind);
    try {
      const out = r.phone ? await sendWithRetry(r.phone, message) : { mock: true };
      await pool.query(
        `INSERT INTO reminder_logs (reservation_id, kind, target, message, provider_ref, status)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (reservation_id, kind) DO NOTHING`,
        [r.id, r.kind, r.phone || null, message, out.ref || null, out.mock ? 'mock' : 'sent']);
      eventBus.publish('ReminderSent', r.id, { reservation_id: r.id, booking_code: r.booking_code, kind: r.kind, mock: out.mock });
      out.mock ? mock++ : sent++;
    } catch (err) {
      console.error(`[reminder] gagal #${r.id} setelah ${MAX_ATTEMPTS}x:`, err.message);
      await pool.query(
        `INSERT INTO reminder_logs (reservation_id, kind, target, message, status)
         VALUES ($1,$2,$3,$4,'failed') ON CONFLICT (reservation_id, kind) DO NOTHING`,
        [r.id, r.kind, r.phone || null, message]).catch(() => {});
      failed++;
    }
  }
  if (list.length) console.log(`[reminder] H-1/H-2: sent=${sent} mock=${mock} failed=${failed}`);
  return { sent, mock, failed, total: list.length };
}

function startReminderScheduler() {
  if (process.env.REMINDER_DISABLE === 'true') return null;
  // jalan perdana 60 dtk setelah boot, lalu tiap INTERVAL_MS
  setTimeout(() => runReminders().catch(() => {}), 60 * 1000);
  const t = setInterval(() => runReminders().catch(() => {}), INTERVAL_MS);
  if (t.unref) t.unref();
  console.log('[reminder] scheduler aktif tiap', Math.round(INTERVAL_MS / 60000), 'menit');
  return t;
}

module.exports = { runReminders, dueReminders, buildMessage, startReminderScheduler };
