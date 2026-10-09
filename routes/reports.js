const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/daily — laporan harian (+COGS/laba dari jurnal)
router.get('/daily', authenticate, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const [ordersRes, paymentsRes, qrisRes, cashRes, pnlRes] = await Promise.all([
      pool.query(`SELECT * FROM orders WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC`, [start, end]),
      pool.query(`SELECT p.*, o.queue_number, o.customer_name FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.created_at BETWEEN $1 AND $2 ORDER BY p.created_at DESC`, [start, end]),
      pool.query(`SELECT SUM(amount) AS total FROM payments WHERE status = 'settlement' AND created_at BETWEEN $1 AND $2`, [start, end]),
      pool.query(`SELECT SUM(o.total) AS total FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.created_at BETWEEN $1 AND $2 AND (p.id IS NULL OR p.status != 'settlement')`, [start, end]),
      pool.query(`SELECT c.type, COALESCE(SUM(CASE WHEN c.type='pendapatan' THEN l.credit - l.debit ELSE l.debit - l.credit END),0)::bigint AS saldo
        FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN chart_of_accounts c ON c.code=l.account_code
        WHERE e.entry_date = $1 AND c.type IN ('pendapatan','hpp','beban') GROUP BY c.type`, [date]),
    ]);

    const totalSales = ordersRes.rows.reduce((sum, o) => sum + Number(o.total), 0);
    const totalQris = qrisRes.rows[0]?.total || 0;
    const totalCash = cashRes.rows[0]?.total || 0;
    const byType = Object.fromEntries(pnlRes.rows.map(r => [r.type, Number(r.saldo)]));
    const hpp = byType.hpp || 0, beban = byType.beban || 0;

    res.json({
      date,
      totalSales,
      totalOrders: ordersRes.rows.length,
      totalQris: Number(totalQris),
      totalCash: Number(totalCash),
      hpp, beban, laba_kotor: totalSales - hpp, laba_bersih: totalSales - hpp - beban,
      orders: ordersRes.rows,
      payments: paymentsRes.rows
    });
  } catch (err) {
    console.error('[reports/daily] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat laporan.' });
  }
});

// GET /api/reports/daily.csv — export CSV (audit-ready sederhana)
router.get('/daily.csv', authenticate, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const r = await pool.query(`SELECT o.id, o.queue_number, o.customer_name, o.total, o.status, o.created_at,
      COALESCE((SELECT string_agg(oi.name || ' x' || oi.qty, '; ')),'') AS items
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.created_at::date = $1::date GROUP BY o.id ORDER BY o.created_at`, [date]);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['id,queue,customer,total,status,created_at,items',
      ...r.rows.map(o => [o.id, o.queue_number, esc(o.customer_name), o.total, o.status, o.created_at.toISOString(), esc(o.items)].join(','))];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="odgj-${date}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { res.status(500).json({ error: 'Gagal export CSV.' }); }
});

// GET /api/reports/daily.xls — export Excel (HTML-table, dibuka langsung oleh Excel/LibreOffice)
router.get('/daily.xls', authenticate, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const r = await pool.query(`SELECT o.id, o.queue_number, o.customer_name, o.total, o.status, o.created_at,
      COALESCE((SELECT string_agg(oi.name || ' x' || oi.qty, '; ')),'') AS items
      FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.created_at::date = $1::date GROUP BY o.id ORDER BY o.created_at`, [date]);
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = r.rows.map(o => `<tr><td>${o.id}</td><td>${o.queue_number}</td><td>${esc(o.customer_name)}</td><td>${o.total}</td><td>${o.status}</td><td>${o.created_at.toISOString()}</td><td>${esc(o.items)}</td></tr>`).join('');
    const total = r.rows.reduce((s, o) => s + Number(o.total), 0);
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table border="1"><tr><th colspan="7">ODGJ Laporan ${date} — Total Rp${total}</th></tr><tr><th>ID</th><th>Antrean</th><th>Customer</th><th>Total</th><th>Status</th><th>Waktu</th><th>Items</th></tr>${rows}</table></body></html>`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="odgj-${date}.xls"`);
    res.send(html);
  } catch (err) { res.status(500).json({ error: 'Gagal export Excel.' }); }
});

module.exports = router;