// Service Inventori — UC-403 Auto Decrement (OrderPaid → StockDecremented)
const pool = require('../config/db');
const eventBus = require('../events/eventBus');
const { cacheDel } = require('../config/cache');

async function decrementForOrder(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemsRes = await client.query(
      `SELECT oi.menu_item_id, oi.qty, oi.name FROM order_items oi WHERE oi.order_id = $1`,
      [orderId]
    );
    if (itemsRes.rowCount === 0) { await client.query('ROLLBACK'); return { decremented: [] }; }

    const decremented = [];
    const lowStock = [];

    for (const item of itemsRes.rows) {
      const bomRes = await client.query(
        `SELECT r.ingredient_id, r.qty, i.name, i.stock_qty, i.reorder_level, i.version, i.cost_per_unit
         FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
         WHERE r.menu_item_id = $1 AND r.is_active = TRUE`,
        [item.menu_item_id]
      );
      for (const bom of bomRes.rows) {
        const need = Number(bom.qty) * Number(item.qty);
        // Optimistic locking via version
        const upd = await client.query(
          `UPDATE ingredients SET stock_qty = stock_qty - $1, version = version + 1, updated_at = NOW()
           WHERE id = $2 AND version = $3 AND stock_qty >= $1
           RETURNING stock_qty, reorder_level, name`,
          [need, bom.ingredient_id, bom.version]
        );
        if (upd.rowCount === 0) {
          // Stok tidak cukup — catat flag, lanjutkan item lain
          await client.query(
            `INSERT INTO stock_movements (ingredient_id, type, qty, ref_type, ref_id, note)
             VALUES ($1,'OUT',$2,'order',$3,$4)`,
            [bom.ingredient_id, 0, orderId, `STOK KURANG utk order #${orderId} (${item.name})`]
          );
          lowStock.push({ ingredient_id: bom.ingredient_id, name: bom.name, need, available: Number(bom.stock_qty) });
          continue;
        }
        await client.query(
          `INSERT INTO stock_movements (ingredient_id, type, qty, ref_type, ref_id, note, unit_cost)
           VALUES ($1,'OUT',$2,'order',$3,$4,$5)`,
          [bom.ingredient_id, need, orderId, `Order #${orderId} - ${item.name}`, bom.cost_per_unit || 0]
        );
        decremented.push({ ingredient_id: bom.ingredient_id, qty: need, unit_cost: bom.cost_per_unit || 0 });
        if (Number(upd.rows[0].stock_qty) <= Number(upd.rows[0].reorder_level)) {
          lowStock.push({ ingredient_id: bom.ingredient_id, name: upd.rows[0].name, stock: Number(upd.rows[0].stock_qty) });
        }
      }
    }

    await client.query('COMMIT');

    // Auto-disable menu yang bahannya di bawah reorder (cek cepat)
    if (lowStock.length > 0) {
      await pool.query(`
        UPDATE menu_items m SET is_available = FALSE
        WHERE EXISTS (
          SELECT 1 FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
          WHERE r.menu_item_id = m.id AND i.stock_qty <= i.reorder_level
        ) AND m.is_available = TRUE
      `);
      await cacheDel('menu*');
    }

    const totalCogs = decremented.reduce((s, d) => s + Number(d.qty) * Number(d.unit_cost), 0);

    eventBus.publish('StockDecremented', orderId, { order_id: orderId, lines: decremented, cogs: totalCogs });
    for (const ls of lowStock) {
      eventBus.publish('StockLowAlert', ls.ingredient_id, ls);
    }
    return { decremented, lowStock, cogs: totalCogs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { decrementForOrder };
