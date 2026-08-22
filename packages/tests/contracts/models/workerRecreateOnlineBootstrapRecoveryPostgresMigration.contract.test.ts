import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260808100000.sql'),
  'utf8'
);

const RECREATING = '019a930d-c6f6-766d-9c84-46093814d8e0';
const ONLINE = '019a930d-c6f6-766d-9c84-30af6ecc33b2';

describe('worker recreate online bootstrap recovery PostgreSQL migration', () => {
  it('extends the runtime fence and replaces the manager-owned marker capability', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.mark_worker_recreate_bootstrap_started('
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain("SET lock_timeout = '5s'");
    expect(migration).toContain("SET statement_timeout = '10s'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.mark_worker_recreate_bootstrap_started('
    );
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('GRANT EXECUTE');
    expect(migration).toContain('ALTER TABLE public.worker_runtime');
  });

  it('persists an exact retired-runtime tombstone behind a validated strong constraint', () => {
    for (const fence of [
      'ADD COLUMN recreate_retired_operation_id uuid',
      'ADD COLUMN recreate_retired_runtime_generation integer',
      'ADD COLUMN recreate_retired_container_id character varying(100)',
      'ADD COLUMN recreate_retired_at timestamp with time zone',
      'worker_runtime_recreate_retired_marker_check',
      'recreate_retired_runtime_generation = runtime_generation',
      'lower(trim(recreate_retired_container_id)) = lower(trim(container_id))',
      'runtime_capability_hash IS NULL',
      'session_writer_epoch IS NULL',
      'connection_epoch IS NULL',
      'connection_sequence = 0',
      'source_provider IS NULL',
      'recreate_bootstrap_operation_id IS NULL',
      'native_connection_status IS NULL',
      'native_connection_public_status IS NULL',
      'native_connection_online_acknowledged IS FALSE',
      ') NOT VALID;',
      'VALIDATE CONSTRAINT worker_runtime_recreate_retired_marker_check',
    ]) {
      expect(migration).toContain(fence);
    }
  });

  it('clears retirement only on a generation advance and keeps a retired tombstone immutable otherwise', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.reset_worker_runtime_recreate_retirement_v1()'
    );
    expect(migration).toContain(
      'NEW.runtime_generation > OLD.runtime_generation'
    );
    expect(migration).toContain(
      'lower(trim(OLD.container_id)) IS DISTINCT FROM'
    );
    expect(migration).toContain('NEW.recreate_retired_operation_id := NULL;');
    expect(migration).toContain(
      'OLD.recreate_retired_operation_id IS DISTINCT FROM\n         NEW.recreate_retired_operation_id'
    );
    expect(migration).toContain(
      'OLD.recreate_retired_runtime_generation IS DISTINCT FROM\n         NEW.recreate_retired_runtime_generation'
    );
    expect(migration).toContain(
      'lower(trim(OLD.recreate_retired_container_id)) IS DISTINCT FROM\n         lower(trim(NEW.recreate_retired_container_id))'
    );
    expect(migration).toContain(
      'OLD.recreate_retired_at IS DISTINCT FROM NEW.recreate_retired_at'
    );
    expect(migration).toContain(
      'retired runtime tombstone cannot change without generation advance'
    );
    expect(migration).toContain("USING ERRCODE = 'check_violation'");
    expect(migration).toContain(
      'CREATE TRIGGER worker_runtime_recreate_retirement_reset_trg'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.reset_worker_runtime_recreate_retirement_v1()'
    );
  });

  it('keeps worker, runtime, and live lease locks in the global order', () => {
    const workerLock = migration.indexOf(
      'FROM public.worker AS owner\n  WHERE owner.worker_id = p_worker_id\n  FOR UPDATE;'
    );
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime\n  WHERE runtime.worker_id = p_worker_id'
    );
    const leaseLock = migration.indexOf(
      'FROM public.whatsapp_session_lease AS lease'
    );
    const markerUpdate = migration.indexOf(
      'UPDATE public.worker_runtime AS runtime'
    );

    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(leaseLock).toBeGreaterThan(runtimeLock);
    expect(markerUpdate).toBeGreaterThan(leaseLock);
    expect(migration.indexOf('FOR SHARE;', leaseLock)).toBeGreaterThan(
      leaseLock
    );
  });

  it('preserves distinct-target recreating admission without requiring connection proof', () => {
    expect(migration).toContain(`'${RECREATING}'::uuid`);
    expect(migration).toContain(`'${ONLINE}'::uuid`);
    expect(migration).toContain('IF v_same_target THEN');

    const sameTargetBranch = migration.slice(
      migration.indexOf('IF v_same_target THEN'),
      migration.indexOf('UPDATE public.worker_runtime AS runtime')
    );
    expect(sameTargetBranch).toContain(
      'v_worker.worker_status_id IS DISTINCT FROM'
    );
    expect(sameTargetBranch).toContain(`'${ONLINE}'::uuid`);
    const distinctTargetGuard = migration.slice(
      migration.indexOf('IF NOT v_same_target'),
      migration.indexOf('ELSIF v_same_target THEN')
    );
    expect(distinctTargetGuard).toContain(`'${RECREATING}'::uuid`);
    expect(distinctTargetGuard).toContain('RETURN false;');
  });

  it('admits same-target recovery only with exact self-origin ONLINE evidence', () => {
    for (const fence of [
      'v_worker.lifecycle_operation_id IS DISTINCT FROM',
      'runtime.runtime_generation = p_runtime_generation',
      'lower(trim(runtime.container_id)) = v_container_id',
      'v_runtime.session_storage IS DISTINCT FROM v_worker.session_storage',
      'v_runtime.source_provider IS DISTINCT FROM (',
      'CASE v_worker.worker_type_id',
      'v_runtime.connection_activated_at IS NULL',
      'v_runtime.runtime_capability_hash IS NULL',
      'v_runtime.session_writer_epoch IS NULL',
      'v_runtime.connection_epoch IS NULL',
      'v_runtime.connection_sequence IS NULL',
      'v_runtime.connection_sequence NOT BETWEEN',
      'v_runtime.native_connection_online_acknowledged IS NOT TRUE',
      'v_runtime.native_connection_status_source_id IS NULL',
      'v_runtime.native_connection_status_sequence IS NULL',
      'v_runtime.native_connection_status_sequence NOT BETWEEN',
      'v_runtime.native_connection_status_outbox_id IS NULL',
      "v_runtime.native_connection_status ->> 'status'",
      "v_runtime.native_connection_status ->> 'sequence'",
      "v_runtime.native_connection_public_status ->> 'status'",
      "v_runtime.native_connection_public_status ->> 'sequence'",
      "IS DISTINCT FROM 'online'",
      "v_runtime.native_connection_status -> 'connected'",
      "v_runtime.native_connection_status -> 'authenticated'",
      "v_runtime.native_connection_status -> 'sessionValid'",
      "v_runtime.native_connection_status -> 'qrAvailable'",
    ]) {
      expect(migration).toContain(fence);
    }
  });

  it('replays an exact durable marker without requiring a still-live ONLINE acknowledgement', () => {
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime\n  WHERE runtime.worker_id = p_worker_id'
    );
    const exactReplay = migration.indexOf(
      'IF v_runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM'
    );
    const sameTargetProof = migration.indexOf('IF v_same_target THEN');

    expect(exactReplay).toBeGreaterThan(runtimeLock);
    expect(sameTargetProof).toBeGreaterThan(exactReplay);
    const replayBranch = migration.slice(exactReplay, sameTargetProof);
    expect(replayBranch).toContain(
      'v_runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM'
    );
    expect(replayBranch).toContain(
      'lower(trim(v_runtime.recreate_bootstrap_container_id))'
    );
    expect(replayBranch).toContain(
      'v_runtime.recreate_bootstrap_started_at IS NOT NULL'
    );
    expect(replayBranch).toContain('RETURN true;');
    expect(replayBranch).not.toContain(
      'v_runtime.native_connection_online_acknowledged'
    );
    expect(replayBranch).not.toContain('whatsapp_session_lease');
  });

  it('never re-marks a runtime that has entered irreversible retirement', () => {
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime\n  WHERE runtime.worker_id = p_worker_id'
    );
    const retiredGuard = migration.indexOf(
      'IF v_runtime.recreate_retired_operation_id IS NOT NULL THEN'
    );
    const exactReplay = migration.indexOf(
      'IF v_runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM'
    );

    expect(retiredGuard).toBeGreaterThan(runtimeLock);
    expect(exactReplay).toBeGreaterThan(retiredGuard);
  });

  it('revalidates the exact PostgreSQL lease and rejects legacy lease residue', () => {
    for (const fence of [
      "v_runtime.session_storage = 'postgres'",
      'lease.session_id = p_worker_id',
      'lease.provider = v_runtime.source_provider',
      'lease.generation = v_runtime.runtime_generation',
      'lease.epoch = v_runtime.session_writer_epoch',
      'lease.owner_id = v_runtime.native_connection_status_lease_owner_id',
      'lease.fencing_token =',
      'v_runtime.native_connection_status_fencing_token',
      "lease.expires_at > clock_timestamp() + interval '5 seconds'",
      'FOR SHARE;',
      'IF NOT FOUND THEN',
      "ELSIF v_runtime.session_storage = 'legacy_volume' THEN",
      'v_runtime.native_connection_status_lease_owner_id IS NOT NULL',
      'v_runtime.native_connection_status_fencing_token IS NOT NULL',
    ]) {
      expect(migration).toContain(fence);
    }
  });

  it('keeps exact marker identity and replay-stable started_at', () => {
    for (const fence of [
      'recreate_bootstrap_operation_id = p_lifecycle_operation_id',
      'recreate_bootstrap_runtime_generation = p_runtime_generation',
      'recreate_bootstrap_container_id = runtime.container_id',
      'runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM',
      'runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM',
      'THEN runtime.recreate_bootstrap_started_at',
      'ELSE clock_timestamp()',
      'RETURN FOUND;',
    ]) {
      expect(migration).toContain(fence);
    }
  });
});
