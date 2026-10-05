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
const RES_STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', paid: 'Paid', seated: 'Seated', cancelled: 'Cancelled' };
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

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' })[c]); }

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
    case 'tables': await loadTables(); break;
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
  let url = `${API_BASE}/reservations`;
  const params = [];
  if (status) params.push('status=' + encodeURIComponent(status));
  if (date) params.push('date=' + encodeURIComponent(date));
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
    return `<div class="a-card st-${r.status}"><div><div class="a-qnum">${r.booking_code}</div><span class="a-id">#${r.id}</span></div><div class="a-info"><h3>${escapeHtml(r.customer_name || '—')} <span class="a-st">${RES_STATUS_LABEL[r.status] || r.status}</span></h3><div class="a-meta">${fmtDate(r.reservation_date)} · ${r.reservation_time} · ${r.party_size} orang</div><div class="a-meta">Est. ${fmtRp(r.estimated_total)} · DP: ${fmtRp(r.deposit_amount || 0)}</div>${r.notes ? `<div class="a-note">📝 ${escapeHtml(r.notes)}</div>` : ''}</div><div class="a-actions" data-id="${r.id}">${canCheckin ? `<button class="a-btn checkin" data-id="${r.id}">✓ Check-in</button>` : ''}<button class="a-btn detail" data-id="${r.id}">Detail</button></div></div>`;
  }).join('');
  board.querySelectorAll('.a-btn.checkin').forEach(btn => btn.addEventListener('click', async () => { await checkinReservation(btn.dataset.id); }));
  board.querySelectorAll('.a-btn.detail').forEach(btn => btn.addEventListener('click', async () => { await showReservationDetail(btn.dataset.id); }));
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
  stats.innerHTML = `<div class="a-stat"><b>${fmtRp(data.totalSales || 0)}</b>Total Penjualan</div><div class="a-stat"><b>${data.totalOrders || 0}</b>Total Pesanan</div><div class="a-stat"><b>${data.totalQris || 0}</b>QRIS</div><div class="a-stat"><b>${data.totalCash || 0}</b>Cash</div>`;
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
    if (!ok) alert(data.error || 'Gagal check-in'); else { alert('Check-in berhasil!'); loadReservations(); }
  } catch (err) { alert('Error: ' + err.message); }
}

async function showReservationDetail(id) {
  try {
    const { ok, data } = await apiFetch(`${API_BASE}/reservations/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!ok) return alert(data.error || 'Gagal memuat detail');
    alert(`Booking: ${data.booking_code}\nNama: ${data.customer_name}\nTanggal: ${fmtDate(data.reservation_date)} ${data.reservation_time}\nOrang: ${data.party_size}\nStatus: ${RES_STATUS_LABEL[data.status]}\nEst. Total: ${fmtRp(data.estimated_total)}\nDP: ${fmtRp(data.deposit_amount || 0)}\nDP Status: ${data.payment_status || '—'}\nCatatan: ${data.notes || '—'}`);
  } catch (err) { alert('Error: ' + err.message); }
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
  socket.on('catalog:updates', () => { if (currentView === 'menu') loadMenuAdmin(); });
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

  // Close modals on Escape
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); document.getElementById('sidebar').classList.remove('open'); } });

  // Set report date to today
  const reportDate = document.getElementById('reportDate'); if (reportDate && !reportDate.value) reportDate.value = new Date().toISOString().split('T')[0];

  // Check auth
  const authed = await checkAuth();
  if (authed) { hideLogin(); await loadOrders(); initSocket(); } else { showLogin(); }
});