const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/tables — daftar meja
router.get('/', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM tables ORDER BY name`);
    res.json(result.rows);
  } catch (err) {
    console.error('[tables] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat meja.' });
  }
});

// POST /api/tables — tambah meja
router.post('/', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, capacity, location, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama meja wajib diisi.' });
    const result = await pool.query(
      `INSERT INTO tables (name, capacity, location, is_active) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, capacity || 4, location || '', is_active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[tables/create] error:', err.message);
    res.status(500).json({ error: 'Gagal menambah meja.' });
  }
});

// PATCH /api/tables/:id — update meja
router.patch('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, capacity, location, is_active } = req.body;
    const fields = []; const vals = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); vals.push(name); }
    if (capacity !== undefined) { fields.push(`capacity = $${idx++}`); vals.push(capacity); }
    if (location !== undefined) { fields.push(`location = $${idx++}`); vals.push(location); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); vals.push(is_active); }
    if (fields.length === 0) return res.status(400).json({ error: 'Tidak ada data yang diupdate.' });
    vals.push(req.params.id);
    const result = await pool.query(`UPDATE tables SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, vals);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Meja tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[tables/update] error:', err.message);
    res.status(500).json({ error: 'Gagal update meja.' });
  }
});

// DELETE /api/tables/:id — hapus meja
router.delete('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM tables WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Meja tidak ditemukan.' });
    res.json({ message: 'Meja dihapus' });
  } catch (err) {
    console.error('[tables/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal hapus meja.' });
  }
});

module.exports = router;