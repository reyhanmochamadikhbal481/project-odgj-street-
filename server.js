// ============================================================
// ODGJ STREET COFFEE — Server utama
// Menyajikan halaman statis (public/) + API ke PostgreSQL
// Jalankan: npm start  →  http://localhost:3000
// ============================================================

require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const pool = require('./config/db');
const { initCache, cacheStats } = require('./config/cache');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const reservationRoutes = require('./routes/reservations');
const reportRoutes = require('./routes/reports');
const tableRoutes = require('./routes/tables');
const timeslotRoutes = require('./routes/timeslots');
const inventoryRoutes = require('./routes/inventory');
const accountingRoutes = require('./routes/accounting');
const shiftRoutes = require('./routes/shifts');
const { authenticate, optionalAuth } = require('./middleware/auth');
const { initSocket } = require('./realtime/socket');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Buat HTTP server terpisah agar bisa di-attach Socket.io
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── Rate Limiting: 60 request/menit/IP ──
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }

  const timestamps = rateLimitStore.get(ip).filter(ts => ts > windowStart);
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);

  if (timestamps.length > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: `Terlalu banyak request. Coba lagi dalam ${Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)} detik.` });
  }

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX - timestamps.length);
  next();
});

// Bersihkan entry rate-limit kedaluwarsa tiap 5 menit (hindari memori bocor)
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, ts] of rateLimitStore) {
    const fresh = ts.filter(t => t > cutoff);
    if (fresh.length) rateLimitStore.set(ip, fresh);
    else rateLimitStore.delete(ip);
  }
}, 5 * 60 * 1000).unref?.();

// ── Validasi env saat boot (fail-soft: warning, bukan crash) ──
(function validateEnv() {
  const warn = (m) => console.warn(`[env] ⚠️  ${m}`);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('ganti-')) {
    warn('JWT_SECRET lemah/default — set minimal 32 karakter acak di produksi.');
  }
  if (process.env.PAYMENTS_MOCK === 'true') {
    console.log('[env] PAYMENTS_MOCK=true — QRIS berjalan simulasi (oke untuk dev).');
  }
  if (!process.env.WA_API_URL || !process.env.WA_API_KEY) {
    console.log('[env] WA provider belum diset — reminder berjalan mode mock (log).');
  }
  if (!process.env.REDIS_URL) {
    console.log('[env] REDIS_URL kosong — cache pakai memory.');
  }
})();

// Folder halaman depan (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/checkin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'checkin.html')));
app.get('/reserve', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'reserve.html')));

// Auth routes (public)
app.use('/api/auth', authRoutes);

// Public menu (customers can browse without login)
app.use('/api/menu', optionalAuth, menuRoutes);

// Orders: public for customer ordering, protected for staff dashboard
app.use('/api/orders', orderRoutes);

// Reservasi: booking meja + pembayaran DP
app.use('/api/reservations', reservationRoutes);

// Payments: webhook public, create/status protected
app.use('/api/payments', paymentRoutes);

// Reports
app.use('/api/reports', reportRoutes);

// Tables (CRUD meja)
app.use('/api/tables', tableRoutes);

// Slot waktu reservasi (ketersediaan publik + CRUD staf)
app.use('/api/timeslots', timeslotRoutes);

// Inventori (UC-401..405), Akuntansi (UC-501..504), Shift (UC-204)
app.use('/api/inventory', inventoryRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/shifts', shiftRoutes);

// Health check (public)
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', db: result.rows[0].now, cache: cacheStats(), phase: 'fase-4-booking-reminder-excel' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

// Initialize Socket.io
initSocket(server);

// Wire event lintas modul: OrderPaid → stok + jurnal (UC-403/502)
require('./services').wireDomainEvents();
initCache().catch(() => {});

// Scheduler reminder H-1/H-2 (non-blocking)
require('./services/reminderService').startReminderScheduler();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] ODGJ Street Coffee berjalan di http://localhost:${PORT}`);
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  Object.keys(networkInterfaces).forEach((iface) => {
    networkInterfaces[iface].forEach((addr) => {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`[server] Network: http://${addr.address}:${PORT}`);
      }
    });
  });
});