-- Add "created_by_user_id" to "release" table
ALTER TABLE "release" ADD COLUMN "created_by_user_id" uuid NULL;
ALTER TABLE "release" ADD CONSTRAINT "release_created_by_user_id_user_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
CREATE INDEX "release_created_by_user_id_idx" ON "release" ("created_by_user_id");