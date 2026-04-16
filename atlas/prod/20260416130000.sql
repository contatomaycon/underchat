-- Create "s3_backup_upload" table
CREATE TABLE "s3_backup_upload" (
  "s3_backup_upload_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "bucket" character varying(255) NOT NULL,
  "object_key" character varying(2000) NOT NULL,
  "file_name" character varying(255) NULL,
  "content_type" character varying(255) NULL,
  "size_bytes" integer NOT NULL,
  "primary_attempts" integer NOT NULL DEFAULT 0,
  "backup_attempts" integer NOT NULL DEFAULT 0,
  "primary_error" text NULL,
  "backup_error" text NULL,
  "migration_status" character varying(20) NOT NULL DEFAULT 'pending',
  "migration_attempts" integer NOT NULL DEFAULT 0,
  "migration_last_error" text NULL,
  "migrated_at" timestamptz NULL,
  "reprocess_requested_at" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  CONSTRAINT "s3_backup_upload_pkey" PRIMARY KEY ("s3_backup_upload_id"),
  CONSTRAINT "s3_backup_upload_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "s3_backup_upload_migration_status_check" CHECK (
    "migration_status" IN ('pending', 'processing', 'failed', 'migrated')
  )
);

-- Create index "s3_backup_upload_account_id_idx" to table: "s3_backup_upload"
CREATE INDEX "s3_backup_upload_account_id_idx" ON "s3_backup_upload" ("account_id");

-- Create index "s3_backup_upload_deleted_at_idx" to table: "s3_backup_upload"
CREATE INDEX "s3_backup_upload_deleted_at_idx" ON "s3_backup_upload" ("deleted_at");

-- Create index "s3_backup_upload_migration_status_idx" to table: "s3_backup_upload"
CREATE INDEX "s3_backup_upload_migration_status_idx" ON "s3_backup_upload" ("migration_status");

-- Create index "s3_backup_upload_migration_status_deleted_at_created_at_idx" to table: "s3_backup_upload"
CREATE INDEX "s3_backup_upload_migration_status_deleted_at_created_at_idx" ON "s3_backup_upload" ("migration_status", "deleted_at", "created_at");

-- Create index "s3_backup_upload_account_id_deleted_at_created_at_idx" to table: "s3_backup_upload"
CREATE INDEX "s3_backup_upload_account_id_deleted_at_created_at_idx" ON "s3_backup_upload" ("account_id", "deleted_at", "created_at");