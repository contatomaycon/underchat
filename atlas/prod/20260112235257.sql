-- Create "contact_label_template" table
CREATE TABLE "contact_label_template" (
  "contact_label_template_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "label_template_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("contact_label_template_id"),
  CONSTRAINT "contact_label_template_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "contact_label_template_label_template_id_label_template_label_t" FOREIGN KEY ("label_template_id") REFERENCES "label_template" ("label_template_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "contact_label_template_contact_id_idx" to table: "contact_label_template"
CREATE INDEX "contact_label_template_contact_id_idx" ON "contact_label_template" ("contact_id");
-- Create index "contact_label_template_contact_id_label_template_id_idx" to table: "contact_label_template"
CREATE INDEX "contact_label_template_contact_id_label_template_id_idx" ON "contact_label_template" ("contact_id", "label_template_id");
-- Create index "contact_label_template_label_template_id_idx" to table: "contact_label_template"
CREATE INDEX "contact_label_template_label_template_id_idx" ON "contact_label_template" ("label_template_id");
-- Migrate existing label_template_id data to contact_label_template
INSERT INTO "contact_label_template" ("contact_label_template_id", "contact_id", "label_template_id", "created_at")
SELECT 
    gen_random_uuid() as "contact_label_template_id",
    "contact_id",
    "label_template_id",
    now() as "created_at"
FROM "contact"
WHERE "label_template_id" IS NOT NULL;
-- Modify "contact" table
ALTER TABLE "contact" DROP COLUMN "label_template_id";
