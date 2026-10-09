// Service Akuntansi — UC-502 Auto Jurnal dari Event (Blueprint Tabel 16.3)
const pool = require('../config/db');
const eventBus = require('../events/eventBus');

function entryNo(prefix = 'JR') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`;
}

async function isPeriodClosed(dateStr) {
  const r = await pool.query(`SELECT is_closed FROM fiscal_periods WHERE $1 BETWEEN start_date AND end_date LIMIT 1`, [dateStr]);
  return r.rows[0]?.is_closed === true;
}

// Post jurnal seimbang (total debit == total kredit), tolak bila periode dikunci
async function postJournal({ memo, ref_type, ref_id, lines, entry_date, created_by = null }) {
  const date = entry_date || new Date().toISOString().split('T')[0];
  if (await isPeriodClosed(date)) throw new Error('Periode fiskal terkunci — gunakan jurnal reversal.');
  const sumD = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const sumC = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (sumD !== sumC || sumD <= 0) throw new Error('Jurnal tidak seimbang.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = await client.query(
      `INSERT INTO journal_entries (entry_no, entry_date, memo, ref_type, ref_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [entryNo(), date, memo.slice(0, 255), ref_type || null, ref_id || null, created_by]
    );
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_lines (entry_id, account_code, debit, credit) VALUES ($1,$2,$3,$4)`,
        [e.rows[0].id, l.account_code, Number(l.debit || 0), Number(l.credit || 0)]
      );
    }
    await client.query('COMMIT');
    eventBus.publish('JournalPosted', e.rows[0].id, { entry: e.rows[0], lines });
    return e.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Mapping event → jurnal
async function postRevenue({ order_id, amount, method }) {
  const debitAcc = method === 'cash' ? '1-1020' : '1-1010';
  return postJournal({
    memo: `Pendapatan order #${order_id} (${method})`,
    ref_type: 'order', ref_id: order_id,
    lines: [
      { account_code: debitAcc, debit: amount, credit: 0 },
      { account_code: '4-1000', debit: 0, credit: amount },
    ],
  });
}

async function postCogs({ order_id, cogs }) {
  if (!cogs || cogs <= 0) return null;
  return postJournal({
    memo: `HPP order #${order_id}`,
    ref_type: 'order_cogs', ref_id: order_id,
    lines: [
      { account_code: '5-1000', debit: cogs, credit: 0 },
      { account_code: '1-1200', debit: 0, credit: cogs },
    ],
  });
}

async function postPurchase({ po_id, total }) {
  return postJournal({
    memo: `Penerimaan PO #${po_id}`,
    ref_type: 'purchase', ref_id: po_id,
    lines: [
      { account_code: '1-1200', debit: total, credit: 0 },
      { account_code: '2-1000', debit: 0, credit: total },
    ],
  });
}

async function postWaste({ ingredient_id, amount, note }) {
  return postJournal({
    memo: `Waste/opname bahan #${ingredient_id}: ${note || ''}`.slice(0, 255),
    ref_type: 'waste', ref_id: ingredient_id,
    lines: [
      { account_code: '6-2100', debit: amount, credit: 0 },
      { account_code: '1-1200', debit: 0, credit: amount },
    ],
  });
}

module.exports = { postJournal, postRevenue, postCogs, postPurchase, postWaste, isPeriodClosed };
