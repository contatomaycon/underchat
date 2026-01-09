-- Modify "sector" table - increase name field length from 20 to 100 characters
ALTER TABLE "sector" ALTER COLUMN "name" TYPE character varying(100);