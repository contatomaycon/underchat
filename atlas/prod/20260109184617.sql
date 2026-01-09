-- Modify "contact" table
ALTER TABLE "contact" ADD COLUMN "ignore" character varying(20) NULL DEFAULT 'not_ignore';
