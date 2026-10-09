-- ============================================================
-- Migrasi Fase 4: reminder log + hardening kecil
-- Idempotent
-- ============================================================

CREATE TABLE IF NOT EXISTS reminder_logs (
  id              SERIAL PRIMARY KEY,
  reservation_id  INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  kind            VARCHAR(16) NOT NULL CHECK (kind IN ('H-1','H-2')),
  channel         VARCHAR(16) NOT NULL DEFAULT 'wa',
  target          VARCHAR(32),
  message         TEXT,
  provider_ref    VARCHAR(128),
  status          VARCHAR(16) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','mock','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reservation_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_reminder_res ON reminder_logs (reservation_id);

-- Kolom HP staf (dipakai reminder fallback + profil)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

-- Payload audit untuk DP (dipakai deposit/create mock & Snap)
ALTER TABLE deposit_payments ADD COLUMN IF NOT EXISTS raw_payload JSONB;
