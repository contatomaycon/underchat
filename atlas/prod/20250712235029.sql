-- Modify "user" table
ALTER TABLE "user" ALTER COLUMN "email" TYPE character varying(500), ADD COLUMN "email_partial" character varying(25) NOT NULL;
-- Modify "user_address" table
ALTER TABLE "user_address" ALTER COLUMN "street" TYPE character varying(500), DROP COLUMN "number", ADD COLUMN "street_partial" character varying(25) NOT NULL;
-- Modify "user_document" table
ALTER TABLE "user_document" ALTER COLUMN "document" TYPE character varying(500), ADD COLUMN "document_partial" character varying(50) NOT NULL;
-- Modify "user_info" table
ALTER TABLE "user_info" ALTER COLUMN "phone" TYPE character varying(500), ALTER COLUMN "phone" SET NOT NULL, ADD COLUMN "phone_partial" character varying(15) NOT NULL;
