const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reservations — daftar reservasi (butuh auth)
router.get('/', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.party_size, r.status, r.reservation_date,
              r.estimated_total, r.deposit_amount, r.created_at,
              u.full_name AS customer_name
       FROM reservations r
       JOIN users u ON u.id = r.customer_id
       ORDER BY r.reservation_date DESC, r.reservation_time DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[reservations] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat reservasi.' });
  }
});

// GET /api/reservations/:id — detail reservasi
router.get('/:id', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, rt.table_id, rt.from_ts, rt.to_ts,
              u.full_name AS customer_name, u.phone AS phone,
              p.status AS payment_status, p.gateway_ref AS gateway_ref,
              p.paid_at AS paid_at
       FROM reservations r
       JOIN users u ON u.id = r.customer_id
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       LEFT JOIN deposit_payments p ON p.reservation_id = r.id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[reservations/show] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat detail reservasi.' });
  }
});

// POST /api/reservations — buat reservasi baru (publik, tapi butuh validasi slot)
router.post('/', async (req, res) => {
  try {
    const { date, time, partySize, phone, preferensiMeja, preOrder } = req.body;

    if (!date || !time || !partySize) {
      return res.status(400).json({ error: 'Tanggal, jam, dan party size wajib diisi.' });
    }

    const party = Number(partySize);
    const dateObj = new Date(date);
    const timeObj = new Date(`1970-01-01T${time}:00:00Z`);
    const startTs = dateObj.toISOString().split('T')[0];
    const endTs = new Date(dateObj.setDate(dateObj.getDate() + 1)).toISOString().split('T')[0];

    // Cek ketersediaan slot (30 menit per slot, maks 2 jam/slot)
    const slotDurationMinutes = 30;
    const slotStart = new Date(timeObj);
    const slotEnd = new Date(startTs + 'T' + timeObj.substring(11, 16));
    const slotIndex = Math.floor((timeObj.substring(11, 13) * 60 + timeObj.substring(14, 16)) / 30);

    // Cek konflik di DB
    const conflict = await pool.query(
      `SELECT COUNT(*) AS cnt FROM reservation_tables rt
       JOIN reservations r ON rt.reservation_id = r.id
       WHERE r.status != 'cancelled'
       AND r.reservation_date = $1
       AND rt.from_ts < $2
       AND rt.to_ts > $3`,
      [startTs, endTs, endTs]
    );

    if (conflict.rows[0].cnt > 0) {
      return res.status(409).json({ error: 'Slot waktu sudah penuh atau sudah vareservasi.' });
    }

    // Cek kapasitas (default 20 orang/slot)
    const capacityCheck = await pool.query(
      `SELECT booked FROM time_slots WHERE day_of_week = EXTRACT(DOW FROM $1::DATE) AND start_ts = $2`,
      [date, time]
    );

    let booked = 0;
    if (capacityCheck.rows.length > 0) {
      booked = capacityCheck.rows[0].booked || 0;
    }

    if (partySize + booked > 20) {
      return res.status(409).json({ error: 'Kapasitas slot penuh (maksimal 20 orang).' });
    }

    // Buat reservasi dengan status HOLD
    const bookingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const depositRequired = partySize >= 6 || (preOrder && preOrder > 500000);

    const result = await pool.query(
      `INSERT INTO reservations (booking_code, customer_id, outlet_id, reservation_date, reservation_time, party_size, status, estimated_total, deposit_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
       RETURNING *`,
      [bookingCode, null, 1, startTs, timeObj, party, 'pending', partySize * 20000, depositRequired ? partySize * 20000 : 0, preferensiMeja || '']
    );

    const reservation = result.rows[0];

    // Update booked count di time_slots
    await pool.query(
      `INSERT INTO time_slots (day_of_week, start_ts, end_ts, capacity, booked)
       VALUES (EXTRACT(DOW FROM $1::DATE), $2, $3, 20, 1)
       ON CONFLICT (day_of_week, start_ts)
       DO UPDATE SET booked = booked + 1`,
      [date, timeObj, endTs]
    );

    // Jika butuh DP, buat deposit payment pending
    let depositPayment = null;
    if (depositRequired) {
      const depositResult = await pool.query(
        `INSERT INTO deposit_payments (reservation_id, amount, method, status, gateway_ref, paid_at)
         VALUES ($1, $2, 'qris', 'pending', NULL, NULL)
         RETURNING *`,
        [reservation.id, depositRequired]
      );
      depositPayment = depositResult.rows[0];
    }

    res.status(201).json({
      reservation,
      depositRequired,
      depositPayment,
      message: depositRequired ? 'DP wajib untuk party ini. Silakan lakukan pembayaran QRIS.' : 'Reservasi bisa langsung dikonfirmasi.'
    });
  } catch (err) {
    console.error('[reservations/create] error:', err.message);
    res.status(500).json({ error: 'Gagal membuat reservasi.' });
  }
});

// GET /api/reservations/live — antrean reservasi (publik)
router.get('/live', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.party_size, r.status, r.reservation_date,
              r.reservation_time, r.estimated_total,
              rt.table_id,
              COALESCE(json_agg(
                json_build_object(
                  'name', oi.name, 'qty', oi.qty,
                  'unit_price', oi.unit_price, 'subtotal', oi.subtotal
                ) ORDER BY oi.id
              ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
       FROM reservations r
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       LEFT JOIN order_items oi ON oi.order_id = rt.table_id
       WHERE r.status IN ('confirmed','paid')
       GROUP BY r.id, rt.table_id
       ORDER BY r.reservation_date, r.reservation_time
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[reservations/live] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat reservasi live.' });
  }
});

// POST /api/reservations/:id/pay — verifikasi pembayaran DP (dari webhook Midtrans)
router.post('/:id/pay', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    const { transactionId, paymentStatus } = req.body;

    const result = await pool.query(
      `UPDATE deposit_payments SET status = $1, gateway_ref = $2, paid_at = NOW(), updated_at = NOW() WHERE reservation_id = $2`,
      [paymentStatus, transactionId, reservationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Deposit pembayaran tidak ditemukan.' });
    }

    // Jika status settlement → auto-confirm reservasi
    if (paymentStatus === 'settlement') {
      await pool.query(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [reservationId]);
      // Kirim reminder WA (mock)
      // Kirim notifikasi ke pelanggan via WA API
    }

    res.json({ message: 'Pembayaran diverifikasi', reservationStatus: 'confirmed' });
  } catch (err) {
    console.error('[reservations/pay] error:', err.message);
    res.status(500).json({ error: 'Gagal memverifikasi pembayaran.' });
  }
});

// POST /api/reservations/:id/checkin — check-in meja via QR code (publik)
router.post('/:id/checkin', async (req, res) => {
  try {
    const reservationId = Number(req.params.id);
    
    const result = await pool.query(
      `SELECT r.id, r.booking_code, r.status, r.reservation_date, r.reservation_time,
              rt.table_id, rt.from_ts, rt.to_ts
       FROM reservations r
       LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
       WHERE r.id = $1`,
      [reservationId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    
    const reservation = result.rows[0];
    
    if (reservation.status !== 'confirmed' && reservation.status !== 'paid') {
      return res.status(400).json({ error: 'Reservasi belum dikonfirmasi atau sudah dibatalkan.' });
    }
    
    if (!reservation.table_id) {
      return res.status(400).json({ error: 'Meja belum ditetapkan untuk reservasi ini.' });
    }
    
    // Update reservation_tables status to occupied
    await pool.query(
      `UPDATE reservation_tables SET status = 'occupied' WHERE reservation_id = $1`,
      [reservationId]
    );
    
    // Update reservation status
    await pool.query(
      `UPDATE reservations SET status = 'seated' WHERE id = $1`,
      [reservationId]
    );
    
    res.json({ 
      message: 'Check-in berhasil! Selamat menikmati.',
      table_id: reservation.table_id,
      booking_code: reservation.booking_code
    });
  } catch (err) {
    console.error('[reservations/checkin] error:', err.message);
    res.status(500).json({ error: 'Gagal check-in.' });
  }
});

// DELETE /api/reservations/:id — batal reservasi
router.delete('/:id', authenticate, requireRole('owner', 'manager', 'barista'), async (req, res) => {
  try {
    const result = await pool.query(`UPDATE reservations SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan.' });
    }
    // Kembalikan kapasitas slot
    await pool.query(`UPDATE time_slots SET booked = GREATEST(booked - 1, 0) WHERE day_of_week = EXTRACT(DOW FROM NOW())::INT AND start_ts = CURRENT_TIME`);
    res.json({ message: 'Reservasi dibatalkan', cancelled: true });
  } catch (err) {
    console.error('[reservations/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal membatalkan reservasi.' });
  }
});

module.exports = router;