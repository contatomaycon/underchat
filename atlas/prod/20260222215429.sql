-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "voice_ia_input_mode" character varying(20) NULL DEFAULT 'audio_and_text', ADD COLUMN "voice_ia_output_mode" character varying(20) NULL DEFAULT 'audio';
-- Modify "voice_ia" table
ALTER TABLE "voice_ia" DROP COLUMN "enable_transcription";
