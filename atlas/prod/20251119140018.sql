-- Create "worker_config_status" table
CREATE TABLE "worker_config_status" (
  "worker_config_status_id" uuid NOT NULL,
  "status" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_config_status_id")
);