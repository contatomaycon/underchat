-- Modify "plan" table
ALTER TABLE "plan" ADD COLUMN "status" character varying(20) NOT NULL DEFAULT 'active', ADD COLUMN "is_exclusive" boolean NOT NULL DEFAULT false;
