const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const eventBus = require('../events/eventBus');
const { cacheGet, cacheSet, cacheDel } = require('../config/cache');

const router = express.Router();

// GET /api/menu/categories — daftar kategori (admin)
router.get('/categories', authenticate, requireRole('owner', 'manager'), async (_req, res) => {
  try {
    const result = await pool.query(`SELECT id, slug, name, sort_order FROM categories ORDER BY sort_order`);
    res.json(result.rows);
  } catch (err) {
    console.error('[menu/categories] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat kategori.' });
  }
});

// GET /api/menu — semua menu + kategori (dipakai frontend, cache 30 dtk via Redis/memory)
router.get('/', async (_req, res) => {
  try {
    const cached = await cacheGet('menu:all');
    if (cached) return res.json(cached);
    const result = await pool.query(`
      SELECT m.id, m.name, m.description, m.price, m.emoji, m.photo_url,
             m.is_available, m.is_bestseller, m.order_count,
             c.slug AS category, c.name AS category_name
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      WHERE m.is_available = TRUE OR TRUE
      ORDER BY c.sort_order, m.sort_order, m.id
    `);
    await cacheSet('menu:all', result.rows, 30);
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

// POST /api/menu — tambah menu baru (admin)
router.post('/', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, description, category_id, price, emoji, photo_url, sort_order, is_available, is_bestseller } = req.body;
    if (!name || !description || !category_id || !price) {
      return res.status(400).json({ error: 'Nama, deskripsi, kategori, dan harga wajib diisi.' });
    }
    const result = await pool.query(
      `INSERT INTO menu_items (name, description, category_id, price, emoji, photo_url, sort_order, is_available, is_bestseller)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, description, category_id, price, emoji || '☕', photo_url || null, sort_order || 0, is_available !== false, is_bestseller === true]
    );
    eventBus.publish('CatalogUpdated', result.rows[0].id, { action: 'created', item: result.rows[0] });
    await cacheDel('menu*');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[menu/create] error:', err.message);
    res.status(500).json({ error: 'Gagal menambah menu.' });
  }
});

// PATCH /api/menu/:id — update menu (admin)
router.patch('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, description, category_id, price, emoji, photo_url, sort_order, is_available, is_bestseller } = req.body;
    const fields = []; const vals = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); vals.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); vals.push(description); }
    if (category_id !== undefined) { fields.push(`category_id = $${idx++}`); vals.push(category_id); }
    if (price !== undefined) { fields.push(`price = $${idx++}`); vals.push(price); }
    if (emoji !== undefined) { fields.push(`emoji = $${idx++}`); vals.push(emoji); }
    if (photo_url !== undefined) { fields.push(`photo_url = $${idx++}`); vals.push(photo_url); }
    if (sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); vals.push(sort_order); }
    if (is_available !== undefined) { fields.push(`is_available = $${idx++}`); vals.push(is_available); }
    if (is_bestseller !== undefined) { fields.push(`is_bestseller = $${idx++}`); vals.push(is_bestseller); }
    if (fields.length === 0) return res.status(400).json({ error: 'Tidak ada data yang diupdate.' });
    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Menu tidak ditemukan.' });
    eventBus.publish('CatalogUpdated', result.rows[0].id, { action: 'updated', item: result.rows[0] });
    await cacheDel('menu*');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[menu/update] error:', err.message);
    res.status(500).json({ error: 'Gagal update menu.' });
  }
});

// DELETE /api/menu/:id — hapus menu (admin)
router.delete('/:id', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM menu_items WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Menu tidak ditemukan.' });
    eventBus.publish('CatalogUpdated', req.params.id, { action: 'deleted', id: Number(req.params.id) });
    await cacheDel('menu*');
    res.json({ message: 'Menu dihapus' });
  } catch (err) {
    console.error('[menu/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal hapus menu.' });
  }
});

module.exports = router;