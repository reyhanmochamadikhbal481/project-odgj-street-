-- ============================================================
-- Migrasi Fase 3: perbaikan reservasi + pembayaran mock + laporan
-- Idempotent
-- ============================================================

-- 1. Reservasi guest (tanpa akun): customer_id boleh NULL + kolom tamu
ALTER TABLE reservations ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_name VARCHAR(100);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(32);

-- 2. Status 'seated' (check-in) diizinkan
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('pending','confirmed','paid','seated','cancelled','no_show'));

ALTER TABLE reservation_tables DROP CONSTRAINT IF EXISTS reservation_tables_status_check;
ALTER TABLE reservation_tables ADD CONSTRAINT reservation_tables_status_check
  CHECK (status IN ('pending','confirmed','occupied','cancelled'));

-- 3. Unique slot agar ON CONFLICT bekerja
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_slots_dow_start ON time_slots (day_of_week, start_ts);

-- 4. Payments: dukung cash mock + idempotensi order tunggal
ALTER TABLE payments ADD COLUMN IF NOT EXISTS mock BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Perbaiki FK basi: reservation_tables.table_id harus → tables(id), bukan orders(id)
ALTER TABLE reservation_tables DROP CONSTRAINT IF EXISTS reservation_tables_table_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tables_table_id_fkey') THEN
    ALTER TABLE reservation_tables ADD CONSTRAINT reservation_tables_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id);
  END IF;
END $$;
