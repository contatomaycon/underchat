import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260810120000.sql'),
  'utf8'
);
const workerStatus = readFileSync(
  resolve(process.cwd(), 'packages/common/enums/EWorkerStatus.ts'),
  'utf8'
);

const BLOCKED = '019bcd18-ce66-77a2-9d7c-e48159c253da';
const STOPPED = '019feb94-c2ff-76b1-9d00-d7602a50affe';

describe('worker stopped status PostgreSQL contract', () => {
  it('keeps the historical plan-block UUID and creates a distinct physical stop', () => {
    expect(migration).toContain(`"status" = 'blocked'`);
    expect(migration).toContain(`'${BLOCKED}'`);
    expect(migration).toContain(`'${STOPPED}', 'stopped'`);
    expect(workerStatus).toContain(`blocked = '${BLOCKED}'`);
    expect(workerStatus).toContain(`stopped = '${STOPPED}'`);
  });

  it('fences delayed status events for both session backends at the shared SQL entry point', () => {
    expect(migration).toContain(
      ') RENAME TO apply_worker_runtime_status_stopped_base;'
    );
    expect(migration).toContain(`v_worker_status_id = '${STOPPED}'::uuid`);
    expect(migration).toContain("outcome := 'stale'");
    expect(migration).toContain(
      'FROM public.apply_worker_runtime_status_stopped_base('
    );
    expect(migration).not.toMatch(/session_storage\s*=/u);
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status('
    );
  });

  it('rejects delayed activation until an explicit recreate changes the worker state', () => {
    expect(migration).toContain('activate_whatsapp_runtime_fence_stopped_base');
    expect(migration).toContain(`v_worker_status_id = '${STOPPED}'::uuid`);
    expect(migration).toContain('activated := false');
    expect(migration).toContain('already_active := false');
  });
});
