require('dotenv').config();
const pool = require('../config/db');
const { hashPassword } = require('../config/auth');

async function createDefaultUsers() {
  const client = await pool.connect();
  try {
    const ownerEmail = process.env.DEFAULT_OWNER_EMAIL || 'owner@odgj.com';
    const ownerPassword = process.env.DEFAULT_OWNER_PASSWORD || 'odgj12345';
    const ownerName = process.env.DEFAULT_OWNER_NAME || 'ODGJ Owner';

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [ownerEmail]);
    if (existing.rowCount > 0) {
      console.log('[seed-users] Owner user already exists');
      return;
    }

    const passwordHash = await hashPassword(ownerPassword);
    await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'owner')`,
      [ownerEmail, passwordHash, ownerName]
    );

    console.log('[seed-users] Default owner created:');
    console.log(`  Email: ${ownerEmail}`);
    console.log(`  Password: ${ownerPassword}`);
    console.log('  Role: owner');
    console.log('  (Change password after first login!)');
  } catch (err) {
    console.error('[seed-users] error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

createDefaultUsers()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));