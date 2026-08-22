import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260810140000.sql'),
  'utf8'
);

describe('WhatsApp runtime bootstrap activation compatibility', () => {
  it('routes an 8-argument bootstrap through the grant-aware session base', () => {
    expect(migration).toContain('IF p_connection_attempt_id IS NULL THEN');
    expect(migration).toMatch(
      /IF p_connection_attempt_id IS NULL THEN[\s\S]+activate_whatsapp_runtime_fence_pairing_session_base\([\s\S]+NULL::uuid/u
    );
  });

  it('keeps direct QR activation on the resumable pairing implementation', () => {
    expect(migration).toContain(
      'RENAME TO activate_whatsapp_runtime_fence_resumable_pairing_base'
    );
    expect(migration).toMatch(
      /IF p_connection_attempt_id IS NULL THEN[\s\S]+RETURN;[\s\S]+activate_whatsapp_runtime_fence_resumable_pairing_base\([\s\S]+p_connection_attempt_id/u
    );
  });

  it('validates runtime identity without rejecting the compatibility sentinel', () => {
    for (const predicate of [
      'p_worker_id IS NULL',
      'p_account_id IS NULL',
      'p_generation IS NULL',
      'p_generation <= 0',
      'p_writer_epoch IS NULL',
      'p_capability IS NULL',
      'p_container_id IS NULL',
      'p_connection_epoch IS NULL',
    ]) {
      expect(migration).toContain(predicate);
    }

    const validationEnd = migration.indexOf('THEN\n    RETURN NEXT;');
    expect(validationEnd).toBeGreaterThan(-1);
    expect(migration.slice(0, validationEnd)).not.toContain(
      'OR p_connection_attempt_id IS NULL'
    );
  });

  it('preserves the canonical stopped fence before either activation path', () => {
    const workerLock = migration.indexOf('FROM public.worker AS owner');
    const stoppedFence = migration.indexOf(
      "v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid"
    );
    const compatibilityBranch = migration.indexOf(
      'IF p_connection_attempt_id IS NULL THEN'
    );

    expect(workerLock).toBeGreaterThan(-1);
    expect(stoppedFence).toBeGreaterThan(workerLock);
    expect(compatibilityBranch).toBeGreaterThan(stoppedFence);
    expect(migration.slice(workerLock, stoppedFence)).toContain('FOR SHARE');
  });

  it('keeps helper implementations private and exposes only the public fence', () => {
    expect(migration).toContain(
      'public.activate_whatsapp_runtime_fence_resumable_pairing_base(\n' +
        '    uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        '  ) FROM whatsapp_session_runtime;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(\n' +
        '  uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        ') TO whatsapp_session_runtime;'
    );
  });
});
