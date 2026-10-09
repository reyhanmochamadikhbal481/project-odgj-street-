// Modul 4: Inventori — UC-401..405
const express = require('express');
const pool = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { cacheDel } = require('../config/cache');
const eventBus = require('../events/eventBus');
const accounting = require('../services/accountingService');

const router = express.Router();
const STAFF = ['owner', 'manager', 'barista', 'cashier'];
const MANAGER = ['owner', 'manager'];

// GET /api/inventory/summary — ringkasan stok + low stock
router.get('/summary', authenticate, requireRole(...STAFF), async (_req, res) => {
  try {
    const [total, low, moves] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(stock_qty*cost_per_unit),0)::bigint val FROM ingredients WHERE is_active=TRUE`),
      pool.query(`SELECT * FROM ingredients WHERE stock_qty <= reorder_level AND is_active=TRUE ORDER BY stock_qty ASC`),
      pool.query(`SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 10`),
    ]);
    res.json({ total_sku: total.rows[0].n, stock_value: Number(total.rows[0].val), low_stock: low.rows, recent_movements: moves.rows });
  } catch (err) { res.status(500).json({ error: 'Gagal memuat ringkasan: ' + err.message }); }
});

// GET /api/inventory/ingredients
router.get('/ingredients', authenticate, requireRole(...STAFF), async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM ingredients ORDER BY name`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat bahan.' }); }
});

// POST /api/inventory/ingredients — UC-401
router.post('/ingredients', authenticate, requireRole(...MANAGER), async (req, res) => {
  try {
    const { code, name, unit = 'pcs', cost_per_unit = 0, stock_qty = 0, reorder_level = 0 } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code & name wajib.' });
    const r = await pool.query(
      `INSERT INTO ingredients (code, name, unit, cost_per_unit, stock_qty, reorder_level)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code.toUpperCase(), name, unit, Number(cost_per_unit), Number(stock_qty), Number(reorder_level)]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal tambah bahan: ' + err.message }); }
});

// PATCH /api/inventory/ingredients/:id
router.patch('/ingredients/:id', authenticate, requireRole(...MANAGER), async (req, res) => {
  try {
    const allow = ['name', 'unit', 'cost_per_unit', 'reorder_level', 'is_active'];
    const f = [], v = []; let i = 1;
    for (const k of allow) if (req.body[k] !== undefined) { f.push(`${k} = $${i++}`); v.push(req.body[k]); }
    if (!f.length) return res.status(400).json({ error: 'Tidak ada field.' });
    f.push('updated_at = NOW()'); v.push(req.params.id);
    const r = await pool.query(`UPDATE ingredients SET ${f.join(', ')} WHERE id = $${i} RETURNING *`, v);
    if (!r.rowCount) return res.status(404).json({ error: 'Bahan tidak ditemukan.' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal update bahan.' }); }
});

// GET /api/inventory/recipes?menu_item_id=
router.get('/recipes', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const { menu_item_id } = req.query;
    const q = menu_item_id
      ? pool.query(`SELECT r.*, i.name AS ingredient_name, i.unit AS base_unit, i.stock_qty FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.menu_item_id=$1 ORDER BY i.name`, [menu_item_id])
      : pool.query(`SELECT r.*, i.name AS ingredient_name, m.name AS menu_name FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id JOIN menu_items m ON m.id=r.menu_item_id ORDER BY m.name, i.name LIMIT 200`);
    res.json((await q).rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat resep.' }); }
});

// POST /api/inventory/recipes — UC-402 (upsert BOM line)
router.post('/recipes', authenticate, requireRole(...MANAGER), async (req, res) => {
  try {
    const { menu_item_id, ingredient_id, qty, unit } = req.body;
    if (!menu_item_id || !ingredient_id || !qty) return res.status(400).json({ error: 'menu_item_id, ingredient_id, qty wajib.' });
    const r = await pool.query(
      `INSERT INTO recipes (menu_item_id, ingredient_id, qty, unit)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE SET qty=EXCLUDED.qty, unit=EXCLUDED.unit, is_active=TRUE
       RETURNING *`,
      [menu_item_id, ingredient_id, qty, unit || 'pcs']
    );
    await cacheDel('menu*');
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal simpan resep: ' + err.message }); }
});

// DELETE /api/inventory/recipes/:id
router.delete('/recipes/:id', authenticate, requireRole(...MANAGER), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM recipes WHERE id=$1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Resep tidak ditemukan.' });
    await cacheDel('menu*');
    res.json({ message: 'Resep dihapus' });
  } catch (err) { res.status(500).json({ error: 'Gagal hapus resep.' }); }
});

// GET /api/inventory/movements
router.get('/movements', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sm.*, i.name AS ingredient_name FROM stock_movements sm
       JOIN ingredients i ON i.id=sm.ingredient_id ORDER BY sm.created_at DESC LIMIT 100`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Gagal memuat mutasi.' }); }
});

// POST /api/inventory/adjust — penambahan manual / waste (UC-405 + waste → jurnal)
router.post('/adjust', authenticate, requireRole(...MANAGER), async (req, res) => {
  const client = await pool.connect();
  try {
    const { ingredient_id, qty, type = 'IN', note = '' } = req.body;
    if (!ingredient_id || qty === undefined) return res.status(400).json({ error: 'ingredient_id & qty wajib.' });
    const q = Number(qty);
    await client.query('BEGIN');
    const cur = await client.query(`SELECT stock_qty, cost_per_unit, version FROM ingredients WHERE id=$1`, [ingredient_id]);
    if (!cur.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Bahan tidak ditemukan.' }); }
    const delta = type === 'IN' ? Math.abs(q) : -Math.abs(q);
    await client.query(`UPDATE ingredients SET stock_qty = stock_qty + $1, version = version+1, updated_at=NOW() WHERE id=$2`, [delta, ingredient_id]);
    await client.query(`INSERT INTO stock_movements (ingredient_id, type, qty, note, unit_cost, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ingredient_id, type, Math.abs(q), note.slice(0, 255), cur.rows[0].cost_per_unit, req.user.id]);
    await client.query('COMMIT');
    if (type === 'WASTE' || type === 'ADJUST' && delta < 0) {
      const amount = Math.abs(delta) * Number(cur.rows[0].cost_per_unit);
      if (amount > 0) await accounting.postWaste({ ingredient_id, amount, note: note || 'adjustment' }).catch(() => {});
      eventBus.publish('WasteRecorded', ingredient_id, { ingredient_id, qty: Math.abs(q), amount });
    }
    await cacheDel('menu*');
    res.json({ message: 'Stok disesuaikan', delta });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Gagal adjust: ' + err.message });
  } finally { client.release(); }
});

// ===== PO & GRN (UC-404) =====
router.get('/suppliers', authenticate, requireRole(...STAFF), async (_req, res) => {
  const r = await pool.query(`SELECT * FROM suppliers ORDER BY name`); res.json(r.rows);
});
router.post('/suppliers', authenticate, requireRole(...MANAGER), async (req, res) => {
  const { name, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'nama wajib.' });
  const r = await pool.query(`INSERT INTO suppliers (name, phone, address) VALUES ($1,$2,$3) RETURNING *`, [name, phone || null, address || null]);
  res.status(201).json(r.rows[0]);
});

router.get('/purchase-orders', authenticate, requireRole(...STAFF), async (_req, res) => {
  const r = await pool.query(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id ORDER BY po.created_at DESC LIMIT 50`);
  res.json(r.rows);
});

router.post('/purchase-orders', authenticate, requireRole(...MANAGER), async (req, res) => {
  try {
    const { supplier_id, items = [], notes } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items wajib (ingredient_id, qty, unit_cost).' });
    const po_number = `PO-${Date.now().toString(36).toUpperCase()}`;
    const total = items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_cost || 0), 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const po = (await client.query(`INSERT INTO purchase_orders (po_number, supplier_id, status, total, notes, created_by) VALUES ($1,$2,'draft',$3,$4,$5) RETURNING *`,
        [po_number, supplier_id || null, total, notes || null, req.user.id])).rows[0];
      for (const it of items) {
        await client.query(`INSERT INTO purchase_order_items (po_id, ingredient_id, qty, unit_cost, subtotal) VALUES ($1,$2,$3,$4,$5)`,
          [po.id, it.ingredient_id, it.qty, it.unit_cost || 0, Number(it.qty) * Number(it.unit_cost || 0)]);
      }
      await client.query('COMMIT');
      res.status(201).json(po);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } catch (err) { res.status(500).json({ error: 'Gagal buat PO: ' + err.message }); }
});

// POST /api/inventory/purchase-orders/:id/receive — GRN: stok IN + jurnal pembelian
router.post('/purchase-orders/:id/receive', authenticate, requireRole(...MANAGER), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = (await client.query(`SELECT * FROM purchase_orders WHERE id=$1`, [req.params.id])).rows[0];
    if (!po) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'PO tidak ditemukan.' }); }
    if (po.status === 'received') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'PO sudah diterima.' }); }
    const items = (await client.query(`SELECT * FROM purchase_order_items WHERE po_id=$1`, [po.id])).rows;
    for (const it of items) {
      await client.query(`UPDATE ingredients SET stock_qty = stock_qty + $1, version=version+1, updated_at=NOW() WHERE id=$2`, [it.qty, it.ingredient_id]);
      await client.query(`INSERT INTO stock_movements (ingredient_id, type, qty, ref_type, ref_id, note, unit_cost, created_by) VALUES ($1,'IN',$2,'purchase',$3,$4,$5,$6)`,
        [it.ingredient_id, it.qty, po.id, `GRN ${po.po_number}`, it.unit_cost, req.user.id]);
    }
    await client.query(`UPDATE purchase_orders SET status='received', received_at=NOW() WHERE id=$1`, [po.id]);
    await client.query('COMMIT');
    await accounting.postPurchase({ po_id: po.id, total: po.total }).catch(() => {});
    eventBus.publish('PurchaseReceived', po.id, { po_id: po.id, total: po.total });
    await cacheDel('menu*');
    // re-enable menu yang stoknya pulih
    await pool.query(`UPDATE menu_items m SET is_available=TRUE WHERE NOT EXISTS (SELECT 1 FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.menu_item_id=m.id AND i.stock_qty <= 0) AND m.is_available=FALSE`);
    res.json({ message: 'GRN berhasil, stok + jurnal dicatat', po_id: po.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Gagal GRN: ' + err.message });
  } finally { client.release(); }
});

// ===== Stock Opname (UC-405) =====
router.get('/opnames', authenticate, requireRole(...STAFF), async (_req, res) => {
  const r = await pool.query(`SELECT o.*, i.name AS ingredient_name FROM stock_opnames o JOIN ingredients i ON i.id=o.ingredient_id ORDER BY o.created_at DESC LIMIT 50`);
  res.json(r.rows);
});
router.post('/opnames', authenticate, requireRole(...STAFF), async (req, res) => {
  try {
    const { ingredient_id, physical_qty, reason } = req.body;
    const cur = await pool.query(`SELECT stock_qty FROM ingredients WHERE id=$1`, [ingredient_id]);
    if (!cur.rowCount) return res.status(404).json({ error: 'Bahan tidak ditemukan.' });
    const sys = Number(cur.rows[0].stock_qty);
    const r = await pool.query(`INSERT INTO stock_opnames (ingredient_id, physical_qty, system_qty, variance, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ingredient_id, physical_qty, sys, Number(physical_qty) - sys, reason || null, req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Gagal opname: ' + err.message }); }
});
router.post('/opnames/:id/approve', authenticate, requireRole(...MANAGER), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const op = (await client.query(`SELECT * FROM stock_opnames WHERE id=$1`, [req.params.id])).rows[0];
    if (!op) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Opname tidak ditemukan.' }); }
    if (op.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Sudah diproses.' }); }
    await client.query(`UPDATE ingredients SET stock_qty=$1, version=version+1, updated_at=NOW() WHERE id=$2`, [op.physical_qty, op.ingredient_id]);
    await client.query(`INSERT INTO stock_movements (ingredient_id, type, qty, ref_type, ref_id, note, created_by) VALUES ($1,'ADJUST',$2,'opname',$3,$4,$5)`,
      [op.ingredient_id, Math.abs(op.variance), op.id, `Opname #${op.id} (${op.reason || '-'})`, req.user.id]);
    await client.query(`UPDATE stock_opnames SET status='approved', approved_by=$1 WHERE id=$2`, [req.user.id, op.id]);
    await client.query('COMMIT');
    res.json({ message: 'Opname disetujui & stok dikoreksi' });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Gagal approve: ' + err.message }); }
  finally { client.release(); }
});

module.exports = router;
