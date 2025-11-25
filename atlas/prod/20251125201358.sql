-- Modify "user_address" table
ALTER TABLE "user_address" ALTER COLUMN "city_fiscal_code" TYPE character varying(10), ALTER COLUMN "city_fiscal_code" DROP NOT NULL, ALTER COLUMN "state_fiscal_code" TYPE character varying(10), ALTER COLUMN "state_fiscal_code" DROP NOT NULL;
