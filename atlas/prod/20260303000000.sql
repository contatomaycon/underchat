-- Modify column "phone_partial" on table "contact" to support longer masked phone formats
ALTER TABLE "contact" ALTER COLUMN "phone_partial" TYPE character varying(20);
