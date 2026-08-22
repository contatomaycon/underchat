-- Plan status controls catalog visibility only. Runtime entitlement remains
-- valid for an assigned, non-expired plan even when that catalog entry is no
-- longer offered for sale.

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_plan_transition"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_plan_ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(DISTINCT plan_id)
    INTO affected_plan_ids
    FROM (
      (
        SELECT
          plan_id,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        EXCEPT ALL
        SELECT
          plan_id,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
      )
      UNION ALL
      (
        SELECT
          plan_id,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        EXCEPT ALL
        SELECT
          plan_id,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
      )
    ) changed;
  ELSE
    SELECT array_agg(DISTINCT plan_id)
    INTO affected_plan_ids
    FROM old_rows;
  END IF;

  PERFORM enqueue_integration_entitlement_plans(affected_plan_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "drain_integration_entitlement_revision_queue"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_transaction_id bigint := txid_current();
  reconciliation_time timestamp with time zone := clock_timestamp();
BEGIN
  -- This statement only acquires locks. Under READ COMMITTED, the following
  -- reconciliation statement receives a fresh snapshot after a concurrent
  -- transaction holding the same account/product lock commits.
  PERFORM pg_advisory_xact_lock(ordered_targets.lock_key)
  FROM (
    SELECT
      hashtextextended(
        queued.account_id::text || ':' || queued.plan_product_id::text,
        0
      ) AS lock_key
    FROM account_plan_product_entitlement_revision_queue queued
    WHERE queued.transaction_id = current_transaction_id
    ORDER BY queued.account_id, queued.plan_product_id
  ) ordered_targets;

  -- Distributed writer-fencing invariant. A source transaction that changes
  -- the persisted entitlement from allowed to denied may only commit while an
  -- unreleased deny-fence owner is still present. If orphan recovery won a
  -- paused writer's lease, this check aborts that stale writer before commit.
  IF EXISTS (
    WITH targets AS MATERIALIZED (
      SELECT queued.account_id, queued.plan_product_id
      FROM account_plan_product_entitlement_revision_queue queued
      WHERE queued.transaction_id = current_transaction_id
    ),
    state AS MATERIALIZED (
      SELECT
        requested.account_id,
        requested.plan_product_id,
        COALESCE((
          a.account_id IS NOT NULL
          AND a.deleted_at IS NULL
          AND a.account_status_id <>
            '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid
          AND latest.plan_account_id IS NOT NULL
          AND p.deleted_at IS NULL
          AND latest.next_payment_date > reconciliation_time
        ), FALSE) AS plan_is_active,
        EXISTS (
          SELECT 1
          FROM plan_items item
          WHERE item.plan_id = latest.plan_id
            AND item.plan_product_id = requested.plan_product_id
            AND item.quantity > 0
            AND item.deleted_at IS NULL
        ) AS granted_by_plan,
        EXISTS (
          SELECT 1
          FROM plan_cross_sell_account assignment
          INNER JOIN plan_cross_sell addon
            ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
          WHERE assignment.account_id = requested.account_id
            AND assignment.deleted_at IS NULL
            AND addon.deleted_at IS NULL
            AND addon.plan_product_id = requested.plan_product_id
            AND addon.quantity > 0
            AND (
              assignment.cancellation_date IS NULL
              OR latest.last_payment_date IS NULL
              OR assignment.cancellation_date >= latest.last_payment_date
            )
        ) AS granted_by_addon
      FROM targets requested
      LEFT JOIN account a ON a.account_id = requested.account_id
      LEFT JOIN LATERAL (
        SELECT
          pa.plan_account_id,
          pa.plan_id,
          pa.last_payment_date,
          pa.next_payment_date
        FROM plan_account pa
        WHERE pa.account_id = requested.account_id
        ORDER BY
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
        LIMIT 1
      ) latest ON TRUE
      LEFT JOIN plan p ON p.plan_id = latest.plan_id
    ),
    resolved AS MATERIALIZED (
      SELECT
        account_id,
        plan_product_id,
        COALESCE(
          plan_is_active AND (granted_by_plan OR granted_by_addon),
          FALSE
        ) AS allowed
      FROM state
    )
    SELECT 1
    FROM resolved
    INNER JOIN account_plan_product_entitlement_revision persisted
      ON persisted.account_id = resolved.account_id
      AND persisted.plan_product_id = resolved.plan_product_id
    WHERE persisted.allowed = TRUE
      AND resolved.allowed = FALSE
      AND (
        persisted.deny_fence_token IS NULL
        OR persisted.deny_fence_released_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC001',
      MESSAGE = 'plan_entitlement_deny_fence_required';
  END IF;

  WITH targets AS MATERIALIZED (
    DELETE FROM account_plan_product_entitlement_revision_queue queued
    WHERE queued.transaction_id = current_transaction_id
    RETURNING queued.account_id, queued.plan_product_id
  ),
  state AS MATERIALIZED (
    SELECT
      requested.account_id,
      requested.plan_product_id,
      COALESCE((
        a.account_id IS NOT NULL
        AND a.deleted_at IS NULL
        AND a.account_status_id <>
          '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid
        AND latest.plan_account_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND latest.next_payment_date > reconciliation_time
      ), FALSE) AS plan_is_active,
      EXISTS (
        SELECT 1
        FROM plan_items item
        WHERE item.plan_id = latest.plan_id
          AND item.plan_product_id = requested.plan_product_id
          AND item.quantity > 0
          AND item.deleted_at IS NULL
      ) AS granted_by_plan,
      EXISTS (
        SELECT 1
        FROM plan_cross_sell_account assignment
        INNER JOIN plan_cross_sell addon
          ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
        WHERE assignment.account_id = requested.account_id
          AND assignment.deleted_at IS NULL
          AND addon.deleted_at IS NULL
          AND addon.plan_product_id = requested.plan_product_id
          AND addon.quantity > 0
          AND (
            assignment.cancellation_date IS NULL
            OR latest.last_payment_date IS NULL
            OR assignment.cancellation_date >= latest.last_payment_date
          )
      ) AS granted_by_addon
    FROM targets requested
    LEFT JOIN account a ON a.account_id = requested.account_id
    LEFT JOIN LATERAL (
      SELECT
        pa.plan_account_id,
        pa.plan_id,
        pa.last_payment_date,
        pa.next_payment_date
      FROM plan_account pa
      WHERE pa.account_id = requested.account_id
      ORDER BY
        pa.updated_at DESC NULLS LAST,
        pa.created_at DESC NULLS LAST,
        pa.plan_account_id DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN plan p ON p.plan_id = latest.plan_id
  ),
  resolved AS MATERIALIZED (
    SELECT
      account_id,
      plan_product_id,
      COALESCE(
        plan_is_active AND (granted_by_plan OR granted_by_addon),
        FALSE
      ) AS allowed
    FROM state
  )
  INSERT INTO account_plan_product_entitlement_revision AS persisted (
    account_id,
    plan_product_id,
    revision,
    allowed,
    updated_at
  )
  SELECT
    resolved.account_id,
    resolved.plan_product_id,
    1,
    resolved.allowed,
    clock_timestamp()
  FROM resolved
  ON CONFLICT (account_id, plan_product_id) DO UPDATE
  SET
    revision = CASE
      WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
        THEN persisted.revision + 1
      ELSE persisted.revision
    END,
    allowed = EXCLUDED.allowed,
    updated_at = CASE
      WHEN persisted.allowed IS DISTINCT FROM EXCLUDED.allowed
        THEN clock_timestamp()
      ELSE persisted.updated_at
    END;

  RETURN NULL;
END;
$$;

-- Reconcile existing current accounts in the same transaction. The deferred
-- drain updates revision only when the effective boolean changes and preserves
-- any durable deny-fence owner.
INSERT INTO "account_plan_product_entitlement_revision_queue" (
  "transaction_id",
  "account_id",
  "plan_product_id",
  "created_at"
)
SELECT DISTINCT
  txid_current(),
  latest.account_id,
  '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
  clock_timestamp()
FROM (
  SELECT DISTINCT ON (pa.account_id)
    pa.account_id,
    pa.plan_id,
    pa.last_payment_date,
    pa.next_payment_date
  FROM plan_account pa
  ORDER BY
    pa.account_id,
    pa.updated_at DESC NULLS LAST,
    pa.created_at DESC NULLS LAST,
    pa.plan_account_id DESC
) latest
INNER JOIN account a
  ON a.account_id = latest.account_id
INNER JOIN plan p
  ON p.plan_id = latest.plan_id
WHERE a.deleted_at IS NULL
  AND a.account_status_id <>
    '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid
  AND p.deleted_at IS NULL
  AND latest.next_payment_date > clock_timestamp()
  AND (
    EXISTS (
      SELECT 1
      FROM plan_items item
      WHERE item.plan_id = latest.plan_id
        AND item.plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        AND item.quantity > 0
        AND item.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM plan_cross_sell_account assignment
      INNER JOIN plan_cross_sell addon
        ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
      WHERE assignment.account_id = latest.account_id
        AND assignment.deleted_at IS NULL
        AND addon.deleted_at IS NULL
        AND addon.plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        AND addon.quantity > 0
        AND (
          assignment.cancellation_date IS NULL
          OR latest.last_payment_date IS NULL
          OR assignment.cancellation_date >= latest.last_payment_date
        )
    )
  )
ON CONFLICT ("transaction_id", "account_id", "plan_product_id")
  DO NOTHING;
