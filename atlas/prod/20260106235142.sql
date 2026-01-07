-- Create "sector_user" table
CREATE TABLE "sector_user" (
  "sector_user_id" uuid NOT NULL,
  "sector_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("sector_user_id"),
  CONSTRAINT "sector_user_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "sector" ("sector_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "sector_user_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
