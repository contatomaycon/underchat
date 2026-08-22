import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260811111000.sql'),
  'utf8'
);

describe('WhatsApp autonomous runtime fence recovery', () => {
  it('authenticates the full physical runtime identity before retiring stale grants', () => {
    for (const fence of [
      'runtime.runtime_generation = p_generation',
      'runtime.session_writer_epoch = p_writer_epoch',
      "encode(public.digest(p_capability, 'sha256'), 'hex')",
      "runtime.container_id LIKE trim(p_container_id) || '%'",
      'runtime.source_provider = lower(trim(p_provider))',
    ]) {
      expect(migration).toContain(fence);
    }
    expect(migration).toMatch(
      /IF COALESCE\(v_runtime_identity_valid, false\) THEN[\s\S]+UPDATE public\.whatsapp_pairing_activation_grant/u
    );
  });

  it('retires only expired, unconsumed and unactivated grants', () => {
    expect(migration).toContain(
      'pairing_grant.consumed_at IS NULL\n        AND pairing_grant.revoked_at IS NULL'
    );
    expect(migration).toContain(
      'pairing_grant.expires_at <= clock_timestamp()'
    );
    expect(migration).toContain(
      'pairing_grant.connection_sequence_at_grant + 1'
    );
  });

  it('resumes pending and owned authorization through their strict boundaries', () => {
    expect(migration).toMatch(
      /v_owned_authorization_state = 'pending'[\s\S]+activate_whatsapp_runtime_fence_resumable_pairing_base/u
    );
    expect(migration).toMatch(
      /v_owned_authorization_state = 'owned'[\s\S]+activate_whatsapp_runtime_fence_pairing_session_base/u
    );
  });

  it('retains the ordinary bootstrap and stopped fences', () => {
    expect(migration).toContain(
      "v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid"
    );
    expect(migration).toMatch(
      /activate_whatsapp_runtime_fence_pairing_session_base\([\s\S]+p_connection_epoch,[\s\S]+NULL::uuid/u
    );
  });
});
