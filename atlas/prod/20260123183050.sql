-- Create "release" table
CREATE TABLE "release" (
  "release_id" uuid NOT NULL,
  "account_id" uuid NULL,
  "type" character varying(20) NOT NULL DEFAULT 'informative',
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "title" character varying(200) NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("release_id"),
  CONSTRAINT "release_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "release_account_id_idx" to table: "release"
CREATE INDEX "release_account_id_idx" ON "release" ("account_id");
-- Create index "release_account_id_status_idx" to table: "release"
CREATE INDEX "release_account_id_status_idx" ON "release" ("account_id", "status");
-- Create index "release_status_idx" to table: "release"
CREATE INDEX "release_status_idx" ON "release" ("status");
-- Create index "release_type_idx" to table: "release"
CREATE INDEX "release_type_idx" ON "release" ("type");
-- Create "release_access" table
CREATE TABLE "release_access" (
  "release_access_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "account_id" uuid NULL,
  "user_id" uuid NULL,
  "permission_role_id" uuid NULL,
  "viewed" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("release_access_id"),
  CONSTRAINT "release_access_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "release_access_permission_role_id_permission_role_permission_ro" FOREIGN KEY ("permission_role_id") REFERENCES "permission_role" ("permission_role_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "release_access_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "release" ("release_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "release_access_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "release_access_account_id_idx" to table: "release_access"
CREATE INDEX "release_access_account_id_idx" ON "release_access" ("account_id");
-- Create index "release_access_permission_role_id_idx" to table: "release_access"
CREATE INDEX "release_access_permission_role_id_idx" ON "release_access" ("permission_role_id");
-- Create index "release_access_release_id_idx" to table: "release_access"
CREATE INDEX "release_access_release_id_idx" ON "release_access" ("release_id");
-- Create index "release_access_release_id_viewed_idx" to table: "release_access"
CREATE INDEX "release_access_release_id_viewed_idx" ON "release_access" ("release_id", "viewed");
-- Create index "release_access_user_id_idx" to table: "release_access"
CREATE INDEX "release_access_user_id_idx" ON "release_access" ("user_id");
-- Create index "release_access_viewed_idx" to table: "release_access"
CREATE INDEX "release_access_viewed_idx" ON "release_access" ("viewed");
