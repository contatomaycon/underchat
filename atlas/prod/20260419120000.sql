-- Adiciona data/hora agendada para releases do tipo "lembrete" (reminder).
ALTER TABLE "release"
  ADD COLUMN IF NOT EXISTS "reminder_at" timestamptz NULL;
