-- Modify "worker" table
ALTER TABLE "worker" ADD COLUMN "last_connection_check_at" timestamptz NULL;
