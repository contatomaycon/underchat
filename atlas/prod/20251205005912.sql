-- Create "notification_type" table
CREATE TABLE "notification_type" (
  "notification_type_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("notification_type_id")
);
-- Create "notifications" table
CREATE TABLE "notifications" (
  "notification_id" uuid NOT NULL,
  "worker_id" uuid NULL,
  "notification_type_id" uuid NOT NULL,
  "message_whatsapp" text,
  "email_subject" text,
  "message_email" text,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("notification_id"),
  CONSTRAINT "notifications_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_notification_type_id_notification_type_notification_type_id_fk" FOREIGN KEY ("notification_type_id") REFERENCES "notification_type" ("notification_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Insert seed "notification_type" table
INSERT INTO "notification_type" ("notification_type_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e8e', 'TWO_FACTOR', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f8e', 'PLAN_NEW', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9d4e5f6a7b8e', 'PLAN_RENEWAL', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c3d4e5f6a8e', 'PLAN_EXPIRATION', NOW(), NOW())
ON CONFLICT ("notification_type_id") DO NOTHING;