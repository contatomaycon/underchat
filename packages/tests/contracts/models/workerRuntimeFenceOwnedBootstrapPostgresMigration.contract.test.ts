import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260811110000.sql'),
  'utf8'
);

describe('WhatsApp owned runtime bootstrap activation', () => {
  it('resolves the exact manager-owned fence for an attempt-less bootstrap', () => {
    expect(migration).toMatch(
      /IF p_connection_attempt_id IS NULL THEN[\s\S]+resolve_whatsapp_runtime_owned_connection_fence\([\s\S]+v_owned_connection_epoch[\s\S]+v_owned_connection_attempt_id/u
    );
  });

  it('resumes the exact owned attempt through the strict QR boundary', () => {
    expect(migration).toMatch(
      /activate_whatsapp_runtime_fence_resumable_pairing_base\([\s\S]+v_owned_connection_epoch,[\s\S]+v_owned_connection_attempt_id/u
    );
  });

  it('keeps ordinary bootstrap and direct QR activation on their existing fences', () => {
    expect(migration).toMatch(
      /activate_whatsapp_runtime_fence_pairing_session_base\([\s\S]+p_connection_epoch,[\s\S]+NULL::uuid/u
    );
    expect(migration).toMatch(
      /activate_whatsapp_runtime_fence_resumable_pairing_base\([\s\S]+p_connection_epoch,[\s\S]+p_connection_attempt_id/u
    );
  });

  it('preserves stopped and runtime-role boundaries', () => {
    expect(migration).toContain(
      "v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid"
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence('
    );
    expect(migration).toContain('TO whatsapp_session_runtime;');
  });
});
