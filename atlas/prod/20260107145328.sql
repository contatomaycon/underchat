-- Create "push_subscription" table
CREATE TABLE "push_subscription" (
  "push_subscription_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("push_subscription_id"),
  CONSTRAINT "push_subscription_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
