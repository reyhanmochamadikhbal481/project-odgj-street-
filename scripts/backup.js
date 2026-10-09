// Backup DB sederhana: pg_dump ke folder backups/ (RPO < 5 mnt bila via cron)
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = path.join(dir, `odgj-${stamp}.dump`);
const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' };
try {
  execSync(`pg_dump -h ${process.env.PGHOST || 'localhost'} -p ${process.env.PGPORT || 5432} -U ${process.env.PGUSER || 'postgres'} -F c -f "${file}" ${process.env.PGDATABASE || 'odgj_street_coffee'}`, { env, stdio: 'inherit' });
  console.log('[backup] tersimpan:', file);
} catch (err) {
  console.error('[backup] gagal (pastikan pg_dump terinstall):', err.message);
  process.exit(1);
}
