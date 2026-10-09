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

  // Migrasi fase 2 (inventori + akuntansi + shift) — idempotent
  const phase2Path = path.join(__dirname, '..', 'db', 'migration_phase2.sql');
  if (fs.existsSync(phase2Path)) {
    const phase2Sql = fs.readFileSync(phase2Path, 'utf8');
    await db.query(phase2Sql);
    console.log('[setup] migrasi fase-2 (inventori/akuntansi/shift) diterapkan.');
  }

  // Migrasi fase 3 (fix reservasi + payments mock) — idempotent
  const phase3Path = path.join(__dirname, '..', 'db', 'migration_phase3.sql');
  if (fs.existsSync(phase3Path)) {
    const phase3Sql = fs.readFileSync(phase3Path, 'utf8');
    await db.query(phase3Sql);
    console.log('[setup] migrasi fase-3 (fix reservasi) diterapkan.');
  }

  // Migrasi fase 4 (reminder logs) — idempotent
  const phase4Path = path.join(__dirname, '..', 'db', 'migration_phase4.sql');
  if (fs.existsSync(phase4Path)) {
    const phase4Sql = fs.readFileSync(phase4Path, 'utf8');
    await db.query(phase4Sql);
    console.log('[setup] migrasi fase-4 (reminder logs) diterapkan.');
  }

  // Seed hanya kalau tabel menu masih kosong (agar tidak duplikat)
  const count = await db.query('SELECT COUNT(*)::int AS n FROM menu_items');
  if (count.rows[0].n === 0) {
    const seedSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    await db.query(seedSql);
    console.log('[setup] data menu di-seed.');
  } else {
    console.log(`[setup] seed dilewati (menu sudah berisi ${count.rows[0].n} item).`);
  }

  // Seed bahan + BOM demo bila ingredients masih kosong
  const ingCount = await db.query('SELECT COUNT(*)::int AS n FROM ingredients');
  if (ingCount.rows[0].n === 0) {
    await db.query(`
      INSERT INTO ingredients (code, name, unit, cost_per_unit, stock_qty, reorder_level) VALUES
        ('BJI-ROB','Biji Robusta','gram', 350, 5000, 1000),
        ('SUS-FC','Susu Full Cream','ml', 25, 20000, 5000),
        ('GUL-AREN','Gula Aren Cair','ml', 40, 10000, 2000),
        ('AIR-MIN','Air Mineral','ml', 2, 50000, 10000),
        ('CUP-12','Cup 12oz','pcs', 800, 500, 100),
        ('LID-12','Lid 12oz','pcs', 300, 500, 100),
        ('ES-KRIS','Es Kristal','gram', 5, 20000, 5000)
      ON CONFLICT (code) DO NOTHING;
    `);
    // BOM sederhana: tiap menu kopi butuh biji+air+cup+lid+es; susu tambah susu+gula
    await db.query(`
      INSERT INTO recipes (menu_item_id, ingredient_id, qty, unit)
      SELECT m.id, i.id, CASE i.code
        WHEN 'BJI-ROB' THEN 18 WHEN 'AIR-MIN' THEN 150 WHEN 'ES-KRIS' THEN 120
        WHEN 'SUS-FC' THEN 100 WHEN 'GUL-AREN' THEN 30
        ELSE 1 END, i.unit
      FROM menu_items m JOIN ingredients i ON i.code IN ('BJI-ROB','AIR-MIN','ES-KRIS','CUP-12','LID-12')
      ON CONFLICT (menu_item_id, ingredient_id) DO NOTHING;
    `);
    await db.query(`
      INSERT INTO recipes (menu_item_id, ingredient_id, qty, unit)
      SELECT m.id, i.id, CASE WHEN i.code='SUS-FC' THEN 100 ELSE 30 END, i.unit
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id AND c.slug='susu'
      JOIN ingredients i ON i.code IN ('SUS-FC','GUL-AREN')
      ON CONFLICT (menu_item_id, ingredient_id) DO NOTHING;
    `);
    console.log('[setup] seed bahan baku + BOM demo dibuat.');
  }
  await db.end();
}

main().catch((err) => {
  console.error('[setup] gagal:', err.message);
  process.exit(1);
});