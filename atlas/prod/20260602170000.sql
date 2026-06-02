ALTER TABLE "worker" ADD COLUMN "lifecycle_operation_id" uuid NULL;

CREATE INDEX "worker_lifecycle_operation_id_idx" ON "worker" ("lifecycle_operation_id");
