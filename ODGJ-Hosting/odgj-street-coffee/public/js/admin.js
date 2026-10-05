/* ============================================================
   ODGJ STREET COFFEE — admin.js  (Dashboard Barista)
   Menampilkan + mengubah status pesanan dari PostgreSQL.
   ============================================================ */

const fmtRp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const fmtQueue = (n) => '#' + String(n).padStart(2, '0');
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL = { baru: 'Baru', diproses: 'Diproses', siap: 'Siap', selesai: 'Selesai' };

let orders = [];

document.addEventListener('DOMContentLoaded', () => {
  load();
  setInterval(load, 3000);
});

async function load() {
  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error();
    orders = await res.json();
    document.getElementById('liveDot').textContent = '● ONLINE';
    document.getElementById('liveDot').classList.remove('off');
    render();
  } catch (_) {
    document.getElementById('liveDot').textContent = '● OFFLINE';
    document.getElementById('liveDot').classList.add('off');
    document.getElementById('aBoard').innerHTML =
      '<div class="a-empty">Server/database tidak terjangkau.<br>Periksa apakah `npm start` berjalan.</div>';
  }
}

function render() {
  // Statistik ringkas
  const count = (s) => orders.filter((o) => o.status === s).length;
  const active = orders.filter((o) => o.status !== 'selesai');
  document.getElementById('aStats').innerHTML = `
    <div class="a-stat"><b>${count('baru')}</b>Baru</div>
    <div class="a-stat"><b>${count('diproses')}</b>Diproses</div>
    <div class="a-stat"><b>${count('siap')}</b>Siap</div>
    <div class="a-stat"><b>${orders.length}</b>Total</div>
  `;

  const board = document.getElementById('aBoard');
  if (active.length === 0) {
    board.innerHTML = '<div class="a-empty">Belum ada pesanan aktif. Santai dulu, barista. ☕</div>';
    return;
  }

  board.innerHTML = active
    .map((o) => {
      const items = (o.items || [])
        .map((i) => `<li><span>${i.name} <span class="a-opt">${i.options || ''}</span></span><b>x${i.qty}</b></li>`)
        .join('');
      return `
      <div class="a-card st-${o.status}">
        <div>
          <div class="a-qnum">${fmtQueue(o.queue_number)}</div>
          <span class="a-id">#${o.id}</span>
        </div>
        <div class="a-info">
          <h3>${escapeHtml(o.customer_name)} <span class="a-st">${STATUS_LABEL[o.status] || o.status}</span></h3>
          <div class="a-meta">${fmtTime(o.created_at)} · ${fmtRp(o.total)}</div>
          <ul class="a-items">${items}</ul>
          ${o.notes ? `<div class="a-note">📝 ${escapeHtml(o.notes)}</div>` : ''}
        </div>
        <div class="a-actions" data-id="${o.id}">
          ${o.status !== 'diproses' ? `<button class="a-btn diproses" data-st="diproses">▶ Diproses</button>` : ''}
          ${o.status !== 'siap' ? `<button class="a-btn siap" data-st="siap">✔ Siap</button>` : ''}
          ${o.status !== 'selesai' ? `<button class="a-btn selesai" data-st="selesai">✓ Selesai</button>` : ''}
        </div>
      </div>`;
    })
    .join('');

  board.querySelectorAll('.a-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.parentElement.dataset.id;
      const status = btn.dataset.st;
      await patchStatus(id, status);
      await load();
    })
  );
}

async function patchStatus(id, status) {
  const res = await fetch(`/api/orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Gagal mengubah status');
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}