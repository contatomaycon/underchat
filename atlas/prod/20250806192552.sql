-- Create "chat_user" table
CREATE TABLE "chat_user" (
  "chat_user_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "about" character varying(200) NULL,
  "status" character varying(100) NULL,
  "notifications" boolean NULL DEFAULT true,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("chat_user_id"),
  CONSTRAINT "chat_user_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
