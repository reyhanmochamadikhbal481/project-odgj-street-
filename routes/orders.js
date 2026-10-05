const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const eventBus = require('../events/eventBus');

const router = express.Router();

// POST /api/orders — simpan pesanan baru dari keranjang (public untuk customer)
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
       VALUES ($1, $2, $3, $4)
       RETURNING id, queue_number, customer_name, notes, total, status, created_at`,
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

    const order = {
      ...orderResult.rows[0],
      items: orderRows.map((r) => ({
        id: r.menu.id,
        name: r.menu.name,
        qty: r.qty,
        unit_price: r.menu.price,
        subtotal: r.subtotal,
        options: r.options,
      })),
    };

    // Emit event domain: OrderSubmitted
    eventBus.publish('OrderSubmitted', order.id, {
      order,
      customer_name: order.customer_name,
      queue_number: order.queue_number,
      total: order.total,
    });

    res.status(201).json(order);
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

// GET /api/orders — daftar pesanan (dashboard barista, butuh auth)
// Query status, mis. /api/orders?status=siap
router.get('/', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
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

// GET /api/orders/live-queue — publik untuk tampilan antrean di halaman customer
// Query: ?customer_name=Nama untuk filter pesanan satu customer
router.get('/live-queue', async (req, res) => {
  const customerFilter = String(req.query.customer_name || '').trim();
  try {
    let query = `
      SELECT o.id, o.queue_number, o.customer_name, o.status, o.created_at,
             COALESCE(json_agg(
               json_build_object(
                 'name', oi.name, 'qty', oi.qty,
                 'unit_price', oi.unit_price, 'subtotal', oi.subtotal,
                 'options', oi.options
               ) ORDER BY oi.id
             ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status IN ('baru', 'diproses', 'siap')`
    const params = [];
    if (customerFilter) {
      query += ` AND o.customer_name LIKE $${params.length + 1}`;
      params.push(`%${customerFilter}%`);
    }
    query += ` GROUP BY o.id ORDER BY o.created_at ASC LIMIT 20`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[orders/live-queue] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat antrean live.' });
  }
});

// GET /api/orders/status — cek status pesanan per customer (public)
router.get('/status', async (req, res) => {
  const { customer_name, queue_number } = req.query;
  try {
    let query = `SELECT o.id, o.queue_number, o.customer_name, o.status, o.created_at
                 FROM orders o WHERE TRUE`;
    const params = [];
    if (customer_name) {
      query += ` AND o.customer_name LIKE $${params.length + 1}`;
      params.push(`%${customer_name}%`);
    }
    if (queue_number) {
      query += ` AND o.queue_number = $${params.length + 1}`;
      params.push(Number(queue_number));
    }
    query += ` ORDER BY o.created_at DESC LIMIT 10`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[orders/status] error:', err.message);
    res.status(500).json({ error: 'Gagal cek status.' });
  }
});

// PATCH /api/orders/:id — ubah status pesanan (baru → diproses → siap → selesai)
router.patch('/:id', authenticate, requireRole('owner', 'manager', 'barista', 'cashier'), async (req, res) => {
  const { status } = req.body;
  const allowed = ['baru', 'diproses', 'siap', 'selesai'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status harus salah satu dari: ${allowed.join(', ')}` });
  }
  try {
    // Ambil status lama untuk metadata event
    const oldResult = await pool.query('SELECT status, queue_number FROM orders WHERE id = $1', [req.params.id]);
    const oldStatus = oldResult.rows[0]?.status;

    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, queue_number, status`,
      [status, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    }

    const order = result.rows[0];

    // Emit event domain: OrderStatusChanged
    eventBus.publish('OrderStatusChanged', order.id, {
      id: order.id,
      queue_number: order.queue_number,
      status: order.status,
      previous_status: oldStatus,
    });

    // Jika status menjadi 'siap', emit OrderReady
    if (status === 'siap') {
      eventBus.publish('OrderReady', order.id, {
        id: order.id,
        queue_number: order.queue_number,
      });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah status.' });
  }
});

module.exports = router;