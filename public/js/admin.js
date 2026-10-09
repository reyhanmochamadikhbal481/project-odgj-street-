/* ============================================================
   ODGJ STREET COFFEE — admin.js (Dashboard Admin Multi-View)
   Realtime via Socket.io + REST fallback
   Views: Orders, Reservations, Payments, Menu, Reports, Users
   ============================================================ */

const fmtRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const fmtQueue = (n) => '#' + String(n).padStart(2, '0');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

const STATUS_LABEL = { baru: 'Baru', diproses: 'Diproses', siap: 'Siap', selesai: 'Selesai' };
const STATUS_ORDER = ['baru', 'diproses', 'siap', 'selesai'];
const RES_STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', paid: 'Paid', seated: 'Seated', cancelled: 'Cancelled', no_show: 'No-show' };
const DOW_LABEL = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const PAY_STATUS_LABEL = { pending: 'Pending', settlement: 'Settlement', expire: 'Expired', cancel: 'Cancelled', deny: 'Denied' };
const ALLOWED_ROLES = ['owner', 'manager', 'barista', 'cashier'];

let currentView = 'orders';
let orders = [];
let reservations = [];
let payments = [];
let menuItems = [];
let users = [];
let categories = [];
let socket = null;
let authToken = null;
let currentUser = null;
const API_BASE = '/api';

// ===== Safe fetch =====
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text.substring(0, 200) || res.statusText || 'Unknown error' }; }
  return { ok: res.ok, status: res.status, data };
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function setLiveState(online) {
  const dot = document.getElementById('liveDot');
  if (!dot) return;
  dot.textContent = online ? '● ONLINE (WS)' : '● OFFLINE';
  dot.classList.toggle('off', !online);
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminApp').style.display = 'none';
}

function hideLogin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
}

function isJWT(t) { return typeof t === 'string' && t.split('.').length === 3; }

// ===== Login =====
async function login(email, password) {
  const { ok, data } = await apiFetch(`${API_BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) });
  if (!ok) throw new Error(data.error || 'Login gagal');
  if (!data.accessToken) throw new Error('Token tidak diterima');
  if (!data.user || !ALLOWED_ROLES.includes(data.user.role)) throw new Error('Role tidak diizinkan');
  authToken = data.accessToken;
  currentUser = data.user;
  localStorage.setItem('admin_token', authToken);
  localStorage.setItem('admin_user', JSON.stringify(data.user));
  document.getElementById('userInfo').textContent = `${data.user.full_name} (${data.user.role})`;
  updateNavVisibility();
  return data.user;
}

async function checkAuth() {
  const stored = localStorage.getItem('admin_token');
  if (!stored || !isJWT(stored)) { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); authToken = null; return false; }
  authToken = stored;
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && data.user && ALLOWED_ROLES.includes(data.user.role)) {
      currentUser = data.user;
      document.getElementById('userInfo').textContent = `${data.user.full_name} (${data.user.role})`;
      updateNavVisibility();
      return true;
    }
  } catch (_) {}
  authToken = null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  return false;
}

function logout() {
  apiFetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  authToken = null; currentUser = null;
  localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user');
  if (socket) { socket.disconnect(); socket = null; }
  showLogin();
}

function updateNavVisibility() {
  const isOwnerManager = currentUser && ['owner', 'manager'].includes(currentUser.role);
  document.getElementById('menuNav').style.display = isOwnerManager ? 'flex' : 'none';
  document.getElementById('usersNav').style.display = currentUser && currentUser.role === 'owner' ? 'flex' : 'none';
}

// ===== Sidebar Navigation =====
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.a-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.a-sidebar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelector('.a-sidebar-btn[data-view="' + view + '"]').classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  loadViewData(view);
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

// ===== Load View Data =====
async function loadViewData(view) {
  switch (view) {
    case 'orders': await loadOrders(); break;
    case 'reservations': await loadReservations(); break;
    case 'payments': await loadPayments(); break;
    case 'menu': await loadMenuAdmin(); break;
    case 'inventory': await loadInventory(); break;
    case 'accounting': await loadAccounting(); break;
    case 'shifts': await loadShifts(); break;
    case 'tables': await loadTables(); break;
    case 'slots': await loadSlots(); break;
    case 'reports': await loadReports(); break;
    case 'users': await loadUsers(); break;
  }
}

async function loadOrders() {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/orders`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { orders = data; renderOrders(); setLiveState(true); }
    else { setLiveState(false); if (data.error?.includes('Forbidden')) { alert('Sesi berakhir'); logout(); } }
  } catch (_) { setLiveState(false); }
}

async function loadReservations() {
  const status = document.getElementById('resStatusFilter')?.value || '';
  const date = document.getElementById('resDateFilter')?.value || '';
  const search = document.getElementById('resSearch')?.value.trim() || '';
  let url = `${API_BASE}/reservations`;
  const params = [];
  if (status) params.push('status=' + encodeURIComponent(status));
  if (date) params.push('date=' + encodeURIComponent(date));
  if (search) params.push('search=' + encodeURIComponent(search));
  if (params.length) url += '?' + params.join('&');
  try {
    const { ok, data } = await apiFetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { reservations = data; renderReservations(); }
    else if (data.error?.includes('Forbidden')) { alert('Sesi berakhir'); logout(); }
  } catch (_) {}
}

async function loadPayments() {
  const status = document.getElementById('payStatusFilter')?.value || '';
  let url = `${API_BASE}/payments`;
  if (status) url += '?status=' + encodeURIComponent(status);
  try {
    const { ok, data } = await apiFetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { payments = data; renderPayments(); }
    else if (data.error?.includes('Forbidden')) { alert('Sesi berakhir'); logout(); }
  } catch (_) {}
}

async function loadMenuAdmin() {
  try {
    const [{ ok: ok1, data: catData }, { ok: ok2, data: menuData }] = await Promise.all([
      apiFetch(`${API_BASE}/menu/categories`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${API_BASE}/menu`, { headers: { Authorization: `Bearer ${authToken}` } })
    ]);
    if (ok1) categories = catData;
    if (ok2) { menuItems = menuData; renderMenuAdmin(); }
  } catch (_) {}
}

async function loadReports() {
  const date = document.getElementById('reportDate')?.value || new Date().toISOString().split('T')[0];
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reports/daily?date=${date}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok) { renderReports(data); }
    else if (data.error?.includes('Forbidden')) { alert('Sesi berakhir'); logout(); }
  } catch (_) {}
}

async function loadUsers() {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/auth/users`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { users = data; renderUsers(); }
    else if (data.error?.includes('Forbidden')) { alert('Sesi berakhir'); logout(); }
  } catch (_) {}
}

let tables = [];
async function loadTables() {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/tables`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { tables = data; renderTables(); }
  } catch (_) {}
}

function renderTables() {
  const board = document.getElementById('tablesBoard'); if (!board) return;
  if (tables.length === 0) { board.innerHTML = '<div class="a-empty">Belum ada meja. Tambah meja pertama!</div>'; return; }
  board.innerHTML = tables.map(t => `<div class="a-card"><div><div class="a-qnum">${t.name}</div><span class="a-id">#${t.id}</span></div><div class="a-info"><h3>${t.name} <span class="a-st">${t.is_active ? 'Aktif' : 'Nonaktif'}</span></h3><div class="a-meta">Kapasitas: ${t.capacity} orang · ${t.location || '—'}</div></div><div class="a-actions" data-id="${t.id}"><button class="a-btn edit" data-id="${t.id}">Edit</button><button class="a-btn delete" data-id="${t.id}" style="background:#fee;color:#c00;">Hapus</button></div></div>`).join('');
  board.querySelectorAll('.a-btn.edit').forEach(btn => btn.addEventListener('click', () => openTableModal(btn.dataset.id)));
  board.querySelectorAll('.a-btn.delete').forEach(btn => btn.addEventListener('click', async () => { if (confirm('Hapus meja ini?')) await deleteTable(btn.dataset.id); }));
}

function openTableModal(id = null) {
  const modal = document.getElementById('tableModal');
  const form = document.getElementById('tableForm');
  form.reset();
  document.getElementById('tableId').value = id || '';
  document.getElementById('tableModalTitle').textContent = id ? 'Edit Meja' : 'Tambah Meja';
  if (id) {
    const t = tables.find(t => t.id == id);
    if (t) { document.getElementById('tableName').value = t.name; document.getElementById('tableCapacity').value = t.capacity; document.getElementById('tableLocation').value = t.location || ''; document.getElementById('tableActive').checked = t.is_active; }
  }
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
}

async function saveTable(e) {
  e.preventDefault();
  const id = document.getElementById('tableId').value;
  const payload = { name: document.getElementById('tableName').value, capacity: Number(document.getElementById('tableCapacity').value), location: document.getElementById('tableLocation').value, is_active: document.getElementById('tableActive').checked };
  const url = id ? `${API_BASE}/tables/${id}` : `${API_BASE}/tables`;
  const method = id ? 'PATCH' : 'POST';
  try {
    const { ok, data } = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    if (!ok) return alert(data.error || 'Gagal menyimpan');
    document.getElementById('tableModal').classList.remove('open'); loadTables();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteTable(id) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/tables/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal hapus');
    loadTables();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== Render Functions =====
function renderOrders() {
  const stats = document.getElementById('aStats'); const board = document.getElementById('aBoard');
  if (!stats || !board) return;
  const count = (s) => orders.filter(o => o.status === s).length;
  const active = orders.filter(o => o.status !== 'selesai');
  stats.innerHTML = `<div class="a-stat"><b>${count('baru')}</b>Baru</div><div class="a-stat"><b>${count('diproses')}</b>Diproses</div><div class="a-stat"><b>${count('siap')}</b>Siap</div><div class="a-stat"><b>${orders.length}</b>Total</div>`;
  if (active.length === 0) { board.innerHTML = '<div class="a-empty">Belum ada pesanan aktif. Santai dulu, barista. ☕</div>'; return; }
  board.innerHTML = active.map(o => {
    const items = (o.items || []).map(i => `<li><span>${escapeHtml(i.name)} <span class="a-opt">${escapeHtml(i.options || '')}</span></span><b>x${i.qty}</b></li>`).join('');
    return `<div class="a-card st-${o.status}"><div><div class="a-qnum">${fmtQueue(o.queue_number)}</div><span class="a-id">#${o.id}</span></div><div class="a-info"><h3>${escapeHtml(o.customer_name)} <span class="a-st">${STATUS_LABEL[o.status] || o.status}</span></h3><div class="a-meta">${fmtTime(o.created_at)} · ${fmtRp(o.total)}</div><ul class="a-items">${items}</ul>${o.notes ? `<div class="a-note">📝 ${escapeHtml(o.notes)}</div>` : ''}</div><div class="a-actions" data-id="${o.id}">${o.status !== 'diproses' ? `<button class="a-btn diproses" data-st="diproses">▶ Diproses</button>` : ''}${o.status !== 'siap' ? `<button class="a-btn siap" data-st="siap">✔ Siap</button>` : ''}${o.status !== 'selesai' ? `<button class="a-btn selesai" data-st="selesai">✓ Selesai</button>` : ''}</div></div>`;
  }).join('');
  board.querySelectorAll('.a-btn').forEach(btn => btn.addEventListener('click', async () => { await patchStatus(btn.parentElement.dataset.id, btn.dataset.st); }));
}

function renderReservations() {
  const board = document.getElementById('resBoard'); if (!board) return;
  if (reservations.length === 0) { board.innerHTML = '<div class="a-empty">Belum ada reservasi.</div>'; return; }
  board.innerHTML = reservations.map(r => {
    const canCheckin = ['confirmed', 'paid'].includes(r.status);
    const canConfirm = r.status === 'pending';
    const canCancel = !['cancelled', 'no_show', 'seated'].includes(r.status);
    const dpBadge = (r.deposit_amount > 0) ? `DP ${fmtRp(r.deposit_amount)} (${r.payment_status || 'pending'})` : 'Tanpa DP';
    const tbl = r.table_id ? `Meja #${r.table_id}` : 'Tanpa meja';
    const ph = r.guest_phone ? ` · ${escapeHtml(r.guest_phone)}` : '';
    return `<div class="a-card st-${r.status}"><div><div class="a-qnum">${escapeHtml(r.booking_code)}</div><span class="a-id">#${r.id}</span></div><div class="a-info"><h3>${escapeHtml(r.customer_name || '—')} <span class="a-st">${RES_STATUS_LABEL[r.status] || r.status}</span></h3><div class="a-meta">${fmtDate(r.reservation_date)} · ${String(r.reservation_time).slice(0,5)} · ${r.party_size} orang · ${tbl}${ph}</div><div class="a-meta">Est. ${fmtRp(r.estimated_total)} · ${dpBadge}</div>${r.notes ? `<div class="a-note">📝 ${escapeHtml(r.notes)}</div>` : ''}</div><div class="a-actions" data-id="${r.id}">${canConfirm ? `<button class="a-btn confirm" data-id="${r.id}">✔ Konfirmasi</button>` : ''}${canCheckin ? `<button class="a-btn checkin" data-id="${r.id}">✓ Check-in</button>` : ''}<button class="a-btn detail" data-id="${r.id}">Detail</button>${canCancel ? `<button class="a-btn cancel" data-id="${r.id}" style="background:#fee;color:#c00;">Batal</button>` : ''}</div></div>`;
  }).join('');
  board.querySelectorAll('.a-btn.checkin').forEach(btn => btn.addEventListener('click', async () => { await checkinReservation(btn.dataset.id); }));
  board.querySelectorAll('.a-btn.detail').forEach(btn => btn.addEventListener('click', async () => { await showReservationDetail(btn.dataset.id); }));
  board.querySelectorAll('.a-btn.confirm').forEach(btn => btn.addEventListener('click', async () => { await patchReservation(btn.dataset.id, { status: 'confirmed' }); }));
  board.querySelectorAll('.a-btn.cancel').forEach(btn => btn.addEventListener('click', async () => { if (confirm('Batalkan reservasi ini?')) await patchReservation(btn.dataset.id, { status: 'cancelled' }); }));
}

function renderPayments() {
  const board = document.getElementById('payBoard'); if (!board) return;
  if (payments.length === 0) { board.innerHTML = '<div class="a-empty">Belum ada pembayaran.</div>'; return; }
  board.innerHTML = payments.map(p => `<div class="a-card"><div><div class="a-qnum">${p.gateway_ref || '—'}</div><span class="a-id">#${p.id}</span></div><div class="a-info"><h3>Order #${p.order_id} <span class="a-st">${PAY_STATUS_LABEL[p.status] || p.status}</span></h3><div class="a-meta">${fmtTime(p.created_at)} · ${fmtRp(p.amount)}</div><div class="a-meta">Metode: ${p.method} · Gateway: ${p.gateway}</div></div></div>`).join('');
}

function renderMenuAdmin() {
  const board = document.getElementById('menuBoard'); if (!board) return;
  const catMap = new Map(categories.map(c => [c.id, c.name]));
  board.innerHTML = menuItems.map(m => `<div class="a-card"><div><div class="a-qnum">${m.emoji || '☕'}</div><span class="a-id">#${m.id}</span></div><div class="a-info"><h3>${escapeHtml(m.name)} ${m.is_bestseller ? '<span class="a-st best">BEST</span>' : ''} ${!m.is_available ? '<span class="a-st habis">HABIS</span>' : ''}</h3><div class="a-meta">${catMap.get(m.category_id) || '—'} · ${fmtRp(m.price)}</div><div class="a-meta">${escapeHtml(m.description)}</div></div><div class="a-actions" data-id="${m.id}"><button class="a-btn edit" data-id="${m.id}">Edit</button><button class="a-btn delete" data-id="${m.id}" style="background:#fee;color:#c00;">Hapus</button></div></div>`).join('');
  board.querySelectorAll('.a-btn.edit').forEach(btn => btn.addEventListener('click', () => openMenuModal(btn.dataset.id)));
  board.querySelectorAll('.a-btn.delete').forEach(btn => btn.addEventListener('click', async () => { if (confirm('Hapus menu ini?')) await deleteMenu(btn.dataset.id); }));
}

function renderReports(data) {
  const stats = document.getElementById('reportStats'); const board = document.getElementById('reportBoard');
  if (!stats || !board) return;
  stats.innerHTML = `<div class="a-stat"><b>${fmtRp(data.totalSales || 0)}</b>Total Penjualan</div><div class="a-stat"><b>${data.totalOrders || 0}</b>Total Pesanan</div><div class="a-stat"><b>${fmtRp(data.totalQris || 0)}</b>QRIS</div><div class="a-stat"><b>${fmtRp(data.totalCash || 0)}</b>Cash</div><div class="a-stat"><b>${fmtRp(data.hpp || 0)}</b>HPP</div><div class="a-stat"><b>${fmtRp(data.laba_bersih || 0)}</b>Laba Bersih</div>`;
  if (!data.orders || data.orders.length === 0) { board.innerHTML = '<div class="a-empty">Tidak ada data.</div>'; return; }
  board.innerHTML = data.orders.map(o => `<div class="a-card"><div><div class="a-qnum">${fmtQueue(o.queue_number)}</div><span class="a-id">#${o.id}</span></div><div class="a-info"><h3>${escapeHtml(o.customer_name)} <span class="a-st">${STATUS_LABEL[o.status] || o.status}</span></h3><div class="a-meta">${fmtTime(o.created_at)} · ${fmtRp(o.total)}</div></div></div>`).join('');
}

function renderUsers() {
  const board = document.getElementById('usersBoard'); if (!board) return;
  if (users.length === 0) { board.innerHTML = '<div class="a-empty">Belum ada pengguna.</div>'; return; }
  board.innerHTML = users.map(u => `<div class="a-card"><div><span class="a-id">#${u.id}</span></div><div class="a-info"><h3>${escapeHtml(u.full_name)} <span class="a-st">${u.role}</span></h3><div class="a-meta">${u.email} · ${u.is_active ? 'Aktif' : 'Nonaktif'}</div><div class="a-meta">Dibuat: ${fmtDate(u.created_at)}</div></div><div class="a-actions" data-id="${u.id}"><button class="a-btn edit" data-id="${u.id}">Edit</button><button class="a-btn delete" data-id="${u.id}" style="background:#fee;color:#c00;">Hapus</button></div></div>`).join('');
  board.querySelectorAll('.a-btn.edit').forEach(btn => btn.addEventListener('click', () => openUserModal(btn.dataset.id)));
  board.querySelectorAll('.a-btn.delete').forEach(btn => btn.addEventListener('click', async () => { if (confirm('Hapus user ini?')) await deleteUser(btn.dataset.id); }));
}

// ===== Order Status Patch =====
async function patchStatus(id, status) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status }) });
    if (!ok) { alert(data.error || 'Gagal'); if (data.error?.toLowerCase().includes('unauthorized')) logout(); }
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== Reservation Check-in =====
async function checkinReservation(id) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/${id}/checkin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` } });
    if (!ok) alert(data.error || 'Gagal check-in'); else { alert(`Check-in berhasil! Meja ${data.table_name || '#' + data.table_id}`); loadReservations(); }
  } catch (err) { alert('Error: ' + err.message); }
}

async function patchReservation(id, body) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(body) });
    if (!ok) return alert(data.error || 'Gagal mengubah reservasi');
    loadReservations();
  } catch (err) { alert('Error: ' + err.message); }
}

function waNumber(raw) {
  let p = String(raw || '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '62' + p.slice(1);
  return p;
}

let resModalId = null;
async function showReservationDetail(id) {
  const modal = document.getElementById('resModal');
  const body = document.getElementById('resModalBody');
  resModalId = id;
  body.innerHTML = '<div class="a-empty">Memuat…</div>';
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) { body.innerHTML = '<div class="a-empty">' + escapeHtml(data.error || 'Gagal memuat detail') + '</div>'; return; }
    const po = (data.pre_order_items || []).filter(x => x.item_name);
    const poHtml = po.length
      ? '<ul class="a-items">' + po.map(x => `<li><span>${escapeHtml(x.item_name)}</span><b>x${x.qty} · ${fmtRp(x.unit_price)}</b></li>`).join('') + '</ul>'
      : '<div class="a-meta">Tidak ada pre-order.</div>';
    const wa = data.phone ? `https://wa.me/${waNumber(data.phone)}?text=` + encodeURIComponent(`Halo ${data.customer_name}! Reservasi ODGJ ${data.booking_code} (${fmtDate(data.reservation_date)} ${String(data.reservation_time).slice(0,5)}, ${data.party_size} orang) status: ${RES_STATUS_LABEL[data.status] || data.status}.`) : null;
    body.innerHTML = `
      <div class="a-meta"><b>${escapeHtml(data.booking_code)}</b> · ${escapeHtml(data.customer_name)} · ${escapeHtml(data.phone || '—')}</div>
      <div class="a-meta">${fmtDate(data.reservation_date)} · ${String(data.reservation_time).slice(0,5)} · ${data.party_size} orang</div>
      <div class="a-meta">Status: <b>${RES_STATUS_LABEL[data.status] || data.status}</b> · Meja: <b>${data.table_name ? escapeHtml(data.table_name) : (data.table_id ? '#' + data.table_id : '—')}</b></div>
      <div class="a-meta">Est. ${fmtRp(data.estimated_total)} · DP ${fmtRp(data.deposit_amount || 0)} (${escapeHtml(data.payment_status || '—')}${data.paid_at ? ' · ' + fmtTime(data.paid_at) : ''})</div>
      ${data.notes ? `<div class="a-note">📝 ${escapeHtml(data.notes)}</div>` : ''}
      <h4 style="margin-top:10px">Pre-order</h4>${poHtml}
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <img src="${API_BASE}/reservations/${data.id}/qr" alt="QR" style="width:120px;height:120px;border-radius:8px;background:#F2E9D8;">
        ${wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener" style="align-self:center;">Chat WA tamu</a>` : ''}
        <a class="btn ghost" href="/checkin?id=${data.id}" target="_blank" rel="noopener" style="align-self:center;">Buka check-in →</a>
      </div>`;
    document.getElementById('resModalTitle').textContent = `Reservasi ${data.booking_code}`;
    // isi dropdown meja
    if (!tables.length) { try { const t = await apiFetch(`${API_BASE}/tables`, { headers: { Authorization: `Bearer ${authToken}` } }); if (t.ok) tables = t.data; } catch (_) {} }
    const sel = document.getElementById('resTableSelect');
    sel.innerHTML = '<option value="">— pilih meja —</option><option value="__none__">Kosongkan meja</option>' +
      tables.filter(t => t.is_active).map(t => `<option value="${t.id}"${String(t.id) === String(data.table_id) ? ' selected' : ''}>${escapeHtml(t.name)} (kap ${t.capacity})</option>`).join('');
  } catch (err) { body.innerHTML = '<div class="a-empty">Error: ' + escapeHtml(err.message) + '</div>'; }
}

async function resModalPatch(body) {
  if (!resModalId) return;
  await patchReservation(resModalId, body);
  await showReservationDetail(resModalId);
}

async function resModalAssign() {
  if (!resModalId) return;
  const v = document.getElementById('resTableSelect').value;
  if (!v) return alert('Pilih meja dulu.');
  await patchReservation(resModalId, { table_id: v === '__none__' ? null : Number(v) });
  await showReservationDetail(resModalId);
}

// ===== Slots (time_slots) =====
let slots = [];
function slotDow() { return Number(document.getElementById('slotDowFilter')?.value || new Date().getDay()); }
async function loadSlots() {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/timeslots?dow=${slotDow()}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (ok && Array.isArray(data)) { slots = data; renderSlots(); }
  } catch (_) {}
}
function renderSlots() {
  const board = document.getElementById('slotsBoard'); if (!board) return;
  if (!slots.length) { board.innerHTML = '<div class="a-empty">Belum ada slot hari ini.</div>'; return; }
  board.innerHTML = slots.map(s => `<div class="a-card${s.is_closed ? ' st-cancelled' : ''}"><div><div class="a-qnum">${String(s.start_ts).slice(0,5)}</div><span class="a-id">#${s.id}</span></div><div class="a-info"><h3>${String(s.start_ts).slice(0,5)} – ${String(s.end_ts).slice(0,5)} ${s.is_closed ? '<span class="a-st">TUTUP</span>' : ''}</h3><div class="a-meta">Kapasitas: ${s.capacity} orang/sesi · ${DOW_LABEL[s.day_of_week]}</div></div><div class="a-actions" data-id="${s.id}"><button class="a-btn edit" data-id="${s.id}">Edit</button><button class="a-btn toggle" data-id="${s.id}">${s.is_closed ? 'Buka' : 'Tutup'}</button><button class="a-btn delete" data-id="${s.id}" style="background:#fee;color:#c00;">Hapus</button></div></div>`).join('');
  board.querySelectorAll('.a-btn.edit').forEach(b => b.addEventListener('click', () => openSlotModal(b.dataset.id)));
  board.querySelectorAll('.a-btn.toggle').forEach(b => b.addEventListener('click', async () => {
    const s = slots.find(x => String(x.id) === String(b.dataset.id));
    const { ok, data } = await apiFetch(`${API_BASE}/timeslots/${b.dataset.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ is_closed: !s.is_closed }) });
    if (!ok) return alert(data.error || 'Gagal');
    loadSlots();
  }));
  board.querySelectorAll('.a-btn.delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus slot ini?')) return;
    const { ok, data } = await apiFetch(`${API_BASE}/timeslots/${b.dataset.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal');
    loadSlots();
  }));
}
function openSlotModal(id = null) {
  const modal = document.getElementById('slotModal');
  document.getElementById('slotForm').reset();
  document.getElementById('slotId').value = id || '';
  document.getElementById('slotModalTitle').textContent = id ? 'Edit Slot' : 'Tambah Slot';
  if (id) {
    const s = slots.find(x => String(x.id) === String(id));
    if (s) {
      document.getElementById('slotDow').value = s.day_of_week;
      document.getElementById('slotStart').value = String(s.start_ts).slice(0,5);
      document.getElementById('slotCap').value = s.capacity;
      document.getElementById('slotClosed').checked = !!s.is_closed;
    }
  } else {
    document.getElementById('slotDow').value = slotDow();
  }
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
}
async function saveSlot(e) {
  e.preventDefault();
  const id = document.getElementById('slotId').value;
  const payload = {
    day_of_week: Number(document.getElementById('slotDow').value),
    start_ts: document.getElementById('slotStart').value,
    capacity: Number(document.getElementById('slotCap').value),
    is_closed: document.getElementById('slotClosed').checked,
  };
  const url = id ? `${API_BASE}/timeslots/${id}` : `${API_BASE}/timeslots`;
  try {
    const { ok, data } = await apiFetch(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    if (!ok) return alert(data.error || 'Gagal menyimpan');
    document.getElementById('slotModal').classList.remove('open');
    document.getElementById('slotDowFilter').value = String(payload.day_of_week);
    loadSlots();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== Reminder modal (preview + trigger + logs) =====
async function openRemindModal() {
  const modal = document.getElementById('remindModal');
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  await loadRemindData();
}
async function loadRemindData() {
  const pv = document.getElementById('remindPreview');
  const lg = document.getElementById('remindLogs');
  pv.innerHTML = '<div class="a-empty">Memuat…</div>';
  lg.innerHTML = '<div class="a-empty">Memuat…</div>';
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/reminders/preview`, { headers: { Authorization: `Bearer ${authToken}` } });
    pv.innerHTML = (ok && data.length)
      ? data.map(r => `<div class="a-card"><div><div class="a-qnum">${escapeHtml(r.booking_code)}</div></div><div class="a-info"><h3>${escapeHtml(r.who)} <span class="a-st">${r.kind}</span></h3><div class="a-meta">${r.party_size} orang · ${escapeHtml(r.phone || 'tanpa no. HP')}</div></div></div>`).join('')
      : '<div class="a-empty">Tidak ada yang jatuh tempo.</div>';
  } catch (_) { pv.innerHTML = '<div class="a-empty">Gagal memuat.</div>'; }
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/reminders/logs`, { headers: { Authorization: `Bearer ${authToken}` } });
    lg.innerHTML = (ok && data.length)
      ? data.slice(0, 20).map(l => `<div class="a-card"><div><div class="a-qnum">${escapeHtml(l.kind)}</div><span class="a-id">#${l.reservation_id}</span></div><div class="a-info"><div class="a-meta">${escapeHtml(l.target || '—')} · <b>${escapeHtml(l.status)}</b> · ${fmtTime(l.created_at)}</div><div class="a-meta">${escapeHtml((l.message || '').slice(0, 120))}</div></div></div>`).join('')
      : '<div class="a-empty">Belum ada log.</div>';
  } catch (_) { lg.innerHTML = '<div class="a-empty">Gagal memuat.</div>'; }
}

// ===== Menu CRUD =====
function openMenuModal(id = null) {
  const modal = document.getElementById('menuModal');
  const form = document.getElementById('menuForm');
  form.reset();
  document.getElementById('menuItemId').value = id || '';
  document.getElementById('menuModalTitle').textContent = id ? 'Edit Menu' : 'Tambah Menu';
  document.getElementById('menuCategory').innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('menuPhotoPreview').innerHTML = '<span style="color:var(--concrete); font-size:13px;">Preview foto muncul di sini</span>';
  if (id) {
    const item = menuItems.find(m => m.id == id);
    if (item) {
      document.getElementById('menuName').value = item.name;
      document.getElementById('menuDesc').value = item.description;
      document.getElementById('menuCategory').value = item.category_id;
      document.getElementById('menuPrice').value = item.price;
      document.getElementById('menuEmoji').value = item.emoji;
      document.getElementById('menuSort').value = item.sort_order;
      document.getElementById('menuAvailable').checked = item.is_available;
      document.getElementById('menuBestseller').checked = item.is_bestseller;
      document.getElementById('menuPhotoUrl').value = item.photo_url || '';
      updatePhotoPreview(item.photo_url);
    }
  }
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
}

function updatePhotoPreview(url) {
  const preview = document.getElementById('menuPhotoPreview');
  if (!url || !url.trim()) {
    preview.innerHTML = '<span style="color:var(--concrete); font-size:13px;">Preview foto muncul di sini</span>';
    return;
  }
  preview.innerHTML = `<img src="${url.trim()}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='';this.alt='Gagal memuat gambar';this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:var(--cone);font-size:13px\\'>❌ Gagal memuat gambar. Cek URL.</span>'">`;
}

async function saveMenu(e) {
  e.preventDefault();
  const id = document.getElementById('menuItemId').value;
  const payload = {
    name: document.getElementById('menuName').value,
    description: document.getElementById('menuDesc').value,
    category_id: Number(document.getElementById('menuCategory').value),
    price: Number(document.getElementById('menuPrice').value),
    emoji: document.getElementById('menuEmoji').value || '☕',
    photo_url: document.getElementById('menuPhotoUrl').value.trim() || null,
    sort_order: Number(document.getElementById('menuSort').value),
    is_available: document.getElementById('menuAvailable').checked,
    is_bestseller: document.getElementById('menuBestseller').checked
  };
  const url = id ? `${API_BASE}/menu/${id}` : `${API_BASE}/menu`;
  const method = id ? 'PATCH' : 'POST';
  try {
    const { ok, data } = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    if (!ok) return alert(data.error || 'Gagal menyimpan');
    document.getElementById('menuModal').classList.remove('open'); loadMenuAdmin();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteMenu(id) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/menu/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal hapus');
    loadMenuAdmin();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== User CRUD =====
function openUserModal(id = null) {
  const modal = document.getElementById('userModal');
  const form = document.getElementById('userForm');
  form.reset();
  document.getElementById('userId').value = id || '';
  document.getElementById('userModalTitle').textContent = id ? 'Edit User' : 'Tambah User';
  document.getElementById('userPassword').required = !id;
  if (id) {
    const user = users.find(u => u.id == id);
    if (user) { document.getElementById('userFullName').value = user.full_name; document.getElementById('userEmail').value = user.email; document.getElementById('userRole').value = user.role; document.getElementById('userActive').checked = user.is_active; document.getElementById('userPassword').value = ''; document.getElementById('userPassword').required = false; }
  }
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
}

async function saveUser(e) {
  e.preventDefault();
  const id = document.getElementById('userId').value;
  const payload = { full_name: document.getElementById('userFullName').value, email: document.getElementById('userEmail').value, role: document.getElementById('userRole').value, is_active: document.getElementById('userActive').checked };
  const pwd = document.getElementById('userPassword').value;
  if (pwd) payload.password = pwd;
  const url = id ? `${API_BASE}/auth/users/${id}` : `${API_BASE}/auth/register`;
  const method = id ? 'PATCH' : 'POST';
  try {
    const { ok, data } = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(payload) });
    if (!ok) return alert(data.error || 'Gagal menyimpan');
    document.getElementById('userModal').classList.remove('open'); loadUsers();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteUser(id) {
  if (id == currentUser?.id) return alert('Tidak bisa hapus diri sendiri');
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/auth/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal hapus');
    loadUsers();
  } catch (err) { alert('Error: ' + err.message); }
}

// ===== Inventory (UC-401..405) =====
let invSummary = null;
async function loadInventory() {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/inventory/summary`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return;
    invSummary = data;
    const stats = document.getElementById('invStats');
    if (stats) stats.innerHTML = `<div class="a-stat"><b>${data.total_sku}</b>SKU</div><div class="a-stat"><b>${fmtRp(data.stock_value)}</b>Nilai Stok</div><div class="a-stat"><b>${data.low_stock.length}</b>Low Stock</div>`;
    const board = document.getElementById('invBoard');
    if (board) {
      const { ok: ok2, data: ings } = await apiFetch(`${API_BASE}/inventory/ingredients`, { headers: { Authorization: `Bearer ${authToken}` } });
      const list = ok2 ? ings : [];
      board.innerHTML = list.map(g => `<div class="a-card"><div><div class="a-qnum">${escapeHtml(g.unit)}</div><span class="a-id">${escapeHtml(g.code)}</span></div><div class="a-info"><h3>${escapeHtml(g.name)} ${Number(g.stock_qty) <= Number(g.reorder_level) ? '<span class="a-st habis">LOW</span>' : ''}</h3><div class="a-meta">Stok: ${g.stock_qty} · Reorder: ${g.reorder_level} · @${fmtRp(g.cost_per_unit)}</div></div><div class="a-actions"><button class="a-btn" onclick="adjustStock(${g.id})">Adjust</button><button class="a-btn" onclick="showBOM(${g.id})">BOM</button></div></div>`).join('') || '<div class="a-empty">Belum ada bahan.</div>';
    }
    const moves = document.getElementById('invMoves');
    if (moves) moves.innerHTML = (data.recent_movements || []).map(m => `<div class="a-card"><div><span class="a-id">#${m.id}</span></div><div class="a-info"><h3>${m.type} ${m.qty}</h3><div class="a-meta">${escapeHtml(m.note || '')} · ${fmtTime(m.created_at)}</div></div></div>`).join('') || '<div class="a-empty">Belum ada mutasi.</div>';
  } catch (_) {}
}

async function adjustStock(id) {
  const qty = prompt('Qty adjust (positif=IN, gunakan tipe di prompt berikut)? Masukkan angka:');
  if (qty === null) return;
  const type = prompt('Tipe: IN / OUT / WASTE / ADJUST', 'IN') || 'IN';
  const note = prompt('Catatan:', 'koreksi manual') || '';
  const { ok, data } = await apiFetch(`${API_BASE}/inventory/adjust`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ ingredient_id: id, qty: Number(qty), type: type.toUpperCase(), note }) });
  if (!ok) return alert(data.error || 'Gagal');
  loadInventory();
}

async function showBOM(menuId) {
  const id = menuId || prompt('Masukkan menu_item id untuk kelola BOM:');
  if (!id) return;
  const { ok, data } = await apiFetch(`${API_BASE}/inventory/recipes?menu_item_id=${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
  if (ok && data.length) alert(data.map(r => `${r.ingredient_name}: ${r.qty} ${r.unit}`).join('\n'));
  document.getElementById('bomMenuId').value = id;
  document.getElementById('bomModal').classList.add('open');
}

async function openPoModal() {
  document.getElementById('poModal').classList.add('open');
  const { ok, data } = await apiFetch(`${API_BASE}/inventory/purchase-orders`, { headers: { Authorization: `Bearer ${authToken}` } });
  document.getElementById('poList').innerHTML = ok && data.length
    ? data.slice(0, 5).map(p => `<div class="a-card"><div><div class="a-qnum">${escapeHtml(p.po_number)}</div><span class="a-id">${p.status}</span></div><div class="a-info"><h3>${fmtRp(p.total)}</h3></div><div class="a-actions">${p.status !== 'received' ? `<button class="a-btn" onclick="receivePo(${p.id})">Terima (GRN)</button>` : ''}</div></div>`).join('')
    : '<div class="a-empty">Belum ada PO.</div>';
}

async function receivePo(id) {
  const { ok, data } = await apiFetch(`${API_BASE}/inventory/purchase-orders/${id}/receive`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
  if (!ok) return alert(data.error || 'Gagal GRN');
  alert('GRN OK: ' + data.message);
  openPoModal(); loadInventory();
}

// ===== Accounting (UC-501..504) =====
async function loadAccounting() {
  try {
    const from = document.getElementById('accFrom')?.value || '';
    const to = document.getElementById('accTo')?.value || '';
    const qs = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join('&');
    const [{ ok: okP, data: pnl }, { ok: okJ, data: journals }] = await Promise.all([
      apiFetch(`${API_BASE}/accounting/pnl${qs ? '?' + qs : ''}`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${API_BASE}/accounting/journals${qs ? '?' + qs : ''}`, { headers: { Authorization: `Bearer ${authToken}` } }),
    ]);
    if (okP) {
      document.getElementById('accStats').innerHTML = `<div class="a-stat"><b>${fmtRp(pnl.pendapatan)}</b>Pendapatan</div><div class="a-stat"><b>${fmtRp(pnl.hpp)}</b>HPP</div><div class="a-stat"><b>${fmtRp(pnl.beban)}</b>Beban</div><div class="a-stat"><b>${fmtRp(pnl.laba_bersih)}</b>Laba Bersih</div>`;
    }
    if (okJ) {
      document.getElementById('accBoard').innerHTML = journals.map(j => `<div class="a-card"><div><div class="a-qnum">${escapeHtml(j.entry_no)}</div><span class="a-id">${j.entry_date?.slice(0, 10)}</span></div><div class="a-info"><h3>${escapeHtml(j.memo)}</h3><div class="a-meta">${(j.lines || []).map(l => `${l.account_code} D${fmtRp(l.debit)}/K${fmtRp(l.credit)}`).join(' · ')}</div></div></div>`).join('') || '<div class="a-empty">Belum ada jurnal.</div>';
    }
  } catch (_) {}
}

// ===== Shifts (UC-204) =====
let shifts = [];
async function loadShifts() {
  try {
    const [{ ok, data }, cur] = await Promise.all([
      apiFetch(`${API_BASE}/shifts`, { headers: { Authorization: `Bearer ${authToken}` } }),
      apiFetch(`${API_BASE}/shifts/current`, { headers: { Authorization: `Bearer ${authToken}` } }),
    ]);
    if (ok) shifts = data;
    const stats = document.getElementById('shiftStats');
    if (stats) stats.innerHTML = `<div class="a-stat"><b>${cur.ok && cur.data ? 'OPEN #' + cur.data.id : 'Tutup'}</b>Status Shift Saya</div><div class="a-stat"><b>${shifts.filter(s => s.status === 'open').length}</b>Open</div>`;
    const board = document.getElementById('shiftBoard');
    if (board) board.innerHTML = shifts.map(s => `<div class="a-card"><div><div class="a-qnum">#${s.id}</div><span class="a-id">${s.status}</span></div><div class="a-info"><h3>${escapeHtml(s.cashier_name || '')}</h3><div class="a-meta">Buka: ${fmtRp(s.opening_cash)} · Expected: ${s.expected_cash != null ? fmtRp(s.expected_cash) : '—'} · Var: ${s.variance != null ? fmtRp(s.variance) : '—'}</div></div><div class="a-actions">${s.status === 'open' ? `<button class="a-btn" onclick="closeShift(${s.id})">Tutup</button><button class="a-btn" onclick="cashIn(${s.id})">+ Cash</button>` : ''}</div></div>`).join('') || '<div class="a-empty">Belum ada shift.</div>';
  } catch (_) {}
}

async function closeShift(id) {
  const closing = prompt('Kas fisik saat tutup (Rp):', '0');
  if (closing === null) return;
  const { ok, data } = await apiFetch(`${API_BASE}/shifts/${id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ closing_cash: Number(closing) }) });
  if (!ok) return alert(data.error || 'Gagal');
  alert(`Expected: ${fmtRp(data.expected_cash)} · Selisih: ${fmtRp(data.variance)}`);
  loadShifts();
}

async function cashIn(id) {
  const amount = prompt('Nominal cash masuk (Rp):', '14000');
  if (!amount) return;
  const { ok, data } = await apiFetch(`${API_BASE}/shifts/${id}/cash`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ amount: Number(amount), method: 'cash' }) });
  if (!ok) return alert(data.error || 'Gagal');
  loadShifts();
}

// ===== Socket.io =====
function initSocket() {
  if (typeof io === 'undefined') { console.warn('[Admin] socket.io client belum termuat'); return; }
  socket = io({ transports: ['websocket', 'polling'], path: '/socket.io' });
  socket.on('connect', () => { console.log('[Admin] Socket connected'); socket.emit('auth', authToken); setLiveState(true); });
  socket.on('auth:success', d => console.log('[Admin] Auth success:', d.role));
  socket.on('disconnect', () => { console.log('[Admin] Socket disconnected'); setLiveState(false); });
  socket.on('order:new', order => { if (!orders.find(o => o.id === order.id)) { orders.unshift({ ...order, items: order.items || [] }); if (currentView === 'orders') renderOrders(); } });
  socket.on('order:status', ({ id, queue_number, status }) => { const idx = orders.findIndex(o => o.id === id); if (idx >= 0) { orders[idx].status = status; orders[idx].queue_number = queue_number; orders.sort((a, b) => { const ai = STATUS_ORDER.indexOf(a.status), bi = STATUS_ORDER.indexOf(b.status); if (ai !== bi) return ai - bi; return new Date(b.created_at) - new Date(a.created_at); }); if (currentView === 'orders') renderOrders(); } });
  socket.on('queue:update', () => { if (currentView === 'orders') loadOrders(); });
  socket.on('reservation:new', () => { if (currentView === 'reservations') loadReservations(); });
  socket.on('reservation:updated', () => { if (currentView === 'reservations') loadReservations(); });
  socket.on('reservation:seated', () => { if (currentView === 'reservations') loadReservations(); });
  socket.on('reminder:sent', (p) => { showToast('🔔 Reminder terkirim: ' + (p?.booking_code || '#' + (p?.reservation_id || ''))); });
  socket.on('catalog:updates', () => { if (currentView === 'menu') loadMenuAdmin(); });
  socket.on('stock:low', (p) => { showToast('⚠️ Stok menipis: ' + (p.name || p.ingredient_id)); if (currentView === 'inventory') loadInventory(); });
  socket.on('stock:decremented', () => { if (currentView === 'inventory') loadInventory(); });
  socket.on('journal:posted', () => { if (currentView === 'accounting') loadAccounting(); });
}

// ===== Toast =====
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Login form
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = 'Masuk...';
    try { await login(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); hideLogin(); await loadOrders(); initSocket(); } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Masuk'; }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  // Sidebar
  document.querySelectorAll('.a-sidebar-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);

  // Filters
  document.getElementById('resStatusFilter')?.addEventListener('change', () => loadReservations());
  document.getElementById('resDateFilter')?.addEventListener('change', () => loadReservations());
  document.getElementById('resSearch')?.addEventListener('input', () => { clearTimeout(window.__resSearchT); window.__resSearchT = setTimeout(loadReservations, 400); });
  document.getElementById('payStatusFilter')?.addEventListener('change', () => loadPayments());
  document.getElementById('reportDate')?.addEventListener('change', () => loadReports());

  // Photo URL preview
  document.getElementById('menuPhotoUrl')?.addEventListener('input', (e) => {
    updatePhotoPreview(e.target.value);
  });

  // Menu CRUD
  document.getElementById('addMenuBtn')?.addEventListener('click', () => openMenuModal());
  document.getElementById('menuForm')?.addEventListener('submit', saveMenu);
  document.getElementById('closeMenuModal')?.addEventListener('click', () => document.getElementById('menuModal').classList.remove('open'));
  document.getElementById('cancelMenuBtn')?.addEventListener('click', () => document.getElementById('menuModal').classList.remove('open'));

  // Table CRUD
  document.getElementById('addTableBtn')?.addEventListener('click', () => openTableModal());
  document.getElementById('tableForm')?.addEventListener('submit', saveTable);
  document.getElementById('closeTableModal')?.addEventListener('click', () => document.getElementById('tableModal').classList.remove('open'));
  document.getElementById('cancelTableBtn')?.addEventListener('click', () => document.getElementById('tableModal').classList.remove('open'));

  // User CRUD
  document.getElementById('addUserBtn')?.addEventListener('click', () => openUserModal());
  document.getElementById('userForm')?.addEventListener('submit', saveUser);
  document.getElementById('closeUserModal')?.addEventListener('click', () => document.getElementById('userModal').classList.remove('open'));
  document.getElementById('cancelUserBtn')?.addEventListener('click', () => document.getElementById('userModal').classList.remove('open'));

  // Inventory / Accounting / Shifts
  document.getElementById('addIngredientBtn')?.addEventListener('click', async () => {
    const code = prompt('Kode bahan (cth: GUL-XXX):'); if (!code) return;
    const name = prompt('Nama bahan:'); if (!name) return;
    const unit = prompt('Satuan (pcs/ml/gram):', 'pcs') || 'pcs';
    const cost = Number(prompt('Cost per unit (Rp):', '1000') || 0);
    const stock = Number(prompt('Stok awal:', '0') || 0);
    const reorder = Number(prompt('Reorder level:', '10') || 0);
    const { ok, data } = await apiFetch(`${API_BASE}/inventory/ingredients`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ code, name, unit, cost_per_unit: cost, stock_qty: stock, reorder_level: reorder }) });
    if (!ok) return alert(data.error || 'Gagal');
    loadInventory();
  });
  document.getElementById('addPoBtn')?.addEventListener('click', openPoModal);
  document.getElementById('closePoModal')?.addEventListener('click', () => document.getElementById('poModal').classList.remove('open'));
  document.getElementById('cancelPoBtn')?.addEventListener('click', () => document.getElementById('poModal').classList.remove('open'));
  document.getElementById('poForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = document.getElementById('poItems').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [ingredient_id, qty, unit_cost] = l.split(':').map(Number);
      return { ingredient_id, qty, unit_cost: unit_cost || 0 };
    });
    const { ok, data } = await apiFetch(`${API_BASE}/inventory/purchase-orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ supplier_id: Number(document.getElementById('poSupplier').value) || null, items, notes: document.getElementById('poNotes').value }) });
    if (!ok) return alert(data.error || 'Gagal');
    document.getElementById('poModal').classList.remove('open'); loadInventory();
  });
  document.getElementById('closeBomModal')?.addEventListener('click', () => document.getElementById('bomModal').classList.remove('open'));
  document.getElementById('cancelBomBtn')?.addEventListener('click', () => document.getElementById('bomModal').classList.remove('open'));
  document.getElementById('bomForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data } = await apiFetch(`${API_BASE}/inventory/recipes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ menu_item_id: Number(document.getElementById('bomMenuId').value), ingredient_id: Number(document.getElementById('bomIngId').value), qty: Number(document.getElementById('bomQty').value), unit: document.getElementById('bomUnit').value }) });
    if (!ok) return alert(data.error || 'Gagal');
    document.getElementById('bomModal').classList.remove('open'); loadInventory();
  });
  document.getElementById('addJournalBtn')?.addEventListener('click', () => document.getElementById('journalModal').classList.add('open'));
  document.getElementById('closeJournalModal')?.addEventListener('click', () => document.getElementById('journalModal').classList.remove('open'));
  document.getElementById('cancelJournalBtn')?.addEventListener('click', () => document.getElementById('journalModal').classList.remove('open'));
  document.getElementById('journalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = document.getElementById('jLines').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [account_code, debit, credit] = l.split(':');
      return { account_code: account_code.trim(), debit: Number(debit) || 0, credit: Number(credit) || 0 };
    });
    const { ok, data } = await apiFetch(`${API_BASE}/accounting/journals`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ memo: document.getElementById('jMemo').value, entry_date: document.getElementById('jDate').value || undefined, lines }) });
    if (!ok) return alert(data.error || 'Gagal');
    document.getElementById('journalModal').classList.remove('open'); loadAccounting();
  });
  document.getElementById('closePeriodBtn')?.addEventListener('click', async () => {
    const code = prompt('Kode periode (YYYY-MM):', new Date().toISOString().slice(0, 7));
    if (!code) return;
    if (!confirm(`Kunci periode ${code}? Tidak bisa backdate setelah ini.`)) return;
    const { ok, data } = await apiFetch(`${API_BASE}/accounting/periods/${code}/close`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal');
    alert('Periode dikunci.');
  });
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    const d = document.getElementById('reportDate')?.value || new Date().toISOString().split('T')[0];
    window.open(`${API_BASE}/reports/daily.csv?date=${d}`, '_blank');
  });
  document.getElementById('exportXlsBtn')?.addEventListener('click', () => {
    const d = document.getElementById('reportDate')?.value || new Date().toISOString().split('T')[0];
    window.open(`${API_BASE}/reports/daily.xls?date=${d}`, '_blank');
  });
  document.getElementById('remindBtn')?.addEventListener('click', openRemindModal);
  document.getElementById('remindLogBtn')?.addEventListener('click', openRemindModal);
  document.getElementById('closeRemindModal')?.addEventListener('click', () => document.getElementById('remindModal').classList.remove('open'));
  document.getElementById('remindRefreshBtn')?.addEventListener('click', loadRemindData);
  document.getElementById('remindTriggerBtn')?.addEventListener('click', async () => {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/reminders/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal');
    alert(`Reminder: terkirim=${data.sent} mock=${data.mock} gagal=${data.failed}`);
    loadRemindData();
  });

  // Reservation modal
  document.getElementById('closeResModal')?.addEventListener('click', () => document.getElementById('resModal').classList.remove('open'));
  document.getElementById('resConfirmBtn')?.addEventListener('click', () => resModalPatch({ status: 'confirmed' }));
  document.getElementById('resCheckinBtn')?.addEventListener('click', async () => { await checkinReservation(resModalId); await showReservationDetail(resModalId); });
  document.getElementById('resNoshowBtn')?.addEventListener('click', () => { if (confirm('Tandai no-show?')) resModalPatch({ status: 'no_show' }); });
  document.getElementById('resCancelBtn')?.addEventListener('click', () => { if (confirm('Batalkan reservasi ini?')) resModalPatch({ status: 'cancelled' }); });
  document.getElementById('resAssignBtn')?.addEventListener('click', resModalAssign);

  // Slots
  document.getElementById('slotDowFilter')?.addEventListener('change', loadSlots);
  document.getElementById('addSlotBtn')?.addEventListener('click', () => openSlotModal());
  document.getElementById('slotForm')?.addEventListener('submit', saveSlot);
  document.getElementById('closeSlotModal')?.addEventListener('click', () => document.getElementById('slotModal').classList.remove('open'));
  document.getElementById('cancelSlotBtn')?.addEventListener('click', () => document.getElementById('slotModal').classList.remove('open'));
  document.getElementById('printReportBtn')?.addEventListener('click', () => window.print());
  document.getElementById('printShiftBtn')?.addEventListener('click', () => window.print());
  document.getElementById('accRefresh')?.addEventListener('click', () => loadAccounting());
  document.getElementById('openShiftBtn')?.addEventListener('click', async () => {
    const opening = prompt('Kas awal shift (Rp):', '100000'); if (opening === null) return;
    const { ok, data } = await apiFetch(`${API_BASE}/shifts/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ opening_cash: Number(opening) }) });
    if (!ok) return alert(data.error || 'Gagal');
    loadShifts();
  });

  // Close modals on Escape
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); document.getElementById('sidebar').classList.remove('open'); } });

  // Set report date to today
  const reportDate = document.getElementById('reportDate'); if (reportDate && !reportDate.value) reportDate.value = new Date().toISOString().split('T')[0];
  // Default slot filter = hari ini
  const slotDow = document.getElementById('slotDowFilter'); if (slotDow) slotDow.value = String(new Date().getDay());

  // Check auth
  const authed = await checkAuth();
  if (authed) { hideLogin(); await loadOrders(); initSocket(); } else { showLogin(); }
});