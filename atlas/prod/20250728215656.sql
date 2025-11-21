-- Create "sector_status" table
CREATE TABLE "sector_status" (
  "sector_status_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("sector_status_id")
);
-- Create "sector" table
CREATE TABLE "sector" (
  "sector_id" uuid NOT NULL,
  "sector_status_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "color" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("sector_id"),
  CONSTRAINT "sector_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "sector_sector_status_id_sector_status_sector_status_id_fk" FOREIGN KEY ("sector_status_id") REFERENCES "sector_status" ("sector_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "sector_role" table
CREATE TABLE "sector_role" (
  "sector_role_id" uuid NOT NULL,
  "sector_id" uuid NOT NULL,
  "permission_role_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("sector_role_id"),
  CONSTRAINT "sector_role_permission_role_id_permission_role_permission_role_" FOREIGN KEY ("permission_role_id") REFERENCES "permission_role" ("permission_role_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "sector_role_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "sector" ("sector_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
