import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260819205000.sql'),
  'utf8'
);

describe('WhatsApp session lease failover grace PostgreSQL contract', () => {
  it('enforces a 60-second minimum from the persisted heartbeat', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1()'
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain(
      `NEW."heartbeat_at" + interval '60 seconds'`
    );
    expect(migration).toContain(
      'NEW."expires_at" := GREATEST('
    );
  });

  it('only extends owned, active-shaped leases and preserves release semantics', () => {
    expect(migration).toContain('NEW."owner_id" IS NOT NULL');
    expect(migration).toContain('NEW."heartbeat_at" IS NOT NULL');
    expect(migration).toContain('NEW."expires_at" IS NOT NULL');
    expect(migration).not.toMatch(/UPDATE\s+public\."whatsapp_session_lease"/iu);
  });

  it('applies before acquire and renewal writes without granting public execute', () => {
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF "owner_id", "heartbeat_at", "expires_at"'
    );
    expect(migration).toContain(
      'ON public."whatsapp_session_lease"'
    );
    expect(migration).toContain(
      'EXECUTE FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1();'
    );
    expect(migration).toContain('REVOKE ALL');
    expect(migration).toContain('FROM PUBLIC;');
  });
});
