import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260808090000.sql'),
  'utf8'
);

const RECREATING = '019a930d-c6f6-766d-9c84-46093814d8e0';
const ONLINE = '019a930d-c6f6-766d-9c84-30af6ecc33b2';

describe('worker recreate progress PostgreSQL migration', () => {
  it('persists bootstrap and completion only as complete constrained tuples', () => {
    for (const column of [
      'recreate_bootstrap_operation_id',
      'recreate_bootstrap_runtime_generation',
      'recreate_bootstrap_container_id',
      'recreate_bootstrap_started_at',
      'recreate_completed_operation_id',
      'recreate_completed_runtime_generation',
      'recreate_completed_at',
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain('worker_recreate_completed_marker_check');
    expect(migration).toContain(
      'worker_runtime_recreate_bootstrap_marker_check'
    );
    expect(migration).toContain(
      ') NOT VALID;\n\nALTER TABLE public."worker"\n  VALIDATE CONSTRAINT "worker_recreate_completed_marker_check";'
    );
    expect(migration).toContain(
      ') NOT VALID;\n\nALTER TABLE public."worker_runtime"\n  VALIDATE CONSTRAINT "worker_runtime_recreate_bootstrap_marker_check";'
    );
    expect(migration).toContain(
      '"recreate_bootstrap_runtime_generation" = "runtime_generation"'
    );
    expect(migration).toContain(
      'lower(trim("recreate_bootstrap_container_id")) =\n        lower(trim("container_id"))'
    );
    expect(migration).toContain("'^[0-9a-f]{12,64}$'");
  });

  it('resets stale bootstrap evidence before a physical runtime identity changes', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.reset_worker_runtime_recreate_bootstrap_v1()'
    );
    expect(migration).toContain(
      'IF OLD."runtime_generation" IS DISTINCT FROM NEW."runtime_generation"'
    );
    expect(migration).toContain(
      'OR OLD."container_id" IS DISTINCT FROM NEW."container_id"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "worker_runtime_recreate_bootstrap_reset_trg"\nBEFORE UPDATE ON public."worker_runtime"'
    );
    for (const assignment of [
      'NEW."recreate_bootstrap_operation_id" := NULL;',
      'NEW."recreate_bootstrap_runtime_generation" := NULL;',
      'NEW."recreate_bootstrap_container_id" := NULL;',
      'NEW."recreate_bootstrap_started_at" := NULL;',
    ]) {
      expect(migration).toContain(assignment);
    }
  });

  it('keeps the marker capability manager-owned and bounded', () => {
    const capability = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION public.mark_worker_recreate_bootstrap_started('
      )
    );

    expect(capability).toContain('SECURITY INVOKER');
    expect(capability).toContain('SET search_path = pg_catalog, public');
    expect(capability).toContain("SET lock_timeout = '5s'");
    expect(capability).toContain("SET statement_timeout = '10s'");
    expect(capability).toContain(
      'REVOKE ALL ON FUNCTION public.mark_worker_recreate_bootstrap_started('
    );
    expect(capability).toContain(') FROM PUBLIC;');
    expect(capability).not.toContain('SECURITY DEFINER');
    expect(capability).not.toContain('GRANT EXECUTE');
  });

  it('locks worker before runtime and checks the exact lifecycle ownership', () => {
    const workerLock = migration.indexOf(
      'FROM public.worker AS owner\n  WHERE owner.worker_id = p_worker_id\n  FOR UPDATE;'
    );
    const runtimeUpdate = migration.indexOf(
      'UPDATE public.worker_runtime AS runtime'
    );

    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeUpdate).toBeGreaterThan(workerLock);
    for (const fence of [
      'v_worker.account_id IS DISTINCT FROM p_account_id',
      'v_worker.server_id IS DISTINCT FROM p_server_id',
      `\'${RECREATING}\'::uuid`,
      `\'${ONLINE}\'::uuid`,
      'v_worker.lifecycle_operation_id IS DISTINCT FROM\n      p_lifecycle_operation_id',
      'v_worker.deleted_at IS NOT NULL',
      'runtime.runtime_generation = p_runtime_generation',
      'lower(trim(runtime.container_id)) = v_container_id',
    ]) {
      expect(migration).toContain(fence.replaceAll("\\'", "'"));
    }
  });

  it('requires a distinct physical replacement and preserves the first bootstrap timestamp on replay', () => {
    for (const fence of [
      'lower(trim(v_worker.container_id)) = v_container_id',
      "lower(trim(v_worker.container_id)) LIKE v_container_id || '%'",
      "v_container_id LIKE lower(trim(v_worker.container_id)) || '%'",
    ]) {
      expect(migration).toContain(fence);
    }
    expect(migration).toContain(
      'THEN runtime.recreate_bootstrap_started_at\n        ELSE clock_timestamp()'
    );
    expect(migration).toContain('RETURN FOUND;');
  });
});
