-- Add NFSe Centi technical integration fields
ALTER TABLE "nfse"
  ADD COLUMN "integration_municipality_code" varchar(7),
  ADD COLUMN "integration_rps_series" varchar(5),
  ADD COLUMN "integration_prestador_document" varchar(14),
  ADD COLUMN "integration_prestador_municipal_inscription" varchar(30);
