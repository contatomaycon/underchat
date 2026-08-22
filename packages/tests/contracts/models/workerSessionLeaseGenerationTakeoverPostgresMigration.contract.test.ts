import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260804150000.sql'),
  'utf8'
);

describe('WhatsApp session lease generation takeover migration', () => {
  it('allows only a strictly newer durable generation to fence a live owner', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.acquire_whatsapp_session_lease('
    );
    expect(migration).toContain('lease.generation < p_generation');
    expect(migration).toContain('lease.epoch IS DISTINCT FROM p_epoch');
    expect(migration).toContain('session.generation = p_generation');
    expect(migration).toContain('session.epoch = p_epoch');
    expect(migration).toContain('session.capability_hash = v_capability_hash');
    expect(migration).toContain('fencing_token = lease.fencing_token + 1');
    expect(migration).not.toContain('lease.generation <= p_generation');
  });

  it('retains same-owner renewal semantics without permitting a same-generation competitor', () => {
    expect(migration).toContain('lease.owner_id IS NULL');
    expect(migration).toContain('lease.expires_at <= v_now');
    expect(migration).toMatch(
      /lease\.owner_id = p_owner_id[\s\S]+lease\.generation = p_generation[\s\S]+lease\.epoch = p_epoch/u
    );
  });

  it('locks lease then session and samples PostgreSQL time after both locks', () => {
    const leaseLock = migration.indexOf(
      'FROM public.whatsapp_session_lease AS lease'
    );
    const sessionLock = migration.indexOf(
      'FROM public.whatsapp_session AS session',
      leaseLock
    );
    const clockSample = migration.indexOf('v_now := clock_timestamp()');

    expect(leaseLock).toBeGreaterThan(0);
    expect(sessionLock).toBeGreaterThan(leaseLock);
    expect(clockSample).toBeGreaterThan(sessionLock);
    expect(migration.slice(leaseLock, sessionLock)).toContain('FOR UPDATE;');
    expect(migration.slice(sessionLock, clockSample)).toContain('FOR SHARE;');
  });

  it('uses row locks and capability fencing without advisory session locks', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'pg_catalog', 'public'");
    expect(migration).not.toMatch(/pg_(?:try_)?advisory/u);
    expect(migration).not.toMatch(
      /DELETE\s+FROM\s+public\.whatsapp_session_lease/iu
    );
  });
});
