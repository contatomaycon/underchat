-- Add NFSe digital certificate metadata fields
ALTER TABLE "nfse"
  ADD COLUMN "certificate_bucket" varchar(255),
  ADD COLUMN "certificate_key" varchar(1000),
  ADD COLUMN "certificate_file_name" varchar(500),
  ADD COLUMN "certificate_password_encrypted" varchar(4000),
  ADD COLUMN "certificate_uploaded_at" timestamp with time zone;
