-- Add validation provenance without changing the public contact contract.
ALTER TABLE "contact" ADD COLUMN "validation_origin" character varying(32) NULL;

ALTER TABLE "contact"
  ADD CONSTRAINT "contact_validation_origin_check"
  CHECK (
    "validation_origin" IS NULL
    OR (
      "is_valided" IS TRUE
      AND "validation_origin" IN (
        'whatsapp_lookup',
        'official_assumed',
        'official_inbound'
      )
    )
  );
