const { io } = require('socket.io-client');

const BASE = 'http://127.0.0.1:3000';

async function main() {
  // 1. Login sebagai barista
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' }),
  });
  const login = await loginRes.json();
  const token = login.accessToken;
  console.log('1. LOGIN OK →', login.user.full_name, `(${login.user.role})`);

  // 2. Sambung WebSocket barista SEBELUM ada order baru
  const events = [];
  const socket = io(BASE, { transports: ['websocket'] });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout connect')), 5000);
    socket.on('connect', () => {
      socket.emit('auth', token);
      clearTimeout(t);
      resolve();
    });
  });
  console.log('2. WEBSOCKET CONNECTED');

  socket.on('auth:success', (d) => events.push(`auth:success role=${d.role}`));
  socket.on('order:new', (o) => events.push(`order:new #${o.queue_number} ${o.customer_name}`));
  socket.on('order:status', (o) => events.push(`order:status #${o.id} → ${o.status}`));
  socket.on('order:ready', (o) => events.push(`order:ready #${o.id}`));
  socket.on('queue:update', (d) => events.push(`queue:update status=${d.status || d.type}`));

  // 3. Customer buat pesanan (publik, tanpa auth) → harus memicu order:new
  const menuRes = await fetch(`${BASE}/api/menu`);
  const menu = await menuRes.json();
  const item = menu.find((m) => m.is_available);
  const orderRes = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Realtime Test',
      notes: 'test WS',
      items: [{ id: item.id, qty: 2, options: 'Gula sedikit · Es normal' }],
    }),
  });
  const order = await orderRes.json();
  console.log('3. ORDER CREATED →', `#${order.queue_number}`, order.status, `Rp${order.total}`);

  // 4. Live-queue publik (tanpa auth) — harus bisa diakses customer
  const lqRes = await fetch(`${BASE}/api/orders/live-queue`);
  const lq = await lqRes.json();
  console.log('4. PUBLIC LIVE-QUEUE →', `${lq.length} order aktif`);

  // 5. Protected endpoint harus 401 tanpa token
  const noAuth = await fetch(`${BASE}/api/orders`);
  console.log('5. PROTECTION → GET /api/orders tanpa token =', noAuth.status, '(harus 401)');

  // 6. Barista ubah status → harus memicu event realtime
  const patchRes = await fetch(`${BASE}/api/orders/${order.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'diproses' }),
  });
  const patched = await patchRes.json();
  console.log('6. PATCH STATUS →', patched.status);

  const patch2 = await fetch(`${BASE}/api/orders/${order.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'siap' }),
  });
  console.log('7. PATCH STATUS →', (await patch2.json()).status);

  await new Promise((r) => setTimeout(r, 900));

  console.log('\n=== EVENTS YANG DITERIMA WEBSOCKET ===');
  events.forEach((e) => console.log('  •', e));

  const ok =
    events.some((e) => e.startsWith('order:new')) &&
    events.some((e) => e.includes('diproses')) &&
    events.some((e) => e.includes('order:ready'));
  console.log('\nREALTIME BERJALAN?', ok ? 'YA ✅' : 'BELUM ❌');

  socket.disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('TEST GAGAL:', e.message);
  process.exit(1);
});
