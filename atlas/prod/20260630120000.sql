CREATE TABLE IF NOT EXISTS "whatsapp_message_template" (
  "whatsapp_message_template_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "worker_whatsapp_official_connection_id" uuid,
  "waba_id" varchar(255) NOT NULL,
  "meta_template_id" varchar(255),
  "name" varchar(512) NOT NULL,
  "language" varchar(50) NOT NULL,
  "category" varchar(80) NOT NULL,
  "sub_category" varchar(120),
  "parameter_format" varchar(40),
  "components" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(80) NOT NULL,
  "quality_score" varchar(80),
  "rejected_reason" text,
  "message_send_ttl_seconds" integer,
  "meta_payload" jsonb,
  "origin" varchar(40) DEFAULT 'underchat' NOT NULL,
  "sync_state" varchar(40) DEFAULT 'draft' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "whatsapp_message_template_account_id_account_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "account"("account_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "whatsapp_message_template_worker_id_worker_worker_id_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker"("worker_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "whatsapp_message_template_official_connection_fk"
    FOREIGN KEY ("worker_whatsapp_official_connection_id")
    REFERENCES "worker_whatsapp_official_connection"("worker_whatsapp_official_connection_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_message_template_worker_meta_template_uidx"
  ON "whatsapp_message_template" ("worker_id", "meta_template_id");

CREATE INDEX IF NOT EXISTS "whatsapp_message_template_account_worker_idx"
  ON "whatsapp_message_template" ("account_id", "worker_id");

CREATE INDEX IF NOT EXISTS "whatsapp_message_template_worker_status_idx"
  ON "whatsapp_message_template" ("worker_id", "status");

CREATE INDEX IF NOT EXISTS "whatsapp_message_template_worker_category_idx"
  ON "whatsapp_message_template" ("worker_id", "category");

CREATE INDEX IF NOT EXISTS "whatsapp_message_template_name_language_idx"
  ON "whatsapp_message_template" ("worker_id", "name", "language");

CREATE INDEX IF NOT EXISTS "whatsapp_message_template_deleted_at_idx"
  ON "whatsapp_message_template" ("deleted_at");
