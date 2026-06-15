-- Migration: adiciona campos à tabela ma_schedules
-- Execute este SQL no Supabase Dashboard → SQL Editor

ALTER TABLE ma_schedules ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE ma_schedules ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
