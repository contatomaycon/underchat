-- Create "server_build_version" table
CREATE TABLE "server_build_version" (
  "server_build_version_id" uuid NOT NULL,
  "build_type" character varying(50) NOT NULL,
  "version" character varying(120) NOT NULL,
  "harbor_registry" character varying(255) NOT NULL,
  "harbor_repository" character varying(500) NOT NULL,
  "image_reference" character varying(1000) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("server_build_version_id")
);
-- Create index "server_build_version_build_type_created_at_idx" to table: "server_build_version"
CREATE INDEX "server_build_version_build_type_created_at_idx" ON "server_build_version" ("build_type", "created_at");
-- Create index "server_build_version_build_type_idx" to table: "server_build_version"
CREATE INDEX "server_build_version_build_type_idx" ON "server_build_version" ("build_type");
-- Create index "server_build_version_build_type_version_uq" to table: "server_build_version"
CREATE UNIQUE INDEX "server_build_version_build_type_version_uq" ON "server_build_version" ("build_type", "version");
-- Create index "server_build_version_is_default_idx" to table: "server_build_version"
CREATE INDEX "server_build_version_is_default_idx" ON "server_build_version" ("is_default");
-- Create "server_build_job" table
CREATE TABLE "server_build_job" (
  "server_build_job_id" uuid NOT NULL,
  "requested_by" uuid NULL,
  "version" character varying(120) NOT NULL,
  "status" character varying(50) NOT NULL,
  "error_message" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "started_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  PRIMARY KEY ("server_build_job_id"),
  CONSTRAINT "server_build_job_requested_by_user_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "server_build_job_created_at_idx" to table: "server_build_job"
CREATE INDEX "server_build_job_created_at_idx" ON "server_build_job" ("created_at");
-- Create index "server_build_job_requested_by_idx" to table: "server_build_job"
CREATE INDEX "server_build_job_requested_by_idx" ON "server_build_job" ("requested_by");
-- Create index "server_build_job_status_idx" to table: "server_build_job"
CREATE INDEX "server_build_job_status_idx" ON "server_build_job" ("status");
-- Create "server_build_job_item" table
CREATE TABLE "server_build_job_item" (
  "server_build_job_item_id" uuid NOT NULL,
  "server_build_job_id" uuid NOT NULL,
  "build_type" character varying(50) NOT NULL,
  "status" character varying(50) NOT NULL,
  "image_reference" character varying(1000) NULL,
  "error_message" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "started_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  PRIMARY KEY ("server_build_job_item_id"),
  CONSTRAINT "server_build_job_item_server_build_job_id_server_build_job_serv" FOREIGN KEY ("server_build_job_id") REFERENCES "server_build_job" ("server_build_job_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "server_build_job_item_job_id_build_type_uq" to table: "server_build_job_item"
CREATE UNIQUE INDEX "server_build_job_item_job_id_build_type_uq" ON "server_build_job_item" ("server_build_job_id", "build_type");
-- Create index "server_build_job_item_job_id_idx" to table: "server_build_job_item"
CREATE INDEX "server_build_job_item_job_id_idx" ON "server_build_job_item" ("server_build_job_id");
-- Create index "server_build_job_item_status_idx" to table: "server_build_job_item"
CREATE INDEX "server_build_job_item_status_idx" ON "server_build_job_item" ("status");
