const { io } = require('socket.io-client');
const BASE = 'http://127.0.0.1:3000';

const PASS = '✅';
const FAIL = '❌';

async function test(name, fn) {
  try {
    await fn();
    console.log(`${PASS} ${name}`);
    return true;
  } catch (e) {
    console.log(`${FAIL} ${name} — ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  ODGJ STREET COFFEE — VERIFIKASI FITUR YANG SUDAH JALAN          ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  let passed = 0, total = 0;

  // 1. Health check
  total++;
  if (await test('Health check /api/health', async () => {
    const r = await fetch(`${BASE}/api/health`);
    const d = await r.json();
    if (d.status !== 'ok') throw new Error('DB tidak ok');
  })) passed++;

  // 2. Auth: Register (owner already exists, test login)
  total++;
  let token = '';
  if (await test('Auth: Login owner@odgj.com', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' }),
    });
    const d = await r.json();
    if (!d.accessToken) throw new Error('Token tidak ada');
    token = d.accessToken;
  })) passed++;

  // 3. Auth: /me dengan token
  total++;
  if (await test('Auth: GET /api/auth/me dengan Bearer token', async () => {
    const r = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.user.role !== 'owner') throw new Error('Role bukan owner');
  })) passed++;

  // 4. Auth: Refresh token
  total++;
  if (await test('Auth: POST /api/auth/refresh (cookie-based)', async () => {
    // Login first to get cookie
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@odgj.com', password: 'odgj12345' }),
    });
    const cookie = loginRes.headers.get('set-cookie');
    const r = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    const d = await r.json();
    if (!d.accessToken) throw new Error('Refresh gagal');
  })) passed++;

  // 5. Auth: Protected endpoint tanpa token = 401
  total++;
  if (await test('Auth: Proteksi /api/orders (butuh token)', async () => {
    const r = await fetch(`${BASE}/api/orders`);
    if (r.status !== 401) throw new Error(`Status ${r.status}, harap 401`);
  })) passed++;

  // 6. Menu publik (tanpa auth)
  total++;
  if (await test('Menu: GET /api/menu (publik, 14 item)', async () => {
    const r = await fetch(`${BASE}/api/menu`);
    const d = await r.json();
    if (d.length !== 14) throw new Error(`Menu ${d.length}, harap 14`);
  })) passed++;

  // 7. Order publik (customer)
  total++;
  let orderId = 0, queueNum = 0;
  if (await test('Order: POST /api/orders (publik, customer)', async () => {
    const r = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Verif Test',
        notes: 'Gula normal, Es normal',
        items: [{ id: 36, qty: 1, options: 'Gula normal · Es normal' }], // Es Kopi Item (available)
      }),
    });
    const d = await r.json();
    if (!d.id || !d.queue_number) throw new Error('Order tidak lengkap: ' + JSON.stringify(d));
    orderId = d.id; queueNum = d.queue_number;
    if (d.status !== 'baru') throw new Error(`Status ${d.status}, harap baru`);
  })) passed++;

  // 8. Live-queue publik (untuk customer polling)
  total++;
  if (await test('Live-queue: GET /api/orders/live-queue (publik)', async () => {
    const r = await fetch(`${BASE}/api/orders/live-queue`);
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error('Bukan array');
    const found = d.find(o => o.id === orderId);
    if (!found) throw new Error('Order baru tidak muncul di live-queue');
  })) passed++;

  // 9. WebSocket: Connect + Auth barista
  total++;
  let socket;
  if (await test('WS: Koneksi + auth role=owner', async () => {
    socket = io(BASE, { transports: ['websocket'] });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 5000);
      socket.on('connect', () => { socket.emit('auth', token); clearTimeout(t); });
      socket.on('auth:success', (d) => { if (d.role === 'owner') res(); else rej(new Error('role bukan owner')); });
    });
  })) passed++;

  // 10. WebSocket: Terima order:new realtime
  total++;
  if (await test('WS: Event order:new realtime saat order dibuat', async () => {
    let gotNew = false;
    socket.on('order:new', () => { gotNew = true; });
    const r = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'WS Test', notes: '',
        items: [{ id: 31, qty: 1, options: 'Gula normal · Es normal' }], // Kopi Susu Vanila
      }),
    });
    const d = await r.json();
    await new Promise(r => setTimeout(r, 300));
    if (!gotNew) throw new Error('order:new tidak diterima');
  })) passed++;

  // 11. WebSocket: order:status realtime
  total++;
  if (await test('WS: Event order:status realtime saat patch status', async () => {
    let gotStatus = false;
    socket.on('order:status', (o) => { if (o.status === 'diproses') gotStatus = true; });
    const patch = await fetch(`${BASE}/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'diproses' }),
    });
    await new Promise(r => setTimeout(r, 300));
    if (!gotStatus) throw new Error('order:status diproses tidak diterima');
  })) passed++;

  // 12. WebSocket: order:ready realtime
  total++;
  if (await test('WS: Event order:ready realtime saat status=siap', async () => {
    let gotReady = false;
    socket.on('order:ready', () => { gotReady = true; });
    const patch = await fetch(`${BASE}/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'siap' }),
    });
    await new Promise(r => setTimeout(r, 300));
    if (!gotReady) throw new Error('order:ready tidak diterima');
  })) passed++;

  // 13. RBAC: cashier bisa akses orders
  total++;
  if (await test('RBAC: Role cashier diizinkan GET /api/orders', async () => {
    // Buat user cashier
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cashier@test.com', password: 'pass1234', full_name: 'Cashier', role: 'cashier' }),
    });
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cashier@test.com', password: 'pass1234' }),
    });
    const { accessToken } = await login.json();
    const r = await fetch(`${BASE}/api/orders`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status !== 200) throw new Error(`Cashier status ${r.status}, harap 200`);
  })) passed++;

  // 14. RBAC: staff TIDAK bisa akses orders
  total++;
  if (await test('RBAC: Role staff DITOLAK GET /api/orders (403)', async () => {
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@test.com', password: 'pass1234', full_name: 'Staff', role: 'staff' }),
    });
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@test.com', password: 'pass1234' }),
    });
    const { accessToken } = await login.json();
    const r = await fetch(`${BASE}/api/orders`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status !== 403) throw new Error(`Staff status ${r.status}, harap 403`);
  })) passed++;

  // 15. Logout
  total++;
  if (await test('Auth: POST /api/auth/logout', async () => {
    const r = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    if (r.status !== 200) throw new Error('Logout gagal');
  })) passed++;

  socket?.disconnect();

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log(`║  HASIL: ${passed}/${total} TEST LULUS`);
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('');
  if (passed === total) {
    console.log('🎉 SEMUA FITUR UTAMA BERJALAN LANCAR');
  } else {
    console.log(`⚠️  ${total - passed} test gagal — cek log di atas`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
