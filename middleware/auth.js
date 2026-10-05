const { verifyAccessToken, requireRole: requireRoleUtil } = require('../config/auth');
const pool = require('../config/db');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const result = await pool.query(
      `SELECT id, email, full_name, role, is_active FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[auth middleware] error:', err.message);
    res.status(500).json({ error: 'Authentication error' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { hasPermission } = require('../config/auth');
    if (!roles.some(r => hasPermission(req.user.role, r))) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  authenticate(req, res, next);
}

module.exports = { authenticate, requireRole, optionalAuth };