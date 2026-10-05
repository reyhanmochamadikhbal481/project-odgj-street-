const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'odgj_street_coffee',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

pool.on('error', (err) => {
  console.error('[db] error tak terduga pada pool PostgreSQL:', err.message);
});

module.exports = pool;