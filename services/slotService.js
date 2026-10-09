// Slot reservasi: kapasitas per sesi, ketersediaan real-time, validasi booking.
// Jam operasional 15.00–01.00, sesi 120 menit (MAKS 2 JAM / SESI).
const pool = require('../config/db');

const SESSION_MIN = 120;          // durasi sesi (menit)
const DAY_CAPACITY = 40;          // maks orang per hari (seluruh slot)
const SLOT_START_HOUR = 15;       // slot pertama 15.00
const SLOT_COUNT = 9;             // 15.00 .. 23.00
const ACTIVE_STATUS = `('pending','confirmed','paid','seated')`;

// 'YYYY-MM-DD' + 'HH:MM(:SS)' + menit → 'YYYY-MM-DD HH:MM:SS' (naik hari bila lewat tengah malam)
function addMinutes(dateStr, timeStr, mins) {
  const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, ss, 0);
  dt.setMinutes(dt.getMinutes() + mins);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function isWeekdayOpen() { return true; } // buka tiap hari

// Lazy-seed slot untuk hari tertentu bila belum ada baris
async function ensureSlots(dow) {
  await pool.query(
    `INSERT INTO time_slots (day_of_week, start_ts, end_ts, capacity, booked, is_closed)
     SELECT $1, s.start_ts::time, (s.start_ts::time + INTERVAL '${SESSION_MIN} minutes')::time, 20, 0, FALSE
     FROM (VALUES ('15:00'),('16:00'),('17:00'),('18:00'),('19:00'),
                  ('20:00'),('21:00'),('22:00'),('23:00')) AS s(start_ts)
     ON CONFLICT (day_of_week, start_ts) DO NOTHING`,
    [dow]
  );
}

// Jam berapa pun yang dipilih harus masuk slot operasional → kembalikan slot pembungkusnya
function slotStartFor(timeNorm) {
  const [hh, mm] = timeNorm.split(':').map(Number);
  const mins = hh * 60 + mm;
  const first = SLOT_START_HOUR * 60;
  const last = (SLOT_START_HOUR + SLOT_COUNT - 1) * 60; // 23:00
  if (mins < first || mins > last) return null;
  const startM = first + Math.floor((mins - first) / 60) * 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(startM / 60))}:${p(startM % 60)}:00`;
}

// Ketersediaan publik utk satu tanggal → dipakai halaman /reserve (chips slot + pilih meja)
async function getAvailability(date) {
  const dow = new Date(`${date}T00:00:00`).getDay();
  await ensureSlots(dow);

  const slotsRes = await pool.query(
    `SELECT id, start_ts, end_ts, capacity, is_closed FROM time_slots
     WHERE day_of_week = $1 ORDER BY start_ts`, [dow]);
  const day = await pool.query(
    `SELECT COALESCE(SUM(party_size),0)::int AS booked
     FROM reservations WHERE reservation_date = $1 AND status IN ${ACTIVE_STATUS}`, [date]);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (const s of slotsRes.rows) {
    const start = String(s.start_ts).slice(0, 5);
    const startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
    const endMin = startMin + SESSION_MIN;
    const p = (n) => String(n).padStart(2, '0');
    const end = `${p(Math.floor((endMin % 1440) / 60))}:${p(endMin % 60)}`;

    const bookedRes = await pool.query(
      `SELECT COALESCE(SUM(party_size),0)::int AS booked FROM reservations
       WHERE reservation_date = $1 AND status IN ${ACTIVE_STATUS}
         AND reservation_time >= $2::time AND reservation_time < ($2::time + INTERVAL '60 minutes')`,
      [date, `${start}:00`]);
    const booked = bookedRes.rows[0].booked;

    const freeRes = await pool.query(
      `SELECT t.id, t.name, t.capacity FROM tables t
       WHERE t.is_active = TRUE AND NOT EXISTS (
         SELECT 1 FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id
         WHERE rt.table_id = t.id AND r.reservation_date = $1 AND r.status IN ${ACTIVE_STATUS}
           AND rt.from_ts < $3::timestamp AND rt.to_ts > $2::timestamp
       ) ORDER BY t.capacity ASC`,
      [date, addMinutes(date, start, 0), addMinutes(date, start, SESSION_MIN)]);

    let status = 'open';
    if (s.is_closed) status = 'closed';
    else if (date === todayStr && startMin <= nowMin) status = 'past';
    else if (booked >= s.capacity) status = 'full';

    slots.push({
      start, end, capacity: s.capacity, booked,
      remaining: Math.max(0, s.capacity - booked),
      status,
      free_tables: freeRes.rows,
    });
  }

  return {
    date,
    session_minutes: SESSION_MIN,
    day_capacity: DAY_CAPACITY,
    day_booked: day.rows[0].booked,
    slots,
  };
}

// Validasi saat POST /api/reservations — lempar Error bila tidak lolos
async function validateBooking({ date, time, party }) {
  const timeNorm = time.length === 5 ? `${time}:00` : time;
  const startSlot = slotStartFor(timeNorm);
  if (!startSlot) {
    throw Object.assign(new Error('Di luar jam operasional (15.00–01.00). Pilih slot yang tersedia.'), { status: 400 });
  }
  const dow = new Date(`${date}T00:00:00`).getDay();
  await ensureSlots(dow);

  const slotRes = await pool.query(
    `SELECT id, capacity, is_closed FROM time_slots
     WHERE day_of_week = $1 AND start_ts = $2::time`, [dow, startSlot]);
  if (slotRes.rowCount === 0) {
    throw Object.assign(new Error('Slot tidak tersedia untuk hari itu.'), { status: 409 });
  }
  const slot = slotRes.rows[0];
  if (slot.is_closed) {
    throw Object.assign(new Error('Slot tersebut ditutup (libur). Pilih jam lain.'), { status: 409 });
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const [sh, sm] = startSlot.split(':').map(Number);
  const now = new Date();
  if (date < todayStr || (date === todayStr && sh * 60 + sm < now.getHours() * 60 + now.getMinutes() - 15)) {
    throw Object.assign(new Error('Jam tersebut sudah lewat. Pilih jam mendatang.'), { status: 400 });
  }

  const bookedRes = await pool.query(
    `SELECT COALESCE(SUM(party_size),0)::int AS booked FROM reservations
     WHERE reservation_date = $1 AND status IN ${ACTIVE_STATUS}
       AND reservation_time >= $2::time AND reservation_time < ($2::time + INTERVAL '60 minutes')`,
    [date, startSlot]);
  if (bookedRes.rows[0].booked + party > slot.capacity) {
    throw Object.assign(new Error(`Slot ${startSlot.slice(0, 5)} tinggal ${Math.max(0, slot.capacity - bookedRes.rows[0].booked)} kursi. Pilih jam lain.`), { status: 409 });
  }

  const dayRes = await pool.query(
    `SELECT COALESCE(SUM(party_size),0)::int AS booked FROM reservations
     WHERE reservation_date = $1 AND status IN ${ACTIVE_STATUS}`, [date]);
  if (dayRes.rows[0].booked + party > DAY_CAPACITY) {
    throw Object.assign(new Error(`Kapasitas hari itu penuh (maks ${DAY_CAPACITY} orang).`), { status: 409 });
  }

  return { timeNorm, fromTs: addMinutes(date, timeNorm, 0), toTs: addMinutes(date, timeNorm, SESSION_MIN) };
}

// Pilih meja bebas utk jendela waktu (atau validasi table_id pilihan tamu).
// `db` opsional: pass klien transaksi (BEGIN/COMMIT) saat booking.
async function pickFreeTable(date, fromTs, toTs, party, wantedId = null, db = pool) {
  const q = (extra) => `
    SELECT t.id, t.name, t.capacity FROM tables t
    WHERE t.is_active = TRUE AND t.capacity >= $4 AND NOT EXISTS (
      SELECT 1 FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id
      WHERE rt.table_id = t.id AND r.reservation_date = $1 AND r.status IN ${ACTIVE_STATUS}
        AND rt.from_ts < $3::timestamp AND rt.to_ts > $2::timestamp
    ) ${extra} ORDER BY t.capacity ASC LIMIT 1`;
  if (wantedId) {
    const r = await db.query(q('AND t.id = $5'), [date, fromTs, toTs, party, wantedId]);
    if (r.rowCount === 0) {
      throw Object.assign(new Error('Meja pilihan tidak tersedia pada jam itu.'), { status: 409 });
    }
    return r.rows[0];
  }
  const r = await db.query(q(''), [date, fromTs, toTs, party]);
  return r.rowCount ? r.rows[0] : null;
}

module.exports = { SESSION_MIN, DAY_CAPACITY, addMinutes, ensureSlots, getAvailability, validateBooking, pickFreeTable, ACTIVE_STATUS };
