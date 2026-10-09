-- ============================================================
-- ODGJ STREET COFFEE — Migrasi Fase 2 (target progres 50%)
-- Modul 4 Inventori + Modul 5 Akuntansi + UC-204 Shift/Cash Drawer
-- Idempotent: aman dijalankan ulang via npm run setup
-- ============================================================

-- ====== MODUL 4: INVENTORI ======
CREATE TABLE IF NOT EXISTS ingredients (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(32) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  unit            VARCHAR(16) NOT NULL DEFAULT 'pcs',
  cost_per_unit   INT NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
  stock_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_level   NUMERIC(14,3) NOT NULL DEFAULT 0,
  valuation       VARCHAR(16) NOT NULL DEFAULT 'average' CHECK (valuation IN ('fifo','average')),
  version         INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipes (
  id              SERIAL PRIMARY KEY,
  menu_item_id    INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id   INT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty             NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit            VARCHAR(16) NOT NULL DEFAULT 'pcs',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (menu_item_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id              SERIAL PRIMARY KEY,
  ingredient_id   INT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  type            VARCHAR(16) NOT NULL CHECK (type IN ('IN','OUT','ADJUST','WASTE')),
  qty             NUMERIC(14,3) NOT NULL,
  ref_type        VARCHAR(32),
  ref_id          INT,
  note            VARCHAR(255),
  unit_cost       INT NOT NULL DEFAULT 0,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_ingredient ON stock_movements (ingredient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suppliers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  phone           VARCHAR(32),
  address         VARCHAR(255),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              SERIAL PRIMARY KEY,
  po_number       VARCHAR(32) UNIQUE NOT NULL,
  supplier_id     INT REFERENCES suppliers(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  total           INT NOT NULL DEFAULT 0,
  notes           VARCHAR(255),
  created_by      INT REFERENCES users(id),
  received_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              SERIAL PRIMARY KEY,
  po_id           INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id   INT NOT NULL REFERENCES ingredients(id),
  qty             NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_cost       INT NOT NULL DEFAULT 0,
  subtotal        INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id              SERIAL PRIMARY KEY,
  ingredient_id   INT NOT NULL REFERENCES ingredients(id),
  physical_qty    NUMERIC(14,3) NOT NULL,
  system_qty      NUMERIC(14,3) NOT NULL,
  variance        NUMERIC(14,3) NOT NULL,
  reason          VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by      INT REFERENCES users(id),
  approved_by     INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====== MODUL 5: AKUNTANSI (PSAK) ======
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(16) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(16) NOT NULL CHECK (type IN ('aset','kewajiban','ekuitas','pendapatan','hpp','beban')),
  parent_code     VARCHAR(16),
  is_cash         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(16) UNIQUE NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  closed_by       INT REFERENCES users(id),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id              SERIAL PRIMARY KEY,
  entry_no        VARCHAR(32) UNIQUE NOT NULL,
  entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  memo            VARCHAR(255) NOT NULL DEFAULT '',
  ref_type        VARCHAR(32),
  ref_id          INT,
  fiscal_period   VARCHAR(16),
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries (entry_date DESC);

CREATE TABLE IF NOT EXISTS journal_lines (
  id              SERIAL PRIMARY KEY,
  entry_id        INT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code    VARCHAR(16) NOT NULL REFERENCES chart_of_accounts(code),
  debit           INT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          INT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id);

-- ====== UC-204: SHIFT & CASH DRAWER ======
CREATE TABLE IF NOT EXISTS shifts (
  id              SERIAL PRIMARY KEY,
  cashier_id      INT REFERENCES users(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  opening_cash    INT NOT NULL DEFAULT 0,
  closing_cash    INT,
  expected_cash   INT,
  variance        INT,
  status          VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  note            VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS shift_payments (
  id              SERIAL PRIMARY KEY,
  shift_id        INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  order_id        INT REFERENCES orders(id),
  method          VARCHAR(16) NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','qris','va','ewallet')),
  amount          INT NOT NULL CHECK (amount >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====== SEED COA DEFAULT (PSAK ringkas) ======
INSERT INTO chart_of_accounts (code, name, type, is_cash) VALUES
  ('1-1010','Kas / Bank QRIS','aset', TRUE),
  ('1-1020','Kas Tunai Gerobak','aset', TRUE),
  ('1-1200','Persediaan Bahan Baku','aset', FALSE),
  ('2-1000','Utang Usaha','kewajiban', FALSE),
  ('2-1300','Uang Muka Customer','kewajiban', FALSE),
  ('3-1000','Modal Owner','ekuitas', FALSE),
  ('4-1000','Pendapatan Penjualan','pendapatan', FALSE),
  ('5-1000','HPP - Bahan Baku','hpp', FALSE),
  ('6-1000','Beban Operasional','beban', FALSE),
  ('6-2100','Beban Waste / Selisih Opname','beban', FALSE)
ON CONFLICT (code) DO NOTHING;

-- Periode berjalan bulan ini (idempotent)
INSERT INTO fiscal_periods (code, start_date, end_date, is_closed)
VALUES (
  TO_CHAR(NOW(),'YYYY-MM'),
  DATE_TRUNC('month', NOW())::DATE,
  (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
  FALSE
)
ON CONFLICT (code) DO NOTHING;
