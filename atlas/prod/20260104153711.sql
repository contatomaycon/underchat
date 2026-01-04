-- Create "worker_config_status" table
CREATE TABLE "worker_config_status" (
  "worker_config_status_id" uuid NOT NULL,
  "status" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_config_status_id")
);
-- Create "worker_config_type" table
CREATE TABLE "worker_config_type" (
  "worker_config_type_id" uuid NOT NULL,
  "type" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_config_type_id")
);
-- Insert default status values
INSERT INTO "worker_config_status" ("worker_config_status_id", "status") VALUES 
  ('019b89ac-4cd6-7583-a7f0-9dc4631b7edc'::uuid, 'ativo'),
  ('019b89ac-4cd7-75af-a657-6e2eaae68143'::uuid, 'inativo');
-- Insert default type values
INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES 
  ('019b89ac-697c-768e-a69a-e1cb80cde900'::uuid, 'is_automatic_attendance'),
  ('019b89ac-697d-750c-b404-0d52ac735a0c'::uuid, 'show_attendee_name'),
  ('019b89ac-697d-750c-b404-138f5cb791da'::uuid, 'show_worker_name'),
  ('019b89ac-697d-750c-b404-1786f896d04c'::uuid, 'allow_attendance_only_online'),
  ('019b89ac-697d-750c-b404-18cfe47c791e'::uuid, 'simultaneous_attendance'),
  ('019b89ac-697d-750c-b404-1ed338f8324a'::uuid, 'generate_protocol_at_start'),
  ('019b89ac-697d-750c-b404-207f03dc5b3c'::uuid, 'generate_protocol_at_transfer'),
  ('019b89ac-697d-750c-b404-241ec3feab8d'::uuid, 'show_message_on_call'),
  ('019b89ac-697d-750c-b404-2814beaa64cf'::uuid, 'send_message_on_finish_attendance'),
  ('019b89ac-697e-75cb-83a0-13761ab6d869'::uuid, 'reject_call'),
  ('019b89ac-697e-75cb-83a0-15f55c82806a'::uuid, 'auto_save_contacts');
-- Delete all existing data from worker_config
DELETE FROM "worker_config";
-- Add new columns as NOT NULL
ALTER TABLE "worker_config" 
  ADD COLUMN "worker_config_status_id" uuid NOT NULL,
  ADD COLUMN "worker_config_type_id" uuid NOT NULL,
  ADD COLUMN "value" character varying(2000) NULL;
-- Add foreign key constraints
ALTER TABLE "worker_config" 
  ADD CONSTRAINT "worker_config_worker_config_status_id_worker_config_status_work" FOREIGN KEY ("worker_config_status_id") REFERENCES "worker_config_status" ("worker_config_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  ADD CONSTRAINT "worker_config_worker_config_type_id_worker_config_type_worker_c" FOREIGN KEY ("worker_config_type_id") REFERENCES "worker_config_type" ("worker_config_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Drop old columns
ALTER TABLE "worker_config" 
  DROP COLUMN "is_automatic_attendance", 
  DROP COLUMN "show_attendee_name", 
  DROP COLUMN "show_worker_name", 
  DROP COLUMN "allow_attendance_only_online", 
  DROP COLUMN "generate_protocol_at_start", 
  DROP COLUMN "generate_protocol_at_transfer", 
  DROP COLUMN "show_message_on_call", 
  DROP COLUMN "auto_save_contacts", 
  DROP COLUMN "simultaneous_attendance", 
  DROP COLUMN "send_message_on_finish_attendance", 
  DROP COLUMN "reject_call";
