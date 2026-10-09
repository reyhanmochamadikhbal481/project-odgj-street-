// UC-204: Shift & Cash Drawer (Cashier/Manager)
const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const STAFF = ['owner', 'manager', 'barista', 'cashier'];

// GET /api/shifts/current — shift terbuka milik user / terakhir terbuka
router.get('/current', authenticate, requireRole(...STAFF), async (req, res) => {
  const r = await pool.query(`SELECT * FROM shifts WHERE status='open' AND cashier_id=$1 ORDER BY opened_at DESC LIMIT 1`, [req.user.id]);
  res.json(r.rows[0] || null);
});

// GET /api/shifts — riwayat
router.get('/', authenticate, requireRole(...STAFF), async (_req, res) => {
  const r = await pool.query(`SELECT s.*, u.full_name AS cashier_name FROM shifts s LEFT JOIN users u ON u.id=s.cashier_id ORDER BY s.opened_at DESC LIMIT 30`);
  res.json(r.rows);
});

// POST /api/shifts/open — buka shift + kas awal
router.post('/open', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const { opening_cash = 0, note } = req.body;
    const exists = await pool.query(`SELECT id FROM shifts WHERE status='open' AND cashier_id=$1`, [req.user.id]);
    if (exists.rowCount) return res.status(409).json({ error: 'Masih ada shift terbuka.', shift_id: exists.rows[0].id });
    const r = await pool.query(`INSERT INTO shifts (cashier_id, opening_cash, note) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, Number(opening_cash), note || null]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal buka shift.' }); }
});

// POST /api/shifts/:id/cash — catat pembayaran cash ke shift berjalan
router.post('/:id/cash', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const { order_id, amount, method = 'cash' } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount wajib.' });
    const sh = (await pool.query(`SELECT * FROM shifts WHERE id=$1`, [req.params.id])).rows[0];
    if (!sh || sh.status !== 'open') return res.status(400).json({ error: 'Shift tidak terbuka.' });
    const r = await pool.query(`INSERT INTO shift_payments (shift_id, order_id, method, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [sh.id, order_id || null, method, Number(amount)]);
    const eventBus = require('../events/eventBus');
    if (order_id) eventBus.publish('OrderPaid', order_id, { order_id, payment_id: null, amount: Number(amount), method });
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal catat kas: ' + err.message }); }
});

// POST /api/shifts/:id/close — tutup + rekonsiliasi
router.post('/:id/close', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const { closing_cash = 0 } = req.body;
    const sh = (await pool.query(`SELECT * FROM shifts WHERE id=$1`, [req.params.id])).rows[0];
    if (!sh || sh.status !== 'open') return res.status(400).json({ error: 'Shift tidak terbuka.' });
    const sum = (await pool.query(`SELECT COALESCE(SUM(amount),0)::int AS cash_in FROM shift_payments WHERE shift_id=$1 AND method='cash'`, [sh.id])).rows[0].cash_in;
    const expected = Number(sh.opening_cash) + Number(sum);
    const variance = Number(closing_cash) - expected;
    const r = await pool.query(`UPDATE shifts SET closed_at=NOW(), closing_cash=$1, expected_cash=$2, variance=$3, status='closed' WHERE id=$4 RETURNING *`,
      [Number(closing_cash), expected, variance, sh.id]);
    res.json({ shift: r.rows[0], cash_in: sum, expected_cash: expected, variance });
  } catch (err) { res.status(500).json({ error: 'Gagal tutup shift.' }); }
});

module.exports = router;
