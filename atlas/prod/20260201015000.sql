-- Create "voice_ia" table
CREATE TABLE "voice_ia" (
  "voice_ia_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "name" character varying(200) NOT NULL,
  "voice_ia_type" character varying(50) NOT NULL DEFAULT 'eleven_labs',
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "api_key" character varying(2000) NULL,
  "language_code" character varying(10) NOT NULL DEFAULT 'pt-BR',
  "voice_id" character varying(100) NOT NULL,
  "model_id" character varying(100) NOT NULL DEFAULT 'eleven_multilingual_v2',
  "speed" character varying(10) NOT NULL DEFAULT '1',
  "stability" character varying(10) NOT NULL DEFAULT '0.5',
  "similarity_boost" character varying(10) NOT NULL DEFAULT '0.75',
  "style_exaggeration" character varying(10) NOT NULL DEFAULT '0',
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("voice_ia_id"),
  CONSTRAINT "voice_ia_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "voice_ia_account_id_idx" to table: "voice_ia"
CREATE INDEX "voice_ia_account_id_idx" ON "voice_ia" ("account_id");
-- Create index "voice_ia_status_idx" to table: "voice_ia"
CREATE INDEX "voice_ia_status_idx" ON "voice_ia" ("status");
