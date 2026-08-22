import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260810150000.sql'),
  'utf8'
);
const compatibilityWrapper = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260810140000.sql'),
  'utf8'
);

describe('WhatsApp resumable pairing activation for all providers', () => {
  it('extends only the private resumable boundary to supported providers', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence_resumable_pairing_base('
    );
    expect(migration).toContain(
      "lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')"
    );
    expect(compatibilityWrapper).toMatch(
      /activate_whatsapp_runtime_fence_resumable_pairing_base\([\s\S]+p_connection_attempt_id/u
    );
  });

  it('requires the canonical draft and lease to belong to the requested provider', () => {
    for (const predicate of [
      'session.provider = lower(trim(p_provider))',
      'revision.provider = lower(trim(p_provider))',
      'lease.provider = lower(trim(p_provider))',
      'pairing_grant.provider = lower(trim(p_provider))',
      'v_runtime.source_provider = lower(trim(p_provider))',
    ]) {
      expect(migration).toContain(predicate);
    }

    expect(migration).toContain("revision.status = 'staging'");
    expect(migration).toContain("revision.source = 'pairing'");
    expect(migration).toContain('revision.writer_generation = p_generation');
    expect(migration).toContain('revision.writer_epoch = p_writer_epoch');
  });

  it('allows only the provider-specific empty native tree', () => {
    expect(migration).toContain("lower(trim(p_provider)) = 'baileys'");
    expect(migration).toContain("provider_record.namespace <> 'baileys/creds'");
    expect(migration).toContain(
      "lower(trim(p_provider)) IN ('wwebjs', 'whatsmeow')"
    );

    const strictProviderTree = migration.indexOf(
      "lower(trim(p_provider)) IN ('wwebjs', 'whatsmeow')"
    );
    const artifactsFence = migration.indexOf(
      'FROM public.whatsapp_artifact AS artifact'
    );
    const strictBlock = migration.slice(strictProviderTree, artifactsFence);
    expect(strictBlock).toContain(
      'FROM public.whatsapp_provider_record AS provider_record'
    );
    expect(strictBlock).toContain('FROM public.whatsapp_device AS device');
  });

  it('preserves worker-runtime-session-lease-grant lock order', () => {
    const workerLock = migration.indexOf('FROM public.worker AS owner');
    const runtimeLock = migration.indexOf(
      'FROM public.worker_runtime AS runtime'
    );
    const sessionLock = migration.indexOf(
      'FROM public.whatsapp_session AS session'
    );
    const leaseLock = migration.indexOf(
      'FROM public.whatsapp_session_lease AS lease'
    );
    const grantLock = migration.indexOf(
      'FROM public.whatsapp_pairing_activation_grant AS pairing_grant'
    );

    expect(workerLock).toBeGreaterThan(-1);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(sessionLock).toBeGreaterThan(runtimeLock);
    expect(leaseLock).toBeGreaterThan(sessionLock);
    expect(grantLock).toBeGreaterThan(leaseLock);
    expect(migration.slice(workerLock, runtimeLock)).toContain('FOR SHARE');
    expect(migration.slice(runtimeLock, sessionLock)).toContain('FOR UPDATE');
    expect(migration.slice(sessionLock, leaseLock)).toContain('FOR SHARE');
    expect(migration.slice(leaseLock, grantLock)).toContain('FOR UPDATE');
  });

  it('keeps the security-definer helper private', () => {
    expect(migration).toContain(
      "SECURITY DEFINER\nSET search_path TO 'pg_catalog', 'public'"
    );
    expect(migration).toContain(
      'public.activate_whatsapp_runtime_fence_resumable_pairing_base(\n' +
        '    uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        '  ) FROM PUBLIC;'
    );
    expect(migration).toContain(
      'public.activate_whatsapp_runtime_fence_resumable_pairing_base(\n' +
        '    uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        '  ) FROM whatsapp_session_runtime;'
    );
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence_resumable_pairing_base'
    );
  });
});
