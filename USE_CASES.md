# Use Case Specification — ODGJ Street Coffee v2.0

Referensi: Blueprint v2.0 (Bab 4, 5, 14, 15, 16, 17)

---

## **Aktor**

| Aktor | Deskripsi |
|-------|-----------|
| **Customer** | Pelanggan yang memesan via HP (scan QR / buka URL) |
| **Barista** | Staf dapur yang memproses pesanan (status: baru → diproses → siap) |
| **Cashier** | Kasir yang menerima pembayaran cash/QRIS, melihat antrean |
| **Manager** | Mengelola menu, stok, laporan harian, verifikasi reservasi |
| **Owner** | Akses penuh: laporan keuangan, user management, pengaturan outlet |
| **System** | Proses otomatis: event bus, scheduler, notifikasi, sinkron stok |
| **Payment Gateway** | Midtrans/Xendit (eksternal) — memproses QRIS/VA/E-Wallet |

---

## **Modul 1: E-Menu & Self Ordering (Customer)**

### **UC-101: Browse Menu**
- **Aktor**: Customer
- **Prekondisi**: HP terhubung internet, buka `https://outlet.odgj.coffee/menu`
- **Alur Utama**:
  1. Customer buka halaman menu
  2. System tampilkan kategori (Susu, Item, Non-Kopi, Camilan)
  3. Customer pilih kategori / ketik pencarian
  4. System filter & tampilkan item tersedia (`is_available = true`)
  5. Customer lihat detail item (foto, deskripsi, harga, emoji)
- **Postkondisi**: Customer memutuskan item untuk dipesan
- **Alternatif**: Jika offline → tampilkan cache terakhir (PWA)

### **UC-102: Set Levelisasi Gula & Es**
- **Aktor**: Customer
- **Prekondisi**: Customer klik item di menu
- **Alur Utama**:
  1. Modal levelisasi muncul
  2. Customer pilih Gula: Sedikit / Normal / Banyak
  3. Customer pilih Es: Sedikit / Normal / Banyak
  4. Customer klik "Tambah ke Keranjang"
  5. System simpan ke `localStorage` + update badge keranjang
- **Business Rule**: Default = Normal / Normal

### **UC-103: Keranjang & Checkout**
- **Aktor**: Customer
- **Prekondisi**: Minimal 1 item di keranjang
- **Alur Utama**:
  1. Customer buka drawer keranjang
  2. Customer ubah qty / hapus item
  3. Customer isi nama + catatan (opsional)
  4. Customer klik "Pesan & Bayar di Gerobak"
  5. System POST `/api/orders` → return `order_id`, `queue_number`
  6. Modal sukses tampil: nomor antrean + ringkasan + tombol WA
- **Alternatif**: Jika item habis saat submit → error 422 "X sedang habis"

### **UC-104: Live Tracking Antrean**
- **Aktor**: Customer
- **Prekondisi**: Order baru dibuat
- **Alur Utama**:
  1. Modal sukses tampil status "Menunggu diproses"
  2. System subscribe WebSocket `order_<id>`
  3. Barista ubah status → WS push `order:tracking` → update modal
  4. Status berurutan: `baru` → `diproses` → `siap` → `selesai`
  5. Jika `siap` → tampil "SIAP diambil!" + suara notifikasi
- **Fallback**: Polling `GET /api/orders/live-queue` tiap 15 detik

### **UC-105: Order via WhatsApp**
- **Aktor**: Customer
- **Prekondisi**: Modal sukses tampil
- **Alur**: Klik "Lanjut ke WhatsApp" → buka `wa.me/62812...?text=...` dengan nomor antrean & ringkasan

---

## **Modul 2: POS & Order Dashboard (Barista/Cashier)**

### **UC-201: Login Dashboard**
- **Aktor**: Barista, Cashier, Manager, Owner
- **Prekondisi**: Buka `/admin.html`
- **Alur**:
  1. Jika token valid di localStorage → auto-login
  2. Jika tidak → tampilkan form login (email + password)
  3. POST `/api/auth/login` → JWT access + refresh cookie
  4. Validasi role ∈ {owner, manager, barista, cashier}
  5. Connect WebSocket + emit `auth` dengan token
  5. Tampilkan dashboard antrean realtime

### **UC-202: Kelola Antrean Pesanan**
- **Aktor**: Barista, Cashier
- **Prekondisi**: Login sukses, WebSocket connected
- **Alur Utama**:
  1. Dashboard tampil kartu pesanan aktif (status ≠ selesai)
  2. Urutan: `baru` (biru) → `diproses` (kuning) → `siap` (hijau)
  3. Barista klik tombol status:
     - `baru` → ▶ **Diproses**
     - `diproses` → ✔ **Siap**
     - `siap` → ✓ **Selesai**
  4. PATCH `/api/orders/:id` → emit `OrderStatusChanged`
  5. Semua dashboard barista update realtime via WS
- **State Machine**:
  ```
  baru ──accept──▶ diproses ──ready──▶ siap ──served──▶ selesai
    │                    │                    │
    └─reject────────────┴─cancel─────────────┴─cancel
  ```

### **UC-203: Lihat Detail Pesanan**
- **Aktor**: Barista
- **Alur**: Klik kartu pesanan → expand items + catatan + opsi gula/es

### **UC-204: Shift & Cash Drawer (Cashier)**
- **Aktor**: Cashier, Manager
- **Fitur** (Blueprint Bab 5.1):
  - Buka shift → catat kas awal
  - Terima pembayaran cash/QRIS per pesanan
  - Tutup shift → rekonsiliasi kas vs total order
  - Print laporan shift (thermal printer)

---

## **Modul 3: Reservasi Meja & Pembayaran (Planned)**

### **UC-301: Booking Meja**
- **Aktor**: Customer
- **Prekondisi**: Buka form reservasi (via PWA/public web)
- **Alur**:
  1. Pilih tanggal, jam, jumlah orang, preferensi meja
  2. System cek ketersediaan slot (30 menit, kapasitas max)
  3. Jika party ≥ 6 orang ATAU pre-order > 500k → wajib DP
  4. Customer bayar DP via QRIS/VA/E-Wallet (Midtrans)
  5. Webhook settlement → auto-approve reservasi
  6. Kirim konfirmasi WA/Email + QR Check-in
- **Business Rules** (BR-RES-01..07):
  - Slot 30 menit, max 2 jam/sesi
  - Kapasitas per slot terbatas
  - Auto-cancel jika DP tidak bayar 30 menit
  - Reminder H-1 & H-2 jam via WA
  - No-show → DP hangus
  - Reschedule max 1x, minimal H-6 jam

### **UC-302: Check-in Meja**
- **Aktor**: Customer (di outlet)
- **Alur**: Scan QR Check-in → System update meja `OCCUPIED` → Buka session baru

### **UC-303: Verifikasi Manual (Admin)**
- **Aktor**: Manager/Owner
- **Alur**: Kasus khusus (nilai besar, permintaan custom) → review → approve/reject

---

## **Modul 4: Manajemen Inventori & Bahan Baku (Planned)**

### **UC-401: Master Bahan Baku**
- **Aktor**: Manager, Inventory Staff
- **Fitur**: CRUD ingredient (kode, nama, satuan, harga, reorder threshold, metode FIFO/Average)

### **UC-402: Bill of Materials (Resep)**
- **Aktor**: Manager
- **Alur**: 1 Menu Item = banyak RecipeLine (ingredient + qty + satuan)
- **Contoh**: Americano = 18g biji + 150ml air + 1 cup + 1 lid

### **UC-403: Auto Decrement Stok (OrderPaid → StockDecremented)**
- **Aktor**: System (otomatis)
- **Trigger**: Event `OrderPaid` diterima
- **Alur**:
  1. Ambil semua order_items
  2. Untuk tiap item → resolve BOM aktif
  3. Hitung qty bahan = qty_order × qty_resep
  4. Cek saldo cukup? Jika tidak → alert admin + flag order
  5. Decrement stok (optimistic locking, version check)
  6. Insert `stock_movements` type=OUT
  7. Jika saldo < threshold → low-stock alert + auto-disable menu
  8. Emit `StockDecremented` untuk Accounting (COGS)

### **UC-404: Purchase Order & GRN**
- **Aktor**: Inventory Staff, Supplier
- **Alur**: Buat PO → Kirim ke supplier → Terima barang (GRN) → Update stok IN

### **UC-405: Stock Opname**
- **Aktor**: Inventory Staff, Supervisor (approval)
- **Alur**: Audit fisik → hitung variance → adjustment (dengan alasan + approval supervisor)

---

## **Modul 5: Laporan Penjualan & Jurnal Keuangan (Planned)**

### **UC-501: Chart of Accounts (COA)**
- **Aktor**: Owner, Manager
- **Struktur PSAK**: 1-xxxx Aset, 2-xxxx Kewajiban, 3-xxxx Ekuitas, 4-xxxx Pendapatan, 5-xxxx HPP, 6-xxxx Beban

### **UC-502: Auto Jurnal dari Event**
- **Aktor**: System
- **Mapping** (Blueprint Tabel 16.3):
  | Event | Debit | Kredit |
  |-------|-------|--------|
  | OrderPaid (QRIS) | 1-1010 Bank/QRIS | 4-1000 Pendapatan |
  | → COGS | 5-1000 HPP | 1-1200 Persediaan |
  | WasteRecorded | 6-2100 Beban Waste | 1-1200 Persediaan |
  | PurchaseReceived | 1-1200 Persediaan | 2-1000 Utang Usaha |
  | Deposit Reservasi | 1-1010 Bank | 2-1300 Uang Muka Customer |

### **UC-503: Laporan Keuangan**
- **Aktor**: Owner, Manager
- **Laporan**: Laba Rugi (P&L), Arus Kas (Cash Flow), Neraca (Balance Sheet)
- **Filter**: Periode, Outlet
- **Export**: PDF (audit-ready), Excel (multi-sheet), CSV

### **UC-504: Period Closing**
- **Aktor**: Owner, Manager
- **Alur**: Lock periode → tidak boleh backdate → koreksi via jurnal reversal

---

## **Cross-Module Orchestration (Event-Driven)**

| Event | Producer | Consumer(s) |
|-------|----------|-------------|
| `OrderSubmitted` | Order Service | POS (realtime), Notification |
| `OrderPaid` | Payment Service | Inventory (stock dec), Accounting (jurnal), Notification |
| `StockDecremented` | Inventory | Accounting (COGS) |
| `StockLowAlert` | Inventory | Notification, POS (auto-disable menu) |
| `ReservationPaid` | Reservation | Notification, Accounting (uang muka) |
| `ReservationConfirmed` | Reservation | Table Service, Notification |
| `JournalPosted` | Accounting | Reporting, Analytics |
| `FiscalPeriodClosed` | Accounting | Reporting (lock) |

---

## **Non-Functional Use Cases**

| NFR | Target |
|-----|--------|
| **Latency API** | p95 < 200ms |
| **WS Push Latency** | < 500ms |
| **Availability** | 99.9% |
| **Concurrent Users** | 5.000/outlet |
| **Offline Resilience** | 100% order queue di IndexedDB |
| **Security** | OWASP Top 10, JWT rotation, rate limit 60 req/min/IP |
| **PCI-DSS** | Scope minimal (tokenisasi via gateway) |
| **Backup** | WAL streaming 5 menit, RPO < 5 min, RTO < 30 min |

---

## **Traceability Matrix**

| Use Case | Blueprint Ref | Implementasi Status |
|----------|---------------|---------------------|
| UC-101..105 | Bab 4 (Modul 1) | ✅ Done (PWA v3: install prompt, offline menu cache, offline.html, BG sync) |
| UC-201..204 | Bab 5 (Modul 2) | ✅ Done (shift/cash drawer: open/cash/close + rekonsiliasi + struk 80mm) |
| UC-301..303 | Bab 14 (Modul 3) | ✅ Done fase-3/4 (halaman /reserve publik, guest booking, auto-assign meja, DP mock/Snap, webhook auto-confirm, check-in seated, reminder H-1/H-2 + log) |
| UC-401..405 | Bab 15 (Modul 4) | ✅ Done fase-2/3 (CRUD bahan, BOM editor, auto-decrement OrderPaid, PO+GRN, opname+approval, low-stock alert + auto-disable) |
| UC-501..504 | Bab 16 (Modul 5) | ✅ Done fase-2/3/4 (COA PSAK, auto-jurnal revenue/HPP/deposit/purchase/waste, P&L, cashflow, neraca, period lock, jurnal manual, export CSV+XLS) |
| Cross-Module | Bab 17 | ✅ Event Bus + WS running (OrderPaid→stok+jurnal, StockLowAlert, JournalPosted, ReservationCreated) |

---

## **Next Implementation Priority**

1. ~~**UC-301 (Booking + QRIS Payment)**~~ ✅ Selesai fase-3 (guest booking + mock settle + cash)
2. ~~**UC-403 (Auto Decrement Stok)**~~ ✅ Selesai (terbukti via verify_phase3)
3. ~~**UC-502 (Auto Jurnal)**~~ ✅ Selesai (revenue + HPP otomatis)
4. ~~**UC-204 (Shift/Cash Drawer)**~~ ✅ Selesai (+rekonsiliasi + cetak)
5. ~~**PWA Background Sync**~~ ✅ Selesai (v3 + offline menu cache)
6. **Sisa menuju produksi**: kredensial Midtrans asli (matikan PAYMENTS_MOCK, endpoint Snap sudah benar), isi `WA_API_URL/KEY` untuk reminder asli (saat ini mock/log), export PDF (CSV+XLS ada, cetak via browser), secret management produksi, WAL backup terjadwal (`npm run backup` via cron, contoh: `*/5 * * * * cd /opt/odgj && npm run backup`).

---

*Dokumen ini living document — update seiring implementasi modul baru.*