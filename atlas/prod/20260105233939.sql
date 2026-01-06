-- Alter user_address table to allow null values for optional fields
ALTER TABLE "user_address" 
  ALTER COLUMN "zip_code" DROP NOT NULL,
  ALTER COLUMN "address1" DROP NOT NULL,
  ALTER COLUMN "address1_partial" DROP NOT NULL,
  ALTER COLUMN "address1_c" DROP NOT NULL,
  ALTER COLUMN "district" DROP NOT NULL;

-- Alter user_document table to allow null values for optional fields
ALTER TABLE "user_document" 
  ALTER COLUMN "document" DROP NOT NULL,
  ALTER COLUMN "document_partial" DROP NOT NULL,
  ALTER COLUMN "document_c" DROP NOT NULL;

-- Alter user_info table to allow null values for optional fields
ALTER TABLE "user_info" 
  ALTER COLUMN "phone_ddi" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "phone_partial" DROP NOT NULL,
  ALTER COLUMN "phone_c" DROP NOT NULL;