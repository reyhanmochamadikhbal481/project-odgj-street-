// Verifikasi Fase-2: cek file, syntax, dan (opsional) DB bila tersedia
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const mustExist = [
  'db/migration_phase2.sql',
  'config/cache.js',
  'services/inventoryService.js',
  'services/accountingService.js',
  'services/index.js',
  'routes/inventory.js',
  'routes/accounting.js',
  'routes/shifts.js',
  'public/offline.html',
  'public/manifest.json',
  'public/sw.js',
  'Dockerfile',
  'docker-compose.yml',
  'k8s/deployment.yaml',
  '.env.example',
];
const mustContain = [
  ['server.js', '/api/inventory'],
  ['server.js', '/api/accounting'],
  ['server.js', '/api/shifts'],
  ['server.js', 'wireDomainEvents'],
  ['public/js/admin.js', 'loadInventory'],
  ['public/js/admin.js', 'loadAccounting'],
  ['public/js/admin.js', 'loadShifts'],
  ['public/js/app.js', 'odgj_menu_cache'],
];

let fail = 0;
for (const f of mustExist) {
  const ok = fs.existsSync(path.join(root, f));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f}`);
  if (!ok) fail++;
}
for (const [f, s] of mustContain) {
  const content = fs.readFileSync(path.join(root, f), 'utf8');
  const ok = content.includes(s);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f} contains "${s}"`);
  if (!ok) fail++;
}
const checkFiles = ['server.js', 'routes/inventory.js', 'routes/accounting.js', 'routes/shifts.js', 'services/inventoryService.js', 'services/accountingService.js', 'services/index.js', 'config/cache.js'];
for (const f of checkFiles) {
  try {
    execSync(`node --check "${path.join(root, f)}"`, { stdio: 'pipe' });
    console.log(`OK   syntax ${f}`);
  } catch (e) {
    console.log(`FAIL syntax ${f}: ${e.message}`);
    fail++;
  }
}
// Cek DB bila bisa konek (tidak wajib lolos di CI tanpa postgres)
try {
  require('dotenv').config({ path: path.join(root, '.env') });
  const { Client } = require('pg');
  const c = new Client({
    host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'odgj_street_coffee', connectionTimeoutMillis: 3000,
  });
  c.connect().then(async () => {
    const tables = ['ingredients', 'recipes', 'stock_movements', 'purchase_orders', 'chart_of_accounts', 'journal_entries', 'journal_lines', 'fiscal_periods', 'shifts'];
    for (const t of tables) {
      const r = await c.query(`SELECT to_regclass($1) AS c`, [`public.${t}`]);
      const ok = !!r.rows[0].c;
      console.log(`${ok ? 'OK  ' : 'FAIL'} db table ${t}`);
      if (!ok) fail++;
    }
    await c.end();
    finish();
  }).catch((e) => { console.log(`SKIP db check (postgres tidak terjangkau): ${e.message}`); finish(); });
} catch (e) { console.log('SKIP db check: ' + e.message); finish(); }

function finish() {
  console.log(fail === 0 ? '\nPHASE2 VERIFY: LULUS' : `\nPHASE2 VERIFY: ${fail} masalah`);
  process.exit(fail === 0 ? 0 : 1);
}
