import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260811010000.sql'),
  'utf8'
);

describe('WhatsApp active pairing worker status boundary', () => {
  it('guards all unofficial providers at the shared runtime write boundary', () => {
    expect(migration).toContain("WHEN 'baileys'");
    expect(migration).toContain("WHEN 'wwebjs'");
    expect(migration).toContain("WHEN 'whatsmeow'");
    expect(migration).toContain('whatsapp_pairing_activation_grant');
    expect(migration).toContain(
      'pairing_grant.connection_attempt_id = v_connection_attempt_id'
    );
  });

  it('serializes in worker then runtime order before evaluating the grant', () => {
    const workerLock = migration.indexOf('FROM public.worker AS owner');
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime'
    );
    const grantLookup = migration.indexOf(
      'JOIN public.whatsapp_pairing_activation_grant AS pairing_grant'
    );

    expect(workerLock).toBeGreaterThan(-1);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(grantLookup).toBeGreaterThan(runtimeLock);
    expect(migration.slice(workerLock, grantLookup)).toContain('FOR UPDATE');
  });

  it('preserves available and connecting across non-terminal regressions', () => {
    expect(migration).toContain(
      "v_current_worker_status_id =\n        '019a930d-c6f6-766d-9c84-3904383fe742'::uuid"
    );
    expect(migration).toContain(
      "v_current_worker_status_id =\n        '019fee6d-09b1-752b-b759-943c3743db7e'::uuid"
    );
    expect(migration).toContain('ELSIF NOT v_explicit_terminal');
    expect(migration).toContain('to_jsonb(v_current_worker_status_id::text)');
  });

  it('promotes the exact QR-consumption boundary to connecting', () => {
    expect(migration).toContain(
      "COALESCE(p_status ->> 'code', '') IN ('201', '206')"
    );
    expect(migration).toContain(
      "to_jsonb('019fee6d-09b1-752b-b759-943c3743db7e'::text)"
    );
  });

  it('keeps explicit terminal failures admissible', () => {
    expect(migration).toContain('v_explicit_terminal :=');
    expect(migration).toContain(
      "'401', '403', '408', '411', '428', '440', '500', '600'"
    );
    expect(migration).toContain('NOT v_pairing_progress');
  });

  it('keeps the helper private and exposes only the public function', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_pairing_status_base('
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(\n' +
        '  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid\n' +
        ') TO whatsapp_session_runtime;'
    );
  });
});
