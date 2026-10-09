// Wiring event lintas modul (Blueprint Bab 17) — dipanggil sekali dari server.js
const eventBus = require('../events/eventBus');

function wireDomainEvents() {
  const inventory = require('./inventoryService');
  const accounting = require('./accountingService');

  // OrderPaid → kurangi stok (UC-403) → jurnal pendapatan + HPP (UC-502)
  eventBus.subscribe('OrderPaid', async (ev) => {
    const { order_id, amount, method } = ev.payload || {};
    if (!order_id) return;
    try {
      const result = await inventory.decrementForOrder(order_id);
      await accounting.postRevenue({ order_id, amount: Number(amount) || 0, method: method || 'qris' });
      if (result && result.cogs > 0) {
        await accounting.postCogs({ order_id, cogs: result.cogs });
      }
    } catch (err) {
      console.error('[wire] OrderPaid handler gagal:', err.message);
    }
  });

  // StockDecremented → sudah di-handle COGS di atas; log saja bila dipublish manual
  eventBus.subscribe('StockDecremented', async (ev) => {
    if (process.env.DEBUG_EVENTS === 'true') console.log('[wire] StockDecremented:', ev.aggregateId);
  });

  // DepositPaid (reservasi) → jurnal uang muka
  eventBus.subscribe('DepositPaid', async (ev) => {
    const { reservation_id, amount } = ev.payload || {};
    try {
      await accounting.postJournal({
        memo: `Uang muka reservasi #${reservation_id}`,
        ref_type: 'deposit', ref_id: reservation_id,
        lines: [
          { account_code: '1-1010', debit: Number(amount) || 0, credit: 0 },
          { account_code: '2-1300', debit: 0, credit: Number(amount) || 0 },
        ],
      });
    } catch (err) {
      console.error('[wire] DepositPaid handler gagal:', err.message);
    }
  });

  console.log('[wire] Domain event subscriptions aktif (OrderPaid→stok+jurnal, DepositPaid→jurnal)');
}

module.exports = { wireDomainEvents };
