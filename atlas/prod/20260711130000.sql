-- Register Integration as an opt-in boolean plan product. It is deliberately
-- not associated with any existing plan or cross-sell offer.
INSERT INTO "plan_product" ("plan_product_id", "name", "created_at", "updated_at")
VALUES (
  '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
  'integration',
  NOW(),
  NOW()
)
ON CONFLICT ("plan_product_id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "updated_at" = NOW();

INSERT INTO "plan_product_description" (
  "plan_product_description_id",
  "plan_product_id",
  "name",
  "description",
  "created_at",
  "updated_at"
)
VALUES (
  '982d1671-ff9d-4a66-843d-cb37c4887e6a'::uuid,
  '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
  'Integração',
  'Acesso à API pública e aos webhooks de entrada e saída da conta',
  NOW(),
  NOW()
)
ON CONFLICT ("plan_product_id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = NOW();

CREATE TABLE "account_plan_product_entitlement_revision" (
  "account_id" uuid NOT NULL,
  "plan_product_id" uuid NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "allowed" boolean NOT NULL DEFAULT false,
  "deny_fence_token" uuid,
  "deny_fence_created_at" timestamp with time zone,
  "deny_fence_released_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "account_plan_product_entitlement_revision_pkey"
    PRIMARY KEY ("account_id", "plan_product_id"),
  CONSTRAINT "account_plan_product_entitlement_revision_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "account" ("account_id")
    ON DELETE CASCADE,
  CONSTRAINT "account_plan_product_entitlement_revision_product_fkey"
    FOREIGN KEY ("plan_product_id") REFERENCES "plan_product" ("plan_product_id")
    ON DELETE CASCADE,
  CONSTRAINT "account_plan_product_entitlement_revision_positive_check"
    CHECK ("revision" > 0),
  CONSTRAINT "account_plan_product_entitlement_revision_fence_pair_check"
    CHECK (
      (
        "deny_fence_token" IS NULL
        AND "deny_fence_created_at" IS NULL
        AND "deny_fence_released_at" IS NULL
      )
      OR
      (
        "deny_fence_token" IS NOT NULL
        AND "deny_fence_created_at" IS NOT NULL
      )
    )
);

CREATE INDEX "account_plan_product_entitlement_revision_product_idx"
  ON "account_plan_product_entitlement_revision" (
    "plan_product_id",
    "account_id"
  );

COMMENT ON COLUMN "account_plan_product_entitlement_revision"."allowed" IS
  'Last authoritative boolean state, used to increment revision only on an entitlement transition.';

COMMENT ON COLUMN "account_plan_product_entitlement_revision"."deny_fence_token" IS
  'Durable owner token for an in-progress fail-closed entitlement revocation.';
