CREATE TABLE "server_build_version" (
  "server_build_version_id" uuid NOT NULL,
  "build_type" character varying(50) NOT NULL,
  "version" character varying(120) NOT NULL,
  "harbor_registry" character varying(255) NOT NULL,
  "harbor_repository" character varying(500) NOT NULL,
  "image_reference" character varying(1000) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NULL DEFAULT now(),
  "updated_at" timestamp with time zone NULL DEFAULT now(),
  PRIMARY KEY ("server_build_version_id"),
  CONSTRAINT "server_build_version_build_type_version_uq" UNIQUE ("build_type", "version")
);

CREATE TABLE "server_build_job" (
  "server_build_job_id" uuid NOT NULL,
  "requested_by" uuid NULL,
  "version" character varying(120) NOT NULL,
  "status" character varying(50) NOT NULL,
  "error_message" text NULL,
  "created_at" timestamp with time zone NULL DEFAULT now(),
  "updated_at" timestamp with time zone NULL DEFAULT now(),
  "started_at" timestamp with time zone NULL,
  "finished_at" timestamp with time zone NULL,
  PRIMARY KEY ("server_build_job_id"),
  CONSTRAINT "server_build_job_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE "server_build_job_item" (
  "server_build_job_item_id" uuid NOT NULL,
  "server_build_job_id" uuid NOT NULL,
  "build_type" character varying(50) NOT NULL,
  "status" character varying(50) NOT NULL,
  "image_reference" character varying(1000) NULL,
  "error_message" text NULL,
  "created_at" timestamp with time zone NULL DEFAULT now(),
  "updated_at" timestamp with time zone NULL DEFAULT now(),
  "started_at" timestamp with time zone NULL,
  "finished_at" timestamp with time zone NULL,
  PRIMARY KEY ("server_build_job_item_id"),
  CONSTRAINT "server_build_job_item_job_id_build_type_uq" UNIQUE ("server_build_job_id", "build_type"),
  CONSTRAINT "server_build_job_item_server_build_job_id_fkey" FOREIGN KEY ("server_build_job_id") REFERENCES "server_build_job" ("server_build_job_id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX "server_build_version_build_type_idx" ON "server_build_version" ("build_type");
CREATE INDEX "server_build_version_build_type_created_at_idx" ON "server_build_version" ("build_type", "created_at");
CREATE INDEX "server_build_version_is_default_idx" ON "server_build_version" ("is_default");
CREATE UNIQUE INDEX "server_build_version_default_by_type_uq" ON "server_build_version" ("build_type") WHERE ("is_default" = true);

CREATE INDEX "server_build_job_status_idx" ON "server_build_job" ("status");
CREATE INDEX "server_build_job_created_at_idx" ON "server_build_job" ("created_at");
CREATE INDEX "server_build_job_requested_by_idx" ON "server_build_job" ("requested_by");
CREATE UNIQUE INDEX "server_build_job_active_unique_idx" ON "server_build_job" ((1)) WHERE ("status" IN ('queued', 'running', 'cancel_requested'));

CREATE INDEX "server_build_job_item_job_id_idx" ON "server_build_job_item" ("server_build_job_id");
CREATE INDEX "server_build_job_item_status_idx" ON "server_build_job_item" ("status");
