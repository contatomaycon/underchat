-- Migrate sector_role to sector_user
-- For each sector_role, find all users with the same permission_role_id
-- and insert them into sector_user table
INSERT INTO "sector_user" (
  "sector_user_id",
  "sector_id",
  "user_id",
  "created_at",
  "updated_at",
  "deleted_at"
)
SELECT
  gen_random_uuid() AS "sector_user_id",
  sr."sector_id",
  pa."user_id",
  NOW() AS "created_at",
  NOW() AS "updated_at",
  NULL AS "deleted_at"
FROM "sector_role" sr
INNER JOIN "permission_assignment" pa
  ON sr."permission_role_id" = pa."permission_role_id"
WHERE sr."deleted_at" IS NULL
  AND pa."user_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "sector_user" su
    WHERE su."sector_id" = sr."sector_id"
      AND su."user_id" = pa."user_id"
      AND su."deleted_at" IS NULL
  );
