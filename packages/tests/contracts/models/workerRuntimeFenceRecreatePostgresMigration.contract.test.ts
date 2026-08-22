import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260801211500.sql'),
  'utf8'
);

const DELETING = '019a930d-c6f6-766d-9c84-437433031776';
const RECREATING = '019a930d-c6f6-766d-9c84-46093814d8e0';
const DELETE = '019a930d-c6f6-766d-9c84-4dc1777f8f69';
const BLOCKED = '019bcd18-ce66-77a2-9d7c-e48159c253da';

describe('activate_whatsapp_runtime_fence recreate correction', () => {
  it('allows the exact successor runtime to activate while lifecycle is recreating', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence('
    );
    expect(migration).toContain(
      `IF v_worker_status_id = '${RECREATING}'::uuid`
    );
    expect(migration).toContain('v_lifecycle_operation_id IS NULL');
    expect(migration).toContain(
      'v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id'
    );

    for (const status of [DELETING, DELETE, BLOCKED]) {
      expect(migration).toContain(`'${status}'::uuid`);
    }
  });

  it('retains every immutable runtime identity fence', () => {
    for (const predicate of [
      'v_runtime."container_id" = trim(p_container_id)',
      'v_runtime."runtime_generation" <> p_generation',
      'v_runtime."runtime_capability_hash" <> v_capability_hash',
      'v_runtime."session_storage" IS DISTINCT FROM v_worker_storage',
      'v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch',
    ]) {
      expect(migration).toContain(predicate);
    }
  });

  it('keeps the canonical worker-before-runtime lock order', () => {
    expect(migration.indexOf('FROM public."worker" AS w')).toBeLessThan(
      migration.indexOf('FROM public."worker_runtime" AS runtime')
    );
    expect(migration).toContain('FOR SHARE;');
    expect(migration).toContain('FOR UPDATE;');
  });

  it('captures the lifecycle and both container pointers under the worker lock', () => {
    expect(migration).toContain(
      'SELECT w."session_storage", w."worker_status_id", w."container_id",'
    );
    expect(migration).toContain('w."lifecycle_operation_id"');
    expect(migration).toContain(
      'INTO v_worker_storage, v_worker_status_id, v_worker_container_id,'
    );
  });
});
