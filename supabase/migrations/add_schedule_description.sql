-- Migration: campos em ma_schedules e ma_recados
-- Execute este SQL no Supabase Dashboard → SQL Editor

-- ma_schedules
ALTER TABLE ma_schedules ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE ma_schedules ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ma_recados
ALTER TABLE ma_recados ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE ma_recados ADD COLUMN IF NOT EXISTS read           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ma_recados ADD COLUMN IF NOT EXISTS read_at        TIMESTAMPTZ;
ALTER TABLE ma_recados ADD COLUMN IF NOT EXISTS sent_at_iso    DATE;
