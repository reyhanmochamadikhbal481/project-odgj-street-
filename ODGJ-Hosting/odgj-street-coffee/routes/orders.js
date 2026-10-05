const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// POST /api/orders — simpan pesanan baru dari keranjang
// Body: { customer_name, notes, items: [{ id, qty, options }] }
router.post('/', async (req, res) => {
  const { customer_name = 'Pelanggan', notes = '', items = [] } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Pesanan kosong.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ambil data menu yang valid dari DB (bukan dari client)
    const ids = items.map((i) => Number(i.id));
    const menuResult = await client.query(
      `SELECT id, name, price, is_available
         FROM menu_items WHERE id = ANY($1::int[])`,
      [ids]
    );

    const menuById = new Map(menuResult.rows.map((m) => [m.id, m]));
    let total = 0;
    const orderRows = [];

    for (const item of items) {
      const menu = menuById.get(Number(item.id));
      if (!menu) {
        throw new Error(`Menu id ${item.id} tidak ditemukan.`);
      }
      if (!menu.is_available) {
        throw new Error(`${menu.name} sedang habis.`);
      }
      const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
      const options = String(item.options || '').slice(0, 160);
      const subtotal = menu.price * qty;
      total += subtotal;
      orderRows.push({ menu, qty, subtotal, options });
    }

    // Nomor antrean: max + 1 di hari yang sama
    const queueResult = await client.query(
      `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_q
         FROM orders
        WHERE created_at::date = CURRENT_DATE`
    );
    const queueNumber = queueResult.rows[0].next_q;

    const orderResult = await client.query(
      `INSERT INTO orders (queue_number, customer_name, notes, total)
       VALUES ($1, $2, $3, $4) RETURNING id, queue_number, customer_name, notes, total, created_at`,
      [queueNumber, String(customer_name).slice(0, 64), String(notes).slice(0, 500), total]
    );

    for (const { menu, qty, subtotal, options } of orderRows) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, name, qty, unit_price, subtotal, options)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orderResult.rows[0].id, menu.id, menu.name, qty, menu.price, subtotal, options]
      );
    }

    // Naikkan popularitas (order_count) untuk social proof
    for (const { menu, qty } of orderRows) {
      await client.query(
        `UPDATE menu_items SET order_count = order_count + $1 WHERE id = $2`,
        [qty, menu.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      ...orderResult.rows[0],
      items: orderRows.map((r) => ({
        id: r.menu.id,
        name: r.menu.name,
        qty: r.qty,
        unit_price: r.menu.price,
        subtotal: r.subtotal,
        options: r.options,
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.message.includes('tidak ditemukan') || err.message.includes('habis')
      ? 422
      : 500;
    res.status(status).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/orders — daftar pesanan (dashboard barista)
// Query q=status, mis. /api/orders?status=siap
router.get('/', async (req, res) => {
  const statusFilter = String(req.query.status || '').trim();
  try {
    const result = await pool.query(
      `
      SELECT o.id, o.queue_number, o.customer_name, o.notes, o.total, o.status, o.created_at,
             COALESCE(json_agg(
               json_build_object(
                 'name', oi.name, 'qty', oi.qty,
                 'unit_price', oi.unit_price, 'subtotal', oi.subtotal,
                 'options', oi.options
               ) ORDER BY oi.id
             ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${statusFilter ? 'WHERE o.status = $1' : ''}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 50
      `,
      statusFilter ? [statusFilter] : []
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[orders] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat pesanan.' });
  }
});

// PATCH /api/orders/:id — ubah status pesanan (baru → diproses → siap → selesai)
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  const allowed = ['baru', 'diproses', 'siap', 'selesai'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status harus salah satu dari: ${allowed.join(', ')}` });
  }
  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, queue_number, status`,
      [status, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah status.' });
  }
});

module.exports = router;