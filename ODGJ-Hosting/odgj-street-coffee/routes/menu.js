const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// GET /api/menu — semua menu + kategori (dipakai frontend)
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.name, m.description, m.price, m.emoji,
             m.is_available, m.is_bestseller, m.order_count,
             c.slug AS category, c.name AS category_name
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      WHERE m.is_available = TRUE OR TRUE
      ORDER BY c.sort_order, m.sort_order, m.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[menu] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat menu.' });
  }
});

// GET /api/menu/:id — satu item menu
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, c.name AS category_name
       FROM menu_items m
       JOIN categories c ON c.id = m.category_id
       WHERE m.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Menu tidak ditemukan.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat menu.' });
  }
});

module.exports = router;