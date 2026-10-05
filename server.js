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
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const reservationRoutes = require('./routes/reservations');
const reportRoutes = require('./routes/reports');
const tableRoutes = require('./routes/tables');
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

// Folder halaman depan (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/checkin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'checkin.html')));

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

// Health check (public)
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', db: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

// Initialize Socket.io
initSocket(server);

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