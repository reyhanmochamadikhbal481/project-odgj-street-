const express = require('express');
const pool = require('../config/db');
const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyAccessToken,
  JWT_REFRESH_EXPIRY
} = require('../config/auth');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function setRefreshCookie(res, token, expiresInDays = 7) {
  const expires = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires,
    path: '/'
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { path: '/' });
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, role = 'staff' } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password, full_name wajib diisi' });
    }

    const validRoles = ['owner', 'manager', 'barista', 'cashier', 'staff'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [email.toLowerCase(), passwordHash, full_name, role]
    );

    const user = result.rows[0];
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshTokenHash, expiresAt]
    );

    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken
    });
  } catch (err) {
    console.error('[auth/register] error:', err.message);
    res.status(500).json({ error: 'Gagal mendaftar' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email dan password wajib diisi' });
    }

    const result = await pool.query(
      `SELECT id, email, password_hash, full_name, role, is_active
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Akun tidak aktif' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshTokenHash, expiresAt]
    );

    setRefreshCookie(res, refreshToken);

    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      accessToken
    });
  } catch (err) {
    console.error('[auth/login] error:', err.message);
    res.status(500).json({ error: 'Gagal login' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token tidak ditemukan' });
    }

    const tokenHash = hashToken(refreshToken);
    const result = await pool.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, u.email, u.full_name, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token tidak valid' });
    }

    const tokenData = result.rows[0];

    if (new Date(tokenData.expires_at) < new Date()) {
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenData.id]);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token kedaluwarsa' });
    }

    if (!tokenData.is_active) {
      clearRefreshCookie(res);
      return res.status(403).json({ error: 'Akun tidak aktif' });
    }

    await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenData.id]);

    const user = {
      id: tokenData.user_id,
      email: tokenData.email,
      full_name: tokenData.full_name,
      role: tokenData.role
    };

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, newRefreshTokenHash, newExpiresAt]
    );

    setRefreshCookie(res, newRefreshToken);

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error('[auth/refresh] error:', err.message);
    res.status(500).json({ error: 'Gagal refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    }
    clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('[auth/logout] error:', err.message);
    res.status(500).json({ error: 'Gagal logout' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token tidak ditemukan' });
    }

    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Access token tidak valid atau kedaluwarsa' });
    }

    const result = await pool.query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'User tidak ditemukan' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Akun tidak aktif' });
    }

    res.json({ user });
  } catch (err) {
    console.error('[auth/me] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat profil' });
  }
});

// GET /api/auth/users — daftar pengguna (owner only)
router.get('/users', authenticate, requireRole('owner'), async (_req, res) => {
  try {
    const result = await pool.query(`SELECT id, email, full_name, role, is_active, created_at FROM users ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('[auth/users] error:', err.message);
    res.status(500).json({ error: 'Gagal memuat pengguna.' });
  }
});

// PATCH /api/auth/users/:id — update user (owner only)
router.patch('/users/:id', authenticate, requireRole('owner'), async (req, res) => {
  try {
    const { full_name, email, role, is_active, password } = req.body;
    const fields = []; const vals = []; let idx = 1;
    if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); vals.push(full_name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); vals.push(email.toLowerCase()); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); vals.push(role); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); vals.push(is_active); }
    if (password) { fields.push(`password_hash = $${idx++}`); vals.push(await hashPassword(password)); }
    if (fields.length === 0) return res.status(400).json({ error: 'Tidak ada data yang diupdate.' });
    fields.push(`updated_at = NOW()`);
    vals.push(req.params.id);
    const result = await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role, is_active, created_at`, vals);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[auth/users/update] error:', err.message);
    res.status(500).json({ error: 'Gagal update user.' });
  }
});

// DELETE /api/auth/users/:id — hapus user (owner only)
router.delete('/users/:id', authenticate, requireRole('owner'), async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tidak bisa hapus diri sendiri.' });
    const result = await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan.' });
    res.json({ message: 'User dihapus' });
  } catch (err) {
    console.error('[auth/users/delete] error:', err.message);
    res.status(500).json({ error: 'Gagal hapus user.' });
  }
});

module.exports = router;