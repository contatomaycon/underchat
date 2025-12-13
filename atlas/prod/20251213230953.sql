-- Create "report_conversation_history_pdf" table
CREATE TABLE "report_conversation_history_pdf" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL,
  "chat_id" uuid NOT NULL,
  "url_pdf" text NULL,
  "status" character varying(20) NOT NULL DEFAULT 'PENDING',
  "requested_at" timestamptz NULL DEFAULT now(),
  "generated_at" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "report_conversation_history_pdf_account_id_account_account_id_f" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
