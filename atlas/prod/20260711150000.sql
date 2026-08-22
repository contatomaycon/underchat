-- Reconcile Integration entitlement revisions in the same transaction as the
-- catalog/account mutation. Statement triggers only enqueue affected accounts;
-- one deferred constraint trigger drains the final transaction-wide set at
-- commit, so A -> A mutations across several tables do not create epochs for
-- intermediate states.
CREATE TABLE "account_plan_product_entitlement_revision_queue" (
  "transaction_id" bigint NOT NULL,
  "account_id" uuid NOT NULL,
  "plan_product_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "account_plan_product_entitlement_revision_queue_pkey"
    PRIMARY KEY ("transaction_id", "account_id", "plan_product_id"),
  CONSTRAINT "account_plan_product_entitlement_revision_queue_txid_check"
    CHECK ("transaction_id" > 0)
);

COMMENT ON TABLE "account_plan_product_entitlement_revision_queue" IS
  'Transaction-local durable workset drained by a deferred trigger before commit.';

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_accounts"(
  affected_account_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO "account_plan_product_entitlement_revision_queue" (
    "transaction_id",
    "account_id",
    "plan_product_id",
    "created_at"
  )
  SELECT
    txid_current(),
    affected.account_id,
    '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
    clock_timestamp()
  FROM (
    SELECT DISTINCT unnest(affected_account_ids) AS account_id
  ) affected
  WHERE affected.account_id IS NOT NULL
  ON CONFLICT ("transaction_id", "account_id", "plan_product_id")
    DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_plans"(
  affected_plan_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO "account_plan_product_entitlement_revision_queue" (
    "transaction_id",
    "account_id",
    "plan_product_id",
    "created_at"
  )
  WITH affected_plans AS MATERIALIZED (
    SELECT DISTINCT unnest(affected_plan_ids) AS plan_id
  ),
  candidate_accounts AS MATERIALIZED (
    SELECT DISTINCT pa.account_id
    FROM plan_account pa
    INNER JOIN affected_plans
      ON affected_plans.plan_id = pa.plan_id
    WHERE affected_plans.plan_id IS NOT NULL
  ),
  current_plans AS MATERIALIZED (
    SELECT
      candidate.account_id,
      latest.plan_id
    FROM candidate_accounts candidate
    INNER JOIN LATERAL (
      SELECT pa.plan_id
      FROM plan_account pa
      WHERE pa.account_id = candidate.account_id
      ORDER BY
        pa.updated_at DESC NULLS LAST,
        pa.created_at DESC NULLS LAST,
        pa.plan_account_id DESC
      LIMIT 1
    ) latest ON TRUE
  )
  SELECT
    txid_current(),
    current_plans.account_id,
    '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
    clock_timestamp()
  FROM current_plans
  INNER JOIN affected_plans
    ON affected_plans.plan_id = current_plans.plan_id
  ON CONFLICT ("transaction_id", "account_id", "plan_product_id")
    DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_cross_sells"(
  affected_cross_sell_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO "account_plan_product_entitlement_revision_queue" (
    "transaction_id",
    "account_id",
    "plan_product_id",
    "created_at"
  )
  SELECT DISTINCT
    txid_current(),
    assignment.account_id,
    '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid,
    clock_timestamp()
  FROM unnest(affected_cross_sell_ids) affected(plan_cross_sell_id)
  INNER JOIN plan_cross_sell_account assignment
    ON assignment.plan_cross_sell_id = affected.plan_cross_sell_id
  WHERE affected.plan_cross_sell_id IS NOT NULL
  ON CONFLICT ("transaction_id", "account_id", "plan_product_id")
    DO NOTHING;
END;
$$;

-- account, plan_account and plan_cross_sell_account all expose account_id in
-- their transition relations. Assignment transitions are narrowed to the
-- Integration catalog product before accounts are queued.
CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_direct_transition"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_account_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'plan_cross_sell_account' THEN
      SELECT array_agg(DISTINCT inserted.account_id)
      INTO affected_account_ids
      FROM new_rows inserted
      INNER JOIN plan_cross_sell addon
        ON addon.plan_cross_sell_id = inserted.plan_cross_sell_id
      WHERE addon.plan_product_id =
        '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid;
    ELSE
      SELECT array_agg(DISTINCT account_id)
      INTO affected_account_ids
      FROM new_rows;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- PostgreSQL does not allow transition relations on an UPDATE OF trigger.
    -- Filter the transition sets here so unrelated writes cannot materialize a
    -- time-based expiry and unexpectedly require a deny fence.
    IF TG_TABLE_NAME = 'account' THEN
      SELECT array_agg(DISTINCT account_id)
      INTO affected_account_ids
      FROM (
        (
          SELECT
            account_id,
            account_status_id =
              '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid AS is_blocked,
            deleted_at IS NOT NULL AS is_deleted
          FROM old_rows
          EXCEPT ALL
          SELECT
            account_id,
            account_status_id =
              '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid AS is_blocked,
            deleted_at IS NOT NULL AS is_deleted
          FROM new_rows
        )
        UNION ALL
        (
          SELECT
            account_id,
            account_status_id =
              '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid AS is_blocked,
            deleted_at IS NOT NULL AS is_deleted
          FROM new_rows
          EXCEPT ALL
          SELECT
            account_id,
            account_status_id =
              '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid AS is_blocked,
            deleted_at IS NOT NULL AS is_deleted
          FROM old_rows
        )
      ) changed;
    ELSIF TG_TABLE_NAME = 'plan_account' THEN
      SELECT array_agg(DISTINCT account_id)
      INTO affected_account_ids
      FROM (
        (
          SELECT
            plan_account_id,
            account_id,
            plan_id,
            last_payment_date,
            next_payment_date,
            created_at,
            updated_at
          FROM old_rows
          EXCEPT ALL
          SELECT
            plan_account_id,
            account_id,
            plan_id,
            last_payment_date,
            next_payment_date,
            created_at,
            updated_at
          FROM new_rows
        )
        UNION ALL
        (
          SELECT
            plan_account_id,
            account_id,
            plan_id,
            last_payment_date,
            next_payment_date,
            created_at,
            updated_at
          FROM new_rows
          EXCEPT ALL
          SELECT
            plan_account_id,
            account_id,
            plan_id,
            last_payment_date,
            next_payment_date,
            created_at,
            updated_at
          FROM old_rows
        )
      ) changed;
    ELSIF TG_TABLE_NAME = 'plan_cross_sell_account' THEN
      SELECT array_agg(DISTINCT changed.account_id)
      INTO affected_account_ids
      FROM (
        SELECT
          assignment.account_id,
          assignment.plan_cross_sell_id
        FROM (
          (
            SELECT
              plan_cross_sell_account_id,
              account_id,
              plan_cross_sell_id,
              cancellation_date,
              deleted_at IS NOT NULL AS is_deleted
            FROM old_rows
            EXCEPT ALL
            SELECT
              plan_cross_sell_account_id,
              account_id,
              plan_cross_sell_id,
              cancellation_date,
              deleted_at IS NOT NULL AS is_deleted
            FROM new_rows
          )
          UNION ALL
          (
            SELECT
              plan_cross_sell_account_id,
              account_id,
              plan_cross_sell_id,
              cancellation_date,
              deleted_at IS NOT NULL AS is_deleted
            FROM new_rows
            EXCEPT ALL
            SELECT
              plan_cross_sell_account_id,
              account_id,
              plan_cross_sell_id,
              cancellation_date,
              deleted_at IS NOT NULL AS is_deleted
            FROM old_rows
          )
        ) assignment
        INNER JOIN plan_cross_sell addon
          ON addon.plan_cross_sell_id = assignment.plan_cross_sell_id
        WHERE addon.plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
      ) changed;
    ELSE
      RAISE EXCEPTION 'unsupported entitlement transition table: %',
        TG_TABLE_NAME;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'plan_cross_sell_account' THEN
      SELECT array_agg(DISTINCT deleted.account_id)
      INTO affected_account_ids
      FROM old_rows deleted
      INNER JOIN plan_cross_sell addon
        ON addon.plan_cross_sell_id = deleted.plan_cross_sell_id
      WHERE addon.plan_product_id =
        '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid;
    ELSE
      SELECT array_agg(DISTINCT account_id)
      INTO affected_account_ids
      FROM old_rows;
    END IF;
  END IF;

  PERFORM enqueue_integration_entitlement_accounts(affected_account_ids);
  RETURN NULL;
END;
$$;

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
          status = 'active' AS is_active,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        EXCEPT ALL
        SELECT
          plan_id,
          status = 'active' AS is_active,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
      )
      UNION ALL
      (
        SELECT
          plan_id,
          status = 'active' AS is_active,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        EXCEPT ALL
        SELECT
          plan_id,
          status = 'active' AS is_active,
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

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_plan_item_transition"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_plan_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT plan_id)
    INTO affected_plan_ids
    FROM new_rows
    WHERE plan_product_id =
      '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT array_agg(DISTINCT plan_id)
    INTO affected_plan_ids
    FROM (
      (
        SELECT
          plan_item_id,
          plan_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        EXCEPT ALL
        SELECT
          plan_item_id,
          plan_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
      )
      UNION ALL
      (
        SELECT
          plan_item_id,
          plan_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        EXCEPT ALL
        SELECT
          plan_item_id,
          plan_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
      )
    ) changed;
  ELSE
    SELECT array_agg(DISTINCT plan_id)
    INTO affected_plan_ids
    FROM old_rows
    WHERE plan_product_id =
      '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid;
  END IF;

  PERFORM enqueue_integration_entitlement_plans(affected_plan_ids);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "enqueue_integration_entitlement_cross_sell_transition"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_cross_sell_ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(DISTINCT plan_cross_sell_id)
    INTO affected_cross_sell_ids
    FROM (
      (
        SELECT
          plan_cross_sell_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        EXCEPT ALL
        SELECT
          plan_cross_sell_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
      )
      UNION ALL
      (
        SELECT
          plan_cross_sell_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM new_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
        EXCEPT ALL
        SELECT
          plan_cross_sell_id,
          plan_product_id,
          quantity > 0 AS has_quantity,
          deleted_at IS NOT NULL AS is_deleted
        FROM old_rows
        WHERE plan_product_id =
          '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid
      )
    ) changed;
  ELSE
    SELECT array_agg(DISTINCT plan_cross_sell_id)
    INTO affected_cross_sell_ids
    FROM old_rows
    WHERE plan_product_id =
      '0eb84ca1-8145-4770-acd4-b6725fe1cf25'::uuid;
  END IF;

  PERFORM enqueue_integration_entitlement_cross_sells(
    affected_cross_sell_ids
  );
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
          AND p.status = 'active'
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
        AND p.status = 'active'
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

REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_accounts"(uuid[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_plans"(uuid[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_cross_sells"(uuid[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_direct_transition"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_plan_transition"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_plan_item_transition"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "enqueue_integration_entitlement_cross_sell_transition"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION "drain_integration_entitlement_revision_queue"()
  FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "integration_entitlement_revision_queue_drain"
AFTER INSERT ON "account_plan_product_entitlement_revision_queue"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "drain_integration_entitlement_revision_queue"();

CREATE TRIGGER "account_integration_entitlement_revision_update"
AFTER UPDATE ON "account"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "account_integration_entitlement_revision_delete"
AFTER DELETE ON "account"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_account_integration_entitlement_revision_insert"
AFTER INSERT ON "plan_account"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_account_integration_entitlement_revision_update"
AFTER UPDATE ON "plan_account"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_account_integration_entitlement_revision_delete"
AFTER DELETE ON "plan_account"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_integration_entitlement_revision_update"
AFTER UPDATE ON "plan"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_plan_transition"();

CREATE TRIGGER "plan_integration_entitlement_revision_delete"
AFTER DELETE ON "plan"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_plan_transition"();

CREATE TRIGGER "plan_items_integration_entitlement_revision_insert"
AFTER INSERT ON "plan_items"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_plan_item_transition"();

CREATE TRIGGER "plan_items_integration_entitlement_revision_update"
AFTER UPDATE ON "plan_items"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_plan_item_transition"();

CREATE TRIGGER "plan_items_integration_entitlement_revision_delete"
AFTER DELETE ON "plan_items"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_plan_item_transition"();

CREATE TRIGGER "plan_cross_sell_integration_entitlement_revision_update"
AFTER UPDATE ON "plan_cross_sell"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_cross_sell_transition"();

CREATE TRIGGER "plan_cross_sell_integration_entitlement_revision_delete"
AFTER DELETE ON "plan_cross_sell"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_cross_sell_transition"();

CREATE TRIGGER "plan_cross_sell_account_integration_entitlement_revision_insert"
AFTER INSERT ON "plan_cross_sell_account"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_cross_sell_account_integration_entitlement_revision_update"
AFTER UPDATE ON "plan_cross_sell_account"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();

CREATE TRIGGER "plan_cross_sell_account_integration_entitlement_revision_delete"
AFTER DELETE ON "plan_cross_sell_account"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "enqueue_integration_entitlement_direct_transition"();
