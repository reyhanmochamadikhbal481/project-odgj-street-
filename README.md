# ODGJ Street Coffee — E-Menu + Database PostgreSQL

Situs e-menu gerobak kopi yang ditingkatkan: **desain modern**, data menu diambil dari
**database PostgreSQL**, dan pesanan pelanggan **tersimpan otomatis** lewat server lokal.
Semua berjalan di `http://localhost:3000`.

## Fitur

- 🎨 Desain street-print modern (gradasi, animasi, skeleton, reveal-on-scroll)
- 🖼️ Tile produk berwarna per kategori + penanda popularitas ("diorder X kali")
- 🥤 Levelisasi **gula & es** saat memesan (sedikit / normal / banyak)
- 📡 **Live antrean** di beranda (nomor antrean yang sedang diproses, update 5 detik)
- 👨🍳 **Dashboard Barista** di `/admin.html` — ubah status pesanan (baru → diproses → siap)
- 📱 **PWA** — bisa di-install ke layar utama, cache offline
- 💬 Checkout WhatsApp + status pesanan hidup di modal sukses

## Struktur proyek

```
odgj-street-coffee/
├── server.js            # Entry point server Express (localhost:3000)
├── config/
│   └── db.js            # Koneksi pool PostgreSQL
├── routes/
│   ├── menu.js          # API menu      (GET /api/menu)
│   └── orders.js        # API pesanan   (POST/GET/PATCH /api/orders)
├── db/
│   ├── schema.sql       # Skema tabel (idempotent, bisa dijalankan ulang)
│   └── seed.sql         # Isi awal menu
├── scripts/
│   └── setup.js         # Buat DB + schema + seed (aman dijalankan ulang)
├── public/              # Frontend (disajikan statis oleh server)
│   ├── index.html       # Halaman pelanggan
│   ├── admin.html       # Dashboard barista
│   ├── manifest.json    # PWA
│   ├── sw.js            # Service worker (offline cache)
│   ├── icons/           # Ikon PWA
│   ├── css/  admin.css + style.css
│   └── js/   app.js + admin.js
├── .env                 # Kredensial PostgreSQL & port server
└── package.json
```

## Cara menjalankan

```bash
npm install          # sudah dijalankan
npm run setup        # buat database + tabel + seed menu (idempotent)
npm start            # server → http://localhost:3000
```

Buka browser di **http://localhost:3000** (pelanggan) atau
**http://localhost:3000/admin.html** (barista).

## Menghubungkan TablePlus (sudah terpasang)

1. Buka **TablePlus** → **Database → Add a New Connection** → pilih **PostgreSQL**.
2. Isi: Host `localhost`, Port `5432`, Database `odgj_street_coffee`,
   User `postgres`, Password `postgres` → **Connect**.

## API

| Method  | Endpoint             | Fungsi                                |
|---------|----------------------|---------------------------------------|
| GET     | `/api/menu`          | Semua menu (+ kategori, stok, populernya) |
| GET     | `/api/menu/:id`      | Satu menu                             |
| POST    | `/api/orders`        | Simpan pesanan baru (dengan levelisasi) |
| GET     | `/api/orders`        | Daftar 50 pesanan terbaru (`?status=` utk filter) |
| PATCH   | `/api/orders/:id`    | Ubah status: baru/diproses/siap/selesai |
| GET     | `/api/health`        | Status koneksi database               |

### Contoh POST /api/orders

```json
{
  "customer_name": "Rama",
  "notes": "Gula sedikit, es normal",
  "items": [{ "id": 4, "qty": 2, "options": "Gula banyak · Es sedikit" }]
}
```

## Catatan

- Kredensial database ada di file `.env` (jangan di-commit ke git).
- Menu bisa diedit langsung dari TablePlus / SQL — halaman menampilkan perubahan
  saat di-refresh (menu di-fetch dari database, bukan hardcoded).
- `npm run setup` aman dijalankan ulang: hanya meng-seed jika tabel menu kosong.