// ============================================================
// ODGJ STREET COFFEE — Server utama
// Menyajikan halaman statis (public/) + API ke PostgreSQL
// Jalankan: npm start  →  http://localhost:3000
// ============================================================

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const pool = require('./config/db');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// Folder halaman depan (HTML/CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// API
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);

// Cek koneksi database saat server dinyalakan
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', db: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] ODGJ Street Coffee berjalan di http://localhost:${PORT}`);
});