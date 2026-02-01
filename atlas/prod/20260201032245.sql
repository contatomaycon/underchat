-- Modify "voice_ia" table
ALTER TABLE "voice_ia" ADD COLUMN "enable_transcription" boolean NOT NULL DEFAULT true;
