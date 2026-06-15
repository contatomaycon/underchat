ALTER TABLE "account"
  ALTER COLUMN "generate_invoice" SET DEFAULT true;

UPDATE "account"
SET "generate_invoice" = true
WHERE "generate_invoice" IS DISTINCT FROM true;

ALTER TABLE "account"
  ALTER COLUMN "generate_invoice" SET NOT NULL;
