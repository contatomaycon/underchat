-- Create "worker_phone_connection" table
CREATE TABLE "worker_phone_connection" (
  "worker_phone_connection_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "number" character varying(20) NULL,
  "attempt" integer NOT NULL DEFAULT 0,
  "date_attempt" timestamptz NULL DEFAULT now(),
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_phone_connection_id"),
  CONSTRAINT "worker_phone_connection_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
