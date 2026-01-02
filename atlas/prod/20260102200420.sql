-- Modify "worker_config" table
ALTER TABLE "worker_config" ADD COLUMN "send_message_on_finish_attendance" character varying(2000) NULL, ADD COLUMN "reject_call" boolean NULL DEFAULT false;
