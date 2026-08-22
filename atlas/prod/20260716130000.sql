-- Persist the active provider connection in the same PostgreSQL row that
-- guards runtime_generation. Connection activation is linearized in the
-- database before the matching Redis fence is published.
ALTER TABLE "worker_runtime"
  ADD COLUMN "connection_epoch" varchar(100),
  ADD COLUMN "connection_sequence" bigint DEFAULT 0 NOT NULL,
  ADD COLUMN "source_provider" varchar(20),
  ADD COLUMN "connection_activated_at" timestamptz;

ALTER TABLE "worker_runtime"
  ADD CONSTRAINT "worker_runtime_connection_sequence_nonnegative_check"
  CHECK ("connection_sequence" >= 0);
