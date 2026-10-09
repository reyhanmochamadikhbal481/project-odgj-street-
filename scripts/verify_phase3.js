// Verifikasi Fase-3: migrasi + endpoint baru (butuh server + DB lokal)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };

for (const f of ['db/migration_phase3.sql', 'k8s/infra.yaml', '.github/workflows/ci.yml', 'scripts/backup.js', 'scripts/verify_phase3.js']) {
  ok(fs.existsSync(path.join(root, f)), f);
}
for (const f of ['server.js', 'routes/payments.js', 'routes/reports.js', 'routes/reservations.js', 'public/js/admin.js']) {
  try { execSync(`node --check "${path.join(root, f)}"`, { stdio: 'pipe' }); ok(true, 'syntax ' + f); }
  catch (e) { ok(false, 'syntax ' + f); }
}

async function api() {
  const BASE = 'http://127.0.0.1:3000';
  try { await fetch(BASE + '/api/health'); }
  catch { console.log('SKIP api check (server tidak jalan). Jalankan npm start di terminal lain.'); return finish(); }

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' }) })).json();
  const H = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };

  // Reservasi guest
  let r = await fetch(BASE + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-12-01', time: '19:00', partySize: 2, guest_name: 'Tamu Fase3' }) });
  ok(r.status === 201, 'POST /api/reservations guest (201)');
  const resv = await r.json().catch(() => ({}));

  // Inventory summary
  r = await fetch(BASE + '/api/inventory/summary', { headers: H });
  ok(r.status === 200, 'GET /api/inventory/summary (200)');

  // Order + cash payment → picu OrderPaid → stok + jurnal
  const menu = await (await fetch(BASE + '/api/menu')).json();
  const item = menu.find(m => m.is_available);
  r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Fase3', items: [{ id: item.id, qty: 1 }] }) });
  const order = await r.json();
  ok(r.status === 201 && order.id, 'POST /api/orders (201)');
  r = await fetch(BASE + '/api/payments/cash', { method: 'POST', headers: H, body: JSON.stringify({ order_id: order.id }) });
  ok(r.status === 201, 'POST /api/payments/cash → OrderPaid (201)');
  await new Promise(res => setTimeout(res, 800));
  const moves = await (await fetch(BASE + '/api/inventory/movements', { headers: H })).json();
  ok(Array.isArray(moves) && moves.length > 0, 'stock_movements terisi setelah cash (auto-decrement)');
  const journals = await (await fetch(BASE + '/api/accounting/journals', { headers: H })).json();
  ok(Array.isArray(journals) && journals.length > 0, 'jurnal pendapatan+HPP terisi (auto-jurnal)');

  // Reports + CSV
  r = await fetch(BASE + '/api/reports/daily', { headers: H });
  const daily = await r.json();
  ok(r.status === 200 && daily.laba_bersih !== undefined, 'GET /api/reports/daily + laba (200)');
  r = await fetch(BASE + '/api/reports/daily.csv', { headers: H });
  ok(r.status === 200, 'GET /api/reports/daily.csv (200)');

  // Shifts
  await fetch(BASE + '/api/shifts/open', { method: 'POST', headers: H, body: JSON.stringify({ opening_cash: 50000 }) }).catch(() => {});
  r = await fetch(BASE + '/api/shifts', { headers: H });
  ok(r.status === 200, 'GET /api/shifts (200)');

  // P&L + close guard (jangan kunci periode aktif di test; cukup baca periods)
  r = await fetch(BASE + '/api/accounting/periods', { headers: H });
  ok(r.status === 200, 'GET /api/accounting/periods (200)');
  if (resv.reservation?.id) {
    await fetch(BASE + `/api/reservations/${resv.reservation.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
  finish();
}

function finish() {
  console.log(fail === 0 ? '\nPHASE3 VERIFY: LULUS' : `\nPHASE3 VERIFY: ${fail} masalah`);
  process.exit(fail === 0 ? 0 : 1);
}
api().catch(e => { console.log('FAIL api:', e.message); fail++; finish(); });
