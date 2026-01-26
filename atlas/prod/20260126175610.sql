-- Modify "api_key" table
ALTER TABLE "api_key" ADD COLUMN "worker_id" uuid NULL, ADD CONSTRAINT "api_key_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Create index "api_key_worker_id_account_id_deleted_at_idx" to table: "api_key"
CREATE INDEX "api_key_worker_id_account_id_deleted_at_idx" ON "api_key" ("worker_id", "account_id", "deleted_at");
-- Create index "api_key_worker_id_account_id_idx" to table: "api_key"
CREATE INDEX "api_key_worker_id_account_id_idx" ON "api_key" ("worker_id", "account_id");
-- Create index "api_key_worker_id_deleted_at_idx" to table: "api_key"
CREATE INDEX "api_key_worker_id_deleted_at_idx" ON "api_key" ("worker_id", "deleted_at");
-- Create index "api_key_worker_id_idx" to table: "api_key"
CREATE INDEX "api_key_worker_id_idx" ON "api_key" ("worker_id");
