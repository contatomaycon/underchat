-- Ensure one active push endpoint per provider (last login wins)
WITH ranked_subscriptions AS (
  SELECT
    "push_subscription_id",
    ROW_NUMBER() OVER (
      PARTITION BY "provider", "endpoint"
      ORDER BY
        COALESCE("updated_at", "created_at") DESC,
        "created_at" DESC,
        "push_subscription_id" DESC
    ) AS "row_num"
  FROM "push_subscription"
  WHERE "deleted_at" IS NULL
)
UPDATE "push_subscription" AS ps
SET
  "deleted_at" = NOW(),
  "updated_at" = NOW()
FROM ranked_subscriptions rs
WHERE ps."push_subscription_id" = rs."push_subscription_id"
  AND rs."row_num" > 1
  AND ps."deleted_at" IS NULL;

-- Keep data model protected from duplicated active endpoints
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_provider_endpoint_active_uidx"
  ON "push_subscription" ("provider", "endpoint")
  WHERE "deleted_at" IS NULL;
