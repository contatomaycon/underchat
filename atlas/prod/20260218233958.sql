-- Modify "account" table
ALTER TABLE "account" ADD COLUMN "bucket_deleted" boolean NULL DEFAULT false;
