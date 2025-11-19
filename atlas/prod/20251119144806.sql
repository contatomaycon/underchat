-- Create "worker_config" table
CREATE TABLE "worker_config" (
  "worker_config_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "worker_config_status_id" uuid NOT NULL,
  "is_automatic_attendance" boolean NULL DEFAULT false,
  "show_attendee_name" boolean NULL DEFAULT false,
  "show_worker_name" boolean NULL DEFAULT false,
  "generate_protocol_at_ura" boolean NULL DEFAULT false,
  "generate_protocol_at_start" boolean NULL DEFAULT false,
  "generate_protocol_at_transfer" boolean NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_config_id"),
  CONSTRAINT "worker_config_worker_config_status_id_worker_config_status_work" FOREIGN KEY ("worker_config_status_id") REFERENCES "worker_config_status" ("worker_config_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "worker_config_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "worker_profile_info" table
CREATE TABLE "worker_profile_info" (
  "worker_profile_info_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "name" character varying(100) NULL,
  "message" character varying(500) NULL,
  "photo" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_profile_info_id"),
  CONSTRAINT "worker_profile_info_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- Create "worker_profile_status_type" table
CREATE TABLE "worker_profile_status_type" (
  "worker_profile_status_type_id" uuid NOT NULL,
  "type" character varying(500) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_profile_status_type_id")
);

-- Create "worker_profile_status" table
CREATE TABLE "worker_profile_status" (
  "worker_profile_status_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "worker_profile_status_type_id" uuid NOT NULL,
  "url" character varying(500) NOT NULL,
  "is_permanent" boolean NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_profile_status_id"),
  CONSTRAINT "worker_profile_status_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "worker_profile_status_worker_profile_status_type_id_worker_profile_status_type_worker_profile_status_type_id_fk" FOREIGN KEY ("worker_profile_status_type_id") REFERENCES "worker_profile_status_type" ("worker_profile_status_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
