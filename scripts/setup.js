// ============================================================
// Setup database: buat database + jalankan schema.sql & seed.sql
// Jalankan dengan: npm run setup
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const dbName = process.env.PGDATABASE || 'odgj_street_coffee';
const adminConfig = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: 'postgres',
};

async function main() {
  // 1. Buat database kalau belum ada
  const admin = new Client(adminConfig);
  await admin.connect();
  const exists = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName]
  );
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[setup] database "${dbName}" dibuat.`);
  } else {
    console.log(`[setup] database "${dbName}" sudah ada.`);
  }
  await admin.end();

  // 2. Jalankan schema + seed
  const db = new Client({ ...adminConfig, database: dbName });
  await db.connect();

  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(schemaSql);
  console.log('[setup] skema tabel dibuat (idempotent).');

  // Seed hanya kalau tabel menu masih kosong (agar tidak duplikat)
  const count = await db.query('SELECT COUNT(*)::int AS n FROM menu_items');
  if (count.rows[0].n === 0) {
    const seedSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    await db.query(seedSql);
    console.log('[setup] data menu di-seed.');
  } else {
    console.log(`[setup] seed dilewati (menu sudah berisi ${count.rows[0].n} item).`);
  }
  await db.end();
}

main().catch((err) => {
  console.error('[setup] gagal:', err.message);
  process.exit(1);
});