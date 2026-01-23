-- Modify "release_access" table
ALTER TABLE "release_access" DROP COLUMN "viewed";
-- Create "release_view" table
CREATE TABLE "release_view" (
  "release_view_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("release_view_id"),
  CONSTRAINT "release_view_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "release" ("release_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "release_view_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "release_view_release_id_idx" to table: "release_view"
CREATE INDEX "release_view_release_id_idx" ON "release_view" ("release_id");
-- Create index "release_view_release_id_user_id_idx" to table: "release_view"
CREATE INDEX "release_view_release_id_user_id_idx" ON "release_view" ("release_id", "user_id");
-- Create index "release_view_user_id_idx" to table: "release_view"
CREATE INDEX "release_view_user_id_idx" ON "release_view" ("user_id");
