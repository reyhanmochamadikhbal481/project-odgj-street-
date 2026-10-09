// Modul 5: Akuntansi — UC-501..504
const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const accounting = require('../services/accountingService');

const router = express.Router();
const STAFF = ['owner', 'manager', 'barista', 'cashier'];
const FINANCE = ['owner', 'manager', 'cashier'];

// GET /api/accounting/coa
router.get('/coa', authenticate, requireRole(...FINANCE), async (_req, res) => {
  const r = await pool.query(`SELECT * FROM chart_of_accounts ORDER BY code`); res.json(r.rows);
});

// GET /api/accounting/journals?from=&to=
router.get('/journals', authenticate, requireRole(...FINANCE), async (req, res) => {
  try {
    const { from, to } = req.query;
    let q = `SELECT e.*, COALESCE(json_agg(json_build_object('account_code',l.account_code,'debit',l.debit,'credit',l.credit) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]') AS lines
             FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id WHERE TRUE`;
    const p = [];
    if (from) { q += ` AND e.entry_date >= $${p.length + 1}`; p.push(from); }
    if (to) { q += ` AND e.entry_date <= $${p.length + 1}`; p.push(to); }
    q += ` GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC LIMIT 100`;
    res.json((await pool.query(q, p)).rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat jurnal.' }); }
});

// POST /api/accounting/journals — jurnal manual
router.post('/journals', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { memo, lines, entry_date } = req.body;
    if (!memo || !Array.isArray(lines) || lines.length < 2) return res.status(400).json({ error: 'memo + minimal 2 lines wajib.' });
    const e = await accounting.postJournal({ memo, lines, entry_date, created_by: req.user.id });
    res.status(201).json(e);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/accounting/pnl?from=&to= — Laba Rugi
router.get('/pnl', authenticate, requireRole(...FINANCE), async (req, res) => {
  try {
    const { from, to } = req.query;
    const p = []; let f = '';
    if (from) { f += ` AND e.entry_date >= $${p.length + 1}`; p.push(from); }
    if (to) { f += ` AND e.entry_date <= $${p.length + 1}`; p.push(to); }
    const r = await pool.query(
      `SELECT c.type, c.code, c.name, COALESCE(SUM(l.credit - l.debit),0)::bigint AS kredit_bersih,
              COALESCE(SUM(l.debit - l.credit),0)::bigint AS debit_bersih
       FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
       JOIN chart_of_accounts c ON c.code=l.account_code
       WHERE c.type IN ('pendapatan','hpp','beban') ${f}
       GROUP BY c.type, c.code, c.name ORDER BY c.code`, p);
    const rev = r.rows.filter(x => x.type === 'pendapatan').reduce((s, x) => s + Number(x.kredit_bersih), 0);
    const hpp = r.rows.filter(x => x.type === 'hpp').reduce((s, x) => s + Number(x.debit_bersih), 0);
    const beban = r.rows.filter(x => x.type === 'beban').reduce((s, x) => s + Number(x.debit_bersih), 0);
    res.json({ from: from || null, to: to || null, pendapatan: rev, hpp, beban, laba_kotor: rev - hpp, laba_bersih: rev - hpp - beban, detail: r.rows });
  } catch (err) { res.status(500).json({ error: 'Gagal hitung P&L.' }); }
});

// GET /api/accounting/cashflow?from=&to=
router.get('/cashflow', authenticate, requireRole(...FINANCE), async (req, res) => {
  try {
    const { from, to } = req.query;
    const p = []; let f = '';
    if (from) { f += ` AND e.entry_date >= $${p.length + 1}`; p.push(from); }
    if (to) { f += ` AND e.entry_date <= $${p.length + 1}`; p.push(to); }
    const r = await pool.query(
      `SELECT c.code, c.name, COALESCE(SUM(l.debit - l.credit),0)::bigint AS arus
       FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
       JOIN chart_of_accounts c ON c.code=l.account_code
       WHERE c.is_cash = TRUE ${f} GROUP BY c.code, c.name ORDER BY c.code`, p);
    res.json({ accounts: r.rows, net: r.rows.reduce((s, x) => s + Number(x.arus), 0) });
  } catch (err) { res.status(500).json({ error: 'Gagal hitung arus kas.' }); }
});

// GET /api/accounting/balance — Neraca sederhana
router.get('/balance', authenticate, requireRole(...FINANCE), async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.type, c.code, c.name,
              COALESCE(SUM(CASE WHEN c.type IN ('aset','hpp','beban') THEN l.debit - l.credit ELSE l.credit - l.debit END),0)::bigint AS saldo
       FROM chart_of_accounts c LEFT JOIN journal_lines l ON l.account_code=c.code
       LEFT JOIN journal_entries e ON e.id=l.entry_id
       GROUP BY c.type, c.code, c.name ORDER BY c.code`);
    const sum = (t) => r.rows.filter(x => x.type === t).reduce((s, x) => s + Number(x.saldo), 0);
    res.json({ aset: sum('aset'), kewajiban: sum('kewajiban'), ekuitas: sum('ekuitas'), accounts: r.rows });
  } catch (err) { res.status(500).json({ error: 'Gagal hitung neraca.' }); }
});

// GET /api/accounting/periods
router.get('/periods', authenticate, requireRole(...FINANCE), async (_req, res) => {
  const r = await pool.query(`SELECT * FROM fiscal_periods ORDER BY start_date DESC`); res.json(r.rows);
});

// POST /api/accounting/periods/:code/close — UC-504 Period Closing
router.post('/periods/:code/close', authenticate, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(`UPDATE fiscal_periods SET is_closed=TRUE, closed_by=$1, closed_at=NOW() WHERE code=$2 RETURNING *`, [req.user.id, req.params.code]);
    if (!r.rowCount) return res.status(404).json({ error: 'Periode tidak ditemukan.' });
    const eventBus = require('../events/eventBus');
    eventBus.publish('FiscalPeriodClosed', r.rows[0].id, { code: r.rows[0].code });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal tutup periode.' }); }
});

module.exports = router;
