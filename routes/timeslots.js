const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const slotService = require('../services/slotService');

const router = express.Router();

// GET /api/timeslots/availability?date=YYYY-MM-DD — ketersediaan publik (halaman /reserve)
router.get('/availability', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Parameter date wajib (YYYY-MM-DD).' });
    }
    const max = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    if (date > max) return res.status(400).json({ error: 'Maksimal 60 hari ke depan.' });
    res.json(await slotService.getAvailability(date));
  } catch (err) {
    console.error('[timeslots/availability] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat ketersediaan slot.' });
  }
});

// GET /api/timeslots?dow=0..6 — daftar slot (staff)
router.get('/', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
  try {
    const dow = req.query.dow;
    const vals = [];
    let where = '';
    if (dow !== undefined && dow !== '') {
      const n = Number(dow);
      if (!Number.isInteger(n) || n < 0 || n > 6) return res.status(400).json({ error: 'dow harus 0..6 (0=Minggu).' });
      vals.push(n);
      where = 'WHERE day_of_week = $1';
    }
    const result = await pool.query(
      `SELECT id, outlet_id, day_of_week, start_ts, end_ts, capacity, booked, is_closed
       FROM time_slots ${where} ORDER BY day_of_week, start_ts`, vals);
    res.json(result.rows);
  } catch (err) {
    console.error('[timeslots] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat slot waktu.' });
  }
});

// POST /api/timeslots — tambah slot (owner/manager)
router.post('/', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { day_of_week, start_ts, end_ts, capacity, is_closed } = req.body;
    const dow = Number(day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) return res.status(400).json({ error: 'day_of_week harus 0..6.' });
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start_ts || '')) return res.status(400).json({ error: 'Format start_ts HH:MM.' });
    const start = start_ts.length === 5 ? `${start_ts}:00` : start_ts;
    const end = end_ts
      ? (String(end_ts).length === 5 ? `${end_ts}:00` : end_ts)
      : slotService.addMinutes('2000-01-01', start, slotService.SESSION_MIN).slice(11);
    const result = await pool.query(
      `INSERT INTO time_slots (day_of_week, start_ts, end_ts, capacity, is_closed)
       VALUES ($1, $2::time, $3::time, $4, $5)
       ON CONFLICT (day_of_week, start_ts)
       DO UPDATE SET capacity = EXCLUDED.capacity, end_ts = EXCLUDED.end_ts, is_closed = EXCLUDED.is_closed
       RETURNING *`,
      [dow, start, end, Math.max(1, Number(capacity) || 20), is_closed === true]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[timeslots/create] error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Slot duplikat.' });
    res.status(500).json({ error: 'Gagal menambah slot.' });
  }
});

// PATCH /api/timesoles/:id — ubah kapasitas / tutup slot (owner/manager)
router.patch('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { capacity, is_closed, end_ts, start_ts } = req.body;
    const fields = []; const vals = []; let i = 1;
    if (capacity !== undefined) { fields.push(`capacity = $${i++}`); vals.push(Math.max(1, Number(capacity) || 1)); }
    if (is_closed !== undefined) { fields.push(`is_closed = $${i++}`); vals.push(is_closed === true); }
    if (start_ts !== undefined) {
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start_ts)) return res.status(400).json({ error: 'Format start_ts HH:MM.' });
      fields.push(`start_ts = $${i++}`); vals.push(start_ts.length === 5 ? `${start_ts}:00` : start_ts);
    }
    if (end_ts !== undefined) {
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(end_ts)) return res.status(400).json({ error: 'Format end_ts HH:MM.' });
      fields.push(`end_ts = $${i++}`); vals.push(end_ts.length === 5 ? `${end_ts}:00` : end_ts);
    }
    if (!fields.length) return res.status(400).json({ error: 'Tidak ada data yang diupdate.' });
    vals.push(req.params.id);
    const result = await pool.query(`UPDATE time_slots SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Slot tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[timeslots/update] error:', err.message);
    res.status(500).json({ error: 'Gagal update slot.' });
  }
});

// DELETE /api/timeslots/:id — hapus slot (owner/manager)
router.delete('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM time_slots WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Slot tidak ditemukan.' });
    res.json({ message: 'Slot dihapus' });
  } catch (err) {
    console.error('[timeslots/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal hapus slot.' });
  }
});

module.exports = router;
