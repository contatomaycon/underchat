CREATE TABLE "official_whatsapp_conversation_window" (
  "official_whatsapp_conversation_window_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "contact_id" uuid,
  "phone" varchar(32) NOT NULL,
  "remote_jid" varchar(255),
  "last_inbound_message_id" varchar(255),
  "last_inbound_at" timestamp with time zone,
  "service_window_expires_at" timestamp with time zone,
  "awaiting_contact_reply_since" timestamp with time zone,
  "awaiting_template_message_id" varchar(255),
  "last_template_sent_at" timestamp with time zone,
  "last_outbound_message_id" varchar(255),
  "last_outbound_at" timestamp with time zone,
  "last_meta_error_code" integer,
  "closed_reason" varchar(80),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "official_whatsapp_conversation_window_account_id_account_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "account"("account_id"),
  CONSTRAINT "official_whatsapp_conversation_window_worker_id_worker_worker_id_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker"("worker_id"),
  CONSTRAINT "official_whatsapp_conversation_window_contact_id_contact_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contact"("contact_id")
);

CREATE UNIQUE INDEX "official_whatsapp_conversation_window_account_worker_phone_uidx"
  ON "official_whatsapp_conversation_window" ("account_id", "worker_id", "phone");

CREATE INDEX "official_whatsapp_conversation_window_worker_phone_idx"
  ON "official_whatsapp_conversation_window" ("worker_id", "phone");

CREATE INDEX "official_whatsapp_conversation_window_contact_idx"
  ON "official_whatsapp_conversation_window" ("contact_id");

CREATE INDEX "official_whatsapp_conversation_window_expires_idx"
  ON "official_whatsapp_conversation_window" ("service_window_expires_at");

CREATE INDEX "official_whatsapp_conversation_window_awaiting_idx"
  ON "official_whatsapp_conversation_window" ("awaiting_contact_reply_since");
