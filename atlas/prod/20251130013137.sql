-- Create "chatbot" table
CREATE TABLE "chatbot" (
  "chatbot_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "name" character varying(255) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("chatbot_id"),
  CONSTRAINT "chatbot_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
