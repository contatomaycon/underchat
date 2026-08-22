-- Customer-facing recreate progress is intentionally separate from the
-- durable worker status used by lifecycle fences. The manager records this
-- marker only after Docker started the exact cold target or a warm runtime
-- acknowledged activation.

ALTER TABLE public."worker_runtime"
  ADD COLUMN "recreate_bootstrap_operation_id" uuid,
  ADD COLUMN "recreate_bootstrap_runtime_generation" integer,
  ADD COLUMN "recreate_bootstrap_container_id" character varying(100),
  ADD COLUMN "recreate_bootstrap_started_at" timestamptz;

ALTER TABLE public."worker"
  ADD COLUMN "recreate_completed_operation_id" uuid,
  ADD COLUMN "recreate_completed_runtime_generation" integer,
  ADD COLUMN "recreate_completed_at" timestamptz;

ALTER TABLE public."worker"
  ADD CONSTRAINT "worker_recreate_completed_marker_check"
  CHECK (
    (
      "recreate_completed_operation_id" IS NULL
      AND "recreate_completed_runtime_generation" IS NULL
      AND "recreate_completed_at" IS NULL
    ) OR (
      "recreate_completed_operation_id" IS NOT NULL
      AND "recreate_completed_runtime_generation" IS NOT NULL
      AND "recreate_completed_runtime_generation" > 0
      AND "recreate_completed_at" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public."worker"
  VALIDATE CONSTRAINT "worker_recreate_completed_marker_check";

ALTER TABLE public."worker_runtime"
  ADD CONSTRAINT "worker_runtime_recreate_bootstrap_marker_check"
  CHECK (
    (
      "recreate_bootstrap_operation_id" IS NULL
      AND "recreate_bootstrap_runtime_generation" IS NULL
      AND "recreate_bootstrap_container_id" IS NULL
      AND "recreate_bootstrap_started_at" IS NULL
    ) OR (
      "recreate_bootstrap_operation_id" IS NOT NULL
      AND "recreate_bootstrap_runtime_generation" IS NOT NULL
      AND "recreate_bootstrap_runtime_generation" > 0
      AND "recreate_bootstrap_runtime_generation" = "runtime_generation"
      AND "recreate_bootstrap_container_id" IS NOT NULL
      AND lower(trim("recreate_bootstrap_container_id")) ~
        '^[0-9a-f]{12,64}$'
      AND "container_id" IS NOT NULL
      AND lower(trim("recreate_bootstrap_container_id")) =
        lower(trim("container_id"))
      AND "recreate_bootstrap_started_at" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public."worker_runtime"
  VALIDATE CONSTRAINT "worker_runtime_recreate_bootstrap_marker_check";

CREATE OR REPLACE FUNCTION public.reset_worker_runtime_recreate_bootstrap_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD."runtime_generation" IS DISTINCT FROM NEW."runtime_generation"
    OR OLD."container_id" IS DISTINCT FROM NEW."container_id"
  THEN
    NEW."recreate_bootstrap_operation_id" := NULL;
    NEW."recreate_bootstrap_runtime_generation" := NULL;
    NEW."recreate_bootstrap_container_id" := NULL;
    NEW."recreate_bootstrap_started_at" := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_worker_runtime_recreate_bootstrap_v1()
  FROM PUBLIC;

CREATE TRIGGER "worker_runtime_recreate_bootstrap_reset_trg"
BEFORE UPDATE ON public."worker_runtime"
FOR EACH ROW
EXECUTE FUNCTION public.reset_worker_runtime_recreate_bootstrap_v1();

CREATE OR REPLACE FUNCTION public.mark_worker_recreate_bootstrap_started(
  p_worker_id uuid,
  p_account_id uuid,
  p_server_id uuid,
  p_lifecycle_operation_id uuid,
  p_runtime_generation integer,
  p_container_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_worker public.worker%ROWTYPE;
  v_container_id text;
BEGIN
  v_container_id := lower(trim(p_container_id));
  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_server_id IS NULL
    OR p_lifecycle_operation_id IS NULL
    OR p_runtime_generation IS NULL
    OR p_runtime_generation <= 0
    OR v_container_id IS NULL
    OR v_container_id !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN false;
  END IF;

  -- Global lifecycle lock order remains worker -> runtime.
  SELECT owner.*
  INTO v_worker
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_worker.account_id IS DISTINCT FROM p_account_id
    OR v_worker.server_id IS DISTINCT FROM p_server_id
    OR v_worker.worker_status_id NOT IN (
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    )
    OR v_worker.lifecycle_operation_id IS DISTINCT FROM
      p_lifecycle_operation_id
    OR v_worker.deleted_at IS NOT NULL
    OR v_worker.container_id IS NULL
    OR lower(trim(v_worker.container_id)) !~ '^[0-9a-f]{12,64}$'
    OR lower(trim(v_worker.container_id)) = v_container_id
    OR lower(trim(v_worker.container_id)) LIKE v_container_id || '%'
    OR v_container_id LIKE lower(trim(v_worker.container_id)) || '%'
  THEN
    RETURN false;
  END IF;

  UPDATE public.worker_runtime AS runtime
  SET recreate_bootstrap_operation_id = p_lifecycle_operation_id,
      recreate_bootstrap_runtime_generation = p_runtime_generation,
      recreate_bootstrap_container_id = runtime.container_id,
      recreate_bootstrap_started_at = CASE
        WHEN runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM
               p_lifecycle_operation_id
          AND runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM
               p_runtime_generation
          AND lower(trim(runtime.recreate_bootstrap_container_id))
                IS NOT DISTINCT FROM v_container_id
          AND runtime.recreate_bootstrap_started_at IS NOT NULL
        THEN runtime.recreate_bootstrap_started_at
        ELSE clock_timestamp()
      END,
      updated_at = clock_timestamp()
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_runtime_generation
    AND runtime.container_id IS NOT NULL
    AND lower(trim(runtime.container_id)) = v_container_id;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_worker_recreate_bootstrap_started(
  uuid, uuid, uuid, uuid, integer, text
) FROM PUBLIC;
