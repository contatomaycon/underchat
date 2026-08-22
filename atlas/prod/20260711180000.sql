-- Correlate an adoptable deny fence with the exact revocation operation that
-- created it. Ordinary fences keep a NULL operation key and are never adopted.
-- The three base fence columns are repeated with IF NOT EXISTS because early
-- environments applied version 130000 before those columns were added to its
-- source file. Keep this as a forward repair instead of mutating applied
-- migration history again.
ALTER TABLE "account_plan_product_entitlement_revision"
  ADD COLUMN IF NOT EXISTS "deny_fence_token" uuid,
  ADD COLUMN IF NOT EXISTS "deny_fence_created_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deny_fence_released_at" timestamp with time zone;

ALTER TABLE "account_plan_product_entitlement_revision"
  ADD COLUMN IF NOT EXISTS "deny_fence_operation_key" varchar(255);

ALTER TABLE "account_plan_product_entitlement_revision"
  DROP CONSTRAINT IF EXISTS "account_plan_product_entitlement_revision_fence_pair_check";

ALTER TABLE "account_plan_product_entitlement_revision"
  ADD CONSTRAINT "account_plan_product_entitlement_revision_fence_pair_check"
  CHECK (
    (
      "deny_fence_token" IS NULL
      AND "deny_fence_created_at" IS NULL
      AND "deny_fence_released_at" IS NULL
      AND "deny_fence_operation_key" IS NULL
    )
    OR
    (
      "deny_fence_token" IS NOT NULL
      AND "deny_fence_created_at" IS NOT NULL
    )
  );

COMMENT ON COLUMN "account_plan_product_entitlement_revision"."deny_fence_operation_key" IS
  'Stable identity of an external revocation operation allowed to adopt this fence; NULL fences are exclusive.';

COMMENT ON COLUMN "account_plan_product_entitlement_revision"."deny_fence_token" IS
  'Durable owner token for an in-progress fail-closed entitlement revocation.';
