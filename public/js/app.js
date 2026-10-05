/* ============================================================
   ODGJ STREET COFFEE — app.js
   Frontend memanggil API server (Express + PostgreSQL)
   Fitur: menu dari DB, levelisasi gula/es, live antrean, PWA + Offline Sync
   ============================================================ */

const API = {
  menu: '/api/menu',
  orders: '/api/orders',
  liveQueue: '/api/orders/live-queue',
  health: '/api/health',
};

const WA_NUMBER = '6285770130803';
const CATEGORY_TILE = {
  susu: 'tile--susu',
  item: 'tile--item',
  nonkopi: 'tile--nonkopi',
  camilan: 'tile--camilan',
};

let MENU = [];
let cart = {};          // { [id] : { qty, options } }
let lastOrder = null;
let pendingItem = null; // id menu yang sedang diatur levelnya

const $ = (id) => document.getElementById(id);

// ===== format =====
const fmtRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const fmtQueue = (n) => '#' + String(n).padStart(2, '0');

// ===== IndexedDB untuk offline queue =====
const OFFLINE_DB = 'odgj-offline';
const OFFLINE_STORE = 'pending-orders';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveOrderOffline(payload) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE);
    const request = store.add({
      payload,
      payloadId: 'order_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      createdAt: Date.now(),
      retries: 0
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getOfflineOrders() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removeOfflineOrder(id) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ===== init =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  duplicateTicker();
  $('year').textContent = new Date().getFullYear();

  registerSW();
  initReveal();
  const health = await fetchJSON(API.health);
  loadCart();
  await loadMenu();
  setScanStatus(health);
  initRealtime();
  pollQueue();
  setInterval(pollQueue, 15000);
  
  // Listen for service worker messages
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleSWMessage);
  }
  
  // Cek dan sinkronkan order offline saat online
  window.addEventListener('online', syncOfflineOrders);
  if (navigator.onLine) {
    syncOfflineOrders();
  }
}

function handleSWMessage(event) {
  if (!event.data || !event.data.type) return;
  
  if (event.data.type === 'ORDER_SYNCED') {
    showToast('✅ Pesanan offline terkirim: #' + event.data.serverOrderId);
    // Refresh live queue
    pollQueue();
  } else if (event.data.type === 'ORDER_FAILED') {
    showToast('❌ Pesanan offline gagal: ' + event.data.error);
  }
}

async function syncOfflineOrders() {
  const orders = await getOfflineOrders();
  if (orders.length === 0) return;
  
  showToast('🔄 Menyinkronkan ' + orders.length + ' pesanan offline...');
  
  // Trigger background sync via service worker
  if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
    const registration = await navigator.serviceWorker.ready;
    try {
      await registration.sync.register('sync-orders');
    } catch (err) {
      console.error('Background sync registration failed:', err);
    }
  }
}

function bindEvents() {
  window.addEventListener('scroll', () => {
    document.querySelector('header.nav').classList.toggle('scrolled', window.scrollY > 40);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); closeModal('optionModal'); closeModal('successModal'); closeModal('qrisModal'); }
  });

  $('openCart').addEventListener('click', openDrawer);
  $('closeCart').addEventListener('click', closeDrawer);
  $('overlay').addEventListener('click', closeDrawer);
  $('closeModal').addEventListener('click', () => closeModal('successModal'));
  $('closeOptionModal').addEventListener('click', () => closeModal('optionModal'));
  $('closeQrisModal').addEventListener('click', () => closeModal('qrisModal'));

  $('filters').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    renderMenu();
  });

  $('searchInput').addEventListener('input', renderMenu);
  $('checkoutBtn').addEventListener('click', checkout);
  $('waSendBtn').addEventListener('click', () => {
    if (lastOrder) window.open(waUrl(lastOrder), '_blank');
  });

  // QRIS payment buttons
  $('payQrisBtn').addEventListener('click', () => {
    if (lastOrder) openQrisModal(lastOrder);
  });
  $('cancelQrisBtn').addEventListener('click', () => {
    if (lastOrder) cancelQrisPayment(lastOrder.id, null);
  });

  // pilihan levelisasi
  ['sugarOptions', 'iceOptions'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      e.target.parentElement.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      updateOptionSummary();
    });
  });
  $('confirmOption').addEventListener('click', confirmOption);
}

// ===== util fetch =====
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = 'Terjadi kesalahan.';
    try { msg = (await res.json()).error || msg; } catch (_) { /* kosong */ }
    throw new Error(msg);
  }
  return res.json();
}

// ===== menu dari database =====
async function loadMenu() {
  try {
    MENU = await fetchJSON(API.menu);
    buildFilters();
    renderMenu();
    renderHeroStats();
    renderCart();
  } catch (err) {
    $('menuGrid').innerHTML =
      `<div class="empty-result">Gagal memuat menu dari server.<br>${err.message}</div>`;
  }
}

function buildFilters() {
  const cats = new Map();
  MENU.forEach((m) => {
    if (!cats.has(m.category)) cats.set(m.category, { slug: m.category, name: m.category_name });
  });
  const html = ['<button class="filter-btn active" data-cat="all">Semua</button>']
    .concat([...cats.values()].map((c) => `<button class="filter-btn" data-cat="${c.slug}">${c.name}</button>`))
    .join('');
  $('filters').innerHTML = html;
}

function filteredMenu() {
  const cat = document.querySelector('.filter-btn.active')?.dataset.cat || 'all';
  const q = ($('searchInput').value || '').trim().toLowerCase();
  return MENU.filter((m) => {
    const okCat = cat === 'all' || m.category === cat;
    const okQ = !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
    return okCat && okQ;
  });
}

function renderMenu() {
  const grid = $('menuGrid');
  const list = filteredMenu();
  $('menuIdx').textContent = `${list.length} MENU`;

  if (list.length === 0) {
    grid.innerHTML = '<div class="empty-result">Nggak nemu menu itu. Coba kata kunci lain.</div>';
    return;
  }

  grid.innerHTML = list
    .map((m, i) => {
      const badges =
        (m.is_bestseller ? '<span class="badge badge-best">BEST SELLER</span>' : '') +
        (!m.is_available ? '<span class="badge badge-habis">STOK HABIS</span>' : '');
      const pop = m.order_count >= 3
        ? `<span class="order-count">🔥 diorder <b>${m.order_count}x</b></span>`
        : '';
      // ═══════════════════════════════════════════════════════════════
      // 🖼️  TAMPILKAN FOTO: URL diambil dari database (menu_items.photo_url)
      //     Ubah via Admin Panel atau edit seed.sql
      // ═══════════════════════════════════════════════════════════════
      const photoHtml = m.photo_url
        ? `<img class="photo" src="${escapeHtml(m.photo_url)}" alt="${escapeHtml(m.name)}" loading="lazy">`
        : `<div class="photo" style="display:flex;align-items:center;justify-content:center;background:var(--asphalt);"><span style="font-size:48px;">${m.emoji}</span></div>`;
      return `
      <div class="menu-item ${m.is_available ? '' : 'stok-habis'}" style="animation-delay:${Math.min(i * 45, 400)}ms">
        ${photoHtml}
        <div class="info">
          ${badges}
          <h4>${escapeHtml(m.name)}</h4>
          <p>${escapeHtml(m.description)}</p>
          ${pop}
        </div>
        <div class="price-add">
          <span class="price">${fmtRp(m.price)}</span>
          ${m.is_available
            ? `<button class="add-btn" data-id="${m.id}" data-name="${escapeHtml(m.name)}" aria-label="Tambah ${escapeHtml(m.name)}">+</button>`
            : ''}
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('.add-btn').forEach((btn) =>
    btn.addEventListener('click', () => openOptionModal(Number(btn.dataset.id), btn.dataset.name))
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ===== modal levelisasi gula & es =====
function openOptionModal(id, name) {
  pendingItem = id;
  $('optionTitle').textContent = name;
  $('optionSub').textContent = fmtRp(MENU.find((m) => m.id === id)?.price) + ' · pilih level biar pas sama lidahmu';
  $('sugarOptions').querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
  $('iceOptions').querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
  const saved = cart[id];
  if (saved) {
    const [sugar, ice] = saved.options.split(' · ');
    setOptionActive('sugarOptions', sugar);
    setOptionActive('iceOptions', ice);
  } else {
    $('sugarOptions').querySelector('[data-val="Gula normal"]').classList.add('active');
    $('iceOptions').querySelector('[data-val="Es normal"]').classList.add('active');
  }
  updateOptionSummary();
  $('optionModal').classList.add('open');
  $('optionModal').setAttribute('aria-hidden', 'false');
}

function setOptionActive(groupId, val) {
  const btn = [...$(groupId).querySelectorAll('.opt-btn')].find((b) => b.dataset.val === val);
  if (btn) btn.classList.add('active');
}

function selectedOption(groupId) {
  return $(groupId).querySelector('.opt-btn.active')?.dataset.val || 'Normal';
}

function updateOptionSummary() {
  $('optionSummary').textContent = `${selectedOption('sugarOptions')} · ${selectedOption('iceOptions')}`;
}

function confirmOption() {
  if (!pendingItem) return;
  const options = `${selectedOption('sugarOptions')} · ${selectedOption('iceOptions')}`;
  addToCart(pendingItem, options);
  pendingItem = null;
  closeModal('optionModal');
}

// ===== hero stats (count-up) =====
function renderHeroStats() {
  const tersedia = MENU.filter((m) => m.is_available).length;
  const harga = MENU.length ? Math.min(...MENU.map((m) => m.price)) : 0;
  const stats = [
    { n: MENU.length, label: 'Menu tersedia', fmt: (v) => v },
    { n: tersedia, label: 'Masih ready', fmt: (v) => v },
    { n: harga, label: 'Mulai dari', fmt: (v) => 'Rp' + v.toLocaleString('id-ID') },
  ];
  $('heroStats').innerHTML = stats.map(() => '<div class="hero-stat"><b class="count-up">0</b><span></span></div>').join('');
  document.querySelectorAll('#heroStats .hero-stat').forEach((el, i) => {
    el.querySelector('span').textContent = stats[i].label;
    countUp(el.querySelector('.count-up'), stats[i].n, stats[i].fmt);
  });
}

function countUp(el, target, fmt) {
  const dur = 900;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setScanStatus(health) {
  const target = $('scanCount');
  if (health && health.status === 'ok') {
    const time = new Date(health.db).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    target.textContent = `● ${time}`;
  } else {
    target.textContent = '● OFFLINE';
  }
}

// ===== live antrean (WebSocket + fallback polling ke endpoint publik) =====
let customerSocket = null;

function initRealtime() {
  if (typeof io === 'undefined') return;
  customerSocket = io({ transports: ['websocket', 'polling'], path: '/socket.io' });

  customerSocket.on('connect', () => {
    $('queueLive').textContent = '● LIVE';
    $('queueLive').classList.remove('off');
    if (lastOrder) customerSocket.emit('subscribe:order', lastOrder.id);
  });

  customerSocket.on('disconnect', () => {
    $('queueLive').textContent = '● OFFLINE';
    $('queueLive').classList.add('off');
  });

  // Status pesanan pelanggan ini berubah
  customerSocket.on('order:tracking', ({ status }) => {
    if (lastOrder) {
      lastOrder.status = status;
      paintTracking(status);
    }
  });

  customerSocket.on('order:ready', () => {
    if (lastOrder) {
      lastOrder.status = 'siap';
      paintTracking('siap');
    }
  });

  // Antrean global berubah
  customerSocket.on('queue:update', () => pollQueue());
}

function paintTracking(status) {
  const label = {
    baru: 'Menunggu diproses',
    diproses: 'Sedang diracik barista',
    siap: 'SIAP diambil!',
    selesai: 'Selesai',
  }[status] || status;
  const tiny = $('orderTiny');
  if (tiny) tiny.textContent = `Status: ${label} · pembayaran QRIS / cash di gerobak`;
}

async function pollQueue() {
  try {
    const orders = await fetchJSON(API.liveQueue);
    const latest = orders.filter((o) => o.status === 'diproses').slice(-1)[0] || orders[orders.length - 1];
    $('queueNow').textContent = latest ? fmtQueue(latest.queue_number) : '#—';
    $('queueHint').textContent = latest
      ? `${escapeHtml(latest.customer_name)} — ${latest.items.length} item`
      : 'Antrean kosong, langsung pesan yuk';
    updateTracking(orders);
  } catch (_) {
    $('queueLive').textContent = '● OFFLINE';
    $('queueLive').classList.add('off');
  }
}

// update status pesanan yang baru dibuat (modal sukses) — dari data live-queue
function updateTracking(orders) {
  if (!lastOrder || !Array.isArray(orders)) return;
  const found = orders.find((o) => o.id === lastOrder.id);
  if (found) {
    lastOrder.status = found.status;
    paintTracking(found.status);
  }
}

// ===== cart =====
function cartItems() {
  return Object.entries(cart)
    .map(([id, v]) => ({ item: MENU.find((m) => m.id === Number(id)), qty: v.qty, options: v.options }))
    .filter((x) => x.item);
}

function cartTotal() {
  return cartItems().reduce((sum, x) => sum + x.item.price * x.qty, 0);
}

function cartQty() {
  return cartItems().reduce((sum, x) => sum + x.qty, 0);
}

function addToCart(id, options = 'Gula normal · Es normal') {
  const item = MENU.find((m) => m.id === id);
  if (!item || !item.is_available) return;
  cart[id] = cart[id] || { qty: 0, options };
  cart[id].qty += 1;
  saveCart();
  renderCart();
  const c = $('cartCount');
  c.classList.remove('bump');
  void c.offsetWidth;
  c.classList.add('bump');
  showToast(`${item.emoji} ${item.name} ditambahkan`);
}

function changeQty(id, delta) {
  if (!cart[id]) return;
  cart[id].qty += delta;
  if (cart[id].qty <= 0) delete cart[id];
  saveCart();
  renderCart();
}

function saveCart() {
  localStorage.setItem('odgj_cart', JSON.stringify(cart));
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem('odgj_cart') || '{}') || {};
    // migrasi format lama ({id: jumlah} → {id: {qty, options}})
    cart = Object.fromEntries(Object.entries(raw).map(([id, v]) =>
      typeof v === 'number' ? [id, { qty: v, options: 'Gula normal · Es normal' }] : [id, v]
    ));
  } catch (_) {
    cart = {};
  }
  renderCart();
}

function renderCart() {
  const body = $('cartBody');
  const items = cartItems();

  if (items.length === 0) {
    body.innerHTML = '<p class="empty-cart">Keranjang masih kosong.<br>Tambah menu favoritmu dulu.</p>';
  } else {
    body.innerHTML = items
      .map(
        ({ item, qty, options }) => `
      <div class="cart-row">
        <div>
          <div class="cart-name">${item.emoji} ${escapeHtml(item.name)}</div>
          <div class="cart-sub">${fmtRp(item.price)} × ${qty} = ${fmtRp(item.price * qty)}</div>
          <div class="cart-opt">${escapeHtml(options)}</div>
        </div>
        <div class="qty-ctrl">
          <button onclick="changeQty(${item.id},-1)" aria-label="Kurangi">−</button>
          <span class="qty-num">${qty}</span>
          <button onclick="changeQty(${item.id},1)" aria-label="Tambah">+</button>
        </div>
      </div>`
      )
      .join('');
  }

  $('cartTotal').textContent = fmtRp(cartTotal());
  $('cartCount').textContent = cartQty();
  $('drawerSub').textContent = cartQty() + ' item';
}

// ===== drawer / modal =====
function openDrawer() {
  $('drawer').classList.add('open');
  $('overlay').classList.add('open');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('overlay').classList.remove('open');
}
function closeModal(id) {
  $(id).classList.remove('open');
  $(id).setAttribute('aria-hidden', 'true');
}

// ===== checkout → simpan ke PostgreSQL =====
async function checkout() {
  const items = cartItems();
  if (items.length === 0) {
    showToast('Keranjang masih kosong');
    return;
  }

  const payload = {
    customer_name: $('customerName').value.trim() || 'Pelanggan',
    notes: $('orderNotes').value.trim(),
    items: items.map(({ item, qty, options }) => ({ id: item.id, qty, options })),
  };

  const btn = $('checkoutBtn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan pesanan…';

  try {
    // Coba kirim ke server
    const order = await fetchJSON(API.orders, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    lastOrder = order;
    if (customerSocket) customerSocket.emit('subscribe:order', order.id);
    cart = {};
    saveCart();
    renderCart();
    showOrderModal(order);
  } catch (err) {
    // Jika error network/offline, simpan ke IndexedDB untuk background sync
    if (!navigator.onLine || err.message.includes('offline') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      await saveOrderOffline(payload);
      showToast('📦 Pesanan disimpan offline, akan terkirim saat online');
      
      // Buat order lokal untuk UI
      const localOrder = {
        id: 'offline_' + Date.now(),
        queue_number: 0,
        customer_name: payload.customer_name,
        notes: payload.notes,
        total: cartTotal(),
        status: 'offline',
        created_at: new Date().toISOString(),
        items: items.map(({ item, qty, options }) => ({
          id: item.id,
          name: item.name,
          qty,
          unit_price: item.price,
          subtotal: item.price * qty,
          options
        }))
      };
      
      lastOrder = localOrder;
      cart = {};
      saveCart();
      renderCart();
      showOrderModal(localOrder);
      
      // Register background sync
      if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
        const registration = await navigator.serviceWorker.ready;
        try {
          await registration.sync.register('sync-orders');
        } catch (e) {
          console.log('Background sync not available');
        }
      }
    } else {
      showToast('⚠️ ' + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pesan & Bayar di Gerobak';
  }
}

function showOrderModal(order) {
  const isOffline = order.queue_number === 0 || order.status === 'offline';
  $('queueNumber').textContent = isOffline ? 'OFFLINE' : fmtQueue(order.queue_number);
  $('orderSummary').textContent =
    `${order.items.length} item · ${fmtRp(order.total)} · ${order.customer_name}`;
  $('orderTiny').textContent = isOffline
    ? 'Status: Tersimpan offline · akan dikirim saat online'
    : 'Status: Menunggu diproses · pembayaran QRIS / cash di gerobak';
  
  // Disable QRIS button for offline orders
  const payQrisBtn = $('payQrisBtn');
  if (payQrisBtn) {
    payQrisBtn.disabled = isOffline;
    payQrisBtn.textContent = isOffline ? 'Tersedia saat online' : 'Bayar QRIS';
  }
  
  $('successModal').classList.add('open');
  $('successModal').setAttribute('aria-hidden', 'false');
}

// ===== QRIS Payment =====
let qrisPollTimer = null;
let qrisCountdownTimer = null;

async function openQrisModal(order) {
  closeModal('successModal');
  $('qrisModal').classList.add('open');
  $('qrisModal').setAttribute('aria-hidden', 'false');
  $('qrisCode').innerHTML = '<div class="qris-loading">Memuat QR code...</div>';
  $('qrisStatus').textContent = 'Menghubungkan ke payment gateway...';
  $('qrisTimer').textContent = '⏳ 05:00';

  try {
    const res = await fetchJSON('/api/payments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.id }),
    });

    // res: { token, redirect_url, qr_string, payment_id }
    if (res.qr_string) {
      $('qrisCode').innerHTML = `<img src="${res.qr_string}" alt="QRIS Code">`;
      $('qrisSub').textContent = `Total: ${fmtRp(order.total)} · Scan QR dengan aplikasi e-wallet/banking`;
      $('qrisStatus').textContent = 'Menunggu pembayaran...';
      startQrisCountdown(300, order.id, res.payment_id); // 5 menit
      pollPaymentStatus(order.id, res.payment_id);
    } else {
      throw new Error('QRIS tidak tersedia');
    }
  } catch (err) {
    $('qrisCode').innerHTML = '<div class="qris-error">⚠️ Gagal memuat QRIS</div>';
    $('qrisStatus').textContent = 'Error: ' + err.message;
  }
}

function startQrisCountdown(seconds, orderId, paymentId) {
  let remaining = seconds;
  $('qrisTimer').textContent = `⏳ ${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;

  qrisCountdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(qrisCountdownTimer);
      cancelQrisPayment(orderId, paymentId);
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    $('qrisTimer').textContent = `⏳ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

async function pollPaymentStatus(orderId, paymentId) {
  qrisPollTimer = setInterval(async () => {
    try {
      const res = await fetchJSON(`/api/payments/${orderId}`);
      if (res.status === 'settlement') {
        clearInterval(qrisPollTimer);
        clearInterval(qrisCountdownTimer);
        $('qrisStatus').textContent = '✅ Pembayaran berhasil! Pesanan diproses...';
        $('qrisTimer').textContent = '';
        setTimeout(() => {
          closeModal('qrisModal');
          showToast('Pembayaran QRIS berhasil!');
          // Update order modal status
          if (lastOrder && lastOrder.id === orderId) {
            lastOrder.status = 'baru'; // akan diupdate via WS ke diproses
            paintTracking('baru');
          }
        }, 1500);
      } else if (res.status === 'expire' || res.status === 'cancel' || res.status === 'deny') {
        clearInterval(qrisPollTimer);
        clearInterval(qrisCountdownTimer);
        $('qrisStatus').textContent = '❌ Pembayaran ' + (res.status === 'expire' ? 'kedaluwarsa' : 'dibatalkan/gagal');
        $('qrisTimer').textContent = '';
        setTimeout(() => {
          closeModal('qrisModal');
          showOrderModal(lastOrder); // kembali ke modal sukses
        }, 2000);
      }
    } catch (_) {
      // polling error, lanjutkan
    }
  }, 3000);
}

function cancelQrisPayment(orderId, _paymentId) {
  clearInterval(qrisPollTimer);
  clearInterval(qrisCountdownTimer);
  $('qrisStatus').textContent = '⏰ Waktu QRIS habis. Silakan bayar di gerobak.';
  setTimeout(() => {
    closeModal('qrisModal');
    showOrderModal(lastOrder);
  }, 2000);
}

// ===== whatsapp =====
function waUrl(order) {
  let msg = 'Halo ODGJ Street Coffee!%0A';
  if (order) {
    msg += `Nomor antrean saya: *${fmtQueue(order.queue_number)}*%0A%0A`;
    msg += order.items
      .map((i) => `- ${i.name} x${i.qty} (${fmtRp(i.subtotal)})${i.options ? ' — ' + i.options : ''}`)
      .join('%0A');
    msg += `%0A%0ATotal: *${fmtRp(order.total)}*`;
    if (order.notes) msg += `%0ACatatan: ${order.notes}`;
  } else {
    msg += 'Saya mau pesan:%0A';
    cartItems().forEach(({ item, qty, options }) => (msg += `- ${item.name} x${qty}%0A`));
  }
  return `https://wa.me/${WA_NUMBER}?text=${msg}`;
}

// ===== ticker =====
function duplicateTicker() {
  const track = $('tickerTrack');
  track.innerHTML = track.innerHTML + ' ' + track.innerHTML.trim();
}

// ===== reveal on scroll =====
function initReveal() {
  document.querySelectorAll('.sec-head, .step, .cell, .loc-list .row').forEach((el) => el.classList.add('reveal'));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('visible');
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// ===== PWA =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* abaikan */ });
  }
}

// ===== toast =====
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
