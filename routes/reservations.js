const express = require('express');
const QRCode = require('qrcode');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const slotService = require('../services/slotService');

const router = express.Router();

// GET /api/reservations — daftar reservasi (staff) + filter status/date/search
router.get('/', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
  try {
    const { status, date, search } = req.query;
    const conds = []; const vals = [];
    if (status) { vals.push(status); conds.push(`r.status = $${vals.length}`); }
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Format date YYYY-MM-DD.' });
      vals.push(date); conds.push(`r.reservation_date = $${vals.length}::date`);
    }
    if (search) {
      vals.push(`%${search}%`);
      conds.push(`(r.booking_code ILIKE $${vals.length} OR r.guest_name ILIKE $${vals.length} OR u.full_name ILIKE $${vals.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.party_size, r.status, r.reservation_date, r.reservation_time,
              r.estimated_total, r.deposit_amount, r.created_at, r.guest_name, r.guest_phone,
              COALESCE(u.full_name, r.guest_name, 'Tamu') AS customer_name,
              rt.table_id, dp.status AS payment_status
       FROM reservations r
       LEFT JOIN users u ON u.id = r.customer_id
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       LEFT JOIN deposit_payments dp ON dp.reservation_id = r.id
       ${where}
       ORDER BY r.reservation_date DESC, r.reservation_time DESC
       LIMIT 100`,
      vals
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[reservations] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat reservasi.' });
  }
});

// GET /api/reservations/live — daftar reservasi terkonfirmasi (publik, sebelum /:id)
router.get('/live', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.party_size, r.status, r.reservation_date,
              r.reservation_time, r.estimated_total,
              rt.table_id
       FROM reservations r
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       WHERE r.status IN ('confirmed','paid')
         AND r.reservation_date >= CURRENT_DATE - INTERVAL '1 day'
       ORDER BY r.reservation_date, r.reservation_time
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[reservations/live] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat reservasi live.' });
  }
});

// GET /api/reservations/reminders/preview — daftar pengingat jatuh tempo (staff)
router.get('/reminders/preview', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (_req, res) => {
  try {
    const { dueReminders } = require('../services/reminderService');
    res.json(await dueReminders());
  } catch (err) { res.status(500).json({ error: 'Gagal memuat preview.' }); }
});

// POST /api/reservations/reminders/trigger — jalankan scheduler sekarang (manager+)
router.post('/reminders/trigger', authenticate, requireRole('owner', 'manager'), async (_req, res) => {
  try {
    const { runReminders } = require('../services/reminderService');
    res.json(await runReminders());
  } catch (err) { res.status(500).json({ error: 'Gagal trigger reminder.' }); }
});

// GET /api/reservations/reminders/logs — riwayat pengingat terkirim
router.get('/reminders/logs', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM reminder_logs ORDER BY created_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat log.' }); }
});

// GET /api/reservations/lookup?code=ABC123 — cek reservasi via kode (publik, utk scan QR)
router.get('/lookup', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(code)) return res.status(400).json({ error: 'Kode booking tidak valid.' });
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.status, r.party_size, r.guest_name,
              r.reservation_date::text AS reservation_date,
              r.reservation_time::text AS reservation_time,
              rt.table_id
       FROM reservations r
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       WHERE r.booking_code = $1`, [code]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Kode booking tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[reservations/lookup] error:', err.message);
    res.status(500).json({ error: 'Gagal mencari reservasi.' });
  }
});

// GET /api/reservations/reminders/... ditangani di atas; berikut rute umum

// GET /api/reservations/:id/qr — QR check-in (publik, PNG)
router.get('/:id/qr', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const r = await pool.query(`SELECT id FROM reservations WHERE id = $1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${base}/checkin?id=${id}`;
    const buf = await QRCode.toBuffer(url, {
      type: 'png', width: 400, margin: 2,
      color: { dark: '#15130F', light: '#F2E9D8' },
    });
    res.type('png').set('Cache-Control', 'public, max-age=3600').send(buf);
  } catch (err) {
    console.error('[reservations/qr] error:', err.message);
    res.status(500).json({ error: 'Gagal membuat QR.' });
  }
});

// GET /api/reservations/:id — detail reservasi (staff)
router.get('/:id', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const result = await pool.query(
      `SELECT r.*, rt.table_id, t.name AS table_name, rt.from_ts, rt.to_ts,
              COALESCE(u.full_name, r.guest_name, 'Tamu') AS customer_name,
              COALESCE(r.guest_phone, u.phone) AS phone,
              p.status AS payment_status, p.gateway_ref AS gateway_ref,
              p.paid_at AS paid_at
       FROM reservations r
       LEFT JOIN users u ON u.id = r.customer_id
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       LEFT JOIN tables t ON t.id = rt.table_id
       LEFT JOIN deposit_payments p ON p.reservation_id = r.id
       WHERE r.id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    const po = await pool.query(
      `SELECT po.id, po.total, po.status,
              mi.name AS item_name, poi.qty, poi.unit_price, poi.notes
       FROM pre_orders po
       LEFT JOIN pre_order_items poi ON poi.pre_order_id = po.id
       LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
       WHERE po.reservation_id = $1`, [id]);
    res.json({ ...result.rows[0], pre_order_items: po.rows });
  } catch (err) {
    console.error('[reservations/show] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat detail reservasi.' });
  }
});

// POST /api/reservations — buat reservasi baru (publik/guest)
// Validasi slot + kapasitas via slotService, transaksi atomik, dukung pilih meja & pre-order
router.post('/', async (req, res) => {
  let client = null;
  try {
    const { date, time, partySize, phone, guest_name, table_id, notes, pre_order } = req.body;

    if (!date || !time || partySize === undefined || partySize === null) {
      return res.status(400).json({ error: 'Tanggal, jam, dan jumlah orang wajib diisi.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Format tanggal YYYY-MM-DD.' });
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return res.status(400).json({ error: 'Format jam HH:MM.' });
    if (!guest_name || String(guest_name).trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter.' });
    if (phone && !/^(\+?62|0)8[1-9][0-9]{6,13}$/.test(String(phone).replace(/[\s-]/g, ''))) {
      return res.status(400).json({ error: 'Nomor HP tidak valid (contoh: 0812...).' });
    }

    const party = Math.max(1, Math.min(50, Number(partySize)));
    const { timeNorm, fromTs, toTs } = await slotService.validateBooking({ date, time, party });

    // Validasi item pre-order (harga diambil dari DB, bukan dari klien)
    const items = [];
    let preOrderTotal = 0;
    if (Array.isArray(pre_order) && pre_order.length) {
      if (pre_order.length > 30) return res.status(400).json({ error: 'Maksimal 30 item pre-order.' });
      const ids = [...new Set(pre_order.map(i => Number(i && i.menu_item_id)).filter(Boolean))];
      const menuRes = ids.length
        ? await pool.query(`SELECT id, name, price, is_available FROM menu_items WHERE id = ANY($1::int[])`, [ids])
        : { rows: [] };
      const byId = new Map(menuRes.rows.map(m => [m.id, m]));
      for (const raw of pre_order) {
        const mid = Number(raw && raw.menu_item_id);
        const qty = Math.max(1, Math.min(50, Number(raw && raw.qty) || 1));
        const m = byId.get(mid);
        if (!m) return res.status(400).json({ error: `Menu #${mid} tidak ditemukan.` });
        if (!m.is_available) return res.status(400).json({ error: `${m.name} sedang habis.` });
        items.push({ menu_item_id: mid, qty, unit_price: m.price, notes: String((raw && raw.notes) || '').slice(0, 200) });
        preOrderTotal += m.price * qty;
      }
    }

    const needDP = party >= 6 || preOrderTotal > 500000;
    const estTotal = items.length ? preOrderTotal : party * 20000;
    const dpAmount = needDP ? Math.min(estTotal, 20000 * party) : 0;
    // Tanpa DP → langsung confirmed agar bisa check-in saat tiba
    const initialStatus = needDP ? 'pending' : 'confirmed';
    const bookingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO reservations (booking_code, customer_id, outlet_id, reservation_date, reservation_time, party_size, status, estimated_total, deposit_amount, notes, guest_name, guest_phone)
       VALUES ($1, NULL, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [bookingCode, date, timeNorm, party, initialStatus, estTotal, dpAmount,
       String(notes || '').slice(0, 500), String(guest_name || '').trim().slice(0, 100), String(phone || '').replace(/[\s-]/g, '').slice(0, 32)]
    );
    const reservation = result.rows[0];

    // Alokasi meja: pilihan tamu (table_id) atau otomatis meja bebas terkecil
    const table = await slotService.pickFreeTable(date, fromTs, toTs, party, Number(table_id) || null, client);
    if (table) {
      await client.query(
        `INSERT INTO reservation_tables (reservation_id, table_id, from_ts, to_ts, status) VALUES ($1,$2,$3::timestamp,$4::timestamp,'pending')`,
        [reservation.id, table.id, fromTs, toTs]);
    }

    // Pre-order
    if (items.length) {
      const po = await client.query(
        `INSERT INTO pre_orders (reservation_id, total, status) VALUES ($1,$2,'pending') RETURNING id`,
        [reservation.id, preOrderTotal]);
      for (const it of items) {
        await client.query(
          `INSERT INTO pre_order_items (pre_order_id, menu_item_id, qty, unit_price, notes) VALUES ($1,$2,$3,$4,$5)`,
          [po.rows[0].id, it.menu_item_id, it.qty, it.unit_price, it.notes]);
      }
    }

    let depositPayment = null;
    if (needDP) {
      depositPayment = (await client.query(
        `INSERT INTO deposit_payments (reservation_id, amount, method, status) VALUES ($1,$2,'qris','pending') RETURNING *`,
        [reservation.id, dpAmount])).rows[0];
    }

    await client.query('COMMIT');

    const eventBus = require('../events/eventBus');
    eventBus.publish('ReservationCreated', reservation.id, { reservation_id: reservation.id, booking_code: bookingCode, party, needDP });

    res.status(201).json({
      reservation,
      table: table ? { id: table.id, name: table.name } : null,
      depositRequired: needDP,
      depositPayment,
      pre_order: items.length ? { total: preOrderTotal, items: items.length } : null,
      message: needDP
        ? 'DP wajib untuk reservasi ini. Selesaikan pembayaran QRIS agar terkonfirmasi.'
        : 'Reservasi terkonfirmasi. Simpan kode booking Anda.'
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    const code = err.status || 500;
    if (code !== 500) return res.status(code).json({ error: err.message });
    console.error('[reservations/create] error:', err.message);
    res.status(500).json({ error: 'Gagal membuat reservasi.' });
  } finally {
    if (client) client.release();
  }
});

// PATCH /api/reservations/:id — ubah status / assign meja (staff)
router.patch('/:id', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { status, table_id } = req.body;
    const ALLOWED = ['pending', 'confirmed', 'paid', 'cancelled', 'no_show'];
    if (status !== undefined && !ALLOWED.includes(status)) {
      return res.status(400).json({ error: `Status harus salah satu: ${ALLOWED.join(', ')}.` });
    }

    const cur = await pool.query(
      `SELECT id, status, reservation_date::text AS reservation_date, reservation_time::text AS reservation_time, party_size
       FROM reservations WHERE id = $1`, [id]);
    if (cur.rowCount === 0) return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    const r = cur.rows[0];

    if (status) {
      await pool.query(`UPDATE reservations SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
      if (status === 'cancelled' || status === 'no_show') {
        await pool.query(`UPDATE reservation_tables SET status = 'cancelled' WHERE reservation_id = $1`, [id]);
      }
    }

    if (table_id !== undefined) {
      if (table_id === null) {
        await pool.query(`DELETE FROM reservation_tables WHERE reservation_id = $1`, [id]);
      } else {
        const tid = Number(table_id);
        if (!Number.isInteger(tid)) return res.status(400).json({ error: 'table_id tidak valid.' });
        const fromTs = slotService.addMinutes(r.reservation_date, r.reservation_time, 0);
        const toTs = slotService.addMinutes(r.reservation_date, r.reservation_time, slotService.SESSION_MIN);
        const t = await slotService.pickFreeTable(r.reservation_date, fromTs, toTs, r.party_size, tid);
        if (!t) return res.status(409).json({ error: 'Meja tidak tersedia pada jam reservasi itu.' });
        await pool.query(`DELETE FROM reservation_tables WHERE reservation_id = $1`, [id]);
        await pool.query(
          `INSERT INTO reservation_tables (reservation_id, table_id, from_ts, to_ts, status) VALUES ($1,$2,$3::timestamp,$4::timestamp,'confirmed')`,
          [id, t.id, fromTs, toTs]);
      }
    }

    const detail = await pool.query(
      `SELECT r.id, r.booking_code, r.status, r.party_size, r.reservation_date, r.reservation_time,
              r.estimated_total, r.deposit_amount, rt.table_id
       FROM reservations r LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       WHERE r.id = $1`, [id]);
    const eventBus = require('../events/eventBus');
    eventBus.publish('ReservationUpdated', id, { reservation_id: id, status: detail.rows[0].status });
    res.json(detail.rows[0]);
  } catch (err) {
    const code = err.status || 500;
    if (code !== 500) return res.status(code).json({ error: err.message });
    console.error('[reservations/patch] error:', err.message);
    res.status(500).json({ error: 'Gagal mengubah reservasi.' });
  }
});

// POST /api/reservations/:id/pay — verifikasi pembayaran DP (dari webhook Midtrans)
router.post('/:id/pay', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const { transactionId, paymentStatus } = req.body;

    const result = await pool.query(
      `UPDATE deposit_payments SET status = $1, gateway_ref = $2, paid_at = NOW(), updated_at = NOW() WHERE reservation_id = $3`,
      [paymentStatus, transactionId, reservationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Deposit pembayaran tidak ditemukan.' });
    }

    // Jika status settlement → auto-confirm reservasi
    if (paymentStatus === 'settlement') {
      await pool.query(`UPDATE reservations SET status = 'paid' WHERE id = $1 AND status != 'seated'`, [reservationId]);
    }

    res.json({ message: 'Pembayaran diverifikasi', reservationStatus: paymentStatus === 'settlement' ? 'paid' : 'pending' });
  } catch (err) {
    console.error('[reservations/pay] error:', err.message);
    res.status(500).json({ error: 'Gagal memverifikasi pembayaran.' });
  }
});

// POST /api/reservations/:id/checkin — check-in meja via QR (publik; staf dgn Authorization boleh di luar jendela)
router.post('/:id/checkin', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId)) return res.status(400).json({ error: 'ID tidak valid.' });
    const isStaff = Boolean(req.headers.authorization);

    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.status, r.guest_name, r.party_size,
              r.reservation_date::text AS reservation_date,
              r.reservation_time::text AS reservation_time,
              rt.table_id, t.name AS table_name
       FROM reservations r
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       LEFT JOIN tables t ON t.id = rt.table_id
       WHERE r.id = $1`,
      [reservationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    const r = result.rows[0];

    if (r.status === 'cancelled' || r.status === 'no_show') {
      return res.status(400).json({ error: 'Reservasi sudah dibatalkan / tidak hadir.', code: 'cancelled' });
    }
    if (r.status === 'seated') {
      return res.json({
        message: 'Sudah check-in sebelumnya.', already: true,
        table_id: r.table_id, table_name: r.table_name, booking_code: r.booking_code,
        guest_name: r.guest_name, reservation_date: r.reservation_date,
        reservation_time: r.reservation_time, party_size: r.party_size,
      });
    }
    if (!isStaff && r.status !== 'confirmed' && r.status !== 'paid') {
      return res.status(400).json({
        error: 'Reservasi belum dikonfirmasi. Lunasi DP terlebih dahulu.',
        code: 'need_confirmation',
      });
    }

    // Jendela check-in publik: 60 menit sebelum sampai 30 menit sesudah jam reservasi
    if (!isStaff) {
      const [y, m, d] = r.reservation_date.split('-').map(Number);
      const [hh, mm] = r.reservation_time.split(':').map(Number);
      const resAbs = Date.UTC(y, m - 1, d, hh, mm) / 60000; // menit absolut (UTC)
      const now = new Date();
      const nowAbs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()) / 60000;
      const delta = nowAbs - resAbs;
      if (delta < -60 || delta > 30) {
        return res.status(400).json({
          error: 'Check-in baru bisa 1 jam sebelum – 30 menit setelah jam reservasi Anda.',
          code: 'outside_window',
          window: { opens_at: r.reservation_date + ' ' + r.reservation_time },
        });
      }
    }

    // Meja belum ada → alokasi otomatis sekarang
    let tableId = r.table_id;
    let tableName = r.table_name;
    if (!tableId) {
      const fromTs = slotService.addMinutes(r.reservation_date, r.reservation_time, 0);
      const toTs = slotService.addMinutes(r.reservation_date, r.reservation_time, slotService.SESSION_MIN);
      const t = await slotService.pickFreeTable(r.reservation_date, fromTs, toTs, r.party_size);
      if (!t) {
        return res.status(409).json({ error: 'Semua meja penuh. Mohon tunggu sebentar di kasir.', code: 'no_table' });
      }
      await pool.query(
        `INSERT INTO reservation_tables (reservation_id, table_id, from_ts, to_ts, status) VALUES ($1,$2,$3::timestamp,$4::timestamp,'confirmed')`,
        [r.id, t.id, fromTs, toTs]);
      tableId = t.id; tableName = t.name;
    } else {
      await pool.query(`UPDATE reservation_tables SET status = 'occupied' WHERE reservation_id = $1`, [r.id]);
    }

    await pool.query(`UPDATE reservations SET status = 'seated', updated_at = NOW() WHERE id = $1`, [r.id]);

    const eventBus = require('../events/eventBus');
    eventBus.publish('ReservationSeated', r.id, { reservation_id: r.id, table_id: tableId });

    res.json({
      message: 'Check-in berhasil! Selamat menikmati.',
      table_id: tableId,
      table_name: tableName,
      booking_code: r.booking_code,
      guest_name: r.guest_name,
      reservation_date: r.reservation_date,
      reservation_time: r.reservation_time,
      party_size: r.party_size,
    });
  } catch (err) {
    console.error('[reservations/checkin] error:', err.message);
    res.status(500).json({ error: 'Gagal check-in.' });
  }
});

// DELETE /api/reservations/:id — batal reservasi
router.delete('/:id', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const result = await pool.query(`UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    await pool.query(`UPDATE reservation_tables SET status = 'cancelled' WHERE reservation_id = $1`, [req.params.id]);
    res.json({ message: 'Reservasi dibatalkan', cancelled: true });
  } catch (err) {
    console.error('[reservations/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal membatalkan reservasi.' });
  }
});

module.exports = router;
