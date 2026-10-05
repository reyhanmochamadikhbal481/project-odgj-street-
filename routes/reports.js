const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/daily — laporan harian
router.get('/daily', authenticate, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const [ordersRes, paymentsRes, qrisRes, cashRes] = await Promise.all([
      pool.query(`SELECT * FROM orders WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC`, [start, end]),
      pool.query(`SELECT p.*, o.queue_number, o.customer_name FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.created_at BETWEEN $1 AND $2 ORDER BY p.created_at DESC`, [start, end]),
      pool.query(`SELECT SUM(amount) AS total FROM payments WHERE status = 'settlement' AND created_at BETWEEN $1 AND $2`, [start, end]),
      pool.query(`SELECT SUM(o.total) AS total FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.created_at BETWEEN $1 AND $2 AND (p.id IS NULL OR p.status != 'settlement')`, [start, end])
    ]);

    const totalSales = ordersRes.rows.reduce((sum, o) => sum + Number(o.total), 0);
    const totalQris = qrisRes.rows[0]?.total || 0;
    const totalCash = cashRes.rows[0]?.total || 0;

    res.json({
      date,
      totalSales,
      totalOrders: ordersRes.rows.length,
      totalQris: Number(totalQris),
      totalCash: Number(totalCash),
      orders: ordersRes.rows,
      payments: paymentsRes.rows
    });
  } catch (err) {
    console.error('[reports/daily] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat laporan.' });
  }
});

module.exports = router;