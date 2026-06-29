CREATE TABLE IF NOT EXISTS "whatsapp_embedded_config" (
  "whatsapp_embedded_config_id" uuid PRIMARY KEY NOT NULL,
  "singleton_key" boolean DEFAULT true NOT NULL,
  "app_id" varchar(255) NOT NULL,
  "app_secret_encrypted" varchar(4000) NOT NULL,
  "configuration_id" varchar(255) NOT NULL,
  "api_version" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "whatsapp_embedded_config_singleton_key_check"
    CHECK ("singleton_key" = true)
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_embedded_config_singleton_key_uidx"
  ON "whatsapp_embedded_config" ("singleton_key");

CREATE TABLE IF NOT EXISTS "worker_whatsapp_official_connection" (
  "worker_whatsapp_official_connection_id" uuid PRIMARY KEY NOT NULL,
  "worker_id" uuid NOT NULL,
  "business_id" varchar(255),
  "waba_id" varchar(255) NOT NULL,
  "phone_number_id" varchar(255) NOT NULL,
  "display_phone_number" varchar(50),
  "verified_name" varchar(500),
  "access_token_encrypted" varchar(4000) NOT NULL,
  "token_type" varchar(50),
  "expires_at" timestamp with time zone,
  "scope" text,
  "api_version" varchar(20) NOT NULL,
  "connected_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "worker_whatsapp_official_connection_worker_id_worker_worker_id_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker"("worker_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "worker_whatsapp_official_connection_worker_id_idx"
  ON "worker_whatsapp_official_connection" ("worker_id");

CREATE INDEX IF NOT EXISTS "worker_whatsapp_official_connection_waba_id_idx"
  ON "worker_whatsapp_official_connection" ("waba_id");

CREATE INDEX IF NOT EXISTS "worker_whatsapp_official_connection_phone_number_id_idx"
  ON "worker_whatsapp_official_connection" ("phone_number_id");

CREATE INDEX IF NOT EXISTS "worker_whatsapp_official_connection_deleted_at_idx"
  ON "worker_whatsapp_official_connection" ("deleted_at");

CREATE INDEX IF NOT EXISTS "worker_whatsapp_official_connection_worker_id_deleted_at_idx"
  ON "worker_whatsapp_official_connection" ("worker_id", "deleted_at");
