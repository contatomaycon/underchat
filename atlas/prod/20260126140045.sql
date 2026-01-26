-- Modify "api_key" table
ALTER TABLE "api_key" ADD COLUMN "status" character varying(20) NOT NULL DEFAULT 'active';
