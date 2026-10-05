-- ============================================================
-- ODGJ STREET COFFEE — Skema Database PostgreSQL
-- Jalankan lewat: npm run setup  (dieksekusi oleh scripts/setup.js)
-- Aman dijalankan ulang (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ============================================================

BEGIN;

-- Kategori menu khas gerobak
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(32) UNIQUE NOT NULL,
  name        VARCHAR(64) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

-- Daftar menu
CREATE TABLE IF NOT EXISTS menu_items (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name          VARCHAR(80) NOT NULL,
  description   VARCHAR(255) NOT NULL,
  price         INT NOT NULL CHECK (price >= 0),
  emoji         VARCHAR(16) NOT NULL DEFAULT '☕',
  photo_url     VARCHAR(500),
  is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  is_bestseller BOOLEAN NOT NULL DEFAULT FALSE,
  order_count   INT NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0
);

-- Header pesanan (nomor antrean)
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  queue_number  INT NOT NULL,
  customer_name VARCHAR(64) NOT NULL DEFAULT 'Pelanggan',
  notes         VARCHAR(500) NOT NULL DEFAULT '',
  total         INT NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'baru',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Detail isi tiap pesanan
CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  INT NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  name          VARCHAR(80) NOT NULL,
  qty           INT NOT NULL CHECK (qty > 0),
  unit_price    INT NOT NULL,
  subtotal      INT NOT NULL,
  options       VARCHAR(160) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_cat     ON menu_items (category_id);

-- ===== Upgrade untuk database yang sudah pernah dibuat =====
-- (mengikuti prinsip migrasi bertahap)
ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS order_count INT NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS options     VARCHAR(160) NOT NULL DEFAULT '';
ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS photo_url   VARCHAR(500);

-- ===== Auth & RBAC =====
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(128) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','barista','cashier','staff')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL,
  user_agent    VARCHAR(500),
  ip_address    VARCHAR(45),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);

-- ===== Payments =====
CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method          VARCHAR(20) NOT NULL DEFAULT 'qris' CHECK (method IN ('qris','cash','va','ewallet')),
  gateway         VARCHAR(32) NOT NULL DEFAULT 'midtrans',
  gateway_ref     VARCHAR(128) UNIQUE,     -- midtrans transaction_id
  amount          INT NOT NULL CHECK (amount >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settlement','expire','cancel','deny')),
  raw_payload     JSONB,                   -- webhook payload asli untuk audit
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_ref ON payments (gateway_ref);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);

COMMIT;

-- ===== Reservasi & Pembayaran (Modul 3) =====

-- Tabel reservasi meja
CREATE TABLE IF NOT EXISTS reservations (
  id               SERIAL PRIMARY KEY,
  booking_code     VARCHAR(20) UNIQUE NOT NULL,
  customer_id      INT NOT NULL REFERENCES users(id),
  outlet_id        INT NOT NULL DEFAULT 1,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  party_size       INT NOT NULL DEFAULT 2,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','paid','no_show')),
  deposit_amount   INT DEFAULT 0,
  estimated_total  INT DEFAULT 0,
  notes            VARCHAR(500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Meja untuk reservasi
CREATE TABLE IF NOT EXISTS tables (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(32) NOT NULL,
  capacity      INT NOT NULL DEFAULT 4,
  location      VARCHAR(64),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Penugasan meja per reservasi
CREATE TABLE IF NOT EXISTS reservation_tables (
  id               SERIAL PRIMARY KEY,
  reservation_id   INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id         INT NOT NULL REFERENCES tables(id),
  from_ts          TIMESTAMP NOT NULL,
  to_ts            TIMESTAMP NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
);

-- Slot waktu (kapasitas dan penghitung)
CREATE TABLE IF NOT EXISTS time_slots (
  id               SERIAL PRIMARY KEY,
  outlet_id        INT NOT NULL DEFAULT 1,
  day_of_week      INT NOT NULL,      -- 0=Minggu, 1=Senin, dst
  start_ts         TIME NOT NULL,
  end_ts           TIME NOT NULL,
  capacity         INT NOT NULL DEFAULT 20,
  booked           INT NOT NULL DEFAULT 0
);

-- Pre-order items (opsional untuk reservasi besar)
CREATE TABLE IF NOT EXISTS pre_orders (
  id               SERIAL PRIMARY KEY,
  reservation_id   INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  total            INT NOT NULL DEFAULT 0,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
);

-- Item di dalam pre-order
CREATE TABLE IF NOT EXISTS pre_order_items (
  id               SERIAL PRIMARY KEY,
  pre_order_id     INT NOT NULL REFERENCES pre_orders(id) ON DELETE CASCADE,
  menu_item_id     INT NOT NULL REFERENCES menu_items(id),
  qty              INT NOT NULL DEFAULT 1,
  unit_price       INT NOT NULL,
  notes            VARCHAR(200)
);

-- Deposit payments (QRIS/cash untuk reservasi)
CREATE TABLE IF NOT EXISTS deposit_payments (
  id               SERIAL PRIMARY KEY,
  reservation_id   INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount           INT NOT NULL DEFAULT 0,
  method           VARCHAR(20) NOT NULL DEFAULT 'qris' CHECK (method IN ('qris','cash','va','ewallet')),
  gateway_ref      VARCHAR(128),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settlement','expire','cancel','deny')),
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposit_payments_reservation_id ON deposit_payments (reservation_id);

-- Log verifikasi admin
CREATE TABLE IF NOT EXISTS verification_logs (
  id               SERIAL PRIMARY KEY,
  reservation_id   INT NOT NULL REFERENCES reservations(id),
  admin_id         INT REFERENCES users(id),
  action           VARCHAR(50) NOT NULL,
  remarks          VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index tambahan
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date);
CREATE INDEX IF NOT EXISTS idx_time_slots_week_day ON time_slots(day_of_week, start_ts);

COMMIT;