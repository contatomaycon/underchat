-- Modify "contact" table
ALTER TABLE "contact" DROP CONSTRAINT "contact_user_id_fkey", ADD CONSTRAINT "contact_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
