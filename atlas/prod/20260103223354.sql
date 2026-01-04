-- Create "contact_document_type" table
CREATE TABLE "contact_document_type" (
  "contact_document_type_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("contact_document_type_id")
);

-- Insert contact document types
INSERT INTO "contact_document_type" ("contact_document_type_id", "name") VALUES ('019a930d-c6f5-75af-82a5-94b2a24a317c', 'CPF');
INSERT INTO "contact_document_type" ("contact_document_type_id", "name") VALUES ('019a930d-c6f5-75af-82a5-99f4ec242bb6', 'CNPJ');

-- Add document fields to contact table
ALTER TABLE "contact" ADD COLUMN "contact_document_type_id" uuid NULL;
ALTER TABLE "contact" ADD COLUMN "document" character varying(500) NULL;

-- Add foreign key constraint
ALTER TABLE "contact" ADD CONSTRAINT "contact_contact_document_type_id_contact_document_type_contact_document_type_id_fk" FOREIGN KEY ("contact_document_type_id") REFERENCES "contact_document_type" ("contact_document_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION;