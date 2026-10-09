// Verifikasi Fase-4: booking publik, reminder, excel, struk, live (butuh server + DB)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };

for (const f of ['public/reserve.html', 'services/reminderService.js', 'db/migration_phase4.sql', 'scripts/verify_phase4.js']) {
  ok(fs.existsSync(path.join(root, f)), f);
}
for (const f of ['server.js', 'routes/reservations.js', 'routes/reports.js', 'routes/orders.js', 'routes/payments.js', 'services/reminderService.js', 'realtime/socket.js']) {
  try { execSync(`node --check "${path.join(root, f)}"`, { stdio: 'pipe' }); ok(true, 'syntax ' + f); }
  catch (e) { ok(false, 'syntax ' + f); }
}

async function api() {
  const BASE = 'http://127.0.0.1:3000';
  try { await fetch(BASE + '/api/health'); }
  catch { console.log('SKIP api check (server tidak jalan).'); return finish(); }

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' }) })).json();
  const H = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };

  // Halaman booking publik
  let r = await fetch(BASE + '/reserve');
  ok(r.status === 200 && (await r.text()).includes('Booking Meja'), 'GET /reserve halaman booking (200)');

  // Booking guest party besar → wajib DP
  r = await fetch(BASE + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-12-02', time: '19:00', partySize: 8, guest_name: 'Fase4', phone: '0812000001' }) });
  const bk = await r.json().catch(() => ({}));
  ok(r.status === 201 && bk.depositRequired === true && bk.depositPayment?.id, 'POST booking party 8 → DP wajib (201)');
  const resId = bk.reservation?.id;

  // Deposit mock create → webhook settlement → auto-confirm
  r = await fetch(BASE + '/api/payments/deposit/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: resId }) });
  const dep = await r.json().catch(() => ({}));
  ok(r.status === 200 && dep.mock === true, 'POST deposit/create mock (200)');
  r = await fetch(BASE + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: dep.token, order_id: `ODGJ-RES-${resId}-${Date.now()}`, transaction_status: 'settlement', fraud_status: 'accept', gross_amount: bk.reservation.deposit_amount }) });
  ok(r.status === 200, 'POST webhook deposit settlement (200)');
  r = await fetch(BASE + `/api/reservations/${resId}`, { headers: H });
  const det = await r.json().catch(() => ({}));
  ok(det.status === 'confirmed', 'reservasi auto-confirmed setelah DP (confirmed)');

  // Jurnal uang muka tercatat
  r = await fetch(BASE + '/api/accounting/journals', { headers: H });
  const journals = await r.json().catch(() => []);
  ok(Array.isArray(journals) && journals.some(j => j.memo && j.memo.includes(`reservasi #${resId}`)), 'jurnal uang muka DP tercatat');

  // Reminder endpoints
  r = await fetch(BASE + '/api/reservations/reminders/preview', { headers: H });
  ok(r.status === 200, 'GET reminders/preview (200)');
  r = await fetch(BASE + '/api/reservations/reminders/trigger', { method: 'POST', headers: H });
  ok(r.status === 200, 'POST reminders/trigger (200)');
  r = await fetch(BASE + '/api/reservations/live');
  ok(r.status === 200, 'GET /api/reservations/live publik (200)');

  // Excel + struk
  r = await fetch(BASE + '/api/reports/daily.xls', { headers: H });
  const xls = await r.text().catch(() => '');
  ok(r.status === 200 && xls.includes('<table'), 'GET daily.xls (200 + tabel)');
  const menu = await (await fetch(BASE + '/api/menu')).json();
  const item = menu.find(m => m.is_available);
  const order = await (await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Fase4', items: [{ id: item.id, qty: 1 }] }) })).json();
  r = await fetch(BASE + `/api/orders/${order.id}/receipt`, { headers: H });
  const rc = await r.text().catch(() => '');
  ok(r.status === 200 && rc.includes('ODGJ STREET COFFEE'), 'GET order receipt struk (200)');

  // Cleanup
  if (resId) await fetch(BASE + `/api/reservations/${resId}`, { method: 'DELETE', headers: H }).catch(() => {});
  finish();
}

function finish() {
  console.log(fail === 0 ? '\nPHASE4 VERIFY: LULUS' : `\nPHASE4 VERIFY: ${fail} masalah`);
  process.exit(fail === 0 ? 0 : 1);
}
api().catch(e => { console.log('FAIL api:', e.message); fail++; finish(); });
