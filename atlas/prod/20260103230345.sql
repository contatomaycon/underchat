-- Add document encryption fields to contact table
ALTER TABLE "contact" ADD COLUMN "document_partial" character varying(20) NULL;
ALTER TABLE "contact" ADD COLUMN "document_c" character varying(500) NULL;
