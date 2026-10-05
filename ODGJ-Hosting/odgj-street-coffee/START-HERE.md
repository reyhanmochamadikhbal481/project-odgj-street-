# 🚀 ODGJ Street Coffee — Paket Hosting (Mulai dari Sini)

Ini salinan lengkap proyek e-menu (frontend + backend + database PostgreSQL),
siap di-upload ke penyedia hosting. Folder `node_modules` tidak ikut — jalankan
`npm install` di hosting setelah deploy.

## 1. Jalankan di komputer sendiri (lokal)

```bash
npm install
npm run setup      # buat database odgj_street_coffee + seed menu (PostgreSQL harus aktif)
npm start          # buka http://localhost:3000
```

## 2. Upload ke hosting (Node.js + PostgreSQL)

Penyedia yang mendukung server Node.js + database:

| Penyedia | Cara |
|----------|------|
| **Render.com** | New → Web Service (build: `npm install`, start: `npm start`) + New → PostgreSQL. Salin isi `.env` ke environment vars. |
| **Railway.app** | New project → Deploy from GitHub. Tambahkan plugin PostgreSQL, lalu isi env vars dari `.env`. |
| **Vercel / Netlify** | ⚠️ Hanya untuk file statis — TIDAK menjalankan PostgreSQL. Opsional: gunakan Vercel Serverless Function + managed Postgres (Supabase/Neon). |

> Penting: jangan commit file `.env` ke git. Gunakan `.env.example` sebagai template
> dan isi nilai asli lewat panel "Environment Variables" di hosting.

## 3. Minimal variabel environment hosting

```
PGHOST=<host database>
PGPORT=5432
PGDATABASE=<nama database>
PGUSER=<user>
PGPASSWORD=<password>
PORT=3000
```

## Isi paket

```
odgj-street-coffee/
├── server.js          # Backend Express (entry point)
├── config/db.js       # Koneksi PostgreSQL
├── routes/            # API menu & orders
├── db/                # schema.sql + seed.sql
├── scripts/setup.js   # Inisialisasi database
└── public/            # Frontend (index.html, css, js)
```