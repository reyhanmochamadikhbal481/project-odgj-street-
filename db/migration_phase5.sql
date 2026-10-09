-- ============================================================
-- Migrasi Fase 5: slot waktu reservasi (tutup per hari/sesi)
-- Idempotent — aman dijalankan ulang
-- ============================================================

-- 1. Slot bisa ditutup (libur / maintenance) tanpa menghapus baris
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Slot default: setiap hari, 15.00–23.00 per jam (sesi 120 mnt → tutup 01.00)
--    Kapasitas default 20 orang/sesi. ON CONFLICT aman dijalankan ulang.
INSERT INTO time_slots (day_of_week, start_ts, end_ts, capacity, booked, is_closed)
SELECT dow, s.start_ts::time, (s.start_ts::time + INTERVAL '120 minutes')::time, 20, 0, FALSE
FROM generate_series(0, 6) AS dow,
     (VALUES ('15:00'),('16:00'),('17:00'),('18:00'),('19:00'),
             ('20:00'),('21:00'),('22:00'),('23:00')) AS s(start_ts)
ON CONFLICT (day_of_week, start_ts) DO NOTHING;
