-- Add NFSe integration fields
ALTER TABLE "nfse"
  ADD COLUMN "integration_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "integration_base_url" varchar(500),
  ADD COLUMN "integration_uf" varchar(2),
  ADD COLUMN "integration_tenant" varchar(255),
  ADD COLUMN "integration_username" varchar(255),
  ADD COLUMN "integration_password_encrypted" varchar(4000);
