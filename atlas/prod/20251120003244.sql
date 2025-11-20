-- Create "worker_profile_status_contact" table
CREATE TABLE "worker_profile_status_contact" (
  "worker_profile_status_contact_id" uuid NOT NULL,
  "worker_profile_status_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("worker_profile_status_contact_id"),
  CONSTRAINT "worker_profile_status_contact_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "worker_profile_status_contact_worker_profile_status_id_worker_p" FOREIGN KEY ("worker_profile_status_id") REFERENCES "worker_profile_status" ("worker_profile_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
