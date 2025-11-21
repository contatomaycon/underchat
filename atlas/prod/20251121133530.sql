-- Create "plan_product_description" table
CREATE TABLE "plan_product_description" (
  "plan_product_description_id" uuid NOT NULL,
  "plan_product_id" uuid NOT NULL,
  "name" character varying(500) NOT NULL,
  "description" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("plan_product_description_id"),
  CONSTRAINT "plan_product_description_plan_product_id_unique" UNIQUE ("plan_product_id"),
  CONSTRAINT "plan_product_description_plan_product_id_plan_product_plan_prod" FOREIGN KEY ("plan_product_id") REFERENCES "plan_product" ("plan_product_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
