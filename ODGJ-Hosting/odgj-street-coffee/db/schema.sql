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

COMMIT;